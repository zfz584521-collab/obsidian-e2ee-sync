import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  requestUrl: vi.fn(),
}));

import { ObsidianHttpHandler } from '../src/sync/ObsidianHttpHandler';

describe('ObsidianHttpHandler', () => {
  it('sends Smithy requests through Obsidian requestUrl', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: { etag: '"test"' },
      arrayBuffer: new Uint8Array([4, 5, 6]).buffer,
    });
    const handler = new ObsidianHttpHandler(request);

    const result = await handler.handle({
      protocol: 'https:',
      hostname: 'bucket.oss-cn-hangzhou.aliyuncs.com',
      path: '/content/test',
      query: { versionId: 'a b', flag: null },
      method: 'PUT',
      headers: { authorization: 'signed' },
      body: new Uint8Array([1, 2, 3]),
    });

    expect(request).toHaveBeenCalledWith({
      url: 'https://bucket.oss-cn-hangzhou.aliyuncs.com/content/test?versionId=a%20b&flag',
      method: 'PUT',
      headers: { authorization: 'signed' },
      body: new Uint8Array([1, 2, 3]).buffer,
      throw: false,
    });
    expect(result.response.statusCode).toBe(200);
    expect(result.response.headers.etag).toBe('"test"');
    const reader = result.response.body.getReader();
    const chunk = await reader.read();
    expect(chunk.done).toBe(false);
    expect(chunk.value).toEqual(new Uint8Array([4, 5, 6]));
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });

  it('rejects when Obsidian requestUrl never settles', async () => {
    const request = vi.fn(() => new Promise<never>(() => {}));
    const handler = new ObsidianHttpHandler(request, 10);

    const outcome = await Promise.race([
      handler.handle({
        protocol: 'https:',
        hostname: 'bucket.oss-cn-hangzhou.aliyuncs.com',
        path: '/content/test',
        method: 'GET',
        headers: {},
      }).then(
        () => 'resolved',
        error => error instanceof Error ? error.message : String(error)
      ),
      new Promise<string>(resolve => setTimeout(() => resolve('still pending'), 50)),
    ]);

    expect(outcome).toBe('对象存储请求超时');
  });
});
