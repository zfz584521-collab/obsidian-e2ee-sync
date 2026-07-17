import * as fs from 'node:fs';
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

describe('commercial STS admin CLI', () => {
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
  });
});
