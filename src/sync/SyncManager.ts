import { App, Notice, TFile } from 'obsidian';
import { EncryptedPackage, RepoMetadata, SyncSettings, SyncStatus, SyncResult, SyncEvent, IndexEntry } from '../types';
import { LocalIndex } from './LocalIndex';
import { RemoteLayoutMigrationResult, RemoteLayoutStatus, RemoteStorage } from './RemoteStorage';
import { StsCredentialProvider } from './StsCredentialProvider';
import { CryptoService } from '../crypto/CryptoService';
import { ConcurrentQueue } from '../utils/concurrency';
import { IncrementalSync, SyncStatsCollector } from '../utils/incremental';
import { SyncStateManager } from '../utils/progress';
import { SyncError, SyncErrorCode } from '../utils/errors';
import { SyncRulesManager } from './SyncRules';

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
  private credentialProvider: StsCredentialProvider;
  private stateManager: SyncStateManager;
  private incrementalSync: IncrementalSync | null = null;
  private status: SyncStatus = 'idle';
  private syncIntervalId: number | null = null;
  private localClock: number = 0;
  private statsCollector: SyncStatsCollector;
  private abortController: AbortController | null = null;
  private rulesManager: SyncRulesManager;
  private static readonly LOCAL_INDEX_KEY = 'local-index';
  private static readonly PLUGIN_VERSION = '0.1.1';

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
    this.credentialProvider = new StsCredentialProvider();
    this.stateManager = new SyncStateManager();
    this.statsCollector = new SyncStatsCollector();
    this.rulesManager = new SyncRulesManager(settings.syncRules || []);
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

    // 初始化本地索引，并从持久化状态恢复上次成功同步后的基线
    await this.localIndex.initialize();
    const data = await this.persistence.loadData();
    this.localIndex.importIndex(data?.[SyncManager.LOCAL_INDEX_KEY] as Record<string, IndexEntry> | undefined);

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

    await this.configureRemoteStorage();
    await this.initCrypto();
    return await this.remoteStorage.testConnection();
  }

  async detectRemoteLayout(): Promise<RemoteLayoutStatus> {
    if (!this.isConfigured()) {
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, 'Sync is not configured');
    }

    await this.ensureLocalRepoId();
    await this.configureRemoteStorage();
    await this.remoteStorage.testConnection();
    return this.remoteStorage.detectLayout(this.settings.repoId);
  }

  async migrateLegacyRemoteLayout(): Promise<RemoteLayoutMigrationResult> {
    if (!this.isConfigured()) {
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, 'Sync is not configured');
    }

    await this.ensureLocalRepoId();
    await this.configureRemoteStorage();
    await this.remoteStorage.testConnection();
    return this.remoteStorage.migrateLegacyLayout(this.settings.repoId);
  }

  /**
   * 初始化加密
   */
  private async initCrypto(): Promise<void> {
    if (this.crypto.hasKey()) return;

    await this.ensureLocalRepoId();

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

      new Notice('正在同步...');

      // 更新进度
      this.stateManager.startSync();

      // 连接远端存储
      await this.configureRemoteStorage();
      await this.initCrypto();
      await this.remoteStorage.testConnection();

      // 确保仓库存在
      await this.ensureRepo();

      // 检测本地变更
      this.stateManager.updateProgress({ phase: 'scanning' });
      const changes = await this.detectChanges();

      // 拉取并应用其他设备的远端变更
      this.stateManager.updateProgress({ phase: 'downloading' });
      const remoteEvents = this.collapseRemoteEvents(await this.fetchRemoteEvents());
      const pullResult = await this.applyRemoteEvents(remoteEvents, changes.toUpload);
      result.downloaded = pullResult.downloaded;
      result.conflicts = pullResult.conflicts;

      // 上传变更（并发）
      this.stateManager.updateProgress({ phase: 'uploading', total: changes.toUpload.length });
      result.uploaded = await this.uploadChangesConcurrent(changes.toUpload);

      // 保存状态
      await this.localIndex.save();
      await this.saveLocalIndex();
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
        ].filter(c => this.rulesManager.shouldSync(c.path)),
        toDownload: [],
      };
    }

    // 使用增量同步检测
    const changes = await this.incrementalSync.detectChanges((current, total) => {
      this.stateManager.updateProgress({ processed: current, total });
    });

    const toUpload = changes
      .map(c => ({
        path: c.path,
        type: c.type === 'created' ? 'create' as const :
              c.type === 'modified' ? 'modify' as const : 'delete' as const,
      }))
      .filter(c => this.rulesManager.shouldSync(c.path));

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
            await this.uploadFile(change.path, change.type);
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
  private async uploadFile(path: string, type: 'create' | 'modify'): Promise<void> {
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
    const remoteKey = await this.crypto.getStablePathKey(path);

    // 序列化
    const packageJson = JSON.stringify(encryptedPackage);
    const packageBytes = new TextEncoder().encode(packageJson);

    // 上传
    const versionId = await this.remoteStorage.upload(remoteKey, packageBytes);

    // 更新索引
    await this.localIndex.updateIndex(path);

    // 记录事件
    await this.appendEvent({
      type,
      path: path,
      remoteKey,
      contentHash: encryptedPackage.meta.contentHash,
      size: file.stat.size,
      mtime: file.stat.mtime,
    });

    console.log(`[同步管理器] 已上传：${path} (v${versionId})`);
  }

  /**
   * 删除远端文件
   */
  private async deleteFile(path: string): Promise<void> {
    const remoteKey = await this.crypto.getStablePathKey(path);
    await this.remoteStorage.delete(remoteKey);
    this.localIndex.removeFromIndex(path);

    await this.appendEvent({ type: 'delete', path, remoteKey });
    console.log(`[同步管理器] 已删除：${path}`);
  }

  /**
   * 拉取其他设备尚未处理的事件日志
   */
  private async fetchRemoteEvents(): Promise<SyncEvent[]> {
    const metadata = await this.remoteStorage.getRepoMetadata(this.settings.repoId) as RepoMetadata | null;
    if (!metadata?.devices) return [];

    const events: SyncEvent[] = [];

    for (const device of metadata.devices) {
      if (!device.deviceId || device.deviceId === this.settings.deviceId) continue;

      const fromClock = this.stateManager.getRemoteClock(device.deviceId);
      const logKeys = await this.remoteStorage.listDeviceLogs(device.deviceId, fromClock);

      for (const logKey of logKeys.sort()) {
        const logBytes = await this.remoteStorage.downloadLog(logKey);
        const encryptedEvent = JSON.parse(new TextDecoder().decode(logBytes)) as EncryptedPackage;
        const eventBytes = await this.crypto.decryptData(encryptedEvent);
        const event = JSON.parse(new TextDecoder().decode(eventBytes)) as SyncEvent;
        events.push(event);
      }
    }

    return events.sort((a, b) => a.timestamp - b.timestamp || a.clock - b.clock);
  }

  private collapseRemoteEvents(events: SyncEvent[]): SyncEvent[] {
    const latestByPath = new Map<string, SyncEvent>();

    for (const event of events) {
      const existing = latestByPath.get(event.path);
      if (
        !existing ||
        event.timestamp > existing.timestamp ||
        (event.timestamp === existing.timestamp && event.clock > existing.clock)
      ) {
        latestByPath.set(event.path, event);
      }
    }

    return Array.from(latestByPath.values()).sort(
      (a, b) => a.timestamp - b.timestamp || a.clock - b.clock
    );
  }

  /**
   * 应用远端事件。若本地同一路径也有未上传变更，则保存冲突副本，不覆盖本地文件。
   */
  private async applyRemoteEvents(
    events: SyncEvent[],
    localChanges: Array<{ path: string; type: 'create' | 'modify' | 'delete' }>
  ): Promise<{ downloaded: number; conflicts: number }> {
    let downloaded = 0;
    let conflicts = 0;
    const localChangedPaths = new Set(localChanges.map(change => change.path));

    this.stateManager.updateProgress({ total: events.length, processed: 0 });

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      this.stateManager.updateProgress({
        processed: i + 1,
        currentFile: event.path,
      });

      // 同步规则过滤：被排除的文件不处理远端变更
      if (!this.rulesManager.shouldSync(event.path)) {
        this.stateManager.updateRemoteClock(event.deviceId, event.clock);
        continue;
      }

      if (event.type === 'delete') {
        if (localChangedPaths.has(event.path)) {
          conflicts++;
          console.warn(`[同步管理器] 跳过远端删除，本地存在未同步变更：${event.path}`);
        } else {
          await this.deleteLocalFile(event.path);
          this.localIndex.removeFromIndex(event.path);
          downloaded++;
        }
        this.stateManager.updateRemoteClock(event.deviceId, event.clock);
        continue;
      }

      if (!event.remoteKey) {
        event.remoteKey = await this.crypto.getStablePathKey(event.path);
      }

      const { data } = await this.remoteStorage.download(event.remoteKey);
      const encryptedPackage = JSON.parse(new TextDecoder().decode(data)) as EncryptedPackage;
      const plaintext = await this.crypto.decryptData(encryptedPackage);

      if (localChangedPaths.has(event.path)) {
        const conflictPath = await this.writeConflictCopy(event.path, plaintext, event);
        console.warn(`[同步管理器] 已保存冲突副本：${conflictPath}`);
        conflicts++;
      } else {
        await this.writeLocalFile(event.path, plaintext);
        await this.localIndex.updateIndex(event.path);
        downloaded++;
      }

      this.stateManager.updateRemoteClock(event.deviceId, event.clock);
    }

    return { downloaded, conflicts };
  }

  /**
   * 确保仓库元数据存在
   */
  private async ensureRepo(): Promise<void> {
    await this.ensureLocalRepoId();

    const metadata = await this.remoteStorage.getRepoMetadata(this.settings.repoId) as RepoMetadata | null;
    if (!metadata) {
      if (await this.remoteStorage.hasLegacyRepoMetadata(this.settings.repoId)) {
        throw new SyncError(
          SyncErrorCode.REMOTE_LAYOUT_MIGRATION_REQUIRED,
          '检测到旧版远端对象布局。为避免跨仓库串数据或误建空仓库，请先迁移旧数据，或使用新的 repoId/storagePrefix 重新初始化。'
        );
      }

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
      return;
    }

    const devices = metadata.devices || [];
    const existing = devices.find(d => d.deviceId === this.settings.deviceId);
    if (existing) {
      existing.name = this.settings.deviceName || existing.name || 'Unknown Device';
      existing.lastActive = Date.now();
    } else {
      devices.push({
        deviceId: this.settings.deviceId,
        name: this.settings.deviceName || 'Unknown Device',
        lastActive: Date.now(),
      });
    }
    await this.remoteStorage.createRepoMetadata(this.settings.repoId, {
      ...metadata,
      devices,
    });
  }

  private async ensureLocalRepoId(): Promise<void> {
    if (this.settings.repoId) return;

    this.settings.repoId = this.crypto.generateRepoId();
    await this.persistence.saveSettings();
    console.log('[同步管理器] 创建新仓库：', this.settings.repoId);
  }

  private async configureRemoteStorage(): Promise<void> {
    if ((this.settings.credentialMode || 'static') === 'static') {
      await this.ensureLocalRepoId();
    }

    const session = await this.credentialProvider.getCredentials(this.settings, SyncManager.PLUGIN_VERSION);

    if (session.repoId && session.repoId !== this.settings.repoId) {
      this.settings.repoId = session.repoId;
      this.crypto.clearKey();
      await this.persistence.saveSettings();
    }
    if (!this.settings.repoId) {
      await this.ensureLocalRepoId();
    }

    this.remoteStorage.setConfig(session.s3);
    this.remoteStorage.setNamespace(this.settings.repoId, session.s3.storagePrefix);
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
      remoteKey: event.remoteKey,
      contentHash: event.contentHash,
      size: event.size,
      mtime: event.mtime,
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
   * 保存本地同步基线
   */
  private async saveLocalIndex(): Promise<void> {
    const existing = await this.persistence.loadData() || {};
    existing[SyncManager.LOCAL_INDEX_KEY] = this.localIndex.exportIndex();
    await this.persistence.saveData(existing);
  }

  /**
   * 写入远端文件到本地仓库
   */
  private async writeLocalFile(path: string, data: Uint8Array): Promise<void> {
    await this.ensureParentFolders(path);
    await this.app.vault.adapter.writeBinary(path, this.toArrayBuffer(data));
  }

  /**
   * 删除本地文件
   */
  private async deleteLocalFile(path: string): Promise<void> {
    if (await this.app.vault.adapter.exists(path)) {
      await this.app.vault.adapter.remove(path);
    }
  }

  /**
   * 保存冲突副本，避免覆盖本地未同步内容
   */
  private async writeConflictCopy(path: string, data: Uint8Array, event: SyncEvent): Promise<string> {
    const conflictPath = this.getConflictPath(path, event);
    await this.writeLocalFile(conflictPath, data);
    return conflictPath;
  }

  private getConflictPath(path: string, event: SyncEvent): string {
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? `${path.slice(0, slash + 1)}` : '';
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const timestamp = new Date(event.timestamp).toISOString().replace(/[:.]/g, '-');
    const device = event.deviceId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'remote';
    return `${dir}${base} (冲突 ${device} ${timestamp})${ext}`;
  }

  private async ensureParentFolders(path: string): Promise<void> {
    const parts = path.split('/').slice(0, -1);
    let current = '';

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  private toArrayBuffer(data: Uint8Array): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }

  /**
   * 格式化同步消息
   */
  private formatSyncMessage(result: SyncResult, stats: any): string {
    const parts: string[] = [];
    if (result.uploaded > 0) parts.push(`上传 ${result.uploaded}`);
    if (result.downloaded > 0) parts.push(`下载 ${result.downloaded}`);
    if (result.conflicts > 0) parts.push(`冲突 ${result.conflicts}（已保存冲突副本）`);

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
   * 获取上次同步时间（Unix 毫秒）
   */
  getLastSyncTime(): number {
    return this.stateManager.getState().lastSyncTime;
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
    const { s3, sts, syncPassword } = this.settings;
    const mode = this.settings.credentialMode || 'static';
    if (mode === 'sts') {
      return Boolean(
        sts.authServerUrl &&
        sts.authToken &&
        syncPassword &&
        this.settings.deviceId
      );
    }

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
    this.rulesManager.setRules(settings.syncRules || []);
    this.credentialProvider.clear();

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
    this.credentialProvider.clear();
    this.remoteStorage.destroy();
    console.log('[同步管理器] 已销毁');
  }
}
