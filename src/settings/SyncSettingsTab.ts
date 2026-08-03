import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type SyncPlugin from '../../main';
import { ConfigExporter } from '../utils/ConfigExporter';
import { ConfigValidator } from '../utils/ConfigValidator';
import { SyncRulesEditor } from '../ui/SyncRulesEditor';
import { SyncRulesManager } from '../sync/SyncRules';
import { SyncStatusPanel } from '../ui/SyncStatusPanel';

export class SyncSettingsTab extends PluginSettingTab {
  plugin: SyncPlugin;

  constructor(app: App, plugin: SyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '同步设置' });
    containerEl.createEl('p', {
      text: '个人模式填写对象存储密钥；商业模式只填写授权服务、授权令牌和同步密码。',
    });

    this.renderCredentialMode(containerEl);
    this.renderBasicSettings(containerEl);
    this.renderMainActions(containerEl);
    this.renderSecondDeviceActions(containerEl);
    this.renderSyncRules(containerEl);
    this.renderAdvancedSettings(containerEl);
  }

  private renderCredentialMode(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('使用模式')
      .setDesc('个人模式保留手动 AccessKey；商业模式从授权服务自动获取临时凭证。')
      .addDropdown(dropdown => dropdown
        .addOption('static', '个人模式：手动 AccessKey')
        .addOption('sts', '商业模式：授权服务')
        .setValue(this.plugin.settings.credentialMode || 'static')
        .onChange(async (value) => {
          this.plugin.settings.credentialMode = value === 'sts' ? 'sts' : 'static';
          await this.plugin.saveSettings();
          this.plugin.syncManager.updateSettings(this.plugin.settings);
          this.display();
        }));
  }

  private renderBasicSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: '一、必填信息' });

    if ((this.plugin.settings.credentialMode || 'static') === 'sts') {
      this.renderCommercialSettings(containerEl);
      return;
    }

    new Setting(containerEl)
      .setName('服务地址')
      .setDesc('对象存储的访问地址。例如阿里云 OSS 的地址。')
      .addText(text => text
        .setPlaceholder('例如：https://oss-cn-hangzhou.aliyuncs.com')
        .setValue(this.plugin.settings.s3.endpoint)
        .onChange(async (value) => {
          this.plugin.settings.s3.endpoint = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('存储桶名称')
      .setDesc('对象存储里的 bucket 名称。')
      .addText(text => text
        .setPlaceholder('例如：my-notes-sync')
        .setValue(this.plugin.settings.s3.bucket)
        .onChange(async (value) => {
          this.plugin.settings.s3.bucket = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('访问密钥 ID')
      .setDesc('对象存储的 AccessKey ID。')
      .addText(text => text
        .setPlaceholder('AccessKey ID')
        .setValue(this.plugin.settings.s3.accessKey)
        .onChange(async (value) => {
          this.plugin.settings.s3.accessKey = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('访问密钥密码')
      .setDesc('对象存储的 SecretKey，输入框会隐藏显示。')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('SecretKey')
          .setValue(this.plugin.settings.s3.secretKey)
          .onChange(async (value) => {
            this.plugin.settings.s3.secretKey = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('同步密码')
      .setDesc('自己设置一个密码。所有设备必须填同一个同步密码；忘记后无法解密已同步内容。')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('请设置同步密码')
        .setValue(this.plugin.settings.syncPassword)
        .onChange(async (value) => {
          this.plugin.settings.syncPassword = value;
          await this.plugin.saveSettings();
          this.plugin.syncManager.updateSettings(this.plugin.settings);
        });
      });
  }

  private renderCommercialSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('授权服务地址')
      .setDesc('由服务提供方给你的同步授权服务地址。')
      .addText(text => text
        .setPlaceholder('例如：https://sync.example.com')
        .setValue(this.plugin.settings.sts.authServerUrl)
        .onChange(async (value) => {
          this.plugin.settings.sts.authServerUrl = value.trim();
          await this.plugin.saveSettings();
          this.plugin.syncManager.updateSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('授权令牌')
      .setDesc('由服务提供方发放。插件会用它换取短期同步凭证。')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('授权令牌')
          .setValue(this.plugin.settings.sts.authToken)
          .onChange(async (value) => {
            this.plugin.settings.sts.authToken = value.trim();
            await this.plugin.saveSettings();
            this.plugin.syncManager.updateSettings(this.plugin.settings);
          });
      });

    new Setting(containerEl)
      .setName('同步密码')
      .setDesc('自己设置一个密码。所有设备必须填同一个同步密码；服务端不会知道这个密码。')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('请设置同步密码')
          .setValue(this.plugin.settings.syncPassword)
          .onChange(async (value) => {
            this.plugin.settings.syncPassword = value;
            await this.plugin.saveSettings();
            this.plugin.syncManager.updateSettings(this.plugin.settings);
          });
      });
  }

  private renderMainActions(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: '二、开始使用' });

    new Setting(containerEl)
      .setName('检查配置')
      .setDesc('先点这里，确认必填信息有没有漏填。')
      .addButton(button => button
        .setButtonText('检查配置')
        .onClick(() => {
          const result = ConfigValidator.validate(this.plugin.settings);
          new Notice(ConfigValidator.format(result), 12000);
        }));

    new Setting(containerEl)
      .setName('测试连接')
      .setDesc('确认可以连接对象存储。')
      .addButton(button => button
        .setButtonText('测试连接')
        .onClick(async () => {
          try {
            if (!this.plugin.syncManager.isConfigured()) {
              new Notice(this.plugin.settings.credentialMode === 'sts'
                ? '请先填完授权服务地址、授权令牌和同步密码。'
                : '请先填完服务地址、存储桶、访问密钥和同步密码。');
              return;
            }
            new Notice('正在测试连接...');
            await this.plugin.syncManager.testConnection();
            new Notice('连接成功。');
          } catch (error) {
            new Notice(`连接失败：${error instanceof Error ? error.message : '未知错误'}`);
          }
        }));

    new Setting(containerEl)
      .setName('立即同步')
      .setDesc('配置无误后，点这里手动同步一次。')
      .addButton(button => button
        .setButtonText('同步')
        .setCta()
        .onClick(async () => {
          await this.plugin.syncManager.startSync();
          this.display();
        }));
  }

  private renderSecondDeviceActions(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: '三、第二台设备' });

    new Setting(containerEl)
      .setName('复制给第二台')
      .setDesc('在第一台点这里。会复制必要的同步身份信息，不会复制密钥、同步密码和设备 ID。')
      .addButton(button => button
        .setButtonText('复制第二台配置')
        .onClick(async () => {
          await this.ensureRepoIdForSharing();
          await ConfigExporter.copyToClipboard(this.plugin.settings);
          this.display();
        }));

    new Setting(containerEl)
      .setName('粘贴第一台配置')
      .setDesc('在第二台点这里。粘贴后只需要再填写访问密钥、访问密钥密码和同步密码。')
      .addButton(button => button
        .setButtonText('粘贴配置')
        .onClick(async () => {
          const imported = await ConfigExporter.pasteFromClipboard();
          if (!imported) return;

          this.plugin.settings.s3 = {
            ...this.plugin.settings.s3,
            endpoint: imported.s3?.endpoint || this.plugin.settings.s3.endpoint,
            bucket: imported.s3?.bucket || this.plugin.settings.s3.bucket,
            region: imported.s3?.region || this.plugin.settings.s3.region || 'auto',
            storagePrefix: imported.s3?.storagePrefix || '',
          };
          this.plugin.settings.credentialMode = imported.credentialMode || this.plugin.settings.credentialMode || 'static';
          this.plugin.settings.sts = {
            ...this.plugin.settings.sts,
            authServerUrl: imported.sts?.authServerUrl || this.plugin.settings.sts.authServerUrl,
            authToken: this.plugin.settings.sts.authToken,
            vaultId: imported.sts?.vaultId || this.plugin.settings.sts.vaultId || 'main',
            refreshSkewMs: imported.sts?.refreshSkewMs || this.plugin.settings.sts.refreshSkewMs,
          };
          this.plugin.settings.repoId = imported.repoId || this.plugin.settings.repoId;

          await this.plugin.saveSettings();
          this.plugin.syncManager.updateSettings(this.plugin.settings);
          new Notice(this.plugin.settings.credentialMode === 'sts'
            ? '已粘贴第一台配置。请继续填写授权令牌和同步密码。'
            : '已粘贴第一台配置。请继续填写访问密钥、访问密钥密码和同步密码。');
          this.display();
        }));
  }

  private renderAdvancedSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: '高级设置（一般不用改）' });
    const mode = this.plugin.settings.credentialMode || 'static';

    new Setting(containerEl)
      .setName('设备名称')
      .setDesc('用于区分设备。可以随便写，例如 办公电脑、家里电脑。')
      .addText(text => text
        .setPlaceholder('我的电脑')
        .setValue(this.plugin.settings.deviceName)
        .onChange(async (value) => {
          this.plugin.settings.deviceName = value.trim();
          await this.plugin.saveSettings();
        }));

    if (mode === 'static') {
      new Setting(containerEl)
        .setName('区域')
        .setDesc('默认 auto。只有服务商要求时才需要修改。')
        .addText(text => text
          .setPlaceholder('auto')
          .setValue(this.plugin.settings.s3.region || 'auto')
          .onChange(async (value) => {
            this.plugin.settings.s3.region = value.trim() || 'auto';
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('同步通道前缀')
        .setDesc('可选。一般不用填；需要在同一个桶里区分测试环境时再填。')
        .addText(text => text
          .setPlaceholder('可留空')
          .setValue(this.plugin.settings.s3.storagePrefix || '')
          .onChange(async (value) => {
            this.plugin.settings.s3.storagePrefix = value.trim();
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('仓库 ID')
        .setDesc(this.plugin.settings.repoId || '尚未创建。首次同步或复制第二台配置时会自动创建。')
        .addButton(button => button
          .setButtonText('重新创建仓库')
          .setWarning()
          .onClick(async () => {
            const ok = window.confirm('重新创建仓库 ID 后，会使用一个新的远端同步空间。旧远端数据不会删除。是否继续？');
            if (!ok) return;

            this.plugin.settings.repoId = this.plugin.crypto.generateRepoId();
            await this.plugin.saveSettings();
            this.plugin.syncManager.updateSettings(this.plugin.settings);
            new Notice('已创建新的仓库 ID。');
            this.display();
          }));
    }

    new Setting(containerEl)
      .setName('自动同步')
      .setDesc('稳定前建议关闭。')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoSync)
        .onChange(async (value) => {
          this.plugin.settings.autoSync = value;
          await this.plugin.saveSettings();
          this.plugin.syncManager.updateSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('自动同步间隔')
      .setDesc('单位秒。填 0 表示只手动同步。')
      .addText(text => text
        .setPlaceholder('0')
        .setValue(String(this.plugin.settings.syncInterval))
        .onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num >= 0) {
            this.plugin.settings.syncInterval = num;
            await this.plugin.saveSettings();
            this.plugin.syncManager.updateSettings(this.plugin.settings);
          }
        }));

    if (mode === 'sts') {
      new Setting(containerEl)
        .setName('商业 Vault ID')
        .setDesc('商业模式使用。普通用户保持 main 即可。')
        .addText(text => text
          .setPlaceholder('main')
          .setValue(this.plugin.settings.sts.vaultId || 'main')
          .onChange(async (value) => {
          this.plugin.settings.sts.vaultId = value.trim() || 'main';
          await this.plugin.saveSettings();
          this.plugin.syncManager.updateSettings(this.plugin.settings);
        }));

      new Setting(containerEl)
        .setName('临时凭证提前刷新')
        .setDesc('商业模式使用。单位秒，默认 300 秒。')
        .addText(text => text
          .setPlaceholder('300')
          .setValue(String(Math.round((this.plugin.settings.sts.refreshSkewMs || 300000) / 1000)))
          .onChange(async (value) => {
            const seconds = parseInt(value, 10);
            if (!isNaN(seconds) && seconds >= 0) {
              this.plugin.settings.sts.refreshSkewMs = seconds * 1000;
              await this.plugin.saveSettings();
              this.plugin.syncManager.updateSettings(this.plugin.settings);
            }
          }));
    }

    new Setting(containerEl)
      .setName('检查远端布局')
      .setDesc('只有提示旧版布局或同步异常时才需要使用。')
      .addButton(button => button
        .setButtonText('检查布局')
        .onClick(async () => {
          try {
            new Notice('正在检查远端布局...');
            const layout = await this.plugin.syncManager.detectRemoteLayout();
            if (layout.legacyLayout && !layout.currentLayout) {
              new Notice('检测到旧版远端布局。请先迁移，或重新创建仓库后再同步。');
            } else if (layout.legacyLayout && layout.currentLayout) {
              new Notice('同时存在新版和旧版布局。当前新版仓库可用。');
            } else if (layout.currentLayout) {
              new Notice('当前远端布局正常。');
            } else {
              new Notice('未发现远端仓库。首次同步会自动初始化。');
            }
          } catch (error) {
            new Notice(`布局检查失败：${error instanceof Error ? error.message : '未知错误'}`);
          }
        }));

    new Setting(containerEl)
      .setName('迁移旧版布局')
      .setDesc('把旧版远端对象复制到新版布局。旧对象不会被删除。')
      .addButton(button => button
        .setButtonText('迁移')
        .setWarning()
        .onClick(async () => {
          const ok = window.confirm('迁移前请先备份本地笔记库和对象存储。是否继续？');
          if (!ok) return;

          try {
            new Notice('正在迁移旧版远端布局...');
            const result = await this.plugin.syncManager.migrateLegacyRemoteLayout();
            new Notice(`迁移完成：复制 ${result.copied} 个，跳过 ${result.skipped} 个。`);
          } catch (error) {
            new Notice(`迁移失败：${error instanceof Error ? error.message : '未知错误'}`);
          }
        }));

    new Setting(containerEl)
      .setName('同步状态')
      .setDesc('查看当前同步状态、进度和统计信息。')
      .addButton(button => button
        .setButtonText('打开状态面板')
        .onClick(() => {
          new SyncStatusPanel(this.app, this.plugin).open();
        }));

    new Setting(containerEl)
      .setName('同步日志')
      .setDesc('查看最近同步日志。敏感字段会自动脱敏。')
      .addButton(button => button
        .setButtonText('打开日志')
        .onClick(() => {
          this.plugin.openSyncLogs();
        }));
  }

  private renderSyncRules(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: '四、同步规则' });

    const rules = this.plugin.settings.syncRules || [];
    const enabledCount = rules.filter(r => r.enabled).length;

    new Setting(containerEl)
      .setName('选择性同步')
      .setDesc(`配置哪些文件或文件夹需要同步。当前共 ${rules.length} 条规则，${enabledCount} 条启用。`)
      .addButton(button => button
        .setButtonText('打开规则编辑器')
        .onClick(() => {
          const rulesManager = new SyncRulesManager(this.plugin.settings.syncRules || []);
          new SyncRulesEditor(this.app, rulesManager, async (savedRules) => {
            this.plugin.settings.syncRules = savedRules;
            await this.plugin.saveSettings();
            this.plugin.syncManager.updateSettings(this.plugin.settings);
            this.display();
          }).open();
        }));
  }

  private async ensureRepoIdForSharing(): Promise<void> {
    if (this.plugin.settings.repoId) return;

    this.plugin.settings.repoId = this.plugin.crypto.generateRepoId();
    await this.plugin.saveSettings();
    this.plugin.syncManager.updateSettings(this.plugin.settings);
  }
}
