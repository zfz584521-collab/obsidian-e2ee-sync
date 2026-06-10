import { App, Notice } from 'obsidian';
import { FileVersion, VersionHistoryEntry } from '../types';
import { RemoteStorage } from './RemoteStorage';
import { CryptoService } from '../crypto/CryptoService';

/**
 * 版本历史管理器
 */
export class VersionHistoryManager {
  private app: App;
  private remoteStorage: RemoteStorage;
  private crypto: CryptoService;
  private cache: Map<string, VersionHistoryEntry> = new Map();

  constructor(app: App, remoteStorage: RemoteStorage, crypto: CryptoService) {
    this.app = app;
    this.remoteStorage = remoteStorage;
    this.crypto = crypto;
  }

  /**
   * 获取文件的版本历史
   */
  async getFileHistory(path: string): Promise<VersionHistoryEntry | null> {
    // 检查缓存
    if (this.cache.has(path)) {
      return this.cache.get(path)!;
    }

    try {
      // 获取远端版本列表
      const versions = await this.listVersions(path);

      if (versions.length === 0) {
        return null;
      }

      const entry: VersionHistoryEntry = {
        path,
        versions,
        currentVersionId: versions[0].versionId,
      };

      this.cache.set(path, entry);
      return entry;
    } catch (error) {
      console.error('[版本历史] 获取历史失败：', error);
      return null;
    }
  }

  /**
   * 列出文件的所有版本
   */
  private async listVersions(path: string): Promise<FileVersion[]> {
    // 加密路径
    const encryptedPath = await this.crypto.encryptPath(path);

    // 获取版本列表（简化实现，实际需要 S3 版本控制 API）
    // TODO: 使用 S3 ListObjectVersions API
    const versions: FileVersion[] = [];

    return versions;
  }

  /**
   * 恢复到指定版本
   */
  async restoreVersion(path: string, versionId: string): Promise<boolean> {
    try {
      // 加密路径
      const encryptedPath = await this.crypto.encryptPath(path);

      // 下载指定版本
      const { data } = await this.remoteStorage.download(encryptedPath);

      // 解密
      const packageJson = new TextDecoder().decode(data);
      const encryptedPackage = JSON.parse(packageJson);
      const content = await this.crypto.decryptData(encryptedPackage);

      // 写入文件
      await this.writeFile(path, content);

      new Notice(`已恢复文件：${path}`);
      return true;
    } catch (error) {
      console.error('[版本历史] 恢复失败：', error);
      new Notice(`恢复失败：${error instanceof Error ? error.message : '未知错误'}`);
      return false;
    }
  }

  /**
   * 写入文件
   */
  private async writeFile(path: string, content: Uint8Array): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      await this.app.vault.modifyBinary(file as any, content.buffer as ArrayBuffer);
    } else {
      await this.app.vault.createBinary(path, content.buffer as ArrayBuffer);
    }
  }

  /**
   * 预览版本内容
   */
  async previewVersion(path: string, versionId: string): Promise<string | null> {
    try {
      const encryptedPath = await this.crypto.encryptPath(path);
      const { data } = await this.remoteStorage.download(encryptedPath);

      const packageJson = new TextDecoder().decode(data);
      const encryptedPackage = JSON.parse(packageJson);
      const content = await this.crypto.decryptData(encryptedPackage);

      // 尝试解码为文本
      try {
        return new TextDecoder().decode(content);
      } catch {
        return null; // 二进制文件
      }
    } catch (error) {
      console.error('[版本历史] 预览失败：', error);
      return null;
    }
  }

  /**
   * 比较两个版本
   */
  async compareVersions(
    path: string,
    versionId1: string,
    versionId2: string
  ): Promise<{ content1: string; content2: string } | null> {
    const content1 = await this.previewVersion(path, versionId1);
    const content2 = await this.previewVersion(path, versionId2);

    if (content1 === null || content2 === null) {
      return null;
    }

    return { content1, content2 };
  }

  /**
   * 删除版本
   */
  async deleteVersion(path: string, versionId: string): Promise<boolean> {
    try {
      // TODO: 实现 S3 版本删除
      new Notice('版本删除功能暂未实现');
      return false;
    } catch (error) {
      console.error('[版本历史] 删除失败：', error);
      return false;
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

/**
 * 版本历史面板数据
 */
export interface VersionHistoryPanelData {
  path: string;
  versions: FileVersion[];
  loading: boolean;
  error?: string;
}
