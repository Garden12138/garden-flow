import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';
import { getWorkspacePaths } from '../db';
import {
    bindMediaAssetToManuscript,
    getAbsoluteMediaPath,
    listMediaAssets,
    type MediaAsset,
} from './mediaLibraryStore';
import { isPathWithinRoots, toAppAssetUrl } from './localAssetManager';
import { writeXhsMaterialZip } from './xhsMaterialZip';
import {
    applyXhsMediaSlotBinding,
    assertExpectedXhsRevision,
    createXhsNotePackageManifest,
    isXhsMediaCompatible,
    normalizeXhsNoteDocument,
    projectProductImageSetDocument,
    renderXhsNoteHtml,
    renderXhsNoteMarkdown,
    sanitizeXhsMaterialFileName,
    type XhsMaterialPackageResult,
    type XhsMediaSlot,
    type XhsNoteDocument,
    type XhsNotePackageAsset,
    type XhsNotePackageManifest,
    type XhsNoteProjectSnapshot,
    type XhsNoteType,
    uniqueXhsMaterialFileName,
} from '../../shared/xhsNote';

const XHS_NOTE_FILE = 'note.json';
const XHS_NOTE_DIRECTORY = 'xiaohongshu';

interface SaveXhsNoteInput {
    path?: string;
    noteType?: XhsNoteType;
    document: unknown;
    expectedRevision?: number;
    trustedProductImageSetState?: boolean;
}

interface BindXhsNoteMediaInput {
    path: string;
    slotId: string;
    assetId: string;
    expectedRevision?: number;
}

interface MarkXhsNoteMediaFailedInput {
    path: string;
    slotId: string;
    error: string;
}

interface ExportXhsMaterialPackageInput {
    path: string;
    outputPath?: string;
    allowExternalOutput?: boolean;
}

interface ResolvedProjectPath {
    absolutePath: string;
    relativePath: string;
    noteType: XhsNoteType;
}

interface ResolvedSlotAsset {
    slot: XhsMediaSlot;
    asset?: MediaAsset;
    absolutePath?: string;
    exists: boolean;
}

function normalizeRelativeProjectPath(value: string): string {
    const raw = String(value || '').trim().replace(/^manuscripts:\/\//i, '');
    if (!raw) throw new Error('小红书笔记工程路径为空');
    const normalized = path.normalize(raw).replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
        throw new Error('小红书笔记工程路径不合法');
    }
    return normalized;
}

function noteTypeFromProjectName(fileName: string): XhsNoteType | null {
    if (fileName.toLowerCase().endsWith('.redpost')) return 'image';
    if (fileName.toLowerCase().endsWith('.redvideo')) return 'video';
    return null;
}

function resolveProjectPath(inputPath: string): ResolvedProjectPath {
    const manuscriptsRoot = path.resolve(getWorkspacePaths().manuscripts);
    const raw = String(inputPath || '').trim();
    const absolutePath = path.isAbsolute(raw)
        ? path.resolve(path.normalize(raw))
        : path.resolve(manuscriptsRoot, normalizeRelativeProjectPath(raw));
    if (!isPathWithinRoots(absolutePath, [manuscriptsRoot])) {
        throw new Error('小红书笔记工程路径超出当前稿件目录');
    }
    if (fsSync.existsSync(manuscriptsRoot)) {
        let ancestor = absolutePath;
        while (!fsSync.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
        if (!isPathWithinRoots(fsSync.realpathSync(ancestor), [fsSync.realpathSync(manuscriptsRoot)])) throw new Error('小红书工程路径不能通过符号链接访问空间外文件');
    }
    const noteType = noteTypeFromProjectName(path.basename(absolutePath));
    if (!noteType) {
        throw new Error('小红书笔记工程必须使用 .redpost 或 .redvideo');
    }
    return {
        absolutePath,
        relativePath: path.relative(manuscriptsRoot, absolutePath).replace(/\\/g, '/'),
        noteType,
    };
}

function sanitizeFileStem(value: string): string {
    const normalized = String(value || '')
        .normalize('NFKC')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.\s-]+|[.\s-]+$/g, '')
        .slice(0, 64);
    return normalized || `小红书笔记-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
}

function createDefaultProjectPath(noteType: XhsNoteType, documentInput: unknown): ResolvedProjectPath {
    const document = normalizeXhsNoteDocument(documentInput, noteType);
    const extension = noteType === 'video' ? '.redvideo' : '.redpost';
    const baseName = sanitizeFileStem(document.finalTitle || document.coverText || '小红书笔记');
    const manuscriptsRoot = getWorkspacePaths().manuscripts;
    let relativePath = path.join(XHS_NOTE_DIRECTORY, `${baseName}${extension}`).replace(/\\/g, '/');
    let sequence = 2;
    while (fsSync.existsSync(path.join(manuscriptsRoot, relativePath))) {
        relativePath = path.join(XHS_NOTE_DIRECTORY, `${baseName}-${sequence}${extension}`).replace(/\\/g, '/');
        sequence += 1;
    }
    return resolveProjectPath(relativePath);
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T;
    } catch {
        return fallback;
    }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function createEmptyTimeline(title: string): Record<string, unknown> {
    return {
        OTIO_SCHEMA: 'Timeline.1',
        name: title,
        global_start_time: null,
        tracks: {
            OTIO_SCHEMA: 'Stack.1',
            children: [
                { OTIO_SCHEMA: 'Track.1', name: 'V1', kind: 'Video', children: [] },
                { OTIO_SCHEMA: 'Track.1', name: 'A1', kind: 'Audio', children: [] },
            ],
        },
        metadata: {
            owner: 'gardenflow',
            engine: 'ai-editing',
            version: 1,
            sourceRefs: [],
        },
    };
}

async function ensureCompatibilityFiles(project: ResolvedProjectPath, document: XhsNoteDocument): Promise<void> {
    const title = document.finalTitle || path.basename(project.absolutePath);
    const now = Date.now();
    const existingManifest = await readJsonFile<Record<string, unknown>>(path.join(project.absolutePath, 'manifest.json'), {});
    const manifest = {
        ...existingManifest,
        id: existingManifest.id || ulid(),
        type: 'manuscript-package',
        packageKind: project.noteType === 'video' ? 'video' : 'post',
        draftType: project.noteType === 'video' ? 'video' : 'richpost',
        contentModel: 'xhs-note-v1',
        platform: 'xiaohongshu',
        noteType: project.noteType,
        title,
        status: document.generationStatus === 'generated' ? 'completed' : 'writing',
        version: document.revision,
        createdAt: existingManifest.createdAt || now,
        updatedAt: now,
        entry: project.noteType === 'video' ? 'script.md' : 'content.md',
        note: XHS_NOTE_FILE,
        timeline: project.noteType === 'video' ? 'timeline.otio.json' : undefined,
    };
    await writeJsonFile(path.join(project.absolutePath, 'manifest.json'), manifest);
    const assetsPath = path.join(project.absolutePath, 'assets.json');
    if (!fsSync.existsSync(assetsPath)) await writeJsonFile(assetsPath, { items: [] });
    if (project.noteType === 'image') {
        if (!fsSync.existsSync(path.join(project.absolutePath, 'cover.json'))) {
            await writeJsonFile(path.join(project.absolutePath, 'cover.json'), { assetId: null });
        }
        if (!fsSync.existsSync(path.join(project.absolutePath, 'images.json'))) {
            await writeJsonFile(path.join(project.absolutePath, 'images.json'), { items: [] });
        }
        if (!fsSync.existsSync(path.join(project.absolutePath, 'layout.json'))) {
            await writeJsonFile(path.join(project.absolutePath, 'layout.json'), { cards: [] });
        }
    } else {
        if (!fsSync.existsSync(path.join(project.absolutePath, 'timeline.otio.json'))) {
            await writeJsonFile(path.join(project.absolutePath, 'timeline.otio.json'), createEmptyTimeline(title));
        }
        if (!fsSync.existsSync(path.join(project.absolutePath, 'storyboard.json'))) {
            await writeJsonFile(path.join(project.absolutePath, 'storyboard.json'), { scenes: [] });
        }
        if (!fsSync.existsSync(path.join(project.absolutePath, 'transcript.json'))) {
            await writeJsonFile(path.join(project.absolutePath, 'transcript.json'), { items: [] });
        }
    }
}

function persistedDocument(document: XhsNoteDocument): XhsNoteDocument {
    return {
        ...document,
        mediaSlots: document.mediaSlots.map((slot) => ({
            ...slot,
            previewUrl: undefined,
        })),
    };
}

function mediaMarkdownPaths(project: ResolvedProjectPath, document: XhsNoteDocument): Record<string, string> {
    const mediaRoot = path.resolve(getWorkspacePaths().media);
    return Object.fromEntries(document.mediaSlots
        .filter((slot) => slot.status === 'ready' && slot.sourcePath)
        .map((slot) => {
            const absolutePath = path.resolve(getAbsoluteMediaPath(String(slot.sourcePath)));
            if (!isPathWithinRoots(absolutePath, [mediaRoot])) return null;
            return [slot.id, path.relative(project.absolutePath, absolutePath).replace(/\\/g, '/')];
        })
        .filter((entry): entry is [string, string] => Boolean(entry)));
}

async function writeDocumentProjection(project: ResolvedProjectPath, document: XhsNoteDocument): Promise<void> {
    const stored = persistedDocument(document);
    const tempPath = path.join(project.absolutePath, `${XHS_NOTE_FILE}.tmp`);
    await writeJsonFile(tempPath, stored);
    await fs.rename(tempPath, path.join(project.absolutePath, XHS_NOTE_FILE));
    const markdown = renderXhsNoteMarkdown(stored, mediaMarkdownPaths(project, stored));
    await fs.writeFile(path.join(project.absolutePath, 'content.md'), markdown, 'utf-8');
    if (project.noteType === 'video') {
        await fs.writeFile(path.join(project.absolutePath, 'script.md'), markdown, 'utf-8');
    }
    await ensureCompatibilityFiles(project, stored);
}

async function readStoredDocument(project: ResolvedProjectPath): Promise<XhsNoteDocument> {
    const notePath = path.join(project.absolutePath, XHS_NOTE_FILE);
    let raw: unknown;
    try {
        raw = JSON.parse(await fs.readFile(notePath, 'utf-8'));
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            throw new Error('该目录不是有效的 GardenFlow 小红书工程：缺少 note.json');
        }
        throw new Error(`读取 note.json 失败：${error instanceof Error ? error.message : String(error)}`);
    }
    return normalizeXhsNoteDocument(raw, project.noteType);
}

async function resolveSlotAssets(document: XhsNoteDocument): Promise<ResolvedSlotAsset[]> {
    const catalog = await listMediaAssets(10000);
    const byId = new Map(catalog.map((asset) => [asset.id, asset]));
    const mediaRoot = path.resolve(getWorkspacePaths().media);
    return document.mediaSlots.map((slot) => {
        const asset = slot.assetId ? byId.get(slot.assetId) : undefined;
        const candidatePath = asset?.relativePath ? path.resolve(getAbsoluteMediaPath(asset.relativePath)) : undefined;
        const absolutePath = candidatePath && isPathWithinRoots(candidatePath, [mediaRoot]) ? candidatePath : undefined;
        return {
            slot,
            asset,
            absolutePath,
            exists: Boolean(absolutePath && fsSync.existsSync(absolutePath) && fsSync.statSync(absolutePath).isFile()),
        };
    });
}

async function hydratePreviewUrls(document: XhsNoteDocument): Promise<XhsNoteDocument> {
    const resolved = await resolveSlotAssets(document);
    return projectProductImageSetDocument({
        ...document,
        mediaSlots: resolved.map(({ slot, asset, absolutePath, exists }) => ({
            ...slot,
            sourcePath: asset?.relativePath || slot.sourcePath,
            mimeType: asset?.mimeType || slot.mimeType,
            previewUrl: exists && absolutePath ? toAppAssetUrl(absolutePath) : undefined,
            status: slot.assetId ? (exists ? slot.status === 'stale' ? 'stale' : 'ready' : 'missing') : slot.status,
        })),
    });
}

function toSnapshot(project: ResolvedProjectPath, document: XhsNoteDocument): XhsNoteProjectSnapshot {
    return {
        artifactType: 'xiaohongshu-note',
        noteType: document.noteType,
        projectPath: project.absolutePath,
        relativePath: project.relativePath,
        uri: `manuscripts://${project.relativePath}`,
        version: document.revision,
        document,
    };
}

export async function getXhsNoteProject(inputPath: string): Promise<XhsNoteProjectSnapshot> {
    const project = resolveProjectPath(inputPath);
    const document = await hydratePreviewUrls(await readStoredDocument(project));
    return toSnapshot(project, document);
}

async function saveXhsNoteProjectUnlocked(input: SaveXhsNoteInput): Promise<XhsNoteProjectSnapshot> {
    const requestedType: XhsNoteType = input.noteType === 'video' ? 'video' : 'image';
    const project = input.path ? resolveProjectPath(input.path) : createDefaultProjectPath(requestedType, input.document);
    if (input.noteType && project.noteType !== input.noteType) {
        throw new Error('笔记类型与工程扩展名不一致');
    }

    let current: XhsNoteDocument | null = null;
    const projectExists = fsSync.existsSync(project.absolutePath);
    if (projectExists && (!input.trustedProductImageSetState || fsSync.existsSync(path.join(project.absolutePath, XHS_NOTE_FILE)))) {
        current = await readStoredDocument(project);
        if (current.productImageSet && !input.trustedProductImageSetState && input.expectedRevision === undefined) throw new Error('商品套图保存必须提供 expectedRevision，请先读取最新工程');
        assertExpectedXhsRevision(current.revision, input.expectedRevision);
    }

    const mergedInput: Record<string, unknown> = current
        ? { ...current, ...asDocumentRecord(input.document), noteType: project.noteType }
        : { ...asDocumentRecord(input.document), noteType: project.noteType };
    if (!input.trustedProductImageSetState && (current?.productImageSet || mergedInput.productImageSet)) {
        const requested = asDocumentRecord(mergedInput.productImageSet);
        const existing = current?.productImageSet;
        if (!existing || ['version', 'proposalId', 'spaceId', 'productSnapshot', 'assets', 'generationHistory'].some((key) =>
            JSON.stringify(requested[key]) !== JSON.stringify((existing as unknown as Record<string, unknown>)[key]))) {
            throw new Error('商品快照和工程素材只能通过套图工具修改');
        }
        const pages = Array.isArray(requested.pages) ? requested.pages.map(asDocumentRecord) : [];
        for (const page of pages) {
            const old = existing.pages.find((item) => item.id === page.id);
            if (JSON.stringify(page.render) !== JSON.stringify(old?.render) || JSON.stringify(page.generation) !== JSON.stringify(old?.generation)) {
                throw new Error('页面生成和导出记录只能通过套图工具修改');
            }
        }
    }
    const normalized = normalizeXhsNoteDocument(mergedInput, project.noteType);
    const now = new Date().toISOString();
    const nextDocument: XhsNoteDocument = {
        ...normalized,
        revision: (current?.revision || 0) + 1,
        createdAt: current?.createdAt || normalized.createdAt || now,
        updatedAt: now,
    };

    await fs.mkdir(project.absolutePath, { recursive: true });
    await fs.mkdir(path.join(project.absolutePath, 'cache'), { recursive: true });
    await fs.mkdir(path.join(project.absolutePath, 'exports'), { recursive: true });
    await writeDocumentProjection(project, nextDocument);
    return toSnapshot(project, await hydratePreviewUrls(nextDocument));
}

function asDocumentRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

async function bindXhsNoteMediaUnlocked(input: BindXhsNoteMediaInput): Promise<XhsNoteProjectSnapshot> {
    const project = resolveProjectPath(input.path);
    const current = await readStoredDocument(project);
    assertExpectedXhsRevision(current.revision, input.expectedRevision);
    const slot = current.mediaSlots.find((item) => item.id === input.slotId);
    if (!slot) throw new Error(`媒体槽位不存在：${input.slotId}`);
    const asset = (await listMediaAssets(10000)).find((item) => item.id === input.assetId);
    if (!asset) throw new Error(`媒体素材不存在：${input.assetId}`);
    if (!asset.relativePath) throw new Error('该媒体素材尚无可绑定文件');
    const absoluteMediaPath = getAbsoluteMediaPath(asset.relativePath);
    if (!fsSync.existsSync(absoluteMediaPath)) throw new Error('该媒体素材文件不存在');
    if (!isXhsMediaCompatible(slot.role, asset.mimeType, asset.relativePath)) {
        throw new Error(slot.role === 'video'
            ? `槽位“${slot.label}”只支持视频素材`
            : `槽位“${slot.label}”只支持图片素材`);
    }

    const role = slot.role === 'cover' ? 'cover' : slot.role === 'image-page' ? 'image' : 'asset';
    await bindMediaAssetToManuscript({
        assetId: asset.id,
        manuscriptPath: project.relativePath,
        role,
    });

    const now = new Date().toISOString();
    const boundDocument = applyXhsMediaSlotBinding(current, {
        slotId: slot.id,
        assetId: asset.id,
        sourcePath: asset.relativePath,
        mimeType: asset.mimeType,
        updatedAt: now,
    });
    const finalVideoSlot = boundDocument.mediaSlots.find((item) => item.id === 'final-video');
    const requiredSlots = boundDocument.noteType === 'video'
        ? finalVideoSlot
            ? [finalVideoSlot]
            : boundDocument.mediaSlots.filter((item) => item.role === 'video')
        : boundDocument.mediaSlots.filter((item) => item.role === 'cover' || item.role === 'image-page');
    const allRequiredSlotsReady = requiredSlots.length > 0
        && requiredSlots.every((item) => item.status === 'ready');
    const nextDocument: XhsNoteDocument = {
        ...boundDocument,
        revision: current.revision + 1,
        generationStatus: allRequiredSlotsReady ? 'generated' : 'generating',
        generationError: allRequiredSlotsReady ? undefined : boundDocument.generationError,
    };
    await writeDocumentProjection(project, nextDocument);
    return toSnapshot(project, await hydratePreviewUrls(nextDocument));
}

export async function markXhsNoteMediaFailed(input: MarkXhsNoteMediaFailedInput): Promise<XhsNoteProjectSnapshot> {
    const project = resolveProjectPath(input.path);
    const current = await readStoredDocument(project);
    const slot = current.mediaSlots.find((item) => item.id === input.slotId);
    if (!slot) throw new Error(`媒体槽位不存在：${input.slotId}`);
    const error = String(input.error || '媒体生成失败').trim().slice(0, 2000) || '媒体生成失败';
    const now = new Date().toISOString();
    const nextDocument: XhsNoteDocument = {
        ...current,
        revision: current.revision + 1,
        updatedAt: now,
        generationStatus: 'failed',
        generationError: error,
        mediaSlots: current.mediaSlots.map((item) => item.id === slot.id
            ? {
                ...item,
                status: 'failed',
                error,
                updatedAt: now,
            }
            : item),
    };
    await writeDocumentProjection(project, nextDocument);
    return toSnapshot(project, await hydratePreviewUrls(nextDocument));
}

export async function exportXhsMaterialPackage(input: ExportXhsMaterialPackageInput): Promise<XhsMaterialPackageResult> {
    const project = resolveProjectPath(input.path);
    const document = await readStoredDocument(project);
    const resolvedSlots = await resolveSlotAssets(document);
    if (document.productImageSet && resolvedSlots.some((item) => !item.exists || item.slot.status !== 'ready')) throw new Error('套图含有缺失或过期页面，请使用套图导出入口重新渲染');
    const usedNames = new Set<string>();
    const assetPaths: Record<string, string> = {};
    const fileEntries: Array<{ name: string; absolutePath: string }> = [];
    const packageAssets: XhsNotePackageAsset[] = [];
    const warnings: string[] = [];

    for (const [index, resolved] of resolvedSlots.entries()) {
        const { slot, asset, absolutePath, exists } = resolved;
        if (asset && absolutePath && exists) {
            const fallbackExtension = slot.role === 'video' ? '.mp4' : '.png';
            const requestedName = document.productImageSet ? `${String(index + 1).padStart(2, '0')}-${slot.role === 'cover' ? '封面' : '内容页'}.png` : sanitizeXhsMaterialFileName(asset.relativePath || '', `${slot.id}${fallbackExtension}`);
            const fileName = uniqueXhsMaterialFileName(requestedName, usedNames);
            const archivePath = `assets/${fileName}`;
            assetPaths[slot.id] = archivePath;
            fileEntries.push({ name: archivePath, absolutePath });
            packageAssets.push({
                slotId: slot.id,
                role: slot.role,
                assetId: asset.id,
                file: archivePath,
                mimeType: asset.mimeType || slot.mimeType,
                status: 'ready',
            });
            continue;
        }

        const status = slot.assetId ? 'missing' : slot.status;
        packageAssets.push({
            slotId: slot.id,
            role: slot.role,
            assetId: slot.assetId,
            mimeType: slot.mimeType,
            status,
        });
        if (status !== 'empty') {
            warnings.push(`${slot.label}未包含可用文件${slot.assetId ? `（素材 ${slot.assetId}）` : ''}`);
        } else {
            warnings.push(`${slot.label}尚未生成`);
        }
    }

    const manifest = createXhsNotePackageManifest({ document, assets: packageAssets, warnings });
    const outputPath = path.resolve(input.outputPath || path.join(
        project.absolutePath,
        'exports',
        `${sanitizeFileStem(document.finalTitle || '小红书笔记')}-素材包.zip`,
    ));
    if (!input.allowExternalOutput && !isPathWithinRoots(outputPath, [project.absolutePath, getWorkspacePaths().base])) {
        throw new Error('素材包导出路径超出当前工作空间');
    }
    await writeXhsMaterialZip(outputPath, [
        { name: 'index.html', content: renderXhsNoteHtml(document, assetPaths) },
        { name: 'content.md', content: renderXhsNoteMarkdown(document, assetPaths) },
        { name: 'manifest.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
    ], fileEntries);
    return {
        kind: 'xiaohongshu-material-package',
        noteType: document.noteType,
        projectPath: project.absolutePath,
        relativePath: project.relativePath,
        uri: `manuscripts://${project.relativePath}`,
        version: document.revision,
        outputPath,
        outputUrl: toAppAssetUrl(outputPath),
        manifest,
    };
}

export function isStructuredXhsNoteProject(projectPath: string): boolean {
    try {
        const project = resolveProjectPath(projectPath);
        return fsSync.existsSync(path.join(project.absolutePath, XHS_NOTE_FILE));
    } catch {
        return false;
    }
}

const xhsMutationQueues = new Map<string, Promise<unknown>>();
function enqueueXhsMutation<T>(projectPath: string, operation: () => Promise<T>): Promise<T> {
    if (fsSync.existsSync(projectPath)) projectPath = fsSync.realpathSync(projectPath);
    const previous = xhsMutationQueues.get(projectPath) || Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    xhsMutationQueues.set(projectPath, pending);
    void pending.finally(() => { if (xhsMutationQueues.get(projectPath) === pending) xhsMutationQueues.delete(projectPath); }).catch(() => undefined);
    return pending;
}

export function saveXhsNoteProject(input: SaveXhsNoteInput): Promise<XhsNoteProjectSnapshot> {
    const project = input.path ? resolveProjectPath(input.path) : createDefaultProjectPath(input.noteType === 'video' ? 'video' : 'image', input.document);
    return enqueueXhsMutation(project.absolutePath, () => saveXhsNoteProjectUnlocked({ ...input, path: project.absolutePath }));
}

export function bindXhsNoteMedia(input: BindXhsNoteMediaInput): Promise<XhsNoteProjectSnapshot> {
    const project = resolveProjectPath(input.path);
    return enqueueXhsMutation(project.absolutePath, () => bindXhsNoteMediaUnlocked(input));
}

/** Merge asynchronous results under the same lock as editor saves. Never overwrite a stale document. */
export function mutateProductImageSetProject(inputPath: string, transform: (snapshot: XhsNoteProjectSnapshot) => void | Promise<void>): Promise<XhsNoteProjectSnapshot> {
    const project = resolveProjectPath(inputPath);
    return enqueueXhsMutation(project.absolutePath, async () => {
        const snapshot = await getXhsNoteProject(project.absolutePath);
        if (!snapshot.document.productImageSet) throw new Error('工程不是商品套图');
        await transform(snapshot);
        return saveXhsNoteProjectUnlocked({ path: project.absolutePath, document: snapshot.document, expectedRevision: snapshot.version, trustedProductImageSetState: true });
    });
}
