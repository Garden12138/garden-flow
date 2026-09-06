import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

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
