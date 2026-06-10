import { App, Modal, Setting } from 'obsidian';
import { syncLogger } from '../utils/Logger';

/**
 * 同步统计项
 */
export interface SyncStats {
  /** 总同步次数 */
  totalSyncs: number;
  /** 成功次数 */
  successfulSyncs: number;
  /** 失败次数 */
  failedSyncs: number;
  /** 上传文件数 */
  filesUploaded: number;
  /** 下载文件数 */
  filesDownloaded: number;
  /** 上传字节数 */
  bytesUploaded: number;
  /** 下载字节数 */
  bytesDownloaded: number;
  /** 冲突数量 */
  conflictsResolved: number;
  /** 总同步时间（毫秒） */
  totalSyncTime: number;
  /** 首次同步时间 */
  firstSyncTime: number;
  /** 最后同步时间 */
  lastSyncTime: number;
}

/**
 * 存储统计
 */
export interface StorageStats {
  /** 已使用字节数 */
  usedBytes: number;
  /** 文件数量 */
  fileCount: number;
  /** 版本数量 */
  versionCount: number;
  /** 日志大小 */
  logSize: number;
}

/**
 * 每日统计
 */
export interface DailyStats {
  date: string;
  syncs: number;
  filesUploaded: number;
  filesDownloaded: number;
  bytesTransferred: number;
}

/**
 * 同步统计管理器
 */
export class SyncStatsManager {
  private app: App;
  private stats: SyncStats;
  private dailyStats: Map<string, DailyStats> = new Map();
  private storageKey = 'sync-stats';

  constructor(app: App) {
    this.app = app;
    this.stats = this.getEmptyStats();
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    await this.loadStats();
  }

  /**
   * 获取空统计
   */
  private getEmptyStats(): SyncStats {
    return {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      filesUploaded: 0,
      filesDownloaded: 0,
      bytesUploaded: 0,
      bytesDownloaded: 0,
      conflictsResolved: 0,
      totalSyncTime: 0,
      firstSyncTime: 0,
      lastSyncTime: 0,
    };
  }

  /**
   * 加载统计
   */
  private async loadStats(): Promise<void> {
    syncLogger.debug('加载统计数据');
  }

  /**
   * 保存统计
   */
  private async saveStats(): Promise<void> {
    syncLogger.debug('保存统计数据');
  }

  /**
   * 记录同步开始
   */
  startSync(): number {
    return Date.now();
  }

  /**
   * 记录同步完成
   */
  async recordSyncComplete(
    startTime: number,
    result: {
      success: boolean;
      uploaded: number;
      downloaded: number;
      conflicts: number;
      bytesUploaded: number;
      bytesDownloaded: number;
    }
  ): Promise<void> {
    const duration = Date.now() - startTime;

    this.stats.totalSyncs++;
    if (result.success) {
      this.stats.successfulSyncs++;
    } else {
      this.stats.failedSyncs++;
    }

    this.stats.filesUploaded += result.uploaded;
    this.stats.filesDownloaded += result.downloaded;
    this.stats.bytesUploaded += result.bytesUploaded;
    this.stats.bytesDownloaded += result.bytesDownloaded;
    this.stats.conflictsResolved += result.conflicts;
    this.stats.totalSyncTime += duration;
    this.stats.lastSyncTime = Date.now();

    if (this.stats.firstSyncTime === 0) {
      this.stats.firstSyncTime = Date.now();
    }

    // 更新每日统计
    this.updateDailyStats(result);

    await this.saveStats();
    syncLogger.info('同步统计已更新');
  }

  /**
   * 更新每日统计
   */
  private updateDailyStats(result: {
    uploaded: number;
    downloaded: number;
    bytesUploaded: number;
    bytesDownloaded: number;
  }): void {
    const today = new Date().toISOString().slice(0, 10);
    const daily = this.dailyStats.get(today) || {
      date: today,
      syncs: 0,
      filesUploaded: 0,
      filesDownloaded: 0,
      bytesTransferred: 0,
    };

    daily.syncs++;
    daily.filesUploaded += result.uploaded;
    daily.filesDownloaded += result.downloaded;
    daily.bytesTransferred += result.bytesUploaded + result.bytesDownloaded;

    this.dailyStats.set(today, daily);
  }

  /**
   * 获取统计
   */
  getStats(): SyncStats {
    return { ...this.stats };
  }

  /**
   * 获取每日统计
   */
  getDailyStats(days: number = 30): DailyStats[] {
    const result: DailyStats[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10);

      result.push(this.dailyStats.get(dateStr) || {
        date: dateStr,
        syncs: 0,
        filesUploaded: 0,
        filesDownloaded: 0,
        bytesTransferred: 0,
      });
    }

    return result;
  }

  /**
   * 获取平均同步时间
   */
  getAverageSyncTime(): number {
    if (this.stats.totalSyncs === 0) return 0;
    return this.stats.totalSyncTime / this.stats.totalSyncs;
  }

  /**
   * 获取成功率
   */
  getSuccessRate(): number {
    if (this.stats.totalSyncs === 0) return 0;
    return (this.stats.successfulSyncs / this.stats.totalSyncs) * 100;
  }

  /**
   * 获取总传输量
   */
  getTotalTransferred(): number {
    return this.stats.bytesUploaded + this.stats.bytesDownloaded;
  }

  /**
   * 清除统计
   */
  async clearStats(): Promise<void> {
    this.stats = this.getEmptyStats();
    this.dailyStats.clear();
    await this.saveStats();
    syncLogger.info('统计数据已清除');
  }
}

/**
 * 统计面板
 */
export class SyncStatsPanel extends Modal {
  private statsManager: SyncStatsManager;

  constructor(app: App, statsManager: SyncStatsManager) {
    super(app);
    this.statsManager = statsManager;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('sync-stats-panel');

    const stats = this.statsManager.getStats();

    contentEl.createEl('h2', { text: '同步统计' });

    // 总览
    contentEl.createEl('h3', { text: '总览' });
    const overviewEl = contentEl.createDiv({ cls: 'stats-overview' });

    this.createStatCard(overviewEl, '总同步次数', stats.totalSyncs.toString());
    this.createStatCard(overviewEl, '成功率', `${this.statsManager.getSuccessRate().toFixed(1)}%`);
    this.createStatCard(overviewEl, '平均同步时间', `${(this.statsManager.getAverageSyncTime() / 1000).toFixed(1)}秒`);
    this.createStatCard(overviewEl, '总传输量', this.formatBytes(this.statsManager.getTotalTransferred()));

    // 文件统计
    contentEl.createEl('h3', { text: '文件统计' });
    const filesEl = contentEl.createDiv({ cls: 'stats-files' });

    this.createStatRow(filesEl, '上传文件', stats.filesUploaded);
    this.createStatRow(filesEl, '下载文件', stats.filesDownloaded);
    this.createStatRow(filesEl, '解决冲突', stats.conflictsResolved);
    this.createStatRow(filesEl, '上传数据', this.formatBytes(stats.bytesUploaded));
    this.createStatRow(filesEl, '下载数据', this.formatBytes(stats.bytesDownloaded));

    // 时间信息
    contentEl.createEl('h3', { text: '时间信息' });
    const timeEl = contentEl.createDiv({ cls: 'stats-time' });

    this.createStatRow(timeEl, '首次同步', stats.firstSyncTime ? new Date(stats.firstSyncTime).toLocaleString('zh-CN') : '从未');
    this.createStatRow(timeEl, '最后同步', stats.lastSyncTime ? new Date(stats.lastSyncTime).toLocaleString('zh-CN') : '从未');
    this.createStatRow(timeEl, '总同步时间', `${(stats.totalSyncTime / 1000 / 60).toFixed(1)} 分钟`);

    // 操作按钮
    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('刷新')
        .onClick(() => this.onOpen()))
      .addButton(btn => btn
        .setButtonText('清除统计')
        .setWarning()
        .onClick(async () => {
          if (confirm('确定要清除所有统计数据吗？')) {
            await this.statsManager.clearStats();
            this.onOpen();
          }
        }))
      .addButton(btn => btn
        .setButtonText('关闭')
        .onClick(() => this.close()));
  }

  private createStatCard(container: HTMLElement, label: string, value: string): void {
    const card = container.createDiv({ cls: 'stat-card' });
    card.createDiv({ cls: 'stat-card-value', text: value });
    card.createDiv({ cls: 'stat-card-label', text: label });
  }

  private createStatRow(container: HTMLElement, label: string, value: string | number): void {
    const row = container.createDiv({ cls: 'stat-row' });
    row.createSpan({ cls: 'stat-label', text: label });
    row.createSpan({ cls: 'stat-value', text: String(value) });
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
