import { Plugin, TFile } from 'obsidian';
import { SyncSettings, DEFAULT_SETTINGS } from './src/types';
import { SyncManager, DataPersistence } from './src/sync/SyncManager';
import { SyncSettingsTab } from './src/settings/SyncSettingsTab';
import { CryptoService } from './src/crypto/CryptoService';
import { SyncLogViewerModal } from './src/utils/Logger';
import { SyncRulesEditor } from './src/ui/SyncRulesEditor';
import { SyncRulesManager } from './src/sync/SyncRules';
import { SyncStatusPanel } from './src/ui/SyncStatusPanel';

export default class SyncPlugin extends Plugin {
  settings: SyncSettings;
  syncManager: SyncManager;
  crypto: CryptoService;
  statusBarItem: HTMLElement | null = null;
  private syncDebounceTimer: number | null = null;
  private progressUnsub: (() => void) | null = null;
  private static readonly SYNC_DEBOUNCE_MS = 3000;

  async onload(): Promise<void> {
    console.log('[同步插件] 正在加载...');

    this.crypto = new CryptoService();
    await this.loadSettings();

    const persistence: DataPersistence = {
      loadData: () => this.loadData() as Promise<Record<string, unknown>>,
      saveData: (data) => this.saveData(data),
      saveSettings: () => this.saveSettings(),
    };

    this.syncManager = new SyncManager(this.app, persistence, this.settings);

    this.addSettingTab(new SyncSettingsTab(this.app, this));
    this.addStatusBar();

    this.addCommand({
      id: 'sync-now',
      name: '立即同步',
      callback: () => {
        this.syncManager.startSync();
      },
    });

    this.addCommand({
      id: 'open-settings',
      name: '打开同步设置',
      callback: () => {
        // @ts-ignore - Obsidian internal setting API
        this.app.setting.open();
        // @ts-ignore - Obsidian internal setting API
        this.app.setting.openTabById('obsidian-sync-plugin');
      },
    });

    this.addCommand({
      id: 'open-sync-logs',
      name: '打开同步日志',
      callback: () => {
        this.openSyncLogs();
      },
    });

    this.addCommand({
      id: 'open-sync-rules',
      name: '打开同步规则',
      callback: () => {
        this.openSyncRules();
      },
    });

    this.addCommand({
      id: 'show-sync-status',
      name: '显示同步状态',
      callback: () => {
        new SyncStatusPanel(this.app, this).open();
      },
    });

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

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile) {
          console.log(`[同步插件] 文件已重命名：${oldPath} → ${file.path}`);
          this.scheduleDebouncedSync();
        }
      })
    );

    this.syncManager.initialize().then(() => {
      this.updateStatusBar();

      // 注册进度回调，同步状态变化时自动刷新状态栏
      this.progressUnsub = this.syncManager.onProgress((progress) => {
        if (progress.phase === 'completed' || progress.phase === 'error') {
          this.updateStatusBar();
        } else if (progress.phase === 'scanning' || progress.phase === 'uploading' || progress.phase === 'downloading') {
          this.updateStatusBar();
        }
      });

      // 启动同步：如果已配置且自动同步启用，加载后立即拉取远端变更
      if (this.syncManager.isConfigured() && this.settings.autoSync) {
        console.log('[同步插件] 启动同步：拉取远端变更...');
        this.syncManager.startSync().then(() => {
          this.updateStatusBar();
        });
      }

      console.log('[同步插件] 加载完成');
    });
  }

  private addStatusBar(): void {
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.createEl('span', { text: '同步' });
    this.statusBarItem.onClickEvent(() => {
      this.syncManager.startSync();
    });
  }

  updateStatusBar(): void {
    if (!this.statusBarItem) return;

    const status = this.syncManager.getStatus();
    const statusMap: Record<string, string> = {
      idle: '同步',
      syncing: '同步中...',
      error: '同步错误',
      paused: '同步暂停',
    };

    this.statusBarItem.empty();
    const span = this.statusBarItem.createEl('span', {
      text: statusMap[status] || statusMap.idle,
    });

    // 添加 tooltip 显示上次同步时间
    const lastSync = this.syncManager.getLastSyncTime();
    if (lastSync > 0) {
      const date = new Date(lastSync);
      const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
      span.setAttribute('title', `上次同步：${timeStr}`);
    }
  }

  openSyncLogs(): void {
    new SyncLogViewerModal(this.app).open();
  }

  openSyncRules(): void {
    const rulesManager = new SyncRulesManager(this.settings.syncRules || []);
    new SyncRulesEditor(this.app, rulesManager, async (savedRules) => {
      this.settings.syncRules = savedRules;
      await this.saveSettings();
      this.syncManager.updateSettings(this.settings);
    }).open();
  }

  private onFileChange(file: TFile): void {
    if (file.path.startsWith('.obsidian/')) return;
    if (file.path.startsWith('.sync-')) return;

    console.log(`[同步插件] 文件已变更：${file.path}`);
    this.scheduleDebouncedSync();
  }

  private onFileDelete(file: TFile): void {
    if (file.path.startsWith('.obsidian/')) return;
    if (file.path.startsWith('.sync-')) return;

    console.log(`[同步插件] 文件已删除：${file.path}`);
    this.scheduleDebouncedSync();
  }

  /**
   * 防抖同步：文件变更后延迟触发一次同步，避免频繁操作。
   * 仅当自动同步启用时才触发。
   */
  private scheduleDebouncedSync(): void {
    if (!this.settings.autoSync) return;
    if (!this.syncManager.isConfigured()) return;
    if (this.syncManager.getStatus() === 'syncing') return;

    if (this.syncDebounceTimer !== null) {
      window.clearTimeout(this.syncDebounceTimer);
    }

    this.syncDebounceTimer = window.setTimeout(() => {
      this.syncDebounceTimer = null;
      this.syncManager.startSync().then(() => {
        this.updateStatusBar();
      });
    }, SyncPlugin.SYNC_DEBOUNCE_MS);
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...data,
      credentialMode: data?.credentialMode === 'sts' ? 'sts' : 'static',
      s3: {
        ...DEFAULT_SETTINGS.s3,
        ...(data?.s3 || {}),
      },
      sts: {
        ...DEFAULT_SETTINGS.sts,
        ...(data?.sts || {}),
      },
    };

    if (!this.settings.deviceId) {
      this.settings.deviceId = this.crypto.generateDeviceId();
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  onunload(): void {
    console.log('[同步插件] 正在卸载...');
    if (this.progressUnsub) {
      this.progressUnsub();
      this.progressUnsub = null;
    }
    if (this.syncDebounceTimer !== null) {
      window.clearTimeout(this.syncDebounceTimer);
      this.syncDebounceTimer = null;
    }
    this.syncManager.destroy();
  }
}
