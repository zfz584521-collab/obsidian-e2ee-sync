import crypto from 'node:crypto';
import { buildOssStsPolicy } from './aliyun-oss-sts-policy.mjs';

const ALGORITHM = 'ACS3-HMAC-SHA256';
const EMPTY_SHA256 = sha256Hex('');

export function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

export function canonicalQueryString(params = {}) {
  return Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
}

export function canonicalHeadersAndSignedHeaders(headers = {}) {
  const entries = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), String(value).trim()])
    .filter(([key]) => key === 'host' || key === 'content-type' || key.startsWith('x-acs-'))
    .sort(([a], [b]) => a.localeCompare(b));

  return {
    canonicalHeaders: entries.map(([key, value]) => `${key}:${value}\n`).join(''),
    signedHeaders: entries.map(([key]) => key).join(';'),
  };
}

export function sha256Hex(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

export function hmacSha256Hex(secret, value) {
  return crypto
    .createHmac('sha256', secret)
    .update(value)
    .digest('hex')
    .toLowerCase();
}

export function signRpcV1Request({
  method = 'POST',
  query = {},
  accessKeySecret,
}) {
  const canonicalQuery = canonicalQueryString(query);
  const stringToSign = [
    method.toUpperCase(),
    percentEncode('/'),
    percentEncode(canonicalQuery),
  ].join('&');
  const signature = crypto
    .createHmac('sha1', `${accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64');

  return {
    canonicalQuery,
    stringToSign,
    signature,
  };
}

export function signOpenApiRequest({ method = 'POST', canonicalUri = '/', query = {}, headers = {}, body = '', accessKeyId, accessKeySecret }) {
  const payloadHash = sha256Hex(body || '');
  const normalizedHeaders = {
    ...headers,
    'x-acs-content-sha256': payloadHash,
  };
  const { canonicalHeaders, signedHeaders } = canonicalHeadersAndSignedHeaders(normalizedHeaders);
  const canonicalQuery = canonicalQueryString(query);
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const stringToSign = `${ALGORITHM}\n${sha256Hex(canonicalRequest)}`;
  const signature = hmacSha256Hex(accessKeySecret, stringToSign);
  const authorization = `${ALGORITHM} Credential=${accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;

  return {
    headers: {
      ...normalizedHeaders,
      Authorization: authorization,
    },
    canonicalQuery,
    canonicalRequest,
    stringToSign,
    signature,
    authorization,
  };
}

export function createAliyunAssumeRoleProvider(config, fetchImpl = fetch) {
  validateAliyunProviderConfig(config);

  return {
    async assumeRole({ userId, vaultId, repoId, storagePrefix }) {
      const policy = buildOssStsPolicy({
        bucket: config.ossBucket,
        prefix: storagePrefix,
      });
      const roleSessionName = makeRoleSessionName(userId, vaultId, repoId);
      const query = {
        RoleArn: config.roleArn,
        RoleSessionName: roleSessionName,
        DurationSeconds: config.durationSeconds || 3600,
        Policy: JSON.stringify(policy),
      };
      if (config.externalId) {
        query.ExternalId = config.externalId;
      }
      if (config.sourceIdentity) {
        query.SourceIdentity = makeRoleSessionName(config.sourceIdentity, vaultId, repoId);
      }

      const rpcQuery = {
        ...query,
        AccessKeyId: config.accessKeyId,
        Action: 'AssumeRole',
        Format: 'JSON',
        SignatureMethod: 'HMAC-SHA1',
        SignatureNonce: config.nonce ? config.nonce() : crypto.randomUUID().replace(/-/g, ''),
        SignatureVersion: '1.0',
        Timestamp: (config.now ? new Date(config.now()) : new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        Version: '2015-04-01',
      };
      const signed = signRpcV1Request({
        method: 'POST',
        query: rpcQuery,
        accessKeySecret: config.accessKeySecret,
      });
      const endpoint = config.endpoint || 'https://sts.aliyuncs.com';
      const body = canonicalQueryString({
        ...rpcQuery,
        Signature: signed.signature,
      });

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      const text = await response.text();
      let json = {};
      try {
        json = JSON.parse(text);
      } catch {
        // Keep json as empty object.
      }

      if (!response.ok) {
        const message = json.Message || json.message || text || `Aliyun STS request failed: ${response.status}`;
        throw new Error(`Aliyun STS AssumeRole failed (${response.status}): ${message}`);
      }

      const credentials = json.Credentials || {};
      if (!credentials.AccessKeyId || !credentials.AccessKeySecret || !credentials.SecurityToken || !credentials.Expiration) {
        throw new Error('Aliyun STS response missing credentials');
      }

      return {
        accessKeyId: credentials.AccessKeyId,
        accessKeySecret: credentials.AccessKeySecret,
        securityToken: credentials.SecurityToken,
        expiration: credentials.Expiration,
      };
    },
  };
}

export function loadAliyunProviderConfig(env = process.env) {
  return {
    endpoint: env.ALIYUN_STS_ENDPOINT || 'https://sts.aliyuncs.com',
    accessKeyId: env.ALIYUN_ACCESS_KEY_ID || '',
    accessKeySecret: env.ALIYUN_ACCESS_KEY_SECRET || '',
    roleArn: env.ALIYUN_STS_ROLE_ARN || '',
    externalId: env.ALIYUN_STS_EXTERNAL_ID || '',
    sourceIdentity: env.ALIYUN_STS_SOURCE_IDENTITY || '',
    durationSeconds: Number(env.STS_DURATION_SECONDS || 3600),
    ossBucket: env.OSS_BUCKET || '',
  };
}

export function validateAliyunProviderConfig(config) {
  const missing = [];
  if (!config.accessKeyId) missing.push('ALIYUN_ACCESS_KEY_ID');
  if (!config.accessKeySecret) missing.push('ALIYUN_ACCESS_KEY_SECRET');
  if (!config.roleArn) missing.push('ALIYUN_STS_ROLE_ARN');
  if (!config.ossBucket) missing.push('OSS_BUCKET');
  if (missing.length > 0) {
    throw new Error(`Missing Aliyun STS configuration: ${missing.join(', ')}`);
  }
  if (!Number.isFinite(config.durationSeconds) || config.durationSeconds < 900) {
    throw new Error('STS_DURATION_SECONDS must be at least 900');
  }
}

export function makeRoleSessionName(userId, vaultId, repoId) {
  return `${userId}-${vaultId}-${repoId}`
    .replace(/[^a-zA-Z0-9.@_-]/g, '_')
    .slice(0, 64)
    .replace(/^(.?)$/, 'session_$1');
}

export { EMPTY_SHA256 };
