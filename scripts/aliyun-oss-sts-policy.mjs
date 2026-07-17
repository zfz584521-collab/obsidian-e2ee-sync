import { fileURLToPath } from 'node:url';

export function normalizeOssPrefix(prefix) {
  return String(prefix || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/');
}

export function buildOssStsPolicy({ bucket, prefix }) {
  const normalizedBucket = String(bucket || '').trim();
  const normalizedPrefix = normalizeOssPrefix(prefix);

  if (!normalizedBucket) {
    throw new Error('bucket is required');
  }
  if (!normalizedPrefix) {
    throw new Error('prefix is required');
  }

  const bucketResource = `acs:oss:*:*:${normalizedBucket}`;
  const objectResource = `acs:oss:*:*:${normalizedBucket}/${normalizedPrefix}/*`;

  return {
    Version: '1',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'oss:GetBucketInfo',
        ],
        Resource: [
          bucketResource,
        ],
      },
      {
        Effect: 'Allow',
        Action: [
          'oss:ListObjects',
        ],
        Resource: [
          bucketResource,
        ],
        Condition: {
          StringLike: {
            'oss:Prefix': [
              `${normalizedPrefix}/*`,
            ],
          },
        },
      },
      {
        Effect: 'Allow',
        Action: [
          'oss:GetObject',
          'oss:PutObject',
          'oss:DeleteObject',
          'oss:AbortMultipartUpload',
          'oss:ListParts',
          'oss:InitiateMultipartUpload',
          'oss:UploadPart',
          'oss:CompleteMultipartUpload',
        ],
        Resource: [
          objectResource,
        ],
      },
    ],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const bucket = process.env.OSS_BUCKET;
  const prefix = process.env.OSS_PREFIX;
  console.log(JSON.stringify(buildOssStsPolicy({ bucket, prefix }), null, 2));
}
