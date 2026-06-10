import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConcurrentQueue, concurrentMap, batchProcess } from '../src/utils/concurrency';

describe('ConcurrentQueue', () => {
  let queue: ConcurrentQueue<number, number>;

  beforeEach(() => {
    queue = new ConcurrentQueue(
      async (n: number) => n * 2,
      { maxConcurrent: 3 }
    );
  });

  describe('add', () => {
    it('应该添加任务并返回结果', async () => {
      const result = await queue.add(5);
      expect(result).toBe(10);
    });

    it('应该按顺序处理任务', async () => {
      const results = await Promise.all([
        queue.add(1),
        queue.add(2),
        queue.add(3),
      ]);
      expect(results).toEqual([2, 4, 6]);
    });
  });

  describe('addAll', () => {
    it('应该批量处理任务', async () => {
      const results = await queue.addAll([1, 2, 3, 4, 5]);
      expect(results).toEqual([2, 4, 6, 8, 10]);
    });
  });

  describe('getStatus', () => {
    it('应该返回当前状态', async () => {
      const status = queue.getStatus();
      expect(status.pending).toBe(0);
      expect(status.running).toBe(0);
      expect(status.completed).toBe(0);
    });
  });

  describe('并发控制', () => {
    it('应该限制并发数', async () => {
      let running = 0;
      let maxRunning = 0;

      const slowQueue = new ConcurrentQueue(
        async (n: number) => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await new Promise(r => setTimeout(r, 50));
          running--;
          return n;
        },
        { maxConcurrent: 2 }
      );

      await slowQueue.addAll([1, 2, 3, 4, 5]);
      expect(maxRunning).toBeLessThanOrEqual(2);
    });
  });

  describe('超时处理', () => {
    it('应该在超时后拒绝', async () => {
      const timeoutQueue = new ConcurrentQueue(
        async () => {
          await new Promise(r => setTimeout(r, 1000));
          return 'done';
        },
        { maxConcurrent: 1, timeout: 50 }
      );

      await expect(timeoutQueue.add(1)).rejects.toThrow('超时');
    });
  });

  describe('重试机制', () => {
    it('应该在失败时重试', async () => {
      let attempts = 0;

      const retryQueue = new ConcurrentQueue(
        async () => {
          attempts++;
          if (attempts < 3) throw new Error('失败');
          return 'success';
        },
        { maxConcurrent: 1, retries: 3 }
      );

      const result = await retryQueue.add(1);
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });
  });
});

describe('concurrentMap', () => {
  it('应该并发处理并返回结果', async () => {
    const results = await concurrentMap(
      [1, 2, 3],
      async (n) => n * 2,
      { maxConcurrent: 2 }
    );

    expect(results).toEqual([2, 4, 6]);
  });
});

describe('batchProcess', () => {
  it('应该分批处理', async () => {
    const batches: number[][] = [];

    const results = await batchProcess(
      [1, 2, 3, 4, 5],
      2,
      async (batch) => {
        batches.push(batch);
        return batch.map(n => n * 2);
      }
    );

    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(batches).toEqual([[1, 2], [3, 4], [5]]);
  });
});
