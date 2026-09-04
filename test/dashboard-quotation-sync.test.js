import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('builds a traceable idempotent dashboard quotation payload and durable outbox item', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-quotation-sync-'));
  process.env.DB_PATH = path.join(tempDir, 'listener.db');

  const database = await import('../src/db/database.js');
  const dashboardSync = await import('../src/oracle/dashboard-sync.js');

  try {
    database.initDatabase();
    database.setActiveWhatsappAccount('listener@s.whatsapp.net');
    database.upsertGroup('quotes@g.us', 'MRR X TYRES ONLINE', 'listener@s.whatsapp.net');
    database.setGroupMonitoring(
      'quotes@g.us',
      true,
      'default',
      true,
      'TO',
      'supplier@s.whatsapp.net'
    );

    const requestMessageId = database.saveMessage({
      wa_message_id: 'request-message',
      group_id: 'quotes@g.us',
      group_name: 'MRR X TYRES ONLINE',
      sender_id: 'requester@s.whatsapp.net',
      sender_name: 'MRR Staff',
      message_type: 'conversation',
      content: '255/40R19 Continental Sport Contact 7?',
      source: 'realtime',
      chat_type: 'group',
      account_id: 'listener@s.whatsapp.net',
      timestamp: '2026-09-01T10:00:00.000Z'
    });
    const supplierMessageId = database.saveMessage({
      wa_message_id: 'supplier-message',
      group_id: 'quotes@g.us',
      group_name: 'MRR X TYRES ONLINE',
      sender_id: 'supplier@s.whatsapp.net',
      sender_name: 'Tyres Online',
      message_type: 'conversation',
      content: '$240 dot25 only 4',
      source: 'realtime',
      chat_type: 'group',
      account_id: 'listener@s.whatsapp.net',
      timestamp: '2026-09-01T10:02:00.000Z'
    });
    database.saveMessage({
      wa_message_id: 'sender-key-event',
      group_id: 'quotes@g.us',
      group_name: 'MRR X TYRES ONLINE',
      sender_id: 'listener@s.whatsapp.net',
      sender_name: 'MRR Staff',
      message_type: 'senderKeyDistributionMessage',
      content: '[senderKeyDistributionMessage]',
      source: 'realtime',
      chat_type: 'group',
      account_id: 'listener@s.whatsapp.net',
      timestamp: '2026-09-01T10:01:00.000Z'
    });
    const caseRecord = database.createOracleQuoteCase({
      account_id: 'listener@s.whatsapp.net',
      group_id: 'quotes@g.us',
      supplier_code: 'TO',
      supplier_sender_id: 'supplier@s.whatsapp.net',
      requester_sender_id: 'requester@s.whatsapp.net',
      request_message_id: requestMessageId,
      status: 'ready',
      known_fields_json: {
        sizes: ['255/40/19'],
        brands: ['Continental'],
        models: ['Sport Contact 7'],
        prices: [240],
        quantities: [4],
        availabilities: ['ready_stock'],
        requires_staff_verification: true,
        field_mappings: [{
          brand: 'Continental',
          model: 'Sport Contact 7',
          size: '255/40/19',
          price: 240,
          stock_quantity: 4,
          availability: 'ready_stock',
          confidence: 0.91,
          evidence: {
            price: {
              message_ids: [supplierMessageId],
              basis: 'explicit',
              explanation: 'Supplier stated $240.'
            },
            availability: {
              message_ids: [supplierMessageId],
              basis: 'price_quantity_assumption',
              explanation: 'Price and a positive quantity were stated together.'
            }
          }
        }, {
          brand: 'Continental',
          model: 'Sport Contact 7',
          size: '255/40/19',
          price: 240,
          stock_quantity: 4,
          availability: 'ready_stock',
          confidence: 0.91,
          evidence: {
            price: {
              message_ids: [supplierMessageId],
              basis: 'explicit',
              explanation: 'Supplier stated $240.'
            }
          }
        }]
      },
      missing_fields_json: [],
      source_message_ids: ['request-message', 'supplier-message'],
      last_message_id: supplierMessageId,
      last_reason: 'llm_interpretation_needs_review',
      opened_at: '2026-09-01T10:00:00.000Z',
      last_activity_at: '2026-09-01T10:02:00.000Z',
      expires_at: '2026-09-01T11:02:00.000Z'
    });
    database.attachMessagesToOracleQuoteCase(caseRecord.id, [
      database.db.prepare('SELECT * FROM messages WHERE id = ?').get(requestMessageId),
      database.db.prepare('SELECT * FROM messages WHERE id = ?').get(supplierMessageId)
    ], {
      roleForMessage: message => message.id === supplierMessageId ? 'supplier' : 'requester',
      matchReasons: ['reply_link']
    });
    const syncEvent = database.createOracleSyncEvent({
      message_id: supplierMessageId,
      group_id: 'quotes@g.us',
      supplier_code: 'TO',
      supplier_name: 'Tyres Online',
      payload_hash: 'dashboard-sync-test',
      listing_status: 'existing',
      listing_action: 'update',
      sync_status: 'ready',
      brand: 'Continental',
      model: 'Sport Contact 7',
      size: '255/40/19',
      price: 240,
      year_of_manufacture: 2025,
      confidence: 0.91,
      stock_quantity: 4,
      availability: 'ready_stock',
      match_type: 'exact',
      quoted_at: '2026-09-01',
      source_message_ids: ['request-message', 'supplier-message'],
      case_id: caseRecord.id,
      request_payload: '{}'
    });
    assert.ok(syncEvent);
    assert.equal(syncEvent.case_id, caseRecord.id);
    assert.equal(database.getOracleSyncEventsForCase(caseRecord.id).length, 1);

    const payload = dashboardSync.buildDashboardQuotationPayload(caseRecord.id);
    assert.equal(payload.source, 'whatsapp_group_reader');
    assert.equal(payload.sourceCaseId, String(caseRecord.id));
    assert.equal(payload.groupName, 'MRR X TYRES ONLINE');
    assert.equal(payload.requiresStaffVerification, true);
    assert.equal(payload.events[0].stockQuantity, 4);
    assert.equal(payload.fieldMappings.length, 1);
    assert.deepEqual(payload.fieldMappings[0].evidence.price.messageIds, [supplierMessageId]);
    assert.equal(payload.contextMessages[0].includedInCase, true);
    assert.equal(payload.contextMessages.length, 2);
    assert.ok(payload.contextMessages.every(message => message.messageType === 'conversation'));
    assert.deepEqual(payload.contextMessages.map(message => message.quotationRole), [
      'quote_request',
      'supplier_quotation'
    ]);
    assert.ok(payload.messages.every(message => message.messageType === 'conversation'));
    assert.ok(payload.contextMessages.every(message => !message.body.includes('senderKeyDistributionMessage')));
    assert.match(payload.sourceRevision, /^[a-f0-9]{64}$/);

    dashboardSync.queueDashboardQuotationCase(caseRecord.id);
    const outbox = database.getDashboardQuoteSync(caseRecord.id);
    assert.equal(outbox.status, 'pending');
    assert.equal(outbox.source_revision, payload.sourceRevision);
    assert.equal(JSON.parse(outbox.payload_json).events[0].brand, 'Continental');
  } finally {
    database.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
