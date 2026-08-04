import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoMetadata, S3Config, SyncSettings } from '../src/types';

vi.mock('obsidian', () => {
  class MockTFile {
    path: string;
    stat: { size: number; mtime: number };

    constructor(path: string, stat: { size: number; mtime: number }) {
      this.path = path;
      this.stat = stat;
    }
  }

  return {
    App: class MockApp {},
    Modal: class MockModal {},
    Setting: class MockSetting {},
    TFile: MockTFile,
    Notice: vi.fn(),
    requestUrl: vi.fn(),
  };
});

import { TFile } from 'obsidian';
import { SyncManager, type DataPersistence } from '../src/sync/SyncManager';

type StoredFile = {
  data: Uint8Array;
  mtime: number;
};

function createTFile(path: string, stat: { size: number; mtime: number }): TFile {
  return new (TFile as any)(path, stat) as TFile;
}

class MemoryVault {
  private files = new Map<string, StoredFile>();
  private folders = new Set<string>();
  private now = 1;

  vault = {
    getFiles: () =>
      Array.from(this.files.entries()).map(
        ([path, file]) => createTFile(path, { size: file.data.byteLength, mtime: file.mtime })
      ),
    readBinary: async (file: TFile) => this.read(file.path),
    getAbstractFileByPath: (path: string) => {
      const file = this.files.get(path);
      if (!file) return null;
      return createTFile(path, { size: file.data.byteLength, mtime: file.mtime });
    },
    adapter: {
      writeBinary: async (path: string, data: ArrayBuffer) => {
        this.files.set(path, { data: new Uint8Array(data.slice(0)), mtime: ++this.now });
      },
      exists: async (path: string) => this.files.has(path) || this.folders.has(path),
      mkdir: async (path: string) => {
        this.folders.add(path);
      },
      remove: async (path: string) => {
        this.files.delete(path);
      },
    },
  };

  writeText(path: string, content: string): void {
    this.files.set(path, { data: new TextEncoder().encode(content), mtime: ++this.now });
  }

  delete(path: string): void {
    this.files.delete(path);
    ++this.now;
  }

  async readText(path: string): Promise<string | undefined> {
    const file = this.files.get(path);
    return file ? new TextDecoder().decode(file.data) : undefined;
  }

  paths(): string[] {
    return Array.from(this.files.keys()).sort();
  }

  private async read(path: string): Promise<ArrayBuffer> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength) as ArrayBuffer;
  }
}

class MemoryPersistence implements DataPersistence {
  data: Record<string, unknown> = {};

  async loadData(): Promise<Record<string, unknown>> {
    return structuredClone(this.data);
  }

  async saveData(data: Record<string, unknown>): Promise<void> {
    this.data = structuredClone(data);
  }

  async saveSettings(): Promise<void> {}
}

class SharedRemote {
  content = new Map<string, Uint8Array>();
  logs = new Map<string, Uint8Array>();
  metadata = new Map<string, RepoMetadata>();
  legacyMetadata = new Map<string, RepoMetadata>();
  version = 0;
}

class MemoryRemoteStorage {
  connected = false;
  private repoId = '';
  private storagePrefix = '';

  constructor(private remote: SharedRemote) {}

  setConfig(config: S3Config): void {
    this.storagePrefix = this.normalizeStoragePrefix(config.storagePrefix || '');
  }

  setNamespace(repoId: string, storagePrefix?: string): void {
    this.repoId = repoId;
    if (storagePrefix !== undefined) {
      this.storagePrefix = this.normalizeStoragePrefix(storagePrefix);
    }
  }

  async testConnection(): Promise<boolean> {
    this.connected = true;
    return true;
  }

  async upload(key: string, data: Uint8Array): Promise<string> {
    this.remote.content.set(this.contentObjectKey(key), data.slice());
    this.remote.version++;
    return `v-${this.remote.version}`;
  }

  async download(key: string): Promise<{ data: Uint8Array; versionId: string }> {
    const data = this.remote.content.get(this.contentObjectKey(key));
    if (!data) throw new Error(`Remote content not found: ${key}`);
    return { data: data.slice(), versionId: `v-${this.remote.version}` };
  }

  async delete(key: string): Promise<void> {
    this.remote.content.delete(this.contentObjectKey(key));
  }

  async uploadLog(deviceId: string, logData: Uint8Array, clock: number): Promise<void> {
    this.remote.logs.set(this.logObjectKey(deviceId, clock), logData.slice());
  }

  async listDeviceLogs(deviceId: string, fromClock = 0): Promise<string[]> {
    const prefix = this.logObjectPrefix(deviceId);
    return Array.from(this.remote.logs.keys())
      .filter(key => key.startsWith(prefix))
      .filter(key => Number(key.match(/(\d+)\.json$/)?.[1] || 0) > fromClock)
      .sort();
  }

  async downloadLog(logKey: string): Promise<Uint8Array> {
    const data = this.remote.logs.get(logKey);
    if (!data) throw new Error(`Remote log not found: ${logKey}`);
    return data.slice();
  }

  async getRepoMetadata(repoId: string): Promise<RepoMetadata | null> {
    const metadata = this.remote.metadata.get(this.repoMetadataObjectKey(repoId));
    return metadata ? structuredClone(metadata) : null;
  }

  async createRepoMetadata(repoId: string, metadata: RepoMetadata): Promise<void> {
    this.remote.metadata.set(this.repoMetadataObjectKey(repoId), structuredClone(metadata));
  }

  async hasLegacyRepoMetadata(repoId: string): Promise<boolean> {
    return this.remote.legacyMetadata.has(`meta/repo/${repoId}.json`);
  }

  async detectLayout(repoId: string): Promise<{ currentLayout: boolean; legacyLayout: boolean }> {
    return {
      currentLayout: this.remote.metadata.has(this.repoMetadataObjectKey(repoId)),
      legacyLayout: this.remote.legacyMetadata.has(`meta/repo/${repoId}.json`),
    };
  }

  async migrateLegacyLayout(repoId: string): Promise<{ copied: number; skipped: number }> {
    const legacyMetadataKey = `meta/repo/${repoId}.json`;
    const legacyMetadata = this.remote.legacyMetadata.get(legacyMetadataKey);
    if (!legacyMetadata) {
      throw new Error('Legacy repository metadata not found');
    }

    let copied = 0;
    let skipped = 0;
    const currentMetadataKey = this.repoMetadataObjectKey(repoId);

    if (this.remote.metadata.has(currentMetadataKey)) {
      skipped++;
    } else {
      this.remote.metadata.set(currentMetadataKey, structuredClone(legacyMetadata));
      copied++;
    }

    for (const [oldKey, data] of [...this.remote.content.entries()]) {
      if (!oldKey.startsWith('content/')) continue;
      const newKey = `${this.namespacePrefix(repoId)}${oldKey}`;
      if (this.remote.content.has(newKey)) {
        skipped++;
      } else {
        this.remote.content.set(newKey, data.slice());
        copied++;
      }
    }

    for (const [oldKey, data] of [...this.remote.logs.entries()]) {
      if (!oldKey.startsWith('logs/')) continue;
      const newKey = `${this.namespacePrefix(repoId)}${oldKey}`;
      if (this.remote.logs.has(newKey)) {
        skipped++;
      } else {
        this.remote.logs.set(newKey, data.slice());
        copied++;
      }
    }

    return { copied, skipped };
  }

  destroy(): void {
    this.connected = false;
  }

  private contentObjectKey(key: string): string {
    return `${this.namespacePrefix()}content/${key}`;
  }

  private logObjectPrefix(deviceId: string): string {
    return `${this.namespacePrefix()}logs/${encodeURIComponent(deviceId)}/`;
  }

  private logObjectKey(deviceId: string, clock: number): string {
    return `${this.logObjectPrefix(deviceId)}${clock}.json`;
  }

  private repoMetadataObjectKey(repoId: string): string {
    return `${this.namespacePrefix(repoId)}meta/repo.json`;
  }

  private namespacePrefix(repoId = this.repoId): string {
    const channelPrefix = this.storagePrefix ? `${this.storagePrefix}/` : '';
    return `${channelPrefix}repos/${encodeURIComponent(repoId)}/`;
  }

  private normalizeStoragePrefix(prefix: string): string {
    return prefix
      .trim()
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
  }
}

const baseSettings = (
  deviceId: string,
  repoId = 'repo_multi_device_test',
  storagePrefix = ''
): SyncSettings => ({
  credentialMode: 'static',
  s3: {
    endpoint: 'https://memory.example.test',
    bucket: 'test-bucket',
    accessKey: 'test-key',
    secretKey: 'test-secret',
    region: 'auto',
    storagePrefix,
  },
  sts: {
    authServerUrl: '',
    authToken: '',
    vaultId: 'main',
    refreshSkewMs: 300000,
  },
  syncPassword: 'shared-password',
  deviceId,
  deviceName: deviceId,
  repoId,
  autoSync: false,
  syncInterval: 0,
  syncRules: [],
  concurrentUploads: 10,
  concurrentDownloads: 10,
});

async function createManager(
  remote: SharedRemote,
  vault: MemoryVault,
  deviceId: string,
  repoId?: string,
  storagePrefix?: string
) {
  const persistence = new MemoryPersistence();
  const manager = new SyncManager(vault as any, persistence, baseSettings(deviceId, repoId, storagePrefix), {
    concurrentUploads: 1,
    concurrentDownloads: 1,
  });

  (manager as any).remoteStorage = new MemoryRemoteStorage(remote);
  await manager.initialize();
  return { manager, persistence };
}

describe('SyncManager multi-device integration', () => {
  let remote: SharedRemote;
  let vaultA: MemoryVault;
  let vaultB: MemoryVault;
  let managerA: SyncManager;
  let managerB: SyncManager;

  beforeEach(async () => {
    remote = new SharedRemote();
    vaultA = new MemoryVault();
    vaultB = new MemoryVault();

    ({ manager: managerA } = await createManager(remote, vaultA, 'dev-a'));
    ({ manager: managerB } = await createManager(remote, vaultB, 'dev-b'));
  });

  it('uploads from device A and downloads to device B', async () => {
    vaultA.writeText('test-a.md', '# A\n');
    vaultA.writeText('folder/test-b.md', 'folder file\n');
    vaultA.writeText('assets/test.txt', 'asset text\n');

    const upload = await managerA.startSync();
    const download = await managerB.startSync();

    expect(upload.success).toBe(true);
    expect(upload.uploaded).toBe(3);
    expect(download.success).toBe(true);
    expect(download.downloaded).toBe(3);
    expect(await vaultB.readText('test-a.md')).toBe('# A\n');
    expect(await vaultB.readText('folder/test-b.md')).toBe('folder file\n');
    expect(await vaultB.readText('assets/test.txt')).toBe('asset text\n');
  });

  it('creates a repo namespace before first static sync when repoId is empty', async () => {
    const sharedRemote = new SharedRemote();
    const vault = new MemoryVault();
    const settings = baseSettings('dev-first-static', '');
    const persistence = new MemoryPersistence();
    const manager = new SyncManager(vault as any, persistence, settings, {
      concurrentUploads: 1,
      concurrentDownloads: 1,
    });
    (manager as any).remoteStorage = new MemoryRemoteStorage(sharedRemote);

    await manager.initialize();
    vault.writeText('first.md', 'first sync\n');
    const result = await manager.startSync();

    expect(result.success).toBe(true);
    expect(settings.repoId).toMatch(/^repo_/);
    const allRemoteKeys = [
      ...sharedRemote.content.keys(),
      ...sharedRemote.logs.keys(),
      ...sharedRemote.metadata.keys(),
    ];
    expect(allRemoteKeys.every(key => key.startsWith(`repos/${settings.repoId}/`))).toBe(true);
  });

  it('downloads device B modifications back to device A', async () => {
    vaultA.writeText('test-a.md', 'from A\n');
    await managerA.startSync();
    await managerB.startSync();

    vaultB.writeText('test-a.md', 'changed on B\n');
    const uploadB = await managerB.startSync();
    const downloadA = await managerA.startSync();

    expect(uploadB.success).toBe(true);
    expect(uploadB.uploaded).toBe(1);
    expect(downloadA.success).toBe(true);
    expect(downloadA.downloaded).toBe(1);
    expect(await vaultA.readText('test-a.md')).toBe('changed on B\n');
  });

  it('keeps the local file and writes a conflict copy for concurrent edits', async () => {
    vaultA.writeText('test-a.md', 'base\n');
    await managerA.startSync();
    await managerB.startSync();

    vaultA.writeText('test-a.md', 'edit on A\n');
    vaultB.writeText('test-a.md', 'edit on B\n');

    await managerA.startSync();
    const conflict = await managerB.startSync();

    const conflictPath = vaultB.paths().find(path => path !== 'test-a.md' && path.endsWith('.md'));
    expect(conflict.success).toBe(true);
    expect(conflict.conflicts).toBe(1);
    expect(await vaultB.readText('test-a.md')).toBe('edit on B\n');
    expect(conflictPath).toBeDefined();
    expect(conflictPath).toContain('dev-a');
    expect(await vaultB.readText(conflictPath!)).toBe('edit on A\n');
  });

  it('propagates deletions from device A to device B', async () => {
    vaultA.writeText('test-a.md', 'delete me\n');
    await managerA.startSync();
    await managerB.startSync();

    vaultA.delete('test-a.md');
    const deleteUpload = await managerA.startSync();
    const deleteDownload = await managerB.startSync();

    expect(deleteUpload.success).toBe(true);
    expect(deleteUpload.uploaded).toBe(1);
    expect(deleteDownload.success).toBe(true);
    expect(deleteDownload.downloaded).toBe(1);
    expect(await vaultB.readText('test-a.md')).toBeUndefined();
  });

  it('does not delete a local unsynced edit when a remote delete arrives', async () => {
    vaultA.writeText('test-a.md', 'base\n');
    await managerA.startSync();
    await managerB.startSync();

    vaultA.delete('test-a.md');
    vaultB.writeText('test-a.md', 'local unsynced edit on B\n');

    await managerA.startSync();
    const guardedDelete = await managerB.startSync();

    expect(guardedDelete.success).toBe(true);
    expect(guardedDelete.conflicts).toBe(1);
    expect(await vaultB.readText('test-a.md')).toBe('local unsynced edit on B\n');
  });

  it('stops instead of creating a fresh namespace when legacy remote metadata exists', async () => {
    remote.legacyMetadata.set('meta/repo/repo_multi_device_test.json', {
      repoId: 'repo_multi_device_test',
      protocolVersion: '1.0.0',
      createdAt: Date.now(),
      devices: [],
      retentionDays: 30,
    });

    vaultA.writeText('test-a.md', 'should not upload\n');
    const result = await managerA.startSync();

    expect(result.success).toBe(false);
    expect(result.errors).toContain('检测到旧版远端数据布局，请先迁移或重新初始化同步仓库');
    expect(remote.metadata.size).toBe(0);
    expect(remote.content.size).toBe(0);
  });

  it('detects legacy remote layout from the settings entry point', async () => {
    remote.legacyMetadata.set('meta/repo/repo_multi_device_test.json', {
      repoId: 'repo_multi_device_test',
      protocolVersion: '1.0.0',
      createdAt: Date.now(),
      devices: [],
      retentionDays: 30,
    });

    const layout = await managerA.detectRemoteLayout();

    expect(layout).toEqual({
      currentLayout: false,
      legacyLayout: true,
    });
  });

  it('migrates legacy remote objects without deleting the old layout', async () => {
    const metadata: RepoMetadata = {
      repoId: 'repo_multi_device_test',
      protocolVersion: '1.0.0',
      createdAt: Date.now(),
      devices: [{ deviceId: 'dev-a', name: 'A', lastActive: Date.now() }],
      retentionDays: 30,
    };
    remote.legacyMetadata.set('meta/repo/repo_multi_device_test.json', metadata);
    remote.content.set('content/legacy-file-key', new TextEncoder().encode('encrypted file'));
    remote.logs.set('logs/dev-a/1.json', new TextEncoder().encode('encrypted log'));

    const result = await managerA.migrateLegacyRemoteLayout();

    expect(result).toEqual({ copied: 3, skipped: 0 });
    expect(remote.legacyMetadata.has('meta/repo/repo_multi_device_test.json')).toBe(true);
    expect(remote.content.has('content/legacy-file-key')).toBe(true);
    expect(remote.logs.has('logs/dev-a/1.json')).toBe(true);
    expect(remote.metadata.has('repos/repo_multi_device_test/meta/repo.json')).toBe(true);
    expect(remote.content.has('repos/repo_multi_device_test/content/legacy-file-key')).toBe(true);
    expect(remote.logs.has('repos/repo_multi_device_test/logs/dev-a/1.json')).toBe(true);
  });

  it('isolates different repo channels sharing the same remote storage', async () => {
    const sharedRemote = new SharedRemote();

    const user1A = new MemoryVault();
    const user1B = new MemoryVault();
    const user2A = new MemoryVault();
    const user2B = new MemoryVault();

    const { manager: user1ManagerA } = await createManager(
      sharedRemote,
      user1A,
      'user1-device-a',
      'repo_user_one',
      'shared-bucket-prefix'
    );
    const { manager: user1ManagerB } = await createManager(
      sharedRemote,
      user1B,
      'user1-device-b',
      'repo_user_one',
      'shared-bucket-prefix'
    );
    const { manager: user2ManagerA } = await createManager(
      sharedRemote,
      user2A,
      'user2-device-a',
      'repo_user_two',
      'shared-bucket-prefix'
    );
    const { manager: user2ManagerB } = await createManager(
      sharedRemote,
      user2B,
      'user2-device-b',
      'repo_user_two',
      'shared-bucket-prefix'
    );

    user1A.writeText('same-name.md', 'user one private note\n');
    user2A.writeText('same-name.md', 'user two private note\n');

    await user1ManagerA.startSync();
    await user2ManagerA.startSync();

    const user1Pull = await user1ManagerB.startSync();
    const user2Pull = await user2ManagerB.startSync();

    expect(user1Pull.success).toBe(true);
    expect(user2Pull.success).toBe(true);
    expect(await user1B.readText('same-name.md')).toBe('user one private note\n');
    expect(await user2B.readText('same-name.md')).toBe('user two private note\n');
    expect(await user1B.readText('same-name.md')).not.toBe(await user2B.readText('same-name.md'));

    const allRemoteKeys = [
      ...sharedRemote.content.keys(),
      ...sharedRemote.logs.keys(),
      ...sharedRemote.metadata.keys(),
    ];
    expect(allRemoteKeys.every(key => key.startsWith('shared-bucket-prefix/repos/'))).toBe(true);
    expect(allRemoteKeys.some(key => key.includes('/repo_user_one/'))).toBe(true);
    expect(allRemoteKeys.some(key => key.includes('/repo_user_two/'))).toBe(true);
  });

  it('uses backend STS credentials and namespace during sync', async () => {
    const sharedRemote = new SharedRemote();
    const vault = new MemoryVault();
    const persistence = new MemoryPersistence();
    const stsSettings = baseSettings('dev-commercial', 'repo_local_before_sts');
    stsSettings.credentialMode = 'sts';
    stsSettings.s3 = {
      endpoint: '',
      bucket: '',
      accessKey: '',
      secretKey: '',
      securityToken: '',
      region: 'auto',
      storagePrefix: '',
    };
    stsSettings.sts = {
      authServerUrl: 'https://sync.example.test',
      authToken: 'commercial-token',
      vaultId: 'main',
      refreshSkewMs: 300000,
    };

    const manager = new SyncManager(vault as any, persistence, stsSettings, {
      concurrentUploads: 1,
      concurrentDownloads: 1,
    });
    (manager as any).remoteStorage = new MemoryRemoteStorage(sharedRemote);
    (manager as any).credentialProvider = {
      getCredentials: vi.fn().mockResolvedValue({
        s3: {
          endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
          bucket: 'commercial-bucket',
          accessKey: 'temporary-access-key',
          secretKey: 'temporary-secret-key',
          securityToken: 'temporary-security-token',
          region: 'cn-hangzhou',
          storagePrefix: 'tenants/u_10001/vaults/main',
        },
        repoId: 'repo_from_backend',
        expirationMs: Date.now() + 3600000,
      }),
      clear: vi.fn(),
    };

    await manager.initialize();
    vault.writeText('commercial.md', 'commercial content\n');
    const result = await manager.startSync();

    expect(result.success).toBe(true);
    expect(stsSettings.repoId).toBe('repo_from_backend');
    const allRemoteKeys = [
      ...sharedRemote.content.keys(),
      ...sharedRemote.logs.keys(),
      ...sharedRemote.metadata.keys(),
    ];
    expect(allRemoteKeys.length).toBeGreaterThan(0);
    expect(allRemoteKeys.every(key => key.startsWith('tenants/u_10001/vaults/main/repos/repo_from_backend/'))).toBe(true);
  });
});
