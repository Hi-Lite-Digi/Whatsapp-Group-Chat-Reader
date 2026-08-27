const DEFAULT_BASE_URL = 'https://tyre-pricing.onrender.com';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_READ_ATTEMPTS = 3;

function config() {
  return {
    baseUrl: String(process.env.ORACLE_PRICING_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: String(process.env.ORACLE_API_TOKEN || '').trim()
  };
}

export function getOracleConfiguration() {
  const { baseUrl, apiKey } = config();
  return { baseUrl, configured: Boolean(baseUrl && apiKey) };
}

async function oracleRequest(pathname, options = {}) {
  const { baseUrl, apiKey } = config();
  if (!apiKey) throw new Error('Oracle API key is not configured.');

  const method = String(options.method || 'GET').toUpperCase();
  const maxAttempts = method === 'GET' ? MAX_READ_ATTEMPTS : 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/api/v1/mrr/${pathname.replace(/^\//, '')}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers || {})
        }
      });

      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { raw: text };
      }

      if (response.ok) return payload;

      const detail = payload?.error || payload?.message || `HTTP ${response.status}`;
      const retryable = method === 'GET' && (response.status === 429 || response.status >= 500);
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`Oracle request failed: ${detail}`);
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 10000)
        : 300 * 2 ** (attempt - 1);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    } catch (error) {
      lastError = error?.name === 'AbortError' ? new Error('Oracle request timed out.') : error;
      if (attempt === maxAttempts) throw lastError;
      await new Promise(resolve => setTimeout(resolve, 300 * 2 ** (attempt - 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('Oracle request failed.');
}

export async function pingOracle() {
  return oracleRequest('ping');
}

export async function getOracleSuppliers() {
  const suppliers = await oracleRequest('suppliers');
  return Array.isArray(suppliers) ? suppliers : [];
}

export async function searchOracleNewTyres(query, supplierId = '') {
  const params = new URLSearchParams({ q: query });
  if (supplierId) params.set('supplier_id', supplierId);
  const rows = await oracleRequest(`new-tyres?${params.toString()}`);
  return Array.isArray(rows) ? rows : [];
}

export async function publishOraclePrices(supplierCode, items) {
  if (!supplierCode) throw new Error('A supplier code is required.');
  if (!Array.isArray(items) || items.length === 0) throw new Error('At least one quotation item is required.');

  return oracleRequest('prices', {
    method: 'POST',
    body: JSON.stringify({ supplier_code: supplierCode, items })
  });
}

export async function getOracleApiPriceHistory(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
  const rows = await oracleRequest(`prices?source=api&limit=${safeLimit}`);
  return Array.isArray(rows) ? rows : [];
}
