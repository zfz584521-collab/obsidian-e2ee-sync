import { App, Modal, Setting, Notice, TFile } from 'obsidian';
import { SyncManager } from '../sync/SyncManager';
import type SyncPlugin from '../../main';

/**
 * 同步状态面板
 */
export class SyncStatusPanel extends Modal {
  plugin: SyncPlugin;
  refreshInterval: number | null = null;

  constructor(app: App, plugin: SyncPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('sync-status-panel');

    this.render();

    // 自动刷新
    this.refreshInterval = window.setInterval(() => {
      this.render();
    }, 1000);
  }

  onClose() {
    if (this.refreshInterval) {
      window.clearInterval(this.refreshInterval);
    }
    const { contentEl } = this;
    contentEl.empty();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    // 标题
    contentEl.createEl('h2', { text: '同步状态' });

    // 状态卡片
    const statusCard = contentEl.createDiv({ cls: 'sync-status-card' });
    const status = this.plugin.syncManager.getStatus();
    const progress = this.plugin.syncManager.getProgress();

    // 状态指示器
    const statusEl = statusCard.createDiv({ cls: 'sync-status-indicator' });
    const statusMap: Record<string, { icon: string; text: string; cls: string }> = {
      idle: { icon: '✅', text: '空闲', cls: 'status-idle' },
      syncing: { icon: '🔄', text: '同步中...', cls: 'status-syncing' },
      error: { icon: '❌', text: '错误', cls: 'status-error' },
      paused: { icon: '⏸️', text: '已暂停', cls: 'status-paused' },
    };

    const info = statusMap[status] || statusMap['idle'];
    statusEl.createSpan({ cls: `status-icon ${info.cls}`, text: info.icon });
    statusEl.createSpan({ cls: 'status-text', text: info.text });

    if (status === 'syncing' && progress.stage) {
      statusCard.createDiv({
        cls: 'sync-stage-text',
        text: `当前阶段：${progress.stage}`,
      });
    }

    // 进度信息
    if (status === 'syncing' && progress.total > 0) {
      const progressEl = statusCard.createDiv({ cls: 'sync-progress' });

      // 进度条
      const progressBar = progressEl.createDiv({ cls: 'progress-bar' });
      const progressFill = progressBar.createDiv({ cls: 'progress-fill' });
      const percent = Math.round((progress.processed / progress.total) * 100);
      progressFill.style.width = `${percent}%`;

      // 进度文本
      const progressText = progressEl.createDiv({ cls: 'progress-text' });
      progressText.createSpan({ text: `${progress.processed} / ${progress.total} 文件` });
      if (progress.currentFile) {
        progressText.createSpan({ text: ` - ${this.truncatePath(progress.currentFile)}` });
      }

      // 预估时间
      if (progress.estimatedTimeRemaining) {
        const timeEl = progressEl.createDiv({ cls: 'progress-time' });
        timeEl.createSpan({ text: `预计剩余: ${this.formatTime(progress.estimatedTimeRemaining)}` });
      }
    }

    // 统计信息
    contentEl.createEl('h3', { text: '统计信息' });
    const statsEl = contentEl.createDiv({ cls: 'sync-stats' });

    const stats = [
      { label: '本地文件', value: this.plugin.syncManager.getLocalFileCount() },
      { label: '设备 ID', value: this.plugin.settings.deviceId?.substring(0, 12) + '...' || '未设置' },
      { label: '设备名称', value: this.plugin.settings.deviceName || '未设置' },
      { label: '仓库 ID', value: this.plugin.settings.repoId?.substring(0, 12) + '...' || '未设置' },
    ];

    for (const stat of stats) {
      const row = statsEl.createDiv({ cls: 'stat-row' });
      row.createSpan({ cls: 'stat-label', text: stat.label });
      row.createSpan({ cls: 'stat-value', text: String(stat.value) });
    }

    // 操作按钮
    contentEl.createEl('h3', { text: '操作' });
    const actionsEl = contentEl.createDiv({ cls: 'sync-actions' });

    // 同步按钮
    new Setting(actionsEl)
      .setName('立即同步')
      .setDesc('开始一次完整的同步')
      .addButton(btn => btn
        .setButtonText('同步')
        .setCta()
        .setDisabled(status === 'syncing')
        .onClick(async () => {
          await this.plugin.syncManager.startSync();
          this.render();
        }));

    // 取消按钮
    if (status === 'syncing') {
      new Setting(actionsEl)
        .setName('取消同步')
        .setDesc('取消当前同步')
        .addButton(btn => btn
          .setButtonText('取消')
          .setWarning()
          .onClick(() => {
            this.plugin.syncManager.cancelSync();
            this.render();
          }));
    }

    // 测试连接按钮
    new Setting(actionsEl)
      .setName('测试连接')
      .setDesc('验证 S3 配置是否正确')
      .addButton(btn => btn
        .setButtonText('测试')
        .onClick(async () => {
          try {
            new Notice('正在测试连接...');
            await this.plugin.syncManager.testConnection();
            new Notice('连接成功！');
          } catch (error) {
            new Notice(`连接失败：${error instanceof Error ? error.message : '未知错误'}`);
          }
        }));
  }

  /**
   * 截断路径
   */
  private truncatePath(path: string, maxLength: number = 40): string {
    if (path.length <= maxLength) return path;
    return '...' + path.substring(path.length - maxLength + 3);
  }

  /**
   * 格式化时间
   */
  private formatTime(seconds: number): string {
    if (seconds < 60) return `${seconds}秒`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}分${secs}秒`;
  }
}

/**
 * 注册同步状态面板命令
 */
export function registerSyncStatusPanel(plugin: SyncPlugin): void {
  plugin.addCommand({
    id: 'show-sync-status',
    name: '显示同步状态',
    callback: () => {
      new SyncStatusPanel(plugin.app, plugin).open();
    },
  });
}
