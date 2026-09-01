import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findExactOracleListing,
  findSupersededCaseEvent,
  isConfiguredSupplierMessage,
  normalizeTyreSize,
  supplierSenderIdsForGroup
} from '../src/oracle/sync.js';
import {
  buildOracleQuotationPayload,
  missingOracleReadyFields
} from '../src/oracle/readiness.js';

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

test('Oracle readiness requires quantity and confirmed ready-stock availability', () => {
  const incomplete = {
    brand: 'Falken', model: 'Azenis FK520L', size: '225/45/18', price: 130,
    stock_quantity: null, availability: 'unknown'
  };
  assert.deepEqual(missingOracleReadyFields(incomplete), ['quantity', 'confirmed_availability']);
  assert.deepEqual(missingOracleReadyFields({
    ...incomplete, stock_quantity: 2, availability: 'preorder'
  }), ['confirmed_availability']);
  assert.deepEqual(missingOracleReadyFields({
    ...incomplete, stock_quantity: 2, availability: 'ready_stock'
  }), []);
});

test('builds a complete Oracle payload and targets an existing tyre record when supplied', () => {
  const payload = buildOracleQuotationPayload({
    brand: 'Falken', model: 'Azenis FK520L', size: '225/45/18', price: 130,
    stock_quantity: 2, availability: 'ready_stock', year_of_manufacture: 2026,
    country_of_origin: 'Japan', is_commercial: false, quoted_at: '2026-09-01'
  }, { tyreId: 'oracle-tyre-1' });
  assert.deepEqual(payload, {
    tyre_id: 'oracle-tyre-1', brand: 'Falken', model: 'Azenis FK520L',
    size: '225/45/18', price: 130, stock_quantity: 2,
    availability: 'ready_stock', year_of_manufacture: 2026,
    country_of_origin: 'Japan', is_commercial: false, quoted_at: '2026-09-01'
  });
  assert.throws(() => buildOracleQuotationPayload({
    brand: 'Falken', model: 'Azenis FK520L', size: '225/45/18', price: 130,
    stock_quantity: null, availability: 'unknown', quoted_at: '2026-09-01'
  }), /missing quantity, confirmed_availability/);
});

test('matches an exact Oracle product by size, brand, and model and prefers the mapped supplier', () => {
  const rows = [
    { id: 'other-price', tyre_id: 'tyre-1', supplier_code: 'AL', brand: 'Michelin', model: 'Pilot Sport 5 XL', size: '225/45/18' },
    { id: 'mapped-price', tyre_id: 'tyre-1', supplier_code: 'TO', brand: 'Michelin', model: 'PS5', size: '225/45/18' },
    { id: 'wrong-size', tyre_id: 'tyre-2', supplier_code: 'TO', brand: 'Michelin', model: 'PS5', size: '235/45/18' },
    { id: 'prefixed-brand', tyre_id: 'tyre-3', supplier_code: 'TO', brand: '(TO) ### Nexen', model: 'Nfera RU1', size: '225/45/18' }
  ];
  const match = findExactOracleListing(rows, {
    brand: 'Michelin', model: 'Pilot Sport 5', size: '225/45/18'
  }, 'TO');
  assert.equal(match.id, 'mapped-price');
  assert.equal(findExactOracleListing(rows, {
    brand: 'Michelin', model: 'Primacy 5', size: '225/45/18'
  }, 'TO'), null);
  assert.equal(findExactOracleListing(rows, {
    brand: 'Nexen', model: 'Nfera RU1', size: '225/45/18'
  }, 'TO')?.id, 'prefixed-brand');
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
