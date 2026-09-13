import assert from 'node:assert/strict';
import test from 'node:test';
import {
  satisfiesUserAcknowledgement,
  shouldRequestToolConfirmation,
} from '../shared/toolConfirmationPolicy.ts';

test('auto-confirm cannot bypass a hard-gated tool confirmation', () => {
  assert.equal(shouldRequestToolConfirmation({
    requiresConfirmation: true,
    requiresUserAcknowledgement: true,
    isAutoConfirmed: true,
  }), true);
});

test('only the structured acknowledgement outcome satisfies a hard gate', () => {
  assert.equal(satisfiesUserAcknowledgement(true, 'proceed_once'), false);
  assert.equal(satisfiesUserAcknowledgement(true, 'proceed_always'), false);
  assert.equal(satisfiesUserAcknowledgement(true, 'cancel'), false);
  assert.equal(satisfiesUserAcknowledgement(true, 'proceed_after_user_acknowledgement'), true);
  assert.equal(satisfiesUserAcknowledgement(false, 'proceed_once'), true);
});
