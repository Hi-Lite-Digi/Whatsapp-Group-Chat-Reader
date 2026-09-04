import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('re-opens an incomplete case when a related fragment arrives outside the quiet window', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quotation-case-'));
  process.env.DB_PATH = path.join(tempDir, 'case.db');

  const cases = await import('../src/oracle/cases.js');
  const database = await import('../src/db/database.js');
  const quotation = await import('../src/oracle/quotation.js');

  try {
    database.initDatabase();
    database.setActiveWhatsappAccount('listener@s.whatsapp.net');
    database.upsertGroup('case-test@g.us', 'Case Test', 'listener@s.whatsapp.net');
    database.setGroupMonitoring(
      'case-test@g.us',
      true,
      'default',
      true,
      'TO',
      'supplier@s.whatsapp.net'
    );
    const group = database.db.prepare('SELECT * FROM groups WHERE id = ?').get('case-test@g.us');
    const supplierSenderIds = new Set(['supplier@s.whatsapp.net']);
    const settings = {
      oracle_context_messages: '30',
      oracle_context_minutes: '15',
      oracle_case_lifetime_minutes: '60'
    };

    const requestId = database.saveMessage({
      wa_message_id: 'request-1', group_id: group.id, group_name: group.name,
      sender_id: 'requester@s.whatsapp.net', sender_name: 'Requester',
      message_type: 'conversation', content: '235/55R19 Michelin?', source: 'realtime',
      chat_type: 'group', account_id: 'listener@s.whatsapp.net', timestamp: '2026-08-25T02:00:00.000Z'
    });
    const priceId = database.saveMessage({
      wa_message_id: 'supplier-price', group_id: group.id, group_name: group.name,
      sender_id: 'supplier@s.whatsapp.net', sender_name: 'Supplier',
      message_type: 'conversation', content: '$235', source: 'realtime',
      chat_type: 'group', account_id: 'listener@s.whatsapp.net',
      reply_to_wa_message_id: 'request-1', timestamp: '2026-08-25T02:01:00.000Z'
    });

    const firstMessages = database.getGroupMessagesEndingAt(group.id, priceId, 30).reverse();
    const firstSession = quotation.buildQuotationSession({
      messages: firstMessages,
      currentMessageId: priceId,
      supplierSenderIds,
      windowMinutes: 15,
      maxMessages: 30
    });
    const firstMessage = firstMessages.find(message => message.id === priceId);
    const firstResolution = cases.resolveQuotationCase({
      message: { ...firstMessage, account_id: 'listener@s.whatsapp.net' },
      group,
      supplierSenderIds,
      preliminarySession: firstSession,
      discoverySession: firstSession,
      settings
    });
    assert.equal(firstResolution.caseRecord.status, 'incomplete');
    assert.deepEqual(JSON.parse(firstResolution.caseRecord.missing_fields_json), [
      'model',
      'quantity',
      'confirmed_availability'
    ]);

    const modelId = database.saveMessage({
      wa_message_id: 'supplier-model', group_id: group.id, group_name: group.name,
      sender_id: 'supplier@s.whatsapp.net', sender_name: 'Supplier',
      message_type: 'conversation', content: 'PS5', source: 'realtime',
      chat_type: 'group', account_id: 'listener@s.whatsapp.net',
      timestamp: '2026-08-25T02:22:00.000Z'
    });
    const discoveryMessages = database.getGroupMessagesEndingAt(group.id, modelId, 100).reverse();
    const preliminarySession = quotation.buildQuotationSession({
      messages: discoveryMessages,
      currentMessageId: modelId,
      supplierSenderIds,
      windowMinutes: 15,
      maxMessages: 30
    });
    const discoverySession = quotation.buildQuotationSession({
      messages: discoveryMessages,
      currentMessageId: modelId,
      supplierSenderIds,
      windowMinutes: 60,
      maxMessages: 100
    });
    const modelMessage = discoveryMessages.find(message => message.id === modelId);
    const secondResolution = cases.resolveQuotationCase({
      message: { ...modelMessage, account_id: 'listener@s.whatsapp.net' },
      group,
      supplierSenderIds,
      preliminarySession,
      discoverySession,
      settings
    });

    assert.equal(secondResolution.outcome, 'matched');
    assert.equal(secondResolution.caseRecord.id, firstResolution.caseRecord.id);
    assert.deepEqual(JSON.parse(secondResolution.caseRecord.missing_fields_json), [
      'quantity',
      'confirmed_availability'
    ]);

    const stockId = database.saveMessage({
      wa_message_id: 'supplier-stock', group_id: group.id, group_name: group.name,
      sender_id: 'supplier@s.whatsapp.net', sender_name: 'Supplier',
      message_type: 'conversation', content: '2pcs ready stock', source: 'realtime',
      chat_type: 'group', account_id: 'listener@s.whatsapp.net',
      timestamp: '2026-08-25T02:23:00.000Z'
    });
    const stockDiscoveryMessages = database.getGroupMessagesEndingAt(group.id, stockId, 100).reverse();
    const stockPreliminarySession = quotation.buildQuotationSession({
      messages: stockDiscoveryMessages,
      currentMessageId: stockId,
      supplierSenderIds,
      windowMinutes: 15,
      maxMessages: 30
    });
    const stockDiscoverySession = quotation.buildQuotationSession({
      messages: stockDiscoveryMessages,
      currentMessageId: stockId,
      supplierSenderIds,
      windowMinutes: 60,
      maxMessages: 100
    });
    const stockMessage = stockDiscoveryMessages.find(message => message.id === stockId);
    const thirdResolution = cases.resolveQuotationCase({
      message: { ...stockMessage, account_id: 'listener@s.whatsapp.net' },
      group,
      supplierSenderIds,
      preliminarySession: stockPreliminarySession,
      discoverySession: stockDiscoverySession,
      settings
    });

    assert.equal(thirdResolution.outcome, 'matched');
    assert.equal(thirdResolution.caseRecord.id, firstResolution.caseRecord.id);
    assert.deepEqual(JSON.parse(thirdResolution.caseRecord.missing_fields_json), []);

    const persistentSession = cases.buildPersistentQuotationSession({
      caseRecord: thirdResolution.caseRecord,
      currentMessageId: stockId,
      supplierSenderIds,
      settings
    });
    assert.equal(persistentSession.eligible, true);
    assert.deepEqual(persistentSession.messages.map(message => message.id), [requestId, priceId, modelId, stockId]);

    const auditMessages = database.getOracleQuoteCaseMessages(thirdResolution.caseRecord.id);
    assert.equal(auditMessages.length, 4);
    assert.equal(auditMessages[0].message_type, 'conversation');
    assert.equal(auditMessages[0].source, 'realtime');
    assert.equal(auditMessages[1].role, 'supplier');
    const contextMessages = database.getOracleQuoteCaseContextMessages(thirdResolution.caseRecord.id, 60);
    assert.deepEqual(contextMessages.map(message => message.id), [requestId, priceId, modelId, stockId]);

    const auditRun = database.createOracleQuoteRun({
      group_id: group.id,
      trigger_message_id: stockId,
      status: 'completed',
      source_message_ids: auditMessages.map(message => message.id),
      event_count: 0,
      case_id: thirdResolution.caseRecord.id
    });
    const auditRuns = database.getOracleQuoteRunsForCase(thirdResolution.caseRecord.id);
    assert.deepEqual(auditRuns.map(run => run.id), [auditRun.id]);
    assert.equal(auditRuns[0].trigger_message_id, stockId);

    const assumedCase = database.createOracleQuoteCase({
      account_id: 'listener@s.whatsapp.net',
      group_id: group.id,
      supplier_code: 'TO',
      status: 'collecting',
      known_fields_json: {
        sizes: ['255/40/19'], brands: ['Continental'], models: ['sport contact 7'],
        prices: [240], quantities: [4], availabilities: ['ready_stock'],
        availability_evidence: ['price_quantity_assumption']
      },
      missing_fields_json: [],
      opened_at: '2026-08-25T03:00:00.000Z',
      last_activity_at: '2026-08-25T03:00:00.000Z',
      expires_at: '2026-08-25T04:00:00.000Z'
    });
    const reviewCase = cases.markQuotationCaseReady(assumedCase.id, { sync_status: 'ready' }, [{
      brand: 'Continental', model: 'Sport Contact 7', size: '255/40/19', price: 240,
      stock_quantity: 4, availability: 'ready_stock'
    }], ['supplier-quote', 'supplier-quantity']);
    assert.equal(reviewCase.status, 'ready');
    assert.equal(reviewCase.last_reason, 'assumed_availability_needs_review');
    assert.deepEqual(JSON.parse(reviewCase.missing_fields_json), []);
  } finally {
    database.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
