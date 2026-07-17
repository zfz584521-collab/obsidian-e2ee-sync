import { beforeAll, describe, expect, it, vi } from 'vitest';

let runAliyunStsSmoke: any;

beforeAll(async () => {
  // @ts-ignore - Node ESM helper script used by backend integration tests.
  const module = await import('../scripts/aliyun-sts-smoke.mjs');
  runAliyunStsSmoke = module.runAliyunStsSmoke;
});

describe('Aliyun STS smoke runner', () => {
  it('returns only a redacted success report', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        Credentials: {
          AccessKeyId: 'STS.SENSITIVE_ACCESS_KEY',
          AccessKeySecret: 'SENSITIVE_SECRET',
          SecurityToken: 'SENSITIVE_SECURITY_TOKEN',
          Expiration: '2026-07-13T12:00:00Z',
        },
      }),
    });

    const report = await runAliyunStsSmoke({
      ALIYUN_ACCESS_KEY_ID: 'SENSITIVE_LONG_TERM_KEY',
      ALIYUN_ACCESS_KEY_SECRET: 'SENSITIVE_LONG_TERM_SECRET',
      ALIYUN_STS_ROLE_ARN: 'acs:ram::1234567890123456:role/sync-role',
      OSS_BUCKET: 'SENSITIVE_BUCKET',
      STS_DURATION_SECONDS: '3600',
    }, fetchImpl);

    expect(report).toEqual({
      success: true,
      credentialsComplete: true,
      expiration: '2026-07-13T12:00:00Z',
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('SENSITIVE');
    expect(serialized).not.toContain('1234567890123456');
  });
});
