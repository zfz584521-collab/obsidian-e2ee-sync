import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function syncObsidianVersionFiles({
  rootDir = process.cwd(),
  version,
} = {}) {
  const packagePath = path.join(rootDir, 'package.json');
  const manifestPath = path.join(rootDir, 'manifest.json');
  const versionsPath = path.join(rootDir, 'versions.json');
  const packageJson = loadJson(packagePath);
  const targetVersion = version || packageJson.version;

  if (!targetVersion || typeof targetVersion !== 'string') {
    throw new Error('package.json version is required');
  }

  const manifest = loadJson(manifestPath);
  manifest.version = targetVersion;
  writeJson(manifestPath, manifest);

  const versions = loadJson(versionsPath);
  const updatedVersions = Object.fromEntries(
    Object.keys(versions)
      .sort(compareVersionKeys)
      .map(obsidianVersion => [obsidianVersion, targetVersion]),
  );
  writeJson(versionsPath, updatedVersions);

  return {
    version: targetVersion,
    manifestPath,
    versionsPath,
    obsidianVersions: Object.keys(updatedVersions).length,
  };
}

function compareVersionKeys(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] || 0) - (right[i] || 0);
    if (difference !== 0) return difference;
  }
  return a.localeCompare(b);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = syncObsidianVersionFiles();
  console.log(JSON.stringify(result, null, 2));
}
