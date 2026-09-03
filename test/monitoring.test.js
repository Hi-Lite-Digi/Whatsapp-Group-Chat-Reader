import assert from 'node:assert/strict';
import test from 'node:test';

import { monitorAuthorized, summarizeQueue } from '../src/server/monitoring.js';

test('monitor bearer authentication rejects missing and malformed credentials', () => {
  assert.equal(monitorAuthorized('', 'expected-token'), false);
  assert.equal(monitorAuthorized('expected-token', 'expected-token'), false);
  assert.equal(monitorAuthorized('Basic expected-token', 'expected-token'), false);
  assert.equal(monitorAuthorized('Bearer', 'expected-token'), false);
  assert.equal(monitorAuthorized('Bearer expected-token extra', 'expected-token'), false);
});

test('monitor bearer authentication accepts only the exact configured token', () => {
  assert.equal(monitorAuthorized('Bearer expected-token', 'expected-token'), true);
  assert.equal(monitorAuthorized('bearer expected-token', 'expected-token'), true);
  assert.equal(monitorAuthorized('Bearer wrong-token', 'expected-token'), false);
  assert.equal(monitorAuthorized('Bearer expected-toke', 'expected-token'), false);
  assert.equal(monitorAuthorized('Bearer expected-token', ''), false);
});

test('queue summary distinguishes actionable cases from terminal cases', () => {
  assert.deepEqual(summarizeQueue([
    { status: 'collecting' },
    { status: 'incomplete' },
    { status: 'ambiguous' },
    { status: 'ready' },
    { status: 'pushed' }
  ]), { queueDepth: 3, totalCases: 5 });
});
