import { beforeAll, describe, expect, it, vi } from 'vitest';

let runAliyunOssStsSmoke: any;

beforeAll(async () => {
  // @ts-ignore - Node ESM helper script used by backend integration tests.
  const module = await import('../scripts/aliyun-oss-sts-smoke.mjs');
  runAliyunOssStsSmoke = module.runAliyunOssStsSmoke;
});

describe('Aliyun OSS STS smoke runner', () => {
  it('validates scoped CRUD access and returns only a redacted report', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        Credentials: {
          AccessKeyId: 'STS.SENSITIVE_ACCESS_KEY',
          AccessKeySecret: 'SENSITIVE_SECRET',
          SecurityToken: 'SENSITIVE_SECURITY_TOKEN',
          Expiration: '2026-07-14T12:00:00Z',
        },
      }),
    });
    const send = vi.fn(async (command: any) => {
      if (command.constructor.name === 'GetObjectCommand') {
        return { Body: { transformToString: async () => 'sts-commercial-smoke' } };
      }
      if (
        command.constructor.name === 'ListObjectsV2Command'
        && command.input.Prefix.includes('sts_other')
      ) {
        throw Object.assign(new Error('denied'), {
          name: 'AccessDenied',
          $metadata: { httpStatusCode: 403 },
        });
      }
      return {};
    });
    const clientFactory = vi.fn(() => ({ send, destroy: vi.fn() }));

    const report = await runAliyunOssStsSmoke({
      ALIYUN_ACCESS_KEY_ID: 'SENSITIVE_LONG_TERM_KEY',
      ALIYUN_ACCESS_KEY_SECRET: 'SENSITIVE_LONG_TERM_SECRET',
      ALIYUN_STS_ROLE_ARN: 'acs:ram::1234567890123456:role/sync-role',
      OSS_BUCKET: 'SENSITIVE_BUCKET',
      OSS_ENDPOINT: 'https://s3.oss-cn-hangzhou.aliyuncs.com',
    }, fetchImpl, clientFactory);

    expect(report).toEqual({
      listAllowed: true,
      putAllowed: true,
      getAllowed: true,
      deleteAllowed: true,
      crossPrefixDenied: true,
      cleanupComplete: true,
      success: true,
    });
    expect(JSON.stringify(report)).not.toContain('SENSITIVE');
    expect(JSON.stringify(report)).not.toContain('1234567890123456');
    expect(clientFactory).toHaveBeenCalledWith(expect.objectContaining({
      forcePathStyle: false,
    }));
  });
});
