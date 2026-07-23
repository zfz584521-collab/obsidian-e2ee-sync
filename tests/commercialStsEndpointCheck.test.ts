import { beforeAll, describe, expect, it } from 'vitest';

let runCommercialStsEndpointCheck: any;

beforeAll(async () => {
  // @ts-ignore - Node ESM helper script used by backend integration tests.
  ({ runCommercialStsEndpointCheck } = await import('../scripts/commercial-sts-endpoint-check.mjs'));
});

describe('commercial STS endpoint check', () => {
  it('reports only whitelisted health and readiness metadata', async () => {
    const fetchImpl = async (url: URL) => {
      if (url.pathname.endsWith('/healthz')) {
        return { ok: true, status: 200, json: async () => ({ status: 'ok', raw: 'do-not-return' }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ready',
          provider: 'aliyun',
          store: 'persistent',
          counts: { users: 2, tokens: 3, devices: 4, auditLogs: 5 },
          raw: 'do-not-return',
        }),
      };
    };

    const report = await runCommercialStsEndpointCheck({
      baseUrl: 'https://sync.example.test/',
      fetchImpl,
    });

    expect(report).toEqual({
      success: true,
      health: { statusCode: 200, status: 'ok' },
      readiness: {
        statusCode: 200,
        status: 'ready',
        provider: 'aliyun',
        store: 'persistent',
        counts: { users: 2, tokens: 3, devices: 4, auditLogs: 5 },
      },
    });
    expect(JSON.stringify(report)).not.toContain('do-not-return');
    expect(JSON.stringify(report)).not.toContain('sync.example.test');
  });

  it('reports endpoint status without exposing an error response body', async () => {
    const fetchImpl = async (url: URL) => {
      if (url.pathname.endsWith('/healthz')) {
        return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ message: 'raw backend secret=DO_NOT_EXPOSE' }),
      };
    };

    const report = await runCommercialStsEndpointCheck({
      baseUrl: 'https://sync.example.test',
      fetchImpl,
    });

    expect(report).toEqual({
      success: false,
      health: { statusCode: 200, status: 'ok' },
      readiness: { statusCode: 404 },
    });
    expect(JSON.stringify(report)).not.toContain('DO_NOT_EXPOSE');
  });

  it('rejects missing or insecure non-local endpoint URLs', async () => {
    await expect(runCommercialStsEndpointCheck({ baseUrl: '' })).rejects.toThrow(
      'COMMERCIAL_STS_BASE_URL must be a valid HTTPS URL',
    );
    await expect(runCommercialStsEndpointCheck({ baseUrl: 'http://sync.example.test' })).rejects.toThrow(
      'COMMERCIAL_STS_BASE_URL must be a valid HTTPS URL',
    );
  });
});
