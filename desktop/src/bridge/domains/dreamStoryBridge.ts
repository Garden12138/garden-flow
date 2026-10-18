import type { BridgeCore, Listener } from '../types';
import type { VideoEditorV2Project } from '../../../shared/videoAutoEdit';
import type { DreamRequest, DreamEditRequest } from '../../../shared/dreamStory';
import type { DreamStoryTarget } from '../../../shared/contentCreationTarget';
import type { DreamMediaBatch } from '../../../shared/dreamStory';
export interface DreamStoryResponse {
    success: boolean; error?: string; canceled?: boolean; project?: VideoEditorV2Project; projects?: VideoEditorV2Project[];
    sessionId?: string; batch?: DreamMediaBatch; batches?: DreamMediaBatch[]; outputPath?: string;
    importPreview?: { id: string; title: string; sceneCount: number; language: string; hasOriginal: boolean; missing: string[]; scenes: Array<{ id: string; visual: string }> };
}
export function createDreamStoryBridge(core: BridgeCore) {
    const invoke = (channel: string, payload?: unknown) => core.invokeChannel(channel, payload) as Promise<DreamStoryResponse>;
    return { dreamStory: {
        create: () => invoke('dream-story:create'),
        read: (payload: { projectId: string }) => invoke('dream-story:read', payload),
        list: () => invoke('dream-story:list'),
        edit: (payload: DreamEditRequest) => invoke('dream-story:edit', payload),
        draft: (payload: { projectId: string; dirty: boolean }) => invoke('dream-story:draft', payload),
        session: (payload: { projectId: string }) => invoke('dream-story:session', payload),
        batchPreview: (payload: DreamRequest & { kind: 'image' | 'audio' | 'video'; sceneIds: string[] }) => invoke('dream-story:batch-preview', payload),
        batchConfirm: (payload: DreamRequest & { batchId: string }) => invoke('dream-story:batch-confirm', payload),
        batchCancel: (payload: { projectId: string; batchId: string }) => invoke('dream-story:batch-cancel', payload),
        mediaStatus: (payload: { projectId: string }) => invoke('dream-story:media-status', payload),
        importMedia: (payload: DreamRequest & { sceneId?: string; kind: 'image' | 'audio' | 'video' | 'music' | 'reference'; assetId?: string; referenceOwner?: { kind: 'character' | 'setting'; id: string } }) => invoke('dream-story:media-import', payload),
        approveImage: (payload: DreamRequest & { sceneId: string; kind?: 'image' | 'video' }) => invoke('dream-story:image-approve', payload),
        render: (payload: DreamRequest & { preview: boolean }) => invoke('dream-story:render', payload),
        onRenderProgress: (listener: Listener) => core.on('dream-story:render-progress', listener),
        offRenderProgress: (listener: Listener) => core.off('dream-story:render-progress', listener),
        export: (payload: DreamRequest & { format: 'json' | 'markdown' | 'srt' | 'mp4' | 'share' | 'backup'; includePrivate?: boolean }) => invoke('dream-story:export', payload),
        importPreview: () => invoke('dream-story:import-preview'),
        importConfirm: (payload: { id: string }) => invoke('dream-story:import-confirm', payload),
        copyTarget: (payload: DreamRequest & { target: DreamStoryTarget }) => invoke('dream-story:copy-target', payload),
    } };
}
