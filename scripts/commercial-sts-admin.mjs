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

function defaultTokenOutputPath(storePath, userId, now) {
  const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  return path.join(path.dirname(path.resolve(storePath)), `issued-token-${userId}-${timestamp}.secret`);
}

function writeTokenFile(filePath, token) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${token}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

export function runAdminCommand({
  env = process.env,
  argv = process.argv.slice(2),
  now = Date.now(),
  generateToken = () => `obsync_${crypto.randomBytes(32).toString('base64url')}`,
} = {}) {
  const [command, rawUserId, rawValue] = argv;
  const store = loadAdminStore(env);

  if (command === 'create-user') {
    const userId = requireUserId(rawUserId);
    if (store.getUser(userId)) throw new Error('User already exists');
    const maxDevices = Number(rawValue || 3);
    if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 20) {
      throw new Error('maxDevices must be an integer between 1 and 20');
    }
    store.addUser({ id: userId, status: 'active', plan: 'starter', maxDevices });
    return { success: true, action: 'create-user', userId, maxDevices };
  }

  if (command === 'issue-token') {
    const userId = requireUserId(rawUserId);
    const user = store.getUser(userId);
    if (!user || user.status !== 'active') throw new Error('Active user not found');
    const token = generateToken();
    const outputPath = path.resolve(
      env.TOKEN_OUTPUT_FILE || defaultTokenOutputPath(env.STORE_PATH, userId, now),
    );
    writeTokenFile(outputPath, token);
    store.addToken({ token, userId, status: 'active' });
    return { success: true, action: 'issue-token', userId, tokenFile: outputPath };
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
