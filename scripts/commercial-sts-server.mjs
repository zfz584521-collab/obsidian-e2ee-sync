import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  InMemoryCommercialStore,
  authorizeCredentialRequest,
  createCredentialResponse,
  hashSecret,
} from './commercial-sts-core.mjs';
import {
  createAliyunAssumeRoleProvider,
  loadAliyunProviderConfig,
  validateAliyunProviderConfig,
} from './aliyun-sts-provider.mjs';
import { JsonFileCommercialStore } from './commercial-sts-json-store.mjs';

const DEV_TOKEN_SALT = 'dev-token-salt';
const DEV_DEVICE_SALT = 'dev-device-salt';
const MAX_REQUEST_BODY_BYTES = 16 * 1024;

export function loadServerConfig(env = process.env) {
  return {
    nodeEnv: env.NODE_ENV || 'development',
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 8788),
    publicBaseUrl: env.PUBLIC_BASE_URL || '',
    tokenSalt: env.TOKEN_SALT || DEV_TOKEN_SALT,
    deviceSalt: env.DEVICE_SALT || DEV_DEVICE_SALT,
    seedUserId: env.SEED_USER_ID || 'u_dev_10001',
    seedToken: env.SEED_AUTH_TOKEN || '',
    seedMaxDevices: Number(env.SEED_MAX_DEVICES || 3),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE || 60),
    storePath: env.STORE_PATH || '',
    oss: {
      endpoint: env.OSS_ENDPOINT || 'https://s3.oss-cn-hangzhou.aliyuncs.com',
      bucket: env.OSS_BUCKET || '',
      region: env.OSS_REGION || 'cn-hangzhou',
    },
    provider: env.STS_PROVIDER || 'mock',
    aliyun: loadAliyunProviderConfig(env),
  };
}

export function validateServerConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config.oss.bucket) {
    errors.push('OSS_BUCKET is required');
  }
  if (!Number.isInteger(config.rateLimitPerMinute) || config.rateLimitPerMinute < 1 || config.rateLimitPerMinute > 600) {
    errors.push('RATE_LIMIT_PER_MINUTE must be an integer between 1 and 600');
  }
  if (config.provider === 'mock') {
    warnings.push('STS_PROVIDER=mock only returns fake credentials and must not be used in production');
  } else if (config.provider !== 'aliyun') {
    errors.push(`Unsupported STS_PROVIDER: ${config.provider}`);
  } else {
    try {
      validateAliyunProviderConfig(config.aliyun);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    if (config.tokenSalt === DEV_TOKEN_SALT) {
      errors.push('TOKEN_SALT must be set to a non-default value for Aliyun mode');
    }
    if (config.deviceSalt === DEV_DEVICE_SALT) {
      errors.push('DEVICE_SALT must be set to a non-default value for Aliyun mode');
    }
    if (!config.seedToken && !config.storePath) {
      errors.push('SEED_AUTH_TOKEN or STORE_PATH is required in Aliyun mode');
    }
  }
  if (!config.seedToken) {
    warnings.push('SEED_AUTH_TOKEN is empty; no seed user token will be created');
  }
  if (config.publicBaseUrl && config.publicBaseUrl.startsWith('http://') && !config.publicBaseUrl.includes('127.0.0.1') && !config.publicBaseUrl.includes('localhost')) {
    warnings.push('PUBLIC_BASE_URL should use HTTPS in production');
  }
  if (config.nodeEnv === 'production') {
    if (!config.storePath) errors.push('STORE_PATH is required in production');
    if (!config.publicBaseUrl.startsWith('https://')) {
      errors.push('PUBLIC_BASE_URL must use HTTPS in production');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function createSeedStore(config) {
  const store = new InMemoryCommercialStore({
    tokenSalt: config.tokenSalt,
    deviceSalt: config.deviceSalt,
  });
  store.addUser({
    id: config.seedUserId,
    status: 'active',
    plan: 'starter',
    maxDevices: config.seedMaxDevices,
  });
  if (config.seedToken) {
    store.addToken({
      token: config.seedToken,
      userId: config.seedUserId,
      status: 'active',
    });
  }
  return store;
}

export function createCommercialStore(config) {
  if (!config.storePath) return createSeedStore(config);
  const store = new JsonFileCommercialStore({
    filePath: config.storePath,
    tokenSalt: config.tokenSalt,
    deviceSalt: config.deviceSalt,
  });
  if (config.seedToken && !store.getUser(config.seedUserId)) {
    store.addUser({
      id: config.seedUserId,
      status: 'active',
      plan: 'starter',
      maxDevices: config.seedMaxDevices,
    });
    store.addToken({
      token: config.seedToken,
      userId: config.seedUserId,
      status: 'active',
    });
  }
  return store;
}

export function createMockAssumeRoleProvider({ durationSeconds = 3600 } = {}) {
  return {
    async assumeRole({ userId, vaultId, repoId }) {
      const safe = `${userId}_${vaultId}_${repoId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
      return {
        accessKeyId: `STS.MOCK.${safe}`,
        accessKeySecret: 'MOCK_TEMPORARY_ACCESS_KEY_SECRET',
        securityToken: 'MOCK_SECURITY_TOKEN',
        expiration: new Date(Date.now() + durationSeconds * 1000).toISOString(),
      };
    },
  };
}

export function createAssumeRoleProvider(config) {
  if (config.provider === 'aliyun') {
    return createAliyunAssumeRoleProvider(config.aliyun);
  }
  return createMockAssumeRoleProvider();
}

export function createTokenRateLimiter({ limit, tokenSalt, windowMs = 60_000 }) {
  const entries = new Map();
  return {
    allow(token, now = Date.now()) {
      const key = hashSecret(token, tokenSalt);
      const currentWindow = Math.floor(now / windowMs);
      const entry = entries.get(key);
      if (!entry || entry.window !== currentWindow) {
        entries.set(key, { window: currentWindow, count: 1 });
        return true;
      }
      if (entry.count >= limit) return false;
      entry.count++;
      return true;
    },
  };
}

export function createCommercialStsServer({
  config,
  store,
  assumeRoleProvider,
  rateLimiter = createTokenRateLimiter({
    limit: config.rateLimitPerMinute,
    tokenSalt: config.tokenSalt,
  }),
}) {
  const server = http.createServer(async (request, response) => {
    try {
      await handleCommercialStsRequest(request, response, {
        config,
        store,
        assumeRoleProvider,
        rateLimiter,
      });
    } catch {
      sendJson(response, 500, { message: '商业授权服务异常' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

export async function handleCommercialStsRequest(request, response, {
  config,
  store,
  assumeRoleProvider,
  rateLimiter,
}) {
  if (request.method === 'GET' && request.url === '/healthz') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

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
  } catch (error) {
    if (error?.code === 'REQUEST_BODY_TOO_LARGE') {
      sendJson(response, 413, { message: '请求体过大' });
      return;
    }
    sendJson(response, 400, { message: '请求体不是合法 JSON' });
    return;
  }

  const authToken = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const auth = authorizeCredentialRequest({
    store,
    authToken,
    body: payload,
  });

  if (!auth.ok) {
    store.writeAudit({
      userId: auth.user?.id,
      vaultId: payload.vaultId || 'main',
      deviceId: payload.deviceId,
      authToken,
      result: 'failed',
      status: auth.status,
    });
    sendJson(response, auth.status, { message: auth.message });
    return;
  }

  if (!rateLimiter.allow(authToken)) {
    store.writeAudit({
      userId: auth.user.id,
      vaultId: auth.vaultId,
      deviceId: payload.deviceId,
      authToken,
      result: 'rate_limited',
      status: 429,
    });
    sendJson(response, 429, { message: '请求过于频繁，请稍后重试' });
    return;
  }

  const credentials = await assumeRoleProvider.assumeRole({
    userId: auth.user.id,
    vaultId: auth.vaultId,
    repoId: auth.repoId,
    storagePrefix: `tenants/${auth.user.id}/vaults/${auth.vaultId}/repos/${auth.repoId}`,
  });

  store.writeAudit({
    userId: auth.user.id,
    vaultId: auth.vaultId,
    deviceId: payload.deviceId,
    authToken,
    result: 'success',
    status: 200,
  });

  sendJson(response, 200, createCredentialResponse({
    userId: auth.user.id,
    vaultId: auth.vaultId,
    repoId: auth.repoId,
    oss: config.oss,
    credentials,
  }));
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'POST,OPTIONS',
  });
  response.end(JSON.stringify(body, null, 2));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bodyBytes = 0;
    let rejected = false;
    request.setEncoding('utf8');
    request.on('data', chunk => {
      if (rejected) return;
      bodyBytes += Buffer.byteLength(chunk, 'utf8');
      if (bodyBytes > MAX_REQUEST_BODY_BYTES) {
        rejected = true;
        const error = new Error('Request body too large');
        error.code = 'REQUEST_BODY_TOO_LARGE';
        reject(error);
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      if (!rejected) resolve(body);
    });
    request.on('error', error => {
      if (!rejected) reject(error);
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = loadServerConfig();
  const validation = validateServerConfig(config);
  for (const warning of validation.warnings) {
    console.warn(`[commercial-sts] ${warning}`);
  }
  if (!validation.valid) {
    for (const error of validation.errors) {
      console.error(`[commercial-sts] ${error}`);
    }
    process.exit(1);
  }

  const store = createCommercialStore(config);
  const assumeRoleProvider = createAssumeRoleProvider(config);
  const server = createCommercialStsServer({ config, store, assumeRoleProvider });
  server.listen(config.port, config.host, () => {
    console.log(`Commercial STS server listening on http://${config.host}:${config.port}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
