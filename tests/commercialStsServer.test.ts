import { afterEach, beforeAll, describe, expect, it } from 'vitest';

let createCommercialStsServer: any;
let createAssumeRoleProvider: any;
let createMockAssumeRoleProvider: any;
let createCommercialStore: any;
let createSeedStore: any;
let loadServerConfig: any;
let validateServerConfig: any;

beforeAll(async () => {
  // @ts-ignore - Node ESM backend server script used by tests.
  const module = await import('../scripts/commercial-sts-server.mjs');
  createCommercialStsServer = module.createCommercialStsServer;
  createAssumeRoleProvider = module.createAssumeRoleProvider;
  createMockAssumeRoleProvider = module.createMockAssumeRoleProvider;
  createCommercialStore = module.createCommercialStore;
  createSeedStore = module.createSeedStore;
  loadServerConfig = module.loadServerConfig;
  validateServerConfig = module.validateServerConfig;
});

let server: any;

function listen(server: any): Promise<string> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server: any): Promise<void> {
  if (!server) return;
  await new Promise(resolve => server.close(resolve));
}

describe('commercial STS server', () => {
  afterEach(async () => {
    await close(server);
    server = undefined;
  });

  it('validates required deployment configuration', () => {
    const config = loadServerConfig({
      OSS_BUCKET: '',
      SEED_AUTH_TOKEN: 'token',
      STS_PROVIDER: 'mock',
    });
    const validation = validateServerConfig(config);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('OSS_BUCKET is required');
    expect(validation.warnings).toContain('STS_PROVIDER=mock only returns fake credentials and must not be used in production');
  });

  it('validates Aliyun provider configuration before startup', () => {
    const invalid = validateServerConfig(loadServerConfig({
      OSS_BUCKET: 'obsidian-sync-commercial',
      STS_PROVIDER: 'aliyun',
      ALIYUN_ACCESS_KEY_ID: '',
      ALIYUN_ACCESS_KEY_SECRET: '',
      ALIYUN_STS_ROLE_ARN: '',
    }));
    const validConfig = loadServerConfig({
      OSS_BUCKET: 'obsidian-sync-commercial',
      STS_PROVIDER: 'aliyun',
      ALIYUN_ACCESS_KEY_ID: 'ak',
      ALIYUN_ACCESS_KEY_SECRET: 'secret',
      ALIYUN_STS_ROLE_ARN: 'acs:ram::123:role/sync',
      STS_DURATION_SECONDS: '3600',
      SEED_AUTH_TOKEN: 'seed-token',
      TOKEN_SALT: 'production-token-salt',
      DEVICE_SALT: 'production-device-salt',
    });
    const valid = validateServerConfig(validConfig);

    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join(' ')).toContain('ALIYUN_ACCESS_KEY_ID');
    expect(valid.valid).toBe(true);
    expect(createAssumeRoleProvider(validConfig)).toHaveProperty('assumeRole');
  });

  it('rejects development salts and empty seed tokens in Aliyun mode', () => {
    const validation = validateServerConfig(loadServerConfig({
      OSS_BUCKET: 'obsidian-sync-commercial',
      STS_PROVIDER: 'aliyun',
      ALIYUN_ACCESS_KEY_ID: 'ak',
      ALIYUN_ACCESS_KEY_SECRET: 'secret',
      ALIYUN_STS_ROLE_ARN: 'acs:ram::123:role/sync',
    }));

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('TOKEN_SALT must be set to a non-default value for Aliyun mode');
    expect(validation.errors).toContain('DEVICE_SALT must be set to a non-default value for Aliyun mode');
    expect(validation.errors).toContain('SEED_AUTH_TOKEN or STORE_PATH is required in Aliyun mode');
  });

  it('requires persistent storage and HTTPS in production', () => {
    const validation = validateServerConfig(loadServerConfig({
      NODE_ENV: 'production',
      OSS_BUCKET: 'obsidian-sync-commercial',
      STS_PROVIDER: 'mock',
      PUBLIC_BASE_URL: 'http://sync.example.com',
    }));

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('STORE_PATH is required in production');
    expect(validation.errors).toContain('PUBLIC_BASE_URL must use HTTPS in production');
  });

  it('accepts a persistent store instead of a seed token in Aliyun mode', () => {
    const config = loadServerConfig({
      OSS_BUCKET: 'obsidian-sync-commercial',
      STS_PROVIDER: 'aliyun',
      ALIYUN_ACCESS_KEY_ID: 'ak',
      ALIYUN_ACCESS_KEY_SECRET: 'secret',
      ALIYUN_STS_ROLE_ARN: 'acs:ram::123:role/sync',
      TOKEN_SALT: 'production-token-salt',
      DEVICE_SALT: 'production-device-salt',
      STORE_PATH: '.commercial-sts/test-store.json',
    });

    expect(validateServerConfig(config).valid).toBe(true);
  });

  it('serves a redacted health check without requiring authorization', async () => {
    const config = loadServerConfig({
      OSS_BUCKET: 'obsidian-sync-commercial',
      STS_PROVIDER: 'mock',
    });
    server = createCommercialStsServer({
      config,
      store: createSeedStore(config),
      assumeRoleProvider: createMockAssumeRoleProvider(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('issues plugin credential responses for authorized seed users', async () => {
    const config = loadServerConfig({
      OSS_BUCKET: 'obsidian-sync-commercial',
      OSS_ENDPOINT: 'https://s3.oss-cn-hangzhou.aliyuncs.com',
      OSS_REGION: 'cn-hangzhou',
      SEED_USER_ID: 'u_10001',
      SEED_AUTH_TOKEN: 'valid-token',
      STS_PROVIDER: 'mock',
    });
    const store = createSeedStore(config);
    server = createCommercialStsServer({
      config,
      store,
      assumeRoleProvider: createMockAssumeRoleProvider(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/sync/credentials`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        vaultId: 'main',
        repoId: 'repo_existing',
        deviceId: 'dev_test',
        pluginVersion: '0.1.0',
      }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      endpoint: 'https://s3.oss-cn-hangzhou.aliyuncs.com',
      bucket: 'obsidian-sync-commercial',
      region: 'cn-hangzhou',
      storagePrefix: 'tenants/u_10001/vaults/main',
      repoId: 'repo_existing',
    });
    expect(json.credentials.accessKeyId).toContain('STS.MOCK');
    expect(JSON.stringify(store.auditLogs)).not.toContain('valid-token');
    expect(JSON.stringify(store.auditLogs)).not.toContain('dev_test');
  });

  it('rejects unauthorized requests and writes redacted audit logs', async () => {
    const config = loadServerConfig({
      OSS_BUCKET: 'obsidian-sync-commercial',
      SEED_USER_ID: 'u_10001',
      SEED_AUTH_TOKEN: 'valid-token',
      STS_PROVIDER: 'mock',
    });
    const store = createSeedStore(config);
    server = createCommercialStsServer({
      config,
      store,
      assumeRoleProvider: createMockAssumeRoleProvider(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/sync/credentials`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer invalid-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        vaultId: 'main',
        deviceId: 'dev_test',
      }),
    });
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.message).toContain('授权令牌无效');
    expect(JSON.stringify(store.auditLogs)).not.toContain('invalid-token');
    expect(JSON.stringify(store.auditLogs)).not.toContain('dev_test');
  });

  it('rejects request bodies larger than the credential endpoint limit', async () => {
    const config = loadServerConfig({
      OSS_BUCKET: 'obsidian-sync-commercial',
      SEED_AUTH_TOKEN: 'valid-token',
      STS_PROVIDER: 'mock',
    });
    server = createCommercialStsServer({
      config,
      store: createSeedStore(config),
      assumeRoleProvider: createMockAssumeRoleProvider(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/sync/credentials`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        vaultId: 'main',
        deviceId: 'dev_test',
        padding: 'x'.repeat(20 * 1024),
      }),
    });
    const json = await response.json();

    expect(response.status).toBe(413);
    expect(json).toEqual({ message: '请求体过大' });
  });

  it('rate limits repeated credential requests without exposing tokens', async () => {
    const config = loadServerConfig({
      OSS_BUCKET: 'obsidian-sync-commercial',
      SEED_USER_ID: 'u_10001',
      SEED_AUTH_TOKEN: 'rate-limited-token',
      RATE_LIMIT_PER_MINUTE: '1',
      STS_PROVIDER: 'mock',
    });
    const store = createSeedStore(config);
    server = createCommercialStsServer({
      config,
      store,
      assumeRoleProvider: createMockAssumeRoleProvider(),
    });
    const baseUrl = await listen(server);
    const request = () => fetch(`${baseUrl}/api/sync/credentials`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer rate-limited-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ vaultId: 'main', deviceId: 'dev_test' }),
    });

    expect((await request()).status).toBe(200);
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ message: '请求过于频繁，请稍后重试' });
    expect(JSON.stringify(store.auditLogs)).not.toContain('rate-limited-token');
    expect(JSON.stringify(store.auditLogs)).not.toContain('dev_test');
  });
});
