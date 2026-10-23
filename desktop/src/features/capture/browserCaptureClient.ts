import { clipboardCaptureQueue } from './captureQueue';
import type { ClipboardCaptureCandidate } from './captureTypes';

export function enqueueClipboardCapture(candidate: ClipboardCaptureCandidate, commentLimit = 5) {
    return clipboardCaptureQueue.enqueue(candidate, async (_candidate, context) => {
        context.updateTask({ progressMessage: '正在采集作品…' });
        const result = candidate.platform === 'youtube'
            ? await window.ipcRenderer.capture.saveYoutubeNote({ videoId: candidate.externalId || '', videoUrl: candidate.rawUrl, title: candidate.title || '', description: '', thumbnailUrl: '' })
            : await window.ipcRenderer.capture.saveUrl({ url: candidate.rawUrl, commentLimit });
        if (!result?.success) throw new Error(result?.error || '作品采集失败');
        const capture = 'capture' in result ? result.capture : undefined;
        return { success: true, noteId: result.noteId, duplicate: result.duplicate, updated: 'updated' in result ? result.updated : false, partial: capture?.status === 'partial', error: capture?.errors.join('；') };
    });
}
