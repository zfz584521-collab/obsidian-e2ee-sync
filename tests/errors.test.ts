import { describe, it, expect } from 'vitest';
import { SyncError, SyncErrorCode } from '../src/utils/errors';

describe('SyncError', () => {
  describe('构造函数', () => {
    it('应该创建错误实例', () => {
      const error = new SyncError(SyncErrorCode.NETWORK_ERROR, '网络错误');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SyncError);
      expect(error.code).toBe(SyncErrorCode.NETWORK_ERROR);
      expect(error.message).toBe('网络错误');
    });

    it('应该保存原因错误', () => {
      const cause = new Error('原始错误');
      const error = new SyncError(SyncErrorCode.NETWORK_ERROR, '网络错误', { cause });

      expect(error.cause).toBe(cause);
    });

    it('应该设置可恢复标志', () => {
      const error = new SyncError(SyncErrorCode.NETWORK_ERROR, '网络错误', {
        recoverable: true,
      });

      expect(error.recoverable).toBe(true);
    });

    it('应该设置重试延迟', () => {
      const error = new SyncError(SyncErrorCode.S3_SERVICE_ERROR, '服务不可用', {
        retryAfter: 60,
      });

      expect(error.retryAfter).toBe(60);
    });
  });

  describe('getUserMessage', () => {
    it('应该返回用户友好的消息', () => {
      const error = new SyncError(SyncErrorCode.CONFIG_MISSING, '');

      expect(error.getUserMessage()).toBe('同步未配置，请检查设置');
    });

    it('应该为所有错误码返回消息', () => {
      const codes = Object.values(SyncErrorCode);

      for (const code of codes) {
        const error = new SyncError(code, '');
        expect(error.getUserMessage()).toBeTruthy();
      }
    });

    it('应该保留 STS 授权错误的具体中文说明', () => {
      const error = new SyncError(SyncErrorCode.NETWORK_ERROR, '获取临时同步凭证失败：授权令牌无效');

      expect(error.getUserMessage()).toBe('获取临时同步凭证失败：授权令牌无效');
    });

    it('应该保留已脱敏的 STS 连接错误说明', () => {
      const messages = [
        '授权服务连接超时，请稍后重试',
        '无法连接授权服务，请检查网络或服务地址',
        '授权服务请求失败，请稍后重试',
      ];

      for (const message of messages) {
        const error = new SyncError(SyncErrorCode.NETWORK_ERROR, message);
        expect(error.getUserMessage()).toBe(message);
      }
    });
  });

  describe('fromError', () => {
    it('应该保留 SyncError 实例', () => {
      const original = new SyncError(SyncErrorCode.NETWORK_ERROR, '网络错误');
      const converted = SyncError.fromError(original);

      expect(converted).toBe(original);
    });

    it('应该转换 S3 访问拒绝错误', () => {
      const error = new Error('Access denied');
      (error as any).code = 'ACCESS_DENIED';

      const converted = SyncError.fromError(error);

      expect(converted.code).toBe(SyncErrorCode.S3_ACCESS_DENIED);
      expect(converted.recoverable).toBe(false);
    });

    it('应该转换 403 状态码错误', () => {
      const error = new Error('Forbidden');
      (error as any).$metadata = { httpStatusCode: 403 };

      const converted = SyncError.fromError(error);

      expect(converted.code).toBe(SyncErrorCode.S3_ACCESS_DENIED);
    });

    it('应该转换网络错误', () => {
      const error = new Error('ECONNRESET');
      (error as any).code = 'ECONNRESET';

      const converted = SyncError.fromError(error);

      expect(converted.code).toBe(SyncErrorCode.NETWORK_ERROR);
      expect(converted.recoverable).toBe(true);
    });

    it('应该转换解密错误', () => {
      const error = new Error('Decryption failed: authentication error');

      const converted = SyncError.fromError(error);

      expect(converted.code).toBe(SyncErrorCode.DECRYPTION_FAILED);
    });

    it('应该转换未知错误', () => {
      const converted = SyncError.fromError('some string');

      expect(converted.code).toBe(SyncErrorCode.UNKNOWN);
    });
  });
});
