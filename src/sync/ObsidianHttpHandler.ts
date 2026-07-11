import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';

interface SmithyHttpRequest {
  protocol: string;
  hostname: string;
  port?: number;
  path: string;
  query?: Record<string, string | string[] | null>;
  method: string;
  headers: Record<string, string>;
  body?: string | ArrayBuffer | ArrayBufferView;
}

type RequestFunction = (request: RequestUrlParam) => Promise<RequestUrlResponse>;

export class ObsidianHttpHandler {
  readonly metadata = { handlerProtocol: 'http/1.1' };

  constructor(private readonly request: RequestFunction = requestUrl) {}

  async handle(request: SmithyHttpRequest): Promise<{
    response: {
      statusCode: number;
      headers: Record<string, string>;
      body: ReadableStream<Uint8Array>;
    };
  }> {
    const response = await this.request({
      url: this.buildUrl(request),
      method: request.method,
      headers: this.filterHeaders(request.headers),
      body: this.toArrayBuffer(request.body),
      throw: false,
    });

    return {
      response: {
        statusCode: response.status,
        headers: response.headers,
        body: this.toReadableStream(response.arrayBuffer),
      },
    };
  }

  destroy(): void {}

  private buildUrl(request: SmithyHttpRequest): string {
    const port = request.port ? `:${request.port}` : '';
    const queryString = Object.entries(request.query ?? {})
      .flatMap(([key, value]) => {
        const encodedKey = encodeURIComponent(key);
        if (value === null) return encodedKey;
        if (Array.isArray(value)) {
          return value.map(item => `${encodedKey}=${encodeURIComponent(item)}`);
        }
        return `${encodedKey}=${encodeURIComponent(value)}`;
      })
      .join('&');

    return `${request.protocol}//${request.hostname}${port}${request.path}${
      queryString ? `?${queryString}` : ''
    }`;
  }

  private filterHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(headers).filter(([name]) => {
        const normalized = name.toLowerCase();
        return normalized !== 'host' && normalized !== 'content-length';
      })
    );
  }

  private toArrayBuffer(
    body: SmithyHttpRequest['body']
  ): string | ArrayBuffer | undefined {
    if (body === undefined || typeof body === 'string' || body instanceof ArrayBuffer) {
      return body;
    }

    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  }

  private toReadableStream(body: ArrayBuffer): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(body));
        controller.close();
      },
    });
  }
}
