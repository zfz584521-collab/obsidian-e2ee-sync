import { beforeAll, describe, expect, it } from 'vitest';

let buildOssStsPolicy: any;
let normalizeOssPrefix: any;

beforeAll(async () => {
  // @ts-ignore - Node ESM helper script used by backend integration tests.
  const module = await import('../scripts/aliyun-oss-sts-policy.mjs');
  buildOssStsPolicy = module.buildOssStsPolicy;
  normalizeOssPrefix = module.normalizeOssPrefix;
});

describe('Aliyun OSS STS policy helper', () => {
  it('normalizes user vault prefixes safely', () => {
    expect(normalizeOssPrefix('/tenants\\u_10001//vaults/main/')).toBe('tenants/u_10001/vaults/main');
  });

  it('builds a least-prefix OSS policy', () => {
    const policy = buildOssStsPolicy({
      bucket: 'obsidian-sync-commercial',
      prefix: 'tenants/u_10001/vaults/main/repos/repo_main',
    });

    expect(policy.Statement).toHaveLength(3);
    expect(policy.Statement[0]).toMatchObject({
      Effect: 'Allow',
      Action: ['oss:GetBucketInfo'],
      Resource: ['acs:oss:*:*:obsidian-sync-commercial'],
    });
    expect(policy.Statement[0]).not.toHaveProperty('Condition');
    expect(policy.Statement[1]).toMatchObject({
      Effect: 'Allow',
      Action: ['oss:ListObjects'],
      Resource: ['acs:oss:*:*:obsidian-sync-commercial'],
      Condition: {
        StringLike: {
          'oss:Prefix': ['tenants/u_10001/vaults/main/repos/repo_main/*'],
        },
      },
    });
    expect(policy.Statement[2].Resource).toEqual([
      'acs:oss:*:*:obsidian-sync-commercial/tenants/u_10001/vaults/main/repos/repo_main/*',
    ]);
  });

  it('requires bucket and prefix', () => {
    expect(() => buildOssStsPolicy({ bucket: '', prefix: 'tenants/u' })).toThrow('bucket is required');
    expect(() => buildOssStsPolicy({ bucket: 'bucket', prefix: '' })).toThrow('prefix is required');
  });
});
