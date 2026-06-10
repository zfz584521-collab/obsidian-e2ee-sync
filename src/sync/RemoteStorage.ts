import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { S3Config } from '../types';

/**
 * 远端存储服务
 * 处理 S3 兼容存储操作
 */
export class RemoteStorage {
  private config: S3Config | null = null;
  private client: S3Client | null = null;
  private connected: boolean = false;

  /** 内容对象前缀 */
  private static readonly CONTENT_PREFIX = 'content/';
  /** 日志前缀 */
  private static readonly LOG_PREFIX = 'logs/';
  /** 元数据前缀 */
  private static readonly META_PREFIX = 'meta/';

  /**
   * 配置 S3 连接
   */
  setConfig(config: S3Config): void {
    this.config = config;
    console.log('[远端存储] 已设置配置，端点：', config.endpoint);

    // 创建 S3 客户端
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || 'auto',
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      // 支持自定义端点（如 MinIO、Cloudflare R2 等）
      forcePathStyle: !config.endpoint.includes('amazonaws.com'),
    });
  }

  /**
   * 测试与远端存储的连接
   */
  async testConnection(): Promise<boolean> {
    console.log('[远端存储] 正在测试连接...');

    if (!this.client || !this.config) {
      throw new Error('S3 配置未设置');
    }

    try {
      // 尝试获取存储桶信息
      const command = new HeadBucketCommand({
        Bucket: this.config.bucket,
      });
      await this.client.send(command);

      console.log('[远端存储] 连接测试通过');
      this.connected = true;
      return true;
    } catch (error) {
      if (error instanceof S3ServiceException) {
        console.error('[远端存储] 连接失败：', error.message);
        throw new Error(`S3 连接失败：${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 上传加密内容
   */
  async upload(key: string, data: Uint8Array): Promise<string> {
    console.log(`[远端存储] 正在上传 ${key}（${data.length} 字节）`);

    if (!this.client || !this.config) {
      throw new Error('未连接到远端存储');
    }

    try {
      const fullKey = `${RemoteStorage.CONTENT_PREFIX}${key}`;
      const command = new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
        Body: data,
        ContentType: 'application/octet-stream',
      });

      const result = await this.client.send(command);
      const versionId = result.VersionId || `v-${Date.now()}`;

      console.log(`[远端存储] 上传成功，版本：${versionId}`);
      return versionId;
    } catch (error) {
      if (error instanceof S3ServiceException) {
        console.error('[远端存储] 上传失败：', error.message);
        throw new Error(`上传失败：${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 下载加密内容
   */
  async download(key: string): Promise<{ data: Uint8Array; versionId: string }> {
    console.log(`[远端存储] 正在下载 ${key}`);

    if (!this.client || !this.config) {
      throw new Error('未连接到远端存储');
    }

    try {
      const fullKey = `${RemoteStorage.CONTENT_PREFIX}${key}`;
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      });

      const result = await this.client.send(command);

      if (!result.Body) {
        throw new Error('下载内容为空');
      }

      // 将流转换为 Uint8Array
      const data = await this.streamToUint8Array(result.Body);

      const versionId = result.VersionId || '';

      console.log(`[远端存储] 下载成功，${data.length} 字节`);
      return { data, versionId };
    } catch (error) {
      if (error instanceof S3ServiceException) {
        console.error('[远端存储] 下载失败：', error.message);
        throw new Error(`下载失败：${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 检查对象是否存在
   */
  async exists(key: string): Promise<boolean> {
    if (!this.client || !this.config) {
      throw new Error('未连接到远端存储');
    }

    try {
      const fullKey = `${RemoteStorage.CONTENT_PREFIX}${key}`;
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      });
      await this.client.send(command);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 列出指定前缀的对象
   */
  async list(prefix: string): Promise<string[]> {
    console.log(`[远端存储] 正在列出前缀为 ${prefix} 的对象`);

    if (!this.client || !this.config) {
      throw new Error('未连接到远端存储');
    }

    try {
      const objects: string[] = [];
      let continuationToken: string | undefined;

      do {
        const command = new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        });

        const result = await this.client.send(command);

        if (result.Contents) {
          for (const obj of result.Contents) {
            if (obj.Key) {
              objects.push(obj.Key);
            }
          }
        }

        continuationToken = result.NextContinuationToken;
      } while (continuationToken);

      console.log(`[远端存储] 找到 ${objects.length} 个对象`);
      return objects;
    } catch (error) {
      if (error instanceof S3ServiceException) {
        console.error('[远端存储] 列表失败：', error.message);
        throw new Error(`列表失败：${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 删除对象
   */
  async delete(key: string): Promise<void> {
    console.log(`[远端存储] 正在删除 ${key}`);

    if (!this.client || !this.config) {
      throw new Error('未连接到远端存储');
    }

    try {
      const fullKey = `${RemoteStorage.CONTENT_PREFIX}${key}`;
      const command = new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      });

      await this.client.send(command);
      console.log(`[远端存储] 删除成功`);
    } catch (error) {
      if (error instanceof S3ServiceException) {
        console.error('[远端存储] 删除失败：', error.message);
        throw new Error(`删除失败：${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 上传设备日志
   */
  async uploadLog(deviceId: string, logData: Uint8Array, clock: number): Promise<void> {
    if (!this.client || !this.config) {
      throw new Error('未连接到远端存储');
    }

    const key = `${RemoteStorage.LOG_PREFIX}${deviceId}/${clock}.json`;
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: logData,
      ContentType: 'application/json',
    });

    await this.client.send(command);
    console.log(`[远端存储] 日志上传成功：${key}`);
  }

  /**
   * 获取设备日志列表
   */
  async listDeviceLogs(deviceId: string, fromClock?: number): Promise<string[]> {
    const prefix = `${RemoteStorage.LOG_PREFIX}${deviceId}/`;
    const logs = await this.list(prefix);

    if (fromClock !== undefined) {
      return logs.filter(key => {
        const match = key.match(/(\d+)\.json$/);
        if (match) {
          return parseInt(match[1], 10) > fromClock;
        }
        return false;
      });
    }

    return logs;
  }

  /**
   * 创建仓库元数据
   */
  async createRepoMetadata(repoId: string, metadata: Record<string, unknown>): Promise<void> {
    if (!this.client || !this.config) {
      throw new Error('未连接到远端存储');
    }

    const key = `${RemoteStorage.META_PREFIX}repo/${repoId}.json`;
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: new TextEncoder().encode(JSON.stringify(metadata, null, 2)),
      ContentType: 'application/json',
    });

    await this.client.send(command);
    console.log(`[远端存储] 仓库元数据创建成功：${key}`);
  }

  /**
   * 获取仓库元数据
   */
  async getRepoMetadata(repoId: string): Promise<Record<string, unknown> | null> {
    if (!this.client || !this.config) {
      throw new Error('未连接到远端存储');
    }

    try {
      const key = `${RemoteStorage.META_PREFIX}repo/${repoId}.json`;
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });

      const result = await this.client.send(command);
      if (!result.Body) {
        return null;
      }

      const data = await this.streamToUint8Array(result.Body);
      const text = new TextDecoder().decode(data);
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /**
   * 将流转换为 Uint8Array
   */
  private async streamToUint8Array(body: unknown): Promise<Uint8Array> {
    // Node.js 环境（Electron）
    if (body && typeof body === 'object' && 'toArray' in body) {
      const buffer = await (body as { toArray: () => Promise<Uint8Array> }).toArray();
      return buffer;
    }

    // 浏览器环境
    if (body instanceof ReadableStream) {
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLength += value.length;
      }

      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    }

    // Blob
    if (body instanceof Blob) {
      const buffer = await body.arrayBuffer();
      return new Uint8Array(buffer);
    }

    throw new Error('无法识别的响应体类型');
  }

  /**
   * 销毁客户端
   */
  destroy(): void {
    this.client?.destroy();
    this.client = null;
    this.connected = false;
    console.log('[远端存储] 已断开连接');
  }
}
