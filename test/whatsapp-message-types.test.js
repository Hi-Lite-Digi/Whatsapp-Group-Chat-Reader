import assert from 'node:assert/strict';
import test from 'node:test';

import {
  messageContentFromEnvelope,
  selectConversationalMessageType
} from '../src/whatsapp/message-types.js';

test('prefers real text when WhatsApp sender-key metadata shares the envelope', () => {
  const envelope = {
    senderKeyDistributionMessage: { groupId: 'quotes@g.us' },
    conversation: '195/50/16 Bridgestone RE005 $100',
    messageContextInfo: { messageSecret: 'redacted' }
  };

  const messageType = selectConversationalMessageType(envelope);
  assert.equal(messageType, 'conversation');
  assert.equal(
    messageContentFromEnvelope(envelope, messageType),
    '195/50/16 Bridgestone RE005 $100'
  );
});

test('does not expose a protocol-only envelope as a chat message', () => {
  assert.equal(selectConversationalMessageType({
    senderKeyDistributionMessage: { groupId: 'quotes@g.us' },
    messageContextInfo: { messageSecret: 'redacted' }
  }), null);
});
