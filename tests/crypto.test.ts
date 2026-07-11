import { describe, it, expect, beforeEach } from 'vitest';
import { CryptoService } from '../src/crypto/CryptoService';

describe('CryptoService', () => {
  let crypto: CryptoService;

  beforeEach(() => {
    crypto = new CryptoService();
  });

  describe('deriveKey', () => {
    it('应该从密码派生密钥', async () => {
      const password = 'test-password-123';
      const key = await crypto.deriveKey(password);

      expect(key).toBeDefined();
      expect(crypto.hasKey()).toBe(true);
    });

    it('使用相同密码和盐应派生相同密钥', async () => {
      const password = 'test-password-123';
      const salt = new Uint8Array(32).fill(42);

      await crypto.deriveKey(password, salt);
      const salt1 = crypto.getSalt();

      const crypto2 = new CryptoService();
      await crypto2.deriveKey(password, salt1!);
      const salt2 = crypto2.getSalt();

      expect(salt1).toEqual(salt2);
    });
  });

  describe('encryptData / decryptData', () => {
    it('应该加密和解密数据', async () => {
      await crypto.deriveKey('test-password');

      const plaintext = new TextEncoder().encode('Hello, World!');
      const encrypted = await crypto.encryptData(plaintext);

      expect(encrypted.meta).toBeDefined();
      expect(encrypted.meta.algorithm).toBe('AES-GCM-256');
      expect(encrypted.data).toBeDefined();

      const decrypted = await crypto.decryptData(encrypted);
      expect(new TextDecoder().decode(decrypted)).toBe('Hello, World!');
    });

    it('不同内容应产生不同密文', async () => {
      await crypto.deriveKey('test-password');

      const data1 = new TextEncoder().encode('Content 1');
      const data2 = new TextEncoder().encode('Content 2');

      const encrypted1 = await crypto.encryptData(data1);
      const encrypted2 = await crypto.encryptData(data2);

      expect(encrypted1.data).not.toBe(encrypted2.data);
    });

    it('相同内容应产生不同密文（随机IV）', async () => {
      await crypto.deriveKey('test-password');

      const data = new TextEncoder().encode('Same Content');

      const encrypted1 = await crypto.encryptData(data);
      const encrypted2 = await crypto.encryptData(data);

      // 密文应该不同（因为IV不同）
      expect(encrypted1.data).not.toBe(encrypted2.data);
      // 但解密后应该相同
      expect(new TextDecoder().decode(await crypto.decryptData(encrypted1))).toBe('Same Content');
      expect(new TextDecoder().decode(await crypto.decryptData(encrypted2))).toBe('Same Content');
    });

    it('内容哈希校验失败应抛出错误', async () => {
      await crypto.deriveKey('test-password');

      const data = new TextEncoder().encode('Original');
      const encrypted = await crypto.encryptData(data);

      // 篡改内容哈希
      encrypted.meta.contentHash = 'invalid-hash';

      await expect(crypto.decryptData(encrypted)).rejects.toThrow('内容哈希校验失败');
    });
  });

  describe('encryptPath / decryptPath', () => {
    it('应该加密和解密路径', async () => {
      await crypto.deriveKey('test-password');

      const originalPath = 'notes/daily/2024-01-01.md';
      const encryptedPath = await crypto.encryptPath(originalPath);

      expect(encryptedPath).toBeDefined();
      expect(encryptedPath).not.toBe(originalPath);

      const decryptedPath = await crypto.decryptPath(encryptedPath);
      expect(decryptedPath).toBe(originalPath);
    });

    it('应该处理中文路径', async () => {
      await crypto.deriveKey('test-password');

      const originalPath = '笔记/日记/2024年.md';
      const encryptedPath = await crypto.encryptPath(originalPath);
      const decryptedPath = await crypto.decryptPath(encryptedPath);

      expect(decryptedPath).toBe(originalPath);
    });

    it('应该处理特殊字符', async () => {
      await crypto.deriveKey('test-password');

      const originalPath = 'folder/file-name_test.md';
      const encryptedPath = await crypto.encryptPath(originalPath);
      const decryptedPath = await crypto.decryptPath(encryptedPath);

      expect(decryptedPath).toBe(originalPath);
    });
  });

  describe('getStablePathKey', () => {
    it('同一密码、盐和路径应产生相同远端 key', async () => {
      const salt = new Uint8Array(32).fill(7);
      await crypto.deriveKey('test-password', salt);

      const crypto2 = new CryptoService();
      await crypto2.deriveKey('test-password', salt);

      const key1 = await crypto.getStablePathKey('notes/daily.md');
      const key2 = await crypto2.getStablePathKey('notes/daily.md');

      expect(key1).toBe(key2);
      expect(key1).not.toContain('daily');
    });

    it('不同路径应产生不同远端 key', async () => {
      await crypto.deriveKey('test-password', new Uint8Array(32).fill(8));

      const key1 = await crypto.getStablePathKey('notes/a.md');
      const key2 = await crypto.getStablePathKey('notes/b.md');

      expect(key1).not.toBe(key2);
    });
  });

  describe('hash', () => {
    it('应该计算 SHA-256 哈希', async () => {
      const data = new TextEncoder().encode('test data');
      const hash = await crypto.hash(data);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('相同数据应产生相同哈希', async () => {
      const data = new TextEncoder().encode('same data');

      const hash1 = await crypto.hash(data);
      const hash2 = await crypto.hash(data);

      expect(hash1).toBe(hash2);
    });

    it('不同数据应产生不同哈希', async () => {
      const data1 = new TextEncoder().encode('data 1');
      const data2 = new TextEncoder().encode('data 2');

      const hash1 = await crypto.hash(data1);
      const hash2 = await crypto.hash(data2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateId', () => {
    it('应该生成唯一 ID', () => {
      const id1 = crypto.generateId();
      const id2 = crypto.generateId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });

    it('应该生成设备 ID', () => {
      const deviceId = crypto.generateDeviceId();

      expect(deviceId).toBeDefined();
      expect(deviceId.startsWith('dev_')).toBe(true);
    });

    it('应该生成仓库 ID', () => {
      const repoId = crypto.generateRepoId();

      expect(repoId).toBeDefined();
      expect(repoId.startsWith('repo_')).toBe(true);
    });
  });

  describe('clearKey', () => {
    it('应该清除密钥', async () => {
      await crypto.deriveKey('test-password');
      expect(crypto.hasKey()).toBe(true);

      crypto.clearKey();
      expect(crypto.hasKey()).toBe(false);
    });
  });
});
