import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyHistoryMessage } from '../src/whatsapp/upsert-delivery.js';

test('treats requested history as active catch-up', () => {
  assert.deepEqual(classifyHistoryMessage({ messageTimestamp: 100 }, {
    peerDataRequestSessionId: 'request-1'
  }), { source: 'catchup', activeDelivery: true });
});

test('treats history newer than the stored group cutoff as active catch-up', () => {
  assert.deepEqual(classifyHistoryMessage({ messageTimestamp: 200 }, {
    latestStoredTimestamp: new Date(100_000).toISOString()
  }), { source: 'catchup', activeDelivery: true });
});

test('keeps old bootstrap history passive', () => {
  assert.deepEqual(classifyHistoryMessage({ messageTimestamp: 100 }, {
    latestStoredTimestamp: new Date(200_000).toISOString()
  }), { source: 'history', activeDelivery: false });
});

test('keeps first-time bootstrap history passive without a stored cutoff', () => {
  assert.deepEqual(classifyHistoryMessage({ messageTimestamp: 200 }, {}), {
    source: 'history',
    activeDelivery: false
  });
});
