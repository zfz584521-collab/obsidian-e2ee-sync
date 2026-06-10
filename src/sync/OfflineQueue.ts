import { App, Notice } from 'obsidian';
import { syncLogger } from '../utils/Logger';

/**
 * 队列操作类型
 */
export type QueueOperationType = 'upload' | 'download' | 'delete' | 'move';

/**
 * 队列操作
 */
export interface QueueOperation {
  /** 操作 ID */
  id: string;
  /** 操作类型 */
  type: QueueOperationType;
  /** 文件路径 */
  path: string;
  /** 旧路径（用于移动） */
  oldPath?: string;
  /** 创建时间 */
  createdAt: number;
  /** 重试次数 */
  retryCount: number;
  /** 最后错误 */
  lastError?: string;
  /** 优先级（数字越小优先级越高） */
  priority: number;
  /** 操作数据 */
  data?: Uint8Array;
}

/**
 * 离线队列配置
 */
export interface OfflineQueueConfig {
  /** 最大队列大小 */
  maxQueueSize: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 操作超时（毫秒） */
  operationTimeout: number;
  /** 自动重试间隔（毫秒） */
  retryInterval: number;
}

const DEFAULT_QUEUE_CONFIG: OfflineQueueConfig = {
  maxQueueSize: 1000,
  maxRetries: 3,
  operationTimeout: 30000,
  retryInterval: 5000,
};

/**
 * 离线队列管理器
 */
export class OfflineQueueManager {
  private app: App;
  private config: OfflineQueueConfig;
  private queue: QueueOperation[] = [];
  private isProcessing = false;
  private isOnline = true;
  private storageKey = 'offline-queue';
  private processor: ((op: QueueOperation) => Promise<boolean>) | null = null;

  constructor(app: App, config: Partial<OfflineQueueConfig> = {}) {
    this.app = app;
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    await this.loadQueue();
    syncLogger.info(`离线队列初始化，共 ${this.queue.length} 个待处理操作`);
  }

  /**
   * 设置操作处理器
   */
  setProcessor(processor: (op: QueueOperation) => Promise<boolean>): void {
    this.processor = processor;
  }

  /**
   * 加载队列
   */
  private async loadQueue(): Promise<void> {
    syncLogger.debug('加载离线队列');
  }

  /**
   * 保存队列
   */
  private async saveQueue(): Promise<void> {
    syncLogger.debug('保存离线队列');
  }

  /**
   * 添加操作到队列
   */
  async addOperation(
    type: QueueOperationType,
    path: string,
    options?: {
      oldPath?: string;
      priority?: number;
      data?: Uint8Array;
    }
  ): Promise<QueueOperation> {
    // 检查队列大小
    if (this.queue.length >= this.config.maxQueueSize) {
      // 移除最旧的低优先级操作
      this.queue.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
      this.queue.pop();
    }

    const operation: QueueOperation = {
      id: this.generateOperationId(),
      type,
      path,
      oldPath: options?.oldPath,
      createdAt: Date.now(),
      retryCount: 0,
      priority: options?.priority ?? 10,
      data: options?.data,
    };

    // 合并相同路径的操作
    this.mergeOperations(operation);

    this.queue.push(operation);
    await this.saveQueue();

    syncLogger.debug(`添加队列操作: ${type} ${path}`);

    // 如果在线且有处理器，尝试处理
    if (this.isOnline && this.processor && !this.isProcessing) {
      this.processQueue();
    }

    return operation;
  }

  /**
   * 合并相同路径的操作
   */
  private mergeOperations(newOp: QueueOperation): void {
    // 移除相同路径的旧操作（某些情况）
    this.queue = this.queue.filter(op => {
      if (op.path !== newOp.path) return true;

      // 如果新操作是删除，移除之前的上传/修改操作
      if (newOp.type === 'delete' && (op.type === 'upload' || op.type === 'download')) {
        return false;
      }

      return true;
    });
  }

  /**
   * 处理队列
   */
  async processQueue(): Promise<void> {
    if (this.isProcessing || !this.processor || !this.isOnline) return;

    this.isProcessing = true;
    syncLogger.info(`开始处理离线队列，共 ${this.queue.length} 个操作`);

    // 按优先级排序
    this.queue.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);

    const completed: QueueOperation[] = [];
    const failed: QueueOperation[] = [];

    for (const operation of this.queue) {
      try {
        const success = await this.processor(operation);

        if (success) {
          completed.push(operation);
          syncLogger.debug(`操作完成: ${operation.type} ${operation.path}`);
        } else {
          operation.retryCount++;
          operation.lastError = '操作失败';
          if (operation.retryCount < this.config.maxRetries) {
            failed.push(operation);
          } else {
            syncLogger.error(`操作超过最大重试次数: ${operation.path}`);
          }
        }
      } catch (error) {
        operation.retryCount++;
        operation.lastError = error instanceof Error ? error.message : '未知错误';
        if (operation.retryCount < this.config.maxRetries) {
          failed.push(operation);
        }
      }
    }

    // 更新队列
    this.queue = failed;
    await this.saveQueue();

    this.isProcessing = false;

    if (completed.length > 0) {
      syncLogger.info(`完成 ${completed.length} 个操作`);
    }
    if (failed.length > 0) {
      syncLogger.warn(`${failed.length} 个操作待重试`);
    }
  }

  /**
   * 设置在线状态
   */
  setOnlineStatus(online: boolean): void {
    const wasOffline = !this.isOnline;
    this.isOnline = online;

    if (online && wasOffline && this.queue.length > 0) {
      syncLogger.info('网络恢复，开始处理队列');
      new Notice(`网络恢复，正在同步 ${this.queue.length} 个待处理操作`);
      this.processQueue();
    } else if (!online) {
      syncLogger.info('网络断开，操作将加入队列');
    }
  }

  /**
   * 获取队列大小
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * 获取队列状态
   */
  getQueueStatus(): {
    total: number;
    byType: Record<QueueOperationType, number>;
    oldestPending: number | null;
  } {
    const byType: Record<QueueOperationType, number> = {
      upload: 0,
      download: 0,
      delete: 0,
      move: 0,
    };

    let oldestPending: number | null = null;

    for (const op of this.queue) {
      byType[op.type]++;
      if (!oldestPending || op.createdAt < oldestPending) {
        oldestPending = op.createdAt;
      }
    }

    return { total: this.queue.length, byType, oldestPending };
  }

  /**
   * 清空队列
   */
  async clearQueue(): Promise<void> {
    this.queue = [];
    await this.saveQueue();
    syncLogger.info('队列已清空');
  }

  /**
   * 移除操作
   */
  async removeOperation(operationId: string): Promise<boolean> {
    const index = this.queue.findIndex(op => op.id === operationId);
    if (index === -1) return false;

    this.queue.splice(index, 1);
    await this.saveQueue();
    return true;
  }

  /**
   * 生成操作 ID
   */
  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 检查是否在线
   */
  isOnlineStatus(): boolean {
    return this.isOnline;
  }

  /**
   * 检查是否正在处理
   */
  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }
}
