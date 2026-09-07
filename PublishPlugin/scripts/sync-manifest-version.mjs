#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncManifestVersion } from '../../Plugin/scripts/sync-manifest-version.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

syncManifestVersion({ cwd: pluginRoot }).catch((error) => {
  console.error(`[sync-manifest-version] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
