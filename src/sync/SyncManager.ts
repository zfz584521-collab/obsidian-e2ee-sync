import { App, Notice, TFile } from 'obsidian';
import { SyncSettings, SyncStatus, SyncResult, SyncEvent } from '../types';
import { LocalIndex } from './LocalIndex';
import { RemoteStorage } from './RemoteStorage';
import { CryptoService } from '../crypto/CryptoService';

/** 数据持久化接口 */
export interface DataPersistence {
  loadData(): Promise<Record<string, unknown>>;
  saveData(data: Record<string, unknown>): Promise<void>;
  saveSettings(): Promise<void>;
}

/**
 * 同步管理器
 * 协调所有同步操作
 */
export class SyncManager {
  private app: App;
  private persistence: DataPersistence;
  private settings: SyncSettings;
  public localIndex: LocalIndex;
  private remoteStorage: RemoteStorage;
  public crypto: CryptoService;
  private status: SyncStatus = 'idle';
  private syncIntervalId: number | null = null;
  private localClock: number = 0;

  constructor(app: App, persistence: DataPersistence, settings: SyncSettings) {
    this.app = app;
    this.persistence = persistence;
    this.settings = settings;
    this.crypto = new CryptoService();
    this.localIndex = new LocalIndex(app, this.crypto);
    this.remoteStorage = new RemoteStorage();
  }

  /**
   * 初始化同步管理器
   */
  async initialize(): Promise<void> {
    console.log('[同步管理器] 正在初始化...');

    // 初始化本地索引
    await this.localIndex.initialize();

    // 加载本地时钟
    await this.loadLocalClock();

    // 如果启用自动同步则设置
    if (this.settings.autoSync && this.settings.syncInterval > 0) {
      this.startAutoSync();
    }

    console.log('[同步管理器] 初始化完成');
  }

  /**
   * 加载本地逻辑时钟
   */
  private async loadLocalClock(): Promise<void> {
    const stored = await this.persistence.loadData();
    this.localClock = (stored?.syncClock as number) || 0;
  }

  /**
   * 保存本地逻辑时钟
   */
  private async saveLocalClock(): Promise<void> {
    const data = await this.persistence.loadData() || {};
    (data as Record<string, unknown>).syncClock = this.localClock;
    await this.persistence.saveData(data);
  }

  /**
   * 测试远端连接
   */
  async testConnection(): Promise<boolean> {
    if (!this.isConfigured()) {
      throw new Error('同步未配置，请检查设置');
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
      throw new Error('同步密码未设置');
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
    const result: SyncResult = {
      success: true,
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
      errors: [],
    };

    try {
      // 步骤 1：检查配置
      if (!this.isConfigured()) {
        throw new Error('同步未配置，请检查设置。');
      }

      // 步骤 2：初始化加密
      await this.initCrypto();
      new Notice('正在同步...');

      // 步骤 3：连接远端存储
      this.remoteStorage.setConfig(this.settings.s3);
      await this.remoteStorage.testConnection();

      // 步骤 4：确保仓库存在
      await this.ensureRepo();

      // 步骤 5：扫描本地变更
      const localChanges = await this.localIndex.scanChanges();

      // 步骤 6：上传变更
      result.uploaded = await this.uploadChanges(localChanges);

      // 步骤 7：拉取并应用远端变更
      const pullResult = await this.pullAndApplyRemoteChanges();
      result.downloaded = pullResult.downloaded;
      result.conflicts = pullResult.conflicts;

      // 步骤 8：保存索引和时钟
      await this.localIndex.save();
      await this.saveLocalClock();

      // 总结
      const messages: string[] = [];
      if (result.uploaded > 0) messages.push(`上传 ${result.uploaded}`);
      if (result.downloaded > 0) messages.push(`下载 ${result.downloaded}`);
      if (result.conflicts > 0) messages.push(`冲突 ${result.conflicts}`);

      if (messages.length > 0) {
        new Notice(`同步完成：${messages.join('、')}`);
      } else {
        new Notice('同步完成：无变更');
      }

    } catch (error) {
      console.error('[同步管理器] 同步失败：', error);
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : '未知错误');
      this.status = 'error';
      new Notice(`同步失败：${error instanceof Error ? error.message : '未知错误'}`);
      return result;
    }

    this.status = 'idle';
    return result;
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
   * 上传变更
   */
  private async uploadChanges(changes: { created: string[]; modified: string[]; deleted: string[] }): Promise<number> {
    let uploaded = 0;
    const toUpload = [...changes.created, ...changes.modified];

    for (const path of toUpload) {
      try {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          console.warn(`[同步管理器] 跳过非文件：${path}`);
          continue;
        }

        const content = await this.app.vault.readBinary(file);
        const contentBytes = new Uint8Array(content);

        // 加密内容
        const encryptedPackage = await this.crypto.encryptData(contentBytes);

        // 加密路径
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
          type: changes.created.includes(path) ? 'create' : 'modify',
          path: path,
          contentHash: encryptedPackage.meta.contentHash,
        });

        uploaded++;
        console.log(`[同步管理器] 已上传：${path} (v${versionId})`);
      } catch (error) {
        console.error(`[同步管理器] 上传失败 ${path}：`, error);
      }
    }

    // 处理删除
    for (const path of changes.deleted) {
      try {
        const encryptedPath = await this.crypto.encryptPath(path);
        await this.remoteStorage.delete(encryptedPath);
        this.localIndex.removeFromIndex(path);

        await this.appendEvent({
          type: 'delete',
          path: path,
        });

        uploaded++;
        console.log(`[同步管理器] 已删除：${path}`);
      } catch (error) {
        console.error(`[同步管理器] 删除失败 ${path}：`, error);
      }
    }

    return uploaded;
  }

  /**
   * 拉取并应用远端变更
   */
  private async pullAndApplyRemoteChanges(): Promise<{ downloaded: number; conflicts: number }> {
    let downloaded = 0;
    let conflicts = 0;

    console.log('[同步管理器] 正在拉取远端变更...');

    try {
      // 获取所有远端对象
      const remoteObjects = await this.remoteStorage.list('content/');

      for (const encryptedKey of remoteObjects) {
        try {
          // 解密路径
          const decryptedPath = await this.crypto.decryptPath(encryptedKey.replace('content/', ''));

          // 检查本地状态
          const localEntry = this.localIndex.getEntry(decryptedPath);
          const localFile = this.app.vault.getAbstractFileByPath(decryptedPath);

          if (localEntry && localFile instanceof TFile) {
            // 文件已存在，检查是否需要更新
            const { data } = await this.remoteStorage.download(encryptedKey.replace('content/', ''));
            const packageJson = new TextDecoder().decode(data);
            const encryptedPackage = JSON.parse(packageJson);

            // 解密内容
            const content = await this.crypto.decryptData(encryptedPackage);

            // 检查是否有冲突（本地修改过）
            const localContent = new Uint8Array(await this.app.vault.readBinary(localFile));
            const localHash = await this.crypto.hash(localContent);

            if (localHash !== localEntry.hash && encryptedPackage.meta.contentHash !== localEntry.hash) {
              // 冲突：本地和远端都修改过
              conflicts++;
              await this.handleConflict(decryptedPath, content);
            } else {
              // 无冲突，直接更新
              await this.applyFileContent(decryptedPath, content);
              downloaded++;
            }
          } else if (!localEntry) {
            // 新文件，直接下载
            const { data } = await this.remoteStorage.download(encryptedKey.replace('content/', ''));
            const packageJson = new TextDecoder().decode(data);
            const encryptedPackage = JSON.parse(packageJson);
            const content = await this.crypto.decryptData(encryptedPackage);

            await this.applyFileContent(decryptedPath, content);
            downloaded++;
          }
        } catch (error) {
          console.error(`[同步管理器] 下载失败 ${encryptedKey}：`, error);
        }
      }
    } catch (error) {
      console.error('[同步管理器] 拉取远端变更失败：', error);
    }

    return { downloaded, conflicts };
  }

  /**
   * 应用文件内容
   */
  private async applyFileContent(path: string, content: Uint8Array): Promise<void> {
    // 确保目录存在
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (dir) {
      await this.ensureDirectory(dir);
    }

    // 写入文件
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.modifyBinary(file, content.buffer as ArrayBuffer);
    } else {
      await this.app.vault.createBinary(path, content.buffer as ArrayBuffer);
    }

    // 更新索引
    await this.localIndex.updateIndex(path);
    console.log(`[同步管理器] 已应用：${path}`);
  }

  /**
   * 处理冲突
   */
  private async handleConflict(path: string, remoteContent: Uint8Array): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;

    // 生成冲突副本名称
    const ext = path.substring(path.lastIndexOf('.'));
    const baseName = path.substring(0, path.lastIndexOf('.'));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const conflictPath = `${baseName} (冲突 ${timestamp})${ext}`;

    // 保存冲突副本（远端版本）
    await this.app.vault.createBinary(conflictPath, remoteContent.buffer as ArrayBuffer);

    console.log(`[同步管理器] 创建冲突副本：${conflictPath}`);
    new Notice(`检测到冲突，已创建副本：${conflictPath}`);
  }

  /**
   * 确保目录存在
   */
  private async ensureDirectory(path: string): Promise<void> {
    const parts = path.split('/');
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const folder = this.app.vault.getAbstractFileByPath(currentPath);
      if (!folder) {
        await this.app.vault.createFolder(currentPath);
      }
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

    // 序列化并加密事件
    const eventJson = JSON.stringify(fullEvent);
    const encryptedEvent = await this.crypto.encryptData(new TextEncoder().encode(eventJson));

    // 上传到设备日志
    const logData = new TextEncoder().encode(JSON.stringify(encryptedEvent));
    await this.remoteStorage.uploadLog(this.settings.deviceId, logData, this.localClock);

    console.log(`[同步管理器] 事件已记录：${fullEvent.type} ${fullEvent.path}`);
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
    this.crypto.clearKey();
    this.remoteStorage.destroy();
    console.log('[同步管理器] 已销毁');
  }
}
