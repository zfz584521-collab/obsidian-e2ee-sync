import { App, Modal, Setting, Notice } from 'obsidian';

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志条目
 */
export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * 同步日志管理器
 */
export class SyncLogger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;

  /**
   * 记录日志
   */
  log(level: LogLevel, message: string, details?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      details,
    };

    this.logs.unshift(entry);

    // 限制日志数量
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    // 同时输出到控制台
    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[consoleMethod](`[同步][${level.toUpperCase()}] ${message}`, details || '');
  }

  /**
   * 便捷方法
   */
  debug(message: string, details?: Record<string, unknown>): void {
    this.log('debug', message, details);
  }

  info(message: string, details?: Record<string, unknown>): void {
    this.log('info', message, details);
  }

  warn(message: string, details?: Record<string, unknown>): void {
    this.log('warn', message, details);
  }

  error(message: string, details?: Record<string, unknown>): void {
    this.log('error', message, details);
  }

  /**
   * 获取所有日志
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * 获取指定级别的日志
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(log => log.level === level);
  }

  /**
   * 获取指定时间范围的日志
   */
  getLogsByTimeRange(start: number, end: number): LogEntry[] {
    return this.logs.filter(log => log.timestamp >= start && log.timestamp <= end);
  }

  /**
   * 搜索日志
   */
  searchLogs(query: string): LogEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.logs.filter(log =>
      log.message.toLowerCase().includes(lowerQuery) ||
      JSON.stringify(log.details).toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 清除日志
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * 导出日志
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * 导入日志
   */
  importLogs(json: string): boolean {
    try {
      const logs = JSON.parse(json);
      if (Array.isArray(logs)) {
        this.logs = logs;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): { total: number; byLevel: Record<LogLevel, number> } {
    const byLevel: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };

    for (const log of this.logs) {
      byLevel[log.level]++;
    }

    return { total: this.logs.length, byLevel };
  }
}

// 全局日志实例
export const syncLogger = new SyncLogger();

/**
 * 同步日志查看器
 */
export class SyncLogViewerModal extends Modal {
  private logs: LogEntry[] = [];
  private filteredLogs: LogEntry[] = [];
  private levelFilter: LogLevel | 'all' = 'all';
  private searchQuery = '';

  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('sync-log-viewer');

    this.logs = syncLogger.getLogs();
    this.filteredLogs = [...this.logs];
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: '同步日志' });

    // 过滤器
    const filterEl = contentEl.createDiv({ cls: 'log-filters' });

    new Setting(filterEl)
      .setName('日志级别')
      .addDropdown(dropdown => {
        dropdown.addOption('all', '全部');
        dropdown.addOption('error', '错误');
        dropdown.addOption('warn', '警告');
        dropdown.addOption('info', '信息');
        dropdown.addOption('debug', '调试');
        dropdown.setValue(this.levelFilter);
        dropdown.onChange(value => {
          this.levelFilter = value as LogLevel | 'all';
          this.applyFilters();
        });
      });

    new Setting(filterEl)
      .setName('搜索')
      .addText(text => text
        .setPlaceholder('输入关键词搜索...')
        .setValue(this.searchQuery)
        .onChange(value => {
          this.searchQuery = value;
          this.applyFilters();
        }));

    // 统计
    const stats = syncLogger.getStats();
    const statsEl = contentEl.createDiv({ cls: 'log-stats' });
    statsEl.createSpan({ text: `总计: ${stats.total}` });
    statsEl.createSpan({ text: `错误: ${stats.byLevel.error}`, cls: 'stat-error' });
    statsEl.createSpan({ text: `警告: ${stats.byLevel.warn}`, cls: 'stat-warn' });

    // 日志列表
    const listEl = contentEl.createDiv({ cls: 'log-list' });

    if (this.filteredLogs.length === 0) {
      listEl.createDiv({ text: '暂无日志', cls: 'empty-logs' });
    } else {
      for (const log of this.filteredLogs.slice(0, 100)) {
        const itemEl = listEl.createDiv({ cls: `log-item log-item-${log.level}` });

        // 时间
        itemEl.createSpan({
          cls: 'log-time',
          text: new Date(log.timestamp).toLocaleString('zh-CN')
        });

        // 级别
        itemEl.createSpan({
          cls: `log-level log-level-${log.level}`,
          text: log.level.toUpperCase()
        });

        // 消息
        itemEl.createSpan({ cls: 'log-message', text: log.message });

        // 详情
        if (log.details) {
          const detailsEl = itemEl.createDiv({ cls: 'log-details' });
          detailsEl.setText(JSON.stringify(log.details, null, 2));
        }
      }
    }

    // 操作按钮
    const actionsEl = contentEl.createDiv({ cls: 'log-actions' });

    new Setting(actionsEl)
      .addButton(btn => btn
        .setButtonText('刷新')
        .onClick(() => {
          this.logs = syncLogger.getLogs();
          this.applyFilters();
        }))
      .addButton(btn => btn
        .setButtonText('导出')
        .onClick(() => this.exportLogs()))
      .addButton(btn => btn
        .setButtonText('清除')
        .setWarning()
        .onClick(() => {
          if (confirm('确定要清除所有日志吗？')) {
            syncLogger.clearLogs();
            this.logs = [];
            this.applyFilters();
            new Notice('日志已清除');
          }
        }))
      .addButton(btn => btn
        .setButtonText('关闭')
        .onClick(() => this.close()));
  }

  private applyFilters() {
    this.filteredLogs = this.logs.filter(log => {
      // 级别过滤
      if (this.levelFilter !== 'all' && log.level !== this.levelFilter) {
        return false;
      }
      // 搜索过滤
      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase();
        return log.message.toLowerCase().includes(query) ||
          (log.details && JSON.stringify(log.details).toLowerCase().includes(query));
      }
      return true;
    });
    this.render();
  }

  private exportLogs() {
    const json = syncLogger.exportLogs();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `sync-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    URL.revokeObjectURL(url);
    new Notice('日志已导出');
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
