/**
 * 同步进度状态
 */
export interface SyncProgress {
  /** 当前阶段 */
  phase: 'idle' | 'scanning' | 'uploading' | 'downloading' | 'applying' | 'completed' | 'error';
  /** 当前处理的文件 */
  currentFile?: string;
  /** 已处理数量 */
  processed: number;
  /** 总数量 */
  total: number;
  /** 已上传字节数 */
  uploadedBytes: number;
  /** 已下载字节数 */
  downloadedBytes: number;
  /** 错误信息 */
  error?: string;
  /** 开始时间 */
  startTime?: number;
  /** 预估剩余时间（秒） */
  estimatedTimeRemaining?: number;
}

/**
 * 同步状态持久化
 */
export interface SyncState {
  /** 上次同步时间 */
  lastSyncTime: number;
  /** 上次同步状态 */
  lastSyncStatus: 'success' | 'error' | 'aborted';
  /** 上次处理的文件 */
  lastProcessedFile?: string;
  /** 本地时钟 */
  localClock: number;
  /** 远端时钟（各设备最新） */
  remoteClocks: Record<string, number>;
  /** 待上传队列 */
  pendingUploads: string[];
  /** 待下载队列 */
  pendingDownloads: string[];
  /** 失败记录 */
  failedOperations: FailedOperation[];
}

/**
 * 失败的操作
 */
export interface FailedOperation {
  /** 操作类型 */
  type: 'upload' | 'download' | 'delete';
  /** 文件路径 */
  path: string;
  /** 错误信息 */
  error: string;
  /** 失败次数 */
  attempts: number;
  /** 最后失败时间 */
  lastAttempt: number;
}

/**
 * 数据持久化接口
 */
export interface PersistenceHandler {
  loadData(): Promise<any>;
  saveData(data: any): Promise<void>;
}

/**
 * 同步状态管理器
 */
export class SyncStateManager {
  private persistence: PersistenceHandler | null = null;
  private state: SyncState;
  private progress: SyncProgress;
  private progressCallbacks: Set<(progress: SyncProgress) => void> = new Set();
  private stateKey = 'sync-state';

  constructor() {
    this.progress = {
      phase: 'idle',
      processed: 0,
      total: 0,
      uploadedBytes: 0,
      downloadedBytes: 0,
    };
    this.state = {
      lastSyncTime: 0,
      lastSyncStatus: 'success',
      localClock: 0,
      remoteClocks: {},
      pendingUploads: [],
      pendingDownloads: [],
      failedOperations: [],
    };
  }

  /**
   * 设置持久化处理器
   */
  setPersistence(persistence: PersistenceHandler): void {
    this.persistence = persistence;
  }

  /**
   * 加载状态
   */
  async load(): Promise<void> {
    if (!this.persistence) return;

    try {
      const data = await this.persistence.loadData();
      if (data?.[this.stateKey]) {
        this.state = { ...this.state, ...data[this.stateKey] };
      }
    } catch (error) {
      console.warn('[状态管理器] 加载状态失败：', error);
    }
  }

  /**
   * 保存状态
   */
  async save(): Promise<void> {
    if (!this.persistence) return;

    try {
      const existing = await this.persistence.loadData() || {};
      existing[this.stateKey] = this.state;
      await this.persistence.saveData(existing);
    } catch (error) {
      console.warn('[状态管理器] 保存状态失败：', error);
    }
  }

  /**
   * 获取当前状态
   */
  getState(): SyncState {
    return { ...this.state };
  }

  /**
   * 获取当前进度
   */
  getProgress(): SyncProgress {
    return { ...this.progress };
  }

  /**
   * 更新进度
   */
  updateProgress(update: Partial<SyncProgress>): void {
    this.progress = { ...this.progress, ...update };

    // 计算预估时间
    if (this.progress.startTime && this.progress.processed > 0 && this.progress.total > 0) {
      const elapsed = (Date.now() - this.progress.startTime) / 1000;
      const rate = this.progress.processed / elapsed;
      const remaining = (this.progress.total - this.progress.processed) / rate;
      this.progress.estimatedTimeRemaining = Math.round(remaining);
    }

    this.notifyProgress();
  }

  /**
   * 开始同步
   */
  startSync(): void {
    this.progress = {
      phase: 'scanning',
      processed: 0,
      total: 0,
      uploadedBytes: 0,
      downloadedBytes: 0,
      startTime: Date.now(),
    };
    this.notifyProgress();
  }

  /**
   * 完成同步
   */
  async completeSync(status: 'success' | 'error' | 'aborted', error?: string): Promise<void> {
    this.progress.phase = status === 'success' ? 'completed' : 'error';
    this.progress.error = error;
    this.state.lastSyncTime = Date.now();
    this.state.lastSyncStatus = status;
    this.notifyProgress();
    await this.save();
  }

  /**
   * 添加失败操作
   */
  addFailedOperation(op: Omit<FailedOperation, 'attempts' | 'lastAttempt'>): void {
    const existing = this.state.failedOperations.find(
      f => f.type === op.type && f.path === op.path
    );

    if (existing) {
      existing.attempts++;
      existing.lastAttempt = Date.now();
      existing.error = op.error;
    } else {
      this.state.failedOperations.push({
        ...op,
        attempts: 1,
        lastAttempt: Date.now(),
      });
    }
  }

  /**
   * 清除失败操作
   */
  clearFailedOperations(): void {
    this.state.failedOperations = [];
  }

  /**
   * 获取可重试的失败操作
   */
  getRetryableOperations(maxAttempts: number = 3): FailedOperation[] {
    return this.state.failedOperations.filter(op => op.attempts < maxAttempts);
  }

  /**
   * 更新本地时钟
   */
  updateLocalClock(clock: number): void {
    this.state.localClock = Math.max(this.state.localClock, clock);
  }

  /**
   * 获取本地时钟
   */
  getLocalClock(): number {
    return this.state.localClock;
  }

  /**
   * 注册进度回调
   */
  onProgress(callback: (progress: SyncProgress) => void): () => void {
    this.progressCallbacks.add(callback);
    return () => this.progressCallbacks.delete(callback);
  }

  /**
   * 通知进度更新
   */
  private notifyProgress(): void {
    this.progressCallbacks.forEach(cb => cb(this.getProgress()));
  }
}
