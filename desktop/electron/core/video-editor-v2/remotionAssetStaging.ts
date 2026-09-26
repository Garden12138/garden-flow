import fs from 'node:fs/promises';
import path from 'node:path';
import { isLocalAssetSource } from '../../../shared/localAsset.ts';
import type { MediaAssetRecord } from '../../../shared/videoAutoEdit';
import type { VideoEditorV2RemotionComposition } from '../../../shared/videoAutoEditRemotion';

export async function stageRemotionAssets(
    assets: MediaAssetRecord[],
    composition: VideoEditorV2RemotionComposition,
    renderDirectory: string,
): Promise<VideoEditorV2RemotionComposition> {
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const stagedSources = new Map<string, string>();
    const scenes: VideoEditorV2RemotionComposition['scenes'] = [];

    for (const scene of composition.scenes) {
        if (!isLocalAssetSource(scene.src)) {
            scenes.push(scene);
            continue;
        }
        const asset = assetsById.get(scene.assetId || '');
        if (!asset) throw new Error(`渲染素材不存在：${scene.assetId || scene.id}`);
        let stagedSource = stagedSources.get(asset.id);
        if (!stagedSource) {
            const sourcePath = asset.projectPath || asset.sourcePath;
            if (!sourcePath || !path.isAbsolute(sourcePath)) throw new Error(`渲染素材路径无效：${asset.id}`);
            const extension = path.extname(sourcePath).toLowerCase()
                || (asset.kind === 'audio' ? '.mp3' : asset.kind === 'image' ? '.png' : '.mp4');
            const fileName = `asset-${stagedSources.size + 1}${extension}`;
            const destination = path.join(renderDirectory, 'media', fileName);
            await fs.mkdir(path.dirname(destination), { recursive: true });
            await fs.copyFile(sourcePath, destination);
            stagedSource = `/media/${fileName}`;
            stagedSources.set(asset.id, stagedSource);
        }
        scenes.push({ ...scene, src: stagedSource });
    }

    return { ...composition, scenes };
}
