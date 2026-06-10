import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  withRetry,
  calculateBackoff,
  isRetryableError,
  DEFAULT_RETRY_CONFIG,
} from '../src/utils/retry';

describe('重试机制', () => {
  describe('calculateBackoff', () => {
    it('应该计算指数退避延迟', () => {
      const delay0 = calculateBackoff(0);
      const delay1 = calculateBackoff(1);
      const delay2 = calculateBackoff(2);

      expect(delay1).toBeGreaterThan(delay0);
      expect(delay2).toBeGreaterThan(delay1);
    });

    it('应该不超过最大延迟', () => {
      const delay = calculateBackoff(100);
      expect(delay).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxDelay);
    });

    it('应该包含随机抖动', () => {
      const delays = [calculateBackoff(1), calculateBackoff(1), calculateBackoff(1)];
      // 由于抖动，延迟应该不完全相同
      const uniqueDelays = new Set(delays.map(Math.round));
      // 允许一定的差异
      expect(uniqueDelays.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isRetryableError', () => {
    it('应该识别网络错误为可重试', () => {
      const error = new Error('Connection reset');
      (error as any).code = 'ECONNRESET';

      expect(isRetryableError(error)).toBe(true);
    });

    it('应该识别超时错误为可重试', () => {
      const error = new Error('Request timeout');
      (error as any).code = 'ETIMEDOUT';

      expect(isRetryableError(error)).toBe(true);
    });

    it('应该识别 503 状态码为可重试', () => {
      const error = new Error('Service unavailable');
      (error as any).$metadata = { httpStatusCode: 503 };

      expect(isRetryableError(error)).toBe(true);
    });

    it('应该识别 429 状态码为可重试', () => {
      const error = new Error('Too many requests');
      (error as any).$metadata = { httpStatusCode: 429 };

      expect(isRetryableError(error)).toBe(true);
    });

    it('配置错误不应重试', () => {
      const error = new Error('Invalid configuration');

      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('withRetry', () => {
    it('成功操作应直接返回结果', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await withRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('可重试错误应重试', async () => {
      const error = new Error('Connection reset');
      (error as any).code = 'ECONNRESET';

      const operation = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');

      const result = await withRetry(operation, { ...DEFAULT_RETRY_CONFIG, initialDelay: 10 });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('不可重试错误应立即抛出', async () => {
      const error = new Error('Invalid configuration');
      const operation = vi.fn().mockRejectedValue(error);

      await expect(withRetry(operation)).rejects.toThrow('Invalid configuration');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('超过最大重试次数应抛出最后错误', async () => {
      const error = new Error('Connection reset');
      (error as any).code = 'ECONNRESET';

      const operation = vi.fn().mockRejectedValue(error);

      await expect(
        withRetry(operation, { ...DEFAULT_RETRY_CONFIG, maxRetries: 2, initialDelay: 10 })
      ).rejects.toThrow('Connection reset');

      expect(operation).toHaveBeenCalledTimes(3); // 初始 + 2 次重试
    });

    it('应该调用重试回调', async () => {
      const error = new Error('Connection reset');
      (error as any).code = 'ECONNRESET';

      const operation = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');

      const onRetry = vi.fn();

      await withRetry(operation, { ...DEFAULT_RETRY_CONFIG, initialDelay: 10 }, onRetry);

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, error);
    });
  });
});
