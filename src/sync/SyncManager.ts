import { App, Notice, TFile } from 'obsidian';
import { SyncSettings, SyncStatus, SyncResult, SyncEvent } from '../types';
import { LocalIndex } from './LocalIndex';
import { RemoteStorage } from './RemoteStorage';
import { CryptoService } from '../crypto/CryptoService';
import { ConcurrentQueue } from '../utils/concurrency';
import { IncrementalSync, SyncStatsCollector } from '../utils/incremental';
import { SyncStateManager } from '../utils/progress';
import { SyncError, SyncErrorCode } from '../utils/errors';

/** 数据持久化接口 */
export interface DataPersistence {
  loadData(): Promise<Record<string, unknown>>;
  saveData(data: Record<string, unknown>): Promise<void>;
  saveSettings(): Promise<void>;
}

/** 同步选项 */
export interface SyncOptions {
  /** 并发上传数 */
  concurrentUploads?: number;
  /** 并发下载数 */
  concurrentDownloads?: number;
  /** 是否使用增量同步 */
  incremental?: boolean;
  /** 单文件大小限制（字节） */
  maxFileSize?: number;
}

/** 默认同步选项 */
const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  concurrentUploads: 5,
  concurrentDownloads: 5,
  incremental: true,
  maxFileSize: 100 * 1024 * 1024, // 100MB
};

/**
 * 同步管理器
 * 协调所有同步操作
 */
export class SyncManager {
  private app: App;
  private persistence: DataPersistence;
  private settings: SyncSettings;
  private options: SyncOptions;
  public localIndex: LocalIndex;
  private remoteStorage: RemoteStorage;
  public crypto: CryptoService;
  private stateManager: SyncStateManager;
  private incrementalSync: IncrementalSync | null = null;
  private status: SyncStatus = 'idle';
  private syncIntervalId: number | null = null;
  private localClock: number = 0;
  private statsCollector: SyncStatsCollector;
  private abortController: AbortController | null = null;

  constructor(
    app: App,
    persistence: DataPersistence,
    settings: SyncSettings,
    options: Partial<SyncOptions> = {}
  ) {
    this.app = app;
    this.persistence = persistence;
    this.settings = settings;
    this.options = { ...DEFAULT_SYNC_OPTIONS, ...options };
    this.crypto = new CryptoService();
    this.localIndex = new LocalIndex(app, this.crypto);
    this.remoteStorage = new RemoteStorage();
    this.stateManager = new SyncStateManager();
    this.statsCollector = new SyncStatsCollector();
  }

  /**
   * 初始化同步管理器
   */
  async initialize(): Promise<void> {
    console.log('[同步管理器] 正在初始化...');

    // 设置持久化
    this.stateManager.setPersistence({
      loadData: () => this.persistence.loadData(),
      saveData: (data) => this.persistence.saveData(data),
    });

    // 加载状态
    await this.stateManager.load();

    // 初始化本地索引
    await this.localIndex.initialize();

    // 加载本地时钟
    this.localClock = this.stateManager.getLocalClock();

    // 初始化增量同步
    this.incrementalSync = new IncrementalSync(this.app, this.localIndex.getIndex());

    // 如果启用自动同步则设置
    if (this.settings.autoSync && this.settings.syncInterval > 0) {
      this.startAutoSync();
    }

    console.log('[同步管理器] 初始化完成');
  }

  /**
   * 测试远端连接
   */
  async testConnection(): Promise<boolean> {
    if (!this.isConfigured()) {
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, '同步未配置，请检查设置');
    }

    await this.initCrypto();
    this.remoteStorage.setConfig(this.settings.s3);
    return await this.remoteStorage.testConnection();
  }

  /**
   * 初始化加密
   */
  private async initCrypto(): Promise<void> {
    if (this.crypto.hasKey()) return;

    if (!this.settings.syncPassword) {
      throw new SyncError(SyncErrorCode.KEY_DERIVATION_FAILED, '同步密码未设置');
    }

    const saltBase = this.settings.repoId || 'default-sync-repo';
    const encoder = new TextEncoder();
    const salt = encoder.encode(saltBase);

    const fullSalt = new Uint8Array(32);
    fullSalt.set(salt.slice(0, 32), 0);
    for (let i = salt.length; i < 32; i++) {
      fullSalt[i] = i;
    }

    await this.crypto.deriveKey(this.settings.syncPassword, fullSalt);
    console.log('[同步管理器] 加密初始化完成');
  }

  /**
   * 开始同步周期
   */
  async startSync(): Promise<SyncResult> {
    console.log('[同步管理器] 开始同步...');

    if (this.status === 'syncing') {
      new Notice('同步正在进行中');
      return { success: false, uploaded: 0, downloaded: 0, conflicts: 0, errors: ['同步正在进行中'] };
    }

    this.status = 'syncing';
    this.abortController = new AbortController();
    this.statsCollector.start();

    const result: SyncResult = {
      success: true,
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
      errors: [],
    };

    try {
      // 检查配置
      if (!this.isConfigured()) {
        throw new SyncError(SyncErrorCode.CONFIG_MISSING, '同步未配置，请检查设置。');
      }

      // 初始化加密
      await this.initCrypto();
      new Notice('正在同步...');

      // 更新进度
      this.stateManager.startSync();

      // 连接远端存储
      this.remoteStorage.setConfig(this.settings.s3);
      await this.remoteStorage.testConnection();

      // 确保仓库存在
      await this.ensureRepo();

      // 检测变更
      this.stateManager.updateProgress({ phase: 'scanning' });
      const changes = await this.detectChanges();

      // 上传变更（并发）
      this.stateManager.updateProgress({ phase: 'uploading', total: changes.toUpload.length });
      result.uploaded = await this.uploadChangesConcurrent(changes.toUpload);

      // 拉取远端变更（并发）
      this.stateManager.updateProgress({ phase: 'downloading' });
      const pullResult = await this.pullRemoteChangesConcurrent(changes.toDownload);
      result.downloaded = pullResult.downloaded;
      result.conflicts = pullResult.conflicts;

      // 保存状态
      await this.localIndex.save();
      await this.stateManager.completeSync('success');

      // 显示统计
      const stats = this.statsCollector.getStats();
      const message = this.formatSyncMessage(result, stats);
      new Notice(message);

    } catch (error) {
      console.error('[同步管理器] 同步失败：', error);
      const syncError = SyncError.fromError(error);
      result.success = false;
      result.errors.push(syncError.getUserMessage());
      this.status = 'error';
      await this.stateManager.completeSync('error', syncError.message);
      new Notice(`同步失败：${syncError.getUserMessage()}`);
      return result;
    }

    this.status = 'idle';
    this.abortController = null;
    return result;
  }

  /**
   * 检测变更
   */
  private async detectChanges(): Promise<{
    toUpload: Array<{ path: string; type: 'create' | 'modify' | 'delete' }>;
    toDownload: string[];
  }> {
    if (!this.incrementalSync) {
      // 降级到基本检测
      const changes = await this.localIndex.scanChanges();
      return {
        toUpload: [
          ...changes.created.map(p => ({ path: p, type: 'create' as const })),
          ...changes.modified.map(p => ({ path: p, type: 'modify' as const })),
          ...changes.deleted.map(p => ({ path: p, type: 'delete' as const })),
        ],
        toDownload: [],
      };
    }

    // 使用增量同步检测
    const changes = await this.incrementalSync.detectChanges((current, total) => {
      this.stateManager.updateProgress({ processed: current, total });
    });

    const toUpload = changes.map(c => ({
      path: c.path,
      type: c.type === 'created' ? 'create' as const :
            c.type === 'modified' ? 'modify' as const : 'delete' as const,
    }));

    return { toUpload, toDownload: [] };
  }

  /**
   * 并发上传变更
   */
  private async uploadChangesConcurrent(
    changes: Array<{ path: string; type: 'create' | 'modify' | 'delete' }>
  ): Promise<number> {
    if (changes.length === 0) return 0;

    let uploaded = 0;

    const queue = new ConcurrentQueue(
      async (change: { path: string; type: 'create' | 'modify' | 'delete' }) => {
        if (this.abortController?.signal.aborted) {
          throw new Error('同步已取消');
        }

        try {
          if (change.type === 'delete') {
            await this.deleteFile(change.path);
          } else {
            await this.uploadFile(change.path);
          }
          uploaded++;
          this.statsCollector.recordFile(0);
          this.stateManager.updateProgress({
            processed: uploaded,
            currentFile: change.path,
          });
        } catch (error) {
          console.error(`[同步管理器] 上传失败 ${change.path}：`, error);
          throw error;
        }
      },
      { maxConcurrent: this.options.concurrentUploads || 5 }
    );

    await queue.addAll(changes);
    return uploaded;
  }

  /**
   * 上传单个文件
   */
  private async uploadFile(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new SyncError(SyncErrorCode.FILE_NOT_FOUND, `文件不存在：${path}`);
    }

    // 检查文件大小
    if (file.stat.size > (this.options.maxFileSize || 100 * 1024 * 1024)) {
      throw new SyncError(SyncErrorCode.FILE_TOO_LARGE, `文件过大：${path}`);
    }

    const content = await this.app.vault.readBinary(file);
    const contentBytes = new Uint8Array(content);

    // 加密
    const encryptedPackage = await this.crypto.encryptData(contentBytes);
    const encryptedPath = await this.crypto.encryptPath(path);

    // 序列化
    const packageJson = JSON.stringify(encryptedPackage);
    const packageBytes = new TextEncoder().encode(packageJson);

    // 上传
    const versionId = await this.remoteStorage.upload(encryptedPath, packageBytes);

    // 更新索引
    await this.localIndex.updateIndex(path);

    // 记录事件
    await this.appendEvent({
      type: 'create',
      path: path,
      contentHash: encryptedPackage.meta.contentHash,
    });

    console.log(`[同步管理器] 已上传：${path} (v${versionId})`);
  }

  /**
   * 删除远端文件
   */
  private async deleteFile(path: string): Promise<void> {
    const encryptedPath = await this.crypto.encryptPath(path);
    await this.remoteStorage.delete(encryptedPath);
    this.localIndex.removeFromIndex(path);

    await this.appendEvent({ type: 'delete', path });
    console.log(`[同步管理器] 已删除：${path}`);
  }

  /**
   * 并发拉取远端变更
   */
  private async pullRemoteChangesConcurrent(
    _paths: string[]
  ): Promise<{ downloaded: number; conflicts: number }> {
    // TODO: 实现完整的远端同步
    return { downloaded: 0, conflicts: 0 };
  }

  /**
   * 确保仓库元数据存在
   */
  private async ensureRepo(): Promise<void> {
    if (!this.settings.repoId) {
      this.settings.repoId = this.crypto.generateRepoId();
      await this.persistence.saveSettings();
      console.log('[同步管理器] 创建新仓库：', this.settings.repoId);
    }

    const metadata = await this.remoteStorage.getRepoMetadata(this.settings.repoId);
    if (!metadata) {
      await this.remoteStorage.createRepoMetadata(this.settings.repoId, {
        repoId: this.settings.repoId,
        protocolVersion: '1.0.0',
        createdAt: Date.now(),
        devices: [{
          deviceId: this.settings.deviceId,
          name: this.settings.deviceName || 'Unknown Device',
          lastActive: Date.now(),
        }],
        retentionDays: 30,
      });
      console.log('[同步管理器] 仓库元数据已创建');
    }
  }

  /**
   * 追加事件到日志
   */
  private async appendEvent(event: Partial<SyncEvent>): Promise<void> {
    this.localClock++;

    const fullEvent: SyncEvent = {
      id: this.crypto.generateId(),
      deviceId: this.settings.deviceId,
      clock: this.localClock,
      type: event.type || 'modify',
      path: event.path || '',
      contentHash: event.contentHash,
      oldPath: event.oldPath,
      parentId: event.parentId || '',
      timestamp: Date.now(),
    };

    const eventJson = JSON.stringify(fullEvent);
    const encryptedEvent = await this.crypto.encryptData(new TextEncoder().encode(eventJson));
    const logData = new TextEncoder().encode(JSON.stringify(encryptedEvent));

    await this.remoteStorage.uploadLog(this.settings.deviceId, logData, this.localClock);
    this.stateManager.updateLocalClock(this.localClock);
  }

  /**
   * 格式化同步消息
   */
  private formatSyncMessage(result: SyncResult, stats: any): string {
    const parts: string[] = [];
    if (result.uploaded > 0) parts.push(`上传 ${result.uploaded}`);
    if (result.downloaded > 0) parts.push(`下载 ${result.downloaded}`);
    if (result.conflicts > 0) parts.push(`冲突 ${result.conflicts}`);

    if (parts.length === 0) {
      return '同步完成：无变更';
    }

    const time = stats.timeElapsed < 60
      ? `${stats.timeElapsed.toFixed(1)}秒`
      : `${Math.floor(stats.timeElapsed / 60)}分${Math.floor(stats.timeElapsed % 60)}秒`;

    return `同步完成：${parts.join('、')}（${time}）`;
  }

  /**
   * 取消同步
   */
  cancelSync(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.status = 'idle';
      new Notice('同步已取消');
    }
  }

  /**
   * 停止同步
   */
  stopSync(): void {
    console.log('[同步管理器] 停止同步...');
    this.status = 'idle';
  }

  /**
   * 开始自动同步
   */
  startAutoSync(): void {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
    }

    const intervalMs = this.settings.syncInterval * 1000;
    this.syncIntervalId = window.setInterval(() => {
      this.startSync();
    }, intervalMs);

    console.log(`[同步管理器] 自动同步已启动（间隔 ${this.settings.syncInterval} 秒）`);
  }

  /**
   * 停止自动同步
   */
  stopAutoSync(): void {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    console.log('[同步管理器] 自动同步已停止');
  }

  /**
   * 获取当前同步状态
   */
  getStatus(): SyncStatus {
    return this.status;
  }

  /**
   * 获取同步进度
   */
  getProgress() {
    return this.stateManager.getProgress();
  }

  /**
   * 监听进度变化
   */
  onProgress(callback: (progress: any) => void) {
    return this.stateManager.onProgress(callback);
  }

  /**
   * 检查同步是否已配置
   */
  isConfigured(): boolean {
    const { s3, syncPassword } = this.settings;
    return Boolean(
      s3.endpoint &&
      s3.bucket &&
      s3.accessKey &&
      s3.secretKey &&
      syncPassword
    );
  }

  /**
   * 更新设置
   */
  updateSettings(settings: SyncSettings): void {
    this.settings = settings;

    if (this.crypto.hasKey()) {
      this.crypto.clearKey();
    }

    if (settings.autoSync && settings.syncInterval > 0) {
      this.startAutoSync();
    } else {
      this.stopAutoSync();
    }
  }

  /**
   * 获取本地索引大小
   */
  getLocalFileCount(): number {
    return this.localIndex.getIndexSize();
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.stopAutoSync();
    this.cancelSync();
    this.crypto.clearKey();
    this.remoteStorage.destroy();
    console.log('[同步管理器] 已销毁');
  }
}
