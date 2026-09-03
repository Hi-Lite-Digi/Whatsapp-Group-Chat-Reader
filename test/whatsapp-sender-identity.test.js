import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalPhoneJid,
  resolvedSenderIdFromMessage,
  senderIdFromMessage
} from '../src/whatsapp/sender-identity.js';

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

test('resolves a history-only LID through the Baileys phone mapping', async () => {
  const senderId = await resolvedSenderIdFromMessage({
    key: {
      participant: '53060227322097@lid',
      remoteJid: '120363000000000000@g.us'
    }
  }, 'self', async lid => {
    assert.equal(lid, '53060227322097@lid');
    return '6587540420:17@s.whatsapp.net';
  });

  assert.equal(senderId, '6587540420@s.whatsapp.net');
});

test('keeps the LID when Baileys has no reverse mapping yet', async () => {
  assert.equal(await resolvedSenderIdFromMessage({
    key: { participant: '53060227322097@lid' }
  }, 'self', async () => null), '53060227322097@lid');
});

test('normalizes device-specific phone JIDs for supplier matching', () => {
  assert.equal(canonicalPhoneJid('6587540420:17@s.whatsapp.net'), '6587540420@s.whatsapp.net');
});
