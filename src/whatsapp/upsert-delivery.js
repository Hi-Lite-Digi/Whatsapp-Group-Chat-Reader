const DEFAULT_CATCHUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export function messageTimestampMs(message) {
  const rawTimestamp = message?.messageTimestamp;
  if (rawTimestamp == null) return null;

  const seconds = Number(
    typeof rawTimestamp?.toNumber === 'function'
      ? rawTimestamp.toNumber()
      : rawTimestamp
  );
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds * 1000;
}

export function classifyUpsertMessage(type, message, options = {}) {
  if (type === 'notify') {
    return { source: 'realtime', activeDelivery: true };
  }

  const nowMs = Number(options.nowMs) || Date.now();
  const catchupWindowMs = Math.max(
    60_000,
    Number(options.catchupWindowMs) || DEFAULT_CATCHUP_WINDOW_MS
  );
  const timestampMs = messageTimestampMs(message);
  const ageMs = timestampMs == null ? null : nowMs - timestampMs;

  if (
    type === 'append'
    && ageMs != null
    && ageMs >= -5 * 60_000
    && ageMs <= catchupWindowMs
  ) {
    return { source: 'catchup', activeDelivery: true };
  }

  return { source: 'history', activeDelivery: false };
}

export function isActiveDeliverySource(source) {
  return source === 'realtime' || source === 'catchup';
}

function isDirectJid(value) {
  return typeof value === 'string'
    && (value.endsWith('@s.whatsapp.net') || value.endsWith('@lid'));
}

function isGroupJid(value) {
  return typeof value === 'string' && value.endsWith('@g.us');
}

export function messageChatJid(message) {
  const candidates = [
    message?.key?.remoteJid,
    message?.key?.remoteJidAlt,
    message?.remoteJid,
    message?.jid,
    message?.chatId
  ];

  // Prefer a group identifier when an event contains both a canonical group
  // JID and an alternate direct-addressing JID.
  return candidates.find(isGroupJid)
    || candidates.find(isDirectJid)
    || null;
}

export function safeChatReference(jid) {
  if (typeof jid !== 'string' || !jid) return 'unknown';
  if (jid.endsWith('@g.us')) return jid;
  const server = jid.split('@')[1];
  return server ? `redacted@${server}` : 'unsupported';
}
