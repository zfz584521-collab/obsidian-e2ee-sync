/**
 * 同步插件类型定义
 */

/** S3/兼容存储配置 */
export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

/** 插件设置，存储在 data.json */
export interface SyncSettings {
  /** S3 兼容存储配置 */
  s3: S3Config;
  /** 用户定义的同步密码，用于加密 */
  syncPassword: string;
  /** 唯一设备标识 */
  deviceId: string;
  /** 人类可读的设备名称 */
  deviceName: string;
  /** 仓库标识 */
  repoId: string;
  /** 是否启用自动同步 */
  autoSync: boolean;
  /** 同步间隔（秒），0 表示仅手动 */
  syncInterval: number;
}

/** 默认设置 */
export const DEFAULT_SETTINGS: SyncSettings = {
  s3: {
    endpoint: '',
    bucket: '',
    accessKey: '',
    secretKey: '',
    region: 'auto',
  },
  syncPassword: '',
  deviceId: '',
  deviceName: '',
  repoId: '',
  autoSync: false,
  syncInterval: 0,
};

/** 同步事件类型 */
export type SyncEventType = 'create' | 'modify' | 'delete' | 'move';

/** 同步事件，跟踪变更 */
export interface SyncEvent {
  /** 事件唯一标识 */
  id: string;
  /** 创建此事件的设备 ID */
  deviceId: string;
  /** 逻辑时钟值 */
  clock: number;
  /** 事件类型 */
  type: SyncEventType;
  /** 文件路径（加密后） */
  path: string;
  /** 内容哈希（用于创建/修改） */
  contentHash?: string;
  /** 旧路径（用于移动） */
  oldPath?: string;
  /** 父事件 ID，用于因果排序 */
  parentId: string;
  /** 时间戳 */
  timestamp: number;
}

/** 本地文件索引条目 */
export interface IndexEntry {
  /** 相对于仓库根目录的路径 */
  path: string;
  /** 内容哈希 */
  hash: string;
  /** 最后修改时间 */
  mtime: number;
  /** 文件大小（字节） */
  size: number;
  /** 当前版本 ID */
  versionId: string;
}

/** 同步状态 */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'paused';

/** 同步结果 */
export interface SyncResult {
  success: boolean;
  uploaded: number;
  downloaded: number;
  conflicts: number;
  errors: string[];
}

/** 加密元数据 */
export interface EncryptionMetadata {
  /** 加密算法 */
  algorithm: 'AES-GCM-256';
  /** 密钥派生函数 */
  kdf: 'PBKDF2-SHA256';
  /** 迭代次数 */
  iterations: number;
  /** 盐值（Base64） */
  salt: string;
  /** 初始化向量（Base64） */
  iv: string;
  /** 内容哈希（用于校验） */
  contentHash: string;
  /** 加密时间 */
  timestamp: number;
}

/** 加密内容包 */
export interface EncryptedPackage {
  /** 元数据 */
  meta: EncryptionMetadata;
  /** 加密内容（Base64） */
  data: string;
}

/** 仓库元数据 */
export interface RepoMetadata {
  /** 仓库 ID */
  repoId: string;
  /** 协议版本 */
  protocolVersion: string;
  /** 创建时间 */
  createdAt: number;
  /** 已注册设备 */
  devices: DeviceInfo[];
  /** 保留策略（天） */
  retentionDays: number;
}

/** 设备信息 */
export interface DeviceInfo {
  /** 设备 ID */
  deviceId: string;
  /** 设备名称 */
  name: string;
  /** 最后活跃时间 */
  lastActive: number;
}
