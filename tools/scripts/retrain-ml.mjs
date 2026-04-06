#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const isFullRetrain = args.has('--full') || args.has('-f');
const shouldSkipHealthcheck = args.has('--skip-healthcheck');

const apiBaseUrl = (
  process.env.ML_API_BASE_URL ||
  process.env.API_BASE_URL ||
  'http://localhost:3001/api'
).replace(/\/+$/, '');

const apiKey = process.env.ADMIN_API_KEY || process.env.SERVER_API_KEY || '';

function buildHeaders() {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers['X-Server-API-Key'] = apiKey;
  }
  return headers;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const errorMessage = data?.error || data?.message || response.statusText;
    throw new Error(`${response.status} ${response.statusText}: ${errorMessage}`);
  }
  return data;
}

async function checkHealth() {
  const healthUrl = apiBaseUrl.replace(/\/api$/, '') + '/health';
  const health = await fetchJson(healthUrl, {
    method: 'GET',
    headers: buildHeaders()
  });
  if (health?.status !== 'ok') {
    throw new Error('API healthcheck failed');
  }
}

async function retrain() {
  const endpoint = isFullRetrain
    ? `${apiBaseUrl}/ml/relevance/reembed-and-train`
    : `${apiBaseUrl}/ml/relevance/train`;

  if (!shouldSkipHealthcheck) {
    await checkHealth();
  }

  const startedAt = Date.now();
  const result = await fetchJson(endpoint, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({})
  });
  const elapsedMs = Date.now() - startedAt;

  console.log(JSON.stringify({
    success: true,
    mode: isFullRetrain ? 'full-reembed-and-train' : 'train-only',
    endpoint,
    elapsed_ms: elapsedMs,
    response: result
  }, null, 2));
}

retrain().catch((error) => {
  console.error('[retrain-ml] Failed:', error?.message || error);
  process.exitCode = 1;
});
