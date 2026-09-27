import { createHash } from 'node:crypto';
import { buildVideoEditorV2RemotionComposition } from '../../../shared/videoAutoEditRemotion.ts';
import type { VideoEditorV2RemotionComposition } from '../../../shared/videoAutoEditRemotion.ts';
import type { VideoEditorV2Project } from '../../../shared/videoAutoEdit.ts';

// Hash only rendered content, not save timestamps, status, undo history or title.
export function compositionFingerprint(composition: VideoEditorV2RemotionComposition): string {
    const { width, height, fps, durationInFrames, backgroundColor, scenes, transitions } = composition;
    return createHash('sha256').update(JSON.stringify({ width, height, fps, durationInFrames, backgroundColor, scenes, transitions })).digest('hex');
}

export function videoRenderFingerprint(project: VideoEditorV2Project): string {
    const composition = buildVideoEditorV2RemotionComposition(project);
    if (!composition) throw new Error('工程没有可导出的画面');
    return compositionFingerprint(composition);
}

export function assertCurrentVideoExport(project: VideoEditorV2Project, legacyFingerprint?: string): void {
    const output = project.renderOutputs[0];
    if (!output?.mediaAssetId) throw new Error('工程还没有资产库成片，请先在工作台导出视频');
    if (project.status === 'rendering' || project.status === 'generating') throw new Error('视频还在生成或导出，请完成后再发布');
    if (project.productVideo?.scenes.some((scene) => scene.voiceoverStatus === 'queued' || scene.voiceoverStatus === 'generating')) {
        throw new Error('旁白还在生成，请完成并重新导出后再发布');
    }
    const fingerprint = output.renderFingerprint || legacyFingerprint;
    if (!fingerprint || fingerprint !== videoRenderFingerprint(project)) {
        throw new Error('工程已修改或旧成片版本无法核验，请重新导出后再发布，系统不会发布旧版本');
    }
}
