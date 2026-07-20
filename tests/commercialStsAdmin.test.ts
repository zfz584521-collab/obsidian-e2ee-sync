import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

let runAdminCommand: any;
const tempDirectories: string[] = [];

beforeAll(async () => {
  // @ts-ignore - Node ESM helper script used by backend integration tests.
  const module = await import('../scripts/commercial-sts-admin.mjs');
  runAdminCommand = module.runAdminCommand;
});

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createEnv() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'commercial-sts-admin-'));
  tempDirectories.push(directory);
  return {
    STORE_PATH: path.join(directory, 'store.json'),
    TOKEN_OUTPUT_FILE: path.join(directory, 'issued.secret'),
    TOKEN_SALT: 'production-token-salt',
    DEVICE_SALT: 'production-device-salt',
  };
}

function hashSecret(value: string, salt: string) {
  return crypto
    .createHash('sha256')
    .update(String(salt))
    .update(':')
    .update(String(value || ''))
    .digest('hex');
}

describe('commercial STS admin CLI', () => {
  it('shows command help without requiring production environment variables', () => {
    const report = runAdminCommand({ env: {}, argv: ['help'] });

    expect(report).toMatchObject({
      success: true,
      action: 'help',
    });
    expect(report.commands).toContain('create-user <userId> [maxDevices]');
    expect(report.commands).toContain('issue-token <userId> [expiresInDays]');
    expect(JSON.stringify(report)).not.toContain('TOKEN_SALT');
  });

  it('creates users and issues tokens only through a protected file', () => {
    const env = createEnv();
    expect(runAdminCommand({ env, argv: ['create-user', 'u_10001', '2'] })).toMatchObject({
      success: true,
      userId: 'u_10001',
      maxDevices: 2,
    });
    const report = runAdminCommand({
      env,
      argv: ['issue-token', 'u_10001'],
      generateToken: () => 'RAW_GENERATED_TOKEN',
    });

    expect(report).toMatchObject({ success: true, action: 'issue-token' });
    expect(JSON.stringify(report)).not.toContain('RAW_GENERATED_TOKEN');
    expect(fs.readFileSync(env.TOKEN_OUTPUT_FILE, 'utf8').trim()).toBe('RAW_GENERATED_TOKEN');
    expect(fs.readFileSync(env.STORE_PATH, 'utf8')).not.toContain('RAW_GENERATED_TOKEN');
  });

  it('can issue expiring tokens for trials or fixed-term access', () => {
    const env = createEnv();
    const now = Date.parse('2026-07-17T00:00:00Z');
    runAdminCommand({ env, argv: ['create-user', 'u_10001'] });
    const report = runAdminCommand({
      env,
      argv: ['issue-token', 'u_10001', '30'],
      now,
      generateToken: () => 'EXPIRING_TOKEN',
    });

    expect(report).toMatchObject({
      success: true,
      action: 'issue-token',
      userId: 'u_10001',
      expiresAt: '2026-08-16T00:00:00.000Z',
    });
    const serialized = fs.readFileSync(env.STORE_PATH, 'utf8');
    expect(serialized).toContain('2026-08-16T00:00:00.000Z');
    expect(serialized).not.toContain('EXPIRING_TOKEN');
  });

  it('supports disabling users and revoking tokens without returning secrets', () => {
    const env = createEnv();
    runAdminCommand({ env, argv: ['create-user', 'u_10001'] });
    runAdminCommand({
      env,
      argv: ['issue-token', 'u_10001'],
      generateToken: () => 'TOKEN_TO_REVOKE',
    });

    expect(runAdminCommand({ env, argv: ['disable-user', 'u_10001'] })).toMatchObject({
      status: 'disabled',
    });
    const revokeReport = runAdminCommand({
      env: { ...env, AUTH_TOKEN_TO_REVOKE: 'TOKEN_TO_REVOKE' },
      argv: ['revoke-token'],
    });
    expect(revokeReport).toEqual({ success: true, action: 'revoke-token' });
    expect(JSON.stringify(revokeReport)).not.toContain('TOKEN_TO_REVOKE');
  });

  it('lists token hashes and revokes by token hash when raw token is unavailable', () => {
    const env = createEnv();
    runAdminCommand({ env, argv: ['create-user', 'u_10001'] });
    runAdminCommand({
      env,
      argv: ['issue-token', 'u_10001', '30'],
      now: Date.parse('2026-07-17T00:00:00Z'),
      generateToken: () => 'TOKEN_TO_LIST',
    });

    const list = runAdminCommand({ env, argv: ['list-tokens', 'u_10001'] });
    const tokenHash = hashSecret('TOKEN_TO_LIST', env.TOKEN_SALT);

    expect(list).toMatchObject({
      success: true,
      action: 'list-tokens',
      userId: 'u_10001',
      count: 1,
    });
    expect(list.tokens).toEqual([
      {
        tokenHash,
        userId: 'u_10001',
        status: 'active',
        expiresAt: '2026-08-16T00:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(list)).not.toContain('TOKEN_TO_LIST');

    const revoked = runAdminCommand({
      env: { ...env, TOKEN_HASH_TO_REVOKE: tokenHash },
      argv: ['revoke-token-hash'],
    });
    expect(revoked).toEqual({
      success: true,
      action: 'revoke-token-hash',
      tokenHash,
    });
    expect(runAdminCommand({ env, argv: ['list-tokens', 'u_10001'] }).tokens[0].status).toBe('revoked');
  });

  it('lists redacted audit logs for operations without exposing raw tokens or devices', () => {
    const env = createEnv();
    runAdminCommand({ env, argv: ['create-user', 'u_10001'] });
    runAdminCommand({
      env,
      argv: ['issue-token', 'u_10001'],
      generateToken: () => 'RAW_AUDIT_TOKEN',
    });

    const storeData = JSON.parse(fs.readFileSync(env.STORE_PATH, 'utf8'));
    storeData.auditLogs = [
      {
        userId: 'u_10001',
        vaultId: 'main',
        deviceIdHash: 'hashed-device-one',
        authTokenHash: 'hashed-token-one',
        result: 'success',
        status: 200,
        createdAt: 1,
      },
      {
        userId: 'u_20002',
        vaultId: 'main',
        deviceIdHash: 'hashed-device-two',
        authTokenHash: 'hashed-token-two',
        result: 'failed',
        status: 401,
        createdAt: 2,
      },
    ];
    fs.writeFileSync(env.STORE_PATH, JSON.stringify(storeData, null, 2), 'utf8');

    const report = runAdminCommand({ env, argv: ['audit-log', 'u_10001', '10'] });

    expect(report).toMatchObject({
      success: true,
      action: 'audit-log',
      userId: 'u_10001',
      count: 1,
    });
    expect(report.logs).toEqual([
      {
        userId: 'u_10001',
        vaultId: 'main',
        deviceIdHash: 'hashed-device-one',
        authTokenHash: 'hashed-token-one',
        result: 'success',
        status: 200,
        createdAt: 1,
      },
    ]);
    expect(JSON.stringify(report)).not.toContain('RAW_AUDIT_TOKEN');
  });

  it('summarizes recent audit logs for lightweight monitoring', () => {
    const env = createEnv();
    runAdminCommand({ env, argv: ['create-user', 'u_10001'] });
    runAdminCommand({
      env,
      argv: ['issue-token', 'u_10001'],
      generateToken: () => 'RAW_SUMMARY_TOKEN',
    });

    const now = Date.parse('2026-07-18T10:00:00Z');
    const storeData = JSON.parse(fs.readFileSync(env.STORE_PATH, 'utf8'));
    storeData.auditLogs = [
      {
        userId: 'u_10001',
        result: 'success',
        status: 200,
        createdAt: now - 5 * 60 * 1000,
      },
      {
        userId: 'u_10001',
        result: 'failed',
        status: 401,
        createdAt: now - 10 * 60 * 1000,
      },
      {
        userId: 'u_10001',
        result: 'rate_limited',
        status: 429,
        createdAt: now - 20 * 60 * 1000,
      },
      {
        userId: 'u_20002',
        result: 'failed',
        status: 403,
        createdAt: now - 5 * 60 * 1000,
      },
      {
        userId: 'u_10001',
        result: 'failed',
        status: 500,
        createdAt: now - 2 * 60 * 60 * 1000,
      },
    ];
    fs.writeFileSync(env.STORE_PATH, JSON.stringify(storeData, null, 2), 'utf8');

    const report = runAdminCommand({
      env,
      argv: ['audit-summary', 'u_10001', '60'],
      now,
    });

    expect(report).toEqual({
      success: true,
      action: 'audit-summary',
      userId: 'u_10001',
      windowMinutes: 60,
      total: 3,
      byResult: {
        failed: 1,
        rate_limited: 1,
        success: 1,
      },
      byStatus: {
        '200': 1,
        '401': 1,
        '429': 1,
      },
    });
    expect(JSON.stringify(report)).not.toContain('RAW_SUMMARY_TOKEN');
  });

  it('lists and forgets devices without returning raw device IDs', () => {
    const env = createEnv();
    runAdminCommand({ env, argv: ['create-user', 'u_10001', '2'] });
    runAdminCommand({
      env,
      argv: ['issue-token', 'u_10001'],
      generateToken: () => 'DEVICE_TOKEN',
    });

    const storeData = JSON.parse(fs.readFileSync(env.STORE_PATH, 'utf8'));
    const deviceIdHash = hashSecret('RAW_DEVICE_ID', env.DEVICE_SALT);
    storeData.devices = [
      {
        key: `u_10001:${deviceIdHash}`,
        value: {
          userId: 'u_10001',
          deviceIdHash,
          firstSeenAt: 1,
          lastSeenAt: 2,
        },
      },
    ];
    fs.writeFileSync(env.STORE_PATH, JSON.stringify(storeData, null, 2), 'utf8');

    const list = runAdminCommand({ env, argv: ['list-devices', 'u_10001'] });
    expect(list).toMatchObject({
      success: true,
      action: 'list-devices',
      userId: 'u_10001',
      count: 1,
    });
    expect(list.devices).toEqual([
      {
        userId: 'u_10001',
        deviceIdHash,
        firstSeenAt: 1,
        lastSeenAt: 2,
      },
    ]);

    const forgotten = runAdminCommand({
      env: { ...env, DEVICE_ID_TO_FORGET: 'RAW_DEVICE_ID' },
      argv: ['forget-device', 'u_10001'],
    });
    expect(forgotten).toMatchObject({
      success: true,
      action: 'forget-device',
      userId: 'u_10001',
      deviceIdHash,
    });
    expect(JSON.stringify({ list, forgotten })).not.toContain('RAW_DEVICE_ID');
    expect(runAdminCommand({ env, argv: ['list-devices', 'u_10001'] }).count).toBe(0);
  });

  it('requires device removal input through an environment variable', () => {
    const env = createEnv();
    runAdminCommand({ env, argv: ['create-user', 'u_10001'] });

    expect(() => runAdminCommand({
      env,
      argv: ['forget-device', 'u_10001'],
    })).toThrow('DEVICE_ID_TO_FORGET is required');
    expect(() => runAdminCommand({
      env,
      argv: ['revoke-token-hash'],
    })).toThrow('TOKEN_HASH_TO_REVOKE is required');
  });

  it('rejects unsafe identifiers and development salts', () => {
    const env = createEnv();
    expect(() => runAdminCommand({
      env,
      argv: ['create-user', '../unsafe'],
    })).toThrow('userId must contain only');
    expect(() => runAdminCommand({
      env: { ...env, TOKEN_SALT: 'dev-token-salt' },
      argv: ['create-user', 'u_10001'],
    })).toThrow('TOKEN_SALT must be set');
    expect(() => runAdminCommand({
      env,
      argv: ['audit-log', 'u_10001', '999'],
    })).toThrow('limit must be an integer between 1 and 200');
    expect(() => runAdminCommand({
      env,
      argv: ['audit-summary', 'u_10001', '10081'],
    })).toThrow('windowMinutes must be an integer between 1 and 10080');
    runAdminCommand({ env, argv: ['create-user', 'u_10001'] });
    expect(() => runAdminCommand({
      env,
      argv: ['issue-token', 'u_10001', '367'],
    })).toThrow('expiresInDays must be an integer between 1 and 366');
  });
});
