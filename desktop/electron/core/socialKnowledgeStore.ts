import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mergeSocialComments, socialExternalId, socialPlatformFromUrl, type SocialCapturePlatform, type SocialCaptureState } from '../../shared/socialCapture.ts';
import type { BrowserKnowledgeEntryPayload } from './browserCapturePayloads.ts';

type Meta = Record<string, any>;
const writes = new Map<string, Promise<unknown>>();

export async function serializeSocialWrite<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = writes.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    writes.set(key, current);
    try { return await current; } finally { if (writes.get(key) === current) writes.delete(key); }
}

const readMeta = async (root: string, id: string): Promise<Meta | null> => {
    try { return JSON.parse(await fs.readFile(path.join(root, id, 'meta.json'), 'utf8')); } catch { return null; }
};

/** Resolve legacy raw-ID directories only after verifying both platform and identity. */
export async function resolveSocialEntryId(root: string, platform: SocialCapturePlatform, externalId: string): Promise<string> {
    if (!/^[a-z\d_-]{1,200}$/i.test(externalId)) throw new Error('作品标识无效');
    const namespaced = `${platform}_${externalId}`;
    for (const candidate of [namespaced, externalId]) {
        const meta = await readMeta(root, candidate);
        if (meta && socialPlatformFromUrl(String(meta.sourceUrl || meta.source || meta.url || '')) === platform
            && (String(meta.externalId || '') === externalId || socialExternalId(String(meta.sourceUrl || meta.source || meta.url || ''), platform) === externalId)) return candidate;
        if (meta && candidate === namespaced) throw new Error('已有素材的来源与作品标识不一致，请先核对该素材');
    }
    return namespaced;
}

type StoreIo = {
    root: string;
    createPersister: (directory: string, sourceUrl: string) => {
        persistImage: (source: string, preferredName?: string) => Promise<string>;
        persistVideo: (source: string, preferredName?: string) => Promise<string>;
    };
    verifyVideo: (file: string) => Promise<void>;
    onSaved: (id: string, directory: string, meta: Meta, updated: boolean) => Promise<void>;
};

export async function persistSocialKnowledgeEntry(entry: BrowserKnowledgeEntryPayload, io: StoreIo) {
    const sourceUrl = String(entry.source?.sourceLink || entry.source?.sourceUrl || '');
    const platform = socialPlatformFromUrl(sourceUrl);
    const externalId = String(entry.source?.externalId || '');
    if (!platform || !['douyin', 'tiktok'].includes(platform) || entry.platform !== platform
        || !/^\d+$/.test(externalId) || socialExternalId(sourceUrl, platform) !== externalId
        || !['video', 'image_text'].includes(String(entry.contentType))
        || entry.kind !== `${platform}-${entry.contentType === 'video' ? 'video' : 'image'}`) throw new Error('作品来源、平台或标识不一致');
    return serializeSocialWrite(`${io.root}:${platform}:${externalId}`, async () => {
        const id = await resolveSocialEntryId(io.root, platform, externalId);
        const directory = path.join(io.root, id);
        await fs.mkdir(directory, { recursive: true });
        const old = await readMeta(io.root, id);
        const validLocal = async (file: unknown) => {
            if (typeof file !== 'string' || !file || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) return false;
            return (await fs.stat(path.join(directory, file)).catch(() => null))?.size! > 0;
        };
        const startedAt = Date.now();
        const mediaErrors: string[] = [];
        const { persistImage, persistVideo } = io.createPersister(directory, sourceUrl);
        const content = entry.content || {};
        const assets = entry.assets || {};
        const meta: Meta = {
            ...old, id, externalId, platform, contentType: entry.contentType, type: entry.kind, captureKind: entry.kind,
            sourceUrl, title: content.title || old?.title || '未命名作品', author: content.author || old?.author || '',
            authorProfileUrl: content.authorProfileUrl || old?.authorProfileUrl || '', content: content.text || old?.content || '',
            indexText: content.indexText || old?.indexText || content.text || '', excerpt: content.excerpt || old?.excerpt || '',
            siteName: content.siteName || old?.siteName || '', publishedAt: content.publishedAt || old?.publishedAt || '',
            stats: { ...old?.stats, ...content.stats }, tags: [...new Set([...(old?.tags || []), ...(content.tags || [])])],
            commentsSnapshot: mergeSocialComments(old?.commentsSnapshot || [], content.commentsSnapshot || []),
            createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        // Every download gets a fresh filename. A failed replacement cannot truncate a good file.
        const image = async (source: string, previous: unknown, role: string) => {
            if (await validLocal(previous)) return String(previous);
            if (!source) { mediaErrors.push(`${role}缺失`); return ''; }
            if (Date.now() - startedAt > 120000) { mediaErrors.push(`${role}下载预算已用尽，可补采`); return ''; }
            try { return await persistImage(source, `capture-${randomUUID()}`); }
            catch { mediaErrors.push(`${role}下载失败`); return ''; }
        };
        const oldGallery = Array.isArray(old?.galleryImages) ? old.galleryImages : (old?.images || []).filter((file: string) => file !== old?.cover);
        const gallery: string[] = [];
        const sources = assets.imageUrls || [];
        if (entry.contentType === 'image_text') {
            for (let index = 0; index < Math.max(sources.length, oldGallery.length, 1); index += 1) {
                const local = await image(String(sources[index] || ''), oldGallery[index], `第 ${index + 1} 张图片`);
                gallery.push(local);
            }
        }
        meta.galleryImages = gallery;
        meta.images = gallery.filter(Boolean);
        meta.cover = await image(String(assets.coverUrl || ''), old?.cover || meta.images[0], '封面');
        if (entry.contentType === 'video') {
            if (await validLocal(old?.video)) meta.video = old!.video;
            else {
                delete meta.video;
                const candidates = [...new Set([assets.videoUrl, ...(Array.isArray(assets.videoUrls) ? assets.videoUrls : [])].filter((url): url is string => typeof url === 'string' && Boolean(url)))].slice(0, 3);
                let lastError: unknown;
                for (const source of candidates) {
                    if (Date.now() - startedAt > 120000) { lastError = new Error('视频下载预算已用尽，可补采'); break; }
                    let file = '';
                    try {
                        file = await persistVideo(source, `capture-${randomUUID()}`);
                        await io.verifyVideo(path.join(directory, file));
                        meta.video = file;
                        meta.videoUrl = source;
                        break;
                    } catch (error) {
                        lastError = error;
                        if (file && !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..')) await fs.rm(path.join(directory, file), { force: true }).catch(() => undefined);
                    }
                }
                if (!meta.video) {
                    const reason = String(lastError instanceof Error ? lastError.message : lastError || '').replace(/https?:\/\/\S+/g, '媒体地址').slice(0, 180);
                    mediaErrors.push(candidates.length ? `视频下载或解码失败${reason ? `：${reason}` : ''}` : '视频地址缺失');
                }
            }
        }
        const requested = Math.max(0, Math.min(200, Math.trunc(Number(entry.capture?.commentLimit ?? 5)) || 0));
        const required = typeof meta.stats.comments === 'number' ? Math.min(requested, meta.stats.comments) : requested;
        const commentsComplete = requested === 0 || meta.commentsSnapshot.length >= required || entry.capture?.comments === 'complete';
        const commentErrors = commentsComplete && !entry.capture?.blocker ? [] : entry.capture?.commentErrors?.length ? entry.capture.commentErrors : ['评论未完成采样，可重试补采'];
        const metadataErrors = [...(!String(meta.author || '').trim() ? ['未获取到作品作者'] : []), ...(!String(meta.publishedAt || '').trim() ? ['未获取到作品发布时间'] : [])];
        const capture: SocialCaptureState = {
            blocker: entry.capture?.blocker,
            status: metadataErrors.length || mediaErrors.length || !commentsComplete || entry.capture?.blocker ? 'partial' : 'complete', media: mediaErrors.length ? 'partial' : 'complete',
            comments: requested === 0 ? 'skipped' : commentsComplete ? 'complete' : 'partial', commentLimit: requested,
            capturedComments: meta.commentsSnapshot.length, errors: [...metadataErrors, ...mediaErrors, ...commentErrors], commentErrors,
        };
        meta.capture = capture;
        const staging = path.join(directory, `meta-${randomUUID()}.tmp`);
        await fs.writeFile(staging, JSON.stringify(meta, null, 2));
        await fs.rename(staging, path.join(directory, 'meta.json'));
        await fs.writeFile(path.join(directory, 'content.md'), meta.content, 'utf8');
        await io.onSaved(id, directory, meta, Boolean(old));
        return { success: true, entryId: id, duplicate: Boolean(old), updated: Boolean(old), capture };
    });
}
