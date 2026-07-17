import { beforeAll, describe, expect, it } from 'vitest';

let InMemoryCommercialStore: any;
let authorizeCredentialRequest: any;
let createCredentialResponse: any;
let hashSecret: any;
let makeStoragePrefix: any;
let redactAuditEvent: any;
let safeSegment: any;
const ACTIVE_NOW = Date.parse('2026-07-11T00:00:00Z');

beforeAll(async () => {
  // @ts-ignore - Node ESM backend helper script used by tests.
  const module = await import('../scripts/commercial-sts-core.mjs');
  InMemoryCommercialStore = module.InMemoryCommercialStore;
  authorizeCredentialRequest = module.authorizeCredentialRequest;
  createCredentialResponse = module.createCredentialResponse;
  hashSecret = module.hashSecret;
  makeStoragePrefix = module.makeStoragePrefix;
  redactAuditEvent = module.redactAuditEvent;
  safeSegment = module.safeSegment;
});

function createStore() {
  const store = new InMemoryCommercialStore({
    tokenSalt: 'token-salt',
    deviceSalt: 'device-salt',
  });
  store.addUser({
    id: 'u_10001',
    status: 'active',
    plan: 'starter',
    maxDevices: 2,
  });
  store.addToken({
    token: 'valid-token',
    userId: 'u_10001',
    status: 'active',
    expiresAt: '2026-07-12T00:00:00Z',
  });
  return store;
}

describe('commercial STS backend core', () => {
  it('authorizes active users and returns stable tenant context', () => {
    const store = createStore();

    const result = authorizeCredentialRequest({
      store,
      authToken: 'valid-token',
      body: {
        vaultId: 'main',
        repoId: 'repo_existing',
        deviceId: 'dev_device_one',
      },
      now: ACTIVE_NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      vaultId: 'main',
      repoId: 'repo_existing',
      deviceCount: 1,
    });
  });

  it('rejects invalid or expired tokens', () => {
    const store = createStore();

    const invalid = authorizeCredentialRequest({
      store,
      authToken: 'wrong-token',
      body: { vaultId: 'main', deviceId: 'dev_device_one' },
    });
    const expired = authorizeCredentialRequest({
      store,
      authToken: 'valid-token',
      body: { vaultId: 'main', deviceId: 'dev_device_one' },
      now: Date.parse('2026-07-13T00:00:00Z'),
    });

    expect(invalid).toMatchObject({ ok: false, status: 401 });
    expect(expired).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects disabled users', () => {
    const store = createStore();
    store.addUser({ id: 'u_10001', status: 'disabled', maxDevices: 2 });

    const result = authorizeCredentialRequest({
      store,
      authToken: 'valid-token',
      body: { vaultId: 'main', deviceId: 'dev_device_one' },
      now: ACTIVE_NOW,
    });

    expect(result).toMatchObject({ ok: false, status: 403, message: '用户已停用或不可用' });
  });

  it('enforces device limits while allowing existing devices', () => {
    const store = createStore();

    const first = authorizeCredentialRequest({
      store,
      authToken: 'valid-token',
      body: { vaultId: 'main', deviceId: 'dev_device_one' },
      now: ACTIVE_NOW,
    });
    const second = authorizeCredentialRequest({
      store,
      authToken: 'valid-token',
      body: { vaultId: 'main', deviceId: 'dev_device_two' },
      now: ACTIVE_NOW,
    });
    const repeatFirst = authorizeCredentialRequest({
      store,
      authToken: 'valid-token',
      body: { vaultId: 'main', deviceId: 'dev_device_one' },
      now: ACTIVE_NOW,
    });
    const third = authorizeCredentialRequest({
      store,
      authToken: 'valid-token',
      body: { vaultId: 'main', deviceId: 'dev_device_three' },
      now: ACTIVE_NOW,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(repeatFirst.ok).toBe(true);
    expect(third).toMatchObject({ ok: false, status: 403, message: '设备数量已达到当前套餐上限' });
  });

  it('sanitizes path segments and builds tenant prefixes', () => {
    expect(safeSegment('../main vault')).toBe('main_vault');
    expect(makeStoragePrefix('u/10001', '../main vault')).toBe('tenants/u_10001/vaults/main_vault');
  });

  it('sanitizes client repo IDs before they enter an STS policy path', () => {
    const store = createStore();

    const result = authorizeCredentialRequest({
      store,
      authToken: 'valid-token',
      body: {
        vaultId: 'main',
        repoId: '../../repos/*',
        deviceId: 'dev_device_one',
      },
      now: ACTIVE_NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      repoId: 'repos',
    });
    expect(result.repoId).not.toMatch(/[/*\\]/);
  });

  it('builds plugin credential responses without changing sync password ownership', () => {
    const response = createCredentialResponse({
      userId: 'u_10001',
      vaultId: 'main',
      repoId: 'repo_existing',
      oss: {
        endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
        bucket: 'obsidian-sync-commercial',
        region: 'cn-hangzhou',
      },
      credentials: {
        accessKeyId: 'STS.mock',
        accessKeySecret: 'temporary-secret',
        securityToken: 'temporary-token',
        expiration: '2026-07-11T10:00:00Z',
      },
    });

    expect(response).toMatchObject({
      storagePrefix: 'tenants/u_10001/vaults/main',
      repoId: 'repo_existing',
      credentials: {
        accessKeyId: 'STS.mock',
        accessKeySecret: 'temporary-secret',
        securityToken: 'temporary-token',
      },
    });
    expect(response).not.toHaveProperty('syncPassword');
  });

  it('redacts audit events before storage', () => {
    const redacted = redactAuditEvent({
      userId: 'u_10001',
      deviceId: 'dev_should_not_store',
      authToken: 'token_should_not_store',
      accessKeySecret: 'secret_should_not_store',
      securityToken: 'security_token_should_not_store',
      syncPassword: 'password_should_not_store',
      result: 'success',
    });

    expect(redacted).toMatchObject({
      userId: 'u_10001',
      result: 'success',
      deviceIdHash: hashSecret('dev_should_not_store', 'device'),
      authTokenHash: hashSecret('token_should_not_store', 'token'),
    });
    expect(JSON.stringify(redacted)).not.toContain('should_not_store');
  });

  it('uses deployment-specific salts for stored audit hashes', () => {
    const first = new InMemoryCommercialStore({
      tokenSalt: 'deployment-one-token-salt',
      deviceSalt: 'deployment-one-device-salt',
    });
    const second = new InMemoryCommercialStore({
      tokenSalt: 'deployment-two-token-salt',
      deviceSalt: 'deployment-two-device-salt',
    });
    const event = {
      deviceId: 'same-device',
      authToken: 'same-token',
      result: 'failed',
    };

    first.writeAudit(event);
    second.writeAudit(event);

    expect(first.auditLogs[0].deviceIdHash).toBe(hashSecret('same-device', 'deployment-one-device-salt'));
    expect(first.auditLogs[0].authTokenHash).toBe(hashSecret('same-token', 'deployment-one-token-salt'));
    expect(first.auditLogs[0].deviceIdHash).not.toBe(second.auditLogs[0].deviceIdHash);
    expect(first.auditLogs[0].authTokenHash).not.toBe(second.auditLogs[0].authTokenHash);
  });
});
