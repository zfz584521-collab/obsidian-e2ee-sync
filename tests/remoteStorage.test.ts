import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('obsidian', () => ({
  requestUrl: vi.fn(),
}));

import { RemoteStorage, shouldForcePathStyle } from '../src/sync/RemoteStorage';

// 不实际连接 S3，只测试基本逻辑
describe('RemoteStorage', () => {
  let storage: RemoteStorage;

  beforeEach(() => {
    storage = new RemoteStorage();
  });

  describe('setConfig', () => {
    it('应该设置配置', () => {
      const config = {
        endpoint: 'https://s3.amazonaws.com',
        bucket: 'test-bucket',
        accessKey: 'test-key',
        secretKey: 'test-secret',
        region: 'us-east-1',
      };

      storage.setConfig(config);

      expect(storage.isConnected()).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('未连接时应该返回 false', () => {
      expect(storage.isConnected()).toBe(false);
    });
  });

  describe('destroy', () => {
    it('应该清理资源', () => {
      storage.destroy();
      expect(storage.isConnected()).toBe(false);
    });
  });
});

describe('shouldForcePathStyle', () => {
  it('uses virtual-hosted style for Alibaba Cloud OSS endpoints', () => {
    expect(shouldForcePathStyle('https://oss-cn-hangzhou.aliyuncs.com')).toBe(false);
  });

  it('keeps path-style requests for generic S3-compatible endpoints', () => {
    expect(shouldForcePathStyle('https://minio.example.com')).toBe(true);
  });
});
