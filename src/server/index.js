import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { monitorAuthorized, summarizeQueue } from './monitoring.js';

import {
  initDatabase,
  getGroups,
  setGroupMonitoring,
  getDmChats,
  setDmMonitoring,
  getSchemas,
  saveSchema,
  deleteSchema,
  getMessagesWithExtractions,
  getStats,
  getSettings,
  updateSettings,
  getOracleQuoteCaseById,
  getOracleQuoteCaseMessages,
  getOracleQuoteCases,
  getOracleQuoteRunsForCase,
  getOracleQuoteRuns,
  getOracleSyncEventsForCase,
  getOracleSyncEvents,
  getActiveWhatsappAccount,
  saveMessage,
  db
} from '../db/database.js';

import {
  initWhatsAppClient,
  setSocketIO,
  getConnectionState,
  syncGroups,
  disconnectWhatsApp,
  shutdownWhatsApp,
  clearAuthSession,
  requestPairingCode,
  sendWhatsAppMessage,
  addDmByPhoneNumber,
  importBufferedHistoryForGroup,
  importBufferedHistoryForDm,
  requestHistoryForGroup,
  requestHistoryForDm,
  recoverGroupHistoryFromAnchor
} from '../whatsapp/client.js';
import {
  getOracleConfiguration,
  getOracleSuppliers,
  pingOracle
} from '../oracle/client.js';
import { publishOracleSyncEvent } from '../oracle/sync.js';
import { settingsForClient, settingsUpdateForStorage } from './settings-security.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ALLOW_SEND_MESSAGES = process.env.ALLOW_SEND_MESSAGES === 'true';
const configuredOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  ...configuredOrigins
])];
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

const mediaFolder = path.resolve(process.env.MEDIA_FOLDER || './downloads/media');

// Initialize SQLite DB
initDatabase();

// Pass Socket.IO instance to WhatsApp client
setSocketIO(io);

// Middleware
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '10mb' }));

// Serve downloaded media files
if (!fs.existsSync(mediaFolder)) {
  fs.mkdirSync(mediaFolder, { recursive: true });
}
app.use('/media', express.static(mediaFolder));

// API Routes

function requireMonitorToken(req, res, next) {
  if (!process.env.MONITOR_TOKEN) {
    return res.status(503).json({ ok: false, status: 'not_configured' });
  }
  if (!monitorAuthorized(req.headers.authorization)) {
    return res.status(401).json({ ok: false, status: 'unauthorized' });
  }
  res.set('Cache-Control', 'no-store');
  return next();
}

app.use('/monitor', requireMonitorToken);

app.get('/monitor/live', (req, res) => {
  res.json({ status: 'ok', lastSeenAt: new Date().toISOString(), uptimeSeconds: Math.round(process.uptime()) });
});

app.get('/monitor/ready', (req, res) => {
  const whatsapp = getConnectionState();
  const ready = whatsapp.status === 'connected';
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    lastConnectedAt: whatsapp.lastConnectedAt,
    lastMessageAt: whatsapp.lastMessageAt,
    reconnectAttempts: whatsapp.reconnectAttempts,
    reconnectScheduled: whatsapp.reconnectScheduled,
    reconnectSuppressed: whatsapp.reconnectSuppressed,
    ingestion: whatsapp.ingestion
  });
});

app.get('/monitor/queue', (req, res) => {
  const cases = getOracleQuoteCases(500);
  res.json({ status: 'ok', ...summarizeQueue(cases) });
});

app.get('/monitor/oracle', async (req, res) => {
  const configuration = getOracleConfiguration();
  if (!configuration.configured) {
    return res.status(503).json({ ok: false, status: 'not_configured', message: 'Oracle API is not configured.' });
  }
  try {
    await pingOracle();
    const suppliers = await getOracleSuppliers();
    return res.json({ ok: true, status: 'connected', supplierCount: suppliers.length });
  } catch (error) {
    return res.status(502).json({ ok: false, status: 'down', message: error.message });
  }
});

app.get('/health/live', (req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

app.get('/health/ready', (req, res) => {
  const whatsapp = getConnectionState();
  const ready = whatsapp.status === 'connected';
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    whatsapp: {
      status: whatsapp.status,
      lastConnectedAt: whatsapp.lastConnectedAt,
      lastMessageAt: whatsapp.lastMessageAt,
      lastDisconnectAt: whatsapp.lastDisconnectAt,
      lastDisconnectReason: whatsapp.lastDisconnectReason,
      reconnectAttempts: whatsapp.reconnectAttempts,
      reconnectScheduled: whatsapp.reconnectScheduled,
      reconnectSuppressed: whatsapp.reconnectSuppressed,
      ingestion: whatsapp.ingestion
    }
  });
});

// Connection status
app.get('/api/status', (req, res) => {
  res.json(getConnectionState());
});

app.post('/api/whatsapp/connect', async (req, res) => {
  initWhatsAppClient();
  res.json({ message: 'WhatsApp connection process initiated' });
});

app.post('/api/whatsapp/pairing-code', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required' });
    const code = await requestPairingCode(phoneNumber);
    res.json({ message: 'Pairing code generated', code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/whatsapp/send-message', async (req, res) => {
  try {
    if (!ALLOW_SEND_MESSAGES) {
      return res.status(403).json({ error: 'Sending is disabled. Set ALLOW_SEND_MESSAGES=true to opt in.' });
    }
    const { recipient, message, resetSession } = req.body;
    if (!recipient || !message) {
      return res.status(400).json({ error: 'Both "recipient" and "message" are required.' });
    }
    const result = await sendWhatsAppMessage(recipient, message, { resetSession: !!resetSession });
    res.json({ message: 'Message sent successfully', result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/whatsapp/reset', async (req, res) => {
  await clearAuthSession();
  initWhatsAppClient();
  res.json({ message: 'WhatsApp session reset and new QR generated' });
});

app.post('/api/whatsapp/logout', async (req, res) => {
  await disconnectWhatsApp();
  res.json({ message: 'WhatsApp session logged out' });
});

app.post('/api/whatsapp/recover-group-history', async (req, res) => {
  try {
    const result = await recoverGroupHistoryFromAnchor({
      groupId: String(req.body.groupId || '').trim(),
      messageId: String(req.body.messageId || '').trim(),
      timestamp: req.body.timestamp,
      count: req.body.count
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


// Groups
app.get('/api/groups', (req, res) => {
  res.json(getGroups());
});

app.put('/api/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existingGroup = db.prepare(`
      SELECT id FROM groups
      WHERE id = ?
        AND account_id = (SELECT value FROM settings WHERE key = 'whatsapp_account_id')
    `).get(id);
    if (!existingGroup) return res.status(404).json({ error: 'WhatsApp group not found.' });
    const isMonitored = req.body.is_monitored === true || req.body.is_monitored === 1;
    const oracleSyncEnabled = req.body.oracle_sync_enabled === true || req.body.oracle_sync_enabled === 1;
    const oracleSupplierCode = String(req.body.oracle_supplier_code || '').trim().toUpperCase();
    const oracleSupplierSenderIds = [...new Set(
      String(req.body.oracle_supplier_sender_ids || '')
        .split(/[\s,]+/)
        .map(value => value.trim())
        .filter(Boolean)
    )].join(',');

    if (oracleSyncEnabled && !isMonitored) {
      return res.status(400).json({ error: 'Quotation sync requires group monitoring to be enabled.' });
    }
    if (oracleSyncEnabled && !oracleSupplierCode) {
      return res.status(400).json({ error: 'Select the matching Oracle supplier before enabling quotation sync.' });
    }
    if (oracleSyncEnabled && !oracleSupplierSenderIds) {
      return res.status(400).json({ error: 'Add at least one supplier WhatsApp sender ID before enabling quotation sync.' });
    }
    if (oracleSyncEnabled) {
      const suppliers = await getOracleSuppliers();
      const validSupplier = suppliers.some(supplier => String(supplier.code).toUpperCase() === oracleSupplierCode);
      if (!validSupplier) {
        return res.status(400).json({ error: `Oracle supplier code ${oracleSupplierCode} is not valid.` });
      }
    }

    setGroupMonitoring(
      id,
      isMonitored,
      req.body.active_schema_id,
      oracleSyncEnabled,
      oracleSupplierCode || null,
      oracleSupplierSenderIds || null
    );
    const historyImported = isMonitored ? await importBufferedHistoryForGroup(id) : 0;
    const historyRequested = isMonitored ? await requestHistoryForGroup(id) : false;
    io.emit('groups_updated', getGroups());
    io.emit('stats_updated', getStats());
    res.json({ message: 'Group updated successfully', historyImported, historyRequested, groups: getGroups() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/groups/sync', async (req, res) => {
  const groups = await syncGroups();
  res.json({ message: 'Groups synced successfully', groups });
});

app.post('/api/groups/:id/history', async (req, res) => {
  try {
    const requested = await requestHistoryForGroup(req.params.id, { force: true });
    res.json({
      requested,
      message: requested
        ? 'Older WhatsApp history requested. Available messages will appear when synchronization completes.'
        : 'No history anchor is available yet. The reader will retry automatically after the next group message.'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Imports an explicitly supplied WhatsApp Web history export. Historical rows
// are stored for context and review only; they never trigger retrospective LLM
// extraction or Oracle publishing.
app.post('/api/groups/:id/history/import', (req, res) => {
  try {
    const groupId = req.params.id;
    const accountId = getActiveWhatsappAccount();
    const group = db.prepare(`
      SELECT * FROM groups
      WHERE id = ? AND account_id = ?
    `).get(groupId, accountId);

    if (!accountId || !group) {
      return res.status(404).json({ error: 'WhatsApp group not found for the connected account.' });
    }
    if (group.is_monitored !== 1) {
      return res.status(400).json({ error: 'Enable group monitoring before importing history.' });
    }

    const rows = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (rows.length === 0 || rows.length > 10000) {
      return res.status(400).json({ error: 'Provide between 1 and 10,000 history messages.' });
    }

    let imported = 0;
    let upgraded = 0;
    let duplicates = 0;
    let rejected = 0;
    const readableTypes = new Set([
      'conversation',
      'extendedTextMessage',
      'imageMessage',
      'documentMessage',
      'audioMessage',
      'videoMessage'
    ]);

    const importRows = db.transaction((messages) => {
      for (const row of messages) {
        const messageId = String(row?.id || '').trim();
        const senderName = String(row?.senderName || '').trim();
        const senderId = String(row?.senderId || senderName || 'unknown').trim();
        const content = String(row?.content || '').trim();
        const timestamp = new Date(row?.timestamp);

        if (!messageId || !senderName || !content || Number.isNaN(timestamp.getTime())) {
          rejected++;
          continue;
        }

        const existing = db.prepare(`
          SELECT id, group_id, account_id, message_type
          FROM messages
          WHERE wa_message_id = ?
        `).get(messageId);
        if (existing) {
          if (existing.group_id !== group.id || existing.account_id !== accountId) {
            rejected++;
            continue;
          }
          if (!readableTypes.has(existing.message_type)) {
            db.prepare(`
              UPDATE messages SET
                sender_id = ?, sender_name = ?, message_type = ?, content = ?,
                raw_json = ?, source = ?, timestamp = ?
              WHERE id = ?
            `).run(
              senderId,
              senderName,
              String(row?.messageType || 'conversation'),
              content,
              JSON.stringify({
                source: 'whatsapp_web_history_import',
                browser_metadata: row?.metadata || null,
                replaced_message_type: existing.message_type
              }),
              'web_history',
              timestamp.toISOString(),
              existing.id
            );
            upgraded++;
            continue;
          }
          duplicates++;
          continue;
        }

        saveMessage({
          wa_message_id: messageId,
          group_id: group.id,
          group_name: group.name,
          sender_id: senderId,
          sender_name: senderName,
          message_type: String(row?.messageType || 'conversation'),
          content,
          raw_json: {
            source: 'whatsapp_web_history_import',
            browser_metadata: row?.metadata || null
          },
          source: 'web_history',
          chat_type: 'group',
          account_id: accountId,
          timestamp: timestamp.toISOString()
        });
        imported++;
      }
    });

    importRows(rows);
    io.emit('groups_updated', getGroups());
    io.emit('stats_updated', getStats());
    res.json({ groupId, groupName: group.name, received: rows.length, imported, upgraded, duplicates, rejected });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Direct messages are always opt-in. The WhatsApp sync may discover a chat's
// name/identifier, but message bodies are persisted only after this toggle.
app.get('/api/dms', (req, res) => {
  res.json(getDmChats());
});

app.post('/api/dms', async (req, res) => {
  try {
    const dm = await addDmByPhoneNumber(req.body.phoneNumber, req.body.name);
    res.status(201).json({ message: 'Direct-message chat added in paused mode', dm, dms: getDmChats() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/dms/:id', async (req, res) => {
  const { id } = req.params;
  const existing = db.prepare(`
    SELECT id FROM dm_chats
    WHERE id = ?
      AND account_id = (SELECT value FROM settings WHERE key = 'whatsapp_account_id')
  `).get(id);
  if (!existing) return res.status(404).json({ error: 'Direct-message chat not found' });

  const isMonitored = req.body.is_monitored === true || req.body.is_monitored === 1;
  setDmMonitoring(id, isMonitored);
  const historyImported = isMonitored ? await importBufferedHistoryForDm(id) : 0;
  const historyRequested = isMonitored ? await requestHistoryForDm(id) : false;
  const dms = getDmChats();
  io.emit('dms_updated', dms);
  io.emit('stats_updated', getStats());
  res.json({ message: 'Direct-message monitoring updated', historyImported, historyRequested, dms });
});

// Schemas
app.get('/api/schemas', (req, res) => {
  res.json(getSchemas());
});

app.post('/api/schemas', (req, res) => {
  const { id, name, description, instruction_prompt, json_schema } = req.body;
  if (!id || !name || !instruction_prompt || !json_schema) {
    return res.status(400).json({ error: 'Missing required schema fields' });
  }
  saveSchema({ id, name, description, instruction_prompt, json_schema });
  io.emit('schemas_updated', getSchemas());
  res.json({ message: 'Schema saved successfully', schemas: getSchemas() });
});

app.delete('/api/schemas/:id', (req, res) => {
  try {
    deleteSchema(req.params.id);
    io.emit('schemas_updated', getSchemas());
    res.json({ message: 'Schema deleted', schemas: getSchemas() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Messages & Extractions
app.get('/api/messages', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { groupId, limit = 50, offset = 0, search = '' } = req.query;
  const messages = getMessagesWithExtractions({
    groupId: groupId || null,
    limit: parseInt(limit),
    offset: parseInt(offset),
    search: search || ''
  });
  res.json(messages);
});

// Dashboard metrics
app.get('/api/stats', (req, res) => {
  res.json(getStats());
});

// Settings
app.get('/api/settings', (req, res) => {
  res.json(settingsForClient(getSettings()));
});

app.put('/api/settings', (req, res) => {
  updateSettings(settingsUpdateForStorage(req.body));
  const settings = settingsForClient(getSettings());
  io.emit('settings_updated', settings);
  res.json({ message: 'Settings updated successfully', settings });
});

// Oracle quotation synchronization. Credentials remain server-side and are
// never returned to the browser.
app.get('/api/oracle/status', async (req, res) => {
  const configuration = getOracleConfiguration();
  if (!configuration.configured) {
    return res.json({ ...configuration, connected: false, suppliers: [], error: 'Oracle API is not configured.' });
  }

  try {
    await pingOracle();
    const suppliers = await getOracleSuppliers();
    res.json({
      ...configuration,
      connected: true,
      suppliers: suppliers.map(({ id, code, name, prices_include_gst }) => ({ id, code, name, prices_include_gst })),
      error: null
    });
  } catch (error) {
    res.json({ ...configuration, connected: false, suppliers: [], error: error.message });
  }
});

app.post('/api/oracle/test', async (req, res) => {
  try {
    const ping = await pingOracle();
    const suppliers = await getOracleSuppliers();
    res.json({ connected: true, ping, supplierCount: suppliers.length });
  } catch (error) {
    res.status(502).json({ connected: false, error: error.message });
  }
});

app.get('/api/oracle/syncs', (req, res) => {
  res.json(getOracleSyncEvents(req.query.limit));
});

app.get('/api/oracle/runs', (req, res) => {
  res.json(getOracleQuoteRuns(req.query.limit));
});

app.get('/api/oracle/cases', (req, res) => {
  res.json(getOracleQuoteCases(req.query.limit));
});

app.get('/api/oracle/cases/:id/audit', (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isInteger(caseId) || caseId <= 0) {
    return res.status(400).json({ error: 'A valid quotation case ID is required.' });
  }
  const caseItem = getOracleQuoteCaseById(caseId);
  if (!caseItem) return res.status(404).json({ error: 'Quotation case not found.' });

  const runs = getOracleQuoteRunsForCase(caseId);
  const triggerRunIdsByMessage = new Map();
  for (const run of runs) {
    const runIds = triggerRunIdsByMessage.get(run.trigger_message_id) || [];
    runIds.push(run.id);
    triggerRunIdsByMessage.set(run.trigger_message_id, runIds);
  }
  const messages = getOracleQuoteCaseMessages(caseId).map(message => ({
    ...message,
    triggered_run_ids: triggerRunIdsByMessage.get(message.id) || []
  }));

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    case: caseItem,
    messages,
    runs,
    events: getOracleSyncEventsForCase(caseId)
  });
});

app.post('/api/oracle/syncs/:id/publish', async (req, res) => {
  try {
    const event = await publishOracleSyncEvent(Number(req.params.id));
    io.emit('oracle_sync_result', event);
    if (event?.case_id) io.emit('oracle_case_result', getOracleQuoteCaseById(event.case_id));
    res.json({ message: 'Quotation published to Oracle.', event });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Data export (CSV / JSON)
app.get('/api/export', (req, res) => {
  const format = req.query.format || 'json';
  const messages = getMessagesWithExtractions({ limit: 1000 });

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="whatsapp_extractions.csv"');
    
    let csv = 'Message ID,Chat,Chat Type,Sender,Message Type,Content,Schema,LLM Provider,Status,Extracted Data,Timestamp\n';
    for (const m of messages) {
      const extStr = m.extracted_data ? m.extracted_data.replace(/"/g, '""') : '';
      const contentStr = m.content ? m.content.replace(/"/g, '""') : '';
      csv += `"${m.id}","${m.group_name || m.group_id}","${m.chat_type || 'group'}","${m.sender_name || m.sender_id}","${m.message_type}","${contentStr}","${m.schema_id || ''}","${m.llm_provider || ''}","${m.extraction_status || ''}","${extStr}","${m.timestamp}"\n`;
    }
    return res.send(csv);
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="whatsapp_extractions.json"');
  res.json(messages);
});

const possibleDistPaths = [
  path.resolve('./dist'),
  path.resolve('./client/dist/client'),
  path.resolve('./client/dist'),
  path.resolve('./dist/client')
];
const clientDistPath = possibleDistPaths.find(p => fs.existsSync(path.join(p, 'index.html')));

if (clientDistPath) {
  console.log(`[SERVER] Serving static dashboard UI from: ${clientDistPath}`);
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
} else {
  console.warn(`[SERVER] Warning: Built UI not found. Please run "npm run build".`);
}

// Socket.IO event hub
io.on('connection', (socket) => {
  socket.emit('connection_status', getConnectionState());
  socket.emit('groups_updated', getGroups());
  socket.emit('dms_updated', getDmChats());
  socket.emit('schemas_updated', getSchemas());
  socket.emit('settings_updated', settingsForClient(getSettings()));
  socket.emit('stats_updated', getStats());
  socket.emit('oracle_syncs_updated', getOracleSyncEvents(100));
  socket.emit('oracle_cases_updated', getOracleQuoteCases(100));
});

// Start Express server and launch WhatsApp client automatically
server.listen(PORT, HOST, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 WhatsApp LLM Extractor Server running at: http://${HOST}:${PORT}`);
  console.log(`==================================================\n`);
  
  // Start Baileys engine
  initWhatsAppClient();
});

let shuttingDown = false;
async function gracefulShutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SERVER] ${signal} received. Preserving WhatsApp credentials and shutting down cleanly...`);

  const forcedExit = setTimeout(() => {
    console.error('[SERVER] Graceful shutdown timed out. Exiting so the process supervisor can restart the service.');
    process.exit(exitCode || 1);
  }, 25000);
  forcedExit.unref?.();

  try {
    await shutdownWhatsApp();
    await new Promise(resolve => io.close(() => server.close(resolve)));
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    clearTimeout(forcedExit);
    process.exit(exitCode);
  } catch (error) {
    console.error('[SERVER] Shutdown error:', error);
    process.exit(exitCode || 1);
  }
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('uncaughtException', error => {
  console.error('[SERVER] Uncaught exception:', error);
  void gracefulShutdown('uncaughtException', 1);
});
process.on('unhandledRejection', error => {
  console.error('[SERVER] Unhandled rejection:', error);
  void gracefulShutdown('unhandledRejection', 1);
});
