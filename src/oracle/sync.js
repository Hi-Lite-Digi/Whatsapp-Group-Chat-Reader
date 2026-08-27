import crypto from 'crypto';

import {
  createOracleQuoteRun,
  createOracleSyncEvent,
  getGroupMessagesEndingAt,
  getOracleSyncEventById,
  getSettings,
  updateOracleQuoteRun,
  updateOracleSyncEvent
} from '../db/database.js';
import { processMessageWithLLM } from '../llm/service.js';
import {
  getOracleApiPriceHistory,
  getOracleSuppliers,
  publishOraclePrices,
  searchOracleNewTyres
} from './client.js';
import {
  buildQuotationSession,
  canonicalBrand,
  canonicalModel,
  formatQuotationContext,
  normalizeTyreSize,
  quotationItemHasEvidence,
  sourceMessageIds
} from './quotation.js';

export { normalizeTyreSize } from './quotation.js';

export const QUOTE_SCHEMA = {
  id: 'oracle_supplier_quotes',
  name: 'Oracle Supplier Tyre Quotations',
  instruction_prompt: `Extract only definite NEW-TYRE supplier quotations from this bounded WhatsApp quotation session.
Each line labels the sender as SUPPLIER or REQUESTER. Only supplier replies can create quotation items.
Messages may be informal, abbreviated, multilingual, or split across a short back-and-forth. Combine nearby fragments when the current supplier message completes or corrects the quotation.
Set current_message_completes_quotation to true only when [CURRENT] adds the final missing fact, confirms a fact requested immediately before it, supplies a complete quotation, or corrects the newest quotation.
Return an empty items array when the current message does not complete a quotation, stock is unavailable, the discussion is only a request/question, or the product is a battery, rim, service, delivery arrangement, or anything other than a new tyre.
Never infer a price, brand, model, tyre size, or availability that was not supplied. A bare price can be joined only to the active tyre request in the same short conversation.
Handle multiple tyre-size sections in one supplier message. Associate each model and price with the closest preceding size heading.
Normalize passenger sizes to WIDTH/PROFILE/RIM, for example 225/45/17. Preserve commercial formats such as 195R15C.
Treat Y25 and dot25 as 2025, and Y26 and dot26 as 2026.
Price must be the supplier's per-piece quoted price. A quantity such as 2pcs describes availability, not a multiplier.
An alternative offered after saying the requested model is unavailable is a valid quotation for the alternative only.
Set stock_quantity only when a supplier explicitly states a quantity such as "left 1pc" or "4pcs". Otherwise return null.
Set availability to ready_stock, preorder, or unknown using only explicit supplier wording.
Set match_type to exact when the item answers the requested model, alternative when offered instead of an unavailable request, or unsolicited for a supplier stock broadcast without a requester anchor.
The current message is marked [CURRENT]. Prefer corrections and confirmations in the newest messages over older context.
Confidence must be between 0 and 1. Use less than 0.85 when any required field remains ambiguous.`,
  json_schema: JSON.stringify({
    is_supplier_quotation: 'boolean',
    current_message_completes_quotation: 'boolean',
    items: [{
      brand: 'string',
      model: 'string',
      size: 'string formatted WIDTH/PROFILE/RIM',
      price: 'number, per piece',
      year_of_manufacture: 'four-digit number or null',
      country_of_origin: 'string or null',
      is_commercial: 'boolean or false',
      stock_quantity: 'integer or null',
      availability: 'ready_stock | preorder | unknown',
      match_type: 'exact | alternative | unsolicited',
      quoted_at: 'YYYY-MM-DD or null',
      confidence: 'number from 0 to 1'
    }],
    notes: 'string or null'
  }, null, 2)
};

const QUOTE_IMAGE_OCR_SCHEMA = {
  id: 'oracle_supplier_quote_image_ocr',
  name: 'Supplier Quotation Image Transcription',
  instruction_prompt: `Transcribe only text that is visibly present in the supplier image.
Preserve tyre sizes, brands, models, dollar prices, quantities, years/date codes, origin, and availability wording exactly.
Do not identify a tyre from its appearance and do not add, correct, or infer any value that is not readable.
Keep line breaks where they separate products. If no relevant readable text is visible, return an empty string.`,
  json_schema: JSON.stringify({ visible_text: 'string' }, null, 2)
};

export async function extractQuotationImageText({ media, senderInfo }) {
  if (!media?.mimetype?.startsWith('image/') || !media.base64) return '';
  const result = await processMessageWithLLM({
    content: '[Supplier quotation image]',
    media,
    schema: QUOTE_IMAGE_OCR_SCHEMA,
    senderInfo
  });
  if (result.status !== 'success') return '';
  return String(result.extractedData?.visible_text || '').trim();
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isoDate(value, fallback) {
  const candidate = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  return fallback.slice(0, 10);
}

function normalizeYear(value) {
  const year = Number(value);
  const currentYear = new Date().getFullYear();
  return Number.isInteger(year) && year >= 2000 && year <= currentYear + 1 ? year : null;
}

function normalizeQuoteItem(item, fallbackDate) {
  const brand = canonicalBrand(item?.brand);
  const model = String(item?.model || '').trim();
  const size = normalizeTyreSize(item?.size);
  const price = Number(item?.price);
  const confidence = Number(item?.confidence);

  if (!brand || !model || !size || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(confidence) || confidence < 0.85) return null;

  const stockQuantity = Number(item?.stock_quantity);
  const availability = ['ready_stock', 'preorder', 'unknown'].includes(item?.availability)
    ? item.availability
    : 'unknown';
  const matchType = ['exact', 'alternative', 'unsolicited'].includes(item?.match_type)
    ? item.match_type
    : 'exact';

  return {
    brand,
    model,
    size,
    price: Math.round(price * 100) / 100,
    year_of_manufacture: normalizeYear(item?.year_of_manufacture),
    country_of_origin: String(item?.country_of_origin || '').trim() || null,
    is_commercial: item?.is_commercial === true,
    stock_quantity: Number.isInteger(stockQuantity) && stockQuantity > 0 ? stockQuantity : null,
    availability,
    match_type: matchType,
    quoted_at: isoDate(item?.quoted_at, fallbackDate),
    confidence: Math.min(confidence, 1)
  };
}

function payloadHash(supplierCode, item) {
  const stable = [
    supplierCode,
    normalizeText(item.brand),
    normalizeText(item.model),
    item.size,
    item.price.toFixed(2),
    item.year_of_manufacture || '',
    normalizeText(item.country_of_origin),
    item.quoted_at
  ].join('|');
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function exactListing(rows, item) {
  const brand = normalizeText(item.brand);
  const model = normalizeText(canonicalModel(item.model));
  return rows.find(row =>
    normalizeTyreSize(row.size) === item.size &&
    normalizeText(row.brand) === brand &&
    normalizeText(canonicalModel(row.model)) === model
  ) || null;
}

export function supplierSenderIdsForGroup(group) {
  return new Set(String(group?.oracle_supplier_sender_ids || '')
    .split(/[\s,]+/)
    .map(value => value.trim())
    .filter(Boolean));
}

export function isConfiguredSupplierMessage(message, group) {
  return supplierSenderIdsForGroup(group).has(String(message?.sender_id || '').trim());
}

export function contextForGroup(groupId, currentMessageId, limit, windowMinutes, supplierSenderIds) {
  const messages = getGroupMessagesEndingAt(groupId, currentMessageId, limit).reverse();
  const session = buildQuotationSession({
    messages,
    currentMessageId,
    supplierSenderIds,
    windowMinutes,
    maxMessages: limit
  });
  return session.eligible ? formatQuotationContext(session, supplierSenderIds) : '';
}

async function classifyListing(item) {
  // Search by normalized size, then match brand/model locally. Supplier model
  // strings often include XL, homologation, load, origin, or date-code suffixes.
  const rows = await searchOracleNewTyres(item.size);
  const match = exactListing(rows, item);
  return {
    listingStatus: match ? (Number(match.qty) > 0 ? 'existing_with_stock' : 'existing_no_stock') : 'new_listing',
    existingMatch: match
  };
}

function oraclePayload(item) {
  return {
    brand: item.brand,
    model: item.model,
    size: item.size,
    price: item.price,
    ...(item.year_of_manufacture ? { year_of_manufacture: item.year_of_manufacture } : {}),
    ...(item.country_of_origin ? { country_of_origin: item.country_of_origin } : {}),
    is_commercial: item.is_commercial,
    quoted_at: item.quoted_at
  };
}

async function publishEvent(event) {
  const payload = JSON.parse(event.request_payload);
  const response = await publishOraclePrices(event.supplier_code, [payload]);
  const oraclePriceId = Array.isArray(response?.ids) ? response.ids[0] : null;
  if (!oraclePriceId) throw new Error('Oracle accepted the request but did not return a price record ID.');

  let verifiedRecord = null;
  for (let attempt = 0; attempt < 3 && !verifiedRecord; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 500));
    const history = await getOracleApiPriceHistory(1000);
    verifiedRecord = history.find(record => record.id === oraclePriceId) || null;
  }
  if (!verifiedRecord) throw new Error('Oracle returned an ID, but the new price could not be verified in API history.');

  updateOracleSyncEvent(event.id, {
    sync_status: 'published',
    oracle_price_id: oraclePriceId,
    response_json: JSON.stringify({ publish: response, verified: verifiedRecord }),
    error_message: null
  });
  return getOracleSyncEventById(event.id);
}

export async function publishOracleSyncEvent(id) {
  const event = getOracleSyncEventById(id);
  if (!event) throw new Error('Quotation sync record not found.');
  if (event.sync_status === 'published') return event;
  if (event.sync_status !== 'ready' && event.sync_status !== 'failed') {
    throw new Error(`Quotation cannot be published from status ${event.sync_status}.`);
  }
  try {
    return await publishEvent(event);
  } catch (error) {
    updateOracleSyncEvent(event.id, { sync_status: 'failed', error_message: error.message });
    throw error;
  }
}

export async function processOracleGroupMessage({ message, group }) {
  if (group.oracle_sync_enabled !== 1 || !group.oracle_supplier_code) return null;
  const supplierSenderIds = supplierSenderIdsForGroup(group);
  if (supplierSenderIds.size === 0) {
    return { events: [], error: 'No supplier sender IDs are configured for this group.' };
  }
  if (!supplierSenderIds.has(message.sender_id)) {
    return { events: [], skipped: 'requester_message' };
  }

  const settings = getSettings();
  const contextLimit = Math.max(3, Math.min(Number(settings.oracle_context_messages) || 30, 50));
  const contextMinutes = Math.max(1, Math.min(Number(settings.oracle_context_minutes) || 15, 1440));
  const messages = getGroupMessagesEndingAt(group.id, message.id, contextLimit).reverse();
  const session = buildQuotationSession({
    messages,
    currentMessageId: message.id,
    supplierSenderIds,
    windowMinutes: contextMinutes,
    maxMessages: contextLimit
  });
  const messageIds = sourceMessageIds(session);
  const run = createOracleQuoteRun({
    group_id: group.id,
    trigger_message_id: message.id,
    status: session.eligible ? 'processing' : 'skipped',
    reason: session.reason,
    source_message_ids: messageIds
  });
  if (!session.eligible) {
    return { events: [], skipped: session.reason, run };
  }

  try {
    const context = formatQuotationContext(session, supplierSenderIds);
    const extraction = await processMessageWithLLM({
    content: context,
    schema: QUOTE_SCHEMA,
    senderInfo: {
      name: message.sender_name,
      id: message.sender_id,
      groupName: group.name
    }
  });

    if (extraction.status !== 'success') {
    const error = extraction.error || 'Quotation extraction failed.';
    const updatedRun = updateOracleQuoteRun(run.id, {
      status: 'failed',
      reason: 'llm_failure',
      extraction_json: extraction,
      error_message: error
    });
    return { extraction, events: [], error, run: updatedRun };
    }
    if (extraction.extractedData?.current_message_completes_quotation !== true) {
    const updatedRun = updateOracleQuoteRun(run.id, {
      status: 'skipped',
      reason: 'incomplete_or_irrelevant',
      extraction_json: extraction.extractedData
    });
    return { extraction, events: [], skipped: 'incomplete_or_irrelevant', run: updatedRun };
    }

    const supplierCode = String(group.oracle_supplier_code).trim().toUpperCase();
    const suppliers = await getOracleSuppliers();
    const supplier = suppliers.find(item => String(item.code).toUpperCase() === supplierCode);
    if (!supplier) {
    const error = `Oracle supplier ${supplierCode} is not valid.`;
    const updatedRun = updateOracleQuoteRun(run.id, {
      status: 'failed',
      reason: 'invalid_supplier_mapping',
      extraction_json: extraction.extractedData,
      error_message: error
    });
    return { extraction, events: [], error, run: updatedRun };
    }

    const rawItems = Array.isArray(extraction.extractedData?.items) ? extraction.extractedData.items : [];
    const fallbackDate = message.timestamp || new Date().toISOString();
    const normalizedItems = rawItems.map(item => normalizeQuoteItem(item, fallbackDate)).filter(Boolean);
    const items = [];
    const itemKeys = new Set();
    for (const item of normalizedItems) {
      if (!quotationItemHasEvidence(item, session)) continue;
      const key = `${normalizeText(item.brand)}|${normalizeText(item.model)}|${item.size}|${item.price.toFixed(2)}`;
      if (!itemKeys.has(key)) {
        itemKeys.add(key);
        items.push(item);
      }
    }
    if (items.length === 0) {
    const updatedRun = updateOracleQuoteRun(run.id, {
      status: 'skipped',
      reason: rawItems.length > 0 ? 'failed_evidence_validation' : 'no_quote_items',
      extraction_json: extraction.extractedData
    });
    return {
      extraction,
      events: [],
      skipped: rawItems.length > 0 ? 'failed_evidence_validation' : 'no_quote_items',
      run: updatedRun
    };
    }
    const events = [];

    for (const item of items) {
    const { listingStatus } = await classifyListing(item);
    const payload = oraclePayload(item);
    const event = createOracleSyncEvent({
      message_id: message.id,
      group_id: group.id,
      supplier_code: supplierCode,
      supplier_name: supplier.name,
      payload_hash: payloadHash(supplierCode, item),
      listing_status: listingStatus,
      sync_status: 'ready',
      brand: item.brand,
      model: item.model,
      size: item.size,
      price: item.price,
      year_of_manufacture: item.year_of_manufacture,
      country_of_origin: item.country_of_origin,
      quoted_at: item.quoted_at,
      confidence: item.confidence,
      stock_quantity: item.stock_quantity,
      availability: item.availability,
      match_type: item.match_type,
      source_message_ids: messageIds,
      request_payload: JSON.stringify(payload)
    });

    if (!event) continue;
    if (settings.oracle_auto_publish === 'true') {
      try {
        events.push(await publishEvent(event));
      } catch (error) {
        updateOracleSyncEvent(event.id, { sync_status: 'failed', error_message: error.message });
        events.push(getOracleSyncEventById(event.id));
      }
    } else {
      events.push(event);
    }
    }

    const updatedRun = updateOracleQuoteRun(run.id, {
      status: events.length > 0 ? 'completed' : 'skipped',
      reason: events.length > 0 ? null : 'duplicate_quotes',
      source_message_ids: messageIds,
      extraction_json: extraction.extractedData,
      event_count: events.length
    });
    return { extraction, events, supplier, run: updatedRun };
  } catch (error) {
    const updatedRun = updateOracleQuoteRun(run.id, {
      status: 'failed',
      reason: 'pipeline_error',
      error_message: error.message
    });
    return { events: [], error: error.message, run: updatedRun };
  }
}
