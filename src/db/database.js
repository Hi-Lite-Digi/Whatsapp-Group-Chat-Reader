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
      is_monitored INTEGER DEFAULT 1,
      active_schema_id TEXT DEFAULT 'default',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
  const defaults = {
    llm_provider: process.env.DEFAULT_LLM_PROVIDER || 'gemini',
    llm_model: process.env.DEFAULT_LLM_MODEL || 'gemini-2.0-flash',
    openai_api_key: process.env.OPENAI_API_KEY || '',
    gemini_api_key: process.env.GEMINI_API_KEY || '',
    anthropic_api_key: process.env.ANTHROPIC_API_KEY || '',
    ollama_base_url: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    auto_download_media: 'true',
    extract_document_text: 'true'
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
export function upsertGroup(id, name) {
  const existing = db.prepare('SELECT id, is_monitored, active_schema_id FROM groups WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, id);
    return existing;
  } else {
    db.prepare("INSERT INTO groups (id, name, is_monitored, active_schema_id) VALUES (?, ?, 1, 'default')").run(id, name);
    return { id, name, is_monitored: 1, active_schema_id: 'default' };
  }
}

export function getGroups() {
  return db.prepare('SELECT * FROM groups ORDER BY updated_at DESC').all();
}

export function setGroupMonitoring(id, isMonitored, activeSchemaId = null) {
  if (activeSchemaId) {
    db.prepare('UPDATE groups SET is_monitored = ?, active_schema_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(isMonitored ? 1 : 0, activeSchemaId, id);
  } else {
    db.prepare('UPDATE groups SET is_monitored = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(isMonitored ? 1 : 0, id);
  }
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
    INSERT INTO messages (wa_message_id, group_id, group_name, sender_id, sender_name, message_type, content, extracted_text, media_path, media_mime, raw_json, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    msg.timestamp
  );
  return result.lastInsertRowid;
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

  if (groupId) {
    query += ' AND m.group_id = ?';
    params.push(groupId);
  }

  if (search) {
    query += ' AND (m.content LIKE ? OR m.sender_name LIKE ? OR m.group_name LIKE ? OR e.extracted_data LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  query += ' ORDER BY m.id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all();
}

export function getStats() {
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  const totalExtractions = db.prepare("SELECT COUNT(*) as count FROM extractions WHERE status = 'success'").get().count;
  const activeGroups = db.prepare('SELECT COUNT(*) as count FROM groups WHERE is_monitored = 1').get().count;
  const mediaCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE media_path IS NOT NULL').get().count;

  return { totalMessages, totalExtractions, activeGroups, mediaCount };
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
