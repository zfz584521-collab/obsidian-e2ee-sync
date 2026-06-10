import { Plugin, Notice, TFile } from 'obsidian';
import { SyncSettings, DEFAULT_SETTINGS } from './src/types';
import { SyncManager, DataPersistence } from './src/sync/SyncManager';
import { SyncSettingsTab } from './src/settings/SyncSettingsTab';
import { CryptoService } from './src/crypto/CryptoService';

/**
 * Obsidian 同步插件
 * 跨设备端到端加密同步
 */
export default class SyncPlugin extends Plugin {
  settings: SyncSettings;
  syncManager: SyncManager;
  crypto: CryptoService;
  statusBarItem: HTMLElement | null = null;

  async onload() {
    console.log('[同步插件] 正在加载...');

    // 初始化加密服务
    this.crypto = new CryptoService();

    // 加载设置
    await this.loadSettings();

    // 创建数据持久化接口
    const persistence: DataPersistence = {
      loadData: () => this.loadData() as Promise<Record<string, unknown>>,
      saveData: (data) => this.saveData(data),
      saveSettings: () => this.saveSettings(),
    };

    // 初始化同步管理器
    this.syncManager = new SyncManager(this.app, persistence, this.settings);

    // 添加设置面板
    this.addSettingTab(new SyncSettingsTab(this.app, this));

    // 添加状态栏图标
    this.addStatusBar();

    // 添加命令：手动同步
    this.addCommand({
      id: 'sync-now',
      name: '立即同步',
      callback: () => {
        this.syncManager.startSync();
      },
    });

    // 添加命令：打开设置
    this.addCommand({
      id: 'open-settings',
      name: '打开同步设置',
      callback: () => {
        // @ts-ignore - 内部 API
        this.app.setting.open();
        // @ts-ignore - 内部 API
        this.app.setting.openTabById('obsidian-sync-plugin');
      },
    });

    // 注册文件事件用于自动同步
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          this.onFileChange(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile) {
          this.onFileChange(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile) {
          this.onFileDelete(file);
        }
      })
    );

    // 初始化同步管理器
    this.syncManager.initialize().then(() => {
      this.updateStatusBar();
      console.log('[同步插件] 加载完成');
    });
  }

  /**
   * 添加状态栏图标
   */
  private addStatusBar(): void {
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.createEl('span', { text: '⏸️ 同步' });
    this.statusBarItem.onClickEvent(() => {
      this.syncManager.startSync();
    });
  }

  /**
   * 更新状态栏显示
   */
  updateStatusBar(): void {
    if (!this.statusBarItem) return;

    const status = this.syncManager.getStatus();
    const statusMap: Record<string, { icon: string; text: string }> = {
      idle: { icon: '✅', text: '同步' },
      syncing: { icon: '🔄', text: '同步中...' },
      error: { icon: '❌', text: '同步错误' },
      paused: { icon: '⏸️', text: '同步暂停' },
    };

    const info = statusMap[status] || statusMap['idle'];
    this.statusBarItem.empty();
    this.statusBarItem.createEl('span', {
      text: `${info.icon} ${info.text}`,
    });
  }

  /**
   * 处理文件变更事件
   */
  private onFileChange(file: TFile): void {
    // 忽略配置文件
    if (file.path.startsWith('.obsidian/')) return;
    if (file.path.startsWith('.sync-')) return;

    console.log(`[同步插件] 文件已变更：${file.path}`);

    // 更新本地索引
    this.syncManager.localIndex.updateIndex(file.path);
  }

  /**
   * 处理文件删除事件
   */
  private onFileDelete(file: TFile): void {
    console.log(`[同步插件] 文件已删除：${file.path}`);

    // 更新本地索引
    this.syncManager.localIndex.removeFromIndex(file.path);
  }

  /**
   * 从磁盘加载设置
   */
  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...data,
      s3: {
        ...DEFAULT_SETTINGS.s3,
        ...(data?.s3 || {}),
      },
    };

    // 如果没有设备 ID 则生成
    if (!this.settings.deviceId) {
      this.settings.deviceId = this.crypto.generateDeviceId();
      await this.saveSettings();
    }
  }

  /**
   * 保存设置到磁盘
   */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * 卸载时清理
   */
  onunload() {
    console.log('[同步插件] 正在卸载...');
    this.syncManager.destroy();
  }
}
