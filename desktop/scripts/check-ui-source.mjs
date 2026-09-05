import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');

const SOURCE_ROOTS = [
  'components',
  'config',
  'features',
  'hooks',
  'notifications',
  'pages',
  'runtime',
  'utils',
  'App.tsx',
  'i18n.tsx',
  'index.css',
  'main.tsx',
  'types.d.ts',
  'vite-env.d.ts',
];

const PUBLIC_ASSET_ROOTS = [
  'branding',
  'channel-logos',
  'ecommerce-platform-icons',
  'onboarding',
  'provider-logos',
  'Box.png',
];

const IGNORED_NAMES = new Set(['.DS_Store']);

function walkFiles(rootPath, relativeBase = rootPath, files = []) {
  if (!existsSync(rootPath)) {
    return files;
  }

  const stats = statSync(rootPath);
  if (stats.isFile()) {
    files.push(path.relative(relativeBase, rootPath));
    return files;
  }

  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (IGNORED_NAMES.has(entry.name)) {
      continue;
    }
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, relativeBase, files);
    } else if (entry.isFile()) {
      files.push(path.relative(relativeBase, entryPath));
    }
  }

  return files;
}

function collectRootFiles(basePath, roots) {
  const files = [];
  for (const root of roots) {
    const absoluteRoot = path.join(basePath, root);
    for (const relativeFile of walkFiles(absoluteRoot, absoluteRoot)) {
      files.push(path.join(root, relativeFile));
    }
  }
  return files.sort();
}

function assertSourceCoverage() {
  const currentSrc = path.join(desktopRoot, 'src');
  const missing = SOURCE_ROOTS.filter((relativePath) => !existsSync(path.join(currentSrc, relativePath)));

  if (missing.length > 0) {
    console.error('Missing required Electron UI source paths:');
    for (const relativeFile of missing) {
      console.error(`- src/${relativeFile}`);
    }
    return false;
  }

  return true;
}

function assertPublicAssetParity() {
  const currentPublic = path.join(desktopRoot, 'public');
  const missing = PUBLIC_ASSET_ROOTS.filter((relativePath) => !existsSync(path.join(currentPublic, relativePath)));

  if (missing.length > 0) {
    console.error('Missing required Electron public assets:');
    for (const relativeFile of missing) {
      console.error(`- public/${relativeFile}`);
    }
  }

  return missing.length === 0;
}

const sourceOk = assertSourceCoverage();
const assetsOk = assertPublicAssetParity();

if (!sourceOk || !assetsOk) {
  process.exit(1);
}

const sourceCount = collectRootFiles(path.join(desktopRoot, 'src'), SOURCE_ROOTS).length;
const assetCount = collectRootFiles(path.join(desktopRoot, 'public'), PUBLIC_ASSET_ROOTS).length;
console.log(`UI source check passed: ${sourceCount} source files and ${assetCount} public assets are present.`);
