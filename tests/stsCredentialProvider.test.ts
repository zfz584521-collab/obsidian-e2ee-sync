import { describe, expect, it, vi } from 'vitest';
import { SyncSettings } from '../src/types';
import { StsCredentialProvider, StsCredentialTransport } from '../src/sync/StsCredentialProvider';
import { syncLogger } from '../src/utils/Logger';

vi.mock('obsidian', () => ({
  requestUrl: vi.fn(),
  Notice: vi.fn(),
  Modal: class MockModal {},
  Setting: class MockSetting {},
}));

const settings = (overrides: Partial<SyncSettings> = {}): SyncSettings => {
  const base: SyncSettings = {
    credentialMode: 'sts',
    s3: {
      endpoint: '',
      bucket: '',
      accessKey: '',
      secretKey: '',
      securityToken: '',
      region: 'auto',
      storagePrefix: '',
    },
    sts: {
      authServerUrl: 'https://sync.example.test',
      authToken: 'AUTH_TOKEN_SHOULD_NOT_LOG',
      vaultId: 'main',
      refreshSkewMs: 5 * 60 * 1000,
    },
    syncPassword: 'long-shared-password',
    deviceId: 'dev_current_device',
    deviceName: 'Laptop',
    repoId: 'repo_existing',
    autoSync: false,
    syncInterval: 0,
    syncRules: [],
  };

  return {
    ...base,
    ...overrides,
    s3: {
      ...base.s3,
      ...(overrides.s3 || {}),
    },
    sts: {
      ...base.sts,
      ...(overrides.sts || {}),
    },
  };
};

const successResponse = (expiration: string) => ({
  endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
  bucket: 'commercial-bucket',
  region: 'cn-hangzhou',
  storagePrefix: 'tenants/u_10001/vaults/main',
  repoId: 'repo_from_backend',
  credentials: {
    accessKeyId: 'STS_ACCESS_KEY_SHOULD_NOT_LOG',
    accessKeySecret: 'STS_SECRET_SHOULD_NOT_LOG',
    securityToken: 'SECURITY_TOKEN_SHOULD_NOT_LOG',
    expiration,
  },
});

describe('StsCredentialProvider', () => {
  it('fetches temporary credentials on first use', async () => {
    syncLogger.clearLogs();
    const transport = vi.fn<StsCredentialTransport>().mockResolvedValue({
      status: 200,
      json: successResponse('2026-07-11T10:00:00Z'),
    });
    const provider = new StsCredentialProvider(transport, () => Date.parse('2026-07-11T09:00:00Z'));

    const session = await provider.getCredentials(settings(), '0.1.0');

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0].url).toBe('https://sync.example.test/api/sync/credentials');
    expect(transport.mock.calls[0][0].body).toMatchObject({
      vaultId: 'main',
      repoId: 'repo_existing',
      deviceId: 'dev_current_device',
      pluginVersion: '0.1.0',
    });
    expect(session.s3.securityToken).toBe('SECURITY_TOKEN_SHOULD_NOT_LOG');
    expect(session.repoId).toBe('repo_from_backend');
    const exportedLogs = syncLogger.exportLogs();
    expect(exportedLogs).not.toContain('tenants/u_10001');
    expect(exportedLogs).not.toContain('commercial-bucket');
    expect(exportedLogs).not.toContain('oss-cn-hangzhou');
  });

  it('reuses cached credentials while they are still valid', async () => {
    const transport = vi.fn<StsCredentialTransport>().mockResolvedValue({
      status: 200,
      json: successResponse('2026-07-11T10:00:00Z'),
    });
    const provider = new StsCredentialProvider(transport, () => Date.parse('2026-07-11T09:00:00Z'));

    await provider.getCredentials(settings(), '0.1.0');
    await provider.getCredentials(settings(), '0.1.0');

    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('refreshes credentials when expiration is close', async () => {
    let now = Date.parse('2026-07-11T09:00:00Z');
    const transport = vi.fn<StsCredentialTransport>()
      .mockResolvedValueOnce({
        status: 200,
        json: successResponse('2026-07-11T10:00:00Z'),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: successResponse('2026-07-11T11:00:00Z'),
      });
    const provider = new StsCredentialProvider(transport, () => now);

    await provider.getCredentials(settings(), '0.1.0');
    now = Date.parse('2026-07-11T09:56:00Z');
    const refreshed = await provider.getCredentials(settings(), '0.1.0');

    expect(transport).toHaveBeenCalledTimes(2);
    expect(refreshed.expirationMs).toBe(Date.parse('2026-07-11T11:00:00Z'));
  });

  it('returns a Chinese error and does not export sensitive backend details', async () => {
    const transport = vi.fn<StsCredentialTransport>().mockResolvedValue({
      status: 403,
      json: {
        message: 'token=AUTH_TOKEN_SHOULD_NOT_LOG secret=STS_SECRET_SHOULD_NOT_LOG securityToken=SECURITY_TOKEN_SHOULD_NOT_LOG',
      },
    });
    const provider = new StsCredentialProvider(transport, () => Date.parse('2026-07-11T09:00:00Z'));

    let thrownMessage = '';
    try {
      await provider.getCredentials(settings(), '0.1.0');
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error);
    }
    const exportedLogs = syncLogger.exportLogs();

    expect(thrownMessage).toContain('获取临时同步凭证失败');
    expect(thrownMessage).not.toContain('AUTH_TOKEN_SHOULD_NOT_LOG');
    expect(thrownMessage).not.toContain('STS_SECRET_SHOULD_NOT_LOG');
    expect(thrownMessage).not.toContain('SECURITY_TOKEN_SHOULD_NOT_LOG');
    expect(exportedLogs).not.toContain('AUTH_TOKEN_SHOULD_NOT_LOG');
    expect(exportedLogs).not.toContain('STS_SECRET_SHOULD_NOT_LOG');
    expect(exportedLogs).not.toContain('SECURITY_TOKEN_SHOULD_NOT_LOG');
  });

  it.each([
    [401, '授权令牌无效或已过期'],
    [403, '授权失败，请检查账号状态或套餐限制'],
    [429, '请求过于频繁'],
    [502, '授权服务暂时不可用，请稍后重试'],
  ])('maps backend status %s to a safe Chinese message', async (status, expectedMessage) => {
    const transport = vi.fn<StsCredentialTransport>().mockResolvedValue({
      status,
      json: {
        message: 'raw backend message with token=AUTH_TOKEN_SHOULD_NOT_LOG',
      },
    });
    const provider = new StsCredentialProvider(transport, () => Date.parse('2026-07-11T09:00:00Z'));

    await expect(provider.getCredentials(settings(), '0.1.0')).rejects.toThrow(expectedMessage);
  });

  it('maps transport timeout to a safe Chinese message without leaking raw details', async () => {
    syncLogger.clearLogs();
    const transport = vi.fn<StsCredentialTransport>().mockRejectedValue(
      new Error('timeout while calling https://sync.example.test?token=AUTH_TOKEN_SHOULD_NOT_LOG')
    );
    const provider = new StsCredentialProvider(transport, () => Date.parse('2026-07-11T09:00:00Z'));

    let thrownMessage = '';
    try {
      await provider.getCredentials(settings(), '0.1.0');
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error);
    }
    const exportedLogs = syncLogger.exportLogs();

    expect(thrownMessage).toBe('授权服务连接超时，请稍后重试');
    expect(thrownMessage).not.toContain('AUTH_TOKEN_SHOULD_NOT_LOG');
    expect(exportedLogs).not.toContain('AUTH_TOKEN_SHOULD_NOT_LOG');
  });

  it('rejects expired or nearly expired temporary credentials', async () => {
    const transport = vi.fn<StsCredentialTransport>().mockResolvedValue({
      status: 200,
      json: successResponse('2026-07-11T09:04:00Z'),
    });
    const provider = new StsCredentialProvider(transport, () => Date.parse('2026-07-11T09:00:00Z'));

    await expect(provider.getCredentials(settings(), '0.1.0')).rejects.toThrow('授权服务返回的临时凭证已过期或即将过期');
  });
});
