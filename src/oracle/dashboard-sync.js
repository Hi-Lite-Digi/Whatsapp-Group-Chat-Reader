import crypto from 'crypto';

import {
  db,
  getActiveWhatsappAccount,
  getOracleQuoteCaseById,
  getOracleQuoteCaseContextMessages,
  getOracleQuoteCaseMessages,
  getOracleQuoteCases,
  getOracleSyncEventsForCase,
  getPendingDashboardQuoteSyncs,
  getSettings,
  markDashboardQuoteSyncFailed,
  markDashboardQuoteSyncSucceeded,
  queueDashboardQuoteSync
} from '../db/database.js';
import { quotationCaseLifetimeMinutes } from './cases.js';
import { isConversationalMessageType } from '../whatsapp/message-types.js';

const SYNC_INTERVAL_MS = Math.max(
  10_000,
  Number.parseInt(process.env.MRRJESTIC_DASHBOARD_SYNC_INTERVAL_MS || '30000', 10)
);
const REQUEST_TIMEOUT_MS = Math.max(
  2_000,
  Number.parseInt(process.env.MRRJESTIC_DASHBOARD_SYNC_TIMEOUT_MS || '10000', 10)
);
const MAX_RETRY_MS = 60 * 60 * 1000;

let flushPromise = null;
let reviewPromise = null;
let workerTimer = null;

function dashboardConfiguration() {
  return {
    baseUrl: String(process.env.MRRJESTIC_DASHBOARD_URL || '').trim().replace(/\/$/, ''),
    apiKey: String(process.env.MRRJESTIC_DASHBOARD_INGEST_KEY || '').trim()
  };
}

export function isDashboardQuotationSyncConfigured() {
  const configuration = dashboardConfiguration();
  return Boolean(configuration.baseUrl && configuration.apiKey);
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toIso(value, fallback = new Date().toISOString()) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function messageBody(message) {
  return [message.content, message.extracted_text]
    .filter(value => String(value || '').trim())
    .join('\n')
    .trim();
}

function supplierSenderIds(caseRecord) {
  const group = caseRecord?.group_id
    ? db.prepare('SELECT oracle_supplier_sender_ids FROM groups WHERE id = ?').get(caseRecord.group_id)
    : null;
  const configured = [
    ...String(group?.oracle_supplier_sender_ids || '').split(/[\s,]+/),
    caseRecord?.supplier_sender_id
  ].filter(Boolean);
  return new Set(configured);
}

function normalizedMessage(message, includedMessageIds, supplierIds) {
  const matchReasons = parseJson(message.match_reasons_json, []);
  const includedInCase = includedMessageIds.has(message.id);
  const role = message.role === 'supplier' || supplierIds.has(message.sender_id)
    ? 'supplier'
    : message.role === 'requester'
      ? 'requester'
      : 'context';

  return {
    id: Number(message.id),
    whatsappMessageId: message.wa_message_id || undefined,
    messageType: message.message_type || undefined,
    role,
    quotationRole: includedInCase
      ? role === 'supplier' ? 'supplier_quotation' : 'quote_request'
      : 'context',
    senderName: message.sender_name || message.sender_id || 'Unknown sender',
    body: messageBody(message),
    createdAt: toIso(message.timestamp),
    includedInCase,
    exclusionReason: includedInCase
      ? undefined
      : 'Nearby message was not attached by the quotation correlation rules.',
    matchReasons: Array.isArray(matchReasons) ? matchReasons.map(String) : []
  };
}

function fieldEvidence(value) {
  const evidence = value && typeof value === 'object' ? value : {};
  return {
    messageIds: [...new Set((Array.isArray(evidence.message_ids) ? evidence.message_ids : [])
      .map(Number)
      .filter(id => Number.isInteger(id) && id > 0))],
    basis: [
      'explicit',
      'contextual',
      'supplier_pattern_inference',
      'price_quantity_assumption'
    ].includes(evidence.basis) ? evidence.basis : 'contextual',
    explanation: String(evidence.explanation || 'Mapped from the quotation transcript.').slice(0, 1000)
  };
}

function fieldMappings(knownFields, events) {
  const mappings = Array.isArray(knownFields.field_mappings) ? knownFields.field_mappings : [];
  if (mappings.length > 0) {
    const normalized = mappings.map(mapping => ({
      brand: mapping.brand || undefined,
      model: mapping.model || undefined,
      size: mapping.size || undefined,
      price: Number(mapping.price) > 0 ? Number(mapping.price) : undefined,
      stockQuantity: Number.isInteger(Number(mapping.stock_quantity)) && Number(mapping.stock_quantity) > 0
        ? Number(mapping.stock_quantity)
        : undefined,
      availability: ['ready_stock', 'preorder', 'unknown'].includes(mapping.availability)
        ? mapping.availability
        : 'unknown',
      confidence: Number.isFinite(Number(mapping.confidence)) ? Number(mapping.confidence) : undefined,
      evidence: Object.fromEntries(
        Object.entries(mapping.evidence || {}).map(([field, evidence]) => [field, fieldEvidence(evidence)])
      )
    }));
    const uniqueMappings = new Map();
    for (const mapping of normalized) {
      const key = [
        mapping.brand,
        mapping.model,
        mapping.size,
        mapping.price,
        mapping.stockQuantity,
        mapping.availability
      ].map(value => String(value || '').trim().toLowerCase()).join('|');
      uniqueMappings.set(key, mapping);
    }
    return [...uniqueMappings.values()];
  }

  return events.map(event => ({
    brand: event.brand,
    model: event.model,
    size: event.size,
    price: Number(event.price),
    stockQuantity: Number(event.stock_quantity) > 0 ? Number(event.stock_quantity) : undefined,
    availability: ['ready_stock', 'preorder', 'unknown'].includes(event.availability)
      ? event.availability
      : 'unknown',
    confidence: Number.isFinite(Number(event.confidence)) ? Number(event.confidence) : undefined,
    evidence: {}
  }));
}

function normalizedEvent(event) {
  return {
    id: Number(event.id),
    syncStatus: event.sync_status,
    listingStatus: event.listing_status || undefined,
    listingAction: event.listing_action || undefined,
    supplierName: event.supplier_name || undefined,
    brand: event.brand,
    model: event.model,
    size: event.size,
    price: Number(event.price),
    stockQuantity: Number(event.stock_quantity) > 0 ? Number(event.stock_quantity) : undefined,
    availability: ['ready_stock', 'preorder', 'unknown'].includes(event.availability)
      ? event.availability
      : 'unknown',
    productionYear: Number(event.year_of_manufacture) >= 2000
      ? Number(event.year_of_manufacture)
      : undefined,
    confidence: Number.isFinite(Number(event.confidence)) ? Number(event.confidence) : undefined,
    quotedAt: event.quoted_at || undefined
  };
}

function sourceRevision(payload) {
  return crypto.createHash('sha256').update(JSON.stringify({
    sourceCaseId: payload.sourceCaseId,
    sourceStatus: payload.sourceStatus,
    lastReason: payload.lastReason,
    missingFields: payload.missingFields,
    sourceMessageIds: payload.sourceMessageIds,
    fieldMappings: payload.fieldMappings,
    messages: payload.messages,
    contextMessages: payload.contextMessages,
    events: payload.events
  })).digest('hex');
}

export function buildDashboardQuotationPayload(caseId) {
  const caseRecord = getOracleQuoteCaseById(Number(caseId));
  if (!caseRecord) return null;

  const knownFields = parseJson(caseRecord.known_fields_json, {});
  const missingFields = parseJson(caseRecord.missing_fields_json, []);
  const sourceMessageIds = parseJson(caseRecord.source_message_ids, []);
  const messages = getOracleQuoteCaseMessages(caseRecord.id)
    .filter(message => isConversationalMessageType(message.message_type));
  const includedMessageIds = new Set(messages.map(message => message.id));
  const supplierIds = supplierSenderIds(caseRecord);
  const contextWindowMinutes = quotationCaseLifetimeMinutes(getSettings());
  const context = getOracleQuoteCaseContextMessages(caseRecord.id, contextWindowMinutes)
    .filter(message => isConversationalMessageType(message.message_type));
  const events = getOracleSyncEventsForCase(caseRecord.id).map(normalizedEvent);
  const normalizedMessages = messages.map(message => normalizedMessage(message, includedMessageIds, supplierIds));
  const normalizedContext = context.map(message => normalizedMessage(message, includedMessageIds, supplierIds));
  const fallbackTimestamp = new Date().toISOString();
  const payload = {
    source: 'whatsapp_group_reader',
    sourceCaseId: String(caseRecord.id),
    groupId: caseRecord.group_id,
    groupName: caseRecord.group_name || caseRecord.group_id,
    supplierCode: caseRecord.supplier_code,
    supplierName: events.find(event => event.supplierName)?.supplierName,
    sourceStatus: caseRecord.status,
    lastReason: caseRecord.last_reason || undefined,
    openedAt: toIso(caseRecord.opened_at, fallbackTimestamp),
    lastActivityAt: toIso(caseRecord.last_activity_at || caseRecord.updated_at, fallbackTimestamp),
    missingFields: Array.isArray(missingFields) ? missingFields.map(String) : [],
    sourceMessageIds: Array.isArray(sourceMessageIds) ? sourceMessageIds.map(String) : [],
    requiresStaffVerification: knownFields.requires_staff_verification === true
      || Boolean(caseRecord.last_reason && String(caseRecord.last_reason).includes('review')),
    fieldMappings: fieldMappings(knownFields, events),
    messages: normalizedMessages,
    contextMessages: normalizedContext,
    events
  };

  return { ...payload, sourceRevision: sourceRevision(payload) };
}

export function queueDashboardQuotationCase(caseId) {
  const payload = buildDashboardQuotationPayload(caseId);
  if (!payload) return null;
  return queueDashboardQuoteSync(Number(caseId), payload.sourceRevision, payload);
}

export function queueAllDashboardQuotationCases(limit = 500) {
  let queued = 0;
  for (const caseRecord of getOracleQuoteCases(limit)) {
    if (queueDashboardQuotationCase(caseRecord.id)) queued++;
  }
  return queued;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function retryAt(attempts) {
  const delay = Math.min(30_000 * (2 ** Math.min(Number(attempts) || 0, 7)), MAX_RETRY_MS);
  return new Date(Date.now() + delay).toISOString();
}

export async function flushDashboardQuotationSyncs(limit = 20) {
  if (flushPromise) return flushPromise;
  if (!isDashboardQuotationSyncConfigured()) return { configured: false, synced: 0, failed: 0 };

  flushPromise = (async () => {
    const configuration = dashboardConfiguration();
    let synced = 0;
    let failed = 0;

    for (const item of getPendingDashboardQuoteSyncs(limit)) {
      try {
        const response = await fetchWithTimeout(
          `${configuration.baseUrl}/api/internal/whatsapp-quotations`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${configuration.apiKey}`,
              'content-type': 'application/json'
            },
            body: item.payload_json
          }
        );
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Mrrjestic dashboard returned ${response.status}: ${body.slice(0, 500)}`);
        }
        markDashboardQuoteSyncSucceeded(item.case_id, item.source_revision);
        synced++;
      } catch (error) {
        markDashboardQuoteSyncFailed(
          item.case_id,
          item.source_revision,
          error instanceof Error ? error.message : String(error),
          retryAt(item.attempts)
        );
        failed++;
      }
    }

    return { configured: true, synced, failed };
  })().finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}

export async function pollVerifiedDashboardQuotations({ publishEvent, onPublished } = {}) {
  if (reviewPromise) return reviewPromise;
  if (!isDashboardQuotationSyncConfigured() || typeof publishEvent !== 'function') {
    return { configured: isDashboardQuotationSyncConfigured(), published: 0, failed: 0 };
  }

  reviewPromise = (async () => {
    const configuration = dashboardConfiguration();
    let published = 0;
    let failed = 0;
    const response = await fetchWithTimeout(
      `${configuration.baseUrl}/api/internal/whatsapp-quotations`,
      { headers: { authorization: `Bearer ${configuration.apiKey}` } }
    );
    if (!response.ok) {
      throw new Error(`Mrrjestic dashboard review poll returned ${response.status}.`);
    }
    const body = await response.json();

    for (const review of body.verifiedReviews || []) {
      const caseId = Number(review.sourceCaseId);
      const currentPayload = buildDashboardQuotationPayload(caseId);
      if (!currentPayload || currentPayload.sourceRevision !== review.reviewedRevision) continue;

      for (const eventId of review.eventIds || []) {
        try {
          const event = await publishEvent(Number(eventId));
          if (event?.case_id !== caseId) continue;
          published++;
          onPublished?.(event);
        } catch {
          failed++;
        }
      }

      queueDashboardQuotationCase(caseId);
    }

    if (published > 0) await flushDashboardQuotationSyncs();
    return { configured: true, published, failed };
  })().finally(() => {
    reviewPromise = null;
  });

  return reviewPromise;
}

export function startDashboardQuotationSyncWorker({ publishEvent, onLog, onPublished } = {}) {
  if (workerTimer) return false;
  if (!isDashboardQuotationSyncConfigured()) {
    onLog?.('Mrrjestic dashboard quotation sync is not configured.');
    return false;
  }

  const run = async () => {
    try {
      const delivery = await flushDashboardQuotationSyncs();
      const reviews = await pollVerifiedDashboardQuotations({ publishEvent, onPublished });
      if (delivery.synced || delivery.failed || reviews.published || reviews.failed) {
        onLog?.(`Mrrjestic dashboard sync: ${delivery.synced} delivered, ${delivery.failed} retrying, ${reviews.published} Oracle publication${reviews.published === 1 ? '' : 's'}.`);
      }
    } catch (error) {
      onLog?.(`Mrrjestic dashboard sync is retrying after an error: ${error.message}`);
    }
  };

  queueAllDashboardQuotationCases();
  void run();
  workerTimer = setInterval(() => void run(), SYNC_INTERVAL_MS);
  workerTimer.unref?.();
  return true;
}

export function stopDashboardQuotationSyncWorker() {
  if (!workerTimer) return false;
  clearInterval(workerTimer);
  workerTimer = null;
  return true;
}

export function dashboardQuotationSyncStatus() {
  return {
    configured: isDashboardQuotationSyncConfigured(),
    target: dashboardConfiguration().baseUrl || null,
    activeAccount: getActiveWhatsappAccount()
  };
}
