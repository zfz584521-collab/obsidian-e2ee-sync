import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CryptoService } from '../src/crypto/CryptoService';
import { SyncRulesManager } from '../src/sync/SyncRules';
import { ConcurrentQueue } from '../src/utils/concurrency';

/**
 * 集成测试
 * 测试完整的同步流程
 */
describe('集成测试', () => {
  describe('加密流程', () => {
    let crypto: CryptoService;

    beforeEach(async () => {
      crypto = new CryptoService();
      await crypto.deriveKey('test-password-123');
    });

    it('完整的加密-上传-下载-解密流程', async () => {
      // 原始内容
      const originalContent = new TextEncoder().encode('# 测试笔记\n\n这是一个测试文件。');

      // 加密
      const encrypted = await crypto.encryptData(originalContent);
      expect(encrypted.meta).toBeDefined();
      expect(encrypted.data).toBeDefined();

      // 模拟传输（序列化-反序列化）
      const json = JSON.stringify(encrypted);
      const received = JSON.parse(json);

      // 解密
      const decrypted = await crypto.decryptData(received);
      const decryptedText = new TextDecoder().decode(decrypted);

      expect(decryptedText).toBe('# 测试笔记\n\n这是一个测试文件。');
    });

    it('路径加密-解密流程', async () => {
      const originalPath = '笔记/2024年/06月/测试笔记.md';

      const encryptedPath = await crypto.encryptPath(originalPath);
      expect(encryptedPath).not.toBe(originalPath);
      expect(encryptedPath).not.toContain('笔记');

      const decryptedPath = await crypto.decryptPath(encryptedPath);
      expect(decryptedPath).toBe(originalPath);
    });

    it('中文文件名处理', async () => {
      const paths = [
        '笔记/测试.md',
        '📁 文件夹/📄 文档.pdf',
        '标签/#重要#紧急.md',
      ];

      for (const path of paths) {
        const encrypted = await crypto.encryptPath(path);
        const decrypted = await crypto.decryptPath(encrypted);
        expect(decrypted).toBe(path);
      }
    });
  });

  describe('同步规则', () => {
    let rulesManager: SyncRulesManager;

    beforeEach(() => {
      rulesManager = new SyncRulesManager();
    });

    it('规则过滤流程', () => {
      rulesManager.setRules([
        { type: 'exclude', pattern: '.obsidian/**', enabled: true },
        { type: 'exclude', pattern: 'attachments/**', enabled: true },
        { type: 'include', pattern: 'important/**', enabled: true },
      ]);

      // 应该排除
      expect(rulesManager.shouldSync('.obsidian/config')).toBe(false);
      expect(rulesManager.shouldSync('attachments/image.png')).toBe(false);

      // 应该包含
      expect(rulesManager.shouldSync('notes/test.md')).toBe(true);
      expect(rulesManager.shouldSync('important/secret.md')).toBe(true);
    });

    it('Glob 模式匹配', () => {
      rulesManager.setRules([
        { type: 'exclude', pattern: '.obsidian/**', enabled: true },
        { type: 'exclude', pattern: 'cache/**', enabled: true },
      ]);

      expect(rulesManager.shouldSync('.obsidian/config')).toBe(false);
      expect(rulesManager.shouldSync('cache/data.json')).toBe(false);
      expect(rulesManager.shouldSync('notes/test.md')).toBe(true);
      expect(rulesManager.shouldSync('folder/test.md')).toBe(true);
    });
  });

  describe('并发处理', () => {
    it('并发上传模拟', async () => {
      const results: number[] = [];

      const queue = new ConcurrentQueue(
        async (n: number) => {
          await new Promise(r => setTimeout(r, 10));
          results.push(n * 2);
          return n * 2;
        },
        { maxConcurrent: 3 }
      );

      const outputs = await queue.addAll([1, 2, 3, 4, 5]);

      expect(outputs).toEqual([2, 4, 6, 8, 10]);
      expect(results.length).toBe(5);
    });

    it('错误处理不影响其他任务', async () => {
      const successResults: number[] = [];

      const queue = new ConcurrentQueue(
        async (n: number) => {
          if (n === 3) throw new Error('模拟失败');
          successResults.push(n);
          return n;
        },
        { maxConcurrent: 2, retries: 0 }
      );

      // 应该有一个失败
      const results = await Promise.allSettled([
        queue.add(1),
        queue.add(2),
        queue.add(3),
        queue.add(4),
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled.length).toBe(3);
      expect(rejected.length).toBe(1);
    });
  });

  describe('端到端同步模拟', () => {
    it('完整同步流程模拟', async () => {
      // 1. 初始化加密
      const crypto = new CryptoService();
      await crypto.deriveKey('sync-password');

      // 2. 准备文件
      const files = [
        { path: 'notes/test.md', content: '# Test' },
        { path: 'attachments/image.png', content: 'binary-data' },
      ];

      // 3. 加密所有文件
      const encryptedFiles = [];
      for (const file of files) {
        const content = new TextEncoder().encode(file.content);
        const encrypted = await crypto.encryptData(content);
        const encryptedPath = await crypto.encryptPath(file.path);
        encryptedFiles.push({
          originalPath: file.path,
          encryptedPath,
          encrypted,
        });
      }

      // 4. 验证
      expect(encryptedFiles.length).toBe(2);
      for (const ef of encryptedFiles) {
        expect(ef.encryptedPath).toBeDefined();
        expect(ef.encrypted.data).toBeDefined();
      }

      // 5. 模拟下载和解密
      for (const ef of encryptedFiles) {
        const decrypted = await crypto.decryptData(ef.encrypted);
        const text = new TextDecoder().decode(decrypted);
        const originalFile = files.find(f => f.path === ef.originalPath);
        expect(text).toBe(originalFile?.content);
      }
    });

    it('冲突检测模拟', async () => {
      const crypto = new CryptoService();
      await crypto.deriveKey('sync-password');

      // 本地版本
      const localContent = new TextEncoder().encode('本地修改');
      const localEncrypted = await crypto.encryptData(localContent);
      const localHash = localEncrypted.meta.contentHash;

      // 远端版本
      const remoteContent = new TextEncoder().encode('远端修改');
      const remoteEncrypted = await crypto.encryptData(remoteContent);
      const remoteHash = remoteEncrypted.meta.contentHash;

      // 哈希不同 = 冲突
      expect(localHash).not.toBe(remoteHash);
    });
  });
});

describe('性能测试', () => {
  it('加密性能', async () => {
    const crypto = new CryptoService();
    await crypto.deriveKey('test-password');

    // 1KB 数据
    const smallData = new Uint8Array(1024).fill(42);
    const startSmall = performance.now();
    await crypto.encryptData(smallData);
    const smallTime = performance.now() - startSmall;

    // 应该在 100ms 内完成
    expect(smallTime).toBeLessThan(100);
  });

  it('批量加密性能', async () => {
    const crypto = new CryptoService();
    await crypto.deriveKey('test-password');

    const files = Array.from({ length: 10 }, (_, i) =>
      new TextEncoder().encode(`File ${i} content`)
    );

    const start = performance.now();

    await Promise.all(files.map(f => crypto.encryptData(f)));

    const time = performance.now() - start;

    // 10 个文件应该在 1 秒内完成
    expect(time).toBeLessThan(1000);
  });

  it('并发队列性能', async () => {
    const queue = new ConcurrentQueue(
      async (n: number) => {
        await new Promise(r => setTimeout(r, 5));
        return n;
      },
      { maxConcurrent: 10 }
    );

    const start = performance.now();
    await queue.addAll(Array.from({ length: 50 }, (_, i) => i));
    const time = performance.now() - start;

    // 50 个任务，并发 10，每个 5ms，理论上 ~250ms
    expect(time).toBeLessThan(500);
  });
});
