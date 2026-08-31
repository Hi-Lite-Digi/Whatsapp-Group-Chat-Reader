import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function normalizeMessage(row, groupName) {
  const id = String(row?.id || '').trim();
  const senderName = String(row?.senderName || '').trim();
  const senderId = String(row?.senderId || senderName || '').trim();
  const content = String(row?.content || '').trim();
  const messageType = String(row?.messageType || 'conversation').trim();
  const timestamp = new Date(row?.timestamp);

  if (!id || !senderName || !senderId || !content || !messageType || Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid history message in ${groupName}: ${id || '<missing id>'}`);
  }

  return {
    id,
    senderName,
    senderId,
    content,
    messageType,
    timestamp: timestamp.toISOString(),
    metadata: row?.metadata ?? null
  };
}

export function importWebHistoryEnvelope(db, envelope, { dryRun = false } = {}) {
  if (!envelope || envelope.oracleWritesAllowed !== false || typeof envelope.groups !== 'object') {
    throw new Error('History envelope must explicitly disable Oracle writes and contain groups.');
  }

  const activeAccount = db.prepare("SELECT value FROM settings WHERE key = 'whatsapp_account_id'").get()?.value;
  if (!activeAccount) throw new Error('No active WhatsApp account is configured.');

  const groups = [];
  const seenMessageIds = new Map();
  let received = 0;

  for (const [groupName, payload] of Object.entries(envelope.groups)) {
    const groupId = String(payload?.groupId || '').trim();
    const group = db.prepare(`
      SELECT id, name, account_id, is_monitored, oracle_sync_enabled
      FROM groups
      WHERE id = ? AND account_id = ?
    `).get(groupId, activeAccount);

    if (!group) throw new Error(`History group is not registered for the active account: ${groupName}`);
    if (group.is_monitored !== 0 || group.oracle_sync_enabled !== 0) {
      throw new Error(`History import requires monitoring and Oracle sync to be disabled: ${group.name}`);
    }

    const rawRows = Array.isArray(payload?.messages) ? payload.messages : [];
    if (rawRows.length > 10000) throw new Error(`History group exceeds the 10,000-message limit: ${group.name}`);

    const messages = rawRows.map(row => normalizeMessage(row, group.name));
    for (const message of messages) {
      const priorGroupId = seenMessageIds.get(message.id);
      if (priorGroupId && priorGroupId !== group.id) {
        throw new Error(`WhatsApp message ID appears in multiple groups: ${message.id}`);
      }
      seenMessageIds.set(message.id, group.id);
    }

    received += messages.length;
    groups.push({ group, messages });
  }

  const before = {
    messages: countRows(db, 'messages'),
    extractions: countRows(db, 'extractions'),
    oracleSyncEvents: countRows(db, 'oracle_sync_events')
  };
  const summary = {
    dryRun: Boolean(dryRun),
    activeAccount,
    received,
    imported: 0,
    duplicates: 0,
    groups: []
  };

  const findExisting = db.prepare(`
    SELECT id, group_id, account_id
    FROM messages
    WHERE wa_message_id = ?
  `);
  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages (
      wa_message_id, group_id, group_name, sender_id, sender_name,
      message_type, content, raw_json, source, chat_type, account_id, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'web_history', 'group', ?, ?)
  `);

  const runImport = db.transaction(() => {
    for (const { group, messages } of groups) {
      const groupSummary = {
        groupId: group.id,
        groupName: group.name,
        received: messages.length,
        imported: 0,
        duplicates: 0
      };

      for (const message of messages) {
        const existing = findExisting.get(message.id);
        if (existing) {
          if (existing.group_id !== group.id || existing.account_id !== activeAccount) {
            throw new Error(`WhatsApp message ID collision outside the target group: ${message.id}`);
          }
          summary.duplicates++;
          groupSummary.duplicates++;
          continue;
        }

        if (dryRun) {
          summary.imported++;
          groupSummary.imported++;
          continue;
        }

        const result = insertMessage.run(
          message.id,
          group.id,
          group.name,
          message.senderId,
          message.senderName,
          message.messageType,
          message.content,
          JSON.stringify({
            source: 'whatsapp_web_history_import',
            browser_metadata: message.metadata
          }),
          activeAccount,
          message.timestamp
        );
        if (result.changes !== 1) throw new Error(`Could not import WhatsApp message: ${message.id}`);

        summary.imported++;
        groupSummary.imported++;
      }

      summary.groups.push(groupSummary);
    }
  });

  runImport();

  const after = {
    messages: countRows(db, 'messages'),
    extractions: countRows(db, 'extractions'),
    oracleSyncEvents: countRows(db, 'oracle_sync_events')
  };
  if (after.extractions !== before.extractions || after.oracleSyncEvents !== before.oracleSyncEvents) {
    throw new Error('Historical import unexpectedly changed extraction or Oracle event counts.');
  }
  if (!dryRun && after.messages - before.messages !== summary.imported) {
    throw new Error('Historical import message count verification failed.');
  }
  if (dryRun && after.messages !== before.messages) {
    throw new Error('Dry-run history import changed the database.');
  }

  summary.before = before;
  summary.after = after;
  summary.safeguards = {
    monitoringDisabled: true,
    oracleSyncDisabled: true,
    extractionCountsUnchanged: true,
    oracleEventCountsUnchanged: true
  };
  return summary;
}

async function main() {
  const historyPath = process.argv.find(argument => !argument.startsWith('--') && argument !== process.argv[0] && argument !== process.argv[1]);
  const dryRun = process.argv.includes('--dry-run');
  if (!historyPath) throw new Error('Usage: node scripts/import-web-history.mjs <history.json> [--dry-run]');

  const { default: Database } = await import('better-sqlite3');
  const dbPath = process.env.DB_PATH || path.resolve('runtime/data/whatsapp_bot.db');
  const envelope = JSON.parse(fs.readFileSync(path.resolve(historyPath), 'utf8'));
  const db = new Database(dbPath);
  try {
    const result = importWebHistoryEnvelope(db, envelope, { dryRun });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
