export function isGroupJid(value) {
  return typeof value === 'string' && value.endsWith('@g.us');
}

export function groupJidFrom(value) {
  if (isGroupJid(value)) return value;

  const candidates = [
    value?.id,
    value?.jid,
    value?.key?.remoteJid,
    value?.key?.remoteJidAlt,
    value?.remoteJid
  ];
  return candidates.find(isGroupJid) || null;
}

export function groupNameFrom(value) {
  if (!value || typeof value === 'string') return '';

  const candidates = [
    value.subject,
    value.name,
    value.displayName,
    value.notify
  ];
  return candidates.find(candidate => typeof candidate === 'string' && candidate.trim())?.trim() || '';
}
