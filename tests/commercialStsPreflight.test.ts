import { beforeAll, describe, expect, it } from 'vitest';

let buildPreflightReport: any;

beforeAll(async () => {
  // @ts-ignore - Node ESM helper script used by backend integration tests.
  const module = await import('../scripts/commercial-sts-preflight.mjs');
  buildPreflightReport = module.buildPreflightReport;
});

describe('commercial STS preflight', () => {
  it('reports missing production variables by name without exposing values', () => {
    const report = buildPreflightReport({
      STS_PROVIDER: 'aliyun',
      ALIYUN_ACCESS_KEY_ID: 'sensitive-access-key',
      ALIYUN_ACCESS_KEY_SECRET: '',
      ALIYUN_STS_ROLE_ARN: '',
      OSS_BUCKET: 'private-bucket-name',
      PUBLIC_BASE_URL: 'https://sync.example.com',
    });

    expect(report.ready).toBe(false);
    expect(report.missing).toEqual([
      'ALIYUN_ACCESS_KEY_SECRET',
      'ALIYUN_STS_ROLE_ARN',
      'TOKEN_SALT',
      'DEVICE_SALT',
      'SEED_AUTH_TOKEN_OR_STORE_PATH',
    ]);
    expect(JSON.stringify(report)).not.toContain('sensitive-access-key');
    expect(JSON.stringify(report)).not.toContain('private-bucket-name');
  });

  it('accepts persistent storage without retaining a seed token', () => {
    const report = buildPreflightReport({
      STS_PROVIDER: 'aliyun',
      ALIYUN_ACCESS_KEY_ID: 'sensitive-access-key',
      ALIYUN_ACCESS_KEY_SECRET: 'sensitive-secret',
      ALIYUN_STS_ROLE_ARN: 'acs:ram::1234567890123456:role/sync-role',
      OSS_BUCKET: 'private-bucket-name',
      OSS_ENDPOINT: 'https://s3.oss-cn-hangzhou.aliyuncs.com',
      PUBLIC_BASE_URL: 'https://sync.example.com',
      STORE_PATH: '/app/data/store.json',
      TOKEN_SALT: 'sensitive-token-salt',
      DEVICE_SALT: 'sensitive-device-salt',
    });

    expect(report.ready).toBe(true);
    expect(report.missing).toEqual([]);
    expect(JSON.stringify(report)).not.toContain('/app/data/store.json');
    expect(JSON.stringify(report)).not.toContain('sensitive');
  });

  it('accepts a complete HTTPS Aliyun configuration and returns only safe metadata', () => {
    const report = buildPreflightReport({
      STS_PROVIDER: 'aliyun',
      ALIYUN_ACCESS_KEY_ID: 'sensitive-access-key',
      ALIYUN_ACCESS_KEY_SECRET: 'sensitive-secret',
      ALIYUN_STS_ROLE_ARN: 'acs:ram::1234567890123456:role/sync-role',
      OSS_BUCKET: 'private-bucket-name',
      OSS_ENDPOINT: 'https://s3.oss-cn-hangzhou.aliyuncs.com',
      OSS_REGION: 'cn-hangzhou',
      PUBLIC_BASE_URL: 'https://sync.example.com',
      SEED_AUTH_TOKEN: 'sensitive-user-token',
      TOKEN_SALT: 'sensitive-token-salt',
      DEVICE_SALT: 'sensitive-device-salt',
      STS_DURATION_SECONDS: '3600',
    });

    expect(report).toEqual({
      ready: true,
      provider: 'aliyun',
      durationSeconds: 3600,
      publicHttps: true,
      ossHttps: true,
      missing: [],
      warnings: [],
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('sensitive');
    expect(serialized).not.toContain('1234567890123456');
    expect(serialized).not.toContain('private-bucket-name');
  });

  it('rejects mock mode and insecure production endpoints', () => {
    const report = buildPreflightReport({
      STS_PROVIDER: 'mock',
      PUBLIC_BASE_URL: 'http://sync.example.com',
      OSS_ENDPOINT: 'http://oss.example.com',
    });

    expect(report.ready).toBe(false);
    expect(report.warnings).toContain('STS_PROVIDER must be aliyun for real validation');
    expect(report.warnings).toContain('PUBLIC_BASE_URL must use HTTPS');
    expect(report.warnings).toContain('OSS_ENDPOINT must use HTTPS');
  });

  it('reports only the missing admin password variable when the admin page is enabled', () => {
    const report = buildPreflightReport({
      STS_PROVIDER: 'aliyun',
      ALIYUN_ACCESS_KEY_ID: 'sensitive-access-key',
      ALIYUN_ACCESS_KEY_SECRET: 'sensitive-secret',
      ALIYUN_STS_ROLE_ARN: 'acs:ram::1234567890123456:role/sync-role',
      OSS_BUCKET: 'private-bucket-name',
      OSS_ENDPOINT: 'https://s3.oss-cn-hangzhou.aliyuncs.com',
      PUBLIC_BASE_URL: 'https://sync.example.com',
      STORE_PATH: '/app/data/store.json',
      TOKEN_SALT: 'sensitive-token-salt',
      DEVICE_SALT: 'sensitive-device-salt',
      ADMIN_ENABLED: 'true',
      ADMIN_PASSWORD: '',
    });

    expect(report.ready).toBe(false);
    expect(report.missing).toEqual(['ADMIN_PASSWORD']);
    expect(JSON.stringify(report)).not.toContain('sensitive');
  });

  it('treats the public admin password placeholder as missing', () => {
    const report = buildPreflightReport({
      STS_PROVIDER: 'aliyun',
      ALIYUN_ACCESS_KEY_ID: 'sensitive-access-key',
      ALIYUN_ACCESS_KEY_SECRET: 'sensitive-secret',
      ALIYUN_STS_ROLE_ARN: 'acs:ram::1234567890123456:role/sync-role',
      OSS_BUCKET: 'private-bucket-name',
      OSS_ENDPOINT: 'https://s3.oss-cn-hangzhou.aliyuncs.com',
      PUBLIC_BASE_URL: 'https://sync.example.com',
      STORE_PATH: '/app/data/store.json',
      TOKEN_SALT: 'sensitive-token-salt',
      DEVICE_SALT: 'sensitive-device-salt',
      ADMIN_ENABLED: 'true',
      ADMIN_PASSWORD: 'replace_with_a_unique_password_of_at_least_16_characters',
    });

    expect(report.ready).toBe(false);
    expect(report.missing).toContain('ADMIN_PASSWORD');
    expect(JSON.stringify(report)).not.toContain('replace_with_a_unique_password');
  });
});
