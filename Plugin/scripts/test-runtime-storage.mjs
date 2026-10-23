import assert from 'node:assert/strict';
import test from 'node:test';
import { setStoredMap } from '../src/background/storage.js';

const sessionsKey = 'gardenflowBrowserDataAiSessions';
const eventsKey = 'gardenflowBrowserDataAiBrowserEvents';

function installStorage(initial = {}, quota = Infinity) {
  let state = structuredClone(initial);
  let writes = 0;
  const size = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  globalThis.chrome = { storage: { session: {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in state).map(key => [key, structuredClone(state[key])])); },
    async set(values) {
      writes += 1;
      const next = { ...state, ...structuredClone(values) };
      if (size(next) > quota) throw new Error('Session storage quota bytes exceeded. Values were not stored.');
      state = next;
    },
  } } };
  return { read: () => state, writes: () => writes };
}

test('limits cached UTF-8 response bytes while keeping terminal replay receipts and live sessions', async () => {
  const storage = installStorage();
  const sessions = {};
  for (let i = 0; i < 70; i += 1) {
    const id = `session-${i}`;
    sessions[id] = { sessionId: id, createdAt: String(i).padStart(3, '0'), currentTurnId: null, recentRequests: {
      call: { terminal: true, responsePersisted: true, finishedAt: String(i).padStart(3, '0'), response: '采'.repeat(40000) },
    } };
  }
  sessions.live = { currentTurnId: 'active-turn', ownedTabIds: [42], recentRequests: { call: { terminal: true, responsePersisted: true, response: '采'.repeat(50000) } } };
  const original = structuredClone(sessions);
  await setStoredMap(sessionsKey, sessions);
  const saved = storage.read()[sessionsKey];
  assert.equal(Object.keys(saved).length, 51);
  assert.equal(saved.live.currentTurnId, 'active-turn');
  assert.deepEqual(saved.live.ownedTabIds, [42]);
  assert.equal(saved.live.recentRequests.call.responsePersisted, false);
  assert.equal(saved['session-69'].recentRequests.call.responsePersisted, true);
  assert.equal(saved['session-20'].recentRequests.call.terminal, true);
  assert.equal(saved['session-20'].recentRequests.call.response, null);
  assert(new TextEncoder().encode(JSON.stringify(saved)).byteLength < 2.1 * 1024 * 1024);
  assert.deepEqual(sessions, original);
});

test('quota recovery compacts legacy histories without clearing settings, leases or active requests', async () => {
  const history = {};
  for (let i = 0; i < 100; i += 1) history[i] = { emittedAt: String(i).padStart(3, '0'), payload: 'x'.repeat(100000) };
  const storage = installStorage({
    [eventsKey]: history,
    settings: { commentLimit: 5 },
    gardenflowBrowserDataAiTabLeases: { 42: { sessionId: 'live' } },
    [sessionsKey]: { live: { currentTurnId: 'turn', activeRequests: { call: { action: 'capture.save' } }, recentRequests: {} } },
  }, 1024 * 1024);
  await setStoredMap('gardenflowBrowserDataAiTabGroups', { group: { tabIds: [42] } });
  const saved = storage.read();
  assert.equal(storage.writes(), 2);
  assert.equal(Object.keys(saved[eventsKey]).length, 5);
  assert(saved[eventsKey]['99']);
  assert.deepEqual(saved.settings, { commentLimit: 5 });
  assert.deepEqual(saved.gardenflowBrowserDataAiTabLeases, { 42: { sessionId: 'live' } });
  assert.equal(saved[sessionsKey].live.activeRequests.call.action, 'capture.save');
  assert.deepEqual(saved.gardenflowBrowserDataAiTabGroups, { group: { tabIds: [42] } });
});

test('non-quota storage errors are returned without a cleanup attempt', async () => {
  let reads = 0;
  globalThis.chrome = { storage: { session: {
    async get() { reads += 1; return {}; },
    async set() { throw new Error('Extension context invalidated'); },
  } } };
  await assert.rejects(setStoredMap(eventsKey, {}), /Extension context invalidated/);
  assert.equal(reads, 0);
});
