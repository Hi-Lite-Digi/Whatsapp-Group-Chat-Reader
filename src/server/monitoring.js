import crypto from 'crypto';

export function monitorAuthorized(authorization, expectedToken = process.env.MONITOR_TOKEN) {
  const expected = String(expectedToken || '');
  const match = String(authorization || '').match(/^Bearer\s+(\S+)$/i);
  const provided = match?.[1] || '';
  if (!expected || !provided) return false;

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

export function summarizeQueue(cases) {
  const pendingStatuses = new Set(['collecting', 'incomplete', 'ambiguous']);
  return {
    queueDepth: cases.filter(item => pendingStatuses.has(item.status)).length,
    totalCases: cases.length
  };
}
