import { describe, expect, it } from 'vitest';
import { SyncSettings } from '../src/types';
import { ConfigValidator } from '../src/utils/ConfigValidator';

const completeSettings = (overrides: Partial<SyncSettings> = {}): SyncSettings => {
  const base: SyncSettings = {
    credentialMode: 'static',
    s3: {
      endpoint: 'https://oss.example.test',
      bucket: 'notes-bucket',
      accessKey: 'access-key',
      secretKey: 'secret-key',
      region: 'auto',
      storagePrefix: 'personal-channel',
    },
    sts: {
      authServerUrl: '',
      authToken: '',
      vaultId: 'main',
      refreshSkewMs: 300000,
    },
    syncPassword: 'long-shared-password',
    deviceId: 'dev_current_device',
    deviceName: 'Laptop',
    repoId: 'repo_shared_between_devices',
    autoSync: false,
    syncInterval: 0,
    syncRules: [],
    concurrentUploads: 10,
    concurrentDownloads: 10,
  };

  return {
    ...base,
    ...overrides,
    s3: {
      ...base.s3,
      ...(overrides.s3 || {}),
    },
  };
};

describe('ConfigValidator', () => {
  it('accepts a complete sync configuration', () => {
    const result = ConfigValidator.validate(completeSettings());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('reports missing required fields clearly', () => {
    const result = ConfigValidator.validate(completeSettings({
      s3: {
        endpoint: '',
        bucket: '',
        accessKey: '',
        secretKey: '',
        region: 'auto',
        storagePrefix: '',
      },
      syncPassword: '',
      deviceId: '',
      repoId: '',
    }));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('缺少服务地址 Endpoint。');
    expect(result.errors).toContain('缺少存储桶 Bucket。');
    expect(result.errors).toContain('缺少 AccessKey。');
    expect(result.errors).toContain('缺少 SecretKey。');
    expect(result.errors).toContain('缺少同步密码。');
    expect(result.errors).toContain('缺少设备 ID。');
    expect(result.warnings).not.toContain('缺少仓库 ID。首次同步可以自动创建，但第二台设备必须使用同一个仓库 ID。');
  });

  it('warns about storage prefix values that normalize poorly', () => {
    const result = ConfigValidator.validate(completeSettings({
      s3: {
        endpoint: 'https://oss.example.test',
        bucket: 'notes-bucket',
        accessKey: 'access-key',
        secretKey: 'secret-key',
        region: 'auto',
        storagePrefix: '/team\\notes//',
      },
    }));

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('同步通道前缀建议使用 /，不要使用反斜杠。');
    expect(result.warnings).toContain('同步通道前缀不建议以 / 开头或结尾。');
    expect(result.warnings).toContain('同步通道前缀不应包含空路径段。');
  });

  it('validates commercial STS mode without static AccessKey fields', () => {
    const result = ConfigValidator.validate(completeSettings({
      credentialMode: 'sts',
      s3: {
        endpoint: '',
        bucket: '',
        accessKey: '',
        secretKey: '',
        region: 'auto',
        storagePrefix: '',
      },
      sts: {
        authServerUrl: 'https://sync.example.test',
        authToken: 'commercial-token',
        vaultId: 'main',
        refreshSkewMs: 300000,
      },
    }));

    expect(result.valid).toBe(true);
    expect(result.errors).not.toContain('缺少 AccessKey。');
    expect(result.errors).not.toContain('缺少 SecretKey。');
    expect(result.errors).not.toContain('缺少存储桶 Bucket。');
  });

  it('reports missing commercial authorization fields', () => {
    const result = ConfigValidator.validate(completeSettings({
      credentialMode: 'sts',
      sts: {
        authServerUrl: '',
        authToken: '',
        vaultId: 'main',
        refreshSkewMs: 300000,
      },
    }));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('缺少授权服务地址。');
    expect(result.errors).toContain('缺少授权令牌。');
  });

  it('warns when commercial authorization service is not HTTPS outside localhost', () => {
    const result = ConfigValidator.validate(completeSettings({
      credentialMode: 'sts',
      sts: {
        authServerUrl: 'http://sync.example.test',
        authToken: 'commercial-token',
        vaultId: 'main',
        refreshSkewMs: 300000,
      },
    }));

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('商业模式建议使用 HTTPS 授权服务地址，避免授权令牌被窃听。');
  });

  it('allows localhost HTTP for mock STS development', () => {
    const result = ConfigValidator.validate(completeSettings({
      credentialMode: 'sts',
      sts: {
        authServerUrl: 'http://127.0.0.1:8787',
        authToken: 'commercial-token',
        vaultId: 'main',
        refreshSkewMs: 300000,
      },
    }));

    expect(result.valid).toBe(true);
    expect(result.warnings).not.toContain('商业模式建议使用 HTTPS 授权服务地址，避免授权令牌被窃听。');
  });

  it('formats validation results for a short settings-page notice', () => {
    expect(ConfigValidator.format(ConfigValidator.validate(completeSettings()))).toBe('配置看起来没问题，可以继续测试连接或同步。');

    const invalid = ConfigValidator.validate(completeSettings({ syncPassword: '' }));
    expect(ConfigValidator.format(invalid)).toContain('错误：缺少同步密码。');
  });
});
