import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

let syncObsidianVersionFiles: any;
let buildPackageName: any;
let collectPackageFiles: any;
let validatePackageEntries: any;

const tempDirectories: string[] = [];

beforeAll(async () => {
  // @ts-ignore - Node ESM release helper used by tests.
  ({ syncObsidianVersionFiles } = await import('../version-bump.mjs'));
  // @ts-ignore - Node ESM release helper used by tests.
  ({ buildPackageName, collectPackageFiles, validatePackageEntries } = await import('../scripts/package-plugin.mjs'));
});

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createTempProject() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-release-scripts-'));
  tempDirectories.push(directory);
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '0.2.0' }), 'utf8');
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ version: '0.1.0' }), 'utf8');
  fs.writeFileSync(path.join(directory, 'versions.json'), JSON.stringify({
    '1.5.0': '0.1.0',
    '1.0.0': '0.1.0',
  }), 'utf8');
  return directory;
}

describe('release helper scripts', () => {
  it('syncs package version into Obsidian manifest and versions map', () => {
    const rootDir = createTempProject();

    const result = syncObsidianVersionFiles({ rootDir });

    expect(result).toMatchObject({ version: '0.2.0', obsidianVersions: 2 });
    expect(JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'))).toEqual({ version: '0.2.0' });
    expect(JSON.parse(fs.readFileSync(path.join(rootDir, 'versions.json'), 'utf8'))).toEqual({
      '1.0.0': '0.2.0',
      '1.5.0': '0.2.0',
    });
  });

  it('uses a deterministic release package name', () => {
    expect(buildPackageName({ version: '0.2.0', stamp: '20260717-201500' }))
      .toBe('obsidian-sync-plugin-0.2.0-commercial-sts-20260717-201500');
  });

  it('collects only the four installable plugin package files', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-package-files-'));
    tempDirectories.push(rootDir);
    for (const file of ['main.js', 'manifest.json', 'styles.css', 'OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md']) {
      fs.writeFileSync(path.join(rootDir, file), file, 'utf8');
    }
    fs.writeFileSync(path.join(rootDir, 'data.json'), 'must not package', 'utf8');

    expect(collectPackageFiles(rootDir).map((entry: { file: string }) => entry.file)).toEqual([
      'main.js',
      'manifest.json',
      'styles.css',
      'OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md',
    ]);
  });

  it('validates release zip entries and rejects sensitive or development files', () => {
    expect(validatePackageEntries([
      'main.js',
      'manifest.json',
      'styles.css',
      'OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md',
    ])).toEqual([
      'main.js',
      'manifest.json',
      'styles.css',
      'OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md',
    ]);

    expect(() => validatePackageEntries([
      'main.js',
      'manifest.json',
      'styles.css',
      'OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md',
      'data.json',
    ])).toThrow('Forbidden package entry: data.json');
    expect(() => validatePackageEntries([
      'main.js',
      'manifest.json',
      'styles.css',
      'OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md',
      'src/main.ts',
    ])).toThrow('Forbidden package entry: src/main.ts');
  });
});
