import { App, TFile, TFolder, EventRef } from 'obsidian';
import { syncLogger } from './Logger';

/**
 * 文件变更事件
 */
export interface FileChangeEvent {
  type: 'create' | 'modify' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  timestamp: number;
}

/**
 * 文件变更回调
 */
export type FileChangeCallback = (events: FileChangeEvent[]) => void;

/**
 * 文件监听器配置
 */
export interface FileWatcherOptions {
  /** 防抖延迟（毫秒） */
  debounceDelay?: number;
  /** 批量处理间隔（毫秒） */
  batchInterval?: number;
  /** 忽略模式 */
  ignorePatterns?: string[];
  /** 最大批量大小 */
  maxBatchSize?: number;
}

/**
 * 文件监听器
 * 实时监控文件变更，支持防抖和批量处理
 */
export class FileWatcher {
  private app: App;
  private options: Required<FileWatcherOptions>;
  private pendingEvents: FileChangeEvent[] = [];
  private debounceTimer: number | null = null;
  private batchTimer: number | null = null;
  private callbacks: Set<FileChangeCallback> = new Set();
  private eventRefs: EventRef[] = [];
  private isWatching = false;

  constructor(app: App, options: FileWatcherOptions = {}) {
    this.app = app;
    this.options = {
      debounceDelay: options.debounceDelay ?? 1000,
      batchInterval: options.batchInterval ?? 2000,
      ignorePatterns: options.ignorePatterns ?? [
        '.obsidian/**',
        '.trash/**',
        '.*',
        '.sync-*',
      ],
      maxBatchSize: options.maxBatchSize ?? 100,
    };
  }

  /**
   * 开始监听
   */
  start(): void {
    if (this.isWatching) return;

    this.isWatching = true;

    // 监听文件创建
    this.eventRefs.push(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile) {
          this.handleFileEvent('create', file.path);
        }
      })
    );

    // 监听文件修改
    this.eventRefs.push(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          this.handleFileEvent('modify', file.path);
        }
      })
    );

    // 监听文件删除
    this.eventRefs.push(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile) {
          this.handleFileEvent('delete', file.path);
        }
      })
    );

    // 监听文件重命名
    this.eventRefs.push(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile) {
          this.handleFileEvent('rename', file.path, oldPath);
        }
      })
    );

    syncLogger.info('文件监听器已启动');
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (!this.isWatching) return;

    // 取消所有事件监听
    for (const ref of this.eventRefs) {
      this.app.vault.offref(ref);
    }
    this.eventRefs = [];

    // 清除定时器
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.batchTimer) {
      window.clearInterval(this.batchTimer);
      this.batchTimer = null;
    }

    // 处理剩余事件
    if (this.pendingEvents.length > 0) {
      this.flushEvents();
    }

    this.isWatching = false;
    syncLogger.info('文件监听器已停止');
  }

  /**
   * 处理文件事件
   */
  private handleFileEvent(
    type: FileChangeEvent['type'],
    path: string,
    oldPath?: string
  ): void {
    // 检查是否应该忽略
    if (this.shouldIgnore(path)) return;

    const event: FileChangeEvent = {
      type,
      path,
      oldPath,
      timestamp: Date.now(),
    };

    this.pendingEvents.push(event);
    syncLogger.debug(`文件事件: ${type} ${path}`);

    // 防抖处理
    this.scheduleDebounce();

    // 启动批量处理定时器
    if (!this.batchTimer) {
      this.batchTimer = window.setInterval(() => {
        this.flushEvents();
      }, this.options.batchInterval);
    }

    // 检查批量大小
    if (this.pendingEvents.length >= this.options.maxBatchSize) {
      this.flushEvents();
    }
  }

  /**
   * 调度防抖
   */
  private scheduleDebounce(): void {
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
    }, this.options.debounceDelay);
  }

  /**
   * 刷新事件队列
   */
  private flushEvents(): void {
    if (this.pendingEvents.length === 0) return;

    // 合并相似事件
    const mergedEvents = this.mergeEvents([...this.pendingEvents]);
    this.pendingEvents = [];

    // 通知回调
    if (mergedEvents.length > 0) {
      syncLogger.info(`处理 ${mergedEvents.length} 个文件变更事件`);
      this.callbacks.forEach(callback => callback(mergedEvents));
    }
  }

  /**
   * 合并相似事件
   */
  private mergeEvents(events: FileChangeEvent[]): FileChangeEvent[] {
    const eventMap = new Map<string, FileChangeEvent>();

    for (const event of events) {
      const key = event.path;

      // 如果已有该路径的事件，检查是否需要更新
      const existing = eventMap.get(key);

      if (!existing) {
        eventMap.set(key, event);
      } else {
        // 合并逻辑：最新的覆盖旧的
        // 但删除操作优先
        if (event.type === 'delete') {
          eventMap.set(key, event);
        } else if (existing.type !== 'delete') {
          eventMap.set(key, event);
        }
      }
    }

    return Array.from(eventMap.values());
  }

  /**
   * 检查路径是否应该忽略
   */
  private shouldIgnore(path: string): boolean {
    for (const pattern of this.options.ignorePatterns) {
      if (this.matchPattern(path, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 简单模式匹配
   */
  private matchPattern(path: string, pattern: string): boolean {
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      return path.startsWith(prefix);
    }
    if (pattern.startsWith('*.') || pattern === '.*') {
      // 扩展名匹配
      const ext = pattern.slice(1);
      if (pattern === '.*') {
        return path.split('/').some(part => part.startsWith('.'));
      }
      return path.endsWith(ext);
    }
    return path === pattern;
  }

  /**
   * 注册变更回调
   */
  onChange(callback: FileChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * 获取待处理事件数量
   */
  getPendingCount(): number {
    return this.pendingEvents.length;
  }

  /**
   * 手动触发刷新
   */
  flush(): void {
    this.flushEvents();
  }

  /**
   * 检查是否正在监听
   */
  isActive(): boolean {
    return this.isWatching;
  }
}
