const NON_CONVERSATIONAL_MESSAGE_TYPES = new Set([
  'messageContextInfo',
  'protocolMessage',
  'senderKeyDistributionMessage'
]);

const MESSAGE_TYPE_PRIORITY = Object.freeze([
  'conversation',
  'extendedTextMessage',
  'imageMessage',
  'documentMessage',
  'audioMessage',
  'videoMessage'
]);

export function isNonConversationalMessageType(messageType) {
  return NON_CONVERSATIONAL_MESSAGE_TYPES.has(String(messageType || ''));
}

export function isConversationalMessageType(messageType) {
  return !isNonConversationalMessageType(messageType);
}

// Baileys may include sender-key metadata beside the actual message body.
// Always prefer a user-visible payload instead of relying on object key order.
export function selectConversationalMessageType(message) {
  if (!message || typeof message !== 'object') return null;
  for (const messageType of MESSAGE_TYPE_PRIORITY) {
    if (message[messageType] != null) return messageType;
  }
  return Object.keys(message).find(isConversationalMessageType) || null;
}

export function messageContentFromEnvelope(message, messageType) {
  if (!message || !messageType) return '';
  if (messageType === 'conversation') return String(message.conversation || '').trim();
  if (messageType === 'extendedTextMessage') {
    return String(message.extendedTextMessage?.text || '').trim();
  }
  if (messageType === 'imageMessage') {
    return String(message.imageMessage?.caption || '[Image Message]').trim();
  }
  if (messageType === 'documentMessage') {
    const document = message.documentMessage || {};
    return String(document.caption || `[Document: ${document.fileName || 'file'}]`).trim();
  }
  if (messageType === 'audioMessage') return '[Audio Message]';
  if (messageType === 'videoMessage') {
    return String(message.videoMessage?.caption || '[Video Message]').trim();
  }
  return `[${messageType}]`;
}
