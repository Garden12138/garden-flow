const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('esbuild');

const BROWSER_EXTENSION_ORIGIN = 'chrome-extension://dhfphfekcjahljnefpdjoidehnhhoeie/';

function verifyNativeMessagingHandshake(electronPath, bundledEntry, stateRoot) {
    const encodeMessage = (message) => {
        const payload = Buffer.from(JSON.stringify(message), 'utf8');
        const header = Buffer.allocUnsafe(4);
        header.writeUInt32LE(payload.length, 0);
        return Buffer.concat([header, payload]);
    };
    const result = spawnSync(electronPath, [bundledEntry, BROWSER_EXTENSION_ORIGIN], {
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            GARDENFLOW_BROWSER_CONTROL_STATE_DIR: stateRoot,
            GARDENFLOW_NATIVE_HOST_NODE_MODE: '1',
        },
        input: Buffer.concat([
            encodeMessage({ jsonrpc: '2.0', id: 'build-smoke-test', method: 'ping' }),
            encodeMessage({
                jsonrpc: '2.0',
                id: 'product-method-smoke-test',
                method: 'assets.ingestProduct',
                params: { operationId: 'build-smoke-test', payload: {} },
            }),
        ]),
        timeout: 10_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`Unix Native Host smoke test exited with code ${result.status}: ${String(result.stderr || '')}`);
    }
    if (!result.stdout || result.stdout.length < 4) {
        throw new Error('Unix Native Host smoke test did not return a framed response');
    }
    const responses = [];
    for (let offset = 0; offset + 4 <= result.stdout.length;) {
        const frameLength = result.stdout.readUInt32LE(offset);
        if (offset + frameLength + 4 > result.stdout.length) break;
        responses.push(JSON.parse(result.stdout.subarray(offset + 4, offset + frameLength + 4).toString('utf8')));
        offset += frameLength + 4;
    }
    const handshake = responses.find((response) => response?.id === 'build-smoke-test');
    if (handshake?.result?.ok !== true || !handshake.result.capabilities?.includes('assets.ingestProduct')) {
        throw new Error('Unix Native Host smoke test returned an invalid response');
    }
    const productMethod = responses.find((response) => response?.id === 'product-method-smoke-test');
    if (productMethod?.error?.data?.code === 'METHOD_NOT_ALLOWED' || productMethod?.error?.data?.code !== 'APP_NOT_RUNNING') {
        throw new Error('Unix Native Host does not forward assets.ingestProduct');
    }
}

async function main() {
    if (process.platform === 'win32') {
        console.log('[native-host] Unix runtime skipped on Windows');
        return;
    }

    const desktopRoot = path.resolve(__dirname, '..');
    const outputRoot = path.join(desktopRoot, '.native-host-runtime', 'unix');
    const bundledEntry = path.join(outputRoot, 'gardenflow-browser-native-host.cjs');
    const smokeStateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gardenflow-native-host-build-'));

    fs.rmSync(outputRoot, { recursive: true, force: true });
    fs.mkdirSync(outputRoot, { recursive: true });

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

    try {
        verifyNativeMessagingHandshake(require('electron'), bundledEntry, smokeStateRoot);
    } finally {
        fs.rmSync(smokeStateRoot, { recursive: true, force: true });
    }
    console.log(`[native-host] Prepared ${bundledEntry}`);
}

main().catch((error) => {
    console.error('[native-host] Build failed:', error);
    process.exitCode = 1;
});
