import { fileURLToPath } from 'node:url';

const REQUIRED_VARIABLES = [
  'ALIYUN_ACCESS_KEY_ID',
  'ALIYUN_ACCESS_KEY_SECRET',
  'ALIYUN_STS_ROLE_ARN',
  'OSS_BUCKET',
  'TOKEN_SALT',
  'DEVICE_SALT',
];

export function buildPreflightReport(env = process.env) {
  const provider = env.STS_PROVIDER || 'mock';
  const durationSeconds = Number(env.STS_DURATION_SECONDS || 3600);
  const publicHttps = isHttpsUrl(env.PUBLIC_BASE_URL);
  const ossHttps = isHttpsUrl(env.OSS_ENDPOINT || 'https://s3.oss-cn-hangzhou.aliyuncs.com');
  const missing = REQUIRED_VARIABLES.filter(name => !env[name]);
  if (!env.SEED_AUTH_TOKEN && !env.STORE_PATH) {
    missing.push('SEED_AUTH_TOKEN_OR_STORE_PATH');
  }
  const warnings = [];

  if (provider !== 'aliyun') {
    warnings.push('STS_PROVIDER must be aliyun for real validation');
  }
  if (!publicHttps) {
    warnings.push('PUBLIC_BASE_URL must use HTTPS');
  }
  if (!ossHttps) {
    warnings.push('OSS_ENDPOINT must use HTTPS');
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < 900) {
    warnings.push('STS_DURATION_SECONDS must be at least 900');
  }

  return {
    ready: missing.length === 0 && warnings.length === 0,
    provider,
    durationSeconds,
    publicHttps,
    ossHttps,
    missing,
    warnings,
  };
}

function isHttpsUrl(value) {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const report = buildPreflightReport();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready) {
    process.exitCode = 1;
  }
}
