import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  InMemoryCommercialStore,
  authorizeCredentialRequest,
  createCredentialResponse,
} from './commercial-sts-core.mjs';

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'POST,OPTIONS',
  });
  response.end(JSON.stringify(body, null, 2));
}

export function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

export async function handleMockStsRequest(request, response, options = {}) {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  if (request.method !== 'POST' || request.url !== '/api/sync/credentials') {
    sendJson(response, 404, { message: 'not found' });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch {
    sendJson(response, 400, { message: '请求体不是合法 JSON' });
    return;
  }

  const authToken = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const store = options.store || createDefaultMockStore(options.expectedToken || 'dev-commercial-token');
  const auth = authorizeCredentialRequest({
    store,
    authToken,
    body: payload,
  });

  store.writeAudit({
    userId: auth.user?.id,
    vaultId: payload.vaultId || 'main',
    deviceId: payload.deviceId,
    authToken,
    result: auth.ok ? 'success' : 'failed',
    status: auth.status,
  });

  if (!auth.ok) {
    sendJson(response, auth.status, { message: auth.message });
    return;
  }

  const body = createCredentialResponse({
    userId: auth.user.id,
    vaultId: auth.vaultId,
    repoId: auth.repoId,
    oss: {
    endpoint: 'https://s3.oss-cn-hangzhou.aliyuncs.com',
      bucket: 'mock-commercial-bucket',
      region: 'cn-hangzhou',
    },
    credentials: {
      accessKeyId: 'STS.MOCK_ACCESS_KEY_ID',
      accessKeySecret: 'MOCK_TEMPORARY_ACCESS_KEY_SECRET',
      securityToken: 'MOCK_SECURITY_TOKEN',
    },
  });

  sendJson(response, 200, body);
}

export function createMockStsServer(options = {}) {
  const expectedToken = options.expectedToken || process.env.MOCK_STS_TOKEN || 'dev-commercial-token';
  const store = options.store || createDefaultMockStore(expectedToken);

  return http.createServer((request, response) => {
    handleMockStsRequest(request, response, { ...options, store, expectedToken }).catch(() => {
      sendJson(response, 500, { message: 'mock STS server error' });
    });
  });
}

export function createDefaultMockStore(token) {
  const store = new InMemoryCommercialStore();
  store.addUser({
    id: 'mock-user',
    status: 'active',
    plan: 'dev',
    maxDevices: 3,
  });
  store.addToken({
    token,
    userId: 'mock-user',
    status: 'active',
  });
  return store;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8787);
  const expectedToken = process.env.MOCK_STS_TOKEN || 'dev-commercial-token';
  const server = createMockStsServer({ expectedToken });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Mock STS server listening on http://127.0.0.1:${port}`);
    console.log(`Use token: ${expectedToken}`);
  });
}
