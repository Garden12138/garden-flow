import { recordCreationMetric } from './creationMetrics';
import { MetricWorkSummarySchema } from '../../shared/contentExperiments';
import { presetConfig } from '../../shared/noteCards';
import { readCreationSource } from './creationSources';
import { createProductTargetVariant } from './productWorkVersionService';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { CreationStartSchema, CreationDraftSchema, CreationSaveSchema, CreationTurnSchema, CreationForkGuardSchema, CREATION_CAPABILITY_LABELS, type CreationWorkspace, type CreationTurn } from '../../shared/creationWorkspace';
import { createChatSession, getChatSession, updateChatSessionMetadata, updateChatSessionTitle, getWorkspacePaths, runInWorkspaceSpace } from '../db';
import { createDreamStory, getDreamSession, applyDreamEdit, copyDreamStoryTarget } from './dreamStoryStore';
import { resolveDreamStoryTarget } from '../../shared/contentCreationTarget';
import { saveXhsNoteProject, getXhsNoteProject } from './xhsNoteProjectStore';
import { createBrandWorkspaceStore } from './brandWorkspaceStore';
import { resolveProductCreationTarget, ProductCreationTargetSchema } from '../../shared/productCreationTarget';
import { ProductVideoComposeParamsSchema } from '../../shared/productVideoProposal';
import { createProductImageSet } from './productImageSetService';
import { createProductVideoProject, getVideoEditorV2Project } from './video-editor-v2/videoEditorV2ProjectStore';
import { readProductProjectEditor, productEditorKey, getProductProjectEditorSession, applyProductProjectEdit } from './productProjectEditorService';
import { readProductVideoRemixSources, resolveProductVideoRemixFiles } from './productVideoRemixSources';

const events = new EventEmitter();
export const onCreationWorkspaceChanged = (listener: (record: CreationWorkspace) => void) => { events.on('changed', listener); return () => events.off('changed', listener); };
const locks = new Map<string, Promise<unknown>>();
async function locked<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const key = `${getWorkspacePaths().activeSpaceId}:${id}`;
    const previous = locks.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation); locks.set(key, current);
    try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
}
const root = () => path.join(getWorkspacePaths().gardenflow, 'creation-workspaces');
const file = (id: string) => path.join(root(), CreationTurnSchema.shape.workspaceId.parse(id) + '.json');
async function persist(value: CreationWorkspace): Promise<CreationWorkspace> {
    await fs.mkdir(root(), { recursive: true });
    const target = file(value.id); const temp = target + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temp, target); }
    finally { await fs.rm(temp, { force: true }); }
    events.emit('changed', value); return value;
}
export async function readCreationWorkspace(id: string): Promise<CreationWorkspace> {
    const value = JSON.parse(await fs.readFile(file(id), 'utf8')) as CreationWorkspace;
    if (value.version !== 1 || value.id !== id || value.spaceId !== getWorkspacePaths().activeSpaceId) throw new Error('作品不属于当前空间');
    CreationStartSchema.parse({ platform: value.platform, capability: value.capability }); // Validate the stored platform/capability without trusting file contents.
    return value;
}
export async function listCreationWorkspaceSummaries() {
    const entries = await fs.readdir(root(), { withFileTypes: true }).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    });
    const summaries = [];
    for (const entry of entries.filter(value => value.isFile() && /^[a-zA-Z0-9_-]{1,160}\.json$/.test(value.name)).slice(0, 2000)) {
        try {
            const work = await readCreationWorkspace(entry.name.slice(0, -5));
            summaries.push(MetricWorkSummarySchema.parse({ id: work.id, revision: work.revision, draftEpoch: work.draftEpoch, platform: work.platform, capability: work.capability, title: work.draft.title || CREATION_CAPABILITY_LABELS[work.capability], updatedAt: work.updatedAt }));
        } catch { /* Corrupt or foreign-space records are never offered as an available work. */ }
    }
    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 1000);
}
function metadata(id: string) { return { creationWorkspaceId: id, spaceId: getWorkspacePaths().activeSpaceId }; }
function bindSession(sessionId: string, extra: Record<string, unknown>) {
    const session = getChatSession(sessionId); if (!session) throw new Error('创作对话不存在');
    let old: Record<string, unknown> = {}; try { old = JSON.parse(session.metadata || '{}'); } catch { /* Restore a verified local binding. */ }
    updateChatSessionMetadata(sessionId, { ...old, ...extra }, { touchUpdatedAt: false });
}
function existingCreationSession(id: string) {
    const session = getChatSession(id);
    try { return session && JSON.parse(session.metadata || '{}').creationWorkspaceId === id ? session : null; } catch { return null; }
}
export function creationWorkspaceIdForRequest(spaceId: string, requestId: string): string {
    CreationTurnSchema.shape.spaceId.parse(spaceId); CreationTurnSchema.shape.requestId.parse(requestId);
    return 'creation_' + createHash('sha256').update(spaceId + ':' + requestId).digest('hex').slice(0, 40);
}
export async function startCreationWorkspace(input: unknown, prepared?: { native: NonNullable<CreationWorkspace['native']>; sessionId: string }): Promise<CreationWorkspace> {
    const selection = CreationStartSchema.parse(input); const spaceId = getWorkspacePaths().activeSpaceId;
    return locked('start_' + (selection.requestId || randomUUID()), () => runInWorkspaceSpace(spaceId, async () => {
        const id = selection.requestId ? creationWorkspaceIdForRequest(spaceId, selection.requestId) : 'creation_' + randomUUID();
        if (selection.requestId) { try { const previous = await readCreationWorkspace(id); if (previous.startDigest && previous.startDigest !== createHash('sha256').update(JSON.stringify(selection)).digest('hex') || previous.platform !== selection.platform || previous.capability !== selection.capability) throw new Error('同一请求不能创建不同作品'); return previous; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
        for (const ref of selection.sourceRefs || []) await readCreationSource(ref, { limit: 1 });
        if (selection.productId) await createBrandWorkspaceStore(() => path.join(getWorkspacePaths().subjects, 'brand-workspace')).getProductCreativeReference(selection.productId);
        if (selection.sourceSessionId) { const source = getChatSession(selection.sourceSessionId); if (!source) throw new Error('来源对话不存在'); const meta = JSON.parse(source.metadata || '{}'); if (meta.spaceId && meta.spaceId !== spaceId) throw new Error('来源对话不属于当前空间'); } const title = '未命名' + CREATION_CAPABILITY_LABELS[selection.capability];
        let sessionId: string; let native: CreationWorkspace['native'];
        if (prepared) { native = prepared.native; sessionId = prepared.sessionId; }
        else if (selection.capability === 'dream-story') {
            let project = await createDreamStory(title); const doc = project.dreamStory!;
            project = await applyDreamEdit({ spaceId, projectId: project.id, requestId: randomUUID(), expectedRevision: doc.revision, expectedDraftEpoch: doc.draftEpoch,
                operations: [{ type: 'target.confirm', target: resolveDreamStoryTarget() }] });
            sessionId = (await getDreamSession(project.id)).sessionId; native = { kind: 'video', projectId: project.id };
        } else if (selection.capability === 'note-image' || selection.capability === 'note-video') {
            const note = await saveXhsNoteProject({ path: path.join(getWorkspacePaths().manuscripts, 'xiaohongshu', id + (selection.capability === 'note-video' ? '.redvideo' : '.redpost')), noteType: selection.capability === 'note-video' ? 'video' : 'image', document: { finalTitle: '', body: '', ...(selection.capability === 'note-image' ? { creationConfig: { ...presetConfig(selection.presetId || 'free'), brief: selection.brief || '', sourceRefs: selection.sourceRefs || [], inputMode: selection.sourceRefs?.length ? 'article' : selection.presetId === 'article' ? 'article' : 'manual' } } : {}) } });
            sessionId = (existingCreationSession(id) || createChatSession(id, title, { ...metadata(id), contextType: 'creation-workspace', contextId: id, isContextBound: true,
                associatedFilePath: note.projectPath, editorBindingKind: 'xiaohongshu-note', activeXhsNotePath: note.projectPath, activeXhsNoteUri: note.uri,
                executionProfile: 'artifact-authoring', workflowKind: 'xiaohongshu-note-editing', platform: 'xiaohongshu', artifactType: 'xiaohongshu-note' })).id;
            native = { kind: 'note', path: note.relativePath };
        } else sessionId = (existingCreationSession(id) || createChatSession(id, title, { ...metadata(id), contextType: 'creation-workspace', contextId: id, isContextBound: true, editorBindingKind: 'creation-workspace', workflowKind: 'creation-workspace' })).id;
        bindSession(sessionId, metadata(id));
        const now = new Date().toISOString();
        await recordCreationMetric('entry.' + (selection.presetId || selection.capability));
        return persist({ version: 1, id, spaceId, platform: selection.platform, capability: selection.capability, sourceSessionId: selection.sourceSessionId, entry: selection.entry, requestId: selection.requestId, startDigest: createHash('sha256').update(JSON.stringify(selection)).digest('hex'), sessionId, native, revision: randomUUID(), draftEpoch: 0,
            draft: CreationDraftSchema.parse({ ...(!native && selection.sourceRefs?.length ? { creationConfig: { ...presetConfig('free'), sourceRefs: selection.sourceRefs } } : {}), productId: selection.productId || '', brief: native ? '' : selection.brief || '', language: selection.platform === 'tiktok' ? 'en' : 'zh-CN', market: selection.platform === 'tiktok' ? 'International' : '中国', aspectRatio: ['product-image-set', 'note-image'].includes(selection.capability) ? '3:4' : '9:16' }), undo: [], createdAt: now, updatedAt: now });
    }));
}
export function assertCreationTurn(record: CreationWorkspace, input: CreationTurn): void {
    if (record.spaceId !== input.spaceId || record.id !== input.workspaceId || record.revision !== input.expectedRevision || record.draftEpoch !== input.expectedDraftEpoch) throw new Error('作品或手动输入已变化，修改未应用；请按最新内容重试');
}
export async function saveCreationWorkspace(input: unknown): Promise<CreationWorkspace> {
    const request = CreationSaveSchema.parse(input);
    return locked(request.workspaceId, async () => {
        const record = await readCreationWorkspace(request.workspaceId);
        const digest = createHash('sha256').update(JSON.stringify({ draft: request.draft, revision: request.expectedRevision, epoch: request.expectedDraftEpoch })).digest('hex');
        const receipt = record.receipts?.find(item => item.id === request.requestId);
        if (receipt) { if (receipt.digest !== digest) throw new Error('同一请求 ID 对应不同修改'); return record; }
        try { assertCreationTurn(record, request); } catch (error) {
            if (request.origin === 'ai') { record.unapplied = [...(record.unapplied || []), { id: request.requestId, draft: request.draft, basedOnRevision: request.expectedRevision }].slice(-5); await persist(record); }
            throw error;
        }
        if (record.capability === 'product-image-set' ? request.draft.aspectRatio !== '3:4' : record.platform === 'xiaohongshu' ? !['9:16', '16:9'].includes(request.draft.aspectRatio) : request.draft.aspectRatio !== '9:16') throw new Error('画幅不符合当前平台与创作方式，请在作品编辑中重新选择');
        record.receipts = [...(record.receipts || []), { id: request.requestId, digest }].slice(-100);
        if (record.native) throw new Error('作品已进入完整编辑，请在当前作品中继续');
        for (const ref of request.draft.creationConfig?.sourceRefs || []) if (!record.draft.creationConfig?.sourceRefs.some(old => old.id === ref.id && old.version === ref.version)) await readCreationSource(ref, { limit: 1 });
        record.undo = [...record.undo, record.draft].slice(-30); record.draft = request.draft;
        record.revision = randomUUID(); record.updatedAt = new Date().toISOString();
        updateChatSessionTitle(record.sessionId, record.draft.title.trim() || '未命名' + CREATION_CAPABILITY_LABELS[record.capability]);
        return persist(record);
    });
}
export async function markCreationDraft(id: string): Promise<CreationWorkspace> {
    return locked(id, async () => { const value = await readCreationWorkspace(id); value.draftEpoch++; return persist(value); });
}
export async function undoCreationWorkspace(input: unknown): Promise<CreationWorkspace> {
    const request = CreationTurnSchema.parse(input);
    return locked(request.workspaceId, async () => { const value = await readCreationWorkspace(request.workspaceId); assertCreationTurn(value, request); const previous = value.undo.pop(); if (!previous) throw new Error('没有可撤销的修改'); value.draft = previous; value.revision = randomUUID(); value.updatedAt = new Date().toISOString(); return persist(value); });
}
export async function creationProductSources(id: string) {
    const value = await readCreationWorkspace(id);
    const store = createBrandWorkspaceStore(() => path.join(getWorkspacePaths().subjects, 'brand-workspace'));
    return { product: value.draft.productId ? await store.getProductCreativeReference(value.draft.productId) : null, clips: value.capability === 'product-remix' && value.draft.sourceAssetIds.length ? await readProductVideoRemixSources(value.draft.sourceAssetIds) : [] };
}
/** Compile only local editable data. This path never submits a generation job. */
export async function materializeCreationWorkspace(input: unknown): Promise<CreationWorkspace> {
    const request = CreationTurnSchema.parse(input);
    return locked(request.workspaceId, async () => {
        const record = await readCreationWorkspace(request.workspaceId); if (record.native) return record; assertCreationTurn(record, request);
        const draft = record.draft; if (!draft.productId || !draft.title.trim()) throw new Error('请填写作品标题并选择一个商品');
        const store = createBrandWorkspaceStore(() => path.join(getWorkspacePaths().subjects, 'brand-workspace'));
        const product = await store.getProductCreativeReference(draft.productId);
        const target = ProductCreationTargetSchema.parse({ ...resolveProductCreationTarget({ platform: record.platform, contentKind: record.capability === 'product-image-set' ? 'image-set' : 'video', compositionMode: record.capability === 'product-remix' ? 'existing-clips' : 'product-images', language: draft.language, market: draft.market, aspectRatio: draft.aspectRatio }), allowPaidMedia: record.capability === 'product-video' && draft.scenes.some(scene => scene.mediaMode === 'ai-motion') });
        if (record.capability === 'product-image-set') {
            const note = await createProductImageSet({ creationTarget: target, proposalId: record.id, productId: product.id, productUpdatedAt: product.updatedAt, productName: product.name,
                finalTitle: draft.title, body: draft.body, hashtags: draft.hashtags, style: { background: '#FAF8F3', foreground: '#202925', accent: '#C05640' },
                pages: draft.pages.map((page, index) => ({ id: page.id, role: index === 0 ? 'cover' : 'content', title: page.title, copy: page.copy, layout: index === 0 ? 'cover' : page.layout, productAssetIds: page.assetIds, fit: 'contain', cropX: 50, cropY: 50, fontScale: 1, aiPrompt: '' })) });
            record.native = { kind: 'note', path: note.relativePath };
        } else {
            const remix = record.capability === 'product-remix';
            const clips = remix ? await readProductVideoRemixSources([...new Set(draft.scenes.map(scene => scene.assetId))]) : [];
            const proposal = ProductVideoComposeParamsSchema.parse({ proposalId: record.id, creationTarget: target, publicationCopy: { title: draft.title, description: draft.body, hashtags: draft.hashtags }, productId: product.id, productName: product.name, productUpdatedAt: product.updatedAt, referencedProductIds: [product.id], title: draft.title,
                canvas: { width: target.spec.width, height: target.spec.height, fps: target.spec.fps, aspectRatio: target.spec.aspectRatio },
                durationMs: draft.scenes.reduce((sum, scene) => sum + scene.durationMs, 0), voiceoverEnabled: false, compositionMode: remix ? 'existing-clips' : 'product-images',
                scenes: draft.scenes.map(scene => ({ id: scene.id, title: scene.title || '镜头', durationMs: scene.durationMs, source: remix ? 'media-clip' : scene.mediaMode, generationPrompt: scene.visual, productAssetIds: remix ? [] : [scene.assetId], overlayText: scene.text, fitMode: 'contain-blur', motionPreset: remix ? 'static' : 'slow-zoom-in',
                    ...(remix ? { mediaAssetId: scene.assetId, mediaContentHash: clips.find(clip => clip.assetId === scene.assetId)?.contentHash, sourceStartMs: scene.sourceStartMs, sourceEndMs: scene.sourceStartMs + scene.durationMs, sourceVolume: scene.sourceVolume } : {}) })) });
            const project = await store.withProductCreativeSnapshot(product.id, product.updatedAt, async (snapshot, assets, assertCurrent) => {
                const sources = remix ? await resolveProductVideoRemixFiles(clips) : assets.filter(asset => draft.scenes.some(scene => scene.assetId === asset.assetId));
                return createProductVideoProject({ proposal, productSnapshot: snapshot, sourceAssets: sources, assertSnapshotCurrent: assertCurrent });
            });
            const narration = draft.scenes.filter(scene => scene.narration.trim()).map(scene => ({ type: 'scene.narration-text' as const, sceneId: scene.id, text: scene.narration }));
            if (narration.length) {
                const editor = await readProductProjectEditor({ kind: 'video', projectId: project.id });
                await applyProductProjectEdit({ binding: editor.binding, requestId: record.id + '_narration', expectedRevision: editor.revision, expectedDraftEpoch: editor.draftEpoch, operations: narration });
            }
            record.native = { kind: 'video', projectId: project.id };
        }
        const ref = record.native.kind === 'video' ? record.native : { kind: 'image-set' as const, path: record.native.path };
        const snapshot = await readProductProjectEditor(ref);
        bindSession(record.sessionId, { ...metadata(record.id), contextId: `product-project:${record.spaceId}:${productEditorKey(snapshot.binding.project)}`, contextType: 'product-project',
            editorBindingKind: 'product-project', productProjectEditorBinding: snapshot.binding, workflowKind: 'product-project-edit', executionProfile: 'artifact-authoring', associatedFilePath: snapshot.imageSet?.projectPath });
        record.revision = randomUUID(); record.updatedAt = new Date().toISOString(); return persist(record);
    });
}
async function latestCreationDraft(source: CreationWorkspace) {
    const draft = structuredClone(source.draft);
    if (source.native?.kind === 'note') {
        const snapshot = await getXhsNoteProject(source.native.path); const document = snapshot.document;
        Object.assign(draft, { title: document.finalTitle, body: document.body, hashtags: document.hashtags, brief: document.voiceover || document.body });
        const set = document.productImageSet;
        if (set) Object.assign(draft, { productId: set.productSnapshot.id, pages: set.pages.map(page => ({ id: page.id, title: page.title, copy: page.copy, assetIds: page.productAssetIds, layout: page.layout })) });
    } else if (source.native?.kind === 'video') {
        const project = await getVideoEditorV2Project(source.native.projectId);
        if (!project) throw new Error('来源作品不存在');
        draft.title = project.title;
        if (project.dreamStory) { draft.brief = project.dreamStory.fragments.map(fragment => fragment.text).join('\n'); draft.body = project.dreamStory.director?.story || ''; }
        if (project.productVideo) {
            const value = project.productVideo;
            Object.assign(draft, { productId: value.productSnapshot.id, body: value.proposal.publicationCopy?.description || '', hashtags: value.proposal.publicationCopy?.hashtags || [],
                scenes: value.scenes.map(scene => { const clip = project.timeline.tracks.find(track => track.kind === 'primary-video')?.clips.find(item => item.sceneId === scene.id); const asset = project.assets.find(item => item.id === clip?.assetId); return { id: scene.id, title: scene.title, text: scene.overlayText || '', narration: scene.narrationText || '', visual: scene.generationPrompt || '', mediaMode: scene.source === 'ai-motion' ? 'ai-motion' : 'product-asset', durationMs: scene.durationMs, assetId: asset?.provenance?.sourceAssetId || '', sourceStartMs: clip?.sourceStartMs || 0, sourceVolume: clip?.volume ?? 1 }; }) });
        }
    }
    return CreationDraftSchema.parse(draft);
}
export async function inspectCreationWorkspace(id: string) {
    const workspace = await readCreationWorkspace(id); let native: unknown = null;
    if (workspace.native?.kind === 'note') { const note = await getXhsNoteProject(workspace.native.path); native = { version: note.version, document: note.document }; }
    else if (workspace.native?.kind === 'video') { native = await getVideoEditorV2Project(workspace.native.projectId); if (!native) throw new Error('来源工程不存在'); }
    const contentVersion = createHash('sha256').update(JSON.stringify([1, workspace.spaceId, workspace.id, workspace.revision, workspace.draftEpoch, workspace.draft, workspace.native, native])).digest('hex');
    return { workspace, contentVersion };
}
export async function forkCreationWorkspace(id: string, input: unknown, guardInput?: unknown): Promise<CreationWorkspace> {
    const selection = CreationStartSchema.parse(input);
    const guard = guardInput === undefined ? undefined : CreationForkGuardSchema.parse(guardInput);
    CreationTurnSchema.shape.workspaceId.parse(id);
    if (guard && !selection.requestId) throw new Error('带版本保护的复制需要请求 ID');
    const execute = async () => {
        if (guard) {
            const targetId = creationWorkspaceIdForRequest(getWorkspacePaths().activeSpaceId, selection.requestId!);
            const previous = await readCreationWorkspace(targetId).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
            if (previous) {
                if (previous.sourceId === id && previous.sourceRevision === guard.expectedRevision && previous.sourceContentVersion === guard.contentVersion
                    && previous.startDigest === createHash('sha256').update(JSON.stringify(selection)).digest('hex')) return previous;
                throw new Error('复制未完整完成或请求冲突；已保留草稿，请人工复核，不会重复复制');
            }
        }
        const source = await readCreationWorkspace(id);
        const assertSource = async () => {
            if (!guard) return;
            const current = await inspectCreationWorkspace(id);
            if (current.workspace.revision !== guard.expectedRevision || current.workspace.draftEpoch !== guard.expectedDraftEpoch || current.contentVersion !== guard.contentVersion) throw new Error('来源内容或版本已变化，请重新核对复制范围');
        };
        await assertSource();
        const draft = await latestCreationDraft(source);
        let prepared: Parameters<typeof startCreationWorkspace>[1];
        if (source.capability === selection.capability && source.native?.kind === 'video') {
            const project = await getVideoEditorV2Project(source.native.projectId); if (!project) throw new Error('来源作品不存在');
            if (project.productVideo) {
                const target = resolveProductCreationTarget({ platform: selection.platform, contentKind: 'video', compositionMode: selection.capability === 'product-remix' ? 'existing-clips' : 'product-images', aspectRatio: selection.platform === 'xiaohongshu' && project.canvas.aspectRatio === '16:9' ? '16:9' : '9:16' });
                const copy = await createProductTargetVariant({ sourceProjectId: project.id, expectedUpdatedAt: project.updatedAt, target, duplicate: true });
                prepared = { native: { kind: 'video', projectId: copy.id }, sessionId: (await getProductProjectEditorSession({ kind: 'video', projectId: copy.id })).sessionId };
            } else if (project.dreamStory) {
                const doc = project.dreamStory;
                const copy = await copyDreamStoryTarget({ spaceId: source.spaceId, projectId: project.id, requestId: randomUUID(), expectedRevision: doc.revision, expectedDraftEpoch: doc.draftEpoch, targetDigest: doc.targetDigest, target: resolveDreamStoryTarget(doc.target || {}) });
                prepared = { native: { kind: 'video', projectId: copy.id }, sessionId: (await getDreamSession(copy.id)).sessionId };
            }
        }
        const next = await startCreationWorkspace(selection, prepared);
        next.sourceId = source.id;
        next.draft = CreationDraftSchema.parse({ ...next.draft, title: draft.title, brief: draft.brief, body: draft.body, hashtags: draft.hashtags, productId: draft.productId,
            ...(source.capability === next.capability ? { scenes: draft.scenes, pages: draft.pages, sourceAssetIds: draft.sourceAssetIds } : {}) });
        if (next.native?.kind === 'note') {
            const note = await getXhsNoteProject(next.native.path);
            let content = { ...note.document, finalTitle: draft.title, body: draft.body, hashtags: draft.hashtags };
            if (source.native?.kind === 'note' && source.capability === next.capability) {
                const original = await getXhsNoteProject(source.native.path);
                content = { ...content, coverText: original.document.coverText, titleCandidates: original.document.titleCandidates, imagePages: original.document.imagePages, mediaSlots: original.document.mediaSlots, creationConfig: original.document.creationConfig, voiceover: original.document.voiceover, storyboard: original.document.storyboard, subtitles: original.document.subtitles };
            }
            await saveXhsNoteProject({ path: next.native.path, noteType: note.document.noteType, document: content, expectedRevision: note.version });
        }
        await assertSource();
        next.sourceRevision = source.revision;
        if (guard) next.sourceContentVersion = guard.contentVersion;
        return persist(next);
    };
    return guard ? locked('fork_' + selection.requestId, execute) : execute();
}
