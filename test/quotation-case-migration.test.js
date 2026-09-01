import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

test('upgrades the pre-case SQLite schema without deleting existing records', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quotation-case-migration-'));
  const dbPath = path.join(tempDir, 'legacy.db');
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_message_id TEXT UNIQUE NOT NULL,
      group_id TEXT NOT NULL,
      group_name TEXT,
      sender_id TEXT NOT NULL,
      sender_name TEXT,
      message_type TEXT NOT NULL,
      content TEXT,
      extracted_text TEXT,
      media_path TEXT,
      media_mime TEXT,
      raw_json TEXT,
      source TEXT NOT NULL DEFAULT 'realtime',
      chat_type TEXT NOT NULL DEFAULT 'group',
      account_id TEXT,
      timestamp TEXT NOT NULL
    );
    CREATE TABLE oracle_sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      group_id TEXT NOT NULL,
      supplier_code TEXT NOT NULL,
      supplier_name TEXT,
      payload_hash TEXT UNIQUE NOT NULL,
      listing_status TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      size TEXT NOT NULL,
      price REAL NOT NULL,
      year_of_manufacture INTEGER,
      country_of_origin TEXT,
      quoted_at TEXT NOT NULL,
      confidence REAL,
      stock_quantity INTEGER,
      availability TEXT,
      match_type TEXT,
      source_message_ids TEXT,
      oracle_price_id TEXT,
      request_payload TEXT NOT NULL,
      response_json TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE oracle_quote_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      trigger_message_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      source_message_ids TEXT,
      extraction_json TEXT,
      event_count INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO messages (
      wa_message_id, group_id, sender_id, message_type, content,
      source, chat_type, account_id, timestamp
    ) VALUES (
      'legacy-message', 'legacy@g.us', 'supplier@s.whatsapp.net',
      'conversation', '$180', 'realtime', 'group',
      'listener@s.whatsapp.net', '2026-08-25T02:00:00.000Z'
    );
    INSERT INTO oracle_sync_events (
      message_id, group_id, supplier_code, payload_hash, listing_status,
      sync_status, brand, model, size, price, quoted_at, stock_quantity,
      availability, request_payload
    ) VALUES
      (1, 'legacy@g.us', 'TO', 'missing-stock', 'new_listing', 'ready',
        'Falken', 'Azenis FK520L', '225/45/18', 130, '2026-08-25', NULL,
        'unknown', '{}'),
      (1, 'legacy@g.us', 'TO', 'complete-stock', 'new_listing', 'ready',
        'Falken', 'Azenis FK520L', '225/45/18', 130, '2026-08-25', 2,
        'ready_stock', '{}');
  `);
  legacy.close();

  process.env.DB_PATH = dbPath;
  const database = await import('../src/db/database.js');
  try {
    database.initDatabase();
    const messageColumns = database.db.prepare('PRAGMA table_info(messages)').all().map(column => column.name);
    const eventColumns = database.db.prepare('PRAGMA table_info(oracle_sync_events)').all().map(column => column.name);
    const runColumns = database.db.prepare('PRAGMA table_info(oracle_quote_runs)').all().map(column => column.name);
    const caseTable = database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'oracle_quote_cases'").get();

    assert.ok(messageColumns.includes('reply_to_wa_message_id'));
    assert.ok(eventColumns.includes('case_id'));
    assert.ok(eventColumns.includes('supersedes_event_id'));
    assert.ok(eventColumns.includes('oracle_tyre_id'));
    assert.ok(eventColumns.includes('oracle_match_record_id'));
    assert.ok(eventColumns.includes('listing_action'));
    assert.ok(runColumns.includes('case_id'));
    assert.equal(caseTable.name, 'oracle_quote_cases');
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM messages WHERE wa_message_id = ?').get('legacy-message').count, 1);
    assert.equal(database.db.prepare('SELECT sync_status FROM oracle_sync_events WHERE payload_hash = ?').get('missing-stock').sync_status, 'incomplete');
    assert.equal(database.db.prepare('SELECT sync_status FROM oracle_sync_events WHERE payload_hash = ?').get('complete-stock').sync_status, 'ready');
    database.setActiveWhatsappAccount('listener@s.whatsapp.net');
    database.upsertGroup('legacy@g.us', 'Legacy Group', 'listener@s.whatsapp.net');
    const quoteCase = database.createOracleQuoteCase({
      account_id: 'listener@s.whatsapp.net',
      group_id: 'legacy@g.us',
      supplier_code: 'TO',
      status: 'ready',
      known_fields_json: {
        sizes: ['225/45/18'], brands: ['Falken'], models: ['Azenis FK520L'], prices: [130]
      },
      missing_fields_json: [],
      opened_at: '2026-08-25T02:00:00.000Z',
      last_activity_at: '2026-08-25T02:00:00.000Z',
      expires_at: '2026-08-25T03:00:00.000Z'
    });
    database.db.prepare(`
      UPDATE oracle_sync_events SET sync_status = 'ready', case_id = ? WHERE payload_hash = 'missing-stock'
    `).run(quoteCase.id);
    assert.equal(database.reconcileOracleReadinessRecords(), 1);
    const reconciledCase = database.getOracleQuoteCaseById(quoteCase.id);
    assert.equal(reconciledCase.status, 'incomplete');
    assert.deepEqual(JSON.parse(reconciledCase.missing_fields_json), ['quantity', 'confirmed_availability']);
    assert.equal(database.getSettings().oracle_case_lifetime_minutes, '60');
    assert.equal(database.db.pragma('integrity_check', { simple: true }), 'ok');
  } finally {
    database.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
