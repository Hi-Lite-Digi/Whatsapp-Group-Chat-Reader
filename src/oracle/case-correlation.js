import {
  extractAvailabilityEvidence,
  extractQuotationSignals,
  normalizeComparable
} from './quotation.js';

export const REQUIRED_QUOTATION_FIELDS = Object.freeze([
  'brand',
  'model',
  'size',
  'price',
  'quantity',
  'confirmed_availability'
]);

const SIGNAL_KEY_BY_FIELD = Object.freeze({
  brand: 'brands',
  model: 'models',
  size: 'sizes',
  price: 'prices',
  quantity: 'quantities',
  confirmed_availability: 'availabilities'
});

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function unique(values, normalizer = value => String(value)) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const key = normalizer(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

export function messageText(message) {
  return [message?.content, message?.extracted_text].filter(Boolean).join('\n');
}

export function mergeQuotationSignals(...signals) {
  return {
    sizes: unique(signals.flatMap(item => item?.sizes || [])),
    prices: unique(signals.flatMap(item => item?.prices || []), value => Number(value).toFixed(2)),
    brands: unique(signals.flatMap(item => item?.brands || []), normalizeComparable),
    models: unique(signals.flatMap(item => item?.models || []), normalizeComparable),
    years: unique(signals.flatMap(item => item?.years || []), value => String(value)),
    quantities: unique(signals.flatMap(item => item?.quantities || []), value => String(value)),
    availabilities: unique(signals.flatMap(item => item?.availabilities || []), normalizeComparable),
    availability_evidence: unique(signals.flatMap(item => item?.availability_evidence || []), normalizeComparable),
    looksLikeRequest: signals.some(item => item?.looksLikeRequest === true),
    meaningfulContinuation: signals.some(item => item?.meaningfulContinuation === true)
  };
}

export function signalsForMessages(messages, supplierSenderIds = null) {
  const eligibleSupplierMessages = [];
  const merged = mergeQuotationSignals(...(messages || []).map(message => {
    const signals = extractQuotationSignals(messageText(message));
    const supplierRoleKnown = message?.role != null || supplierSenderIds instanceof Set;
    const isSupplier = message?.role === 'supplier'
      || supplierSenderIds instanceof Set && supplierSenderIds.has(message?.sender_id);
    if (supplierRoleKnown && !isSupplier) {
      return { ...signals, quantities: [], availabilities: [], availability_evidence: [] };
    }
    eligibleSupplierMessages.push(message);
    return signals;
  }));
  const combinedSupplierEvidence = extractAvailabilityEvidence(
    eligibleSupplierMessages.map(messageText).join('\n')
  );
  return mergeQuotationSignals(merged, {
    availabilities: combinedSupplierEvidence.availabilities,
    availability_evidence: combinedSupplierEvidence.evidence
  });
}

export function missingQuotationFields(signals) {
  const safe = signals || {};
  return REQUIRED_QUOTATION_FIELDS.filter(field => {
    const key = SIGNAL_KEY_BY_FIELD[field];
    if (field === 'confirmed_availability') return !safe[key]?.includes('ready_stock');
    return !Array.isArray(safe[key]) || safe[key].length === 0;
  });
}

function overlap(left, right, normalizer = normalizeComparable) {
  const rightKeys = new Set((right || []).map(normalizer).filter(Boolean));
  return (left || []).some(value => rightKeys.has(normalizer(value)));
}

function conflicts(left, right, normalizer = normalizeComparable) {
  return (left || []).length > 0 && (right || []).length > 0 && !overlap(left, right, normalizer);
}

function minutesBetween(older, newer) {
  const start = Date.parse(older);
  const end = Date.parse(newer);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Infinity;
  return Math.max(0, (end - start) / 60000);
}

export function scoreQuotationCase({ caseRecord, currentMessage, requestAnchor = null, uniqueCandidate = false }) {
  const known = parseJson(caseRecord?.known_fields_json, {});
  const missing = new Set(parseJson(caseRecord?.missing_fields_json, []));
  const sources = new Set(parseJson(caseRecord?.source_message_ids, []));
  const currentSignals = extractQuotationSignals(messageText(currentMessage));
  const reasons = [];
  const conflictReasons = [];
  let score = 0;

  const replyTarget = String(currentMessage?.reply_to_wa_message_id || '').trim();
  if (replyTarget && sources.has(replyTarget)) {
    score += 120;
    reasons.push('direct_reply');
  }

  if (requestAnchor?.id != null && Number(caseRecord?.request_message_id) === Number(requestAnchor.id)) {
    score += 110;
    reasons.push('same_request_anchor');
  } else if (requestAnchor?.id != null && caseRecord?.request_message_id != null) {
    score -= 70;
    conflictReasons.push('different_request_anchor');
  }

  if (requestAnchor?.sender_id && caseRecord?.requester_sender_id === requestAnchor.sender_id) {
    score += 18;
    reasons.push('same_requester');
  }

  const dimensions = [
    ['sizes', 45, 60, value => String(value)],
    ['brands', 25, 35, normalizeComparable],
    ['models', 35, 45, normalizeComparable]
  ];
  for (const [key, matchScore, conflictScore, normalizer] of dimensions) {
    if (overlap(currentSignals[key], known[key], normalizer)) {
      score += matchScore;
      reasons.push(`matching_${key}`);
    } else if (conflicts(currentSignals[key], known[key], normalizer)) {
      score -= conflictScore;
      conflictReasons.push(`conflicting_${key}`);
    }
  }

  if (overlap(currentSignals.prices, known.prices, value => Number(value).toFixed(2))) {
    score += 10;
    reasons.push('matching_price');
  } else if (currentSignals.prices.length > 0 && (known.prices || []).length > 0) {
    score += 15;
    reasons.push('possible_price_correction');
  }
  if (overlap(currentSignals.years, known.years, value => String(value))) {
    score += 6;
    reasons.push('matching_year');
  } else if (currentSignals.years.length > 0 && (known.years || []).length > 0) {
    score += 15;
    reasons.push('possible_year_correction');
  }

  for (const field of REQUIRED_QUOTATION_FIELDS) {
    const rawValues = currentSignals[SIGNAL_KEY_BY_FIELD[field]] || [];
    const values = field === 'confirmed_availability'
      ? rawValues.filter(value => value === 'ready_stock')
      : rawValues;
    if (missing.has(field) && values.length > 0) {
      score += 18;
      reasons.push(`fills_missing_${field}`);
    }
  }

  if (currentSignals.meaningfulContinuation) {
    score += 8;
    reasons.push('meaningful_continuation');
  }

  const ageMinutes = minutesBetween(caseRecord?.last_activity_at, currentMessage?.timestamp);
  if (ageMinutes <= 15) {
    score += 12;
    reasons.push('recent_15m');
  } else if (Date.parse(currentMessage?.timestamp) <= Date.parse(caseRecord?.expires_at)) {
    score += 5;
    reasons.push('recent_case_lifetime');
  }

  if (uniqueCandidate && conflictReasons.length === 0) {
    score += 8;
    reasons.push('only_open_case');
  }

  return {
    caseRecord,
    score,
    reasons,
    conflicts: conflictReasons,
    direct: reasons.includes('direct_reply') || reasons.includes('same_request_anchor'),
    currentSignals
  };
}

export function chooseQuotationCase({ cases, currentMessage, requestAnchor = null, minimumScore = 28, ambiguityMargin = 12 }) {
  const candidates = (cases || []).map(caseRecord => scoreQuotationCase({
    caseRecord,
    currentMessage,
    requestAnchor,
    uniqueCandidate: cases.length === 1
  })).sort((left, right) => right.score - left.score);

  const top = candidates[0];
  if (!top) return { outcome: 'new', candidates: [] };
  if (top.direct) return { outcome: 'matched', match: top, candidates };

  if (top.score >= minimumScore) {
    const second = candidates[1];
    if (second && second.score >= minimumScore && top.score - second.score < ambiguityMargin) {
      return { outcome: 'ambiguous', candidates: candidates.slice(0, 3) };
    }
    return { outcome: 'matched', match: top, candidates };
  }

  const hasCorrelationSignal = top.currentSignals.meaningfulContinuation
    || ['sizes', 'prices', 'brands', 'models', 'quantities', 'availabilities']
      .some(key => top.currentSignals[key]?.length > 0);
  if (candidates.length > 1 && top.score >= 15 && hasCorrelationSignal && top.conflicts.length === 0) {
    return { outcome: 'ambiguous', candidates: candidates.slice(0, 3) };
  }
  return { outcome: 'new', candidates };
}
