const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const esbuild = require('esbuild');
const { inject } = require('postject');

const SEA_RESOURCE_NAME = 'NODE_SEA_BLOB';
const SEA_SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const BROWSER_EXTENSION_ORIGIN = 'chrome-extension://dhfphfekcjahljnefpdjoidehnhhoeie/';

function verifyNativeMessagingHandshake(executablePath) {
    const payload = Buffer.from(JSON.stringify({
        jsonrpc: '2.0',
        id: 'build-smoke-test',
        method: 'ping',
    }), 'utf8');
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(payload.length, 0);
    const result = spawnSync(executablePath, [BROWSER_EXTENSION_ORIGIN], {
        input: Buffer.concat([header, payload]),
        timeout: 10_000,
        windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`Native Host smoke test exited with code ${result.status}: ${String(result.stderr || '')}`);
    }
    if (!result.stdout || result.stdout.length < 4) {
        throw new Error('Native Host smoke test did not return a framed response');
    }
    const frameLength = result.stdout.readUInt32LE(0);
    const response = JSON.parse(result.stdout.subarray(4, frameLength + 4).toString('utf8'));
    if (response?.id !== 'build-smoke-test' || response?.result?.ok !== true) {
        throw new Error('Native Host smoke test returned an invalid response');
    }
}

async function main() {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
        throw new Error('Windows Native Host 必须在 Windows x64 上使用目标 Node.js 构建');
    }

    const desktopRoot = path.resolve(__dirname, '..');
    const outputRoot = path.join(desktopRoot, '.native-host-runtime', 'win32-x64');
    const workRoot = path.join(outputRoot, 'build');
    const bundledEntry = path.join(workRoot, 'browser-native-host.cjs');
    const seaConfigPath = path.join(workRoot, 'sea-config.json');
    const seaBlobPath = path.join(workRoot, 'browser-native-host.blob');
    const executablePath = path.join(outputRoot, 'gardenflow-browser-native-host.exe');

    fs.rmSync(outputRoot, { recursive: true, force: true });
    fs.mkdirSync(workRoot, { recursive: true });

    await esbuild.build({
        entryPoints: [path.join(desktopRoot, 'electron', 'browserNativeHostEntry.ts')],
        outfile: bundledEntry,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node22',
        sourcemap: false,
        minify: true,
        legalComments: 'none',
    });

    fs.writeFileSync(seaConfigPath, `${JSON.stringify({
        main: bundledEntry,
        output: seaBlobPath,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
    }, null, 2)}\n`, 'utf8');

    execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], {
        cwd: desktopRoot,
        stdio: 'inherit',
        windowsHide: true,
    });
    fs.copyFileSync(process.execPath, executablePath);
    await inject(executablePath, SEA_RESOURCE_NAME, fs.readFileSync(seaBlobPath), {
        sentinelFuse: SEA_SENTINEL_FUSE,
    });

    const stat = fs.statSync(executablePath);
    if (!stat.isFile() || stat.size < 1_000_000) {
        throw new Error(`Windows Native Host 构建产物无效: ${executablePath}`);
    }
    verifyNativeMessagingHandshake(executablePath);
    console.log(`[native-host] Prepared ${executablePath}`);
}

main().catch((error) => {
    console.error('[native-host] Build failed:', error);
    process.exitCode = 1;
});
