import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQuotationSession,
  canonicalModel,
  extractAvailabilityEvidence,
  extractConfirmedAvailabilities,
  extractStockQuantities,
  extractTyreSizes,
  normalizeTyreSize,
  quotationItemHasEvidence
} from '../src/oracle/quotation.js';

const supplier = 'supplier@s.whatsapp.net';
const requester = 'requester@s.whatsapp.net';
const supplierIds = new Set([supplier]);

function messages(lines) {
  return lines.map((line, index) => ({
    id: index + 1,
    wa_message_id: `wa-${index + 1}`,
    group_id: 'test@g.us',
    sender_id: line[0] === 'S' ? supplier : requester,
    sender_name: line[0] === 'S' ? 'Supplier' : 'Requester',
    content: line[1],
    timestamp: new Date(Date.UTC(2026, 7, 25, 2, 0, index * 20)).toISOString()
  }));
}

function sessionFor(lines) {
  const history = messages(lines);
  return buildQuotationSession({
    messages: history,
    currentMessageId: history.at(-1).id,
    supplierSenderIds: supplierIds,
    windowMinutes: 15,
    maxMessages: 40
  });
}

test('normalizes the size formats present in supplier histories', () => {
  for (const input of ['225/45R18', '225/45/18', '225 45 18', '2254518']) {
    assert.equal(normalizeTyreSize(input), '225/45/18');
  }
  assert.equal(normalizeTyreSize('255/45 ZR 20'), '255/45/20');
  assert.equal(normalizeTyreSize('195R15C'), '195R15C');
  assert.deepEqual(extractTyreSizes('225/45R18 and 255/45 ZR 20'), ['225/45/18', '255/45/20']);
});

test('normalizes common supplier model shorthand without confusing PS4 and PS4S', () => {
  assert.equal(canonicalModel('Michelin PS5 XL'), 'pilot sport 5');
  assert.equal(canonicalModel('MICHELIN PILOT SPORT 4S ND0 XL'), 'pilot sport 4s');
  assert.equal(canonicalModel('Bridgestone POTENZA RE71RS XL'), 'potenza re71rs');
});

test('extracts only explicit supplier quantity and confirmed availability evidence', () => {
  assert.deepEqual(extractStockQuantities('left 2pcs, ready stock'), [2]);
  assert.deepEqual(extractStockQuantities('quantity: 4 units'), [4]);
  assert.deepEqual(extractConfirmedAvailabilities('2pcs ready stock'), ['ready_stock']);
  assert.deepEqual(extractConfirmedAvailabilities('left 2pcs'), ['ready_stock']);
  assert.deepEqual(extractConfirmedAvailabilities('stock: 4 units'), ['ready_stock']);
  assert.deepEqual(extractConfirmedAvailabilities('available now'), ['ready_stock']);
  assert.deepEqual(extractConfirmedAvailabilities('pre-order, 5 day lead time'), ['preorder']);
  assert.deepEqual(extractConfirmedAvailabilities('not available'), []);
  assert.deepEqual(extractConfirmedAvailabilities('$140 dot26'), []);
});

test('prepares price plus supplier quantity as an assumed ready-stock draft', () => {
  assert.deepEqual(extractStockQuantities('Only 4'), [4]);
  assert.deepEqual(extractStockQuantities('4 only'), [4]);
  assert.deepEqual(extractAvailabilityEvidence('Continental SC7 $240, only 4'), {
    availabilities: ['ready_stock'],
    evidence: ['price_quantity_assumption']
  });
  assert.deepEqual(extractAvailabilityEvidence('Continental SC7 $240, 4pcs preorder'), {
    availabilities: ['preorder'],
    evidence: ['explicit_preorder']
  });
});

test('requires extracted quantity and availability claims to be present in supplier evidence', () => {
  const session = sessionFor([
    ['R', '225/45R18 Michelin PS5 have?'],
    ['S', 'Michelin PS5 $180, 2pcs ready stock']
  ]);
  assert.equal(quotationItemHasEvidence({
    brand: 'Michelin', model: 'PS5', size: '225/45/18', price: 180,
    stock_quantity: 2, availability: 'ready_stock'
  }, session), true);
  assert.equal(quotationItemHasEvidence({
    brand: 'Michelin', model: 'PS5', size: '225/45/18', price: 180,
    stock_quantity: 4, availability: 'ready_stock'
  }, session), false);
});

test('does not assemble a tyre size from digits in separate messages', () => {
  const text = [
    'Boss 235/55/19 Michelin have?',
    '$235',
    'Which model?',
    '2026?',
    'Yes',
    'Ps5'
  ].join('\n');
  assert.deepEqual(extractTyreSizes(text), ['235/55/19']);
});

test('joins a fragmented model, price, and year exchange', () => {
  const session = sessionFor([
    ['R', '225/45R18 Michelin have?'],
    ['S', '$235'],
    ['R', 'Which model?'],
    ['S', 'Ps5'],
    ['R', '2026?'],
    ['S', 'Yes']
  ]);
  assert.equal(session.eligible, true);
  assert.equal(session.messages.length, 6);
  assert.deepEqual(session.evidence.supplierMessageIds, [2, 4, 6]);
  assert.equal(quotationItemHasEvidence({
    brand: 'Michelin', model: 'Pilot Sport 5', size: '225/45/18', price: 235
  }, session), true);
});

test('accepts a complete one-message supplier quote', () => {
  const session = sessionFor([
    ['R', '225 45 18 Bridgestone price?'],
    ['S', 'Bridgestone Techno Sport Y25 Indo $140']
  ]);
  assert.equal(session.eligible, true);
  assert.equal(quotationItemHasEvidence({
    brand: 'Bridgestone', model: 'Techno Sport', size: '225/45/18', price: 140
  }, session), true);
});

test('accepts alternatives after a negative exact-brand response', () => {
  const session = sessionFor([
    ['R', '225/45R18 Michelin PS5 have?'],
    ['S', 'No PS5. Yokohama ES32 Y25 $125, Bridgestone RE004 Y26 $145']
  ]);
  assert.equal(session.eligible, true);
  assert.equal(quotationItemHasEvidence({
    brand: 'Yokohama', model: 'ES32', size: '225/45/18', price: 125
  }, session), true);
});

test('accepts an unsolicited multi-size stock broadcast', () => {
  const session = sessionFor([
    ['S', 'Ready stock: 225/45R18 PS5 $180; 235/55R18 Conti CPC7 $210']
  ]);
  assert.equal(session.eligible, true);
  assert.deepEqual(session.evidence.sizes, ['225/45/18', '235/55/18']);
});

test('uses transcribed supplier-image text as quotation evidence', () => {
  const history = messages([
    ['R', '235/55R18 Michelin price?'],
    ['S', '[Image Message]']
  ]);
  history[1].extracted_text = '235/55R18 Michelin Primacy 5 Y26 $220';
  const session = buildQuotationSession({
    messages: history,
    currentMessageId: history[1].id,
    supplierSenderIds: supplierIds,
    windowMinutes: 15,
    maxMessages: 40
  });
  assert.equal(session.eligible, true);
  assert.equal(quotationItemHasEvidence({
    brand: 'Michelin', model: 'Primacy 5', size: '235/55/18', price: 220
  }, session), true);
});

test('rejects negative-only, battery, logistics, and acknowledgement messages', () => {
  assert.equal(sessionFor([['R', '225/45R18 PS5 have?'], ['S', 'no']]).reason, 'negative_availability_only');
  assert.equal(sessionFor([['R', 'AGM battery 105ah price?'], ['S', 'Varta $280']]).reason, 'unsupported_product');
  assert.equal(sessionFor([['R', '225/45R18 PS5 $180 send 2pc'], ['S', 'driver coming before 5']]).reason, 'logistics_or_acknowledgement');
  assert.equal(sessionFor([['R', '225/45R18 PS5 $180'], ['S', 'thanks']]).reason, 'logistics_or_acknowledgement');
});

test('rejects hallucinated price, size, and model evidence', () => {
  const session = sessionFor([
    ['R', '225/45R18 Michelin have?'],
    ['S', 'PS5 Y26 $180']
  ]);
  assert.equal(quotationItemHasEvidence({ brand: 'Michelin', model: 'PS5', size: '225/45/18', price: 180 }, session), true);
  assert.equal(quotationItemHasEvidence({ brand: 'Michelin', model: 'PS5', size: '235/55/18', price: 180 }, session), false);
  assert.equal(quotationItemHasEvidence({ brand: 'Michelin', model: 'PS5', size: '225/45/18', price: 190 }, session), false);
  assert.equal(quotationItemHasEvidence({ brand: 'Michelin', model: 'Primacy 5', size: '225/45/18', price: 180 }, session), false);
});

test('uses the supplier correction instead of the requester typo', () => {
  const session = sessionFor([
    ['R', '280 40 18 price?'],
    ['S', 'Correct size 275/40R18. Pirelli P Zero Y25 $310']
  ]);
  assert.equal(session.eligible, true);
  assert.equal(quotationItemHasEvidence({
    brand: 'Pirelli', model: 'P Zero', size: '275/40/18', price: 310
  }, session), true);
  assert.equal(quotationItemHasEvidence({
    brand: 'Pirelli', model: 'P Zero', size: '280/40/18', price: 310
  }, session), false);
});

test('treats emoji and sticker-only supplier replies as acknowledgements', () => {
  assert.equal(sessionFor([
    ['R', '225/45R18 Michelin PS5 have?'],
    ['S', '225/45R18 Michelin PS5 Y26 $180'],
    ['S', '👌🏻']
  ]).reason, 'logistics_or_acknowledgement');
  assert.equal(sessionFor([
    ['R', '225/45R18 Michelin PS5 have?'],
    ['S', '225/45R18 Michelin PS5 Y26 $180'],
    ['S', '[Sticker]']
  ]).reason, 'logistics_or_acknowledgement');
});
