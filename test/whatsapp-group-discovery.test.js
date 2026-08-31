import assert from 'node:assert/strict';
import test from 'node:test';

import {
  groupJidFrom,
  groupNameFrom,
  isGroupJid
} from '../src/whatsapp/group-discovery.js';

test('recognizes group JIDs without treating direct or LID chats as groups', () => {
  assert.equal(isGroupJid('120363012345678901@g.us'), true);
  assert.equal(isGroupJid('6589955651@s.whatsapp.net'), false);
  assert.equal(isGroupJid('123456789@lid'), false);
});

test('discovers group JIDs from chat, metadata, and message-shaped values', () => {
  assert.equal(groupJidFrom({ id: 'first@g.us' }), 'first@g.us');
  assert.equal(groupJidFrom({ jid: 'second@g.us' }), 'second@g.us');
  assert.equal(groupJidFrom({ key: { remoteJid: 'third@g.us' } }), 'third@g.us');
  assert.equal(groupJidFrom({ id: 'person@s.whatsapp.net' }), null);
});

test('prefers a group subject and falls back across known chat name fields', () => {
  assert.equal(groupNameFrom({ subject: 'Operations', name: 'Old name' }), 'Operations');
  assert.equal(groupNameFrom({ name: 'Sales' }), 'Sales');
  assert.equal(groupNameFrom({ displayName: 'Support' }), 'Support');
  assert.equal(groupNameFrom({ notify: 'Installers' }), 'Installers');
  assert.equal(groupNameFrom({ subject: '   ' }), '');
});
