const NON_CONVERSATIONAL_MESSAGE_TYPES = new Set([
  'protocolMessage',
  'senderKeyDistributionMessage'
]);

export function isNonConversationalMessageType(messageType) {
  return NON_CONVERSATIONAL_MESSAGE_TYPES.has(String(messageType || ''));
}

export function isConversationalMessageType(messageType) {
  return !isNonConversationalMessageType(messageType);
}
