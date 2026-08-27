const port = process.env.PORT || '3000';
const url = process.env.HEALTHCHECK_URL || `http://127.0.0.1:${port}/health/live`;

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.status !== 'ok') throw new Error('Unexpected liveness response');
  process.exit(0);
} catch (error) {
  console.error(`Health check failed: ${error.message}`);
  process.exit(1);
}
