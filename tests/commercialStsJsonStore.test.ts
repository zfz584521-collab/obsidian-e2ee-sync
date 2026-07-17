import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

let JsonFileCommercialStore: any;
const tempDirectories: string[] = [];

beforeAll(async () => {
  // @ts-ignore - Node ESM helper script used by backend integration tests.
  const module = await import('../scripts/commercial-sts-json-store.mjs');
  JsonFileCommercialStore = module.JsonFileCommercialStore;
});

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'commercial-sts-store-'));
  tempDirectories.push(directory);
  const filePath = path.join(directory, 'store.json');
  return {
    filePath,
    store: new JsonFileCommercialStore({
      filePath,
      tokenSalt: 'production-token-salt',
      deviceSalt: 'production-device-salt',
      auditLimit: 2,
    }),
  };
}

describe('JsonFileCommercialStore', () => {
  it('persists users and hashed tokens without storing raw secrets', () => {
    const { filePath, store } = createStore();
    store.addUser({ id: 'u_10001', status: 'active', maxDevices: 2 });
    store.addToken({ token: 'RAW_AUTH_TOKEN_MUST_NOT_PERSIST', userId: 'u_10001' });

    const serialized = fs.readFileSync(filePath, 'utf8');
    expect(serialized).not.toContain('RAW_AUTH_TOKEN_MUST_NOT_PERSIST');

    const reloaded = new JsonFileCommercialStore({
      filePath,
      tokenSalt: 'production-token-salt',
      deviceSalt: 'production-device-salt',
    });
    expect(reloaded.getUser('u_10001')).toMatchObject({ status: 'active' });
    expect(reloaded.findToken('RAW_AUTH_TOKEN_MUST_NOT_PERSIST')).toMatchObject({
      userId: 'u_10001',
      status: 'active',
    });
  });

  it('persists hashed devices, redacted audits, and lifecycle changes', () => {
    const { filePath, store } = createStore();
    store.addUser({ id: 'u_10001', status: 'active', maxDevices: 2 });
    store.addToken({ token: 'TOKEN_TO_REVOKE', userId: 'u_10001' });
    store.registerDevice('u_10001', 'RAW_DEVICE_ID', 2);
    store.writeAudit({
      userId: 'u_10001',
      deviceId: 'RAW_DEVICE_ID',
      authToken: 'TOKEN_TO_REVOKE',
      syncPassword: 'RAW_SYNC_PASSWORD',
      result: 'success',
    });
    store.setUserStatus('u_10001', 'disabled');
    store.setTokenStatus('TOKEN_TO_REVOKE', 'revoked');

    const serialized = fs.readFileSync(filePath, 'utf8');
    expect(serialized).not.toContain('RAW_DEVICE_ID');
    expect(serialized).not.toContain('TOKEN_TO_REVOKE');
    expect(serialized).not.toContain('RAW_SYNC_PASSWORD');

    const reloaded = new JsonFileCommercialStore({
      filePath,
      tokenSalt: 'production-token-salt',
      deviceSalt: 'production-device-salt',
    });
    expect(reloaded.getUser('u_10001').status).toBe('disabled');
    expect(reloaded.findToken('TOKEN_TO_REVOKE').status).toBe('revoked');
    expect(reloaded.countDevices('u_10001')).toBe(1);
    expect(reloaded.auditLogs[0]).toMatchObject({ result: 'success' });
  });
});
