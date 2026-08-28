import assert from 'node:assert/strict';
import test from 'node:test';

import { getDisconnectPolicy } from '../src/whatsapp/disconnect-policy.js';

const disconnectReason = {
  loggedOut: 401,
  connectionReplaced: 440,
  restartRequired: 515
};

test('forces a reconnect when WhatsApp accepts pairing and requests a restart', () => {
  assert.deepEqual(getDisconnectPolicy(515, disconnectReason), {
    isRestartRequired: true,
    isRateLimited: false,
    shouldReconnect: true
  });
});

test('suppresses reconnect after logout or session replacement', () => {
  assert.equal(getDisconnectPolicy(401, disconnectReason).shouldReconnect, false);
  assert.equal(getDisconnectPolicy(440, disconnectReason).shouldReconnect, false);
});

test('reconnects ordinary and rate-limited disconnects', () => {
  assert.deepEqual(getDisconnectPolicy(429, disconnectReason), {
    isRestartRequired: false,
    isRateLimited: true,
    shouldReconnect: true
  });
  assert.equal(getDisconnectPolicy(500, disconnectReason).shouldReconnect, true);
});
