import { describe, it, expect, vi, beforeEach } from 'vitest';

// 简化的 Mock
vi.mock('obsidian', () => ({
  App: class MockApp {
    vault = {
      getFiles: vi.fn(() => []),
      readBinary: vi.fn(),
      getAbstractFileByPath: vi.fn(),
    };
  },
  TFile: class MockTFile {},
  Notice: class MockNotice {},
}));

import { LocalIndex } from '../src/sync/LocalIndex';
import { CryptoService } from '../src/crypto/CryptoService';

describe('LocalIndex', () => {
  let localIndex: LocalIndex;
  let crypto: CryptoService;
  let mockVault: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    crypto = new CryptoService();
    await crypto.deriveKey('test-password');

    mockVault = {
      getFiles: vi.fn(() => []),
      readBinary: vi.fn(() => Promise.resolve(new ArrayBuffer(10))),
      getAbstractFileByPath: vi.fn(),
    };

    const mockApp = { vault: mockVault };
    localIndex = new LocalIndex(mockApp as any, crypto);
  });

  describe('initialize', () => {
    it('应该初始化索引', async () => {
      mockVault.getFiles.mockReturnValue([]);
      await localIndex.initialize();
      expect(localIndex.getIndexSize()).toBe(0);
    });
  });

  describe('getIndexSize', () => {
    it('应该返回索引大小', async () => {
      mockVault.getFiles.mockReturnValue([]);
      await localIndex.initialize();
      expect(localIndex.getIndexSize()).toBe(0);
    });
  });

  describe('removeFromIndex', () => {
    it('应该从索引中移除文件', async () => {
      mockVault.getFiles.mockReturnValue([]);
      await localIndex.initialize();
      localIndex.removeFromIndex('test.md');
      expect(localIndex.getIndexSize()).toBe(0);
    });
  });
});
