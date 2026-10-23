import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { detectClipboardCaptureCandidate, clipboardCapturePlatformLabel } from './clipboardDetector';
import { enqueueClipboardCapture } from './browserCaptureClient';

export function CaptureLinkDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const [text, setText] = useState('');
    const [commentLimit, setCommentLimit] = useState(5);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const candidate = detectClipboardCaptureCandidate(text, 'paste');

    const submit = async () => {
        if (!candidate || busy) return;
        setBusy(true);
        setMessage('正在采集，媒体下载可能需要一些时间…');
        try {
            const result = await enqueueClipboardCapture(candidate, commentLimit);
            if (!result.success) throw new Error(result.error || '采集失败');
            setMessage(result.partial ? `已部分保存，可在素材详情补采：${result.error || ''}` : result.duplicate ? '已更新原有素材。' : '已保存到素材库。');
            onSaved();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!busy) onClose(); }}>
            <form
                role="dialog"
                aria-modal="true"
                aria-label="链接采集"
                className="w-full max-w-lg space-y-4 rounded-2xl border border-border bg-surface-primary p-5 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => { event.preventDefault(); void submit(); }}
            >
                <div className="flex items-center justify-between">
                    <h2 className="font-semibold">链接采集</h2>
                    <button type="button" aria-label="关闭链接采集" disabled={busy} onClick={onClose}><X className="h-4 w-4" /></button>
                </div>
                <p className="text-sm text-text-secondary">粘贴小红书、抖音、国际 TikTok 或 YouTube 的作品链接，也支持分享文本中的链接。</p>
                <textarea autoFocus aria-label="作品链接或分享文本" value={text} disabled={busy} onChange={(event) => setText(event.target.value)} rows={3} className="w-full rounded-lg border border-border bg-surface-secondary p-3 text-sm" />
                {candidate && <p className="text-xs text-text-secondary">已识别：{clipboardCapturePlatformLabel(candidate)}</p>}
                {candidate?.platform !== 'youtube' && (
                    <label className="flex items-center gap-3 text-sm">
                        评论数量（0 关闭）
                        <input type="number" min={0} max={200} value={commentLimit} disabled={busy} onChange={(event) => setCommentLimit(Math.max(0, Math.min(200, Number(event.target.value) || 0)))} className="w-20 rounded border border-border bg-surface-primary px-2 py-1" />
                    </label>
                )}
                {message && <p role="status" className="text-sm text-text-secondary">{message}</p>}
                <div className="flex justify-end">
                    <button type="submit" disabled={!candidate || busy} className="inline-flex items-center gap-2 rounded-lg bg-accent-primary px-4 py-2 text-sm text-white disabled:opacity-50">
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}开始采集
                    </button>
                </div>
            </form>
        </div>
    );
}
