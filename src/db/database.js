import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = process.env.DB_PATH || './data/whatsapp_bot.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Initialize database tables
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_monitored INTEGER DEFAULT 0,
      active_schema_id TEXT DEFAULT 'default',
      oracle_sync_enabled INTEGER DEFAULT 0,
      oracle_supplier_code TEXT,
      oracle_supplier_sender_ids TEXT,
      account_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dm_chats (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone_jid TEXT,
      lid_jid TEXT,
      account_id TEXT,
      is_monitored INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dm_aliases (
      alias_jid TEXT PRIMARY KEY,
      dm_id TEXT NOT NULL,
      FOREIGN KEY (dm_id) REFERENCES dm_chats (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS schemas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      instruction_prompt TEXT NOT NULL,
      json_schema TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
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
      reply_to_wa_message_id TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS extractions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      group_id TEXT NOT NULL,
      schema_id TEXT NOT NULL,
      llm_provider TEXT NOT NULL,
      llm_model TEXT NOT NULL,
      extracted_data TEXT,
      status TEXT DEFAULT 'success',
      error_message TEXT,
      processed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oracle_sync_events (
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
      case_id INTEGER,
      supersedes_event_id INTEGER,
      superseded_by_event_id INTEGER,
      oracle_price_id TEXT,
      request_payload TEXT NOT NULL,
      response_json TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS oracle_quote_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      trigger_message_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      source_message_ids TEXT,
      extraction_json TEXT,
      event_count INTEGER DEFAULT 0,
      case_id INTEGER,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trigger_message_id) REFERENCES messages (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS oracle_quote_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT,
      group_id TEXT NOT NULL,
      supplier_code TEXT NOT NULL,
      supplier_sender_id TEXT,
      requester_sender_id TEXT,
      request_message_id INTEGER,
      status TEXT NOT NULL DEFAULT 'collecting',
      known_fields_json TEXT NOT NULL DEFAULT '{}',
      missing_fields_json TEXT NOT NULL DEFAULT '[]',
      source_message_ids TEXT NOT NULL DEFAULT '[]',
      correlation_json TEXT,
      current_event_id INTEGER,
      last_message_id INTEGER,
      last_reason TEXT,
      opened_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (request_message_id) REFERENCES messages (id) ON DELETE SET NULL,
      FOREIGN KEY (last_message_id) REFERENCES messages (id) ON DELETE SET NULL,
      FOREIGN KEY (current_event_id) REFERENCES oracle_sync_events (id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS oracle_quote_case_messages (
      case_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      correlation_score REAL,
      match_reasons_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (case_id, message_id),
      FOREIGN KEY (case_id) REFERENCES oracle_quote_cases (id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_oracle_sync_events_created
      ON oracle_sync_events (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_oracle_sync_events_group
      ON oracle_sync_events (group_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_oracle_quote_runs_group
      ON oracle_quote_runs (group_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_oracle_quote_cases_active
      ON oracle_quote_cases (account_id, group_id, supplier_code, expires_at DESC);
    CREATE INDEX IF NOT EXISTS idx_oracle_quote_cases_status
      ON oracle_quote_cases (status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_oracle_quote_case_messages_message
      ON oracle_quote_case_messages (message_id, case_id);
  `);

  // Keep older local databases compatible with the source marker.
  const messageColumns = db.prepare('PRAGMA table_info(messages)').all();
  if (!messageColumns.some(column => column.name === 'source')) {
    db.exec("ALTER TABLE messages ADD COLUMN source TEXT NOT NULL DEFAULT 'realtime'");
  }
  if (!messageColumns.some(column => column.name === 'chat_type')) {
    db.exec("ALTER TABLE messages ADD COLUMN chat_type TEXT NOT NULL DEFAULT 'group'");
  }
  if (!messageColumns.some(column => column.name === 'account_id')) {
    db.exec('ALTER TABLE messages ADD COLUMN account_id TEXT');
  }
  if (!messageColumns.some(column => column.name === 'reply_to_wa_message_id')) {
    db.exec('ALTER TABLE messages ADD COLUMN reply_to_wa_message_id TEXT');
  }

  const dmColumns = db.prepare('PRAGMA table_info(dm_chats)').all();
  if (!dmColumns.some(column => column.name === 'account_id')) {
    db.exec('ALTER TABLE dm_chats ADD COLUMN account_id TEXT');
  }

  const groupColumns = db.prepare('PRAGMA table_info(groups)').all();
  if (!groupColumns.some(column => column.name === 'oracle_sync_enabled')) {
    db.exec('ALTER TABLE groups ADD COLUMN oracle_sync_enabled INTEGER DEFAULT 0');
  }
  if (!groupColumns.some(column => column.name === 'oracle_supplier_code')) {
    db.exec('ALTER TABLE groups ADD COLUMN oracle_supplier_code TEXT');
  }
  if (!groupColumns.some(column => column.name === 'oracle_supplier_sender_ids')) {
    db.exec('ALTER TABLE groups ADD COLUMN oracle_supplier_sender_ids TEXT');
  }
  if (!groupColumns.some(column => column.name === 'account_id')) {
    db.exec('ALTER TABLE groups ADD COLUMN account_id TEXT');
  }

  const oracleEventColumns = db.prepare('PRAGMA table_info(oracle_sync_events)').all();
  for (const [name, type] of [
    ['stock_quantity', 'INTEGER'],
    ['availability', 'TEXT'],
    ['match_type', 'TEXT'],
    ['source_message_ids', 'TEXT'],
    ['case_id', 'INTEGER'],
    ['supersedes_event_id', 'INTEGER'],
    ['superseded_by_event_id', 'INTEGER']
  ]) {
    if (!oracleEventColumns.some(column => column.name === name)) {
      db.exec(`ALTER TABLE oracle_sync_events ADD COLUMN ${name} ${type}`);
    }
  }

  const oracleRunColumns = db.prepare('PRAGMA table_info(oracle_quote_runs)').all();
  if (!oracleRunColumns.some(column => column.name === 'case_id')) {
    db.exec('ALTER TABLE oracle_quote_runs ADD COLUMN case_id INTEGER');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_account_timestamp
      ON messages (account_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_dm_chats_account
      ON dm_chats (account_id, updated_at DESC);
  `);

  seedDefaultSchemas();
  seedDefaultSettings();
}

function seedDefaultSchemas() {
  const count = db.prepare('SELECT COUNT(*) as count FROM schemas').get().count;
  if (count > 0) return;

  const defaultSchemas = [
    {
      id: 'default',
      name: 'General Information & Summary',
      description: 'Extract key intent, summary, entities, and action items from any message.',
      instruction_prompt: 'Analyze the incoming WhatsApp message (text/image/document) and extract key summary, topic, entities (names, phone numbers, emails, locations), and any implied action items.',
      json_schema: JSON.stringify({
        topic: 'string (short title of message topic)',
        summary: 'string (brief summary of content)',
        entities: {
          names: ['string'],
          contact_info: ['string'],
          dates_or_times: ['string']
        },
        action_required: 'boolean',
        action_items: ['string']
      }, null, 2),
      is_default: 1
    },
    {
      id: 'leads',
      name: 'Sales & Customer Leads Extractor',
      description: 'Extract lead info: customer name, contact details, interest/product requested, budget, and urgency.',
      instruction_prompt: 'Identify if this message is a customer inquiry or sales lead. Extract buyer name, contact details, product/service requested, budget, and urgency level.',
      json_schema: JSON.stringify({
        is_lead: 'boolean',
        customer_name: 'string or null',
        contact: 'string or null',
        product_or_service: 'string',
        budget: 'string or null',
        urgency: 'high | medium | low',
        notes: 'string'
      }, null, 2),
      is_default: 0
    },
    {
      id: 'support_tickets',
      name: 'Issue & Bug Report Tracker',
      description: 'Extract reported bugs, issue severity, affected system/product, and reproduction steps.',
      instruction_prompt: 'Analyze the message for technical issues, complaints, or bug reports. Extract issue category, severity, description, affected component, and reported steps.',
      json_schema: JSON.stringify({
        is_issue: 'boolean',
        issue_title: 'string',
        severity: 'critical | major | minor | info',
        component: 'string',
        description: 'string',
        steps_to_reproduce: ['string']
      }, null, 2),
      is_default: 0
    }
  ];

  const stmt = db.prepare(`
    INSERT INTO schemas (id, name, description, instruction_prompt, json_schema, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const s of defaultSchemas) {
    stmt.run(s.id, s.name, s.description, s.instruction_prompt, s.json_schema, s.is_default);
  }
}

function seedDefaultSettings() {
  const environmentOnlyApiKeys = process.env.ENV_ONLY_API_KEYS === 'true';
  const defaults = {
    llm_provider: process.env.DEFAULT_LLM_PROVIDER || 'gemini',
    llm_model: process.env.DEFAULT_LLM_MODEL || 'gemini-2.0-flash',
    openai_api_key: environmentOnlyApiKeys ? '' : process.env.OPENAI_API_KEY || '',
    gemini_api_key: environmentOnlyApiKeys ? '' : process.env.GEMINI_API_KEY || '',
    anthropic_api_key: environmentOnlyApiKeys ? '' : process.env.ANTHROPIC_API_KEY || '',
    ollama_base_url: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    auto_download_media: 'true',
    extract_document_text: 'true',
    oracle_auto_publish: 'false',
    oracle_context_messages: '30',
    oracle_context_minutes: '15',
    oracle_quiet_period_seconds: '45',
    oracle_case_lifetime_minutes: '60'
  };

  const check = db.prepare('SELECT key FROM settings WHERE key = ?');
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');

  for (const [k, v] of Object.entries(defaults)) {
    if (!check.get(k)) {
      insert.run(k, v);
    }
  }
}

// Group helpers
export function upsertGroup(id, name, accountId = null) {
  const existing = db.prepare('SELECT id, is_monitored, active_schema_id FROM groups WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE groups SET name = ?, account_id = COALESCE(?, account_id), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, accountId, id);
    return existing;
  } else {
    db.prepare("INSERT INTO groups (id, name, is_monitored, active_schema_id, account_id) VALUES (?, ?, 0, 'default', ?)").run(id, name, accountId);
    return { id, name, is_monitored: 0, active_schema_id: 'default', account_id: accountId };
  }
}

export function getGroups() {
  const activeAccount = getActiveWhatsappAccount();
  if (activeAccount) {
    return db.prepare(`
      SELECT g.*,
        COUNT(m.id) AS message_count,
        MIN(m.timestamp) AS first_message_at,
        MAX(m.timestamp) AS last_message_at
      FROM groups g
      LEFT JOIN messages m
        ON m.group_id = g.id
        AND m.chat_type = 'group'
        AND m.account_id = g.account_id
      WHERE g.account_id = ?
      GROUP BY g.id
      ORDER BY g.updated_at DESC
    `).all(activeAccount);
  }
  return db.prepare(`
    SELECT g.*,
      COUNT(m.id) AS message_count,
      MIN(m.timestamp) AS first_message_at,
      MAX(m.timestamp) AS last_message_at
    FROM groups g
    LEFT JOIN messages m ON m.group_id = g.id AND m.chat_type = 'group'
    GROUP BY g.id
    ORDER BY g.updated_at DESC
  `).all();
}

export function getActiveWhatsappAccount() {
  return db.prepare("SELECT value FROM settings WHERE key = 'whatsapp_account_id'").get()?.value || null;
}

export function setActiveWhatsappAccount(accountId) {
  const normalized = String(accountId || '').trim();
  if (!normalized) return false;
  const current = db.prepare("SELECT value FROM settings WHERE key = 'whatsapp_account_id'").get()?.value;
  if (current === normalized) return false;

  db.transaction(() => {
    db.prepare('UPDATE groups SET is_monitored = 0, oracle_sync_enabled = 0, updated_at = CURRENT_TIMESTAMP').run();
    db.prepare('UPDATE dm_chats SET is_monitored = 0, updated_at = CURRENT_TIMESTAMP').run();
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('whatsapp_account_id', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(normalized);
  })();
  return true;
}

export function setGroupMonitoring(
  id,
  isMonitored,
  activeSchemaId = null,
  oracleSyncEnabled = false,
  oracleSupplierCode = null,
  oracleSupplierSenderIds = null
) {
  db.prepare(`
    UPDATE groups SET
      is_monitored = ?,
      active_schema_id = COALESCE(?, active_schema_id),
      oracle_sync_enabled = ?,
      oracle_supplier_code = ?,
      oracle_supplier_sender_ids = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    isMonitored ? 1 : 0,
    activeSchemaId || null,
    oracleSyncEnabled ? 1 : 0,
    oracleSupplierCode || null,
    oracleSupplierSenderIds || null,
    id
  );
}

// Direct-message helpers. Aliases let the same conversation match either its
// phone-number JID (@s.whatsapp.net) or privacy-preserving LID (@lid).
export function upsertDmChat({ id, name, phoneJid = null, lidJid = null, accountId = getActiveWhatsappAccount() }) {
  const aliases = [...new Set([id, phoneJid, lidJid].filter(Boolean))];
  const matches = [];

  for (const alias of aliases) {
    const match = db.prepare(`
      SELECT d.* FROM dm_chats d
      LEFT JOIN dm_aliases a ON a.dm_id = d.id
      WHERE (d.id = ? OR a.alias_jid = ?)
        AND (? IS NULL OR d.account_id = ?)
      LIMIT 1
    `).get(alias, alias, accountId, accountId);
    if (match && !matches.some(existingMatch => existingMatch.id === match.id)) matches.push(match);
  }

  const existing = matches.find(match => match.is_monitored === 1)
    || matches.find(match => phoneJid && match.id === phoneJid)
    || matches[0]
    || null;
  const dmId = existing?.id || phoneJid || id || lidJid;
  if (!dmId) return null;

  const fallbackName = dmId.split('@')[0];
  const resolvedName = name && name !== id && name !== phoneJid && name !== lidJid
    ? name
    : existing?.name || fallbackName;

  db.prepare(`
    INSERT INTO dm_chats (id, name, phone_jid, lid_jid, account_id, is_monitored)
    VALUES (?, ?, ?, ?, ?, 0)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      phone_jid = COALESCE(excluded.phone_jid, dm_chats.phone_jid),
      lid_jid = COALESCE(excluded.lid_jid, dm_chats.lid_jid),
      account_id = COALESCE(excluded.account_id, dm_chats.account_id),
      updated_at = CURRENT_TIMESTAMP
  `).run(dmId, resolvedName, phoneJid, lidJid, accountId);

  // A phone JID and LID can arrive in separate sync chunks. Once WhatsApp
  // supplies their relationship, collapse any duplicate chat rows without
  // losing monitoring state or already stored messages.
  for (const duplicate of matches.filter(match => match.id !== dmId)) {
    db.prepare("UPDATE messages SET group_id = ? WHERE group_id = ? AND chat_type = 'dm'").run(dmId, duplicate.id);
    db.prepare('UPDATE dm_aliases SET dm_id = ? WHERE dm_id = ?').run(dmId, duplicate.id);
    if (duplicate.is_monitored === 1) {
      db.prepare('UPDATE dm_chats SET is_monitored = 1 WHERE id = ?').run(dmId);
    }
    db.prepare('DELETE FROM dm_chats WHERE id = ?').run(duplicate.id);
  }

  const aliasStmt = db.prepare(`
    INSERT INTO dm_aliases (alias_jid, dm_id) VALUES (?, ?)
    ON CONFLICT(alias_jid) DO UPDATE SET dm_id = excluded.dm_id
  `);
  for (const alias of [...new Set([dmId, ...aliases])]) {
    aliasStmt.run(alias, dmId);
  }

  return db.prepare('SELECT * FROM dm_chats WHERE id = ?').get(dmId);
}

export function findDmChatByJid(jid) {
  const activeAccount = getActiveWhatsappAccount();
  return db.prepare(`
    SELECT d.* FROM dm_chats d
    LEFT JOIN dm_aliases a ON a.dm_id = d.id
    WHERE (d.id = ? OR a.alias_jid = ?)
      AND (? IS NULL OR d.account_id = ?)
    LIMIT 1
  `).get(jid, jid, activeAccount, activeAccount);
}

export function getDmChats() {
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount) return [];
  return db.prepare(`
    SELECT d.*, COUNT(m.id) AS message_count, MAX(m.timestamp) AS last_message_at
    FROM dm_chats d
    LEFT JOIN messages m
      ON m.group_id = d.id
      AND m.chat_type = 'dm'
      AND m.account_id = d.account_id
    WHERE d.account_id = ?
    GROUP BY d.id
    ORDER BY d.is_monitored DESC, COALESCE(last_message_at, d.updated_at) DESC, d.name COLLATE NOCASE
  `).all(activeAccount);
}

export function setDmMonitoring(id, isMonitored) {
  db.prepare('UPDATE dm_chats SET is_monitored = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(isMonitored ? 1 : 0, id);
}

// Schema helpers
export function getSchemas() {
  return db.prepare('SELECT * FROM schemas ORDER BY created_at DESC').all();
}

export function getSchemaById(id) {
  return db.prepare('SELECT * FROM schemas WHERE id = ?').get(id);
}

export function saveSchema({ id, name, description, instruction_prompt, json_schema }) {
  db.prepare(`
    INSERT INTO schemas (id, name, description, instruction_prompt, json_schema)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      description=excluded.description,
      instruction_prompt=excluded.instruction_prompt,
      json_schema=excluded.json_schema
  `).run(id, name, description, instruction_prompt, json_schema);
}

export function deleteSchema(id) {
  if (id === 'default') throw new Error('Cannot delete default schema');
  db.prepare('DELETE FROM schemas WHERE id = ?').run(id);
  db.prepare("UPDATE groups SET active_schema_id = 'default' WHERE active_schema_id = ?").run(id);
}

// Message & Extraction helpers
export function saveMessage(msg) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO messages (wa_message_id, group_id, group_name, sender_id, sender_name, message_type, content, extracted_text, media_path, media_mime, raw_json, source, chat_type, account_id, reply_to_wa_message_id, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    msg.wa_message_id,
    msg.group_id,
    msg.group_name || null,
    msg.sender_id,
    msg.sender_name || null,
    msg.message_type,
    msg.content || null,
    msg.extracted_text || null,
    msg.media_path || null,
    msg.media_mime || null,
    msg.raw_json ? JSON.stringify(msg.raw_json) : null,
    msg.source || 'realtime',
    msg.chat_type || 'group',
    msg.account_id || getActiveWhatsappAccount(),
    msg.reply_to_wa_message_id || null,
    msg.timestamp
  );
  if (result.changes === 0) {
    return db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(msg.wa_message_id)?.id || null;
  }
  return Number(result.lastInsertRowid);
}

export function saveExtraction(ext) {
  const stmt = db.prepare(`
    INSERT INTO extractions (message_id, group_id, schema_id, llm_provider, llm_model, extracted_data, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    ext.message_id,
    ext.group_id,
    ext.schema_id,
    ext.llm_provider,
    ext.llm_model,
    typeof ext.extracted_data === 'object' ? JSON.stringify(ext.extracted_data) : ext.extracted_data,
    ext.status || 'success',
    ext.error_message || null
  );
  return result.lastInsertRowid;
}

export function getRecentGroupMessages(groupId, limit = 12) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 12, 50));
  const activeAccount = getActiveWhatsappAccount();
  return db.prepare(`
    SELECT id, wa_message_id, group_id, sender_id, sender_name, content, extracted_text,
      reply_to_wa_message_id, timestamp
    FROM messages
    WHERE group_id = ? AND chat_type = 'group'
      AND (? IS NULL OR account_id = ?)
    ORDER BY timestamp DESC, id DESC
    LIMIT ?
  `).all(groupId, activeAccount, activeAccount, safeLimit);
}

export function getGroupMessagesEndingAt(groupId, currentMessageId, limit = 12) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 12, 200));
  const activeAccount = getActiveWhatsappAccount();
  const current = db.prepare(`
    SELECT id, timestamp
    FROM messages
    WHERE id = ? AND group_id = ? AND chat_type = 'group'
      AND (? IS NULL OR account_id = ?)
  `).get(currentMessageId, groupId, activeAccount, activeAccount);
  if (!current) return [];

  return db.prepare(`
    SELECT id, wa_message_id, group_id, sender_id, sender_name, content, extracted_text,
      reply_to_wa_message_id, timestamp
    FROM messages
    WHERE group_id = ? AND chat_type = 'group'
      AND (? IS NULL OR account_id = ?)
      AND (timestamp < ? OR (timestamp = ? AND id <= ?))
    ORDER BY timestamp DESC, id DESC
    LIMIT ?
  `).all(
    groupId,
    activeAccount,
    activeAccount,
    current.timestamp,
    current.timestamp,
    current.id,
    safeLimit
  );
}

function serializeJson(value, fallback) {
  if (value == null) return JSON.stringify(fallback);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function createOracleQuoteCase(caseRecord) {
  const result = db.prepare(`
    INSERT INTO oracle_quote_cases (
      account_id, group_id, supplier_code, supplier_sender_id,
      requester_sender_id, request_message_id, status, known_fields_json,
      missing_fields_json, source_message_ids, correlation_json,
      current_event_id, last_message_id, last_reason, opened_at,
      last_activity_at, expires_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    caseRecord.account_id || getActiveWhatsappAccount(),
    caseRecord.group_id,
    caseRecord.supplier_code,
    caseRecord.supplier_sender_id || null,
    caseRecord.requester_sender_id || null,
    caseRecord.request_message_id || null,
    caseRecord.status || 'collecting',
    serializeJson(caseRecord.known_fields_json, {}),
    serializeJson(caseRecord.missing_fields_json, []),
    serializeJson(caseRecord.source_message_ids, []),
    caseRecord.correlation_json == null ? null : serializeJson(caseRecord.correlation_json, {}),
    caseRecord.current_event_id || null,
    caseRecord.last_message_id || null,
    caseRecord.last_reason || null,
    caseRecord.opened_at,
    caseRecord.last_activity_at,
    caseRecord.expires_at,
    caseRecord.completed_at || null
  );
  return getOracleQuoteCaseById(Number(result.lastInsertRowid));
}

export function getOracleQuoteCaseById(id) {
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount) return null;
  return db.prepare(`
    SELECT c.*, g.name AS group_name,
      (SELECT COUNT(*) FROM oracle_quote_case_messages cm WHERE cm.case_id = c.id) AS message_count
    FROM oracle_quote_cases c
    LEFT JOIN groups g ON g.id = c.group_id
    WHERE c.id = ? AND c.account_id = ?
  `).get(id, activeAccount);
}

export function updateOracleQuoteCase(id, changes) {
  const allowed = [
    'status',
    'known_fields_json',
    'missing_fields_json',
    'source_message_ids',
    'correlation_json',
    'current_event_id',
    'last_message_id',
    'last_reason',
    'last_activity_at',
    'expires_at',
    'completed_at',
    'requester_sender_id',
    'request_message_id'
  ];
  const jsonColumns = new Set(['known_fields_json', 'missing_fields_json', 'source_message_ids', 'correlation_json']);
  const entries = Object.entries(changes).filter(([key]) => allowed.includes(key));
  if (entries.length === 0) return getOracleQuoteCaseById(id);
  const values = entries.map(([key, value]) => jsonColumns.has(key) && value != null ? serializeJson(value, null) : value);
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  db.prepare(`UPDATE oracle_quote_cases SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...values.map(value => value ?? null), id);
  return getOracleQuoteCaseById(id);
}

export function attachMessagesToOracleQuoteCase(caseId, messages, { roleForMessage, correlationScore = null, matchReasons = [] } = {}) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO oracle_quote_case_messages (
      case_id, message_id, role, correlation_score, match_reasons_json
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const attach = db.transaction(rows => {
    for (const message of rows || []) {
      if (!message?.id) continue;
      const role = roleForMessage ? roleForMessage(message) : 'context';
      insert.run(caseId, message.id, role, correlationScore, serializeJson(matchReasons, []));
    }
  });
  attach(messages);

  const attached = getOracleQuoteCaseMessages(caseId);
  const sourceIds = attached.map(message => message.wa_message_id || String(message.id));
  if (sourceIds.length > 0) {
    db.prepare('UPDATE oracle_quote_cases SET source_message_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(sourceIds), caseId);
  }
  return getOracleQuoteCaseById(caseId);
}

export function getOracleQuoteCaseMessages(caseId) {
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount) return [];
  return db.prepare(`
    SELECT m.id, m.wa_message_id, m.group_id, m.sender_id, m.sender_name,
      m.content, m.extracted_text, m.reply_to_wa_message_id, m.timestamp,
      cm.role, cm.correlation_score, cm.match_reasons_json
    FROM oracle_quote_case_messages cm
    INNER JOIN oracle_quote_cases c ON c.id = cm.case_id AND c.account_id = ?
    INNER JOIN messages m ON m.id = cm.message_id AND m.account_id = c.account_id
    WHERE cm.case_id = ?
    ORDER BY m.timestamp ASC, m.id ASC
  `).all(activeAccount, caseId);
}

export function expireOracleQuoteCases(atTimestamp = new Date().toISOString()) {
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount) return 0;
  return db.prepare(`
    UPDATE oracle_quote_cases
    SET status = 'expired', last_reason = 'case_lifetime_elapsed',
      completed_at = COALESCE(completed_at, ?), updated_at = CURRENT_TIMESTAMP
    WHERE account_id = ? AND expires_at < ?
      AND status IN ('collecting', 'incomplete', 'ambiguous')
  `).run(atTimestamp, activeAccount, atTimestamp).changes;
}

export function getActiveOracleQuoteCases(groupId, supplierCode, atTimestamp = new Date().toISOString()) {
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount) return [];
  return db.prepare(`
    SELECT c.*, g.name AS group_name
    FROM oracle_quote_cases c
    LEFT JOIN groups g ON g.id = c.group_id
    WHERE c.account_id = ? AND c.group_id = ? AND c.supplier_code = ?
      AND c.expires_at >= ?
      AND c.status IN ('collecting', 'incomplete', 'ready', 'published')
    ORDER BY c.last_activity_at DESC, c.id DESC
  `).all(activeAccount, groupId, supplierCode, atTimestamp);
}

export function getOracleQuoteCases(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount) return [];
  return db.prepare(`
    SELECT c.*, g.name AS group_name,
      (SELECT COUNT(*) FROM oracle_quote_case_messages cm WHERE cm.case_id = c.id) AS message_count
    FROM oracle_quote_cases c
    LEFT JOIN groups g ON g.id = c.group_id
    WHERE c.account_id = ?
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT ?
  `).all(activeAccount, safeLimit);
}

export function createOracleSyncEvent(event) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO oracle_sync_events (
      message_id, group_id, supplier_code, supplier_name, payload_hash,
      listing_status, sync_status, brand, model, size, price,
      year_of_manufacture, country_of_origin, quoted_at, confidence,
      stock_quantity, availability, match_type, source_message_ids,
      case_id, supersedes_event_id, request_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    event.message_id,
    event.group_id,
    event.supplier_code,
    event.supplier_name || null,
    event.payload_hash,
    event.listing_status,
    event.sync_status,
    event.brand,
    event.model,
    event.size,
    event.price,
    event.year_of_manufacture || null,
    event.country_of_origin || null,
    event.quoted_at,
    event.confidence || null,
    event.stock_quantity || null,
    event.availability || null,
    event.match_type || null,
    event.source_message_ids ? JSON.stringify(event.source_message_ids) : null,
    event.case_id || null,
    event.supersedes_event_id || null,
    event.request_payload
  );
  if (result.changes === 0) return null;
  return getOracleSyncEventById(Number(result.lastInsertRowid));
}

export function createOracleQuoteRun(run) {
  const result = db.prepare(`
    INSERT INTO oracle_quote_runs (
      group_id, trigger_message_id, status, reason, source_message_ids,
      extraction_json, event_count, case_id, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.group_id,
    run.trigger_message_id,
    run.status,
    run.reason || null,
    run.source_message_ids ? JSON.stringify(run.source_message_ids) : null,
    run.extraction_json ? JSON.stringify(run.extraction_json) : null,
    Number(run.event_count) || 0,
    run.case_id || null,
    run.error_message || null
  );
  return getOracleQuoteRunById(Number(result.lastInsertRowid));
}

export function getOracleQuoteRunById(id) {
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount) return null;
  return db.prepare(`
    SELECT r.*, g.name AS group_name
    FROM oracle_quote_runs r
    LEFT JOIN groups g ON g.id = r.group_id
    INNER JOIN messages m ON m.id = r.trigger_message_id AND m.account_id = ?
    WHERE r.id = ?
  `).get(activeAccount, id);
}

export function updateOracleQuoteRun(id, changes) {
  const allowed = ['status', 'reason', 'source_message_ids', 'extraction_json', 'event_count', 'error_message'];
  const entries = Object.entries(changes).filter(([key]) => allowed.includes(key));
  if (entries.length === 0) return getOracleQuoteRunById(id);
  const serialized = entries.map(([key, value]) => [
    key,
    ['source_message_ids', 'extraction_json'].includes(key) && value != null ? JSON.stringify(value) : value
  ]);
  const assignments = serialized.map(([key]) => `${key} = ?`).join(', ');
  db.prepare(`UPDATE oracle_quote_runs SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...serialized.map(([, value]) => value ?? null), id);
  return getOracleQuoteRunById(id);
}

export function getOracleQuoteRuns(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount) return [];
  return db.prepare(`
    SELECT r.*, g.name AS group_name
    FROM oracle_quote_runs r
    LEFT JOIN groups g ON g.id = r.group_id
    INNER JOIN messages m ON m.id = r.trigger_message_id AND m.account_id = ?
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ?
  `).all(activeAccount, safeLimit);
}

export function getOracleSyncEventById(id) {
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount) return null;
  return db.prepare(`
    SELECT e.*, g.name AS group_name
    FROM oracle_sync_events e
    LEFT JOIN groups g ON g.id = e.group_id
    INNER JOIN messages m ON m.id = e.message_id AND m.account_id = ?
    WHERE e.id = ?
  `).get(activeAccount, id);
}

export function getOracleSyncEventByPayloadHash(payloadHash) {
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount) return null;
  return db.prepare(`
    SELECT e.*, g.name AS group_name
    FROM oracle_sync_events e
    LEFT JOIN groups g ON g.id = e.group_id
    INNER JOIN messages m ON m.id = e.message_id AND m.account_id = ?
    WHERE e.payload_hash = ?
  `).get(activeAccount, payloadHash);
}

export function getOracleSyncEventsForCase(caseId) {
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount || !caseId) return [];
  return db.prepare(`
    SELECT e.*, g.name AS group_name
    FROM oracle_sync_events e
    LEFT JOIN groups g ON g.id = e.group_id
    INNER JOIN messages m ON m.id = e.message_id AND m.account_id = ?
    WHERE e.case_id = ?
    ORDER BY e.created_at DESC, e.id DESC
  `).all(activeAccount, caseId);
}

export function updateOracleSyncEvent(id, changes) {
  const allowed = [
    'sync_status',
    'oracle_price_id',
    'response_json',
    'error_message',
    'superseded_by_event_id'
  ];
  const entries = Object.entries(changes).filter(([key]) => allowed.includes(key));
  if (entries.length === 0) return getOracleSyncEventById(id);
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  db.prepare(`UPDATE oracle_sync_events SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...entries.map(([, value]) => value ?? null), id);
  return getOracleSyncEventById(id);
}

export function getOracleSyncEvents(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount) return [];
  return db.prepare(`
    SELECT e.*, g.name AS group_name
    FROM oracle_sync_events e
    LEFT JOIN groups g ON g.id = e.group_id
    INNER JOIN messages m ON m.id = e.message_id AND m.account_id = ?
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ?
  `).all(activeAccount, safeLimit);
}

export function getMessagesWithExtractions({ groupId = null, limit = 50, offset = 0, search = '' }) {
  let query = `
    SELECT 
      m.*,
      e.id as extraction_id,
      e.schema_id,
      e.llm_provider,
      e.llm_model,
      e.extracted_data,
      e.status as extraction_status,
      e.error_message as extraction_error,
      e.processed_at as extraction_timestamp
    FROM messages m
    LEFT JOIN extractions e ON m.id = e.message_id
    WHERE 1=1
  `;
  const params = [];
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount) return [];

  query += ' AND m.account_id = ?';
  params.push(activeAccount);

  if (groupId) {
    query += ' AND m.group_id = ?';
    params.push(groupId);
  }

  if (search) {
    query += ' AND (m.content LIKE ? OR m.sender_name LIKE ? OR m.group_name LIKE ? OR e.extracted_data LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  query += ' ORDER BY m.timestamp DESC, m.id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

export function getStats() {
  const activeAccount = getActiveWhatsappAccount();
  if (!activeAccount) {
    return { totalMessages: 0, totalExtractions: 0, activeGroups: 0, activeDms: 0, mediaCount: 0 };
  }
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages WHERE account_id = ?').get(activeAccount).count;
  const totalExtractions = db.prepare(`
    SELECT COUNT(*) as count
    FROM extractions e
    INNER JOIN messages m ON m.id = e.message_id
    WHERE e.status = 'success' AND m.account_id = ?
  `).get(activeAccount).count;
  const activeGroups = db.prepare('SELECT COUNT(*) as count FROM groups WHERE is_monitored = 1 AND account_id = ?').get(activeAccount).count;
  const activeDms = db.prepare('SELECT COUNT(*) as count FROM dm_chats WHERE is_monitored = 1 AND account_id = ?').get(activeAccount).count;
  const mediaCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE media_path IS NOT NULL AND account_id = ?').get(activeAccount).count;

  return { totalMessages, totalExtractions, activeGroups, activeDms, mediaCount };
}

// Settings helpers
export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const r of rows) {
    obj[r.key] = r.value;
  }
  return obj;
}

export function updateSettings(newSettings) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(newSettings)) {
    stmt.run(k, String(v));
  }
}

export default db;
