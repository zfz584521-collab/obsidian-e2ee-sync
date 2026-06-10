/**
 * 并发控制选项
 */
export interface ConcurrencyOptions {
  /** 最大并发数 */
  maxConcurrent: number;
  /** 每个任务的超时时间（毫秒） */
  timeout?: number;
  /** 失败重试次数 */
  retries?: number;
}

/**
 * 并发任务队列
 */
export class ConcurrentQueue<T, R> {
  private options: ConcurrencyOptions;
  private queue: Array<{
    item: T;
    resolve: (result: R) => void;
    reject: (error: Error) => void;
  }> = [];
  private running = 0;
  private processor: (item: T) => Promise<R>;
  private results: Array<{ item: T; result?: R; error?: Error }> = [];

  constructor(
    processor: (item: T) => Promise<R>,
    options: Partial<ConcurrencyOptions> = {}
  ) {
    this.processor = processor;
    this.options = {
      maxConcurrent: options.maxConcurrent || 5,
      timeout: options.timeout || 60000,
      retries: options.retries || 0,
    };
  }

  /**
   * 添加任务到队列
   */
  add(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      this.processNext();
    });
  }

  /**
   * 批量添加任务
   */
  addAll(items: T[]): Promise<R[]> {
    return Promise.all(items.map(item => this.add(item)));
  }

  /**
   * 处理下一个任务
   */
  private processNext(): void {
    if (this.running >= this.options.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.running++;
    const task = this.queue.shift()!;

    this.executeWithRetry(task.item)
      .then(result => {
        task.resolve(result);
        this.results.push({ item: task.item, result });
      })
      .catch(error => {
        task.reject(error);
        this.results.push({ item: task.item, error });
      })
      .finally(() => {
        this.running--;
        this.processNext();
      });
  }

  /**
   * 带重试的执行
   */
  private async executeWithRetry(item: T): Promise<R> {
    let lastError: Error | null = null;
    const attempts = (this.options.retries || 0) + 1;

    for (let i = 0; i < attempts; i++) {
      try {
        // 带超时执行
        const result = await this.executeWithTimeout(item);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (i < attempts - 1) {
          // 等待一段时间后重试
          await this.delay(1000 * (i + 1));
        }
      }
    }

    throw lastError;
  }

  /**
   * 带超时的执行
   */
  private executeWithTimeout(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`任务超时 (${this.options.timeout}ms)`));
      }, this.options.timeout);

      this.processor(item)
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取当前状态
   */
  getStatus(): { pending: number; running: number; completed: number } {
    return {
      pending: this.queue.length,
      running: this.running,
      completed: this.results.length,
    };
  }

  /**
   * 等待所有任务完成
   */
  async waitAll(): Promise<Array<{ item: T; result?: R; error?: Error }>> {
    while (this.running > 0 || this.queue.length > 0) {
      await this.delay(100);
    }
    return this.results;
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue.forEach(task => {
      task.reject(new Error('队列已清空'));
    });
    this.queue = [];
  }
}

/**
 * 并发执行任务
 */
export async function concurrentMap<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  options: Partial<ConcurrencyOptions> = {}
): Promise<R[]> {
  const queue = new ConcurrentQueue(processor, options);
  return queue.addAll(items);
}

/**
 * 分批处理
 */
export async function batchProcess<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await processor(batch);
    results.push(...batchResults);
  }

  return results;
}
