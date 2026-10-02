import type { BridgeCore } from '../types';

export function createVideoEditorBridge(core: BridgeCore) {
  return {
    videoEditorV2: {
      getOrCreateForManuscript: (payload: { manuscriptPath: string; title?: string }) =>
        core.invokeChannel('videoEditorV2:get-or-create-for-manuscript', payload),
      createProject: (payload?: Record<string, unknown>) =>
        core.invokeChannel('videoEditorV2:create-project', payload || {}),
      getProject: (payload: { projectId: string }) => core.invokeChannel('videoEditorV2:get-project', payload),
      listProjects: () => core.invokeChannel('videoEditorV2:list-projects'),
      applyProductCommand: (payload: Record<string, unknown>) => core.invokeChannel('videoEditorV2:apply-product-command', payload),
      setProductMusic: (payload: { projectId: string; sourcePath?: string }) => core.invokeChannel('videoEditorV2:set-product-music', payload),
      getProductVoiceoverConfig: () => core.invokeChannel('videoEditorV2:get-product-voiceover-config'),
      generateProductVoiceover: (payload: { projectId: string; sceneId: string }) => core.invokeChannel('videoEditorV2:generate-product-voiceover', payload),
      setProductVoiceover: (payload: { projectId: string; sceneId: string; sourceAssetId?: string }) => core.invokeChannel('videoEditorV2:set-product-voiceover', payload),
      retryProductScene: (payload: { projectId: string; sceneId: string }) => core.invokeChannel('videoEditorV2:retry-product-scene', payload),
      importAssets: (payload: { projectId: string; sourcePaths?: string[] }) =>
        core.invokeChannel('videoEditorV2:import-assets', payload),
      importSrt: (payload: { projectId: string; assetId?: string; srtPath?: string; srtContent?: string; language?: string }) =>
        core.invokeChannel('videoEditorV2:import-srt', payload),
      runAsr: (payload: { projectId: string; assetId: string; language?: string }) =>
        core.invokeChannel('videoEditorV2:run-asr', payload),
      updateSrtSegment: (payload: Record<string, unknown>) =>
        core.invokeChannel('videoEditorV2:update-srt-segment', payload),
      mergeSrtSegments: (payload: Record<string, unknown>) =>
        core.invokeChannel('videoEditorV2:merge-srt-segments', payload),
      splitSrtSegment: (payload: Record<string, unknown>) =>
        core.invokeChannel('videoEditorV2:split-srt-segment', payload),
      setTimelineClipDisabled: (payload: Record<string, unknown>) =>
        core.invokeChannel('videoEditorV2:set-timeline-clip-disabled', payload),
      trimTimelineClip: (payload: Record<string, unknown>) =>
        core.invokeChannel('videoEditorV2:trim-timeline-clip', payload),
      splitTimelineClip: (payload: Record<string, unknown>) =>
        core.invokeChannel('videoEditorV2:split-timeline-clip', payload),
      reorderTimelineClip: (payload: Record<string, unknown>) =>
        core.invokeChannel('videoEditorV2:reorder-timeline-clip', payload),
      undoTimeline: (payload: Record<string, unknown>) => core.invokeChannel('videoEditorV2:undo-timeline', payload),
      generateAutoEdit: (payload: Record<string, unknown>) =>
        core.invokeChannel('videoEditorV2:generate-auto-edit', payload),
      applyAutoEdit: (payload: Record<string, unknown>) =>
        core.invokeChannel('videoEditorV2:apply-auto-edit', payload),
      render: (payload: Record<string, unknown>) => core.invokeChannel('videoEditorV2:render', payload),
    },
    douyinVideo: {
      createVersion: (payload: { sourceProjectId: string; sourceNotePath?: string; duplicate?: boolean }) => core.invokeChannel('douyin:video-version-create', payload),
      getVersion: (payload: { versionId?: string; projectId?: string; sourceProjectId?: string }) => core.invokeChannel('douyin:video-version-get', payload),
      saveVersion: (payload: { versionId: string; expectedRevision: number; title: string; description: string; hashtags: string[]; coverAssetId?: string }) => core.invokeChannel('douyin:video-version-save', payload),
    },
    douyinPublisher: {
      getStatus: () => core.invokeChannel('douyin-publisher:status'),
      bindInstance: (payload: { extensionInstanceId: string }) => core.invokeChannel('douyin-publisher:bind-instance', payload),
      prepare: (payload: { versionId: string; sessionId?: string }) => core.invokeChannel('douyin-publisher:prepare', payload),
      getJob: (payload: { jobId?: string; versionId?: string }) => core.invokeChannel('douyin-publisher:get-job', payload),
      confirm: (payload: { jobId: string }) => core.invokeChannel('douyin-publisher:confirm', payload),
      stageDraft: (payload: { jobId: string }) => core.invokeChannel('douyin-publisher:stage-draft', payload),
      cancel: (payload: { jobId: string }) => core.invokeChannel('douyin-publisher:cancel', payload),
      recoverUnpublished: (payload: { jobId: string; acknowledgedNotPublished: boolean }) => core.invokeChannel('douyin-publisher:recover-unpublished', payload),
      reviewPublished: (payload: { jobId: string; acknowledgedPublished: boolean }) => core.invokeChannel('douyin-publisher:review-published', payload),
      onJobChanged: (listener: (event: unknown, job: unknown) => void) => core.on('douyin-publisher:job-changed', listener),
      offJobChanged: (listener: (event: unknown, job: unknown) => void) => core.off('douyin-publisher:job-changed', listener),
    },
  };
}
