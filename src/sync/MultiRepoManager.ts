import { App, Notice } from 'obsidian';
import { SyncSettings, DEFAULT_SETTINGS } from '../types';
import { syncLogger } from '../utils/Logger';

/**
 * 仓库配置
 */
export interface RepoConfig {
  /** 仓库 ID */
  repoId: string;
  /** 仓库名称 */
  name: string;
  /** 仓库路径（相对于 vault） */
  path: string;
  /** 同步设置 */
  settings: SyncSettings;
  /** 是否启用 */
  enabled: boolean;
  /** 最后同步时间 */
  lastSyncTime: number;
  /** 创建时间 */
  createdAt: number;
}

/**
 * 多仓库管理器
 */
export class MultiRepoManager {
  private app: App;
  private repos: Map<string, RepoConfig> = new Map();
  private activeRepoId: string | null = null;
  private storageKey = 'multi-repo-config';

  constructor(app: App) {
    this.app = app;
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    await this.loadConfigs();
    syncLogger.info(`多仓库管理器初始化，共 ${this.repos.size} 个仓库`);
  }

  /**
   * 加载配置
   */
  private async loadConfigs(): Promise<void> {
    // 通过插件实例加载，需要在初始化时传入
    syncLogger.debug('加载仓库配置');
  }

  /**
   * 保存配置
   */
  async saveConfigs(): Promise<void> {
    syncLogger.debug('保存仓库配置');
  }

  /**
   * 添加仓库
   */
  async addRepo(config: Omit<RepoConfig, 'repoId' | 'createdAt' | 'lastSyncTime'>): Promise<RepoConfig> {
    const repoId = this.generateRepoId();
    const repo: RepoConfig = {
      ...config,
      repoId,
      createdAt: Date.now(),
      lastSyncTime: 0,
    };

    this.repos.set(repoId, repo);
    await this.saveConfigs();

    syncLogger.info(`添加仓库: ${repo.name}`);
    return repo;
  }

  /**
   * 移除仓库
   */
  async removeRepo(repoId: string): Promise<boolean> {
    if (!this.repos.has(repoId)) {
      return false;
    }

    this.repos.delete(repoId);
    if (this.activeRepoId === repoId) {
      this.activeRepoId = this.repos.keys().next().value || null;
    }

    await this.saveConfigs();
    syncLogger.info(`移除仓库: ${repoId}`);
    return true;
  }

  /**
   * 更新仓库配置
   */
  async updateRepo(repoId: string, updates: Partial<RepoConfig>): Promise<boolean> {
    const repo = this.repos.get(repoId);
    if (!repo) return false;

    Object.assign(repo, updates);
    await this.saveConfigs();
    return true;
  }

  /**
   * 获取仓库
   */
  getRepo(repoId: string): RepoConfig | undefined {
    return this.repos.get(repoId);
  }

  /**
   * 获取所有仓库
   */
  getAllRepos(): RepoConfig[] {
    return Array.from(this.repos.values());
  }

  /**
   * 获取启用的仓库
   */
  getEnabledRepos(): RepoConfig[] {
    return this.getAllRepos().filter(r => r.enabled);
  }

  /**
   * 设置活动仓库
   */
  setActiveRepo(repoId: string): boolean {
    if (!this.repos.has(repoId)) return false;
    this.activeRepoId = repoId;
    return true;
  }

  /**
   * 获取活动仓库
   */
  getActiveRepo(): RepoConfig | undefined {
    if (!this.activeRepoId) return undefined;
    return this.repos.get(this.activeRepoId);
  }

  /**
   * 获取活动仓库 ID
   */
  getActiveRepoId(): string | null {
    return this.activeRepoId;
  }

  /**
   * 检查仓库是否存在
   */
  hasRepo(repoId: string): boolean {
    return this.repos.has(repoId);
  }

  /**
   * 获取仓库数量
   */
  getRepoCount(): number {
    return this.repos.size;
  }

  /**
   * 更新最后同步时间
   */
  async updateLastSyncTime(repoId: string): Promise<void> {
    const repo = this.repos.get(repoId);
    if (repo) {
      repo.lastSyncTime = Date.now();
      await this.saveConfigs();
    }
  }

  /**
   * 生成仓库 ID
   */
  private generateRepoId(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `repo_${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
  }

  /**
   * 导出所有仓库配置
   */
  exportConfigs(): string {
    return JSON.stringify({
      version: '1.0.0',
      exportedAt: Date.now(),
      repos: this.getAllRepos(),
    }, null, 2);
  }

  /**
   * 导入仓库配置
   */
  async importConfigs(json: string): Promise<{ success: boolean; imported: number }> {
    try {
      const data = JSON.parse(json);
      if (!data.repos || !Array.isArray(data.repos)) {
        return { success: false, imported: 0 };
      }

      let imported = 0;
      for (const repo of data.repos) {
        if (repo.repoId && repo.name && repo.settings) {
          this.repos.set(repo.repoId, repo);
          imported++;
        }
      }

      await this.saveConfigs();
      syncLogger.info(`导入 ${imported} 个仓库配置`);
      return { success: true, imported };
    } catch (error) {
      syncLogger.error('导入仓库配置失败', { error });
      return { success: false, imported: 0 };
    }
  }
}
