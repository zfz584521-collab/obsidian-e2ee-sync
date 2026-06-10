import { App, TFile } from 'obsidian';
import { IndexEntry } from '../types';

/**
 * 文件变更类型
 */
export type ChangeType = 'created' | 'modified' | 'deleted';

/**
 * 文件变更记录
 */
export interface FileChange {
  path: string;
  type: ChangeType;
  oldHash?: string;
  newHash?: string;
  mtime: number;
  size: number;
}

/**
 * 增量同步检测器
 */
export class IncrementalSync {
  private app: App;
  private index: Map<string, IndexEntry>;
  private hashCache: Map<string, string> = new Map();

  constructor(app: App, index: Map<string, IndexEntry>) {
    this.app = app;
    this.index = index;
  }

  /**
   * 检测增量变更
   */
  async detectChanges(
    onProgress?: (current: number, total: number) => void
  ): Promise<FileChange[]> {
    const changes: FileChange[] = [];
    const files = this.app.vault.getFiles();
    const currentPaths = new Set<string>();

    let processed = 0;

    for (const file of files) {
      if (this.shouldIgnore(file.path)) {
        processed++;
        continue;
      }

      currentPaths.add(file.path);
      const existingEntry = this.index.get(file.path);

      // 检查是否需要重新哈希
      const needsHash = !existingEntry || file.stat.mtime > existingEntry.mtime;

      if (!existingEntry) {
        // 新文件
        const hash = await this.computeHash(file);
        changes.push({
          path: file.path,
          type: 'created',
          newHash: hash,
          mtime: file.stat.mtime,
          size: file.stat.size,
        });
      } else if (needsHash) {
        // 可能修改的文件，需要比较哈希
        const newHash = await this.computeHash(file);
        if (newHash !== existingEntry.hash) {
          changes.push({
            path: file.path,
            type: 'modified',
            oldHash: existingEntry.hash,
            newHash: newHash,
            mtime: file.stat.mtime,
            size: file.stat.size,
          });
        }
        // 更新缓存
        this.hashCache.set(file.path, newHash);
      }

      processed++;
      if (onProgress && processed % 100 === 0) {
        onProgress(processed, files.length);
      }
    }

    // 检测删除的文件
    for (const [path, entry] of this.index) {
      if (!currentPaths.has(path)) {
        changes.push({
          path: path,
          type: 'deleted',
          oldHash: entry.hash,
          mtime: 0,
          size: 0,
        });
      }
    }

    return changes;
  }

  /**
   * 快速检测变更（仅比较 mtime）
   */
  quickDetectChanges(): { created: string[]; modified: string[]; deleted: string[] } {
    const created: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    const files = this.app.vault.getFiles();
    const currentPaths = new Set<string>();

    for (const file of files) {
      if (this.shouldIgnore(file.path)) continue;

      currentPaths.add(file.path);
      const existingEntry = this.index.get(file.path);

      if (!existingEntry) {
        created.push(file.path);
      } else if (file.stat.mtime > existingEntry.mtime) {
        modified.push(file.path);
      }
    }

    for (const [path] of this.index) {
      if (!currentPaths.has(path)) {
        deleted.push(path);
      }
    }

    return { created, modified, deleted };
  }

  /**
   * 计算文件哈希（带缓存）
   */
  async computeHash(file: TFile): Promise<string> {
    // 检查缓存
    const cached = this.hashCache.get(file.path);
    if (cached) {
      return cached;
    }

    const content = await this.app.vault.readBinary(file);
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    const hashArray = new Uint8Array(hashBuffer);
    const hash = Array.from(hashArray)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // 更新缓存
    this.hashCache.set(file.path, hash);

    return hash;
  }

  /**
   * 清除哈希缓存
   */
  clearHashCache(): void {
    this.hashCache.clear();
  }

  /**
   * 获取哈希缓存大小
   */
  getHashCacheSize(): number {
    return this.hashCache.size;
  }

  /**
   * 检查路径是否应被忽略
   */
  private shouldIgnore(path: string): boolean {
    if (path.startsWith('.obsidian/')) return true;
    if (path.split('/').some(part => part.startsWith('.'))) return true;
    if (path.startsWith('.sync-')) return true;
    if (path.includes('.trash')) return true;
    return false;
  }

  /**
   * 比较两个索引的差异
   */
  compareIndexes(
    localIndex: Map<string, IndexEntry>,
    remoteIndex: Map<string, IndexEntry>
  ): {
    localOnly: string[];
    remoteOnly: string[];
    bothModified: string[];
    identical: string[];
  } {
    const localOnly: string[] = [];
    const remoteOnly: string[] = [];
    const bothModified: string[] = [];
    const identical: string[] = [];

    for (const [path, localEntry] of localIndex) {
      const remoteEntry = remoteIndex.get(path);
      if (!remoteEntry) {
        localOnly.push(path);
      } else if (localEntry.hash !== remoteEntry.hash) {
        bothModified.push(path);
      } else {
        identical.push(path);
      }
    }

    for (const [path] of remoteIndex) {
      if (!localIndex.has(path)) {
        remoteOnly.push(path);
      }
    }

    return { localOnly, remoteOnly, bothModified, identical };
  }
}

/**
 * 同步统计
 */
export interface SyncStats {
  totalFiles: number;
  totalSize: number;
  changesDetected: number;
  timeElapsed: number;
  bytesTransferred: number;
  filesPerSecond: number;
  bytesPerSecond: number;
}

/**
 * 同步统计收集器
 */
export class SyncStatsCollector {
  private startTime = 0;
  private filesProcessed = 0;
  private bytesTransferred = 0;

  start(): void {
    this.startTime = Date.now();
    this.filesProcessed = 0;
    this.bytesTransferred = 0;
  }

  recordFile(size: number): void {
    this.filesProcessed++;
    this.bytesTransferred += size;
  }

  getStats(): SyncStats {
    const elapsed = (Date.now() - this.startTime) / 1000;
    return {
      totalFiles: this.filesProcessed,
      totalSize: this.bytesTransferred,
      changesDetected: this.filesProcessed,
      timeElapsed: elapsed,
      bytesTransferred: this.bytesTransferred,
      filesPerSecond: elapsed > 0 ? this.filesProcessed / elapsed : 0,
      bytesPerSecond: elapsed > 0 ? this.bytesTransferred / elapsed : 0,
    };
  }
}
