function phoneJid(value) {
  const jid = String(value || '').trim();
  return jid.endsWith('@s.whatsapp.net') ? jid : '';
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
