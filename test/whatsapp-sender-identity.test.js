import assert from 'node:assert/strict';
import test from 'node:test';

import { senderIdFromMessage } from '../src/whatsapp/sender-identity.js';

test('prefers the phone JID when WhatsApp also supplies a privacy LID', () => {
  assert.equal(senderIdFromMessage({
    key: {
      participant: '53060227322097@lid',
      participantAlt: '6587540420@s.whatsapp.net',
      remoteJid: '120363000000000000@g.us'
    }
  }), '6587540420@s.whatsapp.net');
});

test('keeps a LID when no phone JID is available', () => {
  assert.equal(senderIdFromMessage({
    key: {
      participant: '53060227322097@lid',
      remoteJid: '120363000000000000@g.us'
    }
  }), '53060227322097@lid');
});

test('uses the connected account identity for outgoing messages', () => {
  assert.equal(senderIdFromMessage({ key: { fromMe: true } }, '6589955651@s.whatsapp.net'), '6589955651@s.whatsapp.net');
});
