import assert from 'node:assert/strict';
import test from 'node:test';
import { gardenFlowHeartbeatSessionBinding } from '../shared/gardenflowHeartbeat.ts';

test('isolates heartbeat reports from the GardenFlow user session', () => {
  const binding = gardenFlowHeartbeatSessionBinding('default');
  assert.equal(binding.sessionId, 'session_gardenflow_heartbeat_default');
  assert.equal(binding.contextId, 'gardenflow-heartbeat:default');
  assert.equal(binding.contextType, 'gardenflow-heartbeat');
  assert.notEqual(binding.contextId, 'gardenflow-singleton:default');
});
