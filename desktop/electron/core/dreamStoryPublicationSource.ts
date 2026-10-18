import fs from 'node:fs/promises';
import { getWorkspacePaths, getTikTokVideoVersionByProject } from '../db';
import { type PublicationSnapshot } from '../../shared/publication';
import { validateTikTokPublishSettings } from '../../shared/tiktokVideo';
import { currentDreamExport } from './dreamStoryRenderService';
import { readDreamStory, getDreamSession, dreamDigest } from './dreamStoryStore';
import { listMediaAssets, getAbsoluteMediaPath } from './mediaLibraryStore';
import { isPathWithinRoots } from './localAssetManager';
import { dreamFileSha256 } from './dreamStoryMediaService';

export async function readDreamPublicationSource(projectId: string, includeSession = true, requireSettings = true): Promise<PublicationSnapshot> {
    const checked = await currentDreamExport(projectId); const doc = checked.project.dreamStory;
    const version = getTikTokVideoVersionByProject(projectId);
    if (version?.source?.kind !== 'dream-story' || version.source.revision !== doc.revision || version.source.targetDigest !== doc.targetDigest) throw new Error('梦境平台版本已过期，请保存当前工程');
    if (version.language !== doc.target!.language || version.market !== doc.target!.market || !version.title.trim() || !version.description.trim()) throw new Error('请填写与目标一致的 TikTok 发布文案');
    if ([version.description, version.hashtags.map(tag => '#' + tag).join(' ')].join('\n').length > 4000) throw new Error('TikTok 文案与话题超过 4000 字符');
    const asset = (await listMediaAssets(10000)).find(item => item.id === checked.output.mediaAssetId);
    if (!asset?.relativePath) throw new Error('正式成片尚未登记');
    const file = await fs.realpath(getAbsoluteMediaPath(asset.relativePath));
    if (!isPathWithinRoots(file, [await fs.realpath(getWorkspacePaths().media)]) || await dreamFileSha256(file) !== checked.output.outputSha256) throw new Error('入库成片已变化或越出空间');
    const settings = requireSettings || version.publishSettings ? validateTikTokPublishSettings(version.publishSettings) : undefined;
    const session = includeSession ? await getDreamSession(projectId) : undefined;
    const snapshot: PublicationSnapshot = { spaceId: doc.spaceId, source: { kind: 'dream-story', projectId }, platform: 'tiktok',
        versionId: version.id, workId: version.sourceProjectId, revision: dreamDigest({ revision: doc.revision, epoch: doc.draftEpoch, version: version.revision }),
        target: doc.target, semanticDigest: '', sessionId: session?.sessionId || '', title: version.title, body: version.description,
        hashtags: version.hashtags, settings,
        coverCandidates: checked.project.timeline.tracks.find(track => track.kind === 'primary-video')!.clips.map(clip => {
            const binding = clip.sceneId ? doc.media[clip.sceneId]?.image : undefined;
            if (!clip.sceneId || !binding?.assetId || !checked.hashes[binding.assetId]) throw new Error('封面候选画面缺失，请核对当前成片');
            return { sceneId: clip.sceneId, timeMs: Math.round((clip.timelineStartMs + clip.timelineEndMs) / 2), imageSha256: checked.hashes[binding.assetId] };
        }),
        media: [{ slotId: 'final-video', assetId: asset.id, role: 'video', path: file,
            mimeType: 'video/mp4', sha256: checked.output.outputSha256!, order: 0, width: 1080, height: 1920 }] };
    snapshot.semanticDigest = dreamDigest({ spaceId: snapshot.spaceId, source: snapshot.source, target: snapshot.target,
        title: snapshot.title, body: snapshot.body, hashtags: snapshot.hashtags, settings: snapshot.settings, coverCandidates: snapshot.coverCandidates,
        media: snapshot.media.map(({ sha256, role, order, width, height, mimeType }) => ({ sha256, role, order, width, height, mimeType })) });
    const latest = await readDreamStory(projectId);
    if (latest.dreamStory.dirty || latest.dreamStory.revision !== doc.revision || latest.dreamStory.draftEpoch !== doc.draftEpoch || getTikTokVideoVersionByProject(projectId)?.revision !== version.revision) throw new Error('发布核对期间内容已变化');
    return snapshot;
}
