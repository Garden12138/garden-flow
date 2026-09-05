#!/usr/bin/env node

import assert from 'node:assert/strict';

const storage = {};
const downloads = [];
let networkCalls = 0;

globalThis.chrome = {
  runtime: {
    getManifest: () => ({ version_name: '2.6.19' }),
  },
  storage: {
    local: {
      get: async (keys) => Object.fromEntries(
        (Array.isArray(keys) ? keys : Object.keys(keys || {})).map((key) => [key, storage[key]]),
      ),
      set: async (values) => Object.assign(storage, values),
    },
  },
  downloads: {
    download: async (options) => {
      downloads.push(options);
      return downloads.length;
    },
  },
};

globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error('diagnostics must not use the network');
};

const {
  PLUGIN_DIAGNOSTICS_RECORDS_KEY,
  buildPluginDiagnosticPayload,
  drainPluginDiagnostics,
  exportPluginDiagnostics,
  listPluginDiagnostics,
  reportPluginError,
} = await import('../src/background/diagnostics.js');

const payload = buildPluginDiagnosticPayload(
  Object.assign(new Error('capture failed at https://example.com/private?token=secret'), {
    details: {
      body: 'page content must not enter diagnostics',
      token: 'secret-token',
      path: '/Users/example/private/page.html',
    },
  }),
  {
    category: 'plugin.capture',
    event: 'plugin.capture.failed',
    operation: 'capture.tab',
    sourceOrigin: 'https://example.com/private?token=secret',
    fields: {
      sourceUrl: 'https://example.com/private?token=secret',
      content: 'page content must not enter diagnostics',
      count: 2,
    },
  },
);

const serializedPayload = JSON.stringify(payload);
assert.equal(payload.fields.sourceOrigin, 'https://example.com');
assert.equal(payload.fields.sourceUrl, 'https://example.com');
assert(!serializedPayload.includes('secret-token'));
assert(!serializedPayload.includes('page content must not enter diagnostics'));
assert(!serializedPayload.includes('/Users/example/private/page.html'));
assert(!serializedPayload.includes('/private?token=secret'));

const first = await reportPluginError(new Error('native host disconnected'), {
  category: 'plugin.connection',
  event: 'plugin.connection.failed',
  operation: 'native-transport',
  trigger: 'plugin_connection_error',
  code: 'NATIVE_HOST_DISCONNECTED',
  phase: 'native_messaging',
});
assert.equal(first.localOnly, true);
assert.equal(first.saved, true);
assert.equal((await listPluginDiagnostics()).length, 1);

const duplicate = await reportPluginError(new Error('native host disconnected'), {
  category: 'plugin.connection',
  event: 'plugin.connection.failed',
  operation: 'native-transport',
  trigger: 'plugin_connection_error',
  code: 'NATIVE_HOST_DISCONNECTED',
  phase: 'native_messaging',
});
assert.equal(duplicate.localOnly, true);
assert.equal(duplicate.saved, false);
assert.equal(duplicate.reason, 'deduplicated');
assert.equal((await listPluginDiagnostics())[0].occurrences, 2);

for (let index = 0; index < 45; index += 1) {
  await reportPluginError(new Error(`bounded error ${index}`), {
    category: 'plugin.bounded-test',
    event: `plugin.bounded-test.${index}`,
    operation: `bounded-${index}`,
    code: `BOUNDED_${index}`,
  });
}
assert.equal(storage[PLUGIN_DIAGNOSTICS_RECORDS_KEY].length, 40);

const drain = await drainPluginDiagnostics();
assert.deepEqual(drain, { success: true, localOnly: true, sent: 0, queued: 40 });
assert.equal(networkCalls, 0);

const exported = await exportPluginDiagnostics();
assert.equal(exported.success, true);
assert.equal(exported.localOnly, true);
assert.equal(exported.count, 40);
assert.equal(downloads.length, 1);
assert.match(downloads[0].url, /^data:application\/json/);
assert.equal(downloads[0].saveAs, true);
assert.equal(networkCalls, 0);

console.log(JSON.stringify({
  ok: true,
  localRecords: storage[PLUGIN_DIAGNOSTICS_RECORDS_KEY].length,
  exportedReports: downloads.length,
  networkCalls,
}, null, 2));
