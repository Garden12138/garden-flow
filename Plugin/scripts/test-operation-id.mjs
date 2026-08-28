import assert from 'node:assert/strict';
import { createBridgeOperationId } from '../src/background/operationId.js';

const payload = {
  source: { externalId: 'note-1' },
  note: { noteId: 'note-1', title: '测试笔记' },
};

const first = createBridgeOperationId('knowledge.ingestXhsEntryV2', payload);
const second = createBridgeOperationId('knowledge.ingestXhsEntryV2', payload);
assert.notEqual(first, second, 'separate capture attempts must not replay a cached successful result');
assert.match(first, /^knowledge\.ingestXhsEntryV2:[a-f0-9]{8}:/);

const retryPayload = { ...payload, operationId: 'capture-attempt-1' };
assert.equal(
  createBridgeOperationId('knowledge.ingestXhsEntryV2', retryPayload),
  createBridgeOperationId('knowledge.ingestXhsEntryV2', retryPayload),
  'an explicit operation id must remain stable for transport retries',
);
assert(!createBridgeOperationId('knowledge.ingestEntry', { operationId: 'private-attempt-name' }).includes('private-attempt-name'));

console.log(JSON.stringify({ ok: true, scenarios: ['capture_attempt_unique', 'explicit_retry_stable'] }));
