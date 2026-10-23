import { Link2, Loader2 } from 'lucide-react';
import { clipboardCapturePlatformLabel } from './clipboardDetector';
import { useI18n } from '../../i18n';
import { useClipboardCapturePrompt } from './useClipboardCapturePrompt';

export function ClipboardCapturePrompt() {
  const { t } = useI18n();
  const clipboardCapture = useClipboardCapturePrompt();

  if (!clipboardCapture.open || !clipboardCapture.candidate) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[10000] bg-black/35 flex items-center justify-center px-4">
      <div className="w-full max-w-[560px] rounded-xl border border-border bg-surface-primary shadow-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-red-50 text-red-600 inline-flex items-center justify-center shrink-0">
            <Link2 className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-text-primary">{clipboardCapturePlatformLabel(clipboardCapture.candidate)}链接</h3>
            <p className="text-sm text-text-secondary mt-1">将作品保存到本机素材库，媒体和评论按可获取内容保存。</p>
            <div className="mt-3 rounded-md border border-border bg-surface-secondary px-3 py-2 text-xs text-text-tertiary break-all">
              {clipboardCapture.candidate.rawUrl}
            </div>
            <div className="mt-2 text-xs text-text-secondary">
              作品 ID：<span className="font-mono">{clipboardCapture.candidate.externalId || '打开链接后识别'}</span>
            </div>
          </div>
        </div>

        {clipboardCapture.candidate.platform !== 'youtube' && <label className="mt-4 flex items-center gap-3 text-sm text-text-secondary">评论数量（0 表示关闭）<input aria-label="评论数量" type="number" min={0} max={200} value={clipboardCapture.commentLimit} disabled={clipboardCapture.status === 'saving'} onChange={(event) => clipboardCapture.setCommentLimit(Math.max(0, Math.min(200, Number(event.target.value) || 0)))} className="w-20 rounded border border-border px-2 py-1" /></label>}
        {clipboardCapture.message && (
          <div className={`mt-4 text-sm ${
            clipboardCapture.status === 'error' ? 'text-red-600' : clipboardCapture.status === 'success' ? 'text-green-600' : 'text-text-secondary'
          }`}>
            {clipboardCapture.message}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={clipboardCapture.close}
            disabled={clipboardCapture.status === 'saving'}
            className="h-9 px-4 rounded-md border border-border text-sm text-text-secondary hover:text-text-primary hover:bg-surface-secondary disabled:opacity-50"
          >
            {t('app.cancel')}
          </button>
          <button
            onClick={() => void clipboardCapture.confirm()}
            disabled={clipboardCapture.status === 'saving'}
            className="h-9 px-4 rounded-md bg-[rgb(var(--color-accent-primary))] text-white text-sm hover:bg-[rgb(var(--color-accent-hover))] disabled:opacity-50 inline-flex items-center gap-2"
          >
            {clipboardCapture.status === 'saving' && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('app.confirmCapture')}
          </button>
        </div>
      </div>
    </div>
  );
}
