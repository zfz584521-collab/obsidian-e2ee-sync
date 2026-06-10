import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type SyncPlugin from '../../main';

/**
 * 同步插件设置面板
 */
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

    // S3 存储配置
    containerEl.createEl('h3', { text: 'S3 存储配置' });

    new Setting(containerEl)
      .setName('服务端点')
      .setDesc('S3 兼容存储的端点地址（例如：https://s3.amazonaws.com）')
      .addText(text => text
        .setPlaceholder('https://s3.amazonaws.com')
        .setValue(this.plugin.settings.s3.endpoint)
        .onChange(async (value) => {
          this.plugin.settings.s3.endpoint = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('存储桶')
      .setDesc('S3 存储桶名称')
      .addText(text => text
        .setPlaceholder('my-obsidian-sync')
        .setValue(this.plugin.settings.s3.bucket)
        .onChange(async (value) => {
          this.plugin.settings.s3.bucket = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('访问密钥')
      .setDesc('S3 访问密钥 ID')
      .addText(text => text
        .setPlaceholder('AKIAIOSFODNN7EXAMPLE')
        .setValue(this.plugin.settings.s3.accessKey)
        .onChange(async (value) => {
          this.plugin.settings.s3.accessKey = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('访问密钥密码')
      .setDesc('S3 访问密钥密码')
      .addText(text => text
        .setPlaceholder('wJalrXUtnFEMI/K7MDENG...')
        .setValue(this.plugin.settings.s3.secretKey)
        .onChange(async (value) => {
          this.plugin.settings.s3.secretKey = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('区域')
      .setDesc('S3 区域（使用 "auto" 自动检测）')
      .addText(text => text
        .setPlaceholder('auto')
        .setValue(this.plugin.settings.s3.region)
        .onChange(async (value) => {
          this.plugin.settings.s3.region = value;
          await this.plugin.saveSettings();
        }));

    // 同步配置
    containerEl.createEl('h3', { text: '同步配置' });

    new Setting(containerEl)
      .setName('同步密码')
      .setDesc('用于端到端加密的密码，请妥善保管！丢失将无法恢复数据。')
      .addText(text => text
        .setPlaceholder('输入同步密码')
        .setValue(this.plugin.settings.syncPassword)
        .onChange(async (value) => {
          this.plugin.settings.syncPassword = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('设备名称')
      .setDesc('当前设备的名称，便于在其他设备上识别')
      .addText(text => text
        .setPlaceholder('我的笔记本')
        .setValue(this.plugin.settings.deviceName)
        .onChange(async (value) => {
          this.plugin.settings.deviceName = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('自动同步')
      .setDesc('启用自动同步功能')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoSync)
        .onChange(async (value) => {
          this.plugin.settings.autoSync = value;
          await this.plugin.saveSettings();
          this.plugin.syncManager.updateSettings(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('同步间隔')
      .setDesc('自动同步间隔秒数（0 表示仅手动同步）')
      .addText(text => text
        .setPlaceholder('300')
        .setValue(String(this.plugin.settings.syncInterval))
        .onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num >= 0) {
            this.plugin.settings.syncInterval = num;
            await this.plugin.saveSettings();
          }
        }));

    // 操作
    containerEl.createEl('h3', { text: '操作' });

    new Setting(containerEl)
      .setName('立即同步')
      .setDesc('手动触发一次同步')
      .addButton(button => button
        .setButtonText('同步')
        .setCta()
        .onClick(async () => {
          await this.plugin.syncManager.startSync();
        }));

    new Setting(containerEl)
      .setName('测试连接')
      .setDesc('测试当前 S3 配置是否正确')
      .addButton(button => button
        .setButtonText('测试连接')
        .onClick(async () => {
          try {
            if (!this.plugin.syncManager.isConfigured()) {
              new Notice('请先完成 S3 配置和同步密码设置');
              return;
            }
            new Notice('正在测试连接...');
            await this.plugin.syncManager.testConnection();
            new Notice('连接成功！');
          } catch (error) {
            new Notice(`连接失败：${error instanceof Error ? error.message : '未知错误'}`);
          }
        }));

    // 状态信息
    containerEl.createEl('h3', { text: '状态信息' });

    new Setting(containerEl)
      .setName('设备 ID')
      .setDesc(this.plugin.settings.deviceId || '尚未生成')
      .addButton(button => button
        .setButtonText('重新生成')
        .setWarning()
        .onClick(async () => {
          this.plugin.settings.deviceId = this.plugin.crypto.generateDeviceId();
          await this.plugin.saveSettings();
          new Notice('设备 ID 已更新');
          this.display();
        }));

    new Setting(containerEl)
      .setName('仓库 ID')
      .setDesc(this.plugin.settings.repoId || '未设置（首次同步时自动创建）')
      .addButton(button => button
        .setButtonText('创建新仓库')
        .onClick(async () => {
          this.plugin.settings.repoId = this.plugin.crypto.generateRepoId();
          await this.plugin.saveSettings();
          new Notice('仓库 ID 已创建');
          this.display();
        }));

    new Setting(containerEl)
      .setName('本地文件统计')
      .setDesc(`已索引 ${this.plugin.syncManager.getLocalFileCount()} 个文件`);

    // 帮助信息
    containerEl.createEl('h3', { text: '帮助' });

    new Setting(containerEl)
      .setName('支持的存储服务')
      .setDesc('AWS S3、Cloudflare R2、MinIO 等兼容 S3 协议的存储服务');

    new Setting(containerEl)
      .setName('安全说明')
      .setDesc('所有数据在传输前进行端到端加密，存储服务提供商无法读取您的笔记内容。');
  }
}
