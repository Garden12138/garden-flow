import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

async function localSignHarness(failAt = 0) {
    const calls: Array<{ command: string; args: string[] }> = [];
    const source = await fs.readFile(path.join(repositoryRoot, 'desktop/scripts/after-pack-local-sign.cjs'), 'utf8');
    const exports: Record<string, any> = {}; const realRequire = createRequire(import.meta.url);
    vm.runInNewContext(source, { exports, process: { platform: 'darwin', stdout: { write() {} } }, require: (id: string) => id === 'node:child_process' ? {
        execFile: (command: string, args: string[], callback: (error?: Error) => void) => { calls.push({ command, args: [...args] }); callback(calls.length === failAt ? new Error('synthetic signing failure') : undefined); },
    } : realRequire(id) });
    const context = (platform: string, identity: string | null) => ({ electronPlatformName: platform, appOutDir: '/tmp/local package', packager: { platformSpecificBuildOptions: { identity }, appInfo: { productFilename: 'GardenFlow' } } });
    return { sign: exports.default, calls, context };
}

test('local macOS signing never selects a certificate or runs for another platform, and preserves literal paths', async () => {
    const packageConfig = await readDesktopPackage(); assert.equal(packageConfig.build.afterPack, 'scripts/after-pack-local-sign.cjs');
    const h = await localSignHarness();
    await h.sign(h.context('win32', null)); await h.sign(h.context('linux', null)); await h.sign(h.context('darwin', 'Developer ID Application: explicit'));
    assert.equal(h.calls.length, 0);
    await h.sign(h.context('darwin', null)); assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0].command, 'codesign'); assert.equal(h.calls[0].args[h.calls[0].args.indexOf('--sign') + 1], '-');
    assert.equal(h.calls[0].args.at(-1), '/tmp/local package/GardenFlow.app'); assert.ok(h.calls[1].args.includes('--verify')); assert.ok(h.calls[1].args.includes('--strict'));
});

test('signing or verification errors fail packaging instead of emitting a successful local installer', async () => {
    for (const failAt of [1, 2]) { const h = await localSignHarness(failAt); await assert.rejects(h.sign(h.context('darwin', null)), /signing failure/); assert.equal(h.calls.length, failAt); }
    const h = await localSignHarness(); const context = h.context('darwin', null); context.packager.appInfo.productFilename = '../existing-app';
    await assert.rejects(h.sign(context), /application name/); assert.equal(h.calls.length, 0);
});

async function readDesktopPackage(): Promise<Record<string, any>> {
    return JSON.parse(await fs.readFile(path.join(repositoryRoot, 'desktop/package.json'), 'utf8'));
}

test('desktop release packaging exposes one native command per supported target', async () => {
    const packageConfig = await readDesktopPackage();
    const scripts = packageConfig.scripts as Record<string, string>;

    assert.match(scripts['build:release:mac:arm64'], /prepare:unix-native-host/);
    assert.match(scripts['build:release:mac:arm64'], /electron-builder --mac dmg --arm64/);
    assert.match(scripts['build:release:mac:arm64'], /mac\.identity=null/);
    assert.match(scripts['build:release:mac:x64'], /electron-builder --mac dmg --x64/);
    assert.match(scripts['build:release:win:x64'], /prepare:windows-native-host/);
    assert.match(scripts['build:release:win:x64'], /electron-builder --win nsis --x64/);
    assert.match(scripts['build:release:linux:x64'], /prepare:unix-native-host/);
    assert.match(scripts['build:release:linux:x64'], /electron-builder --linux AppImage deb --x64/);
    for (const command of [
        scripts['build:release:mac:arm64'],
        scripts['build:release:mac:x64'],
        scripts['build:release:win:x64'],
        scripts['build:release:linux:x64'],
    ]) {
        assert.match(command, /--publish never/);
    }

    assert.equal(packageConfig.build.artifactName, 'GardenFlow-${version}-${arch}.${ext}');
    assert.equal(packageConfig.build.linux.artifactName, 'GardenFlow-${version}-x64.${ext}');
    assert.match(packageConfig.build.linux.maintainer, /<[^<>\s]+@[^<>\s]+>/);
    assert.deepEqual(
        packageConfig.build.linux.target,
        [
            { target: 'AppImage', arch: ['x64'] },
            { target: 'deb', arch: ['x64'] },
        ],
    );
});

test('desktop distributions include project licensing and vendored attribution', async () => {
    const packageConfig = await readDesktopPackage();
    const resources = packageConfig.build.extraResources as Array<{ from?: string; to?: string }>;

    assert.ok(resources.some((item) => item.from === '../LICENSE' && item.to === 'LICENSE.txt'));
    assert.ok(resources.some((item) => (
        item.from === 'src/vendor/freecut/ATTRIBUTION.md'
        && item.to === 'ATTRIBUTION-FreeCut.md'
    )));
    assert.ok(resources.some((item) => (
        item.from === '.remotion-render-bundle'
        && item.to === 'remotion-render-bundle'
    )));
    assert.ok(resources.some((item) => (
        item.from === '.remotion-compositor'
        && item.to === 'remotion-compositor'
    )));
    assert.match(packageConfig.scripts.dev, /prepare:remotion-bundle/);
    for (const [name, command] of Object.entries(packageConfig.scripts as Record<string, string>)) {
        if (name === 'build' || name.startsWith('build:')) {
            assert.match(command, /prepare:remotion-bundle/, `${name} must include the render bundle`);
        }
    }
});

test('release workflow gates stable tags and publishes the complete installer set', async () => {
    const workflow = await fs.readFile(path.join(repositoryRoot, '.github/workflows/release.yml'), 'utf8');
    const ciWorkflow = await fs.readFile(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');

    assert.match(workflow, /tags:\s*\n\s+- 'v\*'/);
    assert.match(workflow, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
    assert.match(workflow, /desktop\/package\.json/);
    assert.match(workflow, /merge-base --is-ancestor/);
    assert.match(workflow, /runner: macos-15\s/);
    assert.match(workflow, /runner: macos-15-intel/);
    assert.match(workflow, /runner: windows-latest/);
    assert.match(workflow, /runner: ubuntu-latest/);
    assert.match(workflow, /GardenFlow-\$\{version\}-arm64\.dmg/);
    assert.match(workflow, /GardenFlow-\$\{version\}-x64\.dmg/);
    assert.match(workflow, /GardenFlow-\$\{version\}-x64\.exe/);
    assert.match(workflow, /GardenFlow-\$\{version\}-x64\.AppImage/);
    assert.match(workflow, /GardenFlow-\$\{version\}-x64\.deb/);
    assert.match(workflow, /SHA256SUMS\.txt/);
    assert.match(workflow, /uses: actions\/attest@v4/);
    assert.match(workflow, /contents: write/);
    assert.match(workflow, /id-token: write/);
    assert.match(workflow, /attestations: write/);
    assert.match(workflow, /gh release create[\s\S]*--draft[\s\S]*--generate-notes/);
    assert.match(workflow, /gh release edit[\s\S]*--draft=false --latest/);
    assert.match(ciWorkflow, /push:\s*\n\s+branches:\s*\n\s+- '\*\*'/);
    assert.doesNotMatch(workflow, /uses: pnpm\/action-setup@v4\s+with:\s+version:/);
    assert.doesNotMatch(ciWorkflow, /uses: pnpm\/action-setup@v4\s+with:\s+version:/);
});
