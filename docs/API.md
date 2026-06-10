# API 文档

本文档介绍插件的核心 API，供开发者参考。

## CryptoService

加密服务，处理密钥派生、加解密和哈希计算。

### 初始化

```typescript
import { CryptoService } from './src/crypto/CryptoService';

const crypto = new CryptoService();

// 派生密钥
await crypto.deriveKey('my-password', customSalt?: Uint8Array);
```

### 方法

#### `deriveKey(password: string, salt?: Uint8Array): Promise<CryptoKey>`

从密码派生加密密钥。

- **参数**：
  - `password` - 用户密码
  - `salt` - 可选的盐值（32字节），不提供则自动生成
- **返回**：派生后的 CryptoKey

#### `encryptData(plaintext: Uint8Array): Promise<EncryptedPackage>`

加密数据。

- **返回**：
```typescript
interface EncryptedPackage {
  meta: {
    algorithm: 'AES-GCM-256';
    kdf: 'PBKDF2-SHA256';
    iterations: number;
    salt: string;      // Base64
    iv: string;        // Base64
    contentHash: string;
    timestamp: number;
  };
  data: string;        // Base64 加密内容
}
```

#### `decryptData(package: EncryptedPackage): Promise<Uint8Array>`

解密数据，自动验证内容哈希。

#### `encryptPath(path: string): Promise<string>`

加密文件路径（分段加密，URL 安全编码）。

#### `decryptPath(encryptedPath: string): Promise<string>`

解密文件路径。

#### `hash(data: Uint8Array): Promise<string>`

计算 SHA-256 哈希（Base64 编码）。

#### `generateId(): string`

生成随机 ID。

#### `generateDeviceId(): string`

生成设备 ID（格式：`dev_xxx`）。

#### `generateRepoId(): string`

生成仓库 ID（格式：`repo_xxx`）。

---

## RemoteStorage

S3 存储服务封装。

### 初始化

```typescript
import { RemoteStorage } from './src/sync/RemoteStorage';

const storage = new RemoteStorage();

storage.setConfig({
  endpoint: 'https://s3.amazonaws.com',
  bucket: 'my-bucket',
  accessKey: 'xxx',
  secretKey: 'xxx',
  region: 'us-east-1',
});
```

### 方法

#### `testConnection(): Promise<boolean>`

测试 S3 连接。

#### `upload(key: string, data: Uint8Array): Promise<string>`

上传数据，返回版本 ID。大文件自动分块上传。

#### `download(key: string): Promise<{ data: Uint8Array; versionId: string }>`

下载数据。

#### `exists(key: string): Promise<boolean>`

检查对象是否存在。

#### `list(prefix: string): Promise<string[]>`

列出指定前缀的对象。

#### `delete(key: string): Promise<void>`

删除对象。

#### `uploadLog(deviceId: string, logData: Uint8Array, clock: number): Promise<void>`

上传设备事件日志。

#### `createRepoMetadata(repoId: string, metadata: object): Promise<void>`

创建仓库元数据。

#### `getRepoMetadata(repoId: string): Promise<object | null>`

获取仓库元数据。

#### `destroy(): void`

销毁客户端，释放资源。

---

## SyncManager

同步管理器，协调所有同步操作。

### 初始化

```typescript
import { SyncManager, DataPersistence } from './src/sync/SyncManager';

const persistence: DataPersistence = {
  loadData: () => plugin.loadData(),
  saveData: (data) => plugin.saveData(data),
  saveSettings: () => plugin.saveSettings(),
};

const syncManager = new SyncManager(app, persistence, settings);
await syncManager.initialize();
```

### 方法

#### `initialize(): Promise<void>`

初始化同步管理器。

#### `startSync(): Promise<SyncResult>`

开始同步。

```typescript
interface SyncResult {
  success: boolean;
  uploaded: number;
  downloaded: number;
  conflicts: number;
  errors: string[];
}
```

#### `testConnection(): Promise<boolean>`

测试远端连接。

#### `getStatus(): SyncStatus`

获取当前同步状态。

```typescript
type SyncStatus = 'idle' | 'syncing' | 'error' | 'paused';
```

#### `isConfigured(): boolean`

检查是否已配置。

#### `updateSettings(settings: SyncSettings): void`

更新设置。

#### `getLocalFileCount(): number`

获取本地索引文件数。

#### `destroy(): void`

销毁管理器。

---

## LocalIndex

本地文件索引管理器。

### 方法

#### `initialize(): Promise<void>`

初始化索引，扫描仓库所有文件。

#### `scanChanges(): Promise<{ created, modified, deleted }>`

扫描变更。

#### `updateIndex(path: string): Promise<void>`

更新指定文件的索引。

#### `removeFromIndex(path: string): void`

从索引移除文件。

#### `getEntry(path: string): IndexEntry | undefined`

获取索引条目。

#### `getIndexSize(): number`

获取索引大小。

---

## 重试工具

```typescript
import { withRetry, isRetryableError, calculateBackoff } from './src/utils/retry';

// 带重试执行操作
const result = await withRetry(
  async () => someOperation(),
  {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
  },
  (attempt, error) => {
    console.log(`重试 ${attempt}: ${error.message}`);
  }
);

// 判断错误是否可重试
if (isRetryableError(error)) {
  // 重试
}

// 计算退避延迟
const delay = calculateBackoff(attemptNumber);
```

---

## 错误处理

```typescript
import { SyncError, SyncErrorCode } from './src/utils/errors';

try {
  await syncManager.startSync();
} catch (error) {
  const syncError = SyncError.fromError(error);

  console.log('错误码:', syncError.code);
  console.log('用户消息:', syncError.getUserMessage());
  console.log('可恢复:', syncError.recoverable);

  if (syncError.code === SyncErrorCode.NETWORK_ERROR) {
    // 网络错误处理
  }
}
```

### 错误码

| 错误码 | 说明 | 可恢复 |
|--------|------|--------|
| `CONFIG_MISSING` | 配置缺失 | ❌ |
| `NETWORK_ERROR` | 网络错误 | ✅ |
| `S3_ACCESS_DENIED` | S3 访问拒绝 | ❌ |
| `DECRYPTION_FAILED` | 解密失败 | ❌ |
| `HASH_MISMATCH` | 哈希校验失败 | ❌ |
| `FILE_TOO_LARGE` | 文件过大 | ✅ |

---

## 进度跟踪

```typescript
import { SyncStateManager } from './src/utils/progress';

const stateManager = new SyncStateManager();

// 设置持久化
stateManager.setPersistence({
  loadData: () => plugin.loadData(),
  saveData: (data) => plugin.saveData(data),
});

// 监听进度
const unsubscribe = stateManager.onProgress((progress) => {
  console.log('阶段:', progress.phase);
  console.log('进度:', `${progress.processed}/${progress.total}`);
  console.log('预估剩余:', progress.estimatedTimeRemaining, '秒');
});

// 取消监听
unsubscribe();
```

### 进度状态

```typescript
interface SyncProgress {
  phase: 'idle' | 'scanning' | 'uploading' | 'downloading' | 'applying' | 'completed' | 'error';
  currentFile?: string;
  processed: number;
  total: number;
  uploadedBytes: number;
  downloadedBytes: number;
  error?: string;
  startTime?: number;
  estimatedTimeRemaining?: number;
}
```
