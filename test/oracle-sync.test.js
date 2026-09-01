import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findSupersededCaseEvent,
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

test('a corrected price supersedes only the same case product', () => {
  const events = [
    {
      id: 11,
      payload_hash: 'old-price',
      sync_status: 'ready',
      brand: 'Michelin',
      model: 'Pilot Sport 5 XL',
      size: '235/55/19',
      price: 235
    },
    {
      id: 12,
      payload_hash: 'other-product',
      sync_status: 'ready',
      brand: 'Michelin',
      model: 'Pilot Sport 5',
      size: '225/45/18',
      price: 180
    }
  ];
  const corrected = findSupersededCaseEvent(events, {
    brand: 'Michelin', model: 'PS5', size: '235/55/19', price: 225
  }, 'new-price');
  assert.equal(corrected?.id, 11);
  assert.equal(findSupersededCaseEvent(events, {
    brand: 'Michelin', model: 'PS5', size: '245/45/19', price: 225
  }, 'different-size'), null);
  assert.equal(findSupersededCaseEvent(events, {
    brand: 'Michelin', model: 'PS5', size: '235/55/19', price: 235
  }, 'old-price'), null);
});
