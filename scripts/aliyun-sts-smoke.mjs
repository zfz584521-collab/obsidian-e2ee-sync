import { fileURLToPath } from 'node:url';
import {
  createAliyunAssumeRoleProvider,
  loadAliyunProviderConfig,
} from './aliyun-sts-provider.mjs';

export async function runAliyunStsSmoke(env = process.env, fetchImpl = fetch) {
  const provider = createAliyunAssumeRoleProvider(
    loadAliyunProviderConfig(env),
    fetchImpl,
  );
  const credentials = await provider.assumeRole({
    userId: 'sts_smoke',
    vaultId: 'main',
    repoId: 'smoke',
    storagePrefix: 'tenants/sts_smoke/vaults/main/repos/smoke',
  });

  return {
    success: true,
    credentialsComplete: Boolean(
      credentials.accessKeyId
      && credentials.accessKeySecret
      && credentials.securityToken
      && credentials.expiration
    ),
    expiration: credentials.expiration,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(JSON.stringify(await runAliyunStsSmoke(), null, 2));
  } catch {
    console.error(JSON.stringify({
      success: false,
      message: 'Aliyun STS smoke validation failed; inspect server-side secure diagnostics',
    }, null, 2));
    process.exitCode = 1;
  }
}
