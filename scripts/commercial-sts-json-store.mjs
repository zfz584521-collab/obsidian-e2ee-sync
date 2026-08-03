import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { InMemoryCommercialStore } from './commercial-sts-core.mjs';

const STORE_VERSION = 1;
const DEFAULT_AUDIT_LIMIT = 10_000;

export class JsonFileCommercialStore extends InMemoryCommercialStore {
  constructor({ filePath, tokenSalt, deviceSalt, auditLimit = DEFAULT_AUDIT_LIMIT }) {
    super({ tokenSalt, deviceSalt });
    if (!filePath) throw new Error('filePath is required');
    this.filePath = path.resolve(filePath);
    this.auditLimit = auditLimit;
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (data.version !== STORE_VERSION) {
      throw new Error('Unsupported commercial store version');
    }
    this.users = new Map((data.users || []).map(user => [user.id, user]));
    this.tokens = new Map((data.tokens || []).map(token => [token.tokenHash, {
      userId: token.userId,
      status: token.status,
      expiresAt: token.expiresAt,
    }]));
    this.devices = new Map((data.devices || []).map(device => [device.key, device.value]));
    this.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  }

  refresh() {
    this.load();
  }

  persist() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    const payload = JSON.stringify({
      version: STORE_VERSION,
      users: [...this.users.values()],
      tokens: [...this.tokens.entries()].map(([tokenHash, token]) => ({
        tokenHash,
        ...token,
      })),
      devices: [...this.devices.entries()].map(([key, value]) => ({ key, value })),
      auditLogs: this.auditLogs.slice(-this.auditLimit),
    }, null, 2);
    try {
      fs.writeFileSync(tempPath, payload, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  addUser(user) {
    this.refresh();
    super.addUser(user);
    this.persist();
  }

  addToken(token) {
    this.refresh();
    super.addToken(token);
    this.persist();
  }

  findToken(token) {
    this.refresh();
    return super.findToken(token);
  }

  getUser(userId) {
    this.refresh();
    return super.getUser(userId);
  }

  setUserStatus(userId, status) {
    this.refresh();
    const changed = super.setUserStatus(userId, status);
    if (changed) this.persist();
    return changed;
  }

  updateUser(userId, updates) {
    this.refresh();
    const user = super.updateUser(userId, updates);
    if (user) this.persist();
    return user;
  }

  setTokenStatus(token, status) {
    this.refresh();
    const changed = super.setTokenStatus(token, status);
    if (changed) this.persist();
    return changed;
  }

  setTokenStatusByHash(tokenHash, status) {
    this.refresh();
    const changed = super.setTokenStatusByHash(tokenHash, status);
    if (changed) this.persist();
    return changed;
  }

  extendTokenByHash(tokenHash, expiresAt) {
    this.refresh();
    const token = super.extendTokenByHash(tokenHash, expiresAt);
    if (token) this.persist();
    return token;
  }

  registerDevice(userId, deviceId, maxDevices) {
    this.refresh();
    const result = super.registerDevice(userId, deviceId, maxDevices);
    if (result.accepted) this.persist();
    return result;
  }

  forgetDevice(userId, deviceId) {
    this.refresh();
    const result = super.forgetDevice(userId, deviceId);
    if (result.removed) this.persist();
    return result;
  }

  writeAudit(event) {
    this.refresh();
    super.writeAudit(event);
    if (this.auditLogs.length > this.auditLimit) {
      this.auditLogs = this.auditLogs.slice(-this.auditLimit);
    }
    this.persist();
  }

  listTokens(userId) {
    this.refresh();
    return super.listTokens(userId);
  }

  listAllTokens() {
    this.refresh();
    return super.listAllTokens();
  }

  listUsers(options) {
    this.refresh();
    return super.listUsers(options);
  }

  countDevices(userId) {
    this.refresh();
    return super.countDevices(userId);
  }

  listDevices(userId) {
    this.refresh();
    return super.listDevices(userId);
  }

  listAuditLogs(options) {
    this.refresh();
    return super.listAuditLogs(options);
  }

  summarizeAuditLogs(options) {
    this.refresh();
    return super.summarizeAuditLogs(options);
  }

  getOperationalStats() {
    this.refresh();
    return super.getOperationalStats();
  }
}
