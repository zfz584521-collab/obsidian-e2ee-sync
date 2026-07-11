import { App, TFile } from 'obsidian';
import { IndexEntry } from '../types';
import { CryptoService } from '../crypto/CryptoService';

/**
 * 本地索引管理器
 * 跟踪本地文件状态并检测变更
 */
export class LocalIndex {
  private app: App;
  private crypto: CryptoService;
  private index: Map<string, IndexEntry> = new Map();
  private indexPath = '.sync-index.json';

  constructor(app: App, crypto: CryptoService) {
    this.app = app;
    this.crypto = crypto;
  }

  /**
   * 从磁盘初始化索引或从头构建
   */
  async initialize(): Promise<void> {
    console.log('[本地索引] 正在初始化...');
    // 索引表示“上次成功同步后的基线”。
    // 如果没有持久化基线，应保持为空，让首次同步把当前文件识别为待上传。
  }

  /**
   * 扫描仓库中的所有文件
   */
  private async scanAllFiles(): Promise<void> {
    console.log('[本地索引] 正在扫描所有文件...');
    const files = this.app.vault.getFiles();

    for (const file of files) {
      if (this.shouldIgnore(file.path)) continue;

      const entry = await this.createIndexEntry(file);
      if (entry) {
        this.index.set(file.path, entry);
      }
    }

    console.log(`[本地索引] 已索引 ${this.index.size} 个文件`);
  }

  /**
   * 为文件创建索引条目
   */
  private async createIndexEntry(file: TFile): Promise<IndexEntry | null> {
    try {
      const content = await this.app.vault.readBinary(file);
      const contentBytes = new Uint8Array(content);
      const hash = await this.crypto.hash(contentBytes);

      return {
        path: file.path,
        hash: hash,
        mtime: file.stat.mtime,
        size: file.stat.size,
        versionId: '',
      };
    } catch (error) {
      console.error(`[本地索引] 索引失败 ${file.path}：`, error);
      return null;
    }
  }

  /**
   * 检测上次同步后的本地变更
   */
  async scanChanges(): Promise<{ created: string[]; modified: string[]; deleted: string[] }> {
    console.log('[本地索引] 正在扫描变更...');

    const created: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    const currentFiles = new Set<string>();
    const files = this.app.vault.getFiles();

    for (const file of files) {
      if (this.shouldIgnore(file.path)) continue;

      currentFiles.add(file.path);

      const existingEntry = this.index.get(file.path);
      if (!existingEntry) {
        created.push(file.path);
      } else if (file.stat.mtime > existingEntry.mtime) {
        modified.push(file.path);
      }
    }

    // 检查已删除的文件
    for (const [path] of this.index) {
      if (!currentFiles.has(path)) {
        deleted.push(path);
      }
    }

    console.log(`[本地索引] 变更：${created.length} 个新建，${modified.length} 个修改，${deleted.length} 个删除`);

    return { created, modified, deleted };
  }

  /**
   * 更新文件的索引条目
   */
  async updateIndex(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const entry = await this.createIndexEntry(file);
      if (entry) {
        this.index.set(path, entry);
        console.log(`[本地索引] 已更新索引：${path}`);
      }
    }
  }

  /**
   * 从索引中移除文件
   */
  removeFromIndex(path: string): void {
    this.index.delete(path);
    console.log(`[本地索引] 已从索引移除 ${path}`);
  }

  /**
   * 获取索引条目
   */
  getEntry(path: string): IndexEntry | undefined {
    return this.index.get(path);
  }

  /**
   * 获取完整索引
   */
  getIndex(): Map<string, IndexEntry> {
    return this.index;
  }

  /**
   * 从持久化数据恢复索引
   */
  importIndex(entries: Record<string, IndexEntry> | undefined): void {
    this.index.clear();
    if (!entries) return;

    for (const [path, entry] of Object.entries(entries)) {
      this.index.set(path, entry);
    }
    console.log(`[本地索引] 已恢复 ${this.index.size} 个索引条目`);
  }

  /**
   * 检查路径是否应被忽略
   */
  private shouldIgnore(path: string): boolean {
    // 忽略 Obsidian 配置
    if (path.startsWith('.obsidian/')) return true;
    // 忽略隐藏文件
    if (path.split('/').some(part => part.startsWith('.'))) return true;
    // 忽略插件自身文件
    if (path.startsWith('.sync-')) return true;
    // 忽略回收站
    if (path.includes('.trash')) return true;

    return false;
  }

  /**
   * 获取当前索引大小
   */
  getIndexSize(): number {
    return this.index.size;
  }

  /**
   * 保存索引到磁盘
   */
  async save(): Promise<void> {
    console.log('[本地索引] 正在保存索引...');
  }

  /**
   * 导出索引用于调试
   */
  exportIndex(): Record<string, IndexEntry> {
    const result: Record<string, IndexEntry> = {};
    for (const [path, entry] of this.index) {
      result[path] = entry;
    }
    return result;
  }
}
