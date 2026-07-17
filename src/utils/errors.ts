/**
 * 同步错误类型
 */
export enum SyncErrorCode {
  // 配置错误
  CONFIG_MISSING = 'CONFIG_MISSING',
  CONFIG_INVALID = 'CONFIG_INVALID',

  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',

  // S3 错误
  S3_ACCESS_DENIED = 'S3_ACCESS_DENIED',
  S3_BUCKET_NOT_FOUND = 'S3_BUCKET_NOT_FOUND',
  S3_QUOTA_EXCEEDED = 'S3_QUOTA_EXCEEDED',
  S3_SERVICE_ERROR = 'S3_SERVICE_ERROR',

  // 加密错误
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  KEY_DERIVATION_FAILED = 'KEY_DERIVATION_FAILED',
  HASH_MISMATCH = 'HASH_MISMATCH',

  // 文件错误
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_READ_ERROR = 'FILE_READ_ERROR',
  FILE_WRITE_ERROR = 'FILE_WRITE_ERROR',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',

  // 同步错误
  SYNC_IN_PROGRESS = 'SYNC_IN_PROGRESS',
  SYNC_CONFLICT = 'SYNC_CONFLICT',
  SYNC_ABORTED = 'SYNC_ABORTED',
  REMOTE_LAYOUT_MIGRATION_REQUIRED = 'REMOTE_LAYOUT_MIGRATION_REQUIRED',

  // 未知错误
  UNKNOWN = 'UNKNOWN',
}

/**
 * 同步错误类
 */
export class SyncError extends Error {
  code: SyncErrorCode;
  cause?: Error;
  recoverable: boolean;
  retryAfter?: number;

  constructor(
    code: SyncErrorCode,
    message: string,
    options?: {
      cause?: Error;
      recoverable?: boolean;
      retryAfter?: number;
    }
  ) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.cause = options?.cause;
    this.recoverable = options?.recoverable ?? false;
    this.retryAfter = options?.retryAfter;
  }

  /**
   * 获取用户友好的错误消息
   */
  getUserMessage(): string {
    if (
      this.message &&
      /^(获取临时同步凭证失败|缺少授权|授权服务返回)/.test(this.message)
    ) {
      return this.message;
    }

    const messages: Record<SyncErrorCode, string> = {
      [SyncErrorCode.CONFIG_MISSING]: '同步未配置，请检查设置',
      [SyncErrorCode.CONFIG_INVALID]: '配置无效，请检查 S3 设置和同步密码',

      [SyncErrorCode.NETWORK_ERROR]: '网络连接失败，请检查网络',
      [SyncErrorCode.CONNECTION_TIMEOUT]: '连接超时，请稍后重试',
      [SyncErrorCode.CONNECTION_REFUSED]: '连接被拒绝，请检查端点地址',

      [SyncErrorCode.S3_ACCESS_DENIED]: 'S3 访问被拒绝，请检查访问密钥',
      [SyncErrorCode.S3_BUCKET_NOT_FOUND]: '存储桶不存在，请检查存储桶名称',
      [SyncErrorCode.S3_QUOTA_EXCEEDED]: '存储空间不足',
      [SyncErrorCode.S3_SERVICE_ERROR]: 'S3 服务错误，请稍后重试',

      [SyncErrorCode.ENCRYPTION_FAILED]: '加密失败',
      [SyncErrorCode.DECRYPTION_FAILED]: '解密失败，可能是密码错误',
      [SyncErrorCode.KEY_DERIVATION_FAILED]: '密钥派生失败',
      [SyncErrorCode.HASH_MISMATCH]: '数据校验失败，文件可能已损坏',

      [SyncErrorCode.FILE_NOT_FOUND]: '文件不存在',
      [SyncErrorCode.FILE_READ_ERROR]: '文件读取失败',
      [SyncErrorCode.FILE_WRITE_ERROR]: '文件写入失败',
      [SyncErrorCode.FILE_TOO_LARGE]: '文件过大，请使用大文件同步功能',

      [SyncErrorCode.SYNC_IN_PROGRESS]: '同步正在进行中',
      [SyncErrorCode.SYNC_CONFLICT]: '检测到同步冲突',
      [SyncErrorCode.SYNC_ABORTED]: '同步已中止',
      [SyncErrorCode.REMOTE_LAYOUT_MIGRATION_REQUIRED]: '检测到旧版远端数据布局，请先迁移或重新初始化同步仓库',

      [SyncErrorCode.UNKNOWN]: '未知错误',
    };

    return messages[this.code] || this.message;
  }

  /**
   * 从原始错误创建 SyncError
   */
  static fromError(error: unknown): SyncError {
    if (error instanceof SyncError) {
      return error;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      const code = (error as any).code?.toUpperCase() || '';
      const status = (error as any).$metadata?.httpStatusCode;

      // S3 错误
      if (code === 'ACCESS_DENIED' || status === 403) {
        return new SyncError(SyncErrorCode.S3_ACCESS_DENIED, error.message, { cause: error, recoverable: false });
      }
      if (code === 'NO_SUCH_BUCKET' || status === 404) {
        return new SyncError(SyncErrorCode.S3_BUCKET_NOT_FOUND, error.message, { cause: error, recoverable: false });
      }
      if (status === 503 || code === 'SERVICE_UNAVAILABLE') {
        return new SyncError(SyncErrorCode.S3_SERVICE_ERROR, error.message, { cause: error, recoverable: true, retryAfter: 60 });
      }

      // 网络错误
      if (message.includes('network') || message.includes('econnreset') || code === 'ECONNRESET') {
        return new SyncError(SyncErrorCode.NETWORK_ERROR, error.message, { cause: error, recoverable: true });
      }
      if (message.includes('timeout') || code === 'ETIMEDOUT') {
        return new SyncError(SyncErrorCode.CONNECTION_TIMEOUT, error.message, { cause: error, recoverable: true });
      }

      // 加密错误
      if (message.includes('decrypt') || message.includes('authentication')) {
        return new SyncError(SyncErrorCode.DECRYPTION_FAILED, error.message, { cause: error, recoverable: false });
      }
      if (message.includes('hash')) {
        return new SyncError(SyncErrorCode.HASH_MISMATCH, error.message, { cause: error, recoverable: false });
      }

      return new SyncError(SyncErrorCode.UNKNOWN, error.message, { cause: error, recoverable: false });
    }

    return new SyncError(SyncErrorCode.UNKNOWN, String(error), { recoverable: false });
  }
}

/**
 * 断言函数
 */
export function assert(condition: boolean, code: SyncErrorCode, message: string): asserts condition {
  if (!condition) {
    throw new SyncError(code, message);
  }
}
