/**
 * 重试配置
 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始延迟（毫秒） */
  initialDelay: number;
  /** 最大延迟（毫秒） */
  maxDelay: number;
  /** 延迟倍数 */
  multiplier: number;
  /** 可重试的错误类型 */
  retryableErrors: string[];
}

/** 默认重试配置 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  multiplier: 2,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNREFUSED',
    'NetworkError',
    'ServiceUnavailable',
    'InternalError',
    'SlowDown',
    'RequestTimeTooSkewed',
  ],
};

/**
 * 计算退避延迟
 */
export function calculateBackoff(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const delay = config.initialDelay * Math.pow(config.multiplier, attempt);
  const jitter = Math.random() * 0.1 * delay; // 10% 抖动
  return Math.min(delay + jitter, config.maxDelay);
}

/**
 * 判断错误是否可重试
 */
export function isRetryableError(error: unknown, config: RetryConfig = DEFAULT_RETRY_CONFIG): boolean {
  if (!(error instanceof Error)) return false;

  const errorMessage = error.message.toLowerCase();
  const errorName = (error as any).name?.toLowerCase() || '';
  const errorCode = (error as any).code?.toUpperCase() || '';

  // 检查错误码
  if (config.retryableErrors.includes(errorCode)) {
    return true;
  }

  // 检查错误消息
  for (const retryable of config.retryableErrors) {
    if (errorMessage.includes(retryable.toLowerCase()) || errorName.includes(retryable.toLowerCase())) {
      return true;
    }
  }

  // HTTP 状态码检查
  const status = (error as any).$metadata?.httpStatusCode;
  if (status === 429 || status === 503 || status === 500 || status === 502 || status === 504) {
    return true;
  }

  return false;
}

/**
 * 延迟执行
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带重试的异步操作
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 检查是否可重试
      if (attempt >= config.maxRetries || !isRetryableError(error, config)) {
        throw lastError;
      }

      // 计算延迟
      const backoff = calculateBackoff(attempt, config);

      console.log(`[重试] 第 ${attempt + 1} 次重试，等待 ${Math.round(backoff)}ms：${lastError.message}`);

      if (onRetry) {
        onRetry(attempt + 1, lastError);
      }

      await delay(backoff);
    }
  }

  throw lastError;
}
