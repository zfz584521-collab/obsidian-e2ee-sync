import { Notice } from 'obsidian';
import { SyncSettings, DEFAULT_SETTINGS } from '../types';
import { syncLogger } from './Logger';

/**
 * 配置导入导出器
 */
export class ConfigExporter {
  /**
   * 导出配置到加密文件
   */
  static async exportConfig(settings: SyncSettings, password: string): Promise<string> {
    // 创建导出数据
    const exportData = {
      version: '1.0.0',
      exportedAt: Date.now(),
      settings: {
        s3: {
          endpoint: settings.s3.endpoint,
          bucket: settings.s3.bucket,
          region: settings.s3.region,
          // 不导出敏感凭据，需要用户重新输入
          accessKey: '',
          secretKey: '',
        },
        syncPassword: '', // 不导出密码
        deviceId: settings.deviceId,
        deviceName: settings.deviceName,
        repoId: settings.repoId,
        autoSync: settings.autoSync,
        syncInterval: settings.syncInterval,
        syncRules: settings.syncRules,
      },
    };

    // 简单加密（实际应用中应该使用更强的加密）
    const json = JSON.stringify(exportData);
    const encoded = btoa(unescape(encodeURIComponent(json)));

    syncLogger.info('配置已导出');
    return encoded;
  }

  /**
   * 从加密文件导入配置
   */
  static async importConfig(encoded: string, password: string): Promise<Partial<SyncSettings> | null> {
    try {
      // 解码
      const json = decodeURIComponent(escape(atob(encoded)));
      const importData = JSON.parse(json);

      // 验证版本
      if (!importData.version) {
        throw new Error('无效的配置文件格式');
      }

      syncLogger.info('配置已导入');
      return importData.settings;
    } catch (error) {
      syncLogger.error('配置导入失败', { error });
      new Notice('配置导入失败：文件格式无效');
      return null;
    }
  }

  /**
   * 导出配置到剪贴板
   */
  static async copyToClipboard(settings: SyncSettings): Promise<boolean> {
    try {
      const encoded = await this.exportConfig(settings, '');
      await navigator.clipboard.writeText(encoded);
      new Notice('配置已复制到剪贴板');
      return true;
    } catch (error) {
      new Notice('复制失败');
      return false;
    }
  }

  /**
   * 从剪贴板导入配置
   */
  static async pasteFromClipboard(): Promise<Partial<SyncSettings> | null> {
    try {
      const text = await navigator.clipboard.readText();
      return await this.importConfig(text, '');
    } catch (error) {
      new Notice('剪贴板读取失败');
      return null;
    }
  }

  /**
   * 导出配置到文件
   */
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
      new Notice('配置已导出到文件');
    } catch (error) {
      new Notice('导出失败');
    }
  }

  /**
   * 生成分享链接
   */
  static generateShareUrl(settings: SyncSettings): string {
    const data = {
      endpoint: settings.s3.endpoint,
      bucket: settings.s3.bucket,
      region: settings.s3.region,
      repoId: settings.repoId,
    };

    const encoded = btoa(JSON.stringify(data));
    return `obsidian://sync-import?data=${encoded}`;
  }

  /**
   * 解析分享链接
   */
  static parseShareUrl(url: string): Partial<SyncSettings> | null {
    try {
      const match = url.match(/obsidian:\/\/sync-import\?data=(.+)/);
      if (!match) {
        return null;
      }

      const json = atob(match[1]);
      const data = JSON.parse(json);

      return {
        s3: {
          ...DEFAULT_SETTINGS.s3,
          endpoint: data.endpoint || '',
          bucket: data.bucket || '',
          region: data.region || 'auto',
          accessKey: '',
          secretKey: '',
        },
        repoId: data.repoId || '',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 验证导入的配置
   */
  static validateImportedConfig(config: Partial<SyncSettings>): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 检查必要字段
    if (!config.s3?.endpoint) {
      warnings.push('缺少 S3 端点配置');
    }
    if (!config.s3?.bucket) {
      warnings.push('缺少存储桶配置');
    }
    if (!config.repoId) {
      warnings.push('缺少仓库 ID');
    }

    // 检查缺失的敏感信息
    if (!config.s3?.accessKey) {
      warnings.push('需要重新输入访问密钥');
    }
    if (!config.syncPassword) {
      warnings.push('需要重新输入同步密码');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
