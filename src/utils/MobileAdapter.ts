import { App, Platform } from 'obsidian';
import { syncLogger } from '../utils/Logger';

/**
 * 移动端同步配置
 */
export interface MobileSyncConfig {
  /** 仅 WiFi 下自动同步 */
  wifiOnly: boolean;
  /** 低电量阈值（百分比） */
  lowBatteryThreshold: number;
  /** 低电量时暂停同步 */
  pauseOnLowBattery: boolean;
  /** 移动端同步间隔倍数 */
  intervalMultiplier: number;
  /** 后台同步最大时间（秒） */
  maxBackgroundSyncTime: number;
  /** 图片压缩质量 (0-100) */
  imageCompressionQuality: number;
  /** 是否压缩图片 */
  compressImages: boolean;
}

/**
 * 默认移动端配置
 */
const DEFAULT_MOBILE_CONFIG: MobileSyncConfig = {
  wifiOnly: true,
  lowBatteryThreshold: 20,
  pauseOnLowBattery: true,
  intervalMultiplier: 2,
  maxBackgroundSyncTime: 30,
  imageCompressionQuality: 80,
  compressImages: false,
};

/**
 * 移动端同步优化器
 */
export class MobileSyncOptimizer {
  private app: App;
  private config: MobileSyncConfig;
  private isMobile: boolean;
  private isWifiConnected = true; // 假设默认 WiFi
  private batteryLevel: number | null = null;
  private isCharging = true;

  constructor(app: App, config: Partial<MobileSyncConfig> = {}) {
    this.app = app;
    this.config = { ...DEFAULT_MOBILE_CONFIG, ...config };
    this.isMobile = Platform.isMobile;

    if (this.isMobile) {
      this.initializeMobileFeatures();
    }
  }

  /**
   * 初始化移动端特性
   */
  private initializeMobileFeatures(): void {
    // 监听网络状态
    this.setupNetworkListener();

    // 监听电池状态
    this.setupBatteryListener();

    syncLogger.info('移动端同步优化器已初始化');
  }

  /**
   * 设置网络监听
   */
  private setupNetworkListener(): void {
    if (typeof navigator !== 'undefined' && 'connection' in navigator) {
      const connection = (navigator as any).connection;

      this.isWifiConnected = connection?.type === 'wifi' || connection?.effectiveType === '4g';

      connection?.addEventListener('change', () => {
        this.isWifiConnected = connection?.type === 'wifi' || connection?.effectiveType === '4g';
        syncLogger.debug(`网络状态变更: WiFi=${this.isWifiConnected}`);
      });
    }
  }

  /**
   * 设置电池监听
   */
  private async setupBatteryListener(): Promise<void> {
    if ('getBattery' in navigator) {
      try {
        const battery = await (navigator as any).getBattery();

        this.batteryLevel = battery.level * 100;
        this.isCharging = battery.charging;

        battery.addEventListener('levelchange', () => {
          this.batteryLevel = battery.level * 100;
        });

        battery.addEventListener('chargingchange', () => {
          this.isCharging = battery.charging;
        });
      } catch (error) {
        // 电池 API 可能不可用
      }
    }
  }

  /**
   * 检查是否应该同步
   */
  shouldSync(): { canSync: boolean; reason?: string } {
    // 桌面端总是可以同步
    if (!this.isMobile) {
      return { canSync: true };
    }

    // 检查 WiFi
    if (this.config.wifiOnly && !this.isWifiConnected) {
      return { canSync: false, reason: '仅 WiFi 下同步' };
    }

    // 检查电量
    if (this.config.pauseOnLowBattery && this.batteryLevel !== null) {
      if (this.batteryLevel < this.config.lowBatteryThreshold && !this.isCharging) {
        return { canSync: false, reason: `电量低于 ${this.config.lowBatteryThreshold}%` };
      }
    }

    return { canSync: true };
  }

  /**
   * 获取调整后的同步间隔
   */
  getAdjustedSyncInterval(baseInterval: number): number {
    if (!this.isMobile) return baseInterval;

    return baseInterval * this.config.intervalMultiplier;
  }

  /**
   * 获取移动端配置
   */
  getConfig(): MobileSyncConfig {
    return { ...this.config };
  }

  /**
   * 更新移动端配置
   */
  updateConfig(config: Partial<MobileSyncConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 检查是否是移动端
   */
  isMobileDevice(): boolean {
    return this.isMobile;
  }

  /**
   * 获取网络状态
   */
  getNetworkStatus(): { isWifi: boolean; batteryLevel: number | null; isCharging: boolean } {
    return {
      isWifi: this.isWifiConnected,
      batteryLevel: this.batteryLevel,
      isCharging: this.isCharging,
    };
  }

  /**
   * 计算数据使用建议
   */
  getDataUsageAdvice(): { shouldCompress: boolean; quality: number } {
    if (!this.isMobile) {
      return { shouldCompress: false, quality: 100 };
    }

    // 非 WiFi 且电量低时，压缩更多
    if (!this.isWifiConnected && this.batteryLevel !== null && this.batteryLevel < 30) {
      return { shouldCompress: true, quality: 60 };
    }

    return {
      shouldCompress: this.config.compressImages,
      quality: this.config.imageCompressionQuality,
    };
  }

  /**
   * 获取最大后台同步时间
   */
  getMaxBackgroundSyncTime(): number {
    return this.config.maxBackgroundSyncTime;
  }
}

/**
 * 移动端 UI 适配器
 */
export class MobileUIAdapter {
  private isMobile: boolean;

  constructor() {
    this.isMobile = Platform.isMobile;
  }

  /**
   * 获取适合的按钮大小
   */
  getButtonSize(): 'small' | 'medium' | 'large' {
    return this.isMobile ? 'large' : 'medium';
  }

  /**
   * 获取适合的字体大小
   */
  getFontSize(): number {
    return this.isMobile ? 16 : 14;
  }

  /**
   * 获取适合的间距
   */
  getSpacing(): number {
    return this.isMobile ? 16 : 12;
  }

  /**
   * 是否显示简化 UI
   */
  shouldShowSimplifiedUI(): boolean {
    return this.isMobile;
  }

  /**
   * 获取模态框宽度
   */
  getModalWidth(): string {
    return this.isMobile ? '100%' : '600px';
  }

  /**
   * 是否支持触摸手势
   */
  supportsTouch(): boolean {
    return this.isMobile || 'ontouchstart' in window;
  }

  /**
   * 获取列表项高度
   */
  getListItemHeight(): number {
    return this.isMobile ? 56 : 44;
  }

  /**
   * 获取图标大小
   */
  getIconSize(): number {
    return this.isMobile ? 24 : 20;
  }

  /**
   * 应用移动端样式
   */
  applyMobileStyles(element: HTMLElement): void {
    if (!this.isMobile) return;

    element.addClass('mobile-optimized');
    element.style.setProperty('--font-size', `${this.getFontSize()}px`);
    element.style.setProperty('--spacing', `${this.getSpacing()}px`);
    element.style.setProperty('--list-item-height', `${this.getListItemHeight()}px`);
  }

  /**
   * 添加触摸反馈
   */
  addTouchFeedback(element: HTMLElement): void {
    if (!this.supportsTouch()) return;

    element.addEventListener('touchstart', () => {
      element.addClass('touch-active');
    });

    element.addEventListener('touchend', () => {
      element.removeClass('touch-active');
    });

    element.addEventListener('touchcancel', () => {
      element.removeClass('touch-active');
    });
  }
}

// 全局实例
export const mobileUIAdapter = new MobileUIAdapter();
