import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  downloadContentFromMessage,
  fetchLatestBaileysVersion,
  Browsers,
  jidNormalizedUser,
  normalizeMessageContent,
  WAMessageStubType
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
  getOracleQuoteCaseById,
  db
} from '../db/database.js';
import { processMediaMessage } from '../media/processor.js';
import { processMessageWithLLM } from '../llm/service.js';
import {
  extractQuotationImageText,
  isConfiguredSupplierMessage,
  publishOracleSyncEvent,
  processOracleGroupMessage
} from '../oracle/sync.js';
import {
  flushDashboardQuotationSyncs,
  queueDashboardQuotationCase
} from '../oracle/dashboard-sync.js';
import { getDisconnectPolicy } from './disconnect-policy.js';
import { groupJidFrom, groupNameFrom } from './group-discovery.js';
import { isNonConversationalMessageType } from './message-types.js';
import {
  canonicalPhoneJid,
  resolvedSenderIdFromMessage,
  senderIdFromMessage
} from './sender-identity.js';
import {
  classifyHistoryMessage,
  classifyUpsertMessage,
  isActiveDeliverySource,
  messageChatJid,
  messageTimestampMs,
  safeChatReference
} from './upsert-delivery.js';

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
let groupSyncTimer = null;
let reconnectSuppressed = false;
let initializationPromise = null;
let lastConnectedAt = null;
let lastMessageAt = null;
let lastDisconnectAt = null;
let lastDisconnectReason = null;
const ingestionState = {
  upsertBatches: 0,
  messagesSeen: 0,
  savedMessages: 0,
  savedBySource: {},
  ignoredByReason: {},
  lastEventAt: null,
  lastSavedAt: null,
  lastIgnoredAt: null,
  lastIgnoredReason: null,
  lastIgnoredChat: null,
  lastIgnoredMessageId: null,
  lastIgnoredStubType: null,
  recoveryScheduled: 0,
  recoveryRequests: 0,
  recoveryHistoryRequests: 0,
  recoveryResolved: 0,
  recoveryExhausted: 0,
  pendingRecoveries: 0,
  senderMappingsResolved: 0,
  senderMappingsUnresolved: 0,
  reconciledSenderRows: 0,
  recoveredHistoryQuotationChecks: 0
};
const processStartedAt = new Date().toISOString();
const RECONNECT_BASE_DELAY_MS = Math.max(1000, Number.parseInt(process.env.WHATSAPP_RECONNECT_BASE_DELAY_MS || '5000', 10));
const RECONNECT_MAX_DELAY_MS = Math.max(RECONNECT_BASE_DELAY_MS, Number.parseInt(process.env.WHATSAPP_RECONNECT_MAX_DELAY_MS || '300000', 10));
const RECONNECT_WATCHDOG_MS = Math.max(15000, Number.parseInt(process.env.WHATSAPP_RECONNECT_WATCHDOG_MS || '60000', 10));
const INITIAL_GROUP_SYNC_DELAY_MS = Math.max(1000, Number.parseInt(process.env.WHATSAPP_INITIAL_GROUP_SYNC_DELAY_MS || '5000', 10));
const CATCHUP_WINDOW_MS = Math.max(60_000, Number.parseInt(process.env.WHATSAPP_CATCHUP_WINDOW_MS || '86400000', 10));
const sentMessageCache = new Map();
const pendingHistoryByGroup = new Map();
const pendingHistoryByDm = new Map();
const contactInfoByJid = new Map();
const discoveredGroupChats = new Map();
const groupMetadataRequests = new Map();
const bulkGroupFetchAttemptedAccounts = new Set();
const dmHistoryAnchors = new Map();
const requestedDmHistory = new Set();
const groupHistoryAnchors = new Map();
const requestedGroupHistory = new Map();
const groupHistoryPageCounts = new Map();
const exhaustedGroupHistory = new Set();
const oracleSyncTimers = new Map();
const oracleSyncPendingMessages = new Map();
const missingMessageRecoveries = new Map();
const MISSING_MESSAGE_RECOVERY_DELAYS_MS = [12_000, 45_000, 120_000];
const MAX_HISTORY_PER_GROUP = Math.max(1, Number.parseInt(process.env.HISTORY_BUFFER_PER_GROUP || '500', 10));
const MAX_HISTORY_TOTAL = Math.max(MAX_HISTORY_PER_GROUP, Number.parseInt(process.env.HISTORY_BUFFER_TOTAL || '5000', 10));
const MAX_DM_HISTORY_PER_CHAT = Math.max(1, Number.parseInt(process.env.DM_HISTORY_BUFFER_PER_CHAT || '500', 10));
const MAX_DM_HISTORY_TOTAL = Math.max(MAX_DM_HISTORY_PER_CHAT, Number.parseInt(process.env.DM_HISTORY_BUFFER_TOTAL || '5000', 10));
const MAX_GROUP_HISTORY_PAGES = Math.max(1, Number.parseInt(process.env.GROUP_HISTORY_MAX_PAGES || '20', 10));
let pendingGroupHistoryTotal = 0;
let pendingDmHistoryTotal = 0;
let senderReconciliationPromise = null;
let recoveredHistoryProcessingPromise = null;


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
    reconnectSuppressed,
    ingestion: {
      ...ingestionState,
      savedBySource: { ...ingestionState.savedBySource },
      ignoredByReason: { ...ingestionState.ignoredByReason }
    }
  };
}

function recordIngestionResult(msg, delivery, result) {
  const now = new Date().toISOString();
  const messageId = msg?.key?.id || null;
  const chatJid = messageChatJid(msg);
  ingestionState.messagesSeen++;
  ingestionState.lastEventAt = now;

  if (result?.saved) {
    ingestionState.savedMessages++;
    ingestionState.savedBySource[delivery.source] = (ingestionState.savedBySource[delivery.source] || 0) + 1;
    ingestionState.lastSavedAt = now;
    emitLog(`WhatsApp ingestion saved ${delivery.source} message ${messageId || '<no id>'} for ${safeChatReference(chatJid)}.`);
    return;
  }

  const reason = result?.reason || 'unknown';
  ingestionState.ignoredByReason[reason] = (ingestionState.ignoredByReason[reason] || 0) + 1;
  ingestionState.lastIgnoredAt = now;
  ingestionState.lastIgnoredReason = reason;
  ingestionState.lastIgnoredChat = safeChatReference(chatJid);
  ingestionState.lastIgnoredMessageId = messageId;
  ingestionState.lastIgnoredStubType = msg?.messageStubType ?? null;
  emitLog(`WhatsApp ingestion ignored ${delivery.source} message ${messageId || '<no id>'} for ${safeChatReference(chatJid)} (${reason}).`);
}

function completeMissingMessageRecovery(messageId) {
  if (!messageId) return false;
  const recovery = missingMessageRecoveries.get(messageId);
  if (!recovery) return false;
  if (recovery.timer) clearTimeout(recovery.timer);
  missingMessageRecoveries.delete(messageId);
  ingestionState.pendingRecoveries = missingMessageRecoveries.size;
  ingestionState.recoveryResolved++;
  emitLog(`Recovered decryptable content for WhatsApp message ${messageId}.`);
  return true;
}

function clearMissingMessageRecoveries() {
  for (const recovery of missingMessageRecoveries.values()) {
    if (recovery.timer) clearTimeout(recovery.timer);
  }
  missingMessageRecoveries.clear();
  ingestionState.pendingRecoveries = 0;
}

function scheduleMissingMessageRecovery(msg, chatRecord) {
  const messageId = msg?.key?.id;
  if (!messageId || !sock || missingMessageRecoveries.has(messageId)) return false;

  const recovery = { attempt: 0, timer: null };
  missingMessageRecoveries.set(messageId, recovery);
  ingestionState.recoveryScheduled++;
  ingestionState.pendingRecoveries = missingMessageRecoveries.size;

  const runAttempt = async () => {
    if (!missingMessageRecoveries.has(messageId)) return;
    if (db.prepare('SELECT 1 FROM messages WHERE wa_message_id = ?').get(messageId)) {
      completeMissingMessageRecovery(messageId);
      return;
    }
    if (!sock || connectionStatus !== 'connected') {
      recovery.timer = setTimeout(runAttempt, MISSING_MESSAGE_RECOVERY_DELAYS_MS[0]);
      recovery.timer.unref?.();
      return;
    }

    recovery.attempt++;
    try {
      ingestionState.recoveryRequests++;
      const requestId = await sock.requestPlaceholderResend(msg.key, msg);
      emitLog(`Requested WhatsApp content recovery for ${safeChatReference(messageChatJid(msg))} message ${messageId} (attempt ${recovery.attempt}${requestId ? `; request ${requestId}` : ''}).`);
    } catch (error) {
      emitLog(`WhatsApp content recovery request failed for message ${messageId}: ${error.message}`);
    }

    // A history request recovers nearby messages that may have been missed
    // before this placeholder, not just the one event that exposed the gap.
    if (recovery.attempt === 2 && msg.messageTimestamp) {
      try {
        ingestionState.recoveryHistoryRequests++;
        const requestId = await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp);
        emitLog(`Requested recent group history to recover the message gap in ${chatRecord.name || messageChatJid(msg)}${requestId ? ` (request ${requestId})` : ''}.`);
      } catch (error) {
        emitLog(`Recent group-history recovery failed for ${chatRecord.name || messageChatJid(msg)}: ${error.message}`);
      }
    }

    if (recovery.attempt >= MISSING_MESSAGE_RECOVERY_DELAYS_MS.length) {
      missingMessageRecoveries.delete(messageId);
      ingestionState.pendingRecoveries = missingMessageRecoveries.size;
      ingestionState.recoveryExhausted++;
      emitLog(`WhatsApp content recovery exhausted for message ${messageId}; the event remains visible in ingestion diagnostics.`);
      broadcastState();
      return;
    }

    recovery.timer = setTimeout(runAttempt, MISSING_MESSAGE_RECOVERY_DELAYS_MS[recovery.attempt]);
    recovery.timer.unref?.();
    broadcastState();
  };

  recovery.timer = setTimeout(runAttempt, MISSING_MESSAGE_RECOVERY_DELAYS_MS[0]);
  recovery.timer.unref?.();
  emitLog(`Scheduled content recovery for placeholder message ${messageId} in ${chatRecord.name || messageChatJid(msg)}.`);
  return true;
}

function reconnectDelayMs(isRateLimited = false) {
  if (isRateLimited) return Math.min(60000, RECONNECT_MAX_DELAY_MS);
  const exponent = Math.min(Math.max(reconnectAttempts - 1, 0), 10);
  const capped = Math.min(RECONNECT_BASE_DELAY_MS * (2 ** exponent), RECONNECT_MAX_DELAY_MS);
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.round(capped * jitter);
}

function scheduleReconnect(reason, {
  isRateLimited = false,
  force = false,
  delayMsOverride = null
} = {}) {
  if (force) {
    reconnectSuppressed = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    isReconnecting = false;
  }
  if (reconnectSuppressed || reconnectTimer || isReconnecting) return false;

  reconnectAttempts++;
  const delayMs = Number.isFinite(delayMsOverride)
    ? Math.max(0, delayMsOverride)
    : reconnectDelayMs(isRateLimited);
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

function scheduleInitialGroupSync() {
  if (groupSyncTimer) clearTimeout(groupSyncTimer);
  const scheduledSocket = sock;
  groupSyncTimer = setTimeout(() => {
    groupSyncTimer = null;
    if (sock !== scheduledSocket || connectionStatus !== 'connected') return;
    void syncGroups();
  }, INITIAL_GROUP_SYNC_DELAY_MS);
  groupSyncTimer.unref?.();
}

function emitOracleResult(oracleResult) {
  if (oracleResult?.case && ioInstance) {
    ioInstance.emit('oracle_case_result', oracleResult.case);
  }
  if (oracleResult?.case?.id) {
    queueDashboardQuotationCase(oracleResult.case.id);
    void flushDashboardQuotationSyncs().catch(error => {
      emitLog(`Mrrjestic dashboard quotation delivery will retry: ${error.message}`);
    });
  }
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

  const pending = oracleSyncPendingMessages.get(group.id) || new Map();
  pending.set(message.id, message);
  oracleSyncPendingMessages.set(group.id, pending);

  const existing = oracleSyncTimers.get(group.id);
  if (existing) clearTimeout(existing);

  const settings = getSettings();
  const quietSeconds = Math.max(5, Math.min(Number(settings.oracle_quiet_period_seconds) || 45, 300));
  const timer = setTimeout(async () => {
    oracleSyncTimers.delete(group.id);
    const settledMessages = [...(oracleSyncPendingMessages.get(group.id)?.values() || [])]
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || Number(left.id) - Number(right.id));
    oracleSyncPendingMessages.delete(group.id);
    const currentGroup = db.prepare('SELECT * FROM groups WHERE id = ?').get(group.id);
    if (!currentGroup || currentGroup.is_monitored !== 1 || currentGroup.oracle_sync_enabled !== 1) return;

    emitLog(`Checking ${settledMessages.length} settled supplier message${settledMessages.length === 1 ? '' : 's'} for quotation-case updates...`);
    const candidateEventIds = new Set();
    for (const settledMessage of settledMessages) {
      try {
        const result = await processOracleGroupMessage({
          message: settledMessage,
          group: currentGroup,
          allowAutoPublish: false
        });
        for (const event of result?.events || []) candidateEventIds.add(event.id);
        emitOracleResult(result);
      } catch (error) {
        emitLog(`Oracle quotation check could not complete for message #${settledMessage.id}: ${error.message}`);
      }
    }
    if (getSettings().oracle_auto_publish === 'true') {
      for (const eventId of candidateEventIds) {
        const stored = db.prepare(`
          SELECT e.sync_status, c.status AS case_status, c.last_reason AS case_last_reason
          FROM oracle_sync_events e
          LEFT JOIN oracle_quote_cases c ON c.id = e.case_id
          WHERE e.id = ?
        `).get(eventId);
        if (
          stored?.sync_status !== 'ready'
          || (stored.case_status && stored.case_status !== 'ready')
          || stored.case_last_reason
        ) continue;
        try {
          const publishedEvent = await publishOracleSyncEvent(eventId);
          emitOracleResult({
            events: [publishedEvent],
            case: publishedEvent?.case_id ? getOracleQuoteCaseById(publishedEvent.case_id) : null
          });
        } catch (error) {
          emitLog(`Oracle auto-publish could not complete for quotation #${eventId}: ${error.message}`);
        }
      }
    }
  }, quietSeconds * 1000);
  oracleSyncTimers.set(group.id, timer);
  emitLog(`Supplier reply captured. Waiting ${quietSeconds} seconds for any quotation fragments or corrections.`);
  return true;
}

function activeSocketAccountId() {
  return sock?.user?.id ? jidNormalizedUser(sock.user.id) : null;
}

function reconcileStoredSenderIdentity(lid, phoneJid, accountId = activeSocketAccountId()) {
  const canonicalPhone = canonicalPhoneJid(phoneJid);
  const canonicalLid = String(lid || '').trim();
  if (!canonicalLid.endsWith('@lid') || !canonicalPhone || !accountId) return 0;

  const changed = db.transaction(() => {
    const messages = db.prepare(`
      UPDATE messages
      SET sender_id = ?
      WHERE sender_id = ? AND account_id = ?
    `).run(canonicalPhone, canonicalLid, accountId).changes;
    const supplierCases = db.prepare(`
      UPDATE oracle_quote_cases
      SET supplier_sender_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE supplier_sender_id = ? AND account_id = ?
    `).run(canonicalPhone, canonicalLid, accountId).changes;
    const requesterCases = db.prepare(`
      UPDATE oracle_quote_cases
      SET requester_sender_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE requester_sender_id = ? AND account_id = ?
    `).run(canonicalPhone, canonicalLid, accountId).changes;
    return messages + supplierCases + requesterCases;
  })();

  if (changed > 0) {
    ingestionState.reconciledSenderRows += changed;
    emitLog(`Reconciled ${changed} stored sender record${changed === 1 ? '' : 's'} to a supplier-compatible WhatsApp phone identity.`);
  }
  return changed;
}

async function reconcileStoredLidSenders() {
  if (senderReconciliationPromise) return senderReconciliationPromise;
  const scheduledSocket = sock;
  const accountId = activeSocketAccountId();
  if (!scheduledSocket?.signalRepository?.lidMapping || !accountId) return 0;

  senderReconciliationPromise = (async () => {
    const rows = db.prepare(`
      SELECT DISTINCT sender_id
      FROM messages
      WHERE account_id = ? AND sender_id LIKE '%@lid'
    `).all(accountId);
    let reconciled = 0;
    for (const row of rows) {
      if (sock !== scheduledSocket) break;
      try {
        const phoneJid = await scheduledSocket.signalRepository.lidMapping.getPNForLID(row.sender_id);
        if (!phoneJid) {
          ingestionState.senderMappingsUnresolved++;
          continue;
        }
        ingestionState.senderMappingsResolved++;
        reconciled += reconcileStoredSenderIdentity(row.sender_id, phoneJid, accountId);
      } catch (error) {
        ingestionState.senderMappingsUnresolved++;
        emitLog(`Could not resolve a stored WhatsApp sender identity: ${error.message}`);
      }
    }
    return reconciled;
  })().finally(() => {
    senderReconciliationPromise = null;
    broadcastState();
  });
  return senderReconciliationPromise;
}

async function processUnparsedRecoveredSupplierHistory() {
  if (recoveredHistoryProcessingPromise) return recoveredHistoryProcessingPromise;
  const accountId = activeSocketAccountId();
  if (!accountId) return 0;

  recoveredHistoryProcessingPromise = (async () => {
    const messages = db.prepare(`
      SELECT m.*
      FROM messages m
      JOIN groups g ON g.id = m.group_id
      WHERE m.account_id = ?
        AND m.chat_type = 'group'
        AND m.source = 'history'
        AND g.is_monitored = 1
        AND g.oracle_sync_enabled = 1
        AND NOT EXISTS (
          SELECT 1 FROM oracle_quote_runs r WHERE r.trigger_message_id = m.id
        )
      ORDER BY m.timestamp ASC, m.id ASC
      LIMIT 200
    `).all(accountId);
    const groups = new Map();
    let processed = 0;

    for (const message of messages) {
      let group = groups.get(message.group_id);
      if (!group) {
        group = db.prepare('SELECT * FROM groups WHERE id = ?').get(message.group_id);
        if (group) groups.set(message.group_id, group);
      }
      if (!group || !isConfiguredSupplierMessage(message, group)) continue;

      try {
        const result = await processOracleGroupMessage({
          message,
          group,
          allowAutoPublish: false
        });
        emitOracleResult(result);
        processed++;
        ingestionState.recoveredHistoryQuotationChecks++;
      } catch (error) {
        emitLog(`Recovered quotation check could not complete for message #${message.id}: ${error.message}`);
      }
    }

    if (processed > 0) {
      emitLog(`Checked ${processed} recovered supplier message${processed === 1 ? '' : 's'} against the quotation-case pipeline; Oracle publishing remains review-gated.`);
    }
    return processed;
  })().finally(() => {
    recoveredHistoryProcessingPromise = null;
    broadcastState();
  });
  return recoveredHistoryProcessingPromise;
}

async function maintainRecoveredSupplierHistory() {
  await reconcileStoredLidSenders();
  return processUnparsedRecoveredSupplierHistory();
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
  if (groupSyncTimer) {
    clearTimeout(groupSyncTimer);
    groupSyncTimer = null;
  }
  isReconnecting = false;
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
  discoveredGroupChats.clear();
  groupMetadataRequests.clear();
  bulkGroupFetchAttemptedAccounts.clear();
  dmHistoryAnchors.clear();
  requestedDmHistory.clear();
  groupHistoryAnchors.clear();
  requestedGroupHistory.clear();
  groupHistoryPageCounts.clear();
  exhaustedGroupHistory.clear();
  clearMissingMessageRecoveries();
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

function emitGroupUpdates() {
  if (ioInstance) ioInstance.emit('groups_updated', getGroups());
}

function currentWhatsappAccountId() {
  if (!sock?.user?.id) return null;
  try {
    return jidNormalizedUser(sock.user.id);
  } catch {
    return sock.user.id;
  }
}

function rememberGroupChat(value, fallbackJid = null) {
  const jid = groupJidFrom(value) || groupJidFrom(fallbackJid);
  if (!jid) return null;

  const existing = db.prepare('SELECT * FROM groups WHERE id = ?').get(jid);
  const suppliedName = groupNameFrom(value);
  const name = suppliedName || existing?.name || 'Unnamed Group';
  discoveredGroupChats.set(jid, name);
  upsertGroup(jid, name, currentWhatsappAccountId());
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(jid);
}

async function refreshGroupMetadata(jid) {
  if (!groupJidFrom(jid) || !sock || connectionStatus !== 'connected') return null;
  if (groupMetadataRequests.has(jid)) return groupMetadataRequests.get(jid);

  const request = (async () => {
    try {
      const metadata = await sock.groupMetadata(jid);
      return rememberGroupChat(metadata, jid);
    } catch (error) {
      emitLog(`Could not refresh metadata for WhatsApp group ${jid}: ${error.message}`);
      return rememberGroupChat(jid);
    } finally {
      groupMetadataRequests.delete(jid);
    }
  })();
  groupMetadataRequests.set(jid, request);
  return request;
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
  if (groupSyncTimer) {
    clearTimeout(groupSyncTimer);
    groupSyncTimer = null;
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

    let credentialsSaveError = null;
    let credentialsSavePromise = Promise.resolve();
    sock.ev.on('creds.update', () => {
      credentialsSavePromise = credentialsSavePromise
        .then(async () => {
          try {
            await saveCreds();
            credentialsSaveError = null;
          } catch (error) {
            credentialsSaveError = error;
            emitLog(`Could not persist updated WhatsApp credentials: ${error.message}`);
          }
        });
      return credentialsSavePromise;
    });

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
          discoveredGroupChats.clear();
          emitLog('Linked account changed. All chat monitoring and quotation sync controls were paused for safety.');
        }
        broadcastState();

        // Let the socket settle before the group IQ query. Baileys can close a
        // newly opened socket with status 428 when this query is sent too early.
        scheduleInitialGroupSync();
        void maintainRecoveredSupplierHistory();
      }

      if (connection === 'close') {
        if (groupSyncTimer) {
          clearTimeout(groupSyncTimer);
          groupSyncTimer = null;
        }
        connectionStatus = 'disconnected';
        currentQrDataUrl = null;
        currentPairingCode = null;

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const disconnectMessage = lastDisconnect?.error?.message || 'Unknown disconnect';
        const {
          isRestartRequired,
          isRateLimited,
          shouldReconnect
        } = getDisconnectPolicy(statusCode, DisconnectReason);

        lastDisconnectAt = new Date().toISOString();
        lastDisconnectReason = `${disconnectMessage}${statusCode ? ` (status ${statusCode})` : ''}`;
        reconnectSuppressed = !shouldReconnect;

        emitLog(`WhatsApp connection closed (${disconnectMessage}; status ${statusCode}). Reconnect: ${shouldReconnect}`);

        if (isRestartRequired) {
          emitLog('WhatsApp accepted the device pairing. Saving credentials and restarting the socket...');
          await credentialsSavePromise;
          if (credentialsSaveError) {
            emitLog('The socket will restart, but the credential save reported an error.');
          }
          scheduleReconnect('pairing completed; WhatsApp requested a socket restart', {
            force: true,
            delayMsOverride: 1000
          });
        } else if (shouldReconnect) {
          scheduleReconnect(disconnectMessage, { isRateLimited });
        } else {
          reconnectAttempts = 0;
          emitLog('Automatic reconnect paused because WhatsApp logged out or another listener replaced this session. Re-pair from the dashboard after confirming only one listener is running.');
        }
        broadcastState();
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      ingestionState.upsertBatches++;
      for (const msg of m.messages || []) {
        const delivery = classifyUpsertMessage(m.type, msg, { catchupWindowMs: CATCHUP_WINDOW_MS });
        const result = await handleIncomingMessage(msg, {
          source: delivery.source,
          downloadMedia: delivery.activeDelivery,
          runExtraction: delivery.activeDelivery
        });
        recordIngestionResult(msg, delivery, result);
      }
      broadcastState();
    });

    sock.ev.on('lid-mapping.update', ({ lid, pn }) => {
      reconcileStoredSenderIdentity(lid, pn);
      void processUnparsedRecoveredSupplierHistory();
    });

    // Full history is delivered separately from live messages. Keep a bounded,
    // in-memory buffer for paused chats so the user can opt in before message
    // bodies are written to disk. Enabling a chat imports its buffered history.
    sock.ev.on('messaging-history.set', async ({
      messages = [],
      contacts = [],
      chats = [],
      progress,
      isLatest,
      peerDataRequestSessionId
    }) => {
      let importedGroups = 0;
      let importedDms = 0;
      let bufferedGroups = 0;
      let bufferedDms = 0;
      const discoveredGroupIds = new Set();
      let discoveredDms = 0;
      const historyGroups = new Set();
      const accountId = activeSocketAccountId();
      const latestStoredByGroup = new Map(db.prepare(`
        SELECT group_id, MAX(timestamp) AS latest_timestamp
        FROM messages
        WHERE chat_type = 'group' AND (? IS NULL OR account_id = ?)
        GROUP BY group_id
      `).all(accountId, accountId).map(row => [row.group_id, row.latest_timestamp]));

      for (const contact of contacts) rememberContact(contact);

      for (const chat of chats) {
        const group = rememberGroupChat(chat);
        if (group) {
          discoveredGroupIds.add(group.id);
          continue;
        }
        const aliases = dmJidsFrom(chat);
        if (aliases.length === 0 || aliases.some(isOwnDirectJid)) continue;
        if (upsertDmFromJids(aliases, displayNameFromContact(chat))) discoveredDms++;
      }

      for (const msg of messages) {
        const remoteJid = messageChatJid(msg);
        const chatType = chatTypeForJid(remoteJid);
        if (!chatType || !msg.message) continue;

        let chatRecord;
        if (chatType === 'group') {
          chatRecord = rememberGroupChat(remoteJid);
          if (chatRecord) discoveredGroupIds.add(chatRecord.id);
          historyGroups.add(remoteJid);
          rememberGroupHistoryAnchor(remoteJid, msg);
        } else {
          const aliases = dmJidsFrom(msg);
          if (aliases.some(isOwnDirectJid)) continue;
          chatRecord = upsertDmFromJids(aliases, msg.key?.fromMe ? '' : msg.pushName);
          if (chatRecord) discoveredDms++;
        }

        if (chatRecord?.is_monitored === 1) {
          const recoveredDelivery = classifyHistoryMessage(msg, {
            peerDataRequestSessionId,
            latestStoredTimestamp: chatType === 'group' ? latestStoredByGroup.get(remoteJid) : null
          });
          const result = await handleIncomingMessage(msg, {
            source: recoveredDelivery.source,
            downloadMedia: recoveredDelivery.activeDelivery,
            runExtraction: recoveredDelivery.activeDelivery
          });
          if (recoveredDelivery.activeDelivery) recordIngestionResult(msg, recoveredDelivery, result);
          if (result?.saved) {
            if (chatType === 'group') importedGroups++;
            else importedDms++;
          }
        } else if (chatRecord && bufferHistoryMessage(msg, chatType, chatRecord.id)) {
          if (chatType === 'group') bufferedGroups++;
          else bufferedDms++;
        }
      }

      if (discoveredGroupIds.size > 0) {
        emitGroupUpdates();
        await Promise.allSettled([...discoveredGroupIds].map(groupId => refreshGroupMetadata(groupId)));
        emitGroupUpdates();
      }
      if (discoveredDms > 0) emitDmUpdates();
      emitLog(`${peerDataRequestSessionId ? 'On-demand recovery' : 'History sync'} chunk received${progress != null ? ` (${progress}% complete)` : ''}: ${importedGroups} group + ${importedDms} DM messages imported; ${bufferedGroups} group + ${bufferedDms} DM messages held in memory pending selection${isLatest ? ' (latest sync)' : ''}.`);
      broadcastState();
      void maintainRecoveredSupplierHistory();

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

    const handleChatUpdates = async (chats = []) => {
      let dmsChanged = false;
      let groupsChanged = false;
      const groupsToRefresh = new Set();
      for (const chat of chats) {
        const group = rememberGroupChat(chat);
        if (group) {
          groupsChanged = true;
          if (!groupNameFrom(chat)) groupsToRefresh.add(group.id);
          continue;
        }
        const aliases = dmJidsFrom(chat);
        if (aliases.length === 0 || aliases.some(isOwnDirectJid)) continue;
        if (upsertDmFromJids(aliases, displayNameFromContact(chat))) dmsChanged = true;
      }
      if (groupsChanged) emitGroupUpdates();
      if (groupsToRefresh.size > 0) {
        await Promise.allSettled([...groupsToRefresh].map(groupId => refreshGroupMetadata(groupId)));
        emitGroupUpdates();
      }
      if (dmsChanged) emitDmUpdates();
    };

    const handleGroupUpdates = (groups = []) => {
      let changed = false;
      for (const group of groups) {
        if (rememberGroupChat(group)) changed = true;
      }
      if (changed) emitGroupUpdates();
    };

    sock.ev.on('contacts.upsert', handleContactUpdates);
    sock.ev.on('contacts.update', handleContactUpdates);
    sock.ev.on('chats.upsert', handleChatUpdates);
    sock.ev.on('chats.update', handleChatUpdates);
    sock.ev.on('groups.upsert', handleGroupUpdates);
    sock.ev.on('groups.update', handleGroupUpdates);
    sock.ev.on('group-participants.update', ({ id }) => {
      if (!rememberGroupChat(id)) return;
      emitGroupUpdates();
      void refreshGroupMetadata(id).then(emitGroupUpdates);
    });
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
  let groupsMap = {};
  const accountId = currentWhatsappAccountId();
  const shouldFetchBulkGroups = accountId && !bulkGroupFetchAttemptedAccounts.has(accountId);
  if (shouldFetchBulkGroups) {
    bulkGroupFetchAttemptedAccounts.add(accountId);
    try {
      groupsMap = await sock.groupFetchAllParticipating();
    } catch (error) {
      console.error('Error fetching the bulk WhatsApp group list:', error.message);
      emitLog(`The bulk WhatsApp group list was unavailable; checking discovered chats instead (${error.message}).`);
    }
  }

  for (const [jid, group] of Object.entries(groupsMap || {})) {
    rememberGroupChat(group, jid);
  }

  const bulkGroupIds = new Set(Object.keys(groupsMap || {}));
  const fallbackGroupIds = [...discoveredGroupChats.keys()]
    .filter(groupId => !bulkGroupIds.has(groupId));
  if (fallbackGroupIds.length > 0) {
    await Promise.allSettled(fallbackGroupIds.map(groupId => refreshGroupMetadata(groupId)));
  }

  const groupList = getGroups();
  emitGroupUpdates();
  const bulkSummary = shouldFetchBulkGroups
    ? `${bulkGroupIds.size} from the bulk list`
    : 'bulk query already attempted safely';
  emitLog(`Synced ${groupList.length} WhatsApp group chats (${bulkSummary}, ${fallbackGroupIds.length} recovered from chat events).`);
  return groupList;
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

export async function recoverGroupHistoryFromAnchor({ groupId, messageId, timestamp, count = 100 }) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp is not connected.');
  }
  const group = db.prepare('SELECT id, name, is_monitored FROM groups WHERE id = ?').get(groupId);
  if (!group || group.is_monitored !== 1) {
    throw new Error('The WhatsApp group is not monitored.');
  }
  if (typeof messageId !== 'string' || !messageId.trim()) {
    throw new Error('A WhatsApp message anchor ID is required.');
  }
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new Error('A valid message anchor timestamp is required.');
  }
  const safeCount = Math.max(1, Math.min(Number(count) || 100, 500));
  const requestId = await sock.fetchMessageHistory(
    safeCount,
    { remoteJid: group.id, fromMe: false, id: messageId.trim() },
    Math.floor(timestampMs / 1000)
  );
  ingestionState.recoveryHistoryRequests++;
  emitLog(`Requested up to ${safeCount} recent messages to repair the ingestion gap in ${group.name}${requestId ? ` (request ${requestId})` : ''}.`);
  broadcastState();
  return { requested: true, groupId: group.id, count: safeCount, requestId: requestId || null };
}

async function handleIncomingMessage(msg, options = {}) {
  try {
    const {
      source = 'realtime',
      downloadMedia = isActiveDeliverySource(source),
      runExtraction = isActiveDeliverySource(source)
    } = options;
    const activeDelivery = isActiveDeliverySource(source);
    if (!msg) return { saved: false, reason: 'missing_event' };
    const remoteJid = messageChatJid(msg);
    const chatType = chatTypeForJid(remoteJid);
    if (!chatType) return { saved: false, reason: 'unsupported_chat' };

    let chatRecord;
    if (chatType === 'group') {
      rememberGroupHistoryAnchor(remoteJid, msg);
      const existingGroup = db.prepare('SELECT id FROM groups WHERE id = ?').get(remoteJid);
      chatRecord = rememberGroupChat(remoteJid);
      if (!existingGroup && chatRecord) {
        emitGroupUpdates();
        void refreshGroupMetadata(remoteJid).then(emitGroupUpdates);
      }
    } else {
      const aliases = dmJidsFrom(msg);
      if (!aliases.includes(remoteJid)) aliases.push(remoteJid);
      if (aliases.some(isOwnDirectJid)) return { saved: false, reason: 'own_chat' };
      chatRecord = upsertDmFromJids(aliases, msg.key?.fromMe ? '' : msg.pushName);
      rememberDmHistoryAnchor(chatRecord?.id, msg);
      emitDmUpdates();
    }
    if (!chatRecord || chatRecord.is_monitored !== 1) {
      return { saved: false, reason: 'not_monitored' };
    }

    const messageId = msg.key?.id;
    const normalizedMessage = normalizeMessageContent(msg.message);
    if (!normalizedMessage) {
      const isCiphertextPlaceholder = msg.messageStubType === WAMessageStubType.CIPHERTEXT;
      if (chatType === 'group' && isCiphertextPlaceholder) {
        scheduleMissingMessageRecovery(msg, chatRecord);
      }
      return {
        saved: false,
        reason: isCiphertextPlaceholder ? 'ciphertext_placeholder' : 'missing_message'
      };
    }
    completeMissingMessageRecovery(messageId);

    const chatId = chatType === 'group' ? remoteJid : chatRecord.id;
    const chatName = chatRecord.name || remoteJid.split('@')[0];
    const preliminarySenderId = senderIdFromMessage(msg, sock?.user?.id || 'self');
    let senderId = preliminarySenderId;
    if (preliminarySenderId.endsWith('@lid')) {
      try {
        const lidMapping = sock?.signalRepository?.lidMapping;
        senderId = await resolvedSenderIdFromMessage(
          msg,
          sock?.user?.id || 'self',
          lidMapping ? lid => lidMapping.getPNForLID(lid) : null
        );
        if (senderId !== preliminarySenderId) {
          ingestionState.senderMappingsResolved++;
          reconcileStoredSenderIdentity(preliminarySenderId, senderId);
        } else {
          ingestionState.senderMappingsUnresolved++;
        }
      } catch (error) {
        ingestionState.senderMappingsUnresolved++;
        emitLog(`Could not resolve the WhatsApp sender identity for message ${messageId || '<no id>'}: ${error.message}`);
      }
    }
    const senderName = msg.key?.fromMe
      ? (sock?.user?.name || 'You')
      : (msg.pushName || chatRecord.name || senderId.split('@')[0]);
    if (!messageId) return { saved: false, reason: 'missing_id' };
    if (db.prepare('SELECT 1 FROM messages WHERE wa_message_id = ?').get(messageId)) {
      return { saved: false, reason: 'duplicate' };
    }
    const timestamp = new Date(messageTimestampMs(msg) || Date.now()).toISOString();

    // Determine message type & text content
    const messageType = Object.keys(normalizedMessage)[0];
    if (!messageType) return { saved: false, reason: 'missing_message_type' };
    if (isNonConversationalMessageType(messageType)) {
      return { saved: false, reason: 'non_conversational_message_type' };
    }
    const replyToWaMessageId = normalizedMessage?.[messageType]?.contextInfo?.stanzaId || null;
    let content = '';
    let mediaObj = null;
    let extractedText = '';

    if (messageType === 'conversation') {
      content = normalizedMessage.conversation;
    } else if (messageType === 'extendedTextMessage') {
      content = normalizedMessage.extendedTextMessage.text;
    } else if (messageType === 'imageMessage') {
      content = normalizedMessage.imageMessage.caption || '[Image Message]';
      if (downloadMedia) mediaObj = await downloadAndProcessMedia(normalizedMessage.imageMessage, 'image', 'imageMessage');
    } else if (messageType === 'documentMessage') {
      const doc = normalizedMessage.documentMessage;
      content = doc.caption || `[Document: ${doc.fileName || 'file'}]`;
      if (downloadMedia) mediaObj = await downloadAndProcessMedia(doc, 'document', 'documentMessage', doc.fileName);
      if (mediaObj && mediaObj.extractedText) {
        extractedText = mediaObj.extractedText;
      }
    } else if (messageType === 'audioMessage') {
      content = '[Audio Message]';
      if (downloadMedia) mediaObj = await downloadAndProcessMedia(normalizedMessage.audioMessage, 'audio', 'audioMessage');
    } else if (messageType === 'videoMessage') {
      content = normalizedMessage.videoMessage.caption || '[Video Message]';
      if (downloadMedia) mediaObj = await downloadAndProcessMedia(normalizedMessage.videoMessage, 'video', 'videoMessage');
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

    const sourceAction = source === 'history' ? '🕘 Imported' : source === 'catchup' ? '↩️ Recovered' : '📩 Received';
    emitLog(`${sourceAction} message from ${senderName} in ${chatType === 'group' ? 'group' : 'DM'} "${chatName}" (${messageType})`);

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
      reply_to_wa_message_id: replyToWaMessageId,
      timestamp
    });
    if (!dbMessageId) return { saved: false, reason: 'save_failed' };
    if (activeDelivery) lastMessageAt = timestamp;

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
      reply_to_wa_message_id: replyToWaMessageId,
      timestamp
    };

    if (ioInstance) {
      ioInstance.emit('new_message', fullMsgPayload);
    }

    if (chatType === 'dm' && activeDelivery) {
      void requestHistoryForDm(chatId);
    }
    if (chatType === 'group' && activeDelivery) {
      void requestHistoryForGroup(chatId);
    }

    // Mapped supplier groups use the bounded quotation-session pipeline. Do
    // not run the generic per-message extractor because it loses fragments
    // and creates duplicate, unrelated extraction records.
    if (chatType === 'group' && chatRecord.oracle_sync_enabled === 1) {
      if (activeDelivery) scheduleOracleQuotationCheck(fullMsgPayload, chatRecord);
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
  oracleSyncPendingMessages.clear();
  clearMissingMessageRecoveries();

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
