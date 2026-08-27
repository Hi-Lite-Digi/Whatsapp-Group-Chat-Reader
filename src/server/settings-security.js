export const MASKED_SECRET = '********';

export const SECRET_SETTING_ENV = Object.freeze({
  openai_api_key: 'OPENAI_API_KEY',
  gemini_api_key: 'GEMINI_API_KEY',
  anthropic_api_key: 'ANTHROPIC_API_KEY'
});

export function apiKeysManagedByEnvironment(env = process.env) {
  return env.ENV_ONLY_API_KEYS === 'true';
}

export function settingsForClient(settings, env = process.env) {
  const result = { ...settings };
  const environmentManaged = apiKeysManagedByEnvironment(env);

  for (const [settingKey, envKey] of Object.entries(SECRET_SETTING_ENV)) {
    const configured = environmentManaged
      ? Boolean(String(env[envKey] || '').trim())
      : Boolean(String(settings[settingKey] || '').trim());
    result[settingKey] = configured ? MASKED_SECRET : '';
  }

  result.api_keys_managed = environmentManaged ? 'environment' : 'database';
  return result;
}

export function settingsUpdateForStorage(settings, env = process.env) {
  const result = {};
  const environmentManaged = apiKeysManagedByEnvironment(env);

  for (const [key, value] of Object.entries(settings || {})) {
    if (key === 'api_keys_managed') continue;
    if (key in SECRET_SETTING_ENV && (environmentManaged || value === MASKED_SECRET)) continue;
    result[key] = value;
  }

  return result;
}

