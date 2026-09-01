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
