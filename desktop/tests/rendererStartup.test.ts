import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { normalizeOptionalTimeoutMs } from '../src/bridge/timeout.ts';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('guarded IPC leaves timeout disabled unless a positive timeout is configured', () => {
    assert.equal(normalizeOptionalTimeoutMs(undefined), 0);
    assert.equal(normalizeOptionalTimeoutMs(null), 0);
    assert.equal(normalizeOptionalTimeoutMs(0), 0);
    assert.equal(normalizeOptionalTimeoutMs(-100), 0);
    assert.equal(normalizeOptionalTimeoutMs(Number.NaN), 0);
    assert.equal(normalizeOptionalTimeoutMs(0.25), 1);
    assert.equal(normalizeOptionalTimeoutMs(2500), 2500);
});

test('desktop window stays hidden until the renderer commits and forces an initial repaint', async () => {
    const [appMain, rendererMain, bridgeCore, ipcRenderer, nativeHostMain, storageBootstrap, localAsset, rendererCompatibility] = await Promise.all([
        fs.readFile(path.join(repositoryRoot, 'desktop/electron/appMain.ts'), 'utf8'),
        fs.readFile(path.join(repositoryRoot, 'desktop/src/main.tsx'), 'utf8'),
        fs.readFile(path.join(repositoryRoot, 'desktop/src/bridge/core.ts'), 'utf8'),
        fs.readFile(path.join(repositoryRoot, 'desktop/src/bridge/ipcRenderer.ts'), 'utf8'),
        fs.readFile(path.join(repositoryRoot, 'desktop/electron/main.ts'), 'utf8'),
        fs.readFile(path.join(repositoryRoot, 'desktop/src/compat/storageBootstrap.ts'), 'utf8'),
        fs.readFile(path.join(repositoryRoot, 'desktop/shared/localAsset.ts'), 'utf8'),
        fs.readFile(path.join(repositoryRoot, 'desktop/shared/brandCompatibility.mjs'), 'utf8'),
    ]);

    assert.match(appMain, /show:\s*false/);
    assert.match(appMain, /ipcMain\.on\('renderer:ready'/);
    assert.match(appMain, /webContents\.on\('console-message'/);
    assert.match(appMain, /targetWindow\.webContents\.invalidate\(\)/);
    assert.match(appMain, /if \(!appSingleInstanceLock\) \{\s*return;\s*\}/);
    assert.match(appMain, /markStartupPhase\('main-window-created'\);\s*setTimeout\(\(\) => \{\s*void warmupBrowserPluginPrepared\(\);/);
    assert.match(rendererMain, /function RendererReadySignal\(\)/);
    assert.match(rendererMain, /window\.ipcRenderer\.send\('renderer:ready'/);
    assert.doesNotMatch(bridgeCore, /Math\.max\(1, Number\(options\?\.timeoutMs \|\| 0\)\)/);
    assert.doesNotMatch(ipcRenderer, /Math\.max\(1, Number\(options\?\.timeoutMs \|\| 0\)\)/);
    assert.match(nativeHostMain, /handoffBrowserNativeHostToNodeRuntime/);
    assert.match(storageBootstrap, /brandCompatibility\.mjs/);
    assert.doesNotMatch(storageBootstrap, /brandCompatibility\.cjs/);
    assert.match(localAsset, /brandCompatibility\.mjs/);
    assert.doesNotMatch(localAsset, /brandCompatibility\.cjs/);
    assert.match(rendererCompatibility, /export default compatibility/);
    assert.doesNotMatch(rendererCompatibility, /module\.exports|require\(/);
});
