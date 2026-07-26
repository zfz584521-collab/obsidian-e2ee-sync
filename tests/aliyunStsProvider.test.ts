import { beforeAll, describe, expect, it, vi } from 'vitest';

let EMPTY_SHA256: string;
let canonicalQueryString: any;
let createAliyunAssumeRoleProvider: any;
let loadAliyunProviderConfig: any;
let makeRoleSessionName: any;
let signRpcV1Request: any;
let signOpenApiRequest: any;
let validateAliyunProviderConfig: any;

beforeAll(async () => {
  // @ts-ignore - Node ESM helper script used by backend integration tests.
  const module = await import('../scripts/aliyun-sts-provider.mjs');
  EMPTY_SHA256 = module.EMPTY_SHA256;
  canonicalQueryString = module.canonicalQueryString;
  createAliyunAssumeRoleProvider = module.createAliyunAssumeRoleProvider;
  loadAliyunProviderConfig = module.loadAliyunProviderConfig;
  makeRoleSessionName = module.makeRoleSessionName;
  signRpcV1Request = module.signRpcV1Request;
  signOpenApiRequest = module.signOpenApiRequest;
  validateAliyunProviderConfig = module.validateAliyunProviderConfig;
});

describe('Aliyun STS provider', () => {
  it('matches Alibaba Cloud OpenAPI V3 fixed signature example', () => {
    const signed = signOpenApiRequest({
      method: 'POST',
      canonicalUri: '/',
      query: {
        ImageId: 'win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd',
        RegionId: 'cn-shanghai',
      },
      headers: {
        host: 'ecs.cn-shanghai.aliyuncs.com',
        'x-acs-action': 'RunInstances',
        'x-acs-date': '2023-10-26T10:22:32Z',
        'x-acs-signature-nonce': '3156853299f313e23d1673dc12e1703d',
        'x-acs-version': '2014-05-26',
      },
      body: '',
      accessKeyId: 'YourAccessKeyId',
      accessKeySecret: 'YourAccessKeySecret',
    });

    expect(EMPTY_SHA256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(signed.canonicalQuery).toBe('ImageId=win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd&RegionId=cn-shanghai');
    expect(signed.stringToSign).toBe('ACS3-HMAC-SHA256\n7ea06492da5221eba5297e897ce16e55f964061054b7695beedaac1145b1e259');
    expect(signed.signature).toBe('06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0');
  });

  it('canonicalizes query parameters with percent encoding', () => {
    expect(canonicalQueryString({
      RoleSessionName: 'u 1/main',
      RoleArn: 'acs:ram::123:role/test',
    })).toBe('RoleArn=acs%3Aram%3A%3A123%3Arole%2Ftest&RoleSessionName=u%201%2Fmain');
  });

  it('signs RPC-style STS requests with HMAC-SHA1', () => {
    const signed = signRpcV1Request({
      method: 'POST',
      query: {
        AccessKeyId: 'ak',
        Action: 'AssumeRole',
        SignatureMethod: 'HMAC-SHA1',
        SignatureNonce: 'nonce123',
        SignatureVersion: '1.0',
        Timestamp: '2026-07-13T09:00:00Z',
        Version: '2015-04-01',
      },
      accessKeySecret: 'secret',
    });

    expect(signed.canonicalQuery).toContain('Action=AssumeRole');
    expect(signed.stringToSign).toContain('POST&%2F&');
    expect(signed.signature).toBe('w2VXGLgLlJeKddb3qZK29DemnxQ=');
  });

  it('loads and validates required provider configuration', () => {
    const config = loadAliyunProviderConfig({
      ALIYUN_ACCESS_KEY_ID: 'ak',
      ALIYUN_ACCESS_KEY_SECRET: 'secret',
      ALIYUN_STS_ROLE_ARN: 'acs:ram::123:role/sync',
      OSS_BUCKET: 'bucket',
      STS_DURATION_SECONDS: '3600',
    });

    expect(() => validateAliyunProviderConfig(config)).not.toThrow();
    expect(() => validateAliyunProviderConfig({
      ...config,
      accessKeySecret: '',
    })).toThrow('ALIYUN_ACCESS_KEY_SECRET');
  });

  it('builds AssumeRole requests and maps returned credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        Credentials: {
          AccessKeyId: 'STS.real',
          AccessKeySecret: 'temporary-secret',
          SecurityToken: 'temporary-token',
          Expiration: '2026-07-13T10:00:00Z',
        },
      }),
    });
    const provider = createAliyunAssumeRoleProvider({
      endpoint: 'https://sts.aliyuncs.com',
      accessKeyId: 'ak',
      accessKeySecret: 'secret',
      roleArn: 'acs:ram::123:role/sync',
      durationSeconds: 3600,
      ossBucket: 'obsidian-sync-commercial',
      now: () => Date.parse('2026-07-13T09:00:00Z'),
      nonce: () => 'nonce123',
    }, fetchImpl);

    const credentials = await provider.assumeRole({
      userId: 'u_10001',
      vaultId: 'main',
      repoId: 'repo_main',
      storagePrefix: 'tenants/u_10001/vaults/main/repos/repo_main',
    });

    expect(credentials).toEqual({
      accessKeyId: 'STS.real',
      accessKeySecret: 'temporary-secret',
      securityToken: 'temporary-token',
      expiration: '2026-07-13T10:00:00Z',
    });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://sts.aliyuncs.com');
    expect(options.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(options.body).toContain('RoleArn=acs%3Aram%3A%3A123%3Arole%2Fsync');
    expect(options.body).toContain('RoleSessionName=u_10001-main-repo_main');
    expect(options.body).toContain('Policy=');
    expect(options.body).toContain('AccessKeyId=ak');
    expect(options.body).toContain('Action=AssumeRole');
    expect(options.body).toContain('Signature=');
    expect(options.body).toContain('SignatureMethod=HMAC-SHA1');
    expect(options.body).toContain('Version=2015-04-01');
  });

  it('throws a clear error for failed AssumeRole responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ Message: 'No permission' }),
    });
    const provider = createAliyunAssumeRoleProvider({
      endpoint: 'https://sts.aliyuncs.com',
      accessKeyId: 'ak',
      accessKeySecret: 'secret',
      roleArn: 'acs:ram::123:role/sync',
      durationSeconds: 3600,
      ossBucket: 'obsidian-sync-commercial',
    }, fetchImpl);

    await expect(provider.assumeRole({
      userId: 'u_10001',
      vaultId: 'main',
      repoId: 'repo_main',
      storagePrefix: 'tenants/u_10001/vaults/main/repos/repo_main',
    })).rejects.toThrow('Aliyun STS AssumeRole failed (403): No permission');
  });

  it('keeps role session names within Aliyun limits', () => {
    const name = makeRoleSessionName('u/10001', '../main vault', 'repo_with_a_very_long_suffix_that_should_be_truncated_for_aliyun_limits');

    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toMatch(/^[a-zA-Z0-9.@_-]+$/);
  });
});
