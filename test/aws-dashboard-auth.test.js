import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const template = fs.readFileSync(
  new URL('../deploy/aws/hilite-dedicated-stack.yaml', import.meta.url),
  'utf8'
);

test('dashboard authentication supports uninterrupted multi-day polling', () => {
  assert.match(template, /RefreshTokenValidity:\s+30/);
  assert.match(template, /RefreshToken:\s+days/);
  assert.match(template, /SessionTimeout:\s+604800/);
});
