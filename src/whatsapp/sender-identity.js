function phoneJid(value) {
  const jid = String(value || '').trim();
  const match = /^([^@]+?)(?::\d+)?@s\.whatsapp\.net$/.exec(jid);
  return match ? `${match[1]}@s.whatsapp.net` : '';
}

export function senderIdFromMessage(message, selfId = 'self') {
  if (message?.key?.fromMe) return String(selfId || 'self');

  const participant = String(message?.key?.participant || '').trim();
  const participantAlt = String(message?.key?.participantAlt || '').trim();
  return phoneJid(participantAlt)
    || phoneJid(participant)
    || participant
    || participantAlt
    || String(message?.key?.remoteJid || '').trim();
}

export function canonicalPhoneJid(value) {
  return phoneJid(value);
}

export async function resolvedSenderIdFromMessage(message, selfId = 'self', getPhoneForLid = null) {
  const senderId = senderIdFromMessage(message, selfId);
  const canonicalPhone = phoneJid(senderId);
  if (canonicalPhone) return canonicalPhone;
  if (!senderId.endsWith('@lid') || typeof getPhoneForLid !== 'function') return senderId;

  const mappedPhone = phoneJid(await getPhoneForLid(senderId));
  return mappedPhone || senderId;
}
