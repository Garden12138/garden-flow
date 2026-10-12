import { resolveDefaultImageEndpoint, resolveDefaultImageModel } from './imageGenerationService';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getWorkspacePaths, getSettings, runInWorkspaceSpace } from '../db';
import { createBrandWorkspaceStore } from './brandWorkspaceStore';
import { getXhsNoteProject, saveXhsNoteProject, mutateProductImageSetProject, exportXhsMaterialPackage } from './xhsNoteProjectStore';
import { createGeneratedMediaAsset, getAbsoluteMediaPath, listMediaAssets, bindMediaAssetToManuscript } from './mediaLibraryStore';
import { MediaGenerationJobRegistry } from './mediaGenerationJobRegistry';
import { getImageProviderCapabilities, normalizeImageProviderTemplate } from './imageProviderAdapters';
import { getProductImageFontCss, productImageDataUrl, renderProductImagePng } from './productImageRenderer';
import { isPathWithinRoots } from './localAssetManager';
import {
    ProductImageSetProposalSchema, ProductImageSetSchema, ProductImagePageSchema, ProductImageStyleSchema, productImageInputKey, productImageGenerationKey,
    ProductImagePageRequestSchema, ProductImagePreviewRequestSchema, ProductImageGenerateRequestSchema, ProductImageExportRequestSchema,
    productImageSlotId, renderProductImageHtml, type ProductImageSetProposal, type ProductImageSet,
    type ProductImagePageRequest, type ProductImageGenerateRequest, type ProductImagePreviewRequest,
} from '../../shared/productImageSet';
import { applyXhsMediaSlotBinding, assertExpectedXhsRevision, type XhsNoteProjectSnapshot } from '../../shared/xhsNote';

const renders = new Map<string, Promise<XhsNoteProjectSnapshot>>();
const generations = new Map<string, { requestId: string; promise: Promise<XhsNoteProjectSnapshot> }>();
const registries = new Map<string, MediaGenerationJobRegistry>();
const creations = new Map<string, { productId: string; promise: Promise<XhsNoteProjectSnapshot> }>();
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function operationKey(spaceId: string, input: ProductImagePageRequest): string {
    ProductImagePageRequestSchema.parse(input);
    const root = getWorkspacePaths().manuscripts;
    const absolute = path.resolve(root, input.path.replace(/^manuscripts:\/\//, ''));
    if (!absolute.toLowerCase().endsWith('.redpost') || !isPathWithinRoots(absolute, [root])) throw new Error('套图工程路径超出当前稿件目录或类型无效');
    return `${spaceId}:${fsSync.realpathSync(absolute)}:${input.pageId}`;
}

function requireSet(snapshot: XhsNoteProjectSnapshot): ProductImageSet {
    const set = ProductImageSetSchema.parse(snapshot.document.productImageSet);
    if (set.spaceId !== getWorkspacePaths().activeSpaceId) throw new Error('套图不属于当前空间');
    return set;
}

async function assetPath(snapshot: XhsNoteProjectSnapshot, asset: ProductImageSet['assets'][number]): Promise<string> {
    const root = path.join(snapshot.projectPath, 'sources');
    const absolute = path.resolve(snapshot.projectPath, asset.relativePath);
    if (!isPathWithinRoots(absolute, [root]) || !isPathWithinRoots(await fs.realpath(absolute), [await fs.realpath(root)])) throw new Error('工程素材路径无效');
    if (sha256(await fs.readFile(absolute)) !== asset.sha256) throw new Error('工程图片已在外部修改，请重新导入');
    return absolute;
}

function syncGenerationHistory(set: ProductImageSet): void {
    for (const page of set.pages) {
        if (!page.generation) continue;
        const index = set.generationHistory.findIndex((item) => item.requestId === page.generation!.requestId);
        const record = { ...set.generationHistory[index], ...page.generation, pageId: page.id };
        if (index < 0) set.generationHistory.push(record);
        else set.generationHistory[index] = record;
    }
}

function mutateSet(inputPath: string, transform: (set: ProductImageSet, snapshot: XhsNoteProjectSnapshot) => void | Promise<void>): Promise<XhsNoteProjectSnapshot> {
    return mutateProductImageSetProject(inputPath, async (snapshot) => {
        const set = requireSet(snapshot);
        await transform(set, snapshot);
        syncGenerationHistory(set);
        snapshot.document.productImageSet = set;
    });
}

async function mediaSource(assetId: string): Promise<string> {
    const asset = (await listMediaAssets(10000)).find((item) => item.id === assetId);
    if (!asset?.relativePath || !asset.mimeType?.startsWith('image/')) throw new Error('请选择当前空间的图片素材');
    const absolute = getAbsoluteMediaPath(asset.relativePath);
    if (!isPathWithinRoots(await fs.realpath(absolute), [await fs.realpath(getWorkspacePaths().media)])) throw new Error('媒体素材路径超出当前空间');
    return absolute;
}

export async function findProductImageSetByProposalId(proposalId: string): Promise<XhsNoteProjectSnapshot | null> {
    const root = path.join(getWorkspacePaths().manuscripts, 'xiaohongshu');
    const names = await fs.readdir(root).catch(() => [] as string[]);
    for (const name of names.filter((item) => item.endsWith('.redpost'))) {
        const snapshot = await getXhsNoteProject(path.join(root, name)).catch(() => null);
        if (!snapshot) continue;
        if (snapshot.document.productImageSet?.proposalId === proposalId) return snapshot;
    }
    return null;
}

export function createProductImageSet(input: ProductImageSetProposal): Promise<XhsNoteProjectSnapshot> {
    const spaceId = getWorkspacePaths().activeSpaceId;
    const key = `${spaceId}:${input.proposalId}`;
    const pending = creations.get(key);
    if (pending) return pending.productId === input.productId ? pending.promise : Promise.reject(new Error('提案 ID 已用于另一商品'));
    const operation = runInWorkspaceSpace(spaceId, () => createProductImageSetOnce(input));
    creations.set(key, { productId: input.productId, promise: operation });
    void operation.finally(() => creations.delete(key)).catch(() => undefined);
    return operation;
}

async function createProductImageSetOnce(input: ProductImageSetProposal): Promise<XhsNoteProjectSnapshot> {
    const proposal = ProductImageSetProposalSchema.parse(input);
    const existing = await findProductImageSetByProposalId(proposal.proposalId);
    if (existing) {
        if (existing.document.productImageSet?.productSnapshot.id !== proposal.productId) throw new Error('提案 ID 已用于另一商品');
        return existing;
    }
    const spaceId = getWorkspacePaths().activeSpaceId;
    const store = createBrandWorkspaceStore(() => path.join(getWorkspacePaths().subjects, 'brand-workspace'));
    return store.withProductCreativeSnapshot(proposal.productId, proposal.productUpdatedAt, async (product, sourceAssets, assertCurrent) => {
        const requested = new Set(proposal.pages.flatMap((page) => page.productAssetIds));
        const sourceMap = new Map(sourceAssets.map((asset) => [asset.assetId, asset.absolutePath]));
        for (const id of requested) if (!sourceMap.has(id)) throw new Error(`图片不属于所选商品：${id}`);
        const project = path.join(getWorkspacePaths().manuscripts, 'xiaohongshu', `商品套图-${randomUUID()}.redpost`);
        await fs.mkdir(path.join(project, 'sources'), { recursive: true });
        try {
            const assets: ProductImageSet['assets'] = [];
            for (const id of requested) {
                const bytes = await fs.readFile(sourceMap.get(id)!);
                const relativePath = `sources/${randomUUID()}${path.extname(sourceMap.get(id)!).toLowerCase()}`;
                await fs.writeFile(path.join(project, relativePath), bytes);
                assets.push({ id, relativePath, sha256: sha256(bytes), kind: 'product' });
            }
            assertCurrent();
            const set: ProductImageSet = { version: 1, proposalId: proposal.proposalId, spaceId, productSnapshot: { ...product }, assets, style: proposal.style, pages: proposal.pages, generationHistory: [] };
            return await saveXhsNoteProject({ path: project, noteType: 'image', document: { finalTitle: proposal.finalTitle, body: proposal.body, hashtags: proposal.hashtags, productImageSet: set }, trustedProductImageSetState: true });
        } catch (error) {
            await fs.rm(project, { recursive: true, force: true });
            throw error;
        }
    });
}

export function getProductImagePagePreview(input: ProductImagePreviewRequest): Promise<{ html: string }> {
    return runInWorkspaceSpace(getWorkspacePaths().activeSpaceId, () => getProductImagePagePreviewInSpace(input));
}

async function getProductImagePagePreviewInSpace(input: ProductImagePreviewRequest): Promise<{ html: string }> {
    ProductImagePreviewRequestSchema.parse(input);
    const snapshot = await getXhsNoteProject(input.path);
    assertExpectedXhsRevision(snapshot.version, input.expectedRevision);
    const set = requireSet(snapshot);
    let page = set.pages.find((item) => item.id === input.pageId);
    if (!page) throw new Error('页面不存在');
    if (input.preview) {
        page = ProductImagePageSchema.parse(input.preview.page);
        if (page.id !== input.pageId) throw new Error('预览页面 ID 不一致');
        set.style = ProductImageStyleSchema.parse(input.preview.style);
        ProductImageSetSchema.parse({ ...set, pages: set.pages.map((item) => item.id === page!.id ? page : item) });
    }
    const ids = page.backgroundAssetId ? [page.backgroundAssetId] : page.productAssetIds;
    const sources: Record<string, string> = {};
    for (const id of ids) {
        try { sources[id] = await productImageDataUrl(await assetPath(snapshot, set.assets.find((item) => item.id === id)!)); }
        catch (error) { throw new Error(`${page.role === 'cover' ? '封面' : page.title} · 图片 ${id}：${error instanceof Error ? error.message : String(error)}`); }
    }
    return { html: renderProductImageHtml(set, page, sources, await getProductImageFontCss()) };
}

export function renderProductImagePage(input: ProductImagePageRequest): Promise<XhsNoteProjectSnapshot> {
    const spaceId = getWorkspacePaths().activeSpaceId;
    const key = operationKey(spaceId, input);
    const existing = renders.get(key);
    if (existing) return existing;
    const operation = runInWorkspaceSpace(spaceId, async () => {
        let snapshot = await getXhsNoteProject(input.path);
        assertExpectedXhsRevision(snapshot.version, input.expectedRevision);
        const set = requireSet(snapshot);
        const page = set.pages.find((item) => item.id === input.pageId);
        if (!page) throw new Error('页面不存在');
        const inputKey = productImageInputKey(set, page);
        const slot = snapshot.document.mediaSlots.find((item) => item.id === productImageSlotId(page));
        if (page.render?.inputKey === inputKey && slot?.status === 'ready') return snapshot;
        const preview = await getProductImagePagePreview(input);
        const cache = path.join(snapshot.projectPath, 'cache');
        await fs.mkdir(cache, { recursive: true });
        if (!isPathWithinRoots(await fs.realpath(cache), [await fs.realpath(snapshot.projectPath)])) throw new Error('渲染缓存不能位于工程外');
        let bytes: Buffer;
        try { bytes = await renderProductImagePng(preview.html, cache); }
        catch (error) { throw new Error(`${page.role === 'cover' ? '封面' : page.title}：${error instanceof Error ? error.message : String(error)}`); }
        const asset = await createGeneratedMediaAsset({ prompt: '商品原图与可编辑文字排版', dataBuffer: bytes, mimeType: 'image/png', projectId: set.proposalId, provider: 'local-layout', title: `${snapshot.document.finalTitle} · ${page.title}`, aspectRatio: '3:4', size: '1440x1920' });
        return mutateSet(input.path, async (current, latest) => {
            const currentPage = current.pages.find((item) => item.id === page.id);
            if (!currentPage || productImageInputKey(current, currentPage) !== inputKey) throw new Error('页面在渲染期间已修改，已保留图片素材，请重新导出');
            currentPage.render = { inputKey, assetId: asset.id };
            await bindMediaAssetToManuscript({ assetId: asset.id, manuscriptPath: latest.relativePath, role: page.role === 'cover' ? 'cover' : 'image' });
            latest.document = applyXhsMediaSlotBinding(latest.document, { slotId: productImageSlotId(currentPage), assetId: asset.id, sourcePath: asset.relativePath!, mimeType: 'image/png', updatedAt: new Date().toISOString() });
        });
    });
    renders.set(key, operation);
    void operation.finally(() => renders.delete(key)).catch(() => undefined);
    return operation;
}

export function getProductImageGenerationConfig(): { configured: boolean; model: string; reason?: string; configurationKey: string } {
    const settings = getSettings() as unknown as Record<string, unknown>;
    const provider = String(settings.image_provider || 'openai-compatible');
    const template = normalizeImageProviderTemplate(String(settings.image_provider_template || ''), provider);
    const capability = getImageProviderCapabilities(template, provider);
    const model = String(settings.image_model || resolveDefaultImageModel(template));
    const configurationKey = sha256(Buffer.from(JSON.stringify({ provider, template, model, endpoint: settings.image_endpoint || settings.api_endpoint, key: settings.image_api_key || settings.api_key })));
    if (!capability.supportsReferenceImages || !capability.supportedModes.includes('reference-guided')) return { configured: false, model, configurationKey, reason: '当前图片模型不支持商品参考图，请在设置中选择支持参考图的模型' };
    if (!settings.image_api_key && !settings.api_key) return { configured: false, model, configurationKey, reason: '请先配置图片模型密钥' };
    return { configured: true, model: model || template, configurationKey };
}

export function generateProductImagePage(input: ProductImageGenerateRequest): Promise<XhsNoteProjectSnapshot> {
    const validated = ProductImageGenerateRequestSchema.safeParse(input);
    if (!validated.success) return Promise.reject(new Error(`请重新确认本页模型和版本：${validated.error.message}`));
    if (input.confirmed !== true || !input.requestId || input.requestId.length > 160) return Promise.reject(new Error('请确认本页的计费图片生成请求'));
    const spaceId = getWorkspacePaths().activeSpaceId;
    const key = operationKey(spaceId, input);
    const running = generations.get(key);
    if (running) return running.requestId === input.requestId ? running.promise : Promise.reject(new Error('本页已有生成请求，请等待完成后再提交新请求'));
    const operation = runInWorkspaceSpace(spaceId, async () => {
        let snapshot = await getXhsNoteProject(input.path);
        assertExpectedXhsRevision(snapshot.version, input.expectedRevision);
        const set = requireSet(snapshot);
        const page = set.pages.find((item) => item.id === input.pageId);
        if (!page) throw new Error('页面不存在');
        if (set.generationHistory.some((item) => item.requestId === input.requestId) || page.generation?.requestId === input.requestId) return snapshot;
        if (page.generation?.status === 'generating') throw new Error('本页已有生成请求，请检查执行记录后再提交');
        const config = getProductImageGenerationConfig();
        if (!config.configured) throw new Error(config.reason);
        if (input.reviewedConfigurationKey !== config.configurationKey) throw new Error('图片模型配置已改变，请刷新工程并重新确认模型和计费请求');
        if (!page.aiPrompt.trim()) throw new Error('请先填写本页的画面生成提示词');
        const settings = getSettings() as unknown as Record<string, unknown>;
        const provider = String(settings.image_provider || 'openai-compatible');
        const providerTemplate = normalizeImageProviderTemplate(String(settings.image_provider_template || ''), provider);
        const capability = getImageProviderCapabilities(providerTemplate, provider);
        if (page.productAssetIds.length > capability.maxReferenceImages) throw new Error(`当前模型最多支持 ${capability.maxReferenceImages} 张参考图，请减少本页素材`);
        const endpoint = String(settings.image_endpoint || ((providerTemplate === 'openai-images' || providerTemplate === 'openai-chat-completions-image') ? settings.api_endpoint : '') || resolveDefaultImageEndpoint(providerTemplate));
        if (!endpoint) throw new Error('请先配置图片模型地址');
        const executionConfig = { model: config.model, provider, providerTemplate, endpoint, apiKey: String(settings.image_api_key || settings.api_key) };
        const generationKey = productImageGenerationKey(set, page);
        const references = await Promise.all(page.productAssetIds.map((id) => assetPath(snapshot, set.assets.find((item) => item.id === id)!)));
        snapshot = await mutateSet(input.path, (current, latest) => {
            assertExpectedXhsRevision(latest.version, input.expectedRevision);
            const currentPage = current.pages.find((item) => item.id === page.id)!;
            currentPage.generation = { requestId: input.requestId, inputKey: generationKey, status: 'generating', startedAt: new Date().toISOString() };
        });
        let registry = registries.get(spaceId);
        if (!registry) { registry = new MediaGenerationJobRegistry(spaceId, 'product-image-jobs.json'); registries.set(spaceId, registry); }
        try {
            const submitted = await registry.submit('image', { ...executionConfig, prompt: `${page.aiPrompt}\n只生成画面，保留参考商品的外观和包装，不添加页面标题、说明文字或水印。`, generationMode: 'reference-guided', referenceImages: references, count: 1, aspectRatio: '3:4', size: '1536x2048', projectId: set.proposalId, manuscriptPath: snapshot.relativePath, clientRequestId: input.requestId, source: 'product-image-set' });
            await mutateSet(input.path, (current) => {
                const currentPage = current.pages.find((item) => item.id === page.id);
                const history = current.generationHistory.find((item) => item.requestId === input.requestId)!;
                history.jobId = submitted.jobId;
                if (currentPage?.generation?.requestId === input.requestId) currentPage.generation.jobId = submitted.jobId;
            });
            const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
                const finish = (error?: Error, result?: Record<string, unknown>) => {
                    registry!.off('job-updated', listener);
                    if (error) reject(error); else resolve(result || {});
                };
                const check = async () => {
                    const job = await registry!.getJob(submitted.jobId);
                    if (!job) finish(new Error('图片生成任务记录丢失'));
                    else if (job.status === 'completed') finish(undefined, job.result || {});
                    else if (['failed', 'cancelled', 'dead_lettered'].includes(job.status)) finish(new Error(job.attempt?.lastError || '图片生成失败'));
                };
                const listener = () => { void check().catch((error) => finish(error)); };
                registry!.on('job-updated', listener);
                listener();
            });
            const generated = (Array.isArray(result.assets) ? result.assets[0] : undefined) as { id?: string; absolutePath?: string; relativePath?: string } | undefined;
            if (!generated?.id || !generated.relativePath) throw new Error('图片模型未返回可用产物');
            const source = await mediaSource(generated.id);
            const bytes = await fs.readFile(source);
            const relativePath = `sources/${randomUUID()}${path.extname(source)}`;
            await fs.writeFile(path.join(snapshot.projectPath, relativePath), bytes);
            const newId = `ai-${generated.id}`;
            return mutateSet(input.path, (latestSet) => {
                const latestPage = latestSet.pages.find((item) => item.id === page.id);
                latestSet.assets.push({ id: newId, relativePath, sha256: sha256(bytes), kind: 'ai' });
                const history = latestSet.generationHistory.find((item) => item.requestId === input.requestId)!;
                history.status = 'succeeded';
                history.assetId = newId;
                if (latestPage?.generation?.requestId === input.requestId) {
                    latestPage.generation.status = 'succeeded';
                    if (productImageGenerationKey(latestSet, latestPage) === generationKey) latestPage.backgroundAssetId = newId;
                    else latestPage.generation.error = '生成期间页面已修改，画面已保存到素材列表，请手动选择';
                }
            });
        } catch (error) {
            await mutateSet(input.path, (latestSet) => {
                const latestPage = latestSet.pages.find((item) => item.id === page.id);
                const message = error instanceof Error ? error.message : String(error);
                const history = latestSet.generationHistory.find((item) => item.requestId === input.requestId);
                if (history) { history.status = 'failed'; history.error = message; }
                if (latestPage?.generation?.requestId === input.requestId) { latestPage.generation.status = 'failed'; latestPage.generation.error = message; }
            });
            throw error;
        }
    });
    generations.set(key, { requestId: input.requestId, promise: operation });
    void operation.finally(() => generations.delete(key)).catch(() => undefined);
    return operation;
}

export function recoverProductImageSet(inputPath: string): Promise<XhsNoteProjectSnapshot> {
    return runInWorkspaceSpace(getWorkspacePaths().activeSpaceId, () => recoverProductImageSetInSpace(inputPath));
}

async function recoverProductImageSetInSpace(inputPath: string): Promise<XhsNoteProjectSnapshot> {
    const snapshot = await getXhsNoteProject(inputPath);
    if (!snapshot.document.productImageSet) return snapshot;
    const set = requireSet(snapshot);
    let changed = false;
    for (const page of set.pages) {
        if (page.generation?.status === 'generating' && !generations.has(operationKey(set.spaceId, { path: snapshot.projectPath, pageId: page.id, expectedRevision: snapshot.version }))) {
            page.generation.status = 'interrupted';
            page.generation.error = '上次生成在应用退出时中断，请检查素材后手动重试；系统没有重新提交请求';
            changed = true;
        }
    }
    if (set.generationHistory.some((record) => record.status === 'generating' && !generations.has(operationKey(set.spaceId, { path: snapshot.projectPath, pageId: record.pageId, expectedRevision: snapshot.version })))) changed = true;
    return changed ? mutateSet(inputPath, (current) => {
        for (const page of current.pages) {
            const recovered = set.pages.find((item) => item.id === page.id);
            if (recovered?.generation?.status === 'interrupted' && page.generation?.requestId === recovered.generation.requestId) page.generation = recovered.generation;
        }
        for (const record of current.generationHistory) {
            if (record.status === 'generating' && !generations.has(operationKey(current.spaceId, { path: snapshot.projectPath, pageId: record.pageId, expectedRevision: snapshot.version }))) { record.status = 'interrupted'; record.error = '应用退出后未自动重投，请检查素材后手动重试'; }
        }
    }) : snapshot;
}

export function importProductImageAsset(input: ProductImagePageRequest & { assetId: string }): Promise<XhsNoteProjectSnapshot> {
    return runInWorkspaceSpace(getWorkspacePaths().activeSpaceId, () => importProductImageAssetInSpace(input));
}

async function importProductImageAssetInSpace(input: ProductImagePageRequest & { assetId: string }): Promise<XhsNoteProjectSnapshot> {
    ProductImagePageRequestSchema.extend({ assetId: ProductImagePageSchema.shape.id }).parse(input);
    const snapshot = await getXhsNoteProject(input.path);
    assertExpectedXhsRevision(snapshot.version, input.expectedRevision);
    const set = requireSet(snapshot);
    if (!set.pages.some((page) => page.id === input.pageId)) throw new Error('页面不存在');
    const source = await mediaSource(input.assetId);
    const bytes = await fs.readFile(source);
    const relativePath = `sources/${randomUUID()}${path.extname(source)}`;
    await fs.writeFile(path.join(snapshot.projectPath, relativePath), bytes);
    const id = `upload-${randomUUID()}`;
    return mutateSet(input.path, (current, latest) => {
        assertExpectedXhsRevision(latest.version, input.expectedRevision);
        current.assets.push({ id, relativePath, sha256: sha256(bytes), kind: 'upload' });
        const page = current.pages.find((item) => item.id === input.pageId)!;
        page.productAssetIds = [id];
        page.backgroundAssetId = undefined;
    });
}

type ProductImageExportInput = { path: string; expectedRevision: number; format: 'png' | 'directory' | 'zip'; pageId?: string; outputPath: string };

export function exportProductImageSet(input: ProductImageExportInput): Promise<{ outputPath: string; snapshot: XhsNoteProjectSnapshot }> {
    return runInWorkspaceSpace(getWorkspacePaths().activeSpaceId, () => exportProductImageSetInSpace(input));
}

async function exportProductImageSetInSpace(input: ProductImageExportInput): Promise<{ outputPath: string; snapshot: XhsNoteProjectSnapshot }> {
    ProductImageExportRequestSchema.parse(input);
    let snapshot = await getXhsNoteProject(input.path);
    assertExpectedXhsRevision(snapshot.version, input.expectedRevision);
    const set = requireSet(snapshot);
    const pages = input.format === 'png' ? set.pages.filter((page) => page.id === input.pageId) : set.pages;
    if (!pages.length) throw new Error('页面不存在');
    const expectedKeys = pages.map((page) => productImageInputKey(set, page));
    for (const page of pages) {
        snapshot = await renderProductImagePage({ path: input.path, pageId: page.id, expectedRevision: snapshot.version });
    }
    snapshot = await getXhsNoteProject(input.path);
    const latestSet = requireSet(snapshot);
    if (pages.some((page, index) => !latestSet.pages.find((item) => item.id === page.id) || productImageInputKey(latestSet, latestSet.pages.find((item) => item.id === page.id)!) !== expectedKeys[index])
        || (input.format !== 'png' && JSON.stringify(latestSet.pages.map((page) => page.id)) !== JSON.stringify(set.pages.map((page) => page.id)))) throw new Error('导出期间页面已修改，请按最新方案重新导出');
    if (pages.some((page) => snapshot.document.mediaSlots.find((slot) => slot.id === productImageSlotId(page))?.status !== 'ready')) throw new Error('仍有未完成的图片，请重试对应页面');
    if (input.format === 'zip') {
        await exportXhsMaterialPackage({ path: input.path, outputPath: input.outputPath, allowExternalOutput: true });
    } else {
        if (input.format === 'directory') await fs.mkdir(input.outputPath, { recursive: true });
        const assets = await listMediaAssets(10000);
        for (const [index, page] of pages.entries()) {
            const slot = snapshot.document.mediaSlots.find((item) => item.id === productImageSlotId(page));
            const asset = assets.find((item) => item.id === slot?.assetId);
            if (!asset?.relativePath) throw new Error('导出图片丢失');
            await fs.copyFile(getAbsoluteMediaPath(asset.relativePath), input.format === 'png' ? input.outputPath : path.join(input.outputPath, `${String(index + 1).padStart(2, '0')}-${page.role === 'cover' ? '封面' : '内容页'}.png`));
        }
    }
    const exportedVersion = snapshot.version;
    snapshot = await getXhsNoteProject(input.path);
    if (snapshot.version !== exportedVersion) throw new Error('导出期间工程又有修改，本次文件属于旧版本，请重新导出');
    return { outputPath: input.outputPath, snapshot };
}
