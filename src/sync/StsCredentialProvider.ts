import { requestUrl, RequestUrlResponse } from 'obsidian';
import { S3Config, StsCredentialResponse, SyncSettings } from '../types';
import { SyncError, SyncErrorCode } from '../utils/errors';
import { syncLogger } from '../utils/Logger';

export interface StsCredentialSession {
  s3: S3Config;
  repoId?: string;
  expirationMs: number;
}

export interface StsCredentialRequest {
  url: string;
  authToken: string;
  body: {
    vaultId: string;
    repoId: string;
    deviceId: string;
    pluginVersion: string;
  };
}

export type StsCredentialTransport = (
  request: StsCredentialRequest
) => Promise<{ status: number; json: unknown; text?: string }>;

export class StsCredentialProvider {
  private cached: StsCredentialSession | null = null;
  private inFlight: Promise<StsCredentialSession> | null = null;

  constructor(
    private readonly transport: StsCredentialTransport = defaultTransport,
    private readonly now: () => number = () => Date.now()
  ) {}

  async getCredentials(settings: SyncSettings, pluginVersion: string): Promise<StsCredentialSession> {
    if (settings.credentialMode !== 'sts') {
      return {
        s3: { ...settings.s3 },
        repoId: settings.repoId,
        expirationMs: Number.POSITIVE_INFINITY,
      };
    }

    this.validateSettings(settings);

    if (this.cached && !this.isExpiringSoon(this.cached, settings.sts.refreshSkewMs)) {
      return this.cached;
    }

    if (!this.inFlight) {
      this.inFlight = this.fetchCredentials(settings, pluginVersion).finally(() => {
        this.inFlight = null;
      });
    }

    return this.inFlight;
  }

  clear(): void {
    this.cached = null;
    this.inFlight = null;
  }

  private async fetchCredentials(settings: SyncSettings, pluginVersion: string): Promise<StsCredentialSession> {
    const url = this.resolveCredentialsUrl(settings.sts.authServerUrl);
    const vaultId = settings.sts.vaultId.trim() || settings.repoId || 'main';

    try {
      const response = await this.transport({
        url,
        authToken: settings.sts.authToken,
        body: {
          vaultId,
          repoId: settings.repoId,
          deviceId: settings.deviceId,
          pluginVersion,
        },
      });

      if (response.status < 200 || response.status >= 300) {
        throw new SyncError(
          SyncErrorCode.NETWORK_ERROR,
          this.formatBackendError(response.status, response.json, response.text)
        );
      }

      const parsed = this.parseResponse(response.json);
      const expirationMs = Date.parse(parsed.credentials.expiration);
      if (!Number.isFinite(expirationMs)) {
        throw new SyncError(SyncErrorCode.CONFIG_INVALID, '授权服务返回的凭证过期时间无效');
      }
      if (expirationMs - this.now() <= Math.max(0, settings.sts.refreshSkewMs)) {
        throw new SyncError(SyncErrorCode.CONFIG_INVALID, '授权服务返回的临时凭证已过期或即将过期');
      }

      const session: StsCredentialSession = {
        s3: {
          endpoint: parsed.endpoint,
          bucket: parsed.bucket,
          accessKey: parsed.credentials.accessKeyId,
          secretKey: parsed.credentials.accessKeySecret,
          securityToken: parsed.credentials.securityToken,
          region: parsed.region || 'auto',
          storagePrefix: parsed.storagePrefix,
        },
        repoId: parsed.repoId,
        expirationMs,
      };

      this.cached = session;
      syncLogger.info('已获取临时同步凭证', {
        expiration: parsed.credentials.expiration,
      });
      return session;
    } catch (error) {
      if (error instanceof SyncError) {
        syncLogger.warn('获取临时同步凭证失败', { error: error.message });
        throw error;
      }

      const safeMessage = this.formatTransportError(error);
      syncLogger.warn('获取临时同步凭证失败', { error: safeMessage });
      throw new SyncError(SyncErrorCode.NETWORK_ERROR, safeMessage);
    }
  }

  private validateSettings(settings: SyncSettings): void {
    if (!settings.sts.authServerUrl.trim()) {
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, '缺少授权服务地址');
    }

    if (!settings.sts.authToken.trim()) {
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, '缺少授权令牌');
    }

    if (!settings.syncPassword) {
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, '缺少同步密码');
    }

    if (!settings.deviceId.trim()) {
      throw new SyncError(SyncErrorCode.CONFIG_MISSING, '缺少设备 ID');
    }
  }

  private isExpiringSoon(session: StsCredentialSession, skewMs: number): boolean {
    return session.expirationMs - this.now() <= Math.max(0, skewMs);
  }

  private resolveCredentialsUrl(authServerUrl: string): string {
    const url = new URL(authServerUrl.trim());
    const path = url.pathname.replace(/\/+$/, '');
    if (path.endsWith('/api/sync/credentials') || path.endsWith('/credentials')) {
      return url.toString();
    }

    url.pathname = `${path}/api/sync/credentials`.replace(/\/{2,}/g, '/');
    return url.toString();
  }

  private parseResponse(value: unknown): StsCredentialResponse {
    if (!value || typeof value !== 'object') {
      throw new SyncError(SyncErrorCode.CONFIG_INVALID, '授权服务返回格式无效');
    }

    const response = value as Partial<StsCredentialResponse>;
    const credentials = response.credentials;

    if (
      !response.endpoint ||
      !response.bucket ||
      !response.storagePrefix ||
      !credentials?.accessKeyId ||
      !credentials.accessKeySecret ||
      !credentials.securityToken ||
      !credentials.expiration
    ) {
      throw new SyncError(SyncErrorCode.CONFIG_INVALID, '授权服务返回缺少必要字段');
    }

    return {
      endpoint: response.endpoint,
      bucket: response.bucket,
      region: response.region || 'auto',
      storagePrefix: response.storagePrefix,
      repoId: response.repoId,
      credentials,
    };
  }

  private formatBackendError(status: number, json: unknown, _text?: string): string {
    const object = json && typeof json === 'object' ? json as Record<string, unknown> : {};
    const candidate = typeof object.message === 'string' ? object.message : '';
    const trustedMessages = new Set([
      '缺少授权令牌',
      '授权令牌无效或已过期',
      '用户已停用或不可用',
      '设备数量已达到当前套餐上限',
      '仓库状态冲突，需要用户处理',
      '请求过于频繁',
      '请求体过大',
      '请求体不是合法 JSON',
    ]);
    const fallbackByStatus: Record<number, string> = {
      400: '请求参数无效',
      401: '授权令牌无效或已过期',
      403: '授权失败，请检查账号状态或套餐限制',
      409: '仓库状态冲突，需要用户处理',
      413: '请求体过大',
      429: '请求过于频繁',
      502: '授权服务暂时不可用，请稍后重试',
    };
    const backendMessage = trustedMessages.has(candidate)
      ? candidate
      : fallbackByStatus[status] || '授权服务暂时不可用';
    return `获取临时同步凭证失败（${status}）：${backendMessage}`;
  }

  private formatTransportError(error: unknown): string {
    const rawMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const rawName = error instanceof Error ? error.name.toLowerCase() : '';

    if (
      rawName.includes('timeout') ||
      rawName.includes('abort') ||
      rawMessage.includes('timeout') ||
      rawMessage.includes('timed out') ||
      rawMessage.includes('etimedout')
    ) {
      return '授权服务连接超时，请稍后重试';
    }

    if (
      rawMessage.includes('network') ||
      rawMessage.includes('failed to fetch') ||
      rawMessage.includes('econnreset') ||
      rawMessage.includes('econnrefused') ||
      rawMessage.includes('enotfound')
    ) {
      return '无法连接授权服务，请检查网络或服务地址';
    }

    return '授权服务请求失败，请稍后重试';
  }
}

async function defaultTransport(request: StsCredentialRequest): Promise<{ status: number; json: unknown; text?: string }> {
  const response: RequestUrlResponse = await requestUrl({
    url: request.url,
    method: 'POST',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${request.authToken}`,
    },
    body: JSON.stringify(request.body),
  });

  return {
    status: response.status,
    json: response.json,
    text: response.text,
  };
}
