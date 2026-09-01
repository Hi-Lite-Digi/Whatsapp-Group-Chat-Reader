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
    assert.deepEqual(JSON.parse(firstResolution.caseRecord.missing_fields_json), ['model']);

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
    assert.deepEqual(JSON.parse(secondResolution.caseRecord.missing_fields_json), []);

    const persistentSession = cases.buildPersistentQuotationSession({
      caseRecord: secondResolution.caseRecord,
      currentMessageId: modelId,
      supplierSenderIds,
      settings
    });
    assert.equal(persistentSession.eligible, true);
    assert.deepEqual(persistentSession.messages.map(message => message.id), [requestId, priceId, modelId]);
  } finally {
    database.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

