import { Notice } from 'obsidian';
import { SyncSettings, DEFAULT_SETTINGS } from '../types';
import { syncLogger } from './Logger';

export class ConfigExporter {
  static async exportConfig(settings: SyncSettings, password: string): Promise<string> {
    const exportData = {
      version: '1.0.0',
      exportedAt: Date.now(),
      settings: {
        credentialMode: settings.credentialMode || 'static',
        s3: {
          endpoint: settings.s3.endpoint,
          bucket: settings.s3.bucket,
          region: settings.s3.region || 'auto',
          storagePrefix: settings.s3.storagePrefix || '',
          accessKey: '',
          secretKey: '',
          securityToken: '',
        },
        sts: {
          authServerUrl: settings.sts.authServerUrl,
          authToken: '',
          vaultId: settings.sts.vaultId || 'main',
          refreshSkewMs: settings.sts.refreshSkewMs,
        },
        syncPassword: '',
        deviceId: '',
        deviceName: '',
        repoId: settings.repoId,
        autoSync: false,
        syncInterval: 0,
        syncRules: settings.syncRules,
      },
    };

    const json = JSON.stringify(exportData);
    const encoded = btoa(unescape(encodeURIComponent(json)));

    syncLogger.info('配置已导出');
    return encoded;
  }

  static async importConfig(encoded: string, password: string): Promise<Partial<SyncSettings> | null> {
    try {
      const json = decodeURIComponent(escape(atob(encoded.trim())));
      const importData = JSON.parse(json);

      if (!importData.version || !importData.settings) {
        throw new Error('配置格式无效');
      }

      syncLogger.info('配置已导入');
      return importData.settings;
    } catch (error) {
      syncLogger.error('配置导入失败', { error });
      new Notice('配置导入失败：请确认复制的是第一台生成的配置。');
      return null;
    }
  }

  static async copyToClipboard(settings: SyncSettings): Promise<boolean> {
    try {
      const encoded = await this.exportConfig(settings, '');
      await navigator.clipboard.writeText(encoded);
      new Notice('已复制第二台设备配置。第二台粘贴后，还需要填写访问密钥和同步密码。');
      return true;
    } catch (error) {
      new Notice('复制失败。');
      return false;
    }
  }

  static async pasteFromClipboard(): Promise<Partial<SyncSettings> | null> {
    try {
      const text = await navigator.clipboard.readText();
      return await this.importConfig(text, '');
    } catch (error) {
      new Notice('读取剪贴板失败。');
      return null;
    }
  }

  static async exportToFile(settings: SyncSettings): Promise<void> {
    try {
      const encoded = await this.exportConfig(settings, '');
      const blob = new Blob([encoded], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `obsidian-sync-config-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();

      URL.revokeObjectURL(url);
      new Notice('配置已导出到文件。');
    } catch (error) {
      new Notice('导出失败。');
    }
  }

  static generateShareUrl(settings: SyncSettings): string {
    const data = {
      credentialMode: settings.credentialMode || 'static',
      endpoint: settings.s3.endpoint,
      bucket: settings.s3.bucket,
      region: settings.s3.region || 'auto',
      storagePrefix: settings.s3.storagePrefix || '',
      authServerUrl: settings.sts.authServerUrl,
      vaultId: settings.sts.vaultId || 'main',
      repoId: settings.repoId,
    };

    const encoded = btoa(JSON.stringify(data));
    return `obsidian://sync-import?data=${encoded}`;
  }

  static parseShareUrl(url: string): Partial<SyncSettings> | null {
    try {
      const match = url.match(/obsidian:\/\/sync-import\?data=(.+)/);
      if (!match) {
        return null;
      }

      const json = atob(match[1]);
      const data = JSON.parse(json);

      return {
        credentialMode: data.credentialMode || 'static',
        s3: {
          ...DEFAULT_SETTINGS.s3,
          endpoint: data.endpoint || '',
          bucket: data.bucket || '',
          region: data.region || 'auto',
          storagePrefix: data.storagePrefix || '',
          accessKey: '',
          secretKey: '',
          securityToken: '',
        },
        sts: {
          ...DEFAULT_SETTINGS.sts,
          authServerUrl: data.authServerUrl || '',
          authToken: '',
          vaultId: data.vaultId || 'main',
        },
        repoId: data.repoId || '',
      };
    } catch (error) {
      return null;
    }
  }

  static validateImportedConfig(config: Partial<SyncSettings>): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.s3?.endpoint) {
      warnings.push('缺少服务地址。');
    }
    if (!config.s3?.bucket) {
      warnings.push('缺少存储桶。');
    }
    if (!config.repoId) {
      warnings.push('缺少同步身份信息。');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
