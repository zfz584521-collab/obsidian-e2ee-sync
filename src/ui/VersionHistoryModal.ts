import { App, Modal, Setting, Notice } from 'obsidian';
import { VersionHistoryManager } from '../sync/VersionHistory';
import { FileVersion } from '../types';

/**
 * 版本历史模态框
 */
export class VersionHistoryModal extends Modal {
  private path: string;
  private versionManager: VersionHistoryManager;
  private versions: FileVersion[] = [];
  private loading = true;

  constructor(app: App, path: string, versionManager: VersionHistoryManager) {
    super(app);
    this.path = path;
    this.versionManager = versionManager;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass('version-history-modal');

    this.render();

    // 加载版本历史
    try {
      const history = await this.versionManager.getFileHistory(this.path);
      this.versions = history?.versions || [];
    } catch (error) {
      console.error('加载版本历史失败：', error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    // 标题
    contentEl.createEl('h2', { text: '版本历史' });
    contentEl.createEl('p', { text: this.path, cls: 'version-path' });

    if (this.loading) {
      contentEl.createDiv({ text: '加载中...', cls: 'loading-indicator' });
      return;
    }

    if (this.versions.length === 0) {
      contentEl.createDiv({ text: '暂无历史版本', cls: 'empty-state' });
      return;
    }

    // 版本列表
    const listEl = contentEl.createDiv({ cls: 'version-list' });

    for (const version of this.versions) {
      const itemEl = listEl.createDiv({ cls: 'version-item' });

      // 版本信息
      const infoEl = itemEl.createDiv({ cls: 'version-info' });
      infoEl.createDiv({ cls: 'version-time', text: this.formatTime(version.timestamp) });
      infoEl.createDiv({ cls: 'version-size', text: this.formatSize(version.size) });
      if (version.deviceName) {
        infoEl.createDiv({ cls: 'version-device', text: `来自: ${version.deviceName}` });
      }

      // 操作按钮
      const actionsEl = itemEl.createDiv({ cls: 'version-actions' });

      new Setting(actionsEl)
        .addButton(btn => btn
          .setButtonText('预览')
          .onClick(() => this.previewVersion(version)))
        .addButton(btn => btn
          .setButtonText('恢复')
          .setCta()
          .onClick(() => this.restoreVersion(version)));
    }

    // 关闭按钮
    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('关闭')
        .onClick(() => this.close()));
  }

  /**
   * 预览版本
   */
  private async previewVersion(version: FileVersion): Promise<void> {
    const content = await this.versionManager.previewVersion(this.path, version.versionId);

    if (content === null) {
      new Notice('无法预览此文件');
      return;
    }

    // 创建预览模态框
    const previewModal = new Modal(this.app);
    previewModal.contentEl.createEl('h3', { text: `预览: ${this.path}` });
    previewModal.contentEl.createDiv({
      cls: 'preview-content',
      text: content.substring(0, 5000) + (content.length > 5000 ? '...' : ''),
    });
    new Setting(previewModal.contentEl)
      .addButton(btn => btn.setButtonText('关闭').onClick(() => previewModal.close()));
    previewModal.open();
  }

  /**
   * 恢复版本
   */
  private async restoreVersion(version: FileVersion): Promise<void> {
    const confirmed = confirm(`确定要恢复到此版本吗？\n\n时间: ${this.formatTime(version.timestamp)}`);

    if (!confirmed) return;

    const success = await this.versionManager.restoreVersion(this.path, version.versionId);

    if (success) {
      this.close();
    }
  }

  /**
   * 格式化时间
   */
  private formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}

/**
 * 注册版本历史命令
 */
export function registerVersionHistoryCommands(
  app: App,
  versionManager: VersionHistoryManager
): void {
  // 可以通过文件上下文菜单触发
}
