const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

type ErrorRecord = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  errno?: unknown;
  syscall?: unknown;
  hostname?: unknown;
  cause?: unknown;
};

export interface LlmFetchRetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  reason: string;
  status?: number;
}

export interface LlmFetchRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fetchImpl?: typeof fetch;
  onRetry?: (info: LlmFetchRetryInfo) => void;
}

const compactPart = (value: unknown): string => String(value || '').trim().slice(0, 500);

const asErrorRecord = (value: unknown): ErrorRecord | null => (
  value && typeof value === 'object' ? value as ErrorRecord : null
);

export function formatLlmFetchError(error: unknown): string {
  const root = asErrorRecord(error);
  const cause = asErrorRecord(root?.cause);
  const parts = [
    compactPart(root?.message) || compactPart(error) || 'LLM request failed',
    compactPart(cause?.message),
    compactPart(cause?.code || root?.code) ? `code=${compactPart(cause?.code || root?.code)}` : '',
    compactPart(cause?.syscall || root?.syscall) ? `syscall=${compactPart(cause?.syscall || root?.syscall)}` : '',
    compactPart(cause?.hostname || root?.hostname) ? `host=${compactPart(cause?.hostname || root?.hostname)}` : '',
  ].filter(Boolean);
  return Array.from(new Set(parts)).join(' | ');
}

export function isRetryableLlmFetchError(error: unknown): boolean {
  const root = asErrorRecord(error);
  const cause = asErrorRecord(root?.cause);
  const code = compactPart(cause?.code || root?.code).toUpperCase();
  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }
  const message = formatLlmFetchError(error).toLowerCase();
  return (
    message.includes('fetch failed')
    || message.includes('network')
    || message.includes('socket')
    || message.includes('temporarily unavailable')
    || message.includes('connection reset')
    || message.includes('timed out')
    || message.includes('timeout')
  );
}

function retryDelayFromResponse(response: Response, fallbackMs: number, maxDelayMs: number): number {
  const retryAfter = String(response.headers.get('retry-after') || '').trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(maxDelayMs, Math.max(0, Math.round(seconds * 1000)));
    }
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) {
      return Math.min(maxDelayMs, Math.max(0, timestamp - Date.now()));
    }
  }
  return Math.min(maxDelayMs, fallbackMs);
}

function waitForRetry(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Error('LLM request cancelled'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('LLM request cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchLlmWithRetry(
  input: string | URL,
  init: RequestInit,
  options: LlmFetchRetryOptions = {},
): Promise<Response> {
  const maxAttempts = Math.max(1, Math.min(4, Math.floor(options.maxAttempts || 2)));
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 500));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(options.maxDelayMs ?? 5000));
  const fetchImpl = options.fetchImpl || fetch;
  const signal = init.signal;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(input, init);
      if (!RETRYABLE_HTTP_STATUS.has(response.status) || attempt >= maxAttempts || signal?.aborted) {
        return response;
      }
      const fallbackDelay = baseDelayMs * (2 ** (attempt - 1));
      const delayMs = retryDelayFromResponse(response, fallbackDelay, maxDelayMs);
      options.onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        reason: `HTTP ${response.status}`,
        status: response.status,
      });
      await response.body?.cancel().catch(() => undefined);
      await waitForRetry(delayMs, signal);
    } catch (error) {
      lastError = error;
      if (signal?.aborted || attempt >= maxAttempts || !isRetryableLlmFetchError(error)) {
        const detailed = new Error(formatLlmFetchError(error));
        (detailed as Error & { cause?: unknown }).cause = error;
        throw detailed;
      }
      const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      options.onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        reason: formatLlmFetchError(error),
      });
      await waitForRetry(delayMs, signal);
    }
  }

  const detailed = new Error(formatLlmFetchError(lastError));
  (detailed as Error & { cause?: unknown }).cause = lastError;
  throw detailed;
}
