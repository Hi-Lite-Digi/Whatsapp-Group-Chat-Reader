const NEGATIVE_PATTERN = /\b(?:no|none|don['’]?t\s+have|do\s+not\s+have|no\s+stock|not\s+available|sold\s+out)\b/i;
const BATTERY_PATTERN = /\b(?:battery|batteries|agm|varta|aux\s*\d+|\d{2,3}\s*ah)\b/i;
const RIM_PATTERN = /\b(?:rim|rims|wheel|wheels|pcd|offset|et\s*\d+)\b/i;
const LOGISTICS_PATTERN = /\b(?:deliver|delivery|driver|send\s+(?:to|down)|self\s*collect|collect\s+now|prepare|address|lane|road|building|before\s+\d|tomorrow\s+morning)\b/i;
const ACK_PATTERN = /^(?:ok(?:ay)?|can|thank(?:s|\s+you)?|roger|noted|sure|bro|boss)[\s.!]*$/i;
const NON_TEXT_ACK_PATTERN = /^(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+|\[(?:sticker|stickerMessage|reaction)\])$/iu;
const CONTINUATION_PATTERN = /\b(?:yes|yar|only|left|piece|pieces|pcs?|units?|ready\s+stock|in\s+stock|available|pre-?order|year|model|dot\s*\d{2}|y\s*\d{2}|offer|normal|run\s*flat|runflat|ssr)\b/i;
const READY_STOCK_PATTERN = /\b(?:ready\s*stock|in\s*stock|stock\s+(?:is\s+)?available|available(?:\s+(?:now|stock))?|have\s+stock|got\s+stock|(?:stock|left)\s*[:=]?\s*\d{1,3}\s*(?:pcs?|pieces?|units?))\b/i;
const PREORDER_PATTERN = /\b(?:pre-?order|indent(?:\s+order)?|order\s+basis|lead\s+time)\b/i;

const BRAND_ALIASES = new Map([
  ['co', 'Continental'],
  ['conti', 'Continental'],
  ['continental', 'Continental'],
  ['bs', 'Bridgestone'],
  ['bridgestone', 'Bridgestone'],
  ['good year', 'Goodyear'],
  ['goodyear', 'Goodyear'],
  ['michelin', 'Michelin'],
  ['pirelli', 'Pirelli'],
  ['yokohama', 'Yokohama'],
  ['dunlop', 'Dunlop'],
  ['kumho', 'Kumho'],
  ['rotalla', 'Rotalla']
]);

const MODEL_ALIASES = [
  ['pilot sport 5', ['ps5', 'pilotsport5']],
  ['pilot sport 4', ['ps4', 'pilotsport4']],
  ['pilot sport 4s', ['ps4s', 'pilotsport4s']],
  ['sport contact 7', ['sc7', 'csc7', 'sportcontact7']],
  ['premium contact 7', ['pc7', 'cpc7', 'premiumcontact7']],
  ['eco contact 6q', ['ec6q', 'conti6q', 'ecocontact6q']],
  ['primacy 5', ['p5', 'primacy5']],
  ['potenza re71rs', ['re71rs']],
  ['potenza re005', ['re005']],
  ['pzero pz4', ['pz4', 'pzeropz4']]
];

const MODEL_BRANDS = new Map([
  ['pilot sport 5', 'Michelin'],
  ['pilot sport 4', 'Michelin'],
  ['pilot sport 4s', 'Michelin'],
  ['primacy 5', 'Michelin'],
  ['sport contact 7', 'Continental'],
  ['premium contact 7', 'Continental'],
  ['eco contact 6q', 'Continental'],
  ['potenza re71rs', 'Bridgestone'],
  ['potenza re005', 'Bridgestone'],
  ['pzero pz4', 'Pirelli']
]);

export function normalizeComparable(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compact(value) {
  return normalizeComparable(value).replace(/\s+/g, '');
}

export function canonicalBrand(value) {
  const normalized = normalizeComparable(value);
  return BRAND_ALIASES.get(normalized) || String(value || '').trim();
}

export function canonicalModel(value) {
  const normalized = compact(value);
  const matches = MODEL_ALIASES.flatMap(([name, aliases]) => [name, ...aliases]
    .map(alias => ({ name, alias: compact(alias) })))
    .sort((a, b) => b.alias.length - a.alias.length);
  const match = matches.find(candidate => candidate.alias && normalized.includes(candidate.alias));
  return match?.name || String(value || '').trim();
}

export function normalizeTyreSize(value) {
  const input = String(value || '').toUpperCase().trim();
  const commercial = input.match(/(?:^|\D)(\d{3})[ \t]*[\/-]?[ \t]*R[ \t]*(\d{2})[ \t]*C(?:\D|$)/);
  if (commercial) {
    const width = Number(commercial[1]);
    const rim = Number(commercial[2]);
    if (width >= 125 && width <= 445 && rim >= 10 && rim <= 30) return `${width}R${rim}C`;
  }

  const passenger = input.match(/(?:^|\D)(\d{3})[ \t]*(?:[\/-][ \t]*|[ \t]+)(\d{2})[ \t]*(?:(?:[\/-][ \t]*)?(?:ZR|R)[ \t]*|(?:[\/-][ \t]*|[ \t]+))(\d{2})(?:\D|$)/)
    || input.match(/(?:^|\D)(\d{3})(\d{2})(\d{2})(?:\D|$)/);
  if (!passenger) return null;

  const width = Number(passenger[1]);
  const profile = Number(passenger[2]);
  const rim = Number(passenger[3]);
  if (width < 125 || width > 445 || profile < 20 || profile > 95 || rim < 10 || rim > 30) return null;
  return `${width}/${profile}/${rim}`;
}

export function extractTyreSizes(value) {
  const input = String(value || '');
  const candidates = [];
  const patterns = [
    /\b\d{3}[ \t]*[\/-]?[ \t]*R[ \t]*\d{2}[ \t]*C\b/gi,
    /\b\d{3}[ \t]*(?:[\/-][ \t]*|[ \t]+)\d{2}[ \t]*(?:(?:[\/-][ \t]*)?(?:ZR|R)[ \t]*|(?:[\/-][ \t]*|[ \t]+))\d{2}\b/gi,
    /\b\d{7}\b/g
  ];
  for (const pattern of patterns) {
    for (const match of input.matchAll(pattern)) {
      const size = normalizeTyreSize(match[0]);
      if (size && !candidates.includes(size)) candidates.push(size);
    }
  }
  return candidates;
}

export function hasSupplierPrice(value) {
  return /(?:S\s*\$|SGD|\$)\s*\d+(?:\.\d{1,2})?/i.test(String(value || ''));
}

export function extractSupplierPrices(value) {
  const prices = [];
  for (const match of String(value || '').matchAll(/(?:S\s*\$|SGD|\$)\s*(\d+(?:\.\d{1,2})?)/gi)) {
    const price = Number(match[1]);
    if (Number.isFinite(price) && price > 0 && !prices.includes(price)) prices.push(price);
  }
  return prices;
}

export function extractStockQuantities(value) {
  const quantities = [];
  const text = String(value || '');
  const patterns = [
    /\b(\d{1,3})\s*(?:pcs?|pieces?|units?)\b/gi,
    /\b(?:qty|quantity)\s*[:=x-]?\s*(\d{1,3})\b/gi,
    /\b(?:left|stock)\s*[:=x-]?\s*(\d{1,3})\b/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const quantity = Number(match[1]);
      if (Number.isInteger(quantity) && quantity > 0 && !quantities.includes(quantity)) quantities.push(quantity);
    }
  }
  return quantities;
}

export function extractConfirmedAvailabilities(value) {
  const text = String(value || '');
  const availabilities = [];
  if (!NEGATIVE_PATTERN.test(text) && READY_STOCK_PATTERN.test(text)) availabilities.push('ready_stock');
  if (PREORDER_PATTERN.test(text)) availabilities.push('preorder');
  return availabilities;
}

function normalizedPhrasePresent(value, phrase) {
  const source = normalizeComparable(value);
  const candidate = normalizeComparable(phrase);
  if (!candidate) return false;
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'i').test(source);
}

export function extractKnownBrands(value) {
  const brands = [];
  for (const [alias, brand] of BRAND_ALIASES) {
    if (normalizedPhrasePresent(value, alias) && !brands.includes(brand)) brands.push(brand);
  }
  return brands;
}

export function extractKnownModels(value) {
  const models = [];
  for (const [model, aliases] of MODEL_ALIASES) {
    if ([model, ...aliases].some(alias => normalizedPhrasePresent(value, alias))) models.push(model);
  }
  return models;
}

export function extractQuotationSignals(value) {
  const text = String(value || '');
  const models = extractKnownModels(text);
  const brands = extractKnownBrands(text);
  for (const model of models) {
    const inferredBrand = MODEL_BRANDS.get(model);
    if (inferredBrand && !brands.includes(inferredBrand)) brands.push(inferredBrand);
  }
  const years = [...text.matchAll(/\b(?:20(\d{2})|(?:y|dot)\s*(\d{2}))\b/gi)]
    .map(match => Number(match[1] || match[2]) + 2000)
    .filter(year => year >= 2000 && year <= new Date().getFullYear() + 1)
    .filter((year, index, all) => all.indexOf(year) === index);
  return {
    sizes: extractTyreSizes(text),
    prices: extractSupplierPrices(text),
    brands,
    models,
    years,
    quantities: extractStockQuantities(text),
    availabilities: extractConfirmedAvailabilities(text),
    looksLikeRequest: looksLikeTyreRequest(text),
    meaningfulContinuation: isMeaningfulContinuation(text)
  };
}

export function looksLikeTyreRequest(value) {
  const text = String(value || '');
  if (BATTERY_PATTERN.test(text)) return false;
  return extractTyreSizes(text).length > 0
    || /\b(?:tyre|tyres|tire|tires|michelin|pirelli|bridgestone|continental|conti|dunlop|yokohama|kumho|run\s*flat|runflat|ps\d|re\d|pz\d|cpc\d|ec\d)\b/i.test(text)
      && /\b(?:have|stock|quote|price|looking|want|need|got|available)\b/i.test(text);
}

function isBlockedProduct(value) {
  const text = String(value || '');
  return BATTERY_PATTERN.test(text) || RIM_PATTERN.test(text) && extractTyreSizes(text).length === 0;
}

function isLogisticsOnly(value) {
  const text = String(value || '').trim();
  return !hasSupplierPrice(text)
    && extractTyreSizes(text).length === 0
    && (LOGISTICS_PATTERN.test(text) || ACK_PATTERN.test(text) || NON_TEXT_ACK_PATTERN.test(text));
}

export function isMeaningfulContinuation(value) {
  return CONTINUATION_PATTERN.test(String(value || ''));
}

function timestampMs(message) {
  const parsed = Date.parse(message?.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function messageText(message) {
  return [message?.content, message?.extracted_text].filter(Boolean).join('\n');
}

export function buildQuotationSession({
  messages,
  currentMessageId,
  supplierSenderIds,
  windowMinutes = 15,
  maxMessages = 40
}) {
  const ordered = [...messages]
    .filter(message => message && message.id != null)
    .sort((a, b) => timestampMs(a) - timestampMs(b) || Number(a.id) - Number(b.id));
  const currentIndex = ordered.findIndex(message => message.id === currentMessageId);
  if (currentIndex < 0) return { eligible: false, reason: 'current_message_missing', messages: [] };

  const current = ordered[currentIndex];
  if (!supplierSenderIds.has(current.sender_id)) {
    return { eligible: false, reason: 'requester_message', messages: [current] };
  }

  const cutoff = timestampMs(current) - Math.max(1, windowMinutes) * 60 * 1000;
  const boundedStart = Math.max(0, currentIndex - Math.max(3, maxMessages) + 1);
  let requestAnchor = -1;
  for (let index = currentIndex - 1; index >= boundedStart; index--) {
    const message = ordered[index];
    if (timestampMs(message) < cutoff) break;
    if (!supplierSenderIds.has(message.sender_id) && looksLikeTyreRequest(messageText(message))) {
      requestAnchor = index;
      break;
    }
  }

  let start = requestAnchor >= 0 ? requestAnchor : currentIndex;
  if (requestAnchor < 0 && !hasSupplierPrice(messageText(current))) {
    for (let index = currentIndex - 1; index >= boundedStart; index--) {
      if (timestampMs(ordered[index]) < cutoff) break;
      if (hasSupplierPrice(messageText(ordered[index])) || extractTyreSizes(messageText(ordered[index])).length > 0) {
        start = index;
        break;
      }
    }
  }

  const sessionMessages = ordered.slice(start, currentIndex + 1)
    .filter(message => timestampMs(message) >= cutoff);
  const allText = sessionMessages.map(messageText).join('\n');
  const supplierMessages = sessionMessages.filter(message => supplierSenderIds.has(message.sender_id));
  const supplierText = supplierMessages.map(messageText).join('\n');
  const requesterText = sessionMessages.filter(message => !supplierSenderIds.has(message.sender_id))
    .map(messageText).join('\n');
  const previousRequester = [...sessionMessages].reverse()
    .find(message => !supplierSenderIds.has(message.sender_id));

  let reason = null;
  if (isBlockedProduct(allText) && extractTyreSizes(supplierText).length === 0) reason = 'unsupported_product';
  else if (isLogisticsOnly(messageText(current))) reason = 'logistics_or_acknowledgement';
  else if (!hasSupplierPrice(supplierText)) reason = NEGATIVE_PATTERN.test(supplierText)
    ? 'negative_availability_only'
    : 'no_supplier_price';
  else if (extractTyreSizes(allText).length === 0) reason = 'no_tyre_size';
  else if (
    ACK_PATTERN.test(messageText(current).trim())
    && !/^yes[\s.!]*$/i.test(messageText(current).trim())
    && !isMeaningfulContinuation(messageText(current))
  ) reason = 'acknowledgement_only';
  else if (
    /^yes[\s.!]*$/i.test(messageText(current).trim())
    && !/\b(?:year|20\d{2}|model|which)\b/i.test(messageText(previousRequester))
  ) reason = 'unrelated_confirmation';

  return {
    eligible: !reason,
    reason,
    messages: sessionMessages,
    current,
    requestAnchor: requestAnchor >= 0 ? ordered[requestAnchor] : null,
    evidence: {
      sizes: extractTyreSizes(allText),
      hasSupplierPrice: hasSupplierPrice(supplierText),
      hasNegativeAvailability: NEGATIVE_PATTERN.test(supplierText),
      hasRequesterAnchor: requestAnchor >= 0,
      supplierMessageCount: supplierMessages.length,
      requesterText,
      supplierText
    }
  };
}

export function formatQuotationContext(session, supplierSenderIds) {
  return session.messages.map(message => {
    const role = supplierSenderIds.has(message.sender_id) ? 'SUPPLIER' : 'REQUESTER';
    const marker = message.id === session.current.id ? ' [CURRENT]' : '';
    const text = [message.content, message.extracted_text].filter(Boolean).join('\n');
    return `${message.timestamp}${marker} [${role}] ${message.sender_name || message.sender_id}: ${text}`;
  }).join('\n');
}

function priceSupported(price, supplierText) {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return false;
  const escaped = amount.toFixed(2).replace(/\.00$/, '').replace('.', '\\.');
  return new RegExp(`(?:S\\s*\\$|SGD|\\$)\\s*${escaped}(?:\\b|\\.00\\b)`, 'i').test(supplierText);
}

function modelSupported(model, allText) {
  const source = compact(allText);
  const normalizedModel = compact(model);
  if (normalizedModel && source.includes(normalizedModel)) return true;
  const aliasGroup = MODEL_ALIASES.find(([name, aliases]) => {
    const normalizedName = compact(name);
    return normalizedModel.includes(normalizedName) || aliases.some(alias => normalizedModel.includes(compact(alias)));
  });
  return Boolean(aliasGroup && aliasGroup[1].some(alias => source.includes(compact(alias))));
}

function brandSupported(brand, allText) {
  const source = normalizeComparable(allText);
  const canonical = canonicalBrand(brand);
  const canonicalPattern = normalizeComparable(canonical).replace(/\s+/g, '\\s+');
  if (canonicalPattern && new RegExp(`\\b${canonicalPattern}\\b`, 'i').test(source)) return true;
  for (const [alias, aliasCanonical] of BRAND_ALIASES) {
    const aliasPattern = normalizeComparable(alias).replace(/\s+/g, '\\s+');
    if (aliasCanonical === canonical && new RegExp(`\\b${aliasPattern}\\b`, 'i').test(source)) return true;
  }
  for (const [model, modelBrand] of MODEL_BRANDS) {
    if (modelBrand !== canonical) continue;
    const aliases = MODEL_ALIASES.find(([name]) => name === model)?.[1] || [];
    if ([model, ...aliases].some(value => compact(allText).includes(compact(value)))) return true;
  }
  return false;
}

function quantitySupported(quantity, supplierText) {
  const expected = Number(quantity);
  return Number.isInteger(expected) && expected > 0 && extractStockQuantities(supplierText).includes(expected);
}

function availabilitySupported(availability, supplierText) {
  if (!availability || availability === 'unknown') return true;
  return extractConfirmedAvailabilities(supplierText).includes(availability);
}

export function quotationItemHasEvidence(item, session) {
  const supplierText = session.evidence.supplierText;
  const allText = session.messages.map(messageText).join('\n');
  const size = normalizeTyreSize(item?.size);
  const supplierSizes = extractTyreSizes(supplierText);
  const supportedSizes = supplierSizes.length > 0 ? supplierSizes : session.evidence.sizes;
  if (!size || !supportedSizes.includes(size)) return false;
  if (!priceSupported(item?.price, supplierText)) return false;
  if (item?.stock_quantity != null && !quantitySupported(item.stock_quantity, supplierText)) return false;
  if (!availabilitySupported(item?.availability, supplierText)) return false;

  return brandSupported(item?.brand, allText) && modelSupported(item?.model, allText);
}

export function sourceMessageIds(session) {
  return session.messages.map(message => message.wa_message_id || String(message.id));
}
