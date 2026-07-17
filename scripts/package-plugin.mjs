import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PACKAGE_FILES = [
  'main.js',
  'manifest.json',
  'styles.css',
  'OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md',
];

export function buildPackageName({ version, stamp = createTimestamp() }) {
  if (!version) throw new Error('version is required');
  return `obsidian-sync-plugin-${version}-commercial-sts-${stamp}`;
}

export function collectPackageFiles(rootDir = process.cwd()) {
  return PACKAGE_FILES.map(file => {
    const fullPath = path.join(rootDir, file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Missing package file: ${file}`);
    }
    return { file, fullPath };
  });
}

export function createReleasePackage({
  rootDir = process.cwd(),
  releaseDir = path.join(rootDir, 'release'),
  stamp = createTimestamp(),
} = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
  const packageName = buildPackageName({ version: manifest.version, stamp });
  const outputDir = path.join(releaseDir, packageName);
  const zipPath = path.join(releaseDir, `${packageName}.zip`);

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  for (const { file, fullPath } of collectPackageFiles(rootDir)) {
    fs.copyFileSync(fullPath, path.join(outputDir, file));
  }

  createZipArchive({ sourceDir: outputDir, zipPath });

  return {
    packageName,
    outputDir,
    zipPath,
    files: PACKAGE_FILES,
  };
}

function createZipArchive({ sourceDir, zipPath }) {
  const command = [
    'Compress-Archive',
    '-Path',
    `'${path.join(sourceDir, '*').replace(/'/g, "''")}'`,
    '-DestinationPath',
    `'${zipPath.replace(/'/g, "''")}'`,
    '-Force',
  ].join(' ');
  const result = spawnSync('powershell', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`Failed to create release zip: ${result.stderr || result.stdout}`);
  }
  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size <= 0) {
    throw new Error('Failed to create release zip: archive was not written');
  }
}

function createTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = createReleasePackage();
  console.log(JSON.stringify(result, null, 2));
}
