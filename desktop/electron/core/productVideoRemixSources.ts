import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getWorkspacePaths, runInWorkspaceSpace } from '../db';
import { getAbsoluteMediaPath, getMediaAssetById } from './mediaLibraryStore';
import { isPathWithinRoots, toAppAssetUrl } from './localAssetManager';
import { probeMediaMetadata, probeVideoTrackDurationMs } from './video-auto-edit/mediaProbeService';
import { ProductVideoClipReferencesSchema, type ProductVideoClipReference } from '../../shared/productVideoRemix';

export async function productVideoFileHash(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(filePath)) hash.update(bytes);
    return hash.digest('hex');
}

export function readProductVideoRemixSources(assetIds: string[]): Promise<ProductVideoClipReference[]> {
    const spaceId = getWorkspacePaths().activeSpaceId;
    return runInWorkspaceSpace(spaceId, async () => {
        if (!Array.isArray(assetIds) || assetIds.length < 1 || assetIds.length > 8 || assetIds.some((id) => typeof id !== 'string' || !id) || new Set(assetIds).size !== assetIds.length) throw new Error('请选择 1–8 个不同的视频素材');
        const refs: ProductVideoClipReference[] = [];
        for (const id of assetIds) {
            const asset = await getMediaAssetById(id);
            if (!asset?.relativePath || !asset.mimeType?.startsWith('video/')) throw new Error(`视频素材不存在或不属于当前空间：${id}`);
            const absolute = getAbsoluteMediaPath(asset.relativePath);
            if (!isPathWithinRoots(await fs.realpath(absolute), [await fs.realpath(getWorkspacePaths().media)])) throw new Error('视频素材不能通过符号链接访问空间外文件');
            const before = await fs.stat(absolute);
            if (!before.isFile() || before.size < 1) throw new Error('视频文件为空或不可读取');
            const contentHash = await productVideoFileHash(absolute);
            const probe = await probeMediaMetadata(absolute);
            const videoDurationMs = await probeVideoTrackDurationMs(absolute);
            const after = await fs.stat(absolute);
            if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('视频在读取期间已更新，请重新选择');
            if (!probe.durationMs || !probe.width || !probe.height || !probe.fps) throw new Error(`视频损坏或无法读取时长：${asset.title || id}`);
            refs.push({ assetId: id, title: asset.title || path.basename(absolute), contentHash, durationMs: videoDurationMs,
                width: probe.width, height: probe.height, fps: probe.fps, hasAudio: Boolean(probe.hasAudio), previewUrl: toAppAssetUrl(absolute) });
        }
        return ProductVideoClipReferencesSchema.parse(refs);
    });
}

export function resolveProductVideoRemixFiles(refs: ProductVideoClipReference[]): Promise<Array<{ assetId: string; absolutePath: string; kind: 'user-import'; contentHash: string; durationMs: number }>> {
    return runInWorkspaceSpace(getWorkspacePaths().activeSpaceId, async () => {
        const fresh = await readProductVideoRemixSources(refs.map((ref) => ref.assetId));
        return Promise.all(refs.map(async (ref) => {
            const current = fresh.find((item) => item.assetId === ref.assetId);
            if (!current || current.contentHash !== ref.contentHash || current.durationMs !== ref.durationMs) throw new Error(`视频来源已更新，请重新选择并规划：${ref.title}`);
            const asset = await getMediaAssetById(ref.assetId);
            if (!asset?.relativePath) throw new Error(`来源视频已删除：${ref.title}`);
            return { assetId: ref.assetId, absolutePath: getAbsoluteMediaPath(asset.relativePath), kind: 'user-import' as const, contentHash: ref.contentHash, durationMs: ref.durationMs };
        }));
    });
}
