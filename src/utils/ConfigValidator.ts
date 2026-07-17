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
    const mode = settings.credentialMode || 'static';

    if (mode === 'sts') {
      if (!settings.sts.authServerUrl.trim()) {
        errors.push('缺少授权服务地址。');
      } else {
        this.validateUrl(settings.sts.authServerUrl, '授权服务地址', errors);
        if (!this.isLocalHttpUrl(settings.sts.authServerUrl) && settings.sts.authServerUrl.startsWith('http://')) {
          warnings.push('商业模式建议使用 HTTPS 授权服务地址，避免授权令牌被窃听。');
        }
      }

      if (!settings.sts.authToken.trim()) {
        errors.push('缺少授权令牌。');
      }
    } else {
      if (!s3.endpoint.trim()) {
        errors.push('缺少服务地址 Endpoint。');
      } else {
        this.validateUrl(s3.endpoint, '服务地址', errors);
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

  private static validateUrl(value: string, label: string, errors: string[]): void {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push(`${label}必须以 http:// 或 https:// 开头。`);
      }
    } catch {
      errors.push(`${label}不是合法 URL。`);
    }
  }

  private static isLocalHttpUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    } catch {
      return false;
    }
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
