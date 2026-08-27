import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MASKED_SECRET,
  settingsForClient,
  settingsUpdateForStorage
} from '../src/server/settings-security.js';

test('never returns plaintext API keys to the dashboard', () => {
  const result = settingsForClient({
    llm_provider: 'openai',
    openai_api_key: 'database-secret',
    gemini_api_key: '',
    anthropic_api_key: 'another-secret'
  }, {});

  assert.equal(result.openai_api_key, MASKED_SECRET);
  assert.equal(result.gemini_api_key, '');
  assert.equal(result.anthropic_api_key, MASKED_SECRET);
  assert.equal(JSON.stringify(result).includes('database-secret'), false);
  assert.equal(JSON.stringify(result).includes('another-secret'), false);
});

test('environment-managed API keys are not written to SQLite settings', () => {
  const result = settingsUpdateForStorage({
    llm_provider: 'openai',
    openai_api_key: 'browser-supplied-secret',
    api_keys_managed: 'environment'
  }, { ENV_ONLY_API_KEYS: 'true' });

  assert.deepEqual(result, { llm_provider: 'openai' });
});

test('masked database values are not accidentally saved as real keys', () => {
  const result = settingsUpdateForStorage({
    llm_model: 'gpt-4o-mini',
    openai_api_key: MASKED_SECRET
  }, {});

  assert.deepEqual(result, { llm_model: 'gpt-4o-mini' });
});

