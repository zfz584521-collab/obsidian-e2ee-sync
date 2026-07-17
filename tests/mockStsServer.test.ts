import { afterEach, beforeAll, describe, expect, it } from 'vitest';

let createMockStsServer: any;

beforeAll(async () => {
  // @ts-ignore - The mock server is a Node ESM utility script used by tests.
  const module = await import('../scripts/mock-sts-server.mjs');
  createMockStsServer = module.createMockStsServer;
});

let server: any;

function listen(server: any): Promise<string> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server: any): Promise<void> {
  if (!server) return;
  await new Promise(resolve => server.close(resolve));
}

describe('mock STS server', () => {
  afterEach(async () => {
    await close(server);
    server = undefined;
  });

  it('returns temporary credential shape for valid requests', async () => {
    server = createMockStsServer({ expectedToken: 'test-token' });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/sync/credentials`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        vaultId: 'main',
        repoId: 'repo_existing',
        deviceId: 'dev_test',
        pluginVersion: '0.1.0',
      }),
    });

    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      endpoint: 'https://s3.oss-cn-hangzhou.aliyuncs.com',
      bucket: 'mock-commercial-bucket',
      region: 'cn-hangzhou',
      storagePrefix: 'tenants/mock-user/vaults/main',
      repoId: 'repo_existing',
      credentials: {
        accessKeyId: 'STS.MOCK_ACCESS_KEY_ID',
        accessKeySecret: 'MOCK_TEMPORARY_ACCESS_KEY_SECRET',
        securityToken: 'MOCK_SECURITY_TOKEN',
      },
    });
    expect(Date.parse(json.credentials.expiration)).toBeGreaterThan(Date.now());
  });

  it('rejects invalid authorization tokens', async () => {
    server = createMockStsServer({ expectedToken: 'test-token' });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/sync/credentials`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ vaultId: 'main', deviceId: 'dev_test' }),
    });

    const json = await response.json();
    expect(response.status).toBe(401);
    expect(json.message).toContain('授权令牌无效');
  });

  it('requires device identity', async () => {
    server = createMockStsServer({ expectedToken: 'test-token' });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/sync/credentials`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ vaultId: 'main' }),
    });

    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.message).toBe('缺少设备 ID');
  });
});
