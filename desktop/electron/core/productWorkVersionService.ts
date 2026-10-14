import { videoRenderFingerprint } from './video-editor-v2/videoPublicationPolicy';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getWorkspacePaths, runInWorkspaceSpace, getDouyinVideoVersionByProject, getTikTokVideoVersionByProject, insertDouyinVideoVersion, insertTikTokVideoVersion } from '../db';
import { cloneProductVideoProject, getVideoEditorV2Project, listVideoEditorV2Projects, updateProductWorkMetadata, enqueueProductProjectMutation } from './video-editor-v2/videoEditorV2ProjectStore';
import { getXhsNoteProject, saveXhsNoteProject } from './xhsNoteProjectStore';
import { ProductCreationTargetSchema, ProductVariantRequestSchema, productTargetKey, type ProductCreationTarget, type ProductWorkVariant } from '../../shared/productCreationTarget';
import type { VideoEditorV2Project } from '../../shared/videoAutoEdit';

const bindingLocks = new Map<string, Promise<VideoEditorV2Project>>();
const copyLocks = new Map<string, Promise<VideoEditorV2Project>>();

function legacyTarget(platform: ProductCreationTarget['platform'], project: VideoEditorV2Project, language = 'zh-CN', market = '中国'): ProductCreationTarget {
    return ProductCreationTargetSchema.parse({ platform, contentKind: 'video', compositionMode: project.productVideo?.proposal?.compositionMode || 'product-images', language, market,
        profileId: `legacy-${platform}-video`, profileVersion: 0, allowPaidMedia: false,
        spec: { width: project.canvas.width, height: project.canvas.height, aspectRatio: project.canvas.aspectRatio, fps: project.canvas.fps, format: 'mp4' } });
}

async function xhsBinding(project: VideoEditorV2Project): Promise<{ notePath?: string; ambiguous: boolean }> {
    const requested = project.workVersion?.publicationBinding;
    const paths = requested?.platform === 'xiaohongshu' ? [requested.notePath] : project.sourceManuscriptPath ? [project.sourceManuscriptPath] : [];
    if (!paths.length) {
        const root = path.join(getWorkspacePaths().manuscripts, 'xiaohongshu');
        for (const item of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
            if (item.isDirectory() && item.name.endsWith('.redvideo')) paths.push(`xiaohongshu/${item.name}`);
        }
    }
    const matches: string[] = [];
    for (const notePath of paths) {
        const note = await getXhsNoteProject(notePath).catch(() => null);
        if (note?.document.sourceVideoExport?.projectId === project.id || note?.document.workVersion?.versionId === project.id) matches.push(notePath);
    }
    return { notePath: matches.length === 1 ? matches[0] : undefined, ambiguous: matches.length > 1 };
}

function legacyWorkGroup(projectId: string, sourceId: string | undefined, spaceId: string): { workId: string; conflict: boolean } {
    if (!sourceId || sourceId === projectId) return { workId: projectId, conflict: false };
    const seen = new Set([projectId]);
    let workId = sourceId;
    while (!seen.has(workId)) {
        seen.add(workId);
        const dy = getDouyinVideoVersionByProject(workId, spaceId);
        const tk = getTikTokVideoVersionByProject(workId, spaceId);
        if (dy && tk) return { workId, conflict: true };
        const next = dy?.sourceProjectId || tk?.sourceProjectId;
        if (!next || next === workId) return { workId, conflict: false };
        workId = next;
    }
    return { workId: projectId, conflict: true };
}

/** Resolve only persisted platform records and explicit note links; never guess from titles or directory names. */
export async function resolveProductWorkVariant(project: VideoEditorV2Project): Promise<ProductWorkVariant> {
    const spaceId = getWorkspacePaths().activeSpaceId;
    const dy = getDouyinVideoVersionByProject(project.id, spaceId);
    const tk = getTikTokVideoVersionByProject(project.id, spaceId);
    const xhs = await xhsBinding(project);
    const notePath = xhs.notePath;
    const count = Number(Boolean(dy)) + Number(Boolean(tk)) + Number(Boolean(notePath));
    const target = project.creationTarget?.profileVersion ? ProductCreationTargetSchema.parse(project.creationTarget)
        : dy ? legacyTarget('douyin', project) : tk ? legacyTarget('tiktok', project, tk.language, tk.market) : notePath ? legacyTarget('xiaohongshu', project) : undefined;
    const binding = dy ? { platform: 'douyin' as const, versionId: dy.id } : tk ? { platform: 'tiktok' as const, versionId: tk.id } : notePath ? { platform: 'xiaohongshu' as const, notePath } : undefined;
    const sourceId = dy?.sourceProjectId || tk?.sourceProjectId;
    const group = project.workVersion ? { workId: project.workVersion.workId, conflict: false } : legacyWorkGroup(project.id, sourceId, spaceId);
    const conflict = xhs.ambiguous || group.conflict || count > 1 || Boolean(binding && project.creationTarget && binding.platform !== project.creationTarget.platform) || Boolean(binding && target && binding.platform !== target.platform)
        || Boolean(project.workVersion?.publicationBinding && JSON.stringify(project.workVersion.publicationBinding) !== JSON.stringify(binding));
    return { projectId: project.id, title: project.title, target,
        workVersion: project.workVersion || (binding ? { workId: group.workId, versionId: project.id, ...(sourceId && sourceId !== project.id ? { sourceVersionId: sourceId } : {}), publicationBinding: binding } : undefined),
        resolution: conflict ? 'conflict' : binding && target ? 'bound' : 'unbound' };
}

export async function assertProductPublicationTarget(project: VideoEditorV2Project, platform: ProductCreationTarget['platform']): Promise<ProductWorkVariant> {
    const variant = await resolveProductWorkVariant(project);
    if (variant.resolution !== 'bound' || variant.target?.platform !== platform || variant.target.contentKind !== 'video') throw new Error('发布目标与工程绑定不一致或尚未明确，请核对目标平台');
    if (project.workVersion?.copyReviewRequired) throw new Error('此副本的文案尚未按目标核对，请先编辑或核对目标文案');
    const spec = variant.target.spec;
    if (project.canvas.width !== spec.width || project.canvas.height !== spec.height || project.canvas.fps !== spec.fps || project.canvas.aspectRatio !== spec.aspectRatio) throw new Error('当前画幅与工程目标规格不一致，请重新适配并导出');
    return variant;
}

export function ensureProductVideoWorkBinding(project: VideoEditorV2Project): Promise<VideoEditorV2Project> {
    if (!project.creationTarget) return Promise.resolve(project);
    const spaceId = getWorkspacePaths().activeSpaceId;
    const key = `${spaceId}:${project.id}`;
    if (bindingLocks.has(key)) return bindingLocks.get(key)!;
    const promise = runInWorkspaceSpace(spaceId, async () => {
        let current = await getVideoEditorV2Project(project.id);
        if (!current?.productVideo || !current.creationTarget) throw new Error('目标商品工程不存在');
        const target = current.creationTarget;
        const copy = current.productVideo.proposal.publicationCopy;
        const existing = await resolveProductWorkVariant(current);
        if (existing.resolution === 'conflict') throw new Error('工程存在冲突的平台稿件关系');
        if (existing.resolution === 'bound' && current.workVersion?.publicationBinding) return current;
        if (!copy) throw new Error('目标商品工程缺少已确认的发布文案');
        const identity = current.workVersion || { workId: current.id, versionId: current.id };
        const now = Date.now();
        const hashtags = copy.hashtags.map(tag => tag.replace(/^#+/, ''));
        if (target.platform === 'douyin') {
            let version = getDouyinVideoVersionByProject(current.id, spaceId);
            if (!version) {
                version = { id: `dyver_${randomUUID()}`, spaceId, sourceProjectId: identity.workId, sourceProductId: current.productVideo.productSnapshot.id,
                    sourceProductUpdatedAt: current.productVideo.productSnapshot.updatedAt, projectId: current.id, title: copy.title, description: copy.description, hashtags, revision: 1, createdAt: now, updatedAt: now };
                insertDouyinVideoVersion(version);
            }
            current = { ...current, workVersion: { ...identity, publicationBinding: { platform: 'douyin', versionId: version.id } } };
        } else if (target.platform === 'tiktok') {
            let version = getTikTokVideoVersionByProject(current.id, spaceId);
            if (!version) {
                version = { id: `tkver_${randomUUID()}`, spaceId, sourceProjectId: identity.workId, sourceProductId: current.productVideo.productSnapshot.id,
                    sourceProductUpdatedAt: current.productVideo.productSnapshot.updatedAt, projectId: current.id, title: copy.title, description: copy.description, hashtags,
                    language: target.language, market: target.market, revision: 1, createdAt: now, updatedAt: now };
                insertTikTokVideoVersion(version);
            }
            current = { ...current, workVersion: { ...identity, publicationBinding: { platform: 'tiktok', versionId: version.id } } };
        } else {
            const notePath = existing.workVersion?.publicationBinding?.platform === 'xiaohongshu' ? existing.workVersion.publicationBinding.notePath : `xiaohongshu/video-${current.id}.redvideo`;
            const workVersion = { ...identity, publicationBinding: { platform: 'xiaohongshu' as const, notePath } };
            const note = await getXhsNoteProject(notePath).catch(() => null);
            if (note && note.document.workVersion?.versionId !== current.id && note.document.sourceVideoExport?.projectId !== current.id) throw new Error('小红书稿件绑定冲突');
            if (!note) await saveXhsNoteProject({ path: notePath, noteType: 'video', document: {
                creationTarget: target, workVersion, finalTitle: copy.title, body: copy.description, hashtags, aspectRatio: target.spec.aspectRatio, durationSeconds: current.timeline.durationMs / 1000,
                storyboard: current.productVideo.scenes.map((scene, index) => ({ id: scene.id, shot: String(index + 1), durationSeconds: scene.durationMs / 1000, visual: scene.title, voiceover: '', onScreenText: scene.overlayText || '' })),
                mediaSlots: [{ id: 'final-video', role: 'video', label: '商品视频', status: 'planned' }], generationStatus: 'draft',
            } });
            current = { ...current, sourceManuscriptPath: notePath, workVersion };
        }
        return updateProductWorkMetadata(current.id, { workVersion: current.workVersion, sourceManuscriptPath: current.sourceManuscriptPath || undefined });
    });
    bindingLocks.set(key, promise);
    void promise.finally(() => { if (bindingLocks.get(key) === promise) bindingLocks.delete(key); }).catch(() => undefined);
    return promise;
}

export async function syncProductVideoTargetExport(project: VideoEditorV2Project): Promise<void> {
    if (project.creationTarget?.platform !== 'xiaohongshu') return;
    await ensureProductVideoWorkBinding(project);
    return enqueueProductProjectMutation(project.id, async () => {
    const bound = await getVideoEditorV2Project(project.id);
    if (!bound || videoRenderFingerprint(bound) !== videoRenderFingerprint(project)) return;
    const binding = bound.workVersion?.publicationBinding;
    const output = bound.renderOutputs[0];
    if (binding?.platform !== 'xiaohongshu' || !output?.mediaAssetId || !output.renderFingerprint) return;
    const note = await getXhsNoteProject(binding.notePath);
    const exportRef = { projectId: bound.id, renderId: output.id, mediaAssetId: output.mediaAssetId, renderFingerprint: output.renderFingerprint };
    if (JSON.stringify(note.document.sourceVideoExport) === JSON.stringify(exportRef)) return;
    await saveXhsNoteProject({ path: binding.notePath, expectedRevision: note.version, trustedProductVideoState: true, document: { ...note.document,
        workVersion: bound.workVersion, sourceVideoExport: exportRef, durationSeconds: bound.timeline.durationMs / 1000,
        mediaSlots: [{ id: 'final-video', role: 'video', label: '商品视频', status: 'ready', assetId: output.mediaAssetId, mimeType: 'video/mp4', sourcePath: path.relative(getWorkspacePaths().media, output.path) }], generationStatus: 'generated',
    } });
    });
}

export function listProductWorkVariants(sourceProjectId: string): Promise<ProductWorkVariant[]> {
    return runInWorkspaceSpace(getWorkspacePaths().activeSpaceId, () => listProductWorkVariantsInSpace(sourceProjectId));
}

async function listProductWorkVariantsInSpace(sourceProjectId: string): Promise<ProductWorkVariant[]> {
    const source = await getVideoEditorV2Project(sourceProjectId);
    if (!source?.productVideo) throw new Error('商品工程不存在或不属于当前空间');
    const base = await resolveProductWorkVariant(source);
    const workId = base.workVersion?.workId || source.id;
    const variants = await Promise.all((await listVideoEditorV2Projects()).filter(project => project.productVideo).map(resolveProductWorkVariant));
    return variants.filter(variant => (variant.workVersion?.workId || variant.projectId) === workId);
}

export function createProductTargetVariant(raw: zInput): Promise<VideoEditorV2Project> {
    const input = ProductVariantRequestSchema.parse(raw);
    if (input.target.contentKind !== 'video' || input.target.profileVersion === 0) return Promise.reject(new Error('当前平台副本只支持已适配的视频目标'));
    const spaceId = getWorkspacePaths().activeSpaceId;
    const key = `${spaceId}:${input.sourceProjectId}:${productTargetKey(input.target)}`;
    if (!input.duplicate && copyLocks.has(key)) return copyLocks.get(key)!;
    const operation = runInWorkspaceSpace(spaceId, async () => {
        const source = await getVideoEditorV2Project(input.sourceProjectId);
        if (!source?.productVideo) throw new Error('来源商品工程不存在');
        if (source.updatedAt !== input.expectedUpdatedAt) throw new Error('来源工程已更新，请刷新后再复制');
        const base = await resolveProductWorkVariant(source);
        if (base.resolution === 'conflict') throw new Error('来源工程的平台关系冲突，请先核对');
        if (!input.duplicate) {
            const existing = (await listProductWorkVariants(source.id)).find(variant => variant.target?.platform === input.target.platform && variant.target.contentKind === input.target.contentKind && variant.target.spec.aspectRatio === input.target.spec.aspectRatio && variant.target.language === input.target.language && variant.target.market === input.target.market && variant.target.compositionMode === input.target.compositionMode);
            if (existing) return (await getVideoEditorV2Project(existing.projectId))!;
        }
        if (input.target.compositionMode !== (source.productVideo.proposal.compositionMode || 'product-images')) throw new Error('平台副本保留原工程的编排模式');
        let copy = source.productVideo.proposal.publicationCopy;
        const binding = base.workVersion?.publicationBinding;
        if (binding?.platform === 'douyin') {
            const version = getDouyinVideoVersionByProject(source.id, spaceId);
            if (version) copy = { title: version.title, description: version.description || source.productVideo.productSnapshot.name, hashtags: version.hashtags };
        } else if (binding?.platform === 'tiktok') {
            const version = getTikTokVideoVersionByProject(source.id, spaceId);
            if (version) copy = { title: version.title, description: version.description || source.productVideo.productSnapshot.name, hashtags: version.hashtags };
        } else if (binding?.platform === 'xiaohongshu') {
            const note = await getXhsNoteProject(binding.notePath);
            copy = { title: note.document.finalTitle, description: note.document.body || source.productVideo.productSnapshot.name, hashtags: note.document.hashtags };
        }
        copy ||= { title: source.title, description: source.productVideo.productSnapshot.name, hashtags: [] };
        if (input.target.platform === 'xiaohongshu') copy = { ...copy, title: copy.title.slice(0, 20) };
        const clone = await cloneProductVideoProject(source.id, `${source.title} · ${input.target.platform}`, undefined, { creationTarget: input.target, expectedUpdatedAt: input.expectedUpdatedAt, workId: base.workVersion?.workId || source.id, publicationCopy: copy });
        return ensureProductVideoWorkBinding(clone);
    });
    if (!input.duplicate) copyLocks.set(key, operation);
    void operation.finally(() => { if (copyLocks.get(key) === operation) copyLocks.delete(key); }).catch(() => undefined);
    return operation;
}
type zInput = import('zod').z.input<typeof ProductVariantRequestSchema>;

export function reviewProductVariantCopy(input: { projectId: string; expectedUpdatedAt: string; confirmed: true }): Promise<VideoEditorV2Project> {
    return runInWorkspaceSpace(getWorkspacePaths().activeSpaceId, () => reviewProductVariantCopyInSpace(input));
}

async function reviewProductVariantCopyInSpace(input: { projectId: string; expectedUpdatedAt: string; confirmed: true }): Promise<VideoEditorV2Project> {
    if (input.confirmed !== true) throw new Error('请明确确认目标文案');
    const project = await getVideoEditorV2Project(input.projectId);
    if (!project?.workVersion || project.updatedAt !== input.expectedUpdatedAt) throw new Error('工程已更新，请刷新后核对');
    return updateProductWorkMetadata(project.id, { expectedUpdatedAt: input.expectedUpdatedAt, workVersion: { ...project.workVersion, copyReviewRequired: false } });
}

/** Explicitly adopt an unbound legacy project without changing its canvas or rendered layout. */
export function bindLegacyProductWorkTarget(raw: zInput): Promise<VideoEditorV2Project> {
    return runInWorkspaceSpace(getWorkspacePaths().activeSpaceId, () => bindLegacyProductWorkTargetInSpace(raw));
}

async function bindLegacyProductWorkTargetInSpace(raw: zInput): Promise<VideoEditorV2Project> {
    const input = ProductVariantRequestSchema.parse(raw);
    const project = await getVideoEditorV2Project(input.sourceProjectId);
    if (!project?.productVideo || project.updatedAt !== input.expectedUpdatedAt) throw new Error('工程已更新或不存在，请刷新后绑定');
    const resolved = await resolveProductWorkVariant(project);
    if (resolved.resolution !== 'unbound' || project.creationTarget) throw new Error('已有明确目标或关系冲突，请创建独立平台版本');
    if (input.target.contentKind !== 'video' || (input.target.platform !== 'xiaohongshu' && project.canvas.aspectRatio !== '9:16')) throw new Error('当前画幅不适合所选平台，请创建适配版本');
    const target = legacyTarget(input.target.platform, project, input.target.language, input.target.market);
    const publicationCopy = project.productVideo.proposal.publicationCopy || { title: project.title.slice(0, input.target.platform === 'xiaohongshu' ? 20 : 200), description: project.productVideo.productSnapshot.name, hashtags: [] };
    return ensureProductVideoWorkBinding(await updateProductWorkMetadata(project.id, { expectedUpdatedAt: input.expectedUpdatedAt, creationTarget: target, publicationCopy }));
}
