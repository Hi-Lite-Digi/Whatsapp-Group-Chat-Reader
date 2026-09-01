import {
  attachMessagesToOracleQuoteCase,
  createOracleQuoteCase,
  expireOracleQuoteCases,
  getActiveOracleQuoteCases,
  getOracleQuoteCaseById,
  getOracleQuoteCaseMessages,
  updateOracleQuoteCase
} from '../db/database.js';
import { buildQuotationSession } from './quotation.js';
import {
  chooseQuotationCase,
  mergeQuotationSignals,
  missingQuotationFields,
  signalsForMessages
} from './case-correlation.js';

const NON_CASE_REASONS = new Set([
  'unsupported_product',
  'logistics_or_acknowledgement',
  'acknowledgement_only',
  'unrelated_confirmation'
]);

export function quotationCaseLifetimeMinutes(settings) {
  return Math.max(15, Math.min(Number(settings?.oracle_case_lifetime_minutes) || 60, 1440));
}

function expiresAt(timestamp, lifetimeMinutes) {
  const base = Date.parse(timestamp);
  const safeBase = Number.isFinite(base) ? base : Date.now();
  return new Date(safeBase + lifetimeMinutes * 60000).toISOString();
}

function correlationSummary(decision) {
  return {
    outcome: decision.outcome,
    candidates: (decision.candidates || []).map(candidate => ({
      case_id: candidate.caseRecord.id,
      score: candidate.score,
      reasons: candidate.reasons,
      conflicts: candidate.conflicts
    }))
  };
}

function sourceSession(preliminarySession, discoverySession) {
  if (preliminarySession?.requestAnchor) return preliminarySession;
  if (discoverySession?.requestAnchor) return discoverySession;
  return preliminarySession?.messages?.length ? preliminarySession : discoverySession;
}

function relevantForNewCase(session, signals) {
  if (NON_CASE_REASONS.has(session?.reason)) return false;
  if (session?.reason === 'negative_availability_only' && !session?.requestAnchor) return false;
  return Boolean(
    session?.requestAnchor
    || signals.meaningfulContinuation
    || signals.sizes.length
    || signals.prices.length
    || signals.brands.length
    || signals.models.length
  );
}

function roleFor(supplierSenderIds, message) {
  return supplierSenderIds.has(message.sender_id) ? 'supplier' : 'requester';
}

function caseStatusAfterAttachment(caseRecord, missingFields) {
  if (['ready', 'published'].includes(caseRecord?.status)) return caseRecord.status;
  return missingFields.length > 0 ? 'incomplete' : 'collecting';
}

function storedFields(caseRecord) {
  if (typeof caseRecord?.known_fields_json !== 'string') return caseRecord?.known_fields_json || {};
  try {
    return JSON.parse(caseRecord.known_fields_json || '{}');
  } catch {
    return {};
  }
}

export function resolveQuotationCase({
  message,
  group,
  supplierSenderIds,
  preliminarySession,
  discoverySession,
  settings
}) {
  const supplierCode = String(group.oracle_supplier_code || '').trim().toUpperCase();
  const lifetimeMinutes = quotationCaseLifetimeMinutes(settings);
  const activityAt = message.timestamp || new Date().toISOString();
  expireOracleQuoteCases(activityAt);

  const creationSession = sourceSession(preliminarySession, discoverySession);
  const activeCases = getActiveOracleQuoteCases(group.id, supplierCode, activityAt);
  const anchor = preliminarySession?.requestAnchor || discoverySession?.requestAnchor || null;
  const decision = chooseQuotationCase({
    cases: activeCases,
    currentMessage: message,
    requestAnchor: anchor
  });

  const currentSignals = signalsForMessages([message]);
  const relevant = relevantForNewCase(creationSession, currentSignals);
  if (decision.outcome === 'ambiguous') {
    if (!relevant) return { caseRecord: null, outcome: 'irrelevant', decision };
    const ambiguousMessages = creationSession?.messages?.length ? creationSession.messages : [message];
    const signals = signalsForMessages(ambiguousMessages);
    const caseRecord = createOracleQuoteCase({
      account_id: message.account_id,
      group_id: group.id,
      supplier_code: supplierCode,
      supplier_sender_id: message.sender_id,
      requester_sender_id: anchor?.sender_id || null,
      request_message_id: anchor?.id || null,
      status: 'ambiguous',
      known_fields_json: signals,
      missing_fields_json: missingQuotationFields(signals),
      correlation_json: correlationSummary(decision),
      last_message_id: message.id,
      last_reason: 'ambiguous_case_match',
      opened_at: activityAt,
      last_activity_at: activityAt,
      expires_at: expiresAt(activityAt, lifetimeMinutes)
    });
    attachMessagesToOracleQuoteCase(caseRecord.id, ambiguousMessages, {
      roleForMessage: item => roleFor(supplierSenderIds, item),
      matchReasons: ['ambiguous_case_match']
    });
    return { caseRecord: getOracleQuoteCaseById(caseRecord.id), outcome: 'ambiguous', decision };
  }

  let caseRecord = decision.outcome === 'matched' ? decision.match.caseRecord : null;
  if (!caseRecord && !relevant) return { caseRecord: null, outcome: 'irrelevant', decision };

  const messagesToAttach = creationSession?.messages?.length ? creationSession.messages : [message];
  if (!caseRecord) {
    const signals = signalsForMessages(messagesToAttach);
    const missingFields = missingQuotationFields(signals);
    caseRecord = createOracleQuoteCase({
      account_id: message.account_id,
      group_id: group.id,
      supplier_code: supplierCode,
      supplier_sender_id: message.sender_id,
      requester_sender_id: anchor?.sender_id || null,
      request_message_id: anchor?.id || null,
      status: missingFields.length > 0 ? 'incomplete' : 'collecting',
      known_fields_json: signals,
      missing_fields_json: missingFields,
      correlation_json: correlationSummary(decision),
      last_message_id: message.id,
      last_reason: creationSession?.reason || null,
      opened_at: anchor?.timestamp || activityAt,
      last_activity_at: activityAt,
      expires_at: expiresAt(activityAt, lifetimeMinutes)
    });
  }

  const matchReasons = decision.match?.reasons || ['new_case'];
  const correlationScore = decision.match?.score ?? null;
  attachMessagesToOracleQuoteCase(caseRecord.id, messagesToAttach, {
    roleForMessage: item => roleFor(supplierSenderIds, item),
    correlationScore,
    matchReasons
  });

  const attachedMessages = getOracleQuoteCaseMessages(caseRecord.id);
  const knownFields = mergeQuotationSignals(
    storedFields(caseRecord),
    signalsForMessages(attachedMessages)
  );
  const missingFields = missingQuotationFields(knownFields);
  caseRecord = updateOracleQuoteCase(caseRecord.id, {
    status: caseStatusAfterAttachment(caseRecord, missingFields),
    known_fields_json: knownFields,
    missing_fields_json: missingFields,
    correlation_json: correlationSummary(decision),
    requester_sender_id: caseRecord.requester_sender_id || anchor?.sender_id || null,
    request_message_id: caseRecord.request_message_id || anchor?.id || null,
    last_message_id: message.id,
    last_reason: creationSession?.reason || null,
    last_activity_at: activityAt,
    expires_at: expiresAt(activityAt, lifetimeMinutes)
  });
  return { caseRecord, outcome: decision.outcome, decision };
}

export function buildPersistentQuotationSession({ caseRecord, currentMessageId, supplierSenderIds, settings }) {
  if (!caseRecord) return null;
  const messages = getOracleQuoteCaseMessages(caseRecord.id);
  if (!messages.some(message => message.id === currentMessageId)) return null;
  return buildQuotationSession({
    messages,
    currentMessageId,
    supplierSenderIds,
    windowMinutes: quotationCaseLifetimeMinutes(settings),
    maxMessages: 200
  });
}

export function markQuotationCaseIncomplete(caseId, reason, session = null) {
  if (!caseId) return null;
  const caseRecord = getOracleQuoteCaseById(caseId);
  if (!caseRecord) return null;
  const attachedMessages = getOracleQuoteCaseMessages(caseId);
  const signals = signalsForMessages(attachedMessages);
  const missingFields = missingQuotationFields(signals);
  const preserveReady = ['ready', 'published'].includes(caseRecord.status);
  const changes = {
    status: preserveReady ? caseRecord.status : 'incomplete',
    known_fields_json: signals,
    missing_fields_json: missingFields,
    last_reason: reason
  };
  if (session?.messages?.length) {
    changes.source_message_ids = session.messages.map(message => message.wa_message_id || String(message.id));
  }
  return updateOracleQuoteCase(caseId, changes);
}

export function markQuotationCaseReady(caseId, event, items, sourceMessageIds) {
  if (!caseId) return null;
  const caseRecord = getOracleQuoteCaseById(caseId);
  const itemFields = {
    sizes: [...new Set(items.map(item => item.size))],
    prices: [...new Set(items.map(item => item.price))],
    brands: [...new Set(items.map(item => item.brand))],
    models: [...new Set(items.map(item => item.model))],
    years: [...new Set(items.map(item => item.year_of_manufacture).filter(Boolean))]
  };
  let previousFields = {};
  try {
    previousFields = typeof caseRecord?.known_fields_json === 'string'
      ? JSON.parse(caseRecord.known_fields_json || '{}')
      : caseRecord?.known_fields_json || {};
  } catch {}
  const knownFields = mergeQuotationSignals(previousFields, itemFields);
  return updateOracleQuoteCase(caseId, {
    status: event?.sync_status === 'published' ? 'published' : 'ready',
    known_fields_json: knownFields,
    missing_fields_json: [],
    source_message_ids: sourceMessageIds,
    current_event_id: event?.id || null,
    last_reason: null,
    completed_at: event?.sync_status === 'published' ? new Date().toISOString() : null
  });
}

export function markQuotationCasePublished(caseId, eventId) {
  if (!caseId) return null;
  return updateOracleQuoteCase(caseId, {
    status: 'published',
    current_event_id: eventId,
    last_reason: null,
    completed_at: new Date().toISOString()
  });
}

export function markQuotationCaseDuplicate(caseId, items, sourceMessageIds) {
  if (!caseId) return null;
  const knownFields = {
    sizes: [...new Set(items.map(item => item.size))],
    prices: [...new Set(items.map(item => item.price))],
    brands: [...new Set(items.map(item => item.brand))],
    models: [...new Set(items.map(item => item.model))],
    years: [...new Set(items.map(item => item.year_of_manufacture).filter(Boolean))]
  };
  return updateOracleQuoteCase(caseId, {
    status: 'duplicate',
    known_fields_json: knownFields,
    missing_fields_json: [],
    source_message_ids: sourceMessageIds,
    current_event_id: null,
    last_reason: 'duplicate_quotes',
    completed_at: new Date().toISOString()
  });
}
