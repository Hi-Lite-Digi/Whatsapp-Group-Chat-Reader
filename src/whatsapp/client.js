import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  downloadContentFromMessage,
  fetchLatestBaileysVersion,
  Browsers,
  jidNormalizedUser
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';

import {
  upsertGroup,
  getGroups,
  upsertDmChat,
  findDmChatByJid,
  getDmChats,
  getSchemaById,
  saveMessage,
  saveExtraction,
  setActiveWhatsappAccount,
  getSettings,
  db
} from '../db/database.js';
import { processMediaMessage } from '../media/processor.js';
import { processMessageWithLLM } from '../llm/service.js';
import {
  extractQuotationImageText,
  isConfiguredSupplierMessage,
  processOracleGroupMessage
} from '../oracle/sync.js';

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
let reconnectTimer = null;
let reconnectWatchdogTimer = null;
let reconnectSuppressed = false;
let initializationPromise = null;
let lastConnectedAt = null;
let lastMessageAt = null;
let lastDisconnectAt = null;
let lastDisconnectReason = null;
const processStartedAt = new Date().toISOString();
const RECONNECT_BASE_DELAY_MS = Math.max(1000, Number.parseInt(process.env.WHATSAPP_RECONNECT_BASE_DELAY_MS || '5000', 10));
const RECONNECT_MAX_DELAY_MS = Math.max(RECONNECT_BASE_DELAY_MS, Number.parseInt(process.env.WHATSAPP_RECONNECT_MAX_DELAY_MS || '300000', 10));
const RECONNECT_WATCHDOG_MS = Math.max(15000, Number.parseInt(process.env.WHATSAPP_RECONNECT_WATCHDOG_MS || '60000', 10));
const sentMessageCache = new Map();
const pendingHistoryByGroup = new Map();
const pendingHistoryByDm = new Map();
const contactInfoByJid = new Map();
const dmHistoryAnchors = new Map();
const requestedDmHistory = new Set();
const groupHistoryAnchors = new Map();
const requestedGroupHistory = new Map();
const groupHistoryPageCounts = new Map();
const exhaustedGroupHistory = new Set();
const oracleSyncTimers = new Map();
const MAX_HISTORY_PER_GROUP = Math.max(1, Number.parseInt(process.env.HISTORY_BUFFER_PER_GROUP || '500', 10));
const MAX_HISTORY_TOTAL = Math.max(MAX_HISTORY_PER_GROUP, Number.parseInt(process.env.HISTORY_BUFFER_TOTAL || '5000', 10));
const MAX_DM_HISTORY_PER_CHAT = Math.max(1, Number.parseInt(process.env.DM_HISTORY_BUFFER_PER_CHAT || '500', 10));
const MAX_DM_HISTORY_TOTAL = Math.max(MAX_DM_HISTORY_PER_CHAT, Number.parseInt(process.env.DM_HISTORY_BUFFER_TOTAL || '5000', 10));
const MAX_GROUP_HISTORY_PAGES = Math.max(1, Number.parseInt(process.env.GROUP_HISTORY_MAX_PAGES || '20', 10));
let pendingGroupHistoryTotal = 0;
let pendingDmHistoryTotal = 0;


export function setSocketIO(io) {
  ioInstance = io;
}

export function getConnectionState() {
  return {
    status: connectionStatus,
    qrDataUrl: currentQrDataUrl,
    pairingCode: currentPairingCode,
    user: sock && sock.user ? sock.user : null,
    pendingHistoryMessages: pendingGroupHistoryTotal + pendingDmHistoryTotal,
    pendingHistoryGroups: pendingHistoryByGroup.size,
    pendingHistoryDms: pendingHistoryByDm.size,
    processStartedAt,
    lastConnectedAt,
    lastMessageAt,
    lastDisconnectAt,
    lastDisconnectReason,
    reconnectAttempts,
    reconnectScheduled: Boolean(reconnectTimer),
    reconnectSuppressed
  };
}

function reconnectDelayMs(isRateLimited = false) {
  if (isRateLimited) return Math.min(60000, RECONNECT_MAX_DELAY_MS);
  const exponent = Math.min(Math.max(reconnectAttempts - 1, 0), 10);
  const capped = Math.min(RECONNECT_BASE_DELAY_MS * (2 ** exponent), RECONNECT_MAX_DELAY_MS);
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.round(capped * jitter);
}

function scheduleReconnect(reason, { isRateLimited = false } = {}) {
  if (reconnectSuppressed || reconnectTimer || isReconnecting) return false;

  reconnectAttempts++;
  const delayMs = reconnectDelayMs(isRateLimited);
  isReconnecting = true;
  emitLog(`Reconnecting in ${Math.round(delayMs / 1000)}s (attempt ${reconnectAttempts}; ${reason}).`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    isReconnecting = false;
    await initWhatsAppClient();
  }, delayMs);
  reconnectTimer.unref?.();
  broadcastState();
  return true;
}

function startReconnectWatchdog() {
  if (reconnectWatchdogTimer) return;
  reconnectWatchdogTimer = setInterval(() => {
    if (
      connectionStatus === 'disconnected'
      && !reconnectSuppressed
      && !reconnectTimer
      && !isReconnecting
      && !initializationPromise
    ) {
      scheduleReconnect('connection watchdog');
    }
  }, RECONNECT_WATCHDOG_MS);
  reconnectWatchdogTimer.unref?.();
}

function emitOracleResult(oracleResult) {
  if (oracleResult?.run && ioInstance) {
    ioInstance.emit('oracle_run_result', oracleResult.run);
  }
  if (oracleResult?.error) {
    emitLog(`Oracle quotation check could not complete: ${oracleResult.error}`);
  }
  for (const event of oracleResult?.events || []) {
    if (ioInstance) ioInstance.emit('oracle_sync_result', event);
    const action = event.sync_status === 'published' ? 'published to Oracle' : 'queued for review';
    emitLog(`${event.brand} ${event.model} ${event.size} at S$${Number(event.price).toFixed(2)} was ${action}.`);
  }
}

function scheduleOracleQuotationCheck(message, group) {
  if (!isConfiguredSupplierMessage(message, group)) return false;

  const existing = oracleSyncTimers.get(group.id);
  if (existing) clearTimeout(existing);

  const settings = getSettings();
  const quietSeconds = Math.max(5, Math.min(Number(settings.oracle_quiet_period_seconds) || 45, 300));
  const timer = setTimeout(async () => {
    oracleSyncTimers.delete(group.id);
    const currentGroup = db.prepare('SELECT * FROM groups WHERE id = ?').get(group.id);
    if (!currentGroup || currentGroup.is_monitored !== 1 || currentGroup.oracle_sync_enabled !== 1) return;

    emitLog(`Checking the settled supplier reply ending at message #${message.id} for complete tyre quotations...`);
    try {
      emitOracleResult(await processOracleGroupMessage({ message, group: currentGroup }));
    } catch (error) {
      emitLog(`Oracle quotation check could not complete: ${error.message}`);
    }
  }, quietSeconds * 1000);
  oracleSyncTimers.set(group.id, timer);
  emitLog(`Supplier reply captured. Waiting ${quietSeconds} seconds for any quotation fragments or corrections.`);
  return true;
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

export async function clearAuthSession(options = {}) {
  reconnectSuppressed = options.suppressReconnect === true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
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
  pendingHistoryByGroup.clear();
  pendingHistoryByDm.clear();
  contactInfoByJid.clear();
  dmHistoryAnchors.clear();
  requestedDmHistory.clear();
  groupHistoryAnchors.clear();
  requestedGroupHistory.clear();
  groupHistoryPageCounts.clear();
  exhaustedGroupHistory.clear();
  pendingGroupHistoryTotal = 0;
  pendingDmHistoryTotal = 0;
  emitLog('Cleared auth session files. Ready for fresh pairing.');
  broadcastState();
}

function isDirectJid(jid) {
  return typeof jid === 'string' && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));
}

function chatTypeForJid(jid) {
  if (typeof jid !== 'string') return null;
  if (jid.endsWith('@g.us')) return 'group';
  if (isDirectJid(jid)) return 'dm';
  return null;
}

function displayNameFromContact(contact, fallback = '') {
  return contact?.name || contact?.notify || contact?.verifiedName || fallback;
}

function dmJidsFrom(value) {
  const candidates = [
    value?.id,
    value?.jid,
    value?.lid,
    value?.phoneNumber,
    value?.key?.remoteJid,
    value?.key?.remoteJidAlt
  ];
  return [...new Set(candidates.filter(isDirectJid))];
}

function upsertDmFromJids(jids, suppliedName = '') {
  const aliases = [...new Set(jids.filter(isDirectJid))];
  if (aliases.length === 0) return null;

  const existing = aliases.map(findDmChatByJid).find(Boolean);
  const contact = aliases.map(jid => contactInfoByJid.get(jid)).find(Boolean);
  const phoneJid = aliases.find(jid => jid.endsWith('@s.whatsapp.net')) || contact?.phoneJid || existing?.phone_jid || null;
  const lidJid = aliases.find(jid => jid.endsWith('@lid')) || contact?.lidJid || existing?.lid_jid || null;
  const name = suppliedName || contact?.name || existing?.name || (phoneJid || lidJid || aliases[0]).split('@')[0];

  return upsertDmChat({
    id: existing?.id || phoneJid || aliases[0],
    name,
    phoneJid,
    lidJid
  });
}

function rememberContact(contact) {
  const aliases = dmJidsFrom(contact);
  if (aliases.length === 0) return null;

  const phoneJid = aliases.find(jid => jid.endsWith('@s.whatsapp.net')) || null;
  const lidJid = aliases.find(jid => jid.endsWith('@lid')) || null;
  const name = displayNameFromContact(contact);
  const info = { name, phoneJid, lidJid };
  for (const alias of aliases) contactInfoByJid.set(alias, info);

  // A contacts sync can contain the entire address book. Only persist contact
  // details when the corresponding DM conversation has already been discovered.
  const existing = aliases.map(findDmChatByJid).find(Boolean);
  if (!existing) return null;
  return upsertDmFromJids(aliases, name);
}

function emitDmUpdates() {
  if (ioInstance) ioInstance.emit('dms_updated', getDmChats());
}

function rememberDmHistoryAnchor(dmId, msg) {
  if (!dmId || !msg?.key?.id || !msg.messageTimestamp) return;
  const existing = dmHistoryAnchors.get(dmId);
  if (!existing || Number(msg.messageTimestamp) < Number(existing.messageTimestamp)) {
    dmHistoryAnchors.set(dmId, { key: msg.key, messageTimestamp: msg.messageTimestamp });
  }
}

function rememberGroupHistoryAnchor(groupId, msg) {
  if (!groupId || !msg?.key?.id || !msg.messageTimestamp) return;
  const existing = groupHistoryAnchors.get(groupId);
  if (!existing || Number(msg.messageTimestamp) < Number(existing.messageTimestamp)) {
    groupHistoryAnchors.set(groupId, { key: msg.key, messageTimestamp: msg.messageTimestamp });
  }
}

function isOwnDirectJid(jid) {
  if (!isDirectJid(jid) || !sock?.user) return false;
  const ownJids = [sock.user.id, sock.user.lid].filter(isDirectJid);
  try {
    const normalized = jidNormalizedUser(jid);
    return ownJids.some(ownJid => ownJid === jid || jidNormalizedUser(ownJid) === normalized);
  } catch {
    return ownJids.includes(jid);
  }
}

export function initWhatsAppClient() {
  if (initializationPromise) return initializationPromise;
  reconnectSuppressed = false;
  startReconnectWatchdog();
  initializationPromise = initializeWhatsAppClient()
    .finally(() => {
      initializationPromise = null;
    });
  return initializationPromise;
}

async function initializeWhatsAppClient() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
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
      // A web-browser fingerprint currently pairs more reliably than the
      // macOS/Windows desktop sub-platform while still requesting history.
      browser: Browsers.ubuntu('Chrome'),
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
      markOnlineOnConnect: false,
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
        reconnectAttempts = 0;
        reconnectSuppressed = false;
        lastConnectedAt = new Date().toISOString();
        lastDisconnectReason = null;
        emitLog(`WhatsApp connected successfully as ${sock.user.name || sock.user.id}!`);
        const accountId = jidNormalizedUser(sock.user.id);
        if (setActiveWhatsappAccount(accountId)) {
          emitLog('Linked account changed. All chat monitoring and quotation sync controls were paused for safety.');
        }
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
        const disconnectMessage = lastDisconnect?.error?.message || 'Unknown disconnect';
        const isRateLimited = statusCode === 429;
        const shouldReconnect = !isLoggedOut && !isConflict;

        lastDisconnectAt = new Date().toISOString();
        lastDisconnectReason = `${disconnectMessage}${statusCode ? ` (status ${statusCode})` : ''}`;
        reconnectSuppressed = !shouldReconnect;

        emitLog(`WhatsApp connection closed (${disconnectMessage}; status ${statusCode}). Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          scheduleReconnect(disconnectMessage, { isRateLimited });
        } else {
          reconnectAttempts = 0;
          emitLog('Automatic reconnect paused because WhatsApp logged out or another listener replaced this session. Re-pair from the dashboard after confirming only one listener is running.');
        }
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      for (const msg of m.messages) {
        await handleIncomingMessage(msg, { source: 'realtime', downloadMedia: true, runExtraction: true });
      }
    });

    // Full history is delivered separately from live messages. Keep a bounded,
    // in-memory buffer for paused chats so the user can opt in before message
    // bodies are written to disk. Enabling a chat imports its buffered history.
    sock.ev.on('messaging-history.set', async ({ messages = [], contacts = [], chats = [], progress, isLatest }) => {
      let importedGroups = 0;
      let importedDms = 0;
      let bufferedGroups = 0;
      let bufferedDms = 0;
      let discoveredDms = 0;
      const historyGroups = new Set();

      for (const contact of contacts) rememberContact(contact);

      for (const chat of chats) {
        const aliases = dmJidsFrom(chat);
        if (aliases.length === 0 || aliases.some(isOwnDirectJid)) continue;
        if (upsertDmFromJids(aliases, displayNameFromContact(chat))) discoveredDms++;
      }

      for (const msg of messages) {
        const remoteJid = msg?.key?.remoteJid;
        const chatType = chatTypeForJid(remoteJid);
        if (!chatType || !msg.message) continue;

        let chatRecord;
        if (chatType === 'group') {
          historyGroups.add(remoteJid);
          rememberGroupHistoryAnchor(remoteJid, msg);
          chatRecord = db.prepare('SELECT id, is_monitored FROM groups WHERE id = ?').get(remoteJid);
        } else {
          const aliases = dmJidsFrom(msg);
          if (aliases.some(isOwnDirectJid)) continue;
          chatRecord = upsertDmFromJids(aliases, msg.key?.fromMe ? '' : msg.pushName);
          if (chatRecord) discoveredDms++;
        }

        if (chatRecord?.is_monitored === 1) {
          const result = await handleIncomingMessage(msg, {
            source: 'history',
            downloadMedia: false,
            runExtraction: false
          });
          if (result?.saved) {
            if (chatType === 'group') importedGroups++;
            else importedDms++;
          }
        } else if (chatRecord && bufferHistoryMessage(msg, chatType, chatRecord.id)) {
          if (chatType === 'group') bufferedGroups++;
          else bufferedDms++;
        }
      }

      if (discoveredDms > 0) emitDmUpdates();
      emitLog(`History sync chunk received${progress != null ? ` (${progress}% complete)` : ''}: ${importedGroups} group + ${importedDms} DM messages imported; ${bufferedGroups} group + ${bufferedDms} DM messages held in memory pending selection${isLatest ? ' (latest sync)' : ''}.`);
      broadcastState();

      for (const [groupId, requestedAnchorId] of [...requestedGroupHistory.entries()]) {
        const currentAnchorId = groupHistoryAnchors.get(groupId)?.key?.id;
        requestedGroupHistory.delete(groupId);
        if (historyGroups.has(groupId) && currentAnchorId && currentAnchorId !== requestedAnchorId) {
          setTimeout(() => void requestHistoryForGroup(groupId), 750);
        } else {
          exhaustedGroupHistory.add(groupId);
        }
      }
    });

    const handleContactUpdates = (contacts = []) => {
      let changed = false;
      for (const contact of contacts) {
        if (rememberContact(contact)) changed = true;
      }
      if (changed) emitDmUpdates();
    };

    const handleChatUpdates = (chats = []) => {
      let changed = false;
      for (const chat of chats) {
        const aliases = dmJidsFrom(chat);
        if (aliases.length === 0 || aliases.some(isOwnDirectJid)) continue;
        if (upsertDmFromJids(aliases, displayNameFromContact(chat))) changed = true;
      }
      if (changed) emitDmUpdates();
    };

    sock.ev.on('contacts.upsert', handleContactUpdates);
    sock.ev.on('contacts.update', handleContactUpdates);
    sock.ev.on('chats.upsert', handleChatUpdates);
    sock.ev.on('chats.update', handleChatUpdates);
    sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      if (upsertDmFromJids([jid, lid])) emitDmUpdates();
    });

    return sock;
  } catch (err) {
    console.error('Error initializing WhatsApp client:', err);
    connectionStatus = 'disconnected';
    lastDisconnectAt = new Date().toISOString();
    lastDisconnectReason = err?.message || 'WhatsApp initialization failed';
    broadcastState();
    scheduleReconnect(lastDisconnectReason);
    return null;
  }
}

export async function syncGroups() {
  if (!sock || connectionStatus !== 'connected') return [];
  try {
    const groupsMap = await sock.groupFetchAllParticipating();
    const accountId = jidNormalizedUser(sock.user.id);
    const groupList = [];
    for (const [jid, group] of Object.entries(groupsMap)) {
      const savedGroup = upsertGroup(jid, group.subject || 'Unnamed Group', accountId);
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

export async function addDmByPhoneNumber(phoneNumber, name = '') {
  const digits = String(phoneNumber || '').replace(/[^0-9]/g, '');
  if (!digits) throw new Error('A phone number with country code is required.');

  let phoneJid = `${digits}@s.whatsapp.net`;
  let lidJid = null;
  if (sock && connectionStatus === 'connected') {
    const results = await sock.onWhatsApp(digits);
    if (!results?.[0]?.exists) throw new Error('That number was not found on WhatsApp.');
    phoneJid = results[0].jid || phoneJid;
    lidJid = results[0].lid || null;
  }

  const dm = upsertDmFromJids([phoneJid, lidJid], String(name || '').trim());
  emitDmUpdates();
  return dm;
}

export async function requestHistoryForDm(dmId) {
  if (!sock || connectionStatus !== 'connected' || requestedDmHistory.has(dmId)) return false;
  const dm = findDmChatByJid(dmId);
  if (!dm || dm.is_monitored !== 1) return false;

  const anchors = [...dmHistoryAnchors.entries()]
    .filter(([key]) => key === dm.id || findDmChatByJid(key)?.id === dm.id)
    .map(([, anchor]) => anchor)
    .sort((a, b) => Number(a.messageTimestamp) - Number(b.messageTimestamp));
  const anchor = anchors[0];
  if (!anchor) return false;

  requestedDmHistory.add(dm.id);
  try {
    await sock.fetchMessageHistory(50, anchor.key, anchor.messageTimestamp);
    emitLog(`Requested up to 50 older messages for selected DM ${dm.name}.`);
    return true;
  } catch (error) {
    requestedDmHistory.delete(dm.id);
    emitLog(`Could not request older DM history for ${dm.name}: ${error.message}`);
    return false;
  }
}

export async function requestHistoryForGroup(groupId, options = {}) {
  const force = options.force === true;
  if (!sock || connectionStatus !== 'connected' || requestedGroupHistory.has(groupId)) return false;
  if (force) {
    exhaustedGroupHistory.delete(groupId);
    groupHistoryPageCounts.set(groupId, 0);
  }
  if (exhaustedGroupHistory.has(groupId)) return false;
  const group = db.prepare('SELECT id, name, is_monitored FROM groups WHERE id = ?').get(groupId);
  if (!group || group.is_monitored !== 1) return false;

  const anchor = groupHistoryAnchors.get(groupId);
  if (!anchor) return false;
  const pageCount = groupHistoryPageCounts.get(groupId) || 0;
  if (pageCount >= MAX_GROUP_HISTORY_PAGES) return false;

  requestedGroupHistory.set(groupId, anchor.key.id);
  groupHistoryPageCounts.set(groupId, pageCount + 1);
  try {
    await sock.fetchMessageHistory(50, anchor.key, anchor.messageTimestamp);
    emitLog(`Requested up to 50 older messages for selected group ${group.name}.`);
    return true;
  } catch (error) {
    requestedGroupHistory.delete(groupId);
    groupHistoryPageCounts.set(groupId, pageCount);
    emitLog(`Could not request older group history for ${group.name}: ${error.message}`);
    return false;
  }
}

async function handleIncomingMessage(msg, options = {}) {
  try {
    const {
      source = 'realtime',
      downloadMedia = source === 'realtime',
      runExtraction = source === 'realtime'
    } = options;
    if (!msg || !msg.message) return;
    const remoteJid = msg.key.remoteJid;
    const chatType = chatTypeForJid(remoteJid);
    if (!chatType) return;

    let chatRecord;
    if (chatType === 'group') {
      rememberGroupHistoryAnchor(remoteJid, msg);
      chatRecord = db.prepare('SELECT * FROM groups WHERE id = ?').get(remoteJid);
    } else {
      const aliases = dmJidsFrom(msg);
      if (aliases.some(isOwnDirectJid)) return;
      chatRecord = upsertDmFromJids(aliases, msg.key?.fromMe ? '' : msg.pushName);
      rememberDmHistoryAnchor(chatRecord?.id, msg);
      emitDmUpdates();
    }
    if (!chatRecord || chatRecord.is_monitored !== 1) {
      return { saved: false, reason: 'not_monitored' };
    }

    const chatId = chatType === 'group' ? remoteJid : chatRecord.id;
    const chatName = chatRecord.name || remoteJid.split('@')[0];
    const senderId = msg.key.fromMe
      ? (sock?.user?.id || 'self')
      : (msg.key.participant || msg.key.participantAlt || remoteJid);
    const senderName = msg.key.fromMe
      ? (sock?.user?.name || 'You')
      : (msg.pushName || chatRecord.name || senderId.split('@')[0]);
    const messageId = msg.key.id;
    if (!messageId) return { saved: false, reason: 'missing_id' };
    if (db.prepare('SELECT 1 FROM messages WHERE wa_message_id = ?').get(messageId)) {
      return { saved: false, reason: 'duplicate' };
    }
    const timestamp = new Date((msg.messageTimestamp || Date.now() / 1000) * 1000).toISOString();
    if (source === 'realtime') lastMessageAt = timestamp;

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
      if (downloadMedia) mediaObj = await downloadAndProcessMedia(msg.message.imageMessage, 'image', 'imageMessage');
    } else if (messageType === 'documentMessage') {
      const doc = msg.message.documentMessage;
      content = doc.caption || `[Document: ${doc.fileName || 'file'}]`;
      if (downloadMedia) mediaObj = await downloadAndProcessMedia(doc, 'document', 'documentMessage', doc.fileName);
      if (mediaObj && mediaObj.extractedText) {
        extractedText = mediaObj.extractedText;
      }
    } else if (messageType === 'audioMessage') {
      content = '[Audio Message]';
      if (downloadMedia) mediaObj = await downloadAndProcessMedia(msg.message.audioMessage, 'audio', 'audioMessage');
    } else if (messageType === 'videoMessage') {
      content = msg.message.videoMessage.caption || '[Video Message]';
      if (downloadMedia) mediaObj = await downloadAndProcessMedia(msg.message.videoMessage, 'video', 'videoMessage');
    } else {
      content = `[${messageType}]`;
    }

    if (
      chatType === 'group'
      && chatRecord.oracle_sync_enabled === 1
      && messageType === 'imageMessage'
      && mediaObj
      && isConfiguredSupplierMessage({ sender_id: senderId }, chatRecord)
    ) {
      extractedText = await extractQuotationImageText({
        media: mediaObj,
        senderInfo: { name: senderName, id: senderId, groupName: chatName }
      });
      emitLog(extractedText
        ? `Supplier quotation image transcribed for ${chatName}.`
        : `Supplier image saved, but no readable quotation text was found for ${chatName}.`);
    }

    emitLog(`${source === 'history' ? '🕘 Imported' : '📩 Received'} message from ${senderName} in ${chatType === 'group' ? 'group' : 'DM'} "${chatName}" (${messageType})`);

    // Save raw message to DB
    const dbMessageId = saveMessage({
      wa_message_id: messageId,
      group_id: chatId,
      group_name: chatName,
      sender_id: senderId,
      sender_name: senderName,
      message_type: messageType,
      content,
      extracted_text: extractedText,
      media_path: mediaObj ? mediaObj.filePath : null,
      media_mime: mediaObj ? mediaObj.mimetype : null,
      raw_json: msg,
      source,
      chat_type: chatType,
      account_id: sock?.user?.id ? jidNormalizedUser(sock.user.id) : null,
      timestamp
    });

    const fullMsgPayload = {
      id: dbMessageId,
      wa_message_id: messageId,
      group_id: chatId,
      group_name: chatName,
      sender_id: senderId,
      sender_name: senderName,
      message_type: messageType,
      content,
      extracted_text: extractedText,
      media_path: mediaObj ? mediaObj.filePath : null,
      source,
      chat_type: chatType,
      account_id: sock?.user?.id ? jidNormalizedUser(sock.user.id) : null,
      timestamp
    };

    if (ioInstance) {
      ioInstance.emit('new_message', fullMsgPayload);
    }

    if (chatType === 'dm' && source === 'realtime') {
      void requestHistoryForDm(chatId);
    }
    if (chatType === 'group' && source === 'realtime') {
      void requestHistoryForGroup(chatId);
    }

    // Mapped supplier groups use the bounded quotation-session pipeline. Do
    // not run the generic per-message extractor because it loses fragments
    // and creates duplicate, unrelated extraction records.
    if (chatType === 'group' && chatRecord.oracle_sync_enabled === 1) {
      if (source === 'realtime') scheduleOracleQuotationCheck(fullMsgPayload, chatRecord);
      return { saved: true, id: dbMessageId };
    }

    // DM monitoring is read-only storage. Existing LLM schemas continue to run
    // only for monitored groups.
    if (!runExtraction || chatType === 'dm') return { saved: true, id: dbMessageId };

    // Trigger LLM Extraction Pipeline
    const schemaId = chatRecord.active_schema_id || 'default';
    const schema = getSchemaById(schemaId) || getSchemaById('default');

    emitLog(`🧠 Running LLM extraction on message #${dbMessageId} using schema "${schema.name}"...`);

    const extractionResult = await processMessageWithLLM({
      content,
      extractedText,
      media: mediaObj,
      schema,
      senderInfo: { name: senderName, id: senderId, groupName: chatName }
    });

    const extractionDbId = saveExtraction({
      message_id: dbMessageId,
      group_id: chatId,
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
        group_id: chatId,
        schema_id: schema.id,
        llm_provider: extractionResult.provider,
        llm_model: extractionResult.model,
        extracted_data: extractionResult.extractedData,
        extraction_status: extractionResult.status,
        extraction_error: extractionResult.error || null,
        message: fullMsgPayload
      });
    }

    return { saved: true, id: dbMessageId };

  } catch (err) {
    console.error('Error handling incoming WhatsApp message:', err);
    emitLog(`❌ Error processing message: ${err.message}`);
    return { saved: false, reason: 'error', error: err.message };
  }
}

function bufferHistoryMessage(msg, chatType, chatId) {
  if (!chatId) return false;

  const isDm = chatType === 'dm';
  const targetMap = isDm ? pendingHistoryByDm : pendingHistoryByGroup;
  const perChatLimit = isDm ? MAX_DM_HISTORY_PER_CHAT : MAX_HISTORY_PER_GROUP;
  const totalLimit = isDm ? MAX_DM_HISTORY_TOTAL : MAX_HISTORY_TOTAL;
  const total = isDm ? pendingDmHistoryTotal : pendingGroupHistoryTotal;
  if (total >= totalLimit) return false;

  const chatMessages = targetMap.get(chatId) || [];
  if (chatMessages.length >= perChatLimit) return false;
  if (msg.key?.id && chatMessages.some(existing => existing.key?.id === msg.key.id)) return false;

  chatMessages.push(msg);
  targetMap.set(chatId, chatMessages);
  if (isDm) pendingDmHistoryTotal++;
  else pendingGroupHistoryTotal++;
  return true;
}

async function importBufferedHistory(chatId, chatType) {
  const isDm = chatType === 'dm';
  const targetMap = isDm ? pendingHistoryByDm : pendingHistoryByGroup;
  const bufferKeys = isDm
    ? [...targetMap.keys()].filter(key => key === chatId || findDmChatByJid(key)?.id === chatId)
    : [chatId];
  const messages = bufferKeys.flatMap(key => targetMap.get(key) || []);
  if (messages.length === 0) return 0;

  // Baileys history batches are reverse chronological. Import oldest first so
  // database IDs and live events follow natural time order.
  const orderedMessages = [...messages].sort((a, b) =>
    Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0)
  );
  let imported = 0;
  for (const msg of orderedMessages) {
    const result = await handleIncomingMessage(msg, {
      source: 'history',
      downloadMedia: false,
      runExtraction: false
    });
    if (result?.saved) imported++;
  }

  for (const key of bufferKeys) targetMap.delete(key);
  if (isDm) pendingDmHistoryTotal = Math.max(0, pendingDmHistoryTotal - messages.length);
  else pendingGroupHistoryTotal = Math.max(0, pendingGroupHistoryTotal - messages.length);
  emitLog(`Imported ${imported} historical messages for selected ${isDm ? 'DM' : 'group'} ${chatId}.`);
  broadcastState();
  return imported;
}

export async function importBufferedHistoryForGroup(groupId) {
  return importBufferedHistory(groupId, 'group');
}

export async function importBufferedHistoryForDm(dmId) {
  return importBufferedHistory(dmId, 'dm');
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
  if (!jid.endsWith('@g.us') && !isDirectJid(jid)) {
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

  // Always keep a short-lived retry copy in memory. Persist it only when the
  // destination chat was explicitly selected for monitoring.
  if (result && result.key && result.key.id && result.message) {
    sentMessageCache.set(result.key.id, result.message);
    try {
      const chatType = chatTypeForJid(jid);
      const chatRecord = chatType === 'group'
        ? db.prepare('SELECT * FROM groups WHERE id = ?').get(jid)
        : findDmChatByJid(jid);
      if (chatRecord?.is_monitored === 1) {
        saveMessage({
          wa_message_id: result.key.id,
          group_id: chatRecord.id,
          group_name: chatRecord.name,
          sender_id: sock.user?.id || 'bot',
          sender_name: sock.user?.name || 'You',
          message_type: 'conversation',
          content: message.trim(),
          raw_json: result,
          source: 'realtime',
          chat_type: chatType,
          account_id: sock?.user?.id ? jidNormalizedUser(sock.user.id) : null,
          timestamp: new Date().toISOString()
        });
      }
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
  reconnectSuppressed = true;
  const activeSocket = sock;
  if (activeSocket) {
    try {
      await activeSocket.logout();
    } catch (err) {
      emitLog(`Remote unlink did not confirm (${err.message}); clearing local credentials.`);
    }
  }
  await clearAuthSession({ suppressReconnect: true });
  emitLog('WhatsApp linked device logged out and local credentials cleared.');
}

// Used by process/container shutdown. It closes only the local socket and
// deliberately keeps auth files so the linked device survives restarts.
export async function shutdownWhatsApp() {
  reconnectSuppressed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (reconnectWatchdogTimer) {
    clearInterval(reconnectWatchdogTimer);
    reconnectWatchdogTimer = null;
  }
  for (const timer of oracleSyncTimers.values()) clearTimeout(timer);
  oracleSyncTimers.clear();

  const activeSocket = sock;
  sock = null;
  if (activeSocket) {
    try {
      activeSocket.ev.removeAllListeners();
      activeSocket.ws?.close();
    } catch (error) {
      emitLog(`WhatsApp socket shutdown warning: ${error.message}`);
    }
  }
  connectionStatus = 'disconnected';
  broadcastState();
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
