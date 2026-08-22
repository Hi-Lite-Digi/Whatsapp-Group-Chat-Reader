import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

import {
  initDatabase,
  getGroups,
  setGroupMonitoring,
  getSchemas,
  saveSchema,
  deleteSchema,
  getMessagesWithExtractions,
  getStats,
  getSettings,
  updateSettings,
  db
} from '../db/database.js';

import {
  initWhatsAppClient,
  setSocketIO,
  getConnectionState,
  syncGroups,
  disconnectWhatsApp,
  clearAuthSession,
  requestPairingCode,
  sendWhatsAppMessage
} from '../whatsapp/client.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

const PORT = process.env.PORT || 3000;
const mediaFolder = path.resolve(process.env.MEDIA_FOLDER || './downloads/media');

// Initialize SQLite DB
initDatabase();

// Pass Socket.IO instance to WhatsApp client
setSocketIO(io);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve downloaded media files
if (!fs.existsSync(mediaFolder)) {
  fs.mkdirSync(mediaFolder, { recursive: true });
}
app.use('/media', express.static(mediaFolder));

// API Routes

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


// Groups
app.get('/api/groups', (req, res) => {
  res.json(getGroups());
});

app.put('/api/groups/:id', (req, res) => {
  const { id } = req.params;
  const { is_monitored, active_schema_id } = req.body;
  setGroupMonitoring(id, is_monitored, active_schema_id);
  io.emit('groups_updated', getGroups());
  res.json({ message: 'Group updated successfully', groups: getGroups() });
});

app.post('/api/groups/sync', async (req, res) => {
  const groups = await syncGroups();
  res.json({ message: 'Groups synced successfully', groups });
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
  res.json(getSettings());
});

app.put('/api/settings', (req, res) => {
  updateSettings(req.body);
  io.emit('settings_updated', getSettings());
  res.json({ message: 'Settings updated successfully', settings: getSettings() });
});

// Data export (CSV / JSON)
app.get('/api/export', (req, res) => {
  const format = req.query.format || 'json';
  const messages = getMessagesWithExtractions({ limit: 1000 });

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="whatsapp_extractions.csv"');
    
    let csv = 'Message ID,Group,Sender,Message Type,Content,Schema,LLM Provider,Status,Extracted Data,Timestamp\n';
    for (const m of messages) {
      const extStr = m.extracted_data ? m.extracted_data.replace(/"/g, '""') : '';
      const contentStr = m.content ? m.content.replace(/"/g, '""') : '';
      csv += `"${m.id}","${m.group_name || m.group_id}","${m.sender_name || m.sender_id}","${m.message_type}","${contentStr}","${m.schema_id || ''}","${m.llm_provider || ''}","${m.extraction_status || ''}","${extStr}","${m.timestamp}"\n`;
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
  socket.emit('schemas_updated', getSchemas());
  socket.emit('settings_updated', getSettings());
  socket.emit('stats_updated', getStats());
});

// Start Express server and launch WhatsApp client automatically
server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 WhatsApp LLM Extractor Server running at: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
  
  // Start Baileys engine
  initWhatsAppClient();
});
