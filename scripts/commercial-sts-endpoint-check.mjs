import { fileURLToPath } from 'node:url';

const REQUEST_TIMEOUT_MS = 15_000;

function isLocalHttpUrl(url) {
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
}

function resolveBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('COMMERCIAL_STS_BASE_URL must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' && !isLocalHttpUrl(url)) {
    throw new Error('COMMERCIAL_STS_BASE_URL must be a valid HTTPS URL');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

function safeStatus(value, expected) {
  return typeof value === 'string' && value === expected ? value : undefined;
}

function safeCounts(value) {
  if (!value || typeof value !== 'object') return undefined;
  const counts = {};
  for (const name of ['users', 'tokens', 'devices', 'auditLogs']) {
    if (Number.isInteger(value[name]) && value[name] >= 0) counts[name] = value[name];
  }
  return Object.keys(counts).length === 4 ? counts : undefined;
}

async function fetchEndpoint(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return { response, statusCode: response.status };
  } catch {
    return { response: null, statusCode: 0 };
  }
}

export async function runCommercialStsEndpointCheck({
  baseUrl = process.env.COMMERCIAL_STS_BASE_URL,
  fetchImpl = fetch,
} = {}) {
  const base = resolveBaseUrl(baseUrl);
  const healthUrl = new URL('/healthz', base);
  const readinessUrl = new URL('/readyz', base);
  const [healthResult, readinessResult] = await Promise.all([
    fetchEndpoint(healthUrl, fetchImpl),
    fetchEndpoint(readinessUrl, fetchImpl),
  ]);

  const health = { statusCode: healthResult.statusCode };
  if (healthResult.response?.ok) {
    try {
      const body = await healthResult.response.json();
      const status = safeStatus(body?.status, 'ok');
      if (status) health.status = status;
    } catch {
      // A successful HTTP health endpoint without JSON is still represented by its status code.
    }
  }

  const readiness = { statusCode: readinessResult.statusCode };
  if (readinessResult.response?.ok) {
    try {
      const body = await readinessResult.response.json();
      const status = safeStatus(body?.status, 'ready');
      const provider = safeStatus(body?.provider, 'aliyun') || safeStatus(body?.provider, 'mock');
      const store = safeStatus(body?.store, 'persistent') || safeStatus(body?.store, 'memory');
      const counts = safeCounts(body?.counts);
      if (status) readiness.status = status;
      if (provider) readiness.provider = provider;
      if (store) readiness.store = store;
      if (counts) readiness.counts = counts;
    } catch {
      // Do not expose malformed or unexpected backend response bodies.
    }
  }

  return {
    success: health.statusCode === 200 && health.status === 'ok'
      && readiness.statusCode === 200 && readiness.status === 'ready',
    health,
    readiness,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const report = await runCommercialStsEndpointCheck();
    console.log(JSON.stringify(report, null, 2));
    if (!report.success) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      message: error instanceof Error ? error.message : 'Commercial STS endpoint check failed',
    }, null, 2));
    process.exitCode = 1;
  }
}
