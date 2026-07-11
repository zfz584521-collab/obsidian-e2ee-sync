import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class MockApp {},
  Modal: class MockModal {},
  Setting: class MockSetting {},
  Notice: vi.fn(),
}));

import { SyncLogger } from '../src/utils/Logger';

describe('SyncLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts sensitive fields before storing and exporting logs', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new SyncLogger();

    logger.info('configured remote', {
      endpoint: 'https://oss.example.test',
      accessKey: 'ACCESS_KEY_SHOULD_NOT_LOG',
      secretKey: 'SECRET_SHOULD_NOT_LOG',
      syncPassword: 'PASSWORD_SHOULD_NOT_LOG',
      deviceId: 'DEVICE_SHOULD_NOT_LOG',
      nested: {
        authorization: 'Bearer TOKEN_SHOULD_NOT_LOG',
      },
    });

    const [entry] = logger.getLogs();
    expect(entry.details).toMatchObject({
      endpoint: 'https://oss.example.test',
      accessKey: '[REDACTED]',
      secretKey: '[REDACTED]',
      syncPassword: '[REDACTED]',
      deviceId: '[REDACTED]',
      nested: {
        authorization: '[REDACTED]',
      },
    });

    const exported = logger.exportLogs();
    expect(exported).not.toContain('ACCESS_KEY_SHOULD_NOT_LOG');
    expect(exported).not.toContain('SECRET_SHOULD_NOT_LOG');
    expect(exported).not.toContain('PASSWORD_SHOULD_NOT_LOG');
    expect(exported).not.toContain('DEVICE_SHOULD_NOT_LOG');
    expect(exported).not.toContain('TOKEN_SHOULD_NOT_LOG');
  });

  it('redacts inline credential patterns in string details', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = new SyncLogger();

    logger.warn('provider error', {
      message: 'request failed accessKey=AKIA_TEST secret=SECRET_TEST password=PASSWORD_TEST token=TOKEN_TEST',
    });

    const exported = logger.exportLogs();
    expect(exported).toContain('accessKey=[REDACTED]');
    expect(exported).toContain('secret=[REDACTED]');
    expect(exported).toContain('password=[REDACTED]');
    expect(exported).toContain('token=[REDACTED]');
    expect(exported).not.toContain('AKIA_TEST');
    expect(exported).not.toContain('SECRET_TEST');
    expect(exported).not.toContain('PASSWORD_TEST');
    expect(exported).not.toContain('TOKEN_TEST');
  });

  it('sanitizes imported logs as well', () => {
    const logger = new SyncLogger();

    const ok = logger.importLogs(JSON.stringify([{
      timestamp: Date.now(),
      level: 'info',
      message: 'imported',
      details: {
        secretKey: 'IMPORTED_SECRET',
      },
    }]));

    expect(ok).toBe(true);
    expect(logger.exportLogs()).not.toContain('IMPORTED_SECRET');
    expect(logger.exportLogs()).toContain('[REDACTED]');
  });
});
