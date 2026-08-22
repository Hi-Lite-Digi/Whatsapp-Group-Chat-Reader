import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  downloadContentFromMessage,
  fetchLatestBaileysVersion,
  Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';

import {
  upsertGroup,
  getGroups,
  getSchemaById,
  saveMessage,
  saveExtraction,
  db
} from '../db/database.js';
import { processMediaMessage } from '../media/processor.js';
import { processMessageWithLLM } from '../llm/service.js';

const authFolder = process.env.AUTH_FOLDER || './auth_info';
if (!fs.existsSync(authFolder)) {
  fs.mkdirSync(authFolder, { recursive: true });
}

let sock = null;
let ioInstance = null;
let connectionStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
let currentQrDataUrl = null;
let currentPairingCode = null;
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const sentMessageCache = new Map();


export function setSocketIO(io) {
  ioInstance = io;
}

export function getConnectionState() {
  return {
    status: connectionStatus,
    qrDataUrl: currentQrDataUrl,
    pairingCode: currentPairingCode,
    user: sock && sock.user ? sock.user : null
  };
}

export async function requestPairingCode(phoneNumber) {
  if (!sock) {
    await initWhatsAppClient();
  }
  try {
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    const code = await sock.requestPairingCode(cleanNumber);
    currentPairingCode = code;
    emitLog(`Pairing Code generated for ${cleanNumber}: ${code}`);
    broadcastState();
    return code;
  } catch (err) {
    console.error('Error requesting pairing code:', err.message);
    emitLog(`❌ Error requesting pairing code: ${err.message}`);
    throw err;
  }
}

export async function clearAuthSession() {
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.ws?.close();
    } catch (e) {}
    sock = null;
  }
  if (fs.existsSync(authFolder)) {
    fs.rmSync(authFolder, { recursive: true, force: true });
    fs.mkdirSync(authFolder, { recursive: true });
  }
  connectionStatus = 'disconnected';
  currentQrDataUrl = null;
  currentPairingCode = null;
  emitLog('Cleared auth session files. Ready for fresh pairing.');
  broadcastState();
}

export async function initWhatsAppClient() {
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.ws?.close();
    } catch (e) {}
    sock = null;
  }

  try {
    const logger = pino({ level: 'silent' });
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    emitLog(`Initializing Baileys WhatsApp client (v${version.join('.')}, isLatest: ${isLatest})...`);
    connectionStatus = 'connecting';
    broadcastState();

    sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      printQRInTerminal: false,
      browser: Browsers.macOS('Desktop'),
      getMessage: async (key) => {
        if (key && key.id && sentMessageCache.has(key.id)) {
          return sentMessageCache.get(key.id);
        }
        if (key && key.id) {
          try {
            const row = db.prepare('SELECT raw_json, content FROM messages WHERE wa_message_id = ?').get(key.id);
            if (row) {
              if (row.raw_json) {
                const parsed = JSON.parse(row.raw_json);
                if (parsed && parsed.message) return parsed.message;
              }
              if (row.content) return { conversation: row.content };
            }
          } catch (e) {}
        }
        return undefined;
      },
      markOnlineOnConnect: true,
      syncFullHistory: true,
      emitOwnEvents: true,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        connectionStatus = 'qr_ready';
        currentQrDataUrl = await qrcode.toDataURL(qr);
        qrcodeTerminal.generate(qr, { small: true });
        emitLog('QR code generated. Please scan using WhatsApp mobile app (Linked Devices).');
        broadcastState();
      }

      if (connection === 'open') {
        connectionStatus = 'connected';
        currentQrDataUrl = null;
        currentPairingCode = null;
        isReconnecting = false;
        reconnectAttempts = 0; // Reset on successful connection
        emitLog(`WhatsApp connected successfully as ${sock.user.name || sock.user.id}!`);
        broadcastState();

        // Refresh joined group list
        await syncGroups();
      }

      if (connection === 'close') {
        connectionStatus = 'disconnected';
        currentQrDataUrl = null;
        broadcastState();

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const isConflict = statusCode === 440 || statusCode === DisconnectReason.connectionReplaced || statusCode === DisconnectReason.loggedOut;
        const isRateLimited = statusCode === 428;
        const shouldReconnect = !isLoggedOut && !isConflict;

        emitLog(`WhatsApp connection closed (Status Code: ${statusCode}). Reconnect: ${shouldReconnect}`);

        if (shouldReconnect && !isReconnecting) {
          if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            emitLog(`⛔ Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Please refresh the page or restart the server manually.`);
            reconnectAttempts = 0;
            return;
          }
          isReconnecting = true;
          reconnectAttempts++;
          // 428 = rate limited: wait 60s. Others: exponential backoff capped at 60s.
          const delayMs = isRateLimited ? 60000 : Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 60000);
          emitLog(`⏳ Reconnecting in ${Math.round(delayMs / 1000)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          setTimeout(() => {
            isReconnecting = false;
            initWhatsAppClient();
          }, delayMs);
        } else if (!shouldReconnect) {
          reconnectAttempts = 0;
        }
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      for (const msg of m.messages) {
        await handleIncomingMessage(msg);
      }
    });

    return sock;
  } catch (err) {
    console.error('Error initializing WhatsApp client:', err);
    connectionStatus = 'disconnected';
    broadcastState();
  }
}

export async function syncGroups() {
  if (!sock || connectionStatus !== 'connected') return [];
  try {
    const groupsMap = await sock.groupFetchAllParticipating();
    const groupList = [];
    for (const [jid, group] of Object.entries(groupsMap)) {
      const savedGroup = upsertGroup(jid, group.subject || 'Unnamed Group');
      groupList.push(savedGroup);
    }
    if (ioInstance) {
      ioInstance.emit('groups_updated', getGroups());
    }
    emitLog(`Synced ${groupList.length} WhatsApp group chats.`);
    return groupList;
  } catch (err) {
    console.error('Error syncing WhatsApp groups:', err.message);
    return [];
  }
}

async function handleIncomingMessage(msg) {
  try {
    if (!msg || !msg.message) return;
    const remoteJid = msg.key.remoteJid;

    // Ignore status updates or direct individual messages (only process group chats)
    if (!remoteJid || !remoteJid.endsWith('@g.us')) return;

    // Check if group is monitored in DB
    const groupRecord = db.prepare('SELECT * FROM groups WHERE id = ?').get(remoteJid);
    if (groupRecord && groupRecord.is_monitored === 0) {
      // Group monitoring disabled by user
      return;
    }

    const groupName = groupRecord ? groupRecord.name : remoteJid.split('@')[0];
    const senderId = msg.key.participant || msg.key.remoteJid;
    const senderName = msg.pushName || senderId.split('@')[0];
    const messageId = msg.key.id;
    const timestamp = new Date((msg.messageTimestamp || Date.now() / 1000) * 1000).toISOString();

    // Determine message type & text content
    const messageType = Object.keys(msg.message)[0];
    let content = '';
    let mediaObj = null;
    let extractedText = '';

    if (messageType === 'conversation') {
      content = msg.message.conversation;
    } else if (messageType === 'extendedTextMessage') {
      content = msg.message.extendedTextMessage.text;
    } else if (messageType === 'imageMessage') {
      content = msg.message.imageMessage.caption || '[Image Message]';
      mediaObj = await downloadAndProcessMedia(msg.message.imageMessage, 'image', 'imageMessage');
    } else if (messageType === 'documentMessage') {
      const doc = msg.message.documentMessage;
      content = doc.caption || `[Document: ${doc.fileName || 'file'}]`;
      mediaObj = await downloadAndProcessMedia(doc, 'document', 'documentMessage', doc.fileName);
      if (mediaObj && mediaObj.extractedText) {
        extractedText = mediaObj.extractedText;
      }
    } else if (messageType === 'audioMessage') {
      content = '[Audio Message]';
      mediaObj = await downloadAndProcessMedia(msg.message.audioMessage, 'audio', 'audioMessage');
    } else if (messageType === 'videoMessage') {
      content = msg.message.videoMessage.caption || '[Video Message]';
      mediaObj = await downloadAndProcessMedia(msg.message.videoMessage, 'video', 'videoMessage');
    } else {
      content = `[${messageType}]`;
    }

    emitLog(`📩 Received message from ${senderName} in group "${groupName}" (${messageType})`);

    // Save raw message to DB
    const dbMessageId = saveMessage({
      wa_message_id: messageId,
      group_id: remoteJid,
      group_name: groupName,
      sender_id: senderId,
      sender_name: senderName,
      message_type: messageType,
      content,
      extracted_text: extractedText,
      media_path: mediaObj ? mediaObj.filePath : null,
      media_mime: mediaObj ? mediaObj.mimetype : null,
      raw_json: msg,
      timestamp
    });

    const fullMsgPayload = {
      id: dbMessageId,
      wa_message_id: messageId,
      group_id: remoteJid,
      group_name: groupName,
      sender_id: senderId,
      sender_name: senderName,
      message_type: messageType,
      content,
      extracted_text: extractedText,
      media_path: mediaObj ? mediaObj.filePath : null,
      timestamp
    };

    if (ioInstance) {
      ioInstance.emit('new_message', fullMsgPayload);
    }

    // Trigger LLM Extraction Pipeline
    const schemaId = groupRecord ? groupRecord.active_schema_id : 'default';
    const schema = getSchemaById(schemaId) || getSchemaById('default');

    emitLog(`🧠 Running LLM extraction on message #${dbMessageId} using schema "${schema.name}"...`);

    const extractionResult = await processMessageWithLLM({
      content,
      extractedText,
      media: mediaObj,
      schema,
      senderInfo: { name: senderName, id: senderId, groupName }
    });

    const extractionDbId = saveExtraction({
      message_id: dbMessageId,
      group_id: remoteJid,
      schema_id: schema.id,
      llm_provider: extractionResult.provider,
      llm_model: extractionResult.model,
      extracted_data: extractionResult.extractedData,
      status: extractionResult.status,
      error_message: extractionResult.error || null
    });

    emitLog(`✅ LLM extraction complete for message #${dbMessageId} (Status: ${extractionResult.status})`);

    if (ioInstance) {
      ioInstance.emit('extraction_result', {
        extraction_id: extractionDbId,
        message_id: dbMessageId,
        group_id: remoteJid,
        schema_id: schema.id,
        llm_provider: extractionResult.provider,
        llm_model: extractionResult.model,
        extracted_data: extractionResult.extractedData,
        extraction_status: extractionResult.status,
        extraction_error: extractionResult.error || null,
        message: fullMsgPayload
      });
    }

  } catch (err) {
    console.error('Error handling incoming WhatsApp message:', err);
    emitLog(`❌ Error processing message: ${err.message}`);
  }
}

async function downloadAndProcessMedia(mediaMsg, typeKey, msgType, filename = '') {
  try {
    const stream = await downloadContentFromMessage(mediaMsg, typeKey);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    const mimetype = mediaMsg.mimetype || 'application/octet-stream';
    return await processMediaMessage({
      buffer,
      mimetype,
      filename,
      messageType: msgType
    });
  } catch (err) {
    console.error(`Failed to download ${typeKey} media:`, err.message);
    return null;
  }
}

export async function clearContactSessions(digits) {
  if (!digits || !sock || !sock.authState || !sock.authState.keys) return;
  const cleanDigits = digits.replace(/[^0-9]/g, '');
  if (!cleanDigits) return;

  try {
    if (fs.existsSync(authFolder)) {
      const files = fs.readdirSync(authFolder);
      const sessionFiles = files.filter(f => f.startsWith(`session-${cleanDigits}`));
      const updateObj = {};
      for (const file of sessionFiles) {
        const keyId = file.replace(/^session-/, '').replace(/\.json$/, '');
        updateObj[keyId] = null;
      }
      if (Object.keys(updateObj).length > 0) {
        await sock.authState.keys.set({ session: updateObj });
        emitLog(`🧹 Reset ${Object.keys(updateObj).length} stale E2EE session key(s) for ${cleanDigits}.`);
      }
    }
  } catch (err) {
    console.error('Error clearing contact session keys:', err.message);
  }
}

export async function sendWhatsAppMessage(to, message, options = {}) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp client is not connected. Please scan QR or connect first.');
  }

  if (!to || typeof to !== 'string') {
    throw new Error('Recipient phone number or group JID is required.');
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new Error('Message text cannot be empty.');
  }

  let jid = to.trim();
  if (!jid.endsWith('@g.us') && !jid.endsWith('@s.whatsapp.net')) {
    const digits = jid.replace(/[^0-9]/g, '');
    if (!digits) {
      throw new Error('Invalid phone number format. Include country code (e.g. 15551234567).');
    }
    
    // Clear stale session files if resetSession requested or if requested by options
    if (options.resetSession) {
      await clearContactSessions(digits);
    }

    // Resolve registered WhatsApp JID / LID via server lookup
    try {
      const results = await sock.onWhatsApp(digits);
      if (results && results.length > 0 && results[0].exists) {
        jid = results[0].lid || results[0].jid;
        emitLog(`Resolved ${digits} to WhatsApp target JID: ${jid}`);
      } else {
        jid = `${digits}@s.whatsapp.net`;
      }
    } catch (e) {
      jid = `${digits}@s.whatsapp.net`;
    }
  }

  // Send the message — Baileys handles E2EE sender key distribution automatically
  const msgContent = { text: message.trim() };
  const result = await sock.sendMessage(jid, msgContent);

  // Give the socket event loop time to process delivery ACKs before returning
  await new Promise(r => setTimeout(r, 800));

  // Store in memory cache & DB so Baileys getMessage retry requests succeed persistently
  if (result && result.key && result.key.id && result.message) {
    if (typeof sentMessageCache !== 'undefined') {
      sentMessageCache.set(result.key.id, result.message);
    }
    try {
      saveMessage({
        wa_message_id: result.key.id,
        group_id: jid,
        group_name: jid.endsWith('@g.us') ? 'Group Chat' : 'Direct Message',
        sender_id: sock.user?.id || 'bot',
        sender_name: sock.user?.name || 'Bot Admin',
        message_type: 'conversation',
        content: message.trim(),
        raw_json: result,
        timestamp: new Date().toISOString()
      });
    } catch (dbErr) {
      console.warn('Could not save outbound message to DB:', dbErr.message);
    }
  }

  emitLog(`📤 Sent message to ${jid}: "${message.trim().length > 30 ? message.trim().substring(0, 30) + '...' : message.trim()}"`);

  return {
    success: true,
    jid,
    messageId: result?.key?.id || null,
    timestamp: new Date().toISOString()
  };
}

export async function disconnectWhatsApp() {
  await clearAuthSession();
  emitLog('WhatsApp session logged out and cleared by user.');
}

function broadcastState() {
  if (ioInstance) {
    ioInstance.emit('connection_status', getConnectionState());
  }
}

function emitLog(message) {
  const logObj = { timestamp: new Date().toLocaleTimeString(), message };
  console.log(`[WA BOT] ${message}`);
  if (ioInstance) {
    ioInstance.emit('log', logObj);
  }
}

