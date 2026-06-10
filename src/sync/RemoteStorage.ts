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
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { S3Config } from '../types';
import { withRetry, DEFAULT_RETRY_CONFIG, RetryConfig } from '../utils/retry';
import { SyncError, SyncErrorCode } from '../utils/errors';

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

  /** 大文件阈值（5MB） */
  private static readonly LARGE_FILE_THRESHOLD = 5 * 1024 * 1024;
  /** 分块大小（5MB） */
  private static readonly PART_SIZE = 5 * 1024 * 1024;

  /** 重试配置 */
  private retryConfig: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    maxRetries: 5,
  };

  /**
   * 配置 S3 连接
   */
  setConfig(config: S3Config): void {
    this.config = config;
    console.log('[远端存储] 已设置配置，端点：', config.endpoint);

    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || 'auto',
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: !config.endpoint.includes('amazonaws.com'),
      // 请求超时设置
      requestHandler: {
        requestTimeout: 30000,
        httpsAgent: undefined,
      } as any,
    });
  }

  /**
   * 测试与远端存储的连接
   */
  async testConnection(): Promise<boolean> {
    console.log('[远端存储] 正在测试连接...');

    if (!this.client || !this.config) {
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, 'S3 配置未设置');
    }

    try {
      return await withRetry(
        async () => {
          const command = new HeadBucketCommand({ Bucket: this.config!.bucket });
          await this.client!.send(command);
          console.log('[远端存储] 连接测试通过');
          this.connected = true;
          return true;
        },
        { ...this.retryConfig, maxRetries: 2 },
        (attempt, error) => {
          console.log(`[远端存储] 连接重试 ${attempt}：${error.message}`);
        }
      );
    } catch (error) {
      this.connected = false;
      throw SyncError.fromError(error);
    }
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 上传内容（自动选择普通上传或分块上传）
   */
  async upload(key: string, data: Uint8Array): Promise<string> {
    console.log(`[远端存储] 正在上传 ${key}（${data.length} 字节）`);

    if (!this.client || !this.config) {
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, '未连接到远端存储');
    }

    // 大文件使用分块上传
    if (data.length > RemoteStorage.LARGE_FILE_THRESHOLD) {
      return this.multipartUpload(key, data);
    }

    return this.simpleUpload(key, data);
  }

  /**
   * 简单上传
   */
  private async simpleUpload(key: string, data: Uint8Array): Promise<string> {
    const fullKey = `${RemoteStorage.CONTENT_PREFIX}${key}`;

    try {
      return await withRetry(
        async () => {
          const command = new PutObjectCommand({
            Bucket: this.config!.bucket,
            Key: fullKey,
            Body: data,
            ContentType: 'application/octet-stream',
          });

          const result = await this.client!.send(command);
          const versionId = result.VersionId || `v-${Date.now()}`;
          console.log(`[远端存储] 上传成功，版本：${versionId}`);
          return versionId;
        },
        this.retryConfig,
        (attempt, error) => {
          console.log(`[远端存储] 上传重试 ${attempt}：${error.message}`);
        }
      );
    } catch (error) {
      throw SyncError.fromError(error);
    }
  }

  /**
   * 分块上传（大文件）
   */
  private async multipartUpload(key: string, data: Uint8Array): Promise<string> {
    const fullKey = `${RemoteStorage.CONTENT_PREFIX}${key}`;
    const totalParts = Math.ceil(data.length / RemoteStorage.PART_SIZE);

    console.log(`[远端存储] 开始分块上传，共 ${totalParts} 块`);

    let uploadId: string | undefined;

    try {
      // 初始化分块上传
      const createCommand = new CreateMultipartUploadCommand({
        Bucket: this.config!.bucket,
        Key: fullKey,
        ContentType: 'application/octet-stream',
      });
      const createResult = await this.client!.send(createCommand);
      uploadId = createResult.UploadId!;

      // 上传各分块
      const uploadedParts: { PartNumber: number; ETag?: string }[] = [];

      for (let i = 0; i < totalParts; i++) {
        const start = i * RemoteStorage.PART_SIZE;
        const end = Math.min(start + RemoteStorage.PART_SIZE, data.length);
        const partData = data.slice(start, end);
        const partNumber = i + 1;

        console.log(`[远端存储] 上传分块 ${partNumber}/${totalParts}`);

        const uploadPartCommand = new UploadPartCommand({
          Bucket: this.config!.bucket,
          Key: fullKey,
          PartNumber: partNumber,
          UploadId: uploadId,
          Body: partData,
        });

        const partResult = await this.client!.send(uploadPartCommand);
        uploadedParts.push({
          PartNumber: partNumber,
          ETag: partResult.ETag,
        });
      }

      // 完成分块上传
      const completeCommand = new CompleteMultipartUploadCommand({
        Bucket: this.config!.bucket,
        Key: fullKey,
        UploadId: uploadId,
        MultipartUpload: { Parts: uploadedParts },
      });

      const result = await this.client!.send(completeCommand);
      console.log(`[远端存储] 分块上传完成`);
      return result.VersionId || `v-${Date.now()}`;
    } catch (error) {
      // 中止上传
      if (uploadId) {
        try {
          await this.client!.send(
            new AbortMultipartUploadCommand({
              Bucket: this.config!.bucket,
              Key: fullKey,
              UploadId: uploadId,
            })
          );
        } catch (abortError) {
          console.error('[远端存储] 中止分块上传失败：', abortError);
        }
      }
      throw SyncError.fromError(error);
    }
  }

  /**
   * 下载加密内容
   */
  async download(key: string): Promise<{ data: Uint8Array; versionId: string }> {
    console.log(`[远端存储] 正在下载 ${key}`);

    if (!this.client || !this.config) {
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, '未连接到远端存储');
    }

    try {
      return await withRetry(
        async () => {
          const fullKey = `${RemoteStorage.CONTENT_PREFIX}${key}`;
          const command = new GetObjectCommand({
            Bucket: this.config!.bucket,
            Key: fullKey,
          });

          const result = await this.client!.send(command);

          if (!result.Body) {
            throw new SyncError(SyncErrorCode.FILE_NOT_FOUND, '下载内容为空');
          }

          const data = await this.streamToUint8Array(result.Body);
          const versionId = result.VersionId || '';

          console.log(`[远端存储] 下载成功，${data.length} 字节`);
          return { data, versionId };
        },
        this.retryConfig,
        (attempt, error) => {
          console.log(`[远端存储] 下载重试 ${attempt}：${error.message}`);
        }
      );
    } catch (error) {
      throw SyncError.fromError(error);
    }
  }

  /**
   * 检查对象是否存在
   */
  async exists(key: string): Promise<boolean> {
    if (!this.client || !this.config) {
      return false;
    }

    try {
      const fullKey = `${RemoteStorage.CONTENT_PREFIX}${key}`;
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 列出指定前缀的对象
   */
  async list(prefix: string): Promise<string[]> {
    console.log(`[远端存储] 正在列出前缀为 ${prefix} 的对象`);

    if (!this.client || !this.config) {
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, '未连接到远端存储');
    }

    try {
      return await withRetry(
        async () => {
          const objects: string[] = [];
          let continuationToken: string | undefined;

          do {
            const command = new ListObjectsV2Command({
              Bucket: this.config!.bucket,
              Prefix: prefix,
              ContinuationToken: continuationToken,
              MaxKeys: 1000,
            });

            const result = await this.client!.send(command);

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
        },
        { ...this.retryConfig, maxRetries: 2 },
        (attempt, error) => {
          console.log(`[远端存储] 列表重试 ${attempt}：${error.message}`);
        }
      );
    } catch (error) {
      throw SyncError.fromError(error);
    }
  }

  /**
   * 删除对象
   */
  async delete(key: string): Promise<void> {
    console.log(`[远端存储] 正在删除 ${key}`);

    if (!this.client || !this.config) {
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, '未连接到远端存储');
    }

    try {
      await withRetry(
        async () => {
          const fullKey = `${RemoteStorage.CONTENT_PREFIX}${key}`;
          const command = new DeleteObjectCommand({
            Bucket: this.config!.bucket,
            Key: fullKey,
          });
          await this.client!.send(command);
          console.log(`[远端存储] 删除成功`);
        },
        this.retryConfig,
        (attempt, error) => {
          console.log(`[远端存储] 删除重试 ${attempt}：${error.message}`);
        }
      );
    } catch (error) {
      throw SyncError.fromError(error);
    }
  }

  /**
   * 上传设备日志
   */
  async uploadLog(deviceId: string, logData: Uint8Array, clock: number): Promise<void> {
    if (!this.client || !this.config) {
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, '未连接到远端存储');
    }

    const key = `${RemoteStorage.LOG_PREFIX}${deviceId}/${clock}.json`;

    try {
      await withRetry(
        async () => {
          const command = new PutObjectCommand({
            Bucket: this.config!.bucket,
            Key: key,
            Body: logData,
            ContentType: 'application/json',
          });
          await this.client!.send(command);
          console.log(`[远端存储] 日志上传成功：${key}`);
        },
        this.retryConfig
      );
    } catch (error) {
      throw SyncError.fromError(error);
    }
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
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, '未连接到远端存储');
    }

    const key = `${RemoteStorage.META_PREFIX}repo/${repoId}.json`;

    try {
      await withRetry(
        async () => {
          const command = new PutObjectCommand({
            Bucket: this.config!.bucket,
            Key: key,
            Body: new TextEncoder().encode(JSON.stringify(metadata, null, 2)),
            ContentType: 'application/json',
          });
          await this.client!.send(command);
          console.log(`[远端存储] 仓库元数据创建成功：${key}`);
        },
        this.retryConfig
      );
    } catch (error) {
      throw SyncError.fromError(error);
    }
  }

  /**
   * 获取仓库元数据
   */
  async getRepoMetadata(repoId: string): Promise<Record<string, unknown> | null> {
    if (!this.client || !this.config) {
      return null;
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
    if (body && typeof body === 'object' && 'toArray' in body) {
      const buffer = await (body as { toArray: () => Promise<Uint8Array> }).toArray();
      return buffer;
    }

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

    if (body instanceof Blob) {
      const buffer = await body.arrayBuffer();
      return new Uint8Array(buffer);
    }

    throw new SyncError(SyncErrorCode.UNKNOWN, '无法识别的响应体类型');
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
