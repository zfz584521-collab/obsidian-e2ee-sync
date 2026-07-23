import crypto from 'node:crypto';

const DEFAULT_MAX_DEVICES = 3;
const DEFAULT_DURATION_SECONDS = 3600;

function sortedCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function hashSecret(value, salt = '') {
  return crypto
    .createHash('sha256')
    .update(String(salt))
    .update(':')
    .update(String(value || ''))
    .digest('hex');
}

export function safeSegment(value, fallback = 'main') {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

export function makeStoragePrefix(userId, vaultId) {
  return `tenants/${safeSegment(userId, 'user')}/vaults/${safeSegment(vaultId, 'main')}`;
}

export function makeRepoId(userId, vaultId) {
  return `repo_${safeSegment(userId, 'user')}_${safeSegment(vaultId, 'main')}`;
}

export function redactAuditEvent(event, { deviceSalt = 'device', tokenSalt = 'token' } = {}) {
  const redacted = {};
  for (const field of ['userId', 'vaultId', 'result', 'status', 'createdAt']) {
    if (event[field] !== undefined) redacted[field] = event[field];
  }
  if (event.deviceId) {
    redacted.deviceIdHash = hashSecret(event.deviceId, deviceSalt);
  } else if (event.deviceIdHash) {
    redacted.deviceIdHash = event.deviceIdHash;
  }
  if (event.authToken) {
    redacted.authTokenHash = hashSecret(event.authToken, tokenSalt);
  } else if (event.authTokenHash) {
    redacted.authTokenHash = event.authTokenHash;
  }
  return redacted;
}

export class InMemoryCommercialStore {
  constructor({ tokenSalt = 'dev-token-salt', deviceSalt = 'dev-device-salt' } = {}) {
    this.tokenSalt = tokenSalt;
    this.deviceSalt = deviceSalt;
    this.users = new Map();
    this.tokens = new Map();
    this.devices = new Map();
    this.auditLogs = [];
  }

  addUser(user) {
    this.users.set(user.id, {
      status: 'active',
      plan: 'starter',
      maxDevices: DEFAULT_MAX_DEVICES,
      ...user,
    });
  }

  addToken({ token, userId, status = 'active', expiresAt }) {
    this.tokens.set(hashSecret(token, this.tokenSalt), {
      userId,
      status,
      expiresAt,
    });
  }

  findToken(token) {
    return this.tokens.get(hashSecret(token, this.tokenSalt)) || null;
  }

  getUser(userId) {
    return this.users.get(userId) || null;
  }

  setUserStatus(userId, status) {
    const user = this.users.get(userId);
    if (!user) return false;
    user.status = status;
    return true;
  }

  updateUser(userId, updates) {
    const user = this.users.get(userId);
    if (!user) return null;
    if (updates.plan !== undefined) user.plan = updates.plan;
    if (updates.maxDevices !== undefined) user.maxDevices = updates.maxDevices;
    return { ...user };
  }

  setTokenStatus(token, status) {
    const entry = this.tokens.get(hashSecret(token, this.tokenSalt));
    if (!entry) return false;
    entry.status = status;
    return true;
  }

  setTokenStatusByHash(tokenHash, status) {
    const entry = this.tokens.get(tokenHash);
    if (!entry) return false;
    entry.status = status;
    return true;
  }

  extendTokenByHash(tokenHash, expiresAt) {
    const entry = this.tokens.get(tokenHash);
    if (!entry) return null;
    entry.status = 'active';
    entry.expiresAt = expiresAt;
    return {
      tokenHash,
      userId: entry.userId,
      status: entry.status,
      expiresAt: entry.expiresAt,
    };
  }

  listTokens(userId) {
    return [...this.tokens.entries()]
      .filter(([, token]) => token.userId === userId)
      .map(([tokenHash, token]) => ({
        tokenHash,
        userId: token.userId,
        status: token.status,
        expiresAt: token.expiresAt,
      }))
      .sort((a, b) => a.tokenHash.localeCompare(b.tokenHash));
  }

  listAllTokens() {
    return [...this.tokens.entries()]
      .map(([tokenHash, token]) => ({
        tokenHash,
        userId: token.userId,
        status: token.status,
        expiresAt: token.expiresAt,
      }))
      .sort((a, b) => {
        const left = a.expiresAt || '';
        const right = b.expiresAt || '';
        return left.localeCompare(right) || a.userId.localeCompare(b.userId) || a.tokenHash.localeCompare(b.tokenHash);
      });
  }

  listUsers({ limit = 100 } = {}) {
    return [...this.users.values()]
      .map(user => ({
        userId: user.id,
        status: user.status,
        plan: user.plan,
        maxDevices: user.maxDevices,
        deviceCount: this.countDevices(user.id),
      }))
      .sort((a, b) => a.userId.localeCompare(b.userId))
      .slice(0, limit);
  }

  registerDevice(userId, deviceId, maxDevices = DEFAULT_MAX_DEVICES) {
    const key = `${userId}:${hashSecret(deviceId, this.deviceSalt)}`;
    if (this.devices.has(key)) {
      const existing = this.devices.get(key);
      existing.lastSeenAt = Date.now();
      return { accepted: true, deviceCount: this.countDevices(userId), existing: true };
    }

    const deviceCount = this.countDevices(userId);
    if (deviceCount >= maxDevices) {
      return { accepted: false, deviceCount, existing: false };
    }

    this.devices.set(key, {
      userId,
      deviceIdHash: hashSecret(deviceId, this.deviceSalt),
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    return { accepted: true, deviceCount: deviceCount + 1, existing: false };
  }

  countDevices(userId) {
    let count = 0;
    for (const device of this.devices.values()) {
      if (device.userId === userId) count++;
    }
    return count;
  }

  listDevices(userId) {
    return [...this.devices.values()]
      .filter(device => device.userId === userId)
      .map(device => ({ ...device }))
      .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  }

  forgetDevice(userId, deviceId) {
    const deviceIdHash = hashSecret(deviceId, this.deviceSalt);
    const key = `${userId}:${deviceIdHash}`;
    const removed = this.devices.delete(key);
    return { removed, deviceIdHash };
  }

  writeAudit(event) {
    this.auditLogs.push(redactAuditEvent({
      ...event,
      createdAt: Date.now(),
    }, {
      deviceSalt: this.deviceSalt,
      tokenSalt: this.tokenSalt,
    }));
  }

  listAuditLogs({ userId, limit = 20 } = {}) {
    const filtered = userId
      ? this.auditLogs.filter(event => event.userId === userId)
      : this.auditLogs;
    return filtered.slice(-limit).reverse().map(event => ({ ...event }));
  }

  summarizeAuditLogs({ userId, sinceMs } = {}) {
    const byResult = {};
    const byStatus = {};
    const filtered = this.auditLogs.filter(event => {
      if (userId && event.userId !== userId) return false;
      if (sinceMs && Number(event.createdAt || 0) < sinceMs) return false;
      return true;
    });

    for (const event of filtered) {
      const result = String(event.result || 'unknown');
      const status = String(event.status || 'unknown');
      byResult[result] = (byResult[result] || 0) + 1;
      byStatus[status] = (byStatus[status] || 0) + 1;
    }

    return {
      total: filtered.length,
      byResult: sortedCounts(byResult),
      byStatus: sortedCounts(byStatus),
    };
  }

  getOperationalStats() {
    return {
      users: this.users.size,
      tokens: this.tokens.size,
      devices: this.devices.size,
      auditLogs: this.auditLogs.length,
    };
  }
}

export function createCredentialResponse({ userId, vaultId, repoId, oss, credentials, now = Date.now() }) {
  const safeVaultId = safeSegment(vaultId, 'main');
  const generatedRepoId = makeRepoId(userId, safeVaultId);
  const finalRepoId = repoId ? safeSegment(repoId, generatedRepoId) : generatedRepoId;
  return {
    endpoint: oss.endpoint,
    bucket: oss.bucket,
    region: oss.region || 'auto',
    storagePrefix: makeStoragePrefix(userId, safeVaultId),
    repoId: finalRepoId,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret,
      securityToken: credentials.securityToken,
      expiration: credentials.expiration || new Date(now + DEFAULT_DURATION_SECONDS * 1000).toISOString(),
    },
  };
}

export function authorizeCredentialRequest({ store, authToken, body, now = Date.now() }) {
  if (!authToken) {
    return { ok: false, status: 401, message: '缺少授权令牌' };
  }
  if (!body?.deviceId) {
    return { ok: false, status: 400, message: '缺少设备 ID' };
  }

  const token = store.findToken(authToken);
  if (!token || token.status !== 'active') {
    return { ok: false, status: 401, message: '授权令牌无效或已过期' };
  }
  if (token.expiresAt && Date.parse(token.expiresAt) <= now) {
    return { ok: false, status: 401, message: '授权令牌无效或已过期' };
  }

  const user = store.getUser(token.userId);
  if (!user || user.status !== 'active') {
    return { ok: false, status: 403, message: '用户已停用或不可用' };
  }

  const device = store.registerDevice(user.id, body.deviceId, user.maxDevices);
  if (!device.accepted) {
    return { ok: false, status: 403, message: '设备数量已达到当前套餐上限' };
  }

  const vaultId = safeSegment(body.vaultId, 'main');
  const generatedRepoId = makeRepoId(user.id, vaultId);
  return {
    ok: true,
    status: 200,
    user,
    vaultId,
    repoId: body.repoId ? safeSegment(body.repoId, generatedRepoId) : generatedRepoId,
    deviceCount: device.deviceCount,
  };
}
