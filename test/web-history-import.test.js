import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { importWebHistoryEnvelope } from '../scripts/import-web-history.mjs';

function createDatabase({ monitored = 0, oracleSync = 0 } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      account_id TEXT,
      is_monitored INTEGER DEFAULT 0,
      oracle_sync_enabled INTEGER DEFAULT 0
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_message_id TEXT UNIQUE NOT NULL,
      group_id TEXT NOT NULL,
      group_name TEXT,
      sender_id TEXT NOT NULL,
      sender_name TEXT,
      message_type TEXT NOT NULL,
      content TEXT,
      raw_json TEXT,
      source TEXT NOT NULL DEFAULT 'realtime',
      chat_type TEXT NOT NULL DEFAULT 'group',
      account_id TEXT,
      timestamp TEXT NOT NULL
    );
    CREATE TABLE extractions (id INTEGER PRIMARY KEY);
    CREATE TABLE oracle_sync_events (id INTEGER PRIMARY KEY);
    INSERT INTO settings (key, value) VALUES ('whatsapp_account_id', 'account-1');
  `);
  db.prepare(`
    INSERT INTO groups (id, name, account_id, is_monitored, oracle_sync_enabled)
    VALUES ('group-1@g.us', 'Group One', 'account-1', ?, ?)
  `).run(monitored, oracleSync);
  return db;
}

function envelope() {
  return {
    oracleWritesAllowed: false,
    groups: {
      'Group One': {
        groupId: 'group-1@g.us',
        messages: [
          {
            id: 'message-1',
            senderName: 'Supplier',
            senderId: '+6512345678',
            content: '225/45R17 $100',
            messageType: 'conversation',
            timestamp: '2026-08-03T00:55:00.000Z',
            metadata: { timestampSource: 'whatsapp_pre_plain_text' }
          },
          {
            id: 'message-2',
            senderName: 'Buyer',
            senderId: 'Buyer',
            content: '4 pcs to AMK',
            messageType: 'extendedTextMessage',
            timestamp: '2026-08-03T08:34:00.000Z'
          }
        ]
      }
    }
  };
}

test('imports history idempotently without extraction or Oracle side effects', () => {
  const db = createDatabase();
  try {
    const first = importWebHistoryEnvelope(db, envelope());
    assert.equal(first.imported, 2);
    assert.equal(first.duplicates, 0);
    assert.equal(first.after.messages, 2);
    assert.equal(first.after.extractions, 0);
    assert.equal(first.after.oracleSyncEvents, 0);

    const second = importWebHistoryEnvelope(db, envelope());
    assert.equal(second.imported, 0);
    assert.equal(second.duplicates, 2);
    assert.equal(second.after.messages, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE source = 'web_history'").get().count, 2);
  } finally {
    db.close();
  }
});

test('dry run validates rows without changing the database', () => {
  const db = createDatabase();
  try {
    const result = importWebHistoryEnvelope(db, envelope(), { dryRun: true });
    assert.equal(result.imported, 2);
    assert.equal(result.after.messages, 0);
  } finally {
    db.close();
  }
});

test('refuses history import while monitoring is enabled', () => {
  const db = createDatabase({ monitored: 1 });
  try {
    assert.throws(() => importWebHistoryEnvelope(db, envelope()), /monitoring and Oracle sync to be disabled/);
  } finally {
    db.close();
  }
});

test('refuses history import while Oracle sync is enabled', () => {
  const db = createDatabase({ oracleSync: 1 });
  try {
    assert.throws(() => importWebHistoryEnvelope(db, envelope()), /monitoring and Oracle sync to be disabled/);
  } finally {
    db.close();
  }
});
