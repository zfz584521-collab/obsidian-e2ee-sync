import { SyncSettings } from '../types';

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class ConfigValidator {
  static validate(settings: SyncSettings): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { s3 } = settings;

    if (!s3.endpoint.trim()) {
      errors.push('缺少服务地址 Endpoint。');
    } else {
      try {
        const url = new URL(s3.endpoint);
        if (!['http:', 'https:'].includes(url.protocol)) {
          errors.push('服务地址必须以 http:// 或 https:// 开头。');
        }
      } catch {
        errors.push('服务地址不是合法 URL。');
      }
    }

    if (!s3.bucket.trim()) {
      errors.push('缺少存储桶 Bucket。');
    }

    if (!s3.accessKey.trim()) {
      errors.push('缺少 AccessKey。');
    }

    if (!s3.secretKey.trim()) {
      errors.push('缺少 SecretKey。');
    }

    if (!settings.syncPassword) {
      errors.push('缺少同步密码。');
    } else if (settings.syncPassword.length < 12) {
      warnings.push('同步密码较短，建议使用更长且唯一的密码，并只在自己的设备之间共享。');
    }

    if (!settings.deviceId.trim()) {
      errors.push('缺少设备 ID。');
    }

    if (settings.syncInterval < 0 || !Number.isFinite(settings.syncInterval)) {
      errors.push('同步间隔必须为 0 或正数。');
    }

    const storagePrefix = s3.storagePrefix || '';
    if (storagePrefix.includes('\\')) {
      warnings.push('同步通道前缀建议使用 /，不要使用反斜杠。');
    }
    if (storagePrefix.startsWith('/') || storagePrefix.endsWith('/')) {
      warnings.push('同步通道前缀不建议以 / 开头或结尾。');
    }
    if (storagePrefix.includes('//')) {
      warnings.push('同步通道前缀不应包含空路径段。');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  static format(result: ConfigValidationResult): string {
    if (result.valid && result.warnings.length === 0) {
      return '配置看起来没问题，可以继续测试连接或同步。';
    }

    const parts: string[] = [];
    if (result.errors.length > 0) {
      parts.push(`错误：${result.errors.join(' ')}`);
    }
    if (result.warnings.length > 0) {
      parts.push(`提醒：${result.warnings.join(' ')}`);
    }
    return parts.join(' ');
  }
}
