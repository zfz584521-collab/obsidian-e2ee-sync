import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  createAliyunAssumeRoleProvider,
  loadAliyunProviderConfig,
} from './aliyun-sts-provider.mjs';

const STORAGE_PREFIX = 'tenants/sts_smoke/vaults/main/repos/smoke';
const DENIED_PREFIX = 'tenants/sts_other/vaults/main/repos/smoke/';

function isAccessDenied(error) {
  return error?.name === 'AccessDenied'
    || error?.Code === 'AccessDenied'
    || error?.$metadata?.httpStatusCode === 403;
}

function safeErrorDetails(error) {
  const allowedCodes = new Set([
    'AccessDenied',
    'Forbidden',
    'InvalidAccessKeyId',
    'NoSuchBucket',
    'SignatureDoesNotMatch',
  ]);
  const code = allowedCodes.has(error?.name) ? error.name : 'UnknownError';
  const status = Number(error?.$metadata?.httpStatusCode);
  return {
    code,
    httpStatus: Number.isInteger(status) ? status : null,
    stage: error?.smokeStage || 'unknown',
  };
}

export async function runAliyunOssStsSmoke(
  env = process.env,
  fetchImpl = fetch,
  clientFactory = options => new S3Client(options),
) {
  const provider = createAliyunAssumeRoleProvider(
    loadAliyunProviderConfig(env),
    fetchImpl,
  );
  const credentials = await provider.assumeRole({
    userId: 'sts_smoke',
    vaultId: 'main',
    repoId: 'smoke',
    storagePrefix: STORAGE_PREFIX,
  });
  const bucket = String(env.OSS_BUCKET || '').trim();
  const client = clientFactory({
    region: env.OSS_REGION || 'cn-hangzhou',
    endpoint: env.OSS_ENDPOINT || 'https://s3.oss-cn-hangzhou.aliyuncs.com',
    forcePathStyle: false,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.accessKeySecret,
      sessionToken: credentials.securityToken,
    },
  });
  const key = `${STORAGE_PREFIX}/integration-check-${randomUUID()}.txt`;
  const report = {
    listAllowed: false,
    putAllowed: false,
    getAllowed: false,
    deleteAllowed: false,
    crossPrefixDenied: false,
    cleanupComplete: false,
    success: false,
  };
  let created = false;
  let stage = 'list-allowed-prefix';

  try {
    try {
      await client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${STORAGE_PREFIX}/`,
        MaxKeys: 1,
      }));
      report.listAllowed = true;
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
    }

    stage = 'put-object';
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: 'sts-commercial-smoke',
    }));
    created = true;
    report.putAllowed = true;

    stage = 'get-object';
    const response = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }));
    const body = await response.Body?.transformToString();
    report.getAllowed = body === 'sts-commercial-smoke';

    stage = 'delete-object';
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    created = false;
    report.deleteAllowed = true;
    report.cleanupComplete = true;

    stage = 'list-denied-prefix';
    try {
      await client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: DENIED_PREFIX,
        MaxKeys: 1,
      }));
    } catch (error) {
      report.crossPrefixDenied = isAccessDenied(error);
    }
  } catch (error) {
    error.smokeStage = stage;
    throw error;
  } finally {
    if (created) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        report.cleanupComplete = true;
      } catch {
        report.cleanupComplete = false;
      }
    }
    client.destroy?.();
  }

  report.success = report.listAllowed
    && report.putAllowed
    && report.getAllowed
    && report.deleteAllowed
    && report.crossPrefixDenied
    && report.cleanupComplete;
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const report = await runAliyunOssStsSmoke();
    console.log(JSON.stringify(report, null, 2));
    if (!report.success) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      message: 'Aliyun OSS STS smoke validation failed; inspect secure server diagnostics',
      error: safeErrorDetails(error),
    }, null, 2));
    process.exitCode = 1;
  }
}
