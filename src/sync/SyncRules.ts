import { SyncRule } from '../types';

/**
 * 同步规则管理器
 * 处理选择性同步功能
 */
export class SyncRulesManager {
  private rules: SyncRule[];

  constructor(rules: SyncRule[] = []) {
    this.rules = rules;
  }

  /**
   * 设置规则
   */
  setRules(rules: SyncRule[]): void {
    this.rules = rules;
  }

  /**
   * 获取所有规则
   */
  getRules(): SyncRule[] {
    return [...this.rules];
  }

  /**
   * 添加规则
   */
  addRule(rule: SyncRule): void {
    this.rules.push(rule);
  }

  /**
   * 移除规则
   */
  removeRule(index: number): void {
    this.rules.splice(index, 1);
  }

  /**
   * 更新规则
   */
  updateRule(index: number, rule: SyncRule): void {
    this.rules[index] = rule;
  }

  /**
   * 检查路径是否应该同步
   */
  shouldSync(path: string): boolean {
    // 默认同步，除非被排除
    let shouldInclude = true;

    // 先处理排除规则
    for (const rule of this.rules.filter(r => r.enabled)) {
      if (rule.type === 'exclude' && this.matchPattern(path, rule.pattern)) {
        shouldInclude = false;
        break;
      }
    }

    // 再处理包含规则（包含规则优先级更高）
    for (const rule of this.rules.filter(r => r.enabled)) {
      if (rule.type === 'include' && this.matchPattern(path, rule.pattern)) {
        shouldInclude = true;
        break;
      }
    }

    return shouldInclude;
  }

  /**
   * 匹配 glob 模式
   */
  private matchPattern(path: string, pattern: string): boolean {
    // 简化版 glob 匹配
    // 支持：*（任意字符）、**（任意目录）、?（单个字符）

    // 将 glob 模式转换为正则
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
      .replace(/\*\*/g, '{{DOUBLE_STAR}}') // 临时替换 **
      .replace(/\*/g, '[^/]*') // * 匹配非 / 的任意字符
      .replace(/{{DOUBLE_STAR}}/g, '.*') // ** 匹配任意字符
      .replace(/\?/g, '[^/]'); // ? 匹配单个非 / 字符

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * 过滤路径列表
   */
  filterPaths(paths: string[]): string[] {
    return paths.filter(path => this.shouldSync(path));
  }

  /**
   * 获取默认规则
   */
  static getDefaultRules(): SyncRule[] {
    return [
      { type: 'exclude', pattern: '.obsidian/**', enabled: true },
      { type: 'exclude', pattern: '.trash/**', enabled: true },
      { type: 'exclude', pattern: '.*', enabled: true },
      { type: 'exclude', pattern: '.sync-*', enabled: true },
    ];
  }

  /**
   * 验证规则
   */
  validateRule(rule: SyncRule): { valid: boolean; error?: string } {
    if (!rule.pattern || rule.pattern.trim() === '') {
      return { valid: false, error: '模式不能为空' };
    }

    // 检查模式语法
    try {
      const regexPattern = rule.pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '{{DOUBLE_STAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/{{DOUBLE_STAR}}/g, '.*')
        .replace(/\?/g, '[^/]');
      new RegExp(`^${regexPattern}$`);
    } catch (e) {
      return { valid: false, error: '无效的模式语法' };
    }

    return { valid: true };
  }

  /**
   * 导出规则
   */
  exportRules(): string {
    return JSON.stringify(this.rules, null, 2);
  }

  /**
   * 导入规则
   */
  importRules(json: string): { success: boolean; error?: string } {
    try {
      const rules = JSON.parse(json);
      if (!Array.isArray(rules)) {
        return { success: false, error: '无效的规则格式' };
      }
      this.rules = rules;
      return { success: true };
    } catch (e) {
      return { success: false, error: 'JSON 解析失败' };
    }
  }
}

/**
 * 预设规则模板
 */
export const RULE_TEMPLATES: Record<string, SyncRule[] | ((folder: string) => SyncRule[])> = {
  /** 只同步笔记 */
  notesOnly: [
    { type: 'include', pattern: '**/*.md', enabled: true },
    { type: 'exclude', pattern: '**', enabled: true },
  ],
  /** 排除附件 */
  noAttachments: [
    { type: 'exclude', pattern: '**/*.png', enabled: true },
    { type: 'exclude', pattern: '**/*.jpg', enabled: true },
    { type: 'exclude', pattern: '**/*.pdf', enabled: true },
  ],
};
