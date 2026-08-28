const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..');
const pluginDir = path.join(repoRoot, 'Plugin');
const sourceDir = path.join(pluginDir, 'dist', 'extension');
const runtimeRoot = path.join(desktopDir, '.plugin-runtime');
const targetDir = path.join(runtimeRoot, 'browser-extension');

function resolvePnpmInvocation() {
  const cliCandidates = [
    process.env.REDBOX_PNPM_CLI,
    process.env.npm_execpath,
  ];
  for (const candidate of cliCandidates) {
    const cliPath = String(candidate || '').trim();
    if (!cliPath || !fs.existsSync(cliPath)) continue;
    if (!/^pnpm(?:\.c?js|\.mjs)$/i.test(path.basename(cliPath))) continue;
    return {
      command: process.execPath,
      prefixArgs: [cliPath],
      shell: false,
      label: `${process.execPath} ${cliPath}`,
    };
  }

  const windows = process.platform === 'win32';
  return {
    command: windows ? 'pnpm.cmd' : 'pnpm',
    prefixArgs: [],
    shell: windows,
    label: windows ? 'pnpm.cmd' : 'pnpm',
  };
}

function runPluginCommand(commandArgs, options = {}) {
  const invocation = resolvePnpmInvocation();
  const result = spawnSync(
    invocation.command,
    [...invocation.prefixArgs, '--dir', pluginDir, ...commandArgs],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'inherit',
      shell: invocation.shell,
      env: options.nonInteractive
        ? { ...process.env, CI: process.env.CI || 'true' }
        : process.env,
    },
  );
  if (result.error) {
    throw new Error(`Unable to run ${invocation.label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Browser extension ${commandArgs.join(' ')} failed with exit code ${result.status}`);
  }
}

function assertBuiltExtension(dir) {
  const requiredFiles = [
    'manifest.json',
    'background.js',
    'sidepanel.html',
    'sidepanel.js',
  ];
  const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(dir, file)));
  if (missing.length > 0) {
    throw new Error(`Browser extension build is incomplete: ${missing.join(', ')}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (manifest?.manifest_version !== 3) {
    throw new Error('Browser extension manifest must use Manifest V3');
  }
}

function copyDirectory(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

if (!fs.existsSync(pluginDir)) {
  throw new Error(`[prepare-plugin-runtime] Plugin source not found: ${pluginDir}`);
}

runPluginCommand(['install', '--frozen-lockfile'], { nonInteractive: true });
runPluginCommand(['build']);
runPluginCommand(['verify']);
assertBuiltExtension(sourceDir);
copyDirectory(sourceDir, targetDir);
console.log(`[prepare-plugin-runtime] synced browser extension -> ${targetDir}`);
