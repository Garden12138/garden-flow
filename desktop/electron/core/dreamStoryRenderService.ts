import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getWorkspacePaths, runInWorkspaceSpace } from '../db';
import { buildVideoEditorV2RemotionComposition } from '../../shared/videoAutoEditRemotion';
import { DreamRequestSchema, dreamSceneInput, type DreamRequest } from '../../shared/dreamStory';
import { dreamDigest, readDreamStory, assertDreamRequest, dreamLock, persistDreamProject, syncDreamTikTokVersion } from './dreamStoryStore';
import { dreamFileSha256 } from './dreamStoryMediaService';
import { renderRemotionComposition } from './video-editor-v2/renderExportService';
import { registerRenderedVideoAsset } from './mediaLibraryStore';
import { probeMediaMetadata } from './video-auto-edit/mediaProbeService';
import { isPathWithinRoots } from './localAssetManager';
import { compositionFingerprint } from './video-editor-v2/videoPublicationPolicy';

let renderQueue: Promise<unknown> = Promise.resolve();
export async function validateDreamRender(projectId: string) {
    const project = await readDreamStory(projectId); const doc = project.dreamStory;
    if (doc.dirty || !doc.target || !doc.director || !doc.storyboardAdopted || doc.storySyncRequired || doc.recordReviewRequired) throw new Error('请保存并采用当前故事和分镜');
    const root = await fs.realpath(project.projectDir); const hashes: Record<string, string> = {};
    for (const id of new Set([...doc.director.characters, ...(doc.director.settings || [])].flatMap(character => character.referenceAssetIds))) {
        const asset = project.assets.find(item => item.id === id); if (!asset) throw new Error('角色参考图缺失');
        const real = await fs.realpath(asset.projectPath);
        if (!isPathWithinRoots(real, [root]) || await dreamFileSha256(real) !== asset.hash) throw new Error('角色参考图文件已变化，请重新导入并复核画面');
    }
    for (const scene of doc.director.scenes) for (const kind of doc.target.narration ? ['image', 'video', 'audio'] as const : ['image', 'video'] as const) {
        const usesVideo = doc.target.compositionMode === 'story-video' || (doc.target.compositionMode === 'story-hybrid' && scene.mediaType === 'video');
        if (kind === 'video' && !usesVideo) continue;
        const binding = doc.media[scene.id]?.[kind]; const asset = project.assets.find(item => item.id === binding?.assetId);
        if (!binding || binding.status !== 'ready' || !asset || asset.kind !== kind || binding.inputDigest !== dreamDigest(dreamSceneInput(doc, scene, kind))) throw new Error(`第 ${doc.director.scenes.indexOf(scene) + 1} 幕${kind === 'image' ? '画面' : '旁白'}缺失或过期`);
        if (kind === 'video' && (!binding.durationMs || binding.durationMs + 1 < Math.ceil(Math.max(scene.plannedDurationMs, doc.target.narration ? doc.media[scene.id]?.audio?.durationMs || 0 : 0) / 1000 * doc.target.spec.fps) / doc.target.spec.fps * 1000)) throw new Error('视频不足以覆盖分镜，请调整时长或重新规划；不会停帧、循环或慢放补足');
        const file = await fs.realpath(asset.projectPath);
        if (!isPathWithinRoots(file, [root])) throw new Error('素材越出当前工程');
        const hash = await dreamFileSha256(file); hashes[asset.id] = hash;
        if (binding.fileSha256 !== hash) throw new Error('素材文件已变化，请重新导入并核对');
        if ((kind === 'image' || kind === 'video') && binding.approvedDigest !== dreamDigest({ inputDigest: binding.inputDigest, sha256: hash })) throw new Error('请逐幕确认当前画面');
    }
    if (doc.musicAssetId) {
        const asset = project.assets.find(item => item.id === doc.musicAssetId); if (!asset) throw new Error('BGM 文件缺失');
        const real = await fs.realpath(asset.projectPath); if (!isPathWithinRoots(real, [root])) throw new Error('BGM 越出工程'); hashes[asset.id] = await dreamFileSha256(real);
    }
    const composition = buildVideoEditorV2RemotionComposition(project); if (!composition) throw new Error('没有可渲染的八幕时间线');
    if (project.timeline.durationMs < 60000 || project.timeline.durationMs > 90000) throw new Error('实测总时长不在 60–90 秒范围内，请调整旁白或镜头时长；不会截断音频');
    return { project, composition, hashes };
}
export function dreamRenderFingerprint(input: Awaited<ReturnType<typeof validateDreamRender>>, preview = false): string {
    return dreamDigest({ rendererVersion: input.project.version === 3 ? 2 : 3, target: input.project.dreamStory.target, composition: compositionFingerprint(input.composition),
        assetHashes: input.hashes, preview, musicVolume: input.project.dreamStory.musicVolume, voiceVolume: input.project.dreamStory.voiceVolume });
}
export function dreamRenderContentDigest(project: Awaited<ReturnType<typeof readDreamStory>>): string {
    const doc = project.dreamStory;
    return dreamDigest({ target: doc.target, director: doc.director, media: doc.media, captions: doc.captions,
        musicAssetId: doc.musicAssetId, musicVolume: doc.musicVolume, voiceVolume: doc.voiceVolume });
}
export async function renderDreamStory(input: DreamRequest & { preview: boolean }, onProgress?: (progress: { projectId: string; stage: string; percent: number; status: string; outputPath?: string }) => void): Promise<{ project: Awaited<ReturnType<typeof readDreamStory>>; outputPath: string }> {
    DreamRequestSchema.parse({ spaceId: input.spaceId, projectId: input.projectId, requestId: input.requestId, expectedRevision: input.expectedRevision, expectedDraftEpoch: input.expectedDraftEpoch });
    const spaceId = getWorkspacePaths().activeSpaceId; if (spaceId !== input.spaceId) throw new Error('渲染不属于当前空间');
    const run = () => runInWorkspaceSpace(spaceId, async () => {
        const frozen = await validateDreamRender(input.projectId); assertDreamRequest(frozen.project, input);
        const fingerprint = dreamRenderFingerprint(frozen, input.preview);
        const outputPath = path.join(frozen.project.projectDir, 'renders', `${input.preview ? 'preview' : 'final'}_${fingerprint}.mp4`);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        const cached = frozen.project.renderOutputs.find(output => output.renderFingerprint === fingerprint && output.path === outputPath);
        if (!cached || await dreamFileSha256(outputPath).catch(() => '') !== cached.outputSha256) {
            const composition = structuredClone(frozen.composition);
            if (input.preview) { composition.width = 540; composition.height = 960;
                for (const scene of composition.scenes) { if (scene.safeInsets) scene.safeInsets = Object.fromEntries(Object.entries(scene.safeInsets).map(([key, value]) => [key, value / 2])) as typeof scene.safeInsets;
                    for (const overlay of scene.overlays || []) if (overlay.fontSize) overlay.fontSize /= 2; }
            }
            await renderRemotionComposition({ project: frozen.project, composition, outputPath, onProgress });
            for (const [id, hash] of Object.entries(frozen.hashes)) {
                const asset = frozen.project.assets.find(item => item.id === id)!;
                if (await dreamFileSha256(asset.projectPath) !== hash) throw new Error('渲染期间素材文件已变化，请重新核对后渲染');
            }
            const probe = await probeMediaMetadata(outputPath);
            if (probe.width !== composition.width || probe.height !== composition.height || !probe.durationMs || Math.abs(probe.durationMs - frozen.project.timeline.durationMs) > 250 || (frozen.project.dreamStory.target!.narration && !probe.hasAudio)) throw new Error('成片尺寸、时长或音轨核验失败');
            const renderId = 'render_' + randomUUID();
            const media = input.preview ? undefined : await registerRenderedVideoAsset({ projectId: frozen.project.id, renderId, sourcePath: outputPath, title: frozen.project.title, privacyScope: 'project' });
            const output = { id: renderId, path: outputPath, mediaAssetId: media?.id, renderFingerprint: fingerprint,
                outputSha256: await dreamFileSha256(outputPath), createdAt: new Date().toISOString(), durationMs: probe.durationMs };
            await dreamLock(spaceId, input.projectId, async () => {
                const current = await readDreamStory(input.projectId);
                const same = !current.dreamStory.dirty && current.dreamStory.revision === frozen.project.dreamStory.revision && current.dreamStory.draftEpoch === frozen.project.dreamStory.draftEpoch
                    && dreamRenderContentDigest(current) === dreamRenderContentDigest(frozen.project);
                current.renderOutputs = [output, ...current.renderOutputs].slice(0, 40);
                if (!input.preview && same) { current.status = 'exported'; current.dreamStory.stage = 'export'; }
                await persistDreamProject(current); await syncDreamTikTokVersion(current);
            });
        }
        const project = await readDreamStory(input.projectId);
        onProgress?.({ projectId: project.id, stage: input.preview ? '预览完成' : '成片完成', percent: 100, status: 'completed', outputPath });
        if (!input.preview) await (await import('./publicationCompletionService')).recordCompletedPublication({ kind: 'dream-story', projectId: project.id });
        return { project, outputPath };
    });
    const result = renderQueue.then(run, run); renderQueue = result.then(() => undefined, () => undefined); return result;
}
export async function currentDreamExport(projectId: string) {
    const checked = await validateDreamRender(projectId); const fingerprint = dreamRenderFingerprint(checked);
    const output = checked.project.renderOutputs.find(item => item.mediaAssetId && item.renderFingerprint === fingerprint);
    if (!output || await dreamFileSha256(output.path).catch(() => '') !== output.outputSha256) throw new Error('请先导出当前完整正式成片');
    return { ...checked, output };
}
