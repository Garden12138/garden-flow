export async function getStoredMap(key) {
  const storage = chrome.storage.session || chrome.storage.local;
  const result = await storage.get(key);
  const value = result?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export async function setStoredMap(key, value) {
  const storage = chrome.storage.session || chrome.storage.local;
  const next = retainRuntimeHistory(key, value || {});
  try {
    await storage.set({ [key]: next });
  } catch (error) {
    if (!/quota.*exceed|exceed.*quota/i.test(String(error?.message || error))) throw error;
    // Older builds retained response bodies across every finished capture.
    // Compact only disposable runtime history; never clear leases or settings.
    const stored = await storage.get(HISTORY_KEYS);
    const compacted = Object.fromEntries(Object.entries(stored)
      .map(([name, history]) => [name, retainRuntimeHistory(name, history)]));
    await storage.set({ ...compacted, [key]: next });
  }
}

const SESSIONS_KEY = 'gardenflowBrowserDataAiSessions';
const EVENT_KEYS = [
  'gardenflowBrowserDataAiSessionEvents',
  'gardenflowBrowserDataAiBrowserEvents',
  'gardenflowBrowserDataAiCdpEvents',
];
const HISTORY_KEYS = [SESSIONS_KEY, ...EVENT_KEYS];
const encoder = new TextEncoder();
const size = value => encoder.encode(JSON.stringify(value)).byteLength;

function retainRuntimeHistory(key, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (EVENT_KEYS.includes(key)) {
    let bytes = 2;
    return Object.fromEntries(Object.entries(value)
      .sort(([, a], [, b]) => timestamp(b).localeCompare(timestamp(a)))
      .filter(([id, event]) => {
        const length = size({ [id]: event });
        if (bytes + length > 512 * 1024) return false;
        bytes += length;
        return true;
      }));
  }
  if (key !== SESSIONS_KEY) return value;
  let idleCount = 0;
  const sessions = Object.fromEntries(Object.entries(value)
    .sort(([, a], [, b]) => timestamp(b).localeCompare(timestamp(a)))
    .filter(([, session]) => {
      // Keep live turns and tabs even when the history budget is exhausted.
      const live = session.currentTurnId || session.activeRequestCount > 0
        || Object.keys(session.activeRequests || {}).length
        || session.ownedTabIds?.length || session.activeTabId;
      return live || ++idleCount <= 50;
    })
    .map(([id, session]) => [id, { ...session, recentRequests: { ...session.recentRequests } }]));
  let responseBytes = 0;
  const requests = Object.values(sessions).flatMap(session => Object.entries(session.recentRequests)
    .map(([id, request]) => ({ session, id, request })));
  requests.sort((a, b) => timestamp(b.request).localeCompare(timestamp(a.request)));
  for (const { session, id, request } of requests) {
    if (request.response == null) continue;
    const bytes = size(request.response);
    if (bytes > 128 * 1024 || responseBytes + bytes > 2 * 1024 * 1024) {
      // Preserve the terminal receipt so retries cannot execute an old call again.
      session.recentRequests[id] = { ...request, response: null, responsePersisted: false };
    } else {
      responseBytes += bytes;
    }
  }
  return sessions;
}

function timestamp(value = {}) {
  return String(value.updatedAt || value.finishedAt || value.emittedAt || value.receivedAt || value.recordedAt || value.createdAt || '');
}
