import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    BROWSER_EXTENSION_SYNC_META_FILE,
    computeBrowserExtensionFingerprint,
    syncBrowserExtensionDirectory,
} from '../electron/core/browserExtensionExport.ts';

const PUBLIC_KEY = 'gardenflow-test-public-key';

async function writeExtension(
    directory: string,
    input: { key?: string; name: string; marker: string },
): Promise<void> {
    await fs.mkdir(path.join(directory, 'icons'), { recursive: true });
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
        background: { service_worker: 'background.js' },
        key: input.key ?? PUBLIC_KEY,
        manifest_version: 3,
        name: input.name,
        side_panel: { default_path: 'sidepanel.html' },
        version: '1.0.0',
    }), 'utf8');
    await fs.writeFile(path.join(directory, 'background.js'), `globalThis.marker = '${input.marker}';\n`, 'utf8');
    await fs.writeFile(path.join(directory, 'sidepanel.html'), `<title>${input.name}</title>\n`, 'utf8');
    await fs.writeFile(path.join(directory, 'icons', 'icon16.png'), Buffer.from(input.marker));
}

test('browser extension fingerprint covers assets and ignores GardenFlow sync metadata', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-extension-fingerprint-'));
    try {
        await writeExtension(temporaryRoot, { name: 'GardenFlow', marker: 'first' });
        const initial = await computeBrowserExtensionFingerprint(temporaryRoot);
        await fs.writeFile(path.join(temporaryRoot, BROWSER_EXTENSION_SYNC_META_FILE), '{"ignored":true}', 'utf8');
        assert.equal(await computeBrowserExtensionFingerprint(temporaryRoot), initial);
        await fs.writeFile(path.join(temporaryRoot, 'icons', 'icon16.png'), Buffer.from('second'));
        assert.notEqual(await computeBrowserExtensionFingerprint(temporaryRoot), initial);
    } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
});

test('legacy unpacked extension is backed up and atomically refreshed without changing its key', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-extension-sync-'));
    const sourceDir = path.join(temporaryRoot, 'source');
    const targetDir = path.join(temporaryRoot, 'redbox-capture');
    const backupDir = path.join(temporaryRoot, 'backup', 'redbox-capture-before-gardenflow');
    try {
        await writeExtension(sourceDir, { name: 'GardenFlow', marker: 'new' });
        await writeExtension(targetDir, { name: 'Bojin', marker: 'old' });
        const first = await syncBrowserExtensionDirectory({
            appVersion: '2.5.0',
            backupDir,
            requireMatchingExistingKey: true,
            sourceDir,
            sourceLabel: 'browser-extension',
            targetDir,
        });
        assert.equal(first.updated, true);
        assert.equal(first.backupCreated, true);
        assert.equal(JSON.parse(await fs.readFile(path.join(targetDir, 'manifest.json'), 'utf8')).name, 'GardenFlow');
        assert.equal(JSON.parse(await fs.readFile(path.join(backupDir, 'manifest.json'), 'utf8')).name, 'Bojin');
        assert.equal(await fs.readFile(path.join(targetDir, 'icons', 'icon16.png'), 'utf8'), 'new');

        const second = await syncBrowserExtensionDirectory({
            appVersion: '2.5.0',
            backupDir,
            bundleFingerprint: first.bundleFingerprint,
            requireMatchingExistingKey: true,
            sourceDir,
            sourceLabel: 'browser-extension',
            targetDir,
        });
        assert.equal(second.updated, false);
        assert.equal(second.backupCreated, false);
    } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
});

test('legacy extension with another public key is never overwritten', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-extension-key-'));
    const sourceDir = path.join(temporaryRoot, 'source');
    const targetDir = path.join(temporaryRoot, 'legacy');
    try {
        await writeExtension(sourceDir, { name: 'GardenFlow', marker: 'new' });
        await writeExtension(targetDir, { key: 'another-extension-key', name: 'Unrelated', marker: 'old' });
        await assert.rejects(
            syncBrowserExtensionDirectory({
                appVersion: '2.5.0',
                requireMatchingExistingKey: true,
                sourceDir,
                sourceLabel: 'browser-extension',
                targetDir,
            }),
            /different public key/,
        );
        assert.equal(JSON.parse(await fs.readFile(path.join(targetDir, 'manifest.json'), 'utf8')).name, 'Unrelated');
        assert.equal(await fs.readFile(path.join(targetDir, 'icons', 'icon16.png'), 'utf8'), 'old');
    } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
});
