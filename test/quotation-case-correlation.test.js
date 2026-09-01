import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseQuotationCase,
  missingQuotationFields,
  signalsForMessages
} from '../src/oracle/case-correlation.js';

const baseCase = {
  id: 7,
  request_message_id: 1,
  requester_sender_id: 'requester@s.whatsapp.net',
  known_fields_json: JSON.stringify({
    sizes: ['235/55/19'],
    prices: [235],
    brands: ['Michelin'],
    models: [],
    years: []
  }),
  missing_fields_json: JSON.stringify(['model']),
  source_message_ids: JSON.stringify(['request-1', 'supplier-1']),
  last_activity_at: '2026-08-25T02:00:00.000Z',
  expires_at: '2026-08-25T03:00:00.000Z'
};

function supplierMessage(content, timestamp = '2026-08-25T02:22:00.000Z', extra = {}) {
  return {
    id: 9,
    wa_message_id: 'supplier-2',
    sender_id: 'supplier@s.whatsapp.net',
    content,
    timestamp,
    ...extra
  };
}

test('retains known evidence and reports only required missing fields', () => {
  const signals = signalsForMessages([
    { content: '235/55R19 Michelin', timestamp: '2026-08-25T02:00:00.000Z' },
    { content: '$235', timestamp: '2026-08-25T02:01:00.000Z' }
  ]);
  assert.deepEqual(signals.sizes, ['235/55/19']);
  assert.deepEqual(signals.brands, ['Michelin']);
  assert.deepEqual(signals.prices, [235]);
  assert.deepEqual(missingQuotationFields(signals), ['model']);
});

test('matches a late fragment that fills the only open case after the quiet period', () => {
  const result = chooseQuotationCase({
    cases: [baseCase],
    currentMessage: supplierMessage('PS5')
  });
  assert.equal(result.outcome, 'matched');
  assert.equal(result.match.caseRecord.id, 7);
  assert.ok(result.match.reasons.includes('fills_missing_model'));
});

test('treats a late price-only message as a correction only when one case is plausible', () => {
  const completeCase = {
    ...baseCase,
    known_fields_json: JSON.stringify({
      sizes: ['235/55/19'], prices: [235], brands: ['Michelin'], models: ['pilot sport 5'], years: [2026]
    }),
    missing_fields_json: JSON.stringify([])
  };
  const result = chooseQuotationCase({
    cases: [completeCase],
    currentMessage: supplierMessage('$225')
  });
  assert.equal(result.outcome, 'matched');
  assert.ok(result.match.reasons.includes('possible_price_correction'));
});

test('uses an explicit WhatsApp reply target as the strongest relationship', () => {
  const otherCase = {
    ...baseCase,
    id: 8,
    source_message_ids: JSON.stringify(['request-2', 'supplier-other'])
  };
  const result = chooseQuotationCase({
    cases: [otherCase, baseCase],
    currentMessage: supplierMessage('PS5', '2026-08-25T02:50:00.000Z', {
      reply_to_wa_message_id: 'supplier-1'
    })
  });
  assert.equal(result.outcome, 'matched');
  assert.equal(result.match.caseRecord.id, 7);
  assert.ok(result.match.reasons.includes('direct_reply'));
});

test('marks a fragment ambiguous when it could fill two open cases', () => {
  const secondCase = {
    ...baseCase,
    id: 8,
    request_message_id: 2,
    known_fields_json: JSON.stringify({
      sizes: ['225/45/18'],
      prices: [180],
      brands: ['Michelin'],
      models: [],
      years: []
    }),
    source_message_ids: JSON.stringify(['request-2', 'supplier-other'])
  };
  const result = chooseQuotationCase({
    cases: [baseCase, secondCase],
    currentMessage: supplierMessage('PS5')
  });
  assert.equal(result.outcome, 'ambiguous');
  assert.deepEqual(result.candidates.map(candidate => candidate.caseRecord.id).sort(), [7, 8]);
});

test('does not attach a different explicit request to an older case', () => {
  const result = chooseQuotationCase({
    cases: [baseCase],
    currentMessage: supplierMessage('225/45R18 Bridgestone RE004 $145'),
    requestAnchor: {
      id: 20,
      sender_id: 'another-requester@s.whatsapp.net'
    }
  });
  assert.equal(result.outcome, 'new');
});
