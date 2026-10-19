import { recordCreationMetric } from './creationMetrics';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getWorkspacePaths, runInWorkspaceSpace } from '../db';
import { CARD_WIDTH, CARD_HEIGHT, CardStyleSchema, NoteCardContentSchema } from '../../shared/noteCards';
import { cardAssetIds, cardFingerprint, renderCardHtml } from '../../shared/cardRenderer';
import { listMediaAssets, getAbsoluteMediaPath } from './mediaLibraryStore';
import { getPageImageFontCss, pageImageDataUrl, renderPageImagePng } from './pageImageRenderer';
import { readNoteCard } from './noteCardEditor';
import { isPathWithinRoots, toAppAssetUrl } from './localAssetManager';
import { writeXhsMaterialZip } from './xhsMaterialZip';

export const CardRenderRequestSchema = z.object({ path: z.string().min(1).max(2000), expectedRevision: z.number().int().nonnegative(), pageId: z.string().max(160).optional(), format: z.enum(['png', 'directory', 'zip']).optional() }).strict();
interface RenderRecord { fingerprint: string; file: string; sha256?: string; error?: string; }
export async function readNoteCardOutputs(inputPath: string) {
    const snapshot = await readNoteCard(inputPath);
    const directory = path.join(snapshot.projectPath, 'cache');
    let record: Record<string, RenderRecord> = {};
    try { record = JSON.parse(await fs.readFile(path.join(directory, 'card-renders.json'), 'utf8')); } catch { /* No outputs yet. */ }
    const outputs: Record<string, { state: 'ready' | 'stale' | 'missing' | 'failed'; previewUrl?: string; error?: string }> = {};
    for (const page of snapshot.content.imagePages) {
        const previous = record[page.id]; if (!previous) continue;
        try {
            const real = await fs.realpath(previous.file);
            if (!isPathWithinRoots(real, [await fs.realpath(directory)]) || !isPathWithinRoots(real, [await fs.realpath(snapshot.projectPath)])) throw new Error('导出引用不属于当前作品');
            const bytes = await fs.readFile(real); if (previous.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('导出图片损坏');
            const model = renderModel(snapshot, page);
            const { hashes } = await assetsFor(model, false);
            outputs[page.id] = { state: previous.error ? 'failed' : previous.fingerprint === cardFingerprint(model, snapshot.content.creationConfig, hashes) ? 'ready' : 'stale', previewUrl: toAppAssetUrl(real), error: previous.error };
        } catch (error) { outputs[page.id] = { state: 'missing', error: String(error) }; }
    }
    return { ...snapshot, outputs };
}
function renderModel(snapshot: Awaited<ReturnType<typeof readNoteCard>>, page: Awaited<ReturnType<typeof readNoteCard>>['content']['imagePages'][number]) {
    const legacyAsset = !page.blocks && snapshot.document.mediaSlots.find(slot => slot.id === page.mediaSlotId)?.assetId;
    return legacyAsset ? { ...page, title: '', layout: 'legacy', blocks: [{ type: 'image' as const, assetId: legacyAsset, fit: 'contain' as const, x: 50, y: 50 }] } : page;
}
async function assetsFor(page: Parameters<typeof cardAssetIds>[0], includeData = true) {
    const assets = await listMediaAssets(10000); const sources: Record<string, string> = {}; const hashes: Record<string, string> = {};
    for (const id of cardAssetIds(page)) {
        const asset = assets.find(asset => asset.id === id); if (!asset?.relativePath) throw new Error(`图片 ${id} 缺失`);
        const candidate = await fs.realpath(getAbsoluteMediaPath(asset.relativePath));
        const root = await fs.realpath(getWorkspacePaths().media);
        if (!isPathWithinRoots(candidate, [root])) throw new Error(`图片 ${id} 不属于当前空间`);
        const bytes = await fs.readFile(candidate); hashes[id] = createHash('sha256').update(bytes).digest('hex'); if (includeData) sources[id] = await pageImageDataUrl(candidate);
    }
    return { sources, hashes };
}
export async function previewNoteCard(value: unknown) {
    const input = CardRenderRequestSchema.extend({ preview: z.object({ page: NoteCardContentSchema.innerType().shape.imagePages.element, style: CardStyleSchema }).strict().optional() }).parse(value);
    const { preview } = input;
    const snapshot = await readNoteCard(input.path);
    if (snapshot.version !== input.expectedRevision) throw new Error('预览版本已变化，请保存或刷新');
    const requested = preview?.page || snapshot.content.imagePages.find(page => page.id === input.pageId);
    const page = requested && renderModel(snapshot, requested as typeof snapshot.content.imagePages[number]);
    if (!page || page.id !== input.pageId) throw new Error('页面不存在');
    const { sources, hashes } = await assetsFor(page);
    const config = { ...snapshot.content.creationConfig, style: preview ? CardStyleSchema.parse(preview.style) : snapshot.content.creationConfig.style };
    return { html: renderCardHtml(page, config, sources, await getPageImageFontCss()), fingerprint: cardFingerprint(page, config, hashes) };
}
async function renderPage(input: z.infer<typeof CardRenderRequestSchema>, record: Record<string, RenderRecord>) {
    const snapshot = await readNoteCard(input.path); const requested = snapshot.content.imagePages.find(page => page.id === input.pageId);
    const page = requested && renderModel(snapshot, requested);
    if (!page) throw new Error('页面不存在');
    if (snapshot.version !== input.expectedRevision) throw new Error('作品已变化，请保存后重试');
    if (!page.blocks) throw new Error('旧版页面仍为图文方案，请选择模板后导出图片，或绑定原有图片');
    if (!page.title.trim() && !(page.blocks?.length ? page.copy.trim() || cardAssetIds(page).length : page.copy.trim())) throw new Error('页面内容为空');
    const { sources, hashes } = await assetsFor(page); const fingerprint = cardFingerprint(page, snapshot.content.creationConfig, hashes);
    const directory = path.join(snapshot.projectPath, 'cache');
    await fs.mkdir(directory, { recursive: true });
    if (!isPathWithinRoots(await fs.realpath(directory), [await fs.realpath(snapshot.projectPath)])) throw new Error('缓存目录不属于当前作品');
    const old = record[page.id];
    if (old?.fingerprint === fingerprint && !old.error && path.dirname(old.file) === directory) {
        try { const real = await fs.realpath(old.file); if (isPathWithinRoots(real, [directory])) { const bytes = await fs.readFile(real); if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && old.sha256 === createHash('sha256').update(bytes).digest('hex')) return old.file; } } catch { /* Regenerate a missing cached output. */ }
    }
    const bytes = await renderPageImagePng(renderCardHtml(page, snapshot.content.creationConfig, sources, await getPageImageFontCss()), directory, { width: CARD_WIDTH, height: CARD_HEIGHT }, 'card');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('页面渲染未返回有效 PNG');
    const current = await readNoteCard(input.path);
    const latestPage = current.content.imagePages.find(item => item.id === page.id);
    const latest = latestPage && renderModel(current, latestPage);
    if (!latest || cardFingerprint(latest, current.content.creationConfig, (await assetsFor(latest)).hashes) !== fingerprint) throw new Error('渲染期间页面已修改，请重试');
    const target = path.join(directory, `card-${randomUUID()}.png`); await fs.writeFile(target, bytes);
    record[page.id] = { fingerprint, file: target, sha256: createHash('sha256').update(bytes).digest('hex') }; return target;
}
const exportLocks = new Map<string, Promise<unknown>>();
export async function exportNoteCards(input: z.infer<typeof CardRenderRequestSchema> & { outputPath: string }) {
    const spaceId = getWorkspacePaths().activeSpaceId;
    const key = spaceId + ':' + path.resolve(getWorkspacePaths().manuscripts, input.path.replace(/^manuscripts:\/\//, ''));
    const operation = (exportLocks.get(key) || Promise.resolve()).catch(() => undefined).then(() => runInWorkspaceSpace(spaceId, async () => {
        const startedAt = Date.now();
        const { outputPath, ...request } = input; CardRenderRequestSchema.parse(request);
        const snapshot = await readNoteCard(input.path); if (snapshot.version !== input.expectedRevision) throw new Error('作品已变化，请保存后重试');
        const pages = input.format === 'png' ? snapshot.content.imagePages.filter(page => page.id === input.pageId) : snapshot.content.imagePages;
        if (!pages.length || pages.length > 20) throw new Error('请选择 1 至 20 页导出');
        const cacheRoot = path.join(snapshot.projectPath, 'cache');
        await fs.mkdir(cacheRoot, { recursive: true });
        if (!isPathWithinRoots(await fs.realpath(cacheRoot), [await fs.realpath(snapshot.projectPath)])) throw new Error('缓存目录不属于当前作品');
        const ledger = path.join(cacheRoot, 'card-renders.json'); let record: Record<string, RenderRecord> = {};
        try { record = JSON.parse(await fs.readFile(ledger, 'utf8')); } catch { /* First export. */ }
        const files: Array<{ name: string; filePath: string }> = []; const failures: Array<{ pageId: string; index: number; error: string }> = [];
        for (const [index, page] of pages.entries()) {
            try { const filePath = await renderPage({ ...request, pageId: page.id }, record); files.push({ name: `${String(index + 1).padStart(2, '0')}.png`, filePath }); }
            catch (error) { failures.push({ pageId: page.id, index: page.index, error: String(error) }); if (record[page.id]) record[page.id].error = String(error); }
        }
        await fs.mkdir(path.dirname(ledger), { recursive: true }); await fs.writeFile(ledger, JSON.stringify(record), { mode: 0o600 });
        if ((await readNoteCard(input.path)).version !== snapshot.version) failures.push({ pageId: '', index: 0, error: '导出期间作品发生修改，请重试' });
        if (failures.length) await recordCreationMetric('export.failed.' + snapshot.content.creationConfig.presetId, Date.now() - startedAt);
        if (failures.length) return { complete: false, failures, rendered: files.length, outputs: files.map(file => ({ name: file.name, previewUrl: toAppAssetUrl(file.filePath) })) };
        const copy = [snapshot.content.finalTitle, snapshot.content.body, snapshot.content.hashtags.map(tag => `#${tag}`).join(' ')].filter(Boolean).join('\n\n');
        const manifest = { schema: 'gardenflow-note-cards', version: 1, revision: snapshot.version, width: CARD_WIDTH, height: CARD_HEIGHT, pages: pages.map((page, index) => ({ id: page.id, file: files[index].name, sourceRefs: page.sourceRefs })), creationConfig: snapshot.content.creationConfig };
        if (input.format === 'png') await fs.copyFile(files[0].filePath, outputPath);
        else if (input.format === 'zip') await writeXhsMaterialZip(outputPath, [{ name: '发布文案.txt', content: copy }, { name: 'manifest.json', content: JSON.stringify(manifest, null, 2) }], files.map(file => ({ name: file.name, absolutePath: file.filePath })));
        else { await fs.mkdir(outputPath, { recursive: true }); for (const file of files) await fs.copyFile(file.filePath, path.join(outputPath, file.name)); await fs.writeFile(path.join(outputPath, '发布文案.txt'), copy); await fs.writeFile(path.join(outputPath, 'manifest.json'), JSON.stringify(manifest, null, 2)); }
        await recordCreationMetric('export.complete.' + snapshot.content.creationConfig.presetId, Date.now() - startedAt);
        return { complete: true, outputPath, failures: [], rendered: files.length };
    }));
    exportLocks.set(key, operation);
    void operation.finally(() => { if (exportLocks.get(key) === operation) exportLocks.delete(key); }).catch(() => undefined);
    return operation;
}
