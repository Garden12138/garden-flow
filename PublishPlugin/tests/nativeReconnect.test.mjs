import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as adapter from '../src/pageAdapter.js';

async function fixture() {
  const stored = { gardenflowXhsPublisherInstanceId: 'original-browser', gardenflowXhsPublisherPreparedJob: { jobId: 'old-job', mediaSources: ['blob:original'] } };
  const state = { available: true, portCount: 0, pingCount: 0, registered: [], alarms: [], handlers: {}, desktopInstances: new Set() };
  let onMessage;
  const port = {
    onMessage: { addListener(fn) { onMessage = fn; } }, onDisconnect: { addListener() {} }, disconnect() {},
    postMessage(message) {
      queueMicrotask(() => {
        if (message.method === 'ping') state.pingCount += 1;
        if (message.method === 'extension.register') { state.registered.push(message.params); state.desktopInstances.add(message.params.extensionInstanceId); }
        onMessage({ jsonrpc: '2.0', id: message.id, result: message.method === 'ping' ? { desktopBridge: { connected: state.available } } : { registered: true } });
      });
    },
  };
  const noop = { addListener() {} };
  const chrome = {
    runtime: { connectNative() { state.portCount += 1; return port; }, getManifest: () => ({ version: '0.0.1' }), onMessage: noop, onInstalled: noop, onStartup: noop },
    alarms: { create: async (name, info) => state.alarms.push({ name, ...info }), onAlarm: { addListener(fn) { state.handlers.alarm = fn; } } },
    storage: { local: { get: async key => ({ [key]: stored[key] }), set: async values => Object.assign(stored, values) } },
  };
  const context = vm.createContext({ ...adapter, chrome, navigator: { userAgent: 'Chrome' }, crypto, setTimeout, clearTimeout });
  const source = (await readFile(new URL('../src/background.js', import.meta.url), 'utf8'))
    .replace(/^import \{[\s\S]*?\} from '\.\/pageAdapter\.js';/, '')
    .replace(/^import \{[^\n]+\} from '\.\/douyinPublisher\.js';/m, '');
  vm.runInContext(`${source}\nglobalThis.api={connectNative,getState:()=>({connected:nativeConnected,error:nativeConnectionError})};`, context);
  await context.api.connectNative();
  return { state, stored, api: context.api };
}

test('publisher heartbeat restores same desktop registration while native port survives restart', async () => {
  const f = await fixture();
  assert.equal(f.api.getState().connected, true);
  f.state.desktopInstances.clear();
  f.state.available = false;
  f.state.handlers.alarm({ name: 'gardenflow-xhs-publisher-reconnect' });
  await f.api.connectNative();
  assert.equal(f.api.getState().connected, false);
  assert.equal(f.state.registered.length, 1);
  f.state.available = true;
  f.state.handlers.alarm({ name: 'gardenflow-xhs-publisher-reconnect' });
  await Promise.all([f.api.connectNative(), f.api.connectNative()]);
  assert.equal(f.api.getState().connected, true);
  assert.equal(f.state.portCount, 1);
  assert.equal(f.state.registered.length, 2);
  assert.deepEqual([...f.state.desktopInstances], ['original-browser']);
  assert.equal(f.stored.gardenflowXhsPublisherPreparedJob.jobId, 'old-job');
  assert.deepEqual(f.stored.gardenflowXhsPublisherPreparedJob.mediaSources, ['blob:original']);
  assert.ok(f.state.alarms.every(alarm => alarm.periodInMinutes === 0.5));
});
