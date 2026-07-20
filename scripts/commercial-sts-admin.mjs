import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeSegment } from './commercial-sts-core.mjs';
import { JsonFileCommercialStore } from './commercial-sts-json-store.mjs';

const DEV_TOKEN_SALT = 'dev-token-salt';
const DEV_DEVICE_SALT = 'dev-device-salt';

function loadAdminStore(env) {
  if (!env.STORE_PATH) throw new Error('STORE_PATH is required');
  if (!env.TOKEN_SALT || env.TOKEN_SALT === DEV_TOKEN_SALT) {
    throw new Error('TOKEN_SALT must be set to a non-default value');
  }
  if (!env.DEVICE_SALT || env.DEVICE_SALT === DEV_DEVICE_SALT) {
    throw new Error('DEVICE_SALT must be set to a non-default value');
  }
  return new JsonFileCommercialStore({
    filePath: env.STORE_PATH,
    tokenSalt: env.TOKEN_SALT,
    deviceSalt: env.DEVICE_SALT,
  });
}

function requireUserId(value) {
  const raw = String(value || '').trim();
  const normalized = safeSegment(raw, '');
  if (!raw || normalized !== raw) {
    throw new Error('userId must contain only letters, numbers, underscores, or hyphens');
  }
  return raw;
}

function requirePlan(value) {
  const raw = String(value || '').trim();
  const normalized = safeSegment(raw, '');
  if (!raw || normalized !== raw) {
    throw new Error('plan must contain only letters, numbers, underscores, or hyphens');
  }
  return raw;
}

function parseMaxDevices(value, fallback = 3) {
  const maxDevices = Number(value || fallback);
  if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 20) {
    throw new Error('maxDevices must be an integer between 1 and 20');
  }
  return maxDevices;
}

function defaultTokenOutputPath(storePath, userId, now) {
  const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  return path.join(path.dirname(path.resolve(storePath)), `issued-token-${userId}-${timestamp}.secret`);
}

function parseAuditLimit(value) {
  const limit = Number(value || 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('limit must be an integer between 1 and 200');
  }
  return limit;
}

function parseAuditWindowMinutes(value) {
  const minutes = Number(value || 60);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
    throw new Error('windowMinutes must be an integer between 1 and 10080');
  }
  return minutes;
}

function parseTokenExpiresAt(value, now) {
  if (!value) return undefined;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    throw new Error('expiresInDays must be an integer between 1 and 366');
  }
  return new Date(now + days * 24 * 60 * 60 * 1000).toISOString();
}

function writeTokenFile(filePath, token) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${token}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

function getHelp() {
  return {
    success: true,
    action: 'help',
    commands: [
      'create-user <userId> [maxDevices]',
      'update-user <userId> <plan> [maxDevices]',
      'issue-token <userId> [expiresInDays]',
      'disable-user <userId>',
      'enable-user <userId>',
      'user-status <userId>',
      'list-tokens <userId>',
      'revoke-token',
      'revoke-token-hash',
      'list-devices <userId>',
      'forget-device <userId>',
      'audit-log [userId] [limit]',
      'audit-summary [userId] [windowMinutes]',
      'verify-store',
      'help',
    ],
    sensitiveInputs: [
      'AUTH_TOKEN_TO_REVOKE',
      'TOKEN_HASH_TO_REVOKE',
      'DEVICE_ID_TO_FORGET',
    ],
  };
}

export function runAdminCommand({
  env = process.env,
  argv = process.argv.slice(2),
  now = Date.now(),
  generateToken = () => `obsync_${crypto.randomBytes(32).toString('base64url')}`,
} = {}) {
  const [command, rawUserId, rawValue] = argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return getHelp();
  }

  const store = loadAdminStore(env);

  if (command === 'create-user') {
    const userId = requireUserId(rawUserId);
    if (store.getUser(userId)) throw new Error('User already exists');
    const maxDevices = parseMaxDevices(rawValue);
    store.addUser({ id: userId, status: 'active', plan: 'starter', maxDevices });
    return { success: true, action: 'create-user', userId, maxDevices };
  }

  if (command === 'update-user') {
    const userId = requireUserId(rawUserId);
    const plan = requirePlan(rawValue);
    const existing = store.getUser(userId);
    if (!existing) throw new Error('User not found');
    const maxDevices = parseMaxDevices(argv[3], existing.maxDevices);
    const user = store.updateUser(userId, { plan, maxDevices });
    return {
      success: true,
      action: 'update-user',
      userId,
      plan: user.plan,
      maxDevices: user.maxDevices,
    };
  }

  if (command === 'issue-token') {
    const userId = requireUserId(rawUserId);
    const user = store.getUser(userId);
    if (!user || user.status !== 'active') throw new Error('Active user not found');
    const token = generateToken();
    const expiresAt = parseTokenExpiresAt(rawValue, now);
    const outputPath = path.resolve(
      env.TOKEN_OUTPUT_FILE || defaultTokenOutputPath(env.STORE_PATH, userId, now),
    );
    writeTokenFile(outputPath, token);
    store.addToken({ token, userId, status: 'active', expiresAt });
    return { success: true, action: 'issue-token', userId, tokenFile: outputPath, expiresAt };
  }

  if (command === 'disable-user' || command === 'enable-user') {
    const userId = requireUserId(rawUserId);
    const status = command === 'disable-user' ? 'disabled' : 'active';
    if (!store.setUserStatus(userId, status)) throw new Error('User not found');
    return { success: true, action: command, userId, status };
  }

  if (command === 'revoke-token') {
    if (!env.AUTH_TOKEN_TO_REVOKE) throw new Error('AUTH_TOKEN_TO_REVOKE is required');
    if (!store.setTokenStatus(env.AUTH_TOKEN_TO_REVOKE, 'revoked')) {
      throw new Error('Token not found');
    }
    return { success: true, action: 'revoke-token' };
  }

  if (command === 'revoke-token-hash') {
    if (!env.TOKEN_HASH_TO_REVOKE) throw new Error('TOKEN_HASH_TO_REVOKE is required');
    if (!store.setTokenStatusByHash(env.TOKEN_HASH_TO_REVOKE, 'revoked')) {
      throw new Error('Token not found');
    }
    return { success: true, action: 'revoke-token-hash', tokenHash: env.TOKEN_HASH_TO_REVOKE };
  }

  if (command === 'user-status') {
    const userId = requireUserId(rawUserId);
    const user = store.getUser(userId);
    if (!user) throw new Error('User not found');
    return {
      success: true,
      action: 'user-status',
      userId,
      status: user.status,
      plan: user.plan,
      maxDevices: user.maxDevices,
      deviceCount: store.countDevices(userId),
    };
  }

  if (command === 'list-devices') {
    const userId = requireUserId(rawUserId);
    if (!store.getUser(userId)) throw new Error('User not found');
    const devices = store.listDevices(userId);
    return {
      success: true,
      action: 'list-devices',
      userId,
      count: devices.length,
      devices,
    };
  }

  if (command === 'list-tokens') {
    const userId = requireUserId(rawUserId);
    if (!store.getUser(userId)) throw new Error('User not found');
    const tokens = store.listTokens(userId);
    return {
      success: true,
      action: 'list-tokens',
      userId,
      count: tokens.length,
      tokens,
    };
  }

  if (command === 'forget-device') {
    const userId = requireUserId(rawUserId);
    if (!store.getUser(userId)) throw new Error('User not found');
    if (!env.DEVICE_ID_TO_FORGET) throw new Error('DEVICE_ID_TO_FORGET is required');
    const result = store.forgetDevice(userId, env.DEVICE_ID_TO_FORGET);
    if (!result.removed) throw new Error('Device not found');
    return {
      success: true,
      action: 'forget-device',
      userId,
      deviceIdHash: result.deviceIdHash,
    };
  }

  if (command === 'audit-log') {
    const userId = rawUserId ? requireUserId(rawUserId) : undefined;
    const limit = parseAuditLimit(rawValue);
    const logs = store.listAuditLogs({ userId, limit });
    return {
      success: true,
      action: 'audit-log',
      userId,
      limit,
      count: logs.length,
      logs,
    };
  }

  if (command === 'audit-summary') {
    const userId = rawUserId ? requireUserId(rawUserId) : undefined;
    const windowMinutes = parseAuditWindowMinutes(rawValue);
    const summary = store.summarizeAuditLogs({
      userId,
      sinceMs: now - windowMinutes * 60 * 1000,
    });
    return {
      success: true,
      action: 'audit-summary',
      userId,
      windowMinutes,
      ...summary,
    };
  }

  if (command === 'verify-store') {
    return {
      success: true,
      action: 'verify-store',
      store: 'persistent',
      counts: store.getOperationalStats(),
    };
  }

  throw new Error('Unsupported command');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(JSON.stringify(runAdminCommand(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      message: error instanceof Error ? error.message : 'Admin command failed',
    }, null, 2));
    process.exitCode = 1;
  }
}
