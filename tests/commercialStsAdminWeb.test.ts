import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

let createCommercialStsServer: any;
let createMockAssumeRoleProvider: any;
let createCommercialStore: any;
let loadServerConfig: any;
const tempDirectories: string[] = [];
let server: any;

beforeAll(async () => {
  // @ts-ignore - Node ESM backend server script used by tests.
  const module = await import('../scripts/commercial-sts-server.mjs');
  createCommercialStsServer = module.createCommercialStsServer;
  createMockAssumeRoleProvider = module.createMockAssumeRoleProvider;
  createCommercialStore = module.createCommercialStore;
  loadServerConfig = module.loadServerConfig;
});

afterEach(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
    server = undefined;
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createConfig() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'commercial-sts-admin-web-'));
  tempDirectories.push(directory);
  return loadServerConfig({
    OSS_BUCKET: 'obsidian-sync-commercial',
    STS_PROVIDER: 'mock',
    STORE_PATH: path.join(directory, 'store.json'),
    TOKEN_SALT: 'production-token-salt',
    DEVICE_SALT: 'production-device-salt',
    ADMIN_ENABLED: 'true',
    ADMIN_PASSWORD: 'correct horse battery staple',
  });
}

function listen(value: any): Promise<string> {
  return new Promise(resolve => {
    value.listen(0, '127.0.0.1', () => {
      const address = value.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function login(baseUrl: string) {
  const response = await fetch(`${baseUrl}/admin/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'correct horse battery staple' }),
  });
  return {
    response,
    json: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
  };
}

describe('commercial STS admin web', () => {
  it('keeps the admin page unavailable unless explicitly enabled', async () => {
    const config = loadServerConfig({
      OSS_BUCKET: 'obsidian-sync-commercial',
      STS_PROVIDER: 'mock',
    });
    server = createCommercialStsServer({
      config,
      store: createCommercialStore(config),
      assumeRoleProvider: createMockAssumeRoleProvider(),
    });
    const baseUrl = await listen(server);

    expect((await fetch(`${baseUrl}/admin`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/admin/api/users`)).status).toBe(404);
  });

  it('serves a Chinese login page and creates secure short-lived sessions', async () => {
    const config = createConfig();
    server = createCommercialStsServer({
      config,
      store: createCommercialStore(config),
      assumeRoleProvider: createMockAssumeRoleProvider(),
    });
    const baseUrl = await listen(server);

    const page = await fetch(`${baseUrl}/admin`);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('客户授权中心');
    expect(html).toContain('登录');
    expect(html).not.toContain(config.admin.password);

    const rejected = await fetch(`${baseUrl}/admin/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'wrong password' }),
    });
    expect(rejected.status).toBe(401);

    const authenticated = await login(baseUrl);
    expect(authenticated.response.status).toBe(200);
    expect(authenticated.json.csrfToken).toMatch(/^[a-zA-Z0-9_-]{20,}$/);
    expect(authenticated.response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(authenticated.response.headers.get('set-cookie')).toContain('SameSite=Strict');
  });

  it('creates a customer and returns its token exactly once without persisting plaintext', async () => {
    const config = createConfig();
    const store = createCommercialStore(config);
    server = createCommercialStsServer({
      config,
      store,
      assumeRoleProvider: createMockAssumeRoleProvider(),
      generateAdminToken: () => 'ONE_TIME_CUSTOMER_TOKEN',
    });
    const baseUrl = await listen(server);
    const authenticated = await login(baseUrl);

    const missingCsrf = await fetch(`${baseUrl}/admin/api/users`, {
      method: 'POST',
      headers: {
        cookie: authenticated.cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: 'customer_001', maxDevices: 3, expiresInDays: 30 }),
    });
    expect(missingCsrf.status).toBe(403);

    const created = await fetch(`${baseUrl}/admin/api/users`, {
      method: 'POST',
      headers: {
        cookie: authenticated.cookie,
        'content-type': 'application/json',
        'x-csrf-token': authenticated.json.csrfToken,
      },
      body: JSON.stringify({ userId: 'customer_001', maxDevices: 3, expiresInDays: 30 }),
    });
    const createdJson = await created.json();
    expect(created.status).toBe(201);
    expect(createdJson).toMatchObject({
      token: 'ONE_TIME_CUSTOMER_TOKEN',
      user: {
        userId: 'customer_001',
        status: 'active',
        maxDevices: 3,
      },
    });
    expect(fs.readFileSync(config.storePath, 'utf8')).not.toContain('ONE_TIME_CUSTOMER_TOKEN');

    const users = await fetch(`${baseUrl}/admin/api/users`, {
      headers: { cookie: authenticated.cookie },
    });
    const usersJson = await users.json();
    expect(users.status).toBe(200);
    expect(usersJson.users).toHaveLength(1);
    expect(JSON.stringify(usersJson)).not.toContain('ONE_TIME_CUSTOMER_TOKEN');
  });

  it('reissues one active token per customer and immediately revokes the previous token', async () => {
    const config = createConfig();
    const generated = ['FIRST_CUSTOMER_TOKEN', 'SECOND_CUSTOMER_TOKEN'];
    const store = createCommercialStore(config);
    server = createCommercialStsServer({
      config,
      store,
      assumeRoleProvider: createMockAssumeRoleProvider(),
      generateAdminToken: () => generated.shift(),
    });
    const baseUrl = await listen(server);
    const authenticated = await login(baseUrl);
    const headers = {
      cookie: authenticated.cookie,
      'content-type': 'application/json',
      'x-csrf-token': authenticated.json.csrfToken,
    };

    await fetch(`${baseUrl}/admin/api/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId: 'customer_001', maxDevices: 3, expiresInDays: 30 }),
    });
    const reissued = await fetch(`${baseUrl}/admin/api/users/customer_001/token`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expiresInDays: 30 }),
    });

    expect(reissued.status).toBe(200);
    expect((await reissued.json()).token).toBe('SECOND_CUSTOMER_TOKEN');
    expect(store.findToken('FIRST_CUSTOMER_TOKEN').status).toBe('revoked');
    expect(store.findToken('SECOND_CUSTOMER_TOKEN').status).toBe('active');
    expect(store.listTokens('customer_001').filter((token: any) => token.status === 'active')).toHaveLength(1);
  });

  it('renews, revokes, disables, and restores customer access without returning old tokens', async () => {
    const config = createConfig();
    const store = createCommercialStore(config);
    server = createCommercialStsServer({
      config,
      store,
      assumeRoleProvider: createMockAssumeRoleProvider(),
      generateAdminToken: () => 'CUSTOMER_LIFECYCLE_TOKEN',
    });
    const baseUrl = await listen(server);
    const authenticated = await login(baseUrl);
    const headers = {
      cookie: authenticated.cookie,
      'content-type': 'application/json',
      'x-csrf-token': authenticated.json.csrfToken,
    };
    await fetch(`${baseUrl}/admin/api/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId: 'customer_001', maxDevices: 3, expiresInDays: 30 }),
    });
    const beforeRenewal = store.findToken('CUSTOMER_LIFECYCLE_TOKEN').expiresAt;

    const renewed = await fetch(`${baseUrl}/admin/api/users/customer_001/token/extend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expiresInDays: 90 }),
    });
    const renewedJson = await renewed.json();
    expect(renewed.status).toBe(200);
    expect(Date.parse(renewedJson.tokenExpiresAt)).toBeGreaterThan(Date.parse(beforeRenewal));
    expect(JSON.stringify(renewedJson)).not.toContain('CUSTOMER_LIFECYCLE_TOKEN');

    const disabled = await fetch(`${baseUrl}/admin/api/users/customer_001/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ status: 'disabled' }),
    });
    expect(disabled.status).toBe(200);
    expect(store.getUser('customer_001').status).toBe('disabled');

    const restored = await fetch(`${baseUrl}/admin/api/users/customer_001/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ status: 'active' }),
    });
    expect(restored.status).toBe(200);
    expect(store.getUser('customer_001').status).toBe('active');

    const revoked = await fetch(`${baseUrl}/admin/api/users/customer_001/token/revoke`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(revoked.status).toBe(200);
    expect(store.findToken('CUSTOMER_LIFECYCLE_TOKEN').status).toBe('revoked');
    expect(JSON.stringify(await revoked.json())).not.toContain('CUSTOMER_LIFECYCLE_TOKEN');
  });
});
