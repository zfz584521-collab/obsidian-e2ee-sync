import { App, Modal, Setting, Notice } from 'obsidian';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  details?: Record<string, unknown>;
}

const SENSITIVE_KEY_PATTERN = /(access.?key|secret|password|token|credential|authorization|device.?id)/i;
const REDACTED = '[REDACTED]';

export class SyncLogger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;

  log(level: LogLevel, message: string, details?: Record<string, unknown>): void {
    const safeDetails = details ? this.sanitize(details) as Record<string, unknown> : undefined;
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      details: safeDetails,
    };

    this.logs.unshift(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[consoleMethod](`[sync][${level.toUpperCase()}] ${message}`, safeDetails || '');
  }

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

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(log => log.level === level);
  }

  getLogsByTimeRange(start: number, end: number): LogEntry[] {
    return this.logs.filter(log => log.timestamp >= start && log.timestamp <= end);
  }

  searchLogs(query: string): LogEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.logs.filter(log =>
      log.message.toLowerCase().includes(lowerQuery) ||
      JSON.stringify(log.details || {}).toLowerCase().includes(lowerQuery)
    );
  }

  clearLogs(): void {
    this.logs = [];
  }

  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  importLogs(json: string): boolean {
    try {
      const logs = JSON.parse(json);
      if (!Array.isArray(logs)) {
        return false;
      }

      this.logs = logs.map(log => ({
        ...log,
        details: log.details ? this.sanitize(log.details) as Record<string, unknown> : undefined,
      }));
      return true;
    } catch {
      return false;
    }
  }

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

  private sanitize(value: unknown, key = ''): unknown {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      return REDACTED;
    }

    if (Array.isArray(value)) {
      return value.map(item => this.sanitize(item));
    }

    if (value && typeof value === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        sanitized[childKey] = this.sanitize(childValue, childKey);
      }
      return sanitized;
    }

    if (typeof value === 'string') {
      return this.sanitizeString(value);
    }

    return value;
  }

  private sanitizeString(value: string): string {
    return value
      .replace(/(access[_-]?key(?:id)?\s*[:=]\s*)[^\s,;]+/gi, `$1${REDACTED}`)
      .replace(/(secret(?:[_-]?key)?\s*[:=]\s*)[^\s,;]+/gi, `$1${REDACTED}`)
      .replace(/(password\s*[:=]\s*)[^\s,;]+/gi, `$1${REDACTED}`)
      .replace(/(token\s*[:=]\s*)[^\s,;]+/gi, `$1${REDACTED}`)
      .replace(/(authorization\s*[:=]\s*)[^\s,;]+/gi, `$1${REDACTED}`);
  }
}

export const syncLogger = new SyncLogger();

export class SyncLogViewerModal extends Modal {
  private logs: LogEntry[] = [];
  private filteredLogs: LogEntry[] = [];
  private levelFilter: LogLevel | 'all' = 'all';
  private searchQuery = '';

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('sync-log-viewer');

    this.logs = syncLogger.getLogs();
    this.filteredLogs = [...this.logs];
    this.render();
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: '同步日志' });

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
        .setPlaceholder('搜索日志...')
        .setValue(this.searchQuery)
        .onChange(value => {
          this.searchQuery = value;
          this.applyFilters();
        }));

    const stats = syncLogger.getStats();
    const statsEl = contentEl.createDiv({ cls: 'log-stats' });
    statsEl.createSpan({ text: `总数：${stats.total}` });
    statsEl.createSpan({ text: `错误：${stats.byLevel.error}`, cls: 'stat-error' });
    statsEl.createSpan({ text: `警告：${stats.byLevel.warn}`, cls: 'stat-warn' });

    const listEl = contentEl.createDiv({ cls: 'log-list' });

    if (this.filteredLogs.length === 0) {
      listEl.createDiv({ text: '暂无日志', cls: 'empty-logs' });
    } else {
      for (const log of this.filteredLogs.slice(0, 100)) {
        const itemEl = listEl.createDiv({ cls: `log-item log-item-${log.level}` });

        itemEl.createSpan({
          cls: 'log-time',
          text: new Date(log.timestamp).toLocaleString(),
        });

        itemEl.createSpan({
          cls: `log-level log-level-${log.level}`,
          text: log.level.toUpperCase(),
        });

        itemEl.createSpan({ cls: 'log-message', text: log.message });

        if (log.details) {
          const detailsEl = itemEl.createDiv({ cls: 'log-details' });
          detailsEl.setText(JSON.stringify(log.details, null, 2));
        }
      }
    }

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
        .setButtonText('清空')
        .setWarning()
        .onClick(() => {
          if (confirm('确定要清空所有日志吗？')) {
            syncLogger.clearLogs();
            this.logs = [];
            this.applyFilters();
            new Notice('日志已清空。');
          }
        }))
      .addButton(btn => btn
        .setButtonText('关闭')
        .onClick(() => this.close()));
  }

  private applyFilters(): void {
    this.filteredLogs = this.logs.filter(log => {
      if (this.levelFilter !== 'all' && log.level !== this.levelFilter) {
        return false;
      }

      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase();
        return log.message.toLowerCase().includes(query) ||
          JSON.stringify(log.details || {}).toLowerCase().includes(query);
      }

      return true;
    });
    this.render();
  }

  private exportLogs(): void {
    const json = syncLogger.exportLogs();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `sync-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    URL.revokeObjectURL(url);
    new Notice('日志已导出。');
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
