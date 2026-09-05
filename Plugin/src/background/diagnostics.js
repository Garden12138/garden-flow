import { getNativeStatus } from './nativeTransport.js';

export const PLUGIN_DIAGNOSTICS_RECORDS_KEY = 'gardenflowPluginDiagnosticsRecords';

const RECORD_LIMIT = 40;
const SAME_ERROR_COOLDOWN_MS = 60_000;
const MAX_MESSAGE_CHARS = 600;
const MAX_FIELD_CHARS = 500;

let enqueuePromise = Promise.resolve();

export async function reportPluginError(error, options = {}) {
  const next = enqueuePromise.then(() => savePluginError(error, options));
  enqueuePromise = next.catch(() => {});
  return await next;
}

async function savePluginError(error, options = {}) {
  const payload = buildPluginDiagnosticPayload(error, options);
  const dedupeKey = buildDedupeKey(payload);
  const now = Date.now();
  const records = await listPluginDiagnostics();
  const recent = records.find((entry) => (
    entry?.dedupeKey === dedupeKey
    && now - Number(entry.lastSeenAt || entry.createdAt || 0) < SAME_ERROR_COOLDOWN_MS
  ));

  if (recent) {
    const nextRecords = records.map((entry) => entry.id === recent.id
      ? {
          ...entry,
          lastSeenAt: now,
          occurrences: Math.min(999, Number(entry.occurrences || 1) + 1),
        }
      : entry);
    await writeRecords(nextRecords);
    return { success: true, localOnly: true, saved: false, reason: 'deduplicated', count: nextRecords.length };
  }

  const nextRecords = [...records, {
    id: `plugin-diagnostic-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    dedupeKey,
    createdAt: now,
    lastSeenAt: now,
    occurrences: 1,
    payload,
  }].slice(-RECORD_LIMIT);
  await writeRecords(nextRecords);
  return { success: true, localOnly: true, saved: true, count: nextRecords.length };
}

export async function listPluginDiagnostics() {
  const result = await callChromePromise(
    globalThis.chrome?.storage?.local?.get?.([PLUGIN_DIAGNOSTICS_RECORDS_KEY]),
    {},
  );
  return Array.isArray(result?.[PLUGIN_DIAGNOSTICS_RECORDS_KEY])
    ? result[PLUGIN_DIAGNOSTICS_RECORDS_KEY].filter((entry) => entry && typeof entry === 'object').slice(-RECORD_LIMIT)
    : [];
}

export async function clearPluginDiagnostics() {
  await writeRecords([]);
  return { success: true, localOnly: true };
}

export async function drainPluginDiagnostics() {
  const records = await listPluginDiagnostics();
  return { success: true, localOnly: true, sent: 0, queued: records.length };
}

export async function exportPluginDiagnostics() {
  const records = await listPluginDiagnostics();
  const report = {
    schema: 'gardenflow.plugin-diagnostics.v1',
    exportedAt: new Date().toISOString(),
    localOnly: true,
    records,
  };
  const content = JSON.stringify(report, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(content)}`;
  const filename = `GardenFlow-plugin-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const downloadId = await globalThis.chrome?.downloads?.download?.({
    url,
    filename,
    saveAs: true,
  });
  return { success: true, localOnly: true, count: records.length, downloadId };
}

export function buildPluginDiagnosticPayload(error, options = {}) {
  const errorRecord = error && typeof error === 'object' ? error : {};
  const manifest = globalThis.chrome?.runtime?.getManifest?.() || {};
  return {
    level: safeToken(options.level || 'error', 'error'),
    category: safeToken(options.category || 'plugin.browser', 'plugin.browser'),
    event: safeToken(options.event || 'plugin.error', 'plugin.error'),
    trigger: safeToken(options.trigger || 'plugin_error', 'plugin_error'),
    message: redactText(options.message || errorRecord.message || error || 'Browser plugin error', MAX_MESSAGE_CHARS),
    fields: sanitizeValue({
      source: 'browser_extension',
      extensionVersion: String(manifest.version_name || manifest.version || '').slice(0, 32),
      browser: detectBrowserFamily(),
      operation: safeToken(options.operation || 'unknown', 'unknown'),
      code: safeToken(options.code || errorRecord.code || 'PLUGIN_ERROR', 'PLUGIN_ERROR'),
      phase: safeToken(options.phase || errorRecord.phase || '', ''),
      retryable: errorRecord.retryable === true || options.retryable === true,
      errorName: String(errorRecord.name || '').slice(0, 80),
      nativeStatus: compactNativeStatus(getNativeStatus()),
      ...(options.sourceOrigin ? { sourceOrigin: safeOrigin(options.sourceOrigin) } : {}),
      ...(options.fields && typeof options.fields === 'object' ? options.fields : {}),
      ...(errorRecord.details ? { details: errorRecord.details } : {}),
    }),
  };
}

function buildDedupeKey(payload) {
  const fields = payload.fields || {};
  return [
    payload.category,
    payload.event,
    fields.operation,
    fields.code,
    fields.phase,
  ].map((value) => String(value || '').slice(0, 96)).join(':').slice(0, 320);
}

async function writeRecords(records) {
  await globalThis.chrome?.storage?.local?.set?.({
    [PLUGIN_DIAGNOSTICS_RECORDS_KEY]: Array.isArray(records) ? records.slice(-RECORD_LIMIT) : [],
  });
}

function compactNativeStatus(status = {}) {
  return {
    state: safeToken(status.state || 'unknown', 'unknown'),
    reconnectAttempt: Number.isInteger(Number(status.reconnectAttempt)) ? Number(status.reconnectAttempt) : 0,
    error: redactText(status.error || '', 240),
    desktopBridgeConnected: status.handshake?.desktopBridge?.connected === true,
  };
}

function sanitizeValue(value, key = '', depth = 0) {
  if (depth > 3) return '[TRUNCATED]';
  if (isSensitiveKey(key)) return '[REDACTED_SECRET]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/url|link|origin|href|source/i.test(key)) return safeOrigin(value);
    return redactText(value, MAX_FIELD_CHARS);
  }
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => sanitizeValue(item, key, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 24)
        .map(([childKey, childValue]) => [childKey, sanitizeValue(childValue, childKey, depth + 1)]),
    );
  }
  return String(value).slice(0, MAX_FIELD_CHARS);
}

function isSensitiveKey(key) {
  return /authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|access[_-]?key|refresh|content|html|markdown|body|payload|attachment|base64|binary|blob|raw|file|image|media|path/i.test(String(key || ''));
}

function redactText(value, maxChars) {
  return String(value ?? '')
    .replace(/data:(?:image|audio|video)\/[\w.+-]+;base64,[^\s]+/gi, '[REDACTED_DATA_URI]')
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED_SECRET]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
    .replace(/([?&](?:token|access_token|refresh_token|api_key|apikey|secret|code|signature)=)[^&\s]+/gi, '$1[REDACTED_SECRET]')
    .replace(/(?:[A-Za-z]:\\|\/Users\/|\/home\/|\/var\/folders\/)[^\s,;]+/g, '[REDACTED_PATH]')
    .slice(0, maxChars);
}

function safeOrigin(value) {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw);
    return /^https?:$/i.test(url.protocol) ? url.origin : '[REDACTED_URL]';
  } catch {
    return redactText(raw, 160);
  }
}

function safeToken(value, fallback) {
  const normalized = String(value || '').trim().replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 96);
  return normalized || fallback;
}

async function callChromePromise(value, fallback) {
  try {
    return await value;
  } catch {
    return fallback;
  }
}

function detectBrowserFamily() {
  const userAgent = String(globalThis.navigator?.userAgent || '');
  if (/Edg\//i.test(userAgent)) return 'edge';
  if (/Brave\//i.test(userAgent) || globalThis.navigator?.brave) return 'brave';
  if (/Chromium\//i.test(userAgent)) return 'chromium';
  if (/Chrome\//i.test(userAgent)) return 'chrome';
  return 'unknown';
}
