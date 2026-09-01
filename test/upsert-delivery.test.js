import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyUpsertMessage,
  isActiveDeliverySource,
  messageTimestampMs
} from '../src/whatsapp/upsert-delivery.js';

const NOW_MS = Date.parse('2026-09-01T09:00:00.000Z');

test('processes notify upserts as realtime messages', () => {
  assert.deepEqual(
    classifyUpsertMessage('notify', { messageTimestamp: NOW_MS / 1000 }, { nowMs: NOW_MS }),
    { source: 'realtime', activeDelivery: true }
  );
});

test('processes recent append upserts as active catch-up messages', () => {
  assert.deepEqual(
    classifyUpsertMessage('append', { messageTimestamp: (NOW_MS - 60_000) / 1000 }, { nowMs: NOW_MS }),
    { source: 'catchup', activeDelivery: true }
  );
});

test('stores old append upserts as history without active processing', () => {
  assert.deepEqual(
    classifyUpsertMessage('append', { messageTimestamp: (NOW_MS - 25 * 60 * 60 * 1000) / 1000 }, { nowMs: NOW_MS }),
    { source: 'history', activeDelivery: false }
  );
});

test('supports protobuf-style timestamp values', () => {
  assert.equal(messageTimestampMs({ messageTimestamp: { toNumber: () => NOW_MS / 1000 } }), NOW_MS);
  assert.equal(isActiveDeliverySource('catchup'), true);
  assert.equal(isActiveDeliverySource('history'), false);
});
