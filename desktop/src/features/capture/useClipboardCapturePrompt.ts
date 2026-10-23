import { useCallback, useEffect, useRef, useState } from 'react';
import { detectClipboardCaptureCandidate, clipboardCaptureDedupeKey, clipboardCapturePlatformLabel } from './clipboardDetector';
import { enqueueClipboardCapture } from './browserCaptureClient';
import type { ClipboardCaptureCandidate } from './captureTypes';

const CLIPBOARD_POLL_BOOT_DELAY_MS = 4000;
const CLIPBOARD_POLL_FOCUS_DELAY_MS = 1500;
const CLIPBOARD_POLL_MIN_INTERVAL_MS = 12_000;
const CLIPBOARD_POLL_IDLE_INTERVAL_MS = 45_000;
const CLIPBOARD_POLL_MAX_INTERVAL_MS = 120_000;

export type ClipboardCaptureStatus = 'idle' | 'saving' | 'success' | 'partial' | 'error';

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

export function useClipboardCapturePrompt() {
  const [candidate, setCandidate] = useState<ClipboardCaptureCandidate | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ClipboardCaptureStatus>('idle');
  const [message, setMessage] = useState('');
  const [commentLimit, setCommentLimit] = useState(5);

  const lastClipboardTextRef = useRef('');
  const pollingRef = useRef(false);
  const capturedYouTubeSetRef = useRef<Set<string>>(new Set());
  const promptOpenRef = useRef(false);
  const statusRef = useRef<ClipboardCaptureStatus>('idle');

  useEffect(() => {
    promptOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const enqueueFromClipboard = useCallback((nextCandidate: ClipboardCaptureCandidate) => enqueueClipboardCapture(nextCandidate, commentLimit), [commentLimit]);

  const close = useCallback(() => {
    if (status === 'saving') return;
    setOpen(false);
    setCandidate(null);
    setStatus('idle');
    setMessage('');
  }, [status]);

  const confirm = useCallback(async () => {
    if (!candidate || status === 'saving') return;

    setStatus('saving');
    setMessage('正在加入后台采集...');

    try {
      const result = await enqueueFromClipboard(candidate);
      if (!result.success) throw new Error(result.error || '采集失败');
      if (candidate.platform === 'youtube') capturedYouTubeSetRef.current.add(clipboardCaptureDedupeKey(candidate));
      setStatus(result.partial ? 'partial' : 'success');
      setMessage(result.partial ? `已部分保存，可在素材库重试补采。${result.error || ''}` : (
        result.updated ? '已更新原有素材。' : result.duplicate
          ? '素材已在知识库中。'
          : '已保存采集结果，可在素材库查看。'
      ));
      window.setTimeout(() => {
        setOpen(false);
        setCandidate(null);
        setStatus('idle');
        setMessage('');
      }, result.partial ? 5000 : 1000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setStatus('error');
      setMessage(`采集失败：${errorMessage}`);
    }
  }, [candidate, enqueueFromClipboard, status]);

  useEffect(() => {
    (window as unknown as { __gardenflowGlobalClipboardWatcher?: boolean }).__gardenflowGlobalClipboardWatcher = true;
    let disposed = false;
    let pollTimerId: number | null = null;
    let nextPollDelayMs = CLIPBOARD_POLL_MIN_INTERVAL_MS;

    const clearPollTimer = () => {
      if (pollTimerId !== null) {
        window.clearTimeout(pollTimerId);
        pollTimerId = null;
      }
    };

    const shouldReadClipboard = () => (
      !disposed
      && !pollingRef.current
      && !promptOpenRef.current
      && statusRef.current !== 'saving'
      && document.visibilityState === 'visible'
      && document.hasFocus()
      && !isEditableElement(document.activeElement)
    );

    const applyClipboardText = (text: string): boolean => {
      const normalizedText = String(text || '').trim();
      if (!normalizedText || normalizedText === lastClipboardTextRef.current) {
        return false;
      }

      lastClipboardTextRef.current = normalizedText;
      const nextCandidate = detectClipboardCaptureCandidate(normalizedText, 'poll');
      if (!nextCandidate) return false;
      if (capturedYouTubeSetRef.current.has(clipboardCaptureDedupeKey(nextCandidate))) return false;

      setCandidate(nextCandidate);
      setStatus('idle');
      setMessage(`检测到${clipboardCapturePlatformLabel(nextCandidate)}链接，确认后开始采集。`);
      setOpen(true);
      return true;
    };

    const schedulePoll = (delayMs = nextPollDelayMs) => {
      if (disposed) return;
      clearPollTimer();
      pollTimerId = window.setTimeout(() => {
        pollTimerId = null;
        void runPoll();
      }, Math.max(0, delayMs));
    };

    const runPoll = async () => {
      if (!shouldReadClipboard()) {
        schedulePoll(CLIPBOARD_POLL_IDLE_INTERVAL_MS);
        return;
      }

      pollingRef.current = true;
      try {
        const text = await window.ipcRenderer.clipboardReadText() as string;
        const foundCandidate = applyClipboardText(text);
        nextPollDelayMs = foundCandidate
          ? CLIPBOARD_POLL_IDLE_INTERVAL_MS
          : Math.min(Math.max(nextPollDelayMs * 2, CLIPBOARD_POLL_MIN_INTERVAL_MS), CLIPBOARD_POLL_MAX_INTERVAL_MS);
      } finally {
        pollingRef.current = false;
        schedulePoll(nextPollDelayMs);
      }
    };

    const bootTimerId = window.setTimeout(() => {
      schedulePoll(CLIPBOARD_POLL_FOCUS_DELAY_MS);
    }, CLIPBOARD_POLL_BOOT_DELAY_MS);

    const handleFocus = () => {
      nextPollDelayMs = CLIPBOARD_POLL_MIN_INTERVAL_MS;
      schedulePoll(CLIPBOARD_POLL_FOCUS_DELAY_MS);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleFocus();
      } else {
        clearPollTimer();
      }
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (isEditableElement(event.target) || promptOpenRef.current || statusRef.current === 'saving') return;
      if (applyClipboardText(event.clipboardData?.getData('text') || '')) {
        nextPollDelayMs = CLIPBOARD_POLL_IDLE_INTERVAL_MS;
        schedulePoll(nextPollDelayMs);
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('paste', handlePaste);

    return () => {
      disposed = true;
      window.clearTimeout(bootTimerId);
      clearPollTimer();
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('paste', handlePaste);
    };
  }, []);

  return {
    candidate,
    commentLimit,
    setCommentLimit,
    open,
    status,
    message,
    close,
    confirm,
  };
}
