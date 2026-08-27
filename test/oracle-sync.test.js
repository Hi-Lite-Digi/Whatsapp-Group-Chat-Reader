import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isConfiguredSupplierMessage,
  normalizeTyreSize,
  supplierSenderIdsForGroup
} from '../src/oracle/sync.js';

test('normalizes common passenger tyre-size formats', () => {
  for (const input of ['225/45R18', '225/45/18', '225 45 18', '2254518']) {
    assert.equal(normalizeTyreSize(input), '225/45/18');
  }
});

test('preserves commercial tyre sizes without a profile', () => {
  assert.equal(normalizeTyreSize('195R15C 106/104S'), '195R15C');
  assert.equal(normalizeTyreSize('195 R 15 C'), '195R15C');
});

test('rejects invalid sizes', () => {
  assert.equal(normalizeTyreSize('105ah AGM battery'), null);
  assert.equal(normalizeTyreSize('999/99R99'), null);
});

test('only configured supplier identities can trigger quotation sync', () => {
  const group = {
    oracle_supplier_sender_ids: '6587540420@s.whatsapp.net, 53060227322097@lid'
  };
  assert.deepEqual([...supplierSenderIdsForGroup(group)], [
    '6587540420@s.whatsapp.net',
    '53060227322097@lid'
  ]);
  assert.equal(isConfiguredSupplierMessage({ sender_id: '53060227322097@lid' }, group), true);
  assert.equal(isConfiguredSupplierMessage({ sender_id: '6598989111@s.whatsapp.net' }, group), false);
});
