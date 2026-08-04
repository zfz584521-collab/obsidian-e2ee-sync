import { describe, expect, it, vi } from 'vitest';
import { SyncSettings } from '../src/types';

vi.mock('obsidian', () => ({
  Notice: vi.fn(),
  Modal: class MockModal {},
  Setting: class MockSetting {},
}));

import { ConfigExporter } from '../src/utils/ConfigExporter';

const settings: SyncSettings = {
  credentialMode: 'static',
  s3: {
    endpoint: 'https://oss.example.test',
    bucket: 'notes-bucket',
    accessKey: 'ACCESS_KEY_SHOULD_NOT_EXPORT',
    secretKey: 'SECRET_SHOULD_NOT_EXPORT',
    securityToken: 'SECURITY_TOKEN_SHOULD_NOT_EXPORT',
    region: 'auto',
    storagePrefix: 'personal-channel',
  },
  sts: {
    authServerUrl: 'https://sync.example.test',
    authToken: 'AUTH_TOKEN_SHOULD_NOT_EXPORT',
    vaultId: 'main',
    refreshSkewMs: 300000,
  },
  syncPassword: 'PASSWORD_SHOULD_NOT_EXPORT',
  deviceId: 'dev_original_device',
  deviceName: 'Laptop',
  repoId: 'repo_shared_between_user_devices',
  autoSync: false,
  syncInterval: 0,
  syncRules: [],
  concurrentUploads: 10,
  concurrentDownloads: 10,
};

function decodeExport(encoded: string): any {
  return JSON.parse(decodeURIComponent(escape(atob(encoded))));
}

describe('ConfigExporter', () => {
  it('exports channel metadata without secrets or device identity', async () => {
    const encoded = await ConfigExporter.exportConfig(settings, '');
    const exported = decodeExport(encoded);

    expect(exported.settings.s3.endpoint).toBe(settings.s3.endpoint);
    expect(exported.settings.s3.bucket).toBe(settings.s3.bucket);
    expect(exported.settings.s3.storagePrefix).toBe(settings.s3.storagePrefix);
    expect(exported.settings.repoId).toBe(settings.repoId);

    expect(exported.settings.s3.accessKey).toBe('');
    expect(exported.settings.s3.secretKey).toBe('');
    expect(exported.settings.s3.securityToken).toBe('');
    expect(exported.settings.sts.authToken).toBe('');
    expect(exported.settings.sts.authServerUrl).toBe(settings.sts.authServerUrl);
    expect(exported.settings.syncPassword).toBe('');
    expect(exported.settings.deviceId).toBe('');
  });

  it('includes storagePrefix in share URLs', () => {
    const url = ConfigExporter.generateShareUrl(settings);
    const parsed = ConfigExporter.parseShareUrl(url);

    expect(parsed?.s3?.storagePrefix).toBe(settings.s3.storagePrefix);
    expect(parsed?.repoId).toBe(settings.repoId);
    expect(parsed?.s3?.accessKey).toBe('');
    expect(parsed?.s3?.secretKey).toBe('');
  });
});
