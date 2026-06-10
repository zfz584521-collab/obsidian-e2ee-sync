import { App, Modal, Setting, Notice } from 'obsidian';
import { FileVersion } from '../types';
import { VersionHistoryManager } from '../sync/VersionHistory';

/**
 * 版本对比模态框
 */
export class VersionCompareModal extends Modal {
  private path: string;
  private versions: FileVersion[];
  private versionManager: VersionHistoryManager;
  private content1 = '';
  private content2 = '';

  constructor(
    app: App,
    path: string,
    versions: FileVersion[],
    versionManager: VersionHistoryManager
  ) {
    super(app);
    this.path = path;
    this.versions = versions;
    this.versionManager = versionManager;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass('version-compare-modal');

    contentEl.createEl('h2', { text: '版本对比' });
    contentEl.createEl('p', { text: this.path, cls: 'compare-path' });

    // 选择版本
    const selectEl = contentEl.createDiv({ cls: 'version-select' });

    let version1Index = 0;
    let version2Index = Math.min(1, this.versions.length - 1);

    new Setting(selectEl)
      .setName('版本 1')
      .addDropdown(dropdown => {
        this.versions.forEach((v, i) => {
          dropdown.addOption(String(i), this.formatVersion(v));
        });
        dropdown.setValue(String(version1Index)).onChange(value => {
          version1Index = parseInt(value);
          this.loadVersions(version1Index, version2Index);
        });
      });

    new Setting(selectEl)
      .setName('版本 2')
      .addDropdown(dropdown => {
        this.versions.forEach((v, i) => {
          dropdown.addOption(String(i), this.formatVersion(v));
        });
        dropdown.setValue(String(version2Index)).onChange(value => {
          version2Index = parseInt(value);
          this.loadVersions(version1Index, version2Index);
        });
      });

    // 对比区域
    const compareEl = contentEl.createDiv({ cls: 'compare-container' });
    const leftEl = compareEl.createDiv({ cls: 'compare-side' });
    const rightEl = compareEl.createDiv({ cls: 'compare-side' });

    leftEl.createEl('h4', { text: '版本 1' });
    rightEl.createEl('h4', { text: '版本 2' });

    const content1El = leftEl.createDiv({ cls: 'compare-content' });
    const content2El = rightEl.createDiv({ cls: 'compare-content' });

    // 加载内容
    await this.loadVersions(version1Index, version2Index);
    content1El.setText(this.content1);
    content2El.setText(this.content2);

    // 关闭按钮
    new Setting(contentEl)
      .addButton(btn => btn.setButtonText('关闭').onClick(() => this.close()));
  }

  private async loadVersions(index1: number, index2: number): Promise<void> {
    const v1 = this.versions[index1];
    const v2 = this.versions[index2];

    if (v1) {
      this.content1 = await this.versionManager.previewVersion(this.path, v1.versionId) || '无法预览';
    }
    if (v2) {
      this.content2 = await this.versionManager.previewVersion(this.path, v2.versionId) || '无法预览';
    }
  }

  private formatVersion(v: FileVersion): string {
    const date = new Date(v.timestamp).toLocaleString('zh-CN');
    return `${date} (${this.formatSize(v.size)})`;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 冲突解决模态框
 */
export class ConflictResolverModal extends Modal {
  private conflicts: Array<{
    path: string;
    localMtime: number;
    remoteMtime: number;
  }>;
  private onResolve: (path: string, action: 'local' | 'remote' | 'both') => void;

  constructor(
    app: App,
    conflicts: Array<{ path: string; localMtime: number; remoteMtime: number }>,
    onResolve: (path: string, action: 'local' | 'remote' | 'both') => void
  ) {
    super(app);
    this.conflicts = conflicts;
    this.onResolve = onResolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('conflict-resolver-modal');

    contentEl.createEl('h2', { text: `同步冲突 (${this.conflicts.length} 个文件)` });

    contentEl.createEl('p', {
      text: '以下文件在本地和远端都被修改，请选择保留哪个版本。',
      cls: 'conflict-description'
    });

    // 冲突列表
    const listEl = contentEl.createDiv({ cls: 'conflict-list' });

    for (const conflict of this.conflicts) {
      const itemEl = listEl.createDiv({ cls: 'conflict-item' });

      // 文件路径
      itemEl.createDiv({ cls: 'conflict-path', text: conflict.path });

      // 时间信息
      const timeEl = itemEl.createDiv({ cls: 'conflict-times' });
      timeEl.createSpan({
        text: `本地: ${new Date(conflict.localMtime).toLocaleString('zh-CN')}`,
        cls: 'local-time'
      });
      timeEl.createSpan({
        text: `远端: ${new Date(conflict.remoteMtime).toLocaleString('zh-CN')}`,
        cls: 'remote-time'
      });

      // 操作按钮
      const actionsEl = itemEl.createDiv({ cls: 'conflict-actions' });

      new Setting(actionsEl)
        .addButton(btn => btn
          .setButtonText('保留本地')
          .onClick(() => this.resolveConflict(conflict.path, 'local')))
        .addButton(btn => btn
          .setButtonText('保留远端')
          .onClick(() => this.resolveConflict(conflict.path, 'remote')))
        .addButton(btn => btn
          .setButtonText('都保留')
          .setCta()
          .onClick(() => this.resolveConflict(conflict.path, 'both')));
    }

    // 批量操作
    contentEl.createEl('h3', { text: '批量操作' });
    new Setting(contentEl)
      .setName('全部保留本地版本')
      .addButton(btn => btn
        .setButtonText('应用')
        .onClick(() => this.resolveAll('local')))
      .setName('全部保留远端版本')
      .addButton(btn => btn
        .setButtonText('应用')
        .onClick(() => this.resolveAll('remote')));

    // 关闭按钮
    new Setting(contentEl)
      .addButton(btn => btn.setButtonText('关闭').onClick(() => this.close()));
  }

  private resolveConflict(path: string, action: 'local' | 'remote' | 'both') {
    this.onResolve(path, action);
    this.conflicts = this.conflicts.filter(c => c.path !== path);
    new Notice(`已解决冲突：${path}`);
    this.render();
  }

  private resolveAll(action: 'local' | 'remote' | 'both') {
    for (const conflict of this.conflicts) {
      this.onResolve(conflict.path, action);
    }
    this.conflicts = [];
    new Notice('所有冲突已解决');
    this.close();
  }

  private render() {
    if (this.conflicts.length === 0) {
      this.close();
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 冲突管理器
 */
export class ConflictManager {
  private conflicts: Map<string, {
    localMtime: number;
    remoteMtime: number;
    localHash: string;
    remoteHash: string;
  }> = new Map();

  /**
   * 添加冲突
   */
  addConflict(
    path: string,
    localMtime: number,
    remoteMtime: number,
    localHash: string,
    remoteHash: string
  ): void {
    this.conflicts.set(path, {
      localMtime,
      remoteMtime,
      localHash,
      remoteHash,
    });
  }

  /**
   * 获取所有冲突
   */
  getConflicts(): Array<{ path: string; localMtime: number; remoteMtime: number }> {
    return Array.from(this.conflicts.entries()).map(([path, data]) => ({
      path,
      localMtime: data.localMtime,
      remoteMtime: data.remoteMtime,
    }));
  }

  /**
   * 获取冲突数量
   */
  getConflictCount(): number {
    return this.conflicts.size;
  }

  /**
   * 清除所有冲突
   */
  clearConflicts(): void {
    this.conflicts.clear();
  }

  /**
   * 检查是否有冲突
   */
  hasConflicts(): boolean {
    return this.conflicts.size > 0;
  }
}
