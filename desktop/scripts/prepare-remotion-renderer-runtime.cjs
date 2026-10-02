const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');

function packageDirectory(packageName, requester) {
    try {
        return path.dirname(requester.resolve(`${packageName}/package.json`));
    } catch {
        let directory = path.dirname(requester.resolve(packageName));
        while (directory !== path.dirname(directory)) {
            try {
                const manifest = requester(path.join(directory, 'package.json'));
                if (manifest.name === packageName) return directory;
            } catch { /* Continue to the package root. */ }
            directory = path.dirname(directory);
        }
        throw new Error(`Cannot locate runtime package ${packageName}`);
    }
}

// Copy the resolved dependency tree, preserving nested versions without pnpm symlinks.
// electron-builder's dependency collector can otherwise omit renderer transitive deps.
async function prepareRemotionRendererRuntime(outputDirectory) {
    await fs.rm(outputDirectory, { recursive: true, force: true });
    const packages = [];
    async function copyPackage(packageName, requester, parentDirectory, ancestors) {
        const sourceDirectory = packageDirectory(packageName, requester);
        const manifest = JSON.parse(await fs.readFile(path.join(sourceDirectory, 'package.json'), 'utf8'));
        const key = `${manifest.name}@${manifest.version}`;
        if (ancestors.has(key)) return ancestors.get(key);
        const targetDirectory = path.join(parentDirectory, 'node_modules', packageName);
        await fs.cp(sourceDirectory, targetDirectory, {
            recursive: true,
            dereference: true,
            filter: (source) => !path.relative(sourceDirectory, source).split(path.sep).includes('node_modules'),
        });
        packages.push({ name: manifest.name, version: manifest.version });
        const nextAncestors = new Map(ancestors).set(key, targetDirectory);
        const sourceRequire = createRequire(path.join(sourceDirectory, 'package.json'));
        const dependencies = new Set([
            ...Object.keys(manifest.dependencies || {}),
            ...Object.keys(manifest.peerDependencies || {}).filter((name) => !manifest.peerDependenciesMeta?.[name]?.optional),
        ]);
        for (const dependency of dependencies) {
            await copyPackage(dependency, sourceRequire, targetDirectory, nextAncestors);
        }
        return targetDirectory;
    }
    const entryDirectory = await copyPackage('@remotion/renderer', require, outputDirectory, new Map());
    const entryPath = path.join(entryDirectory, 'dist', 'index.js');
    const renderer = createRequire(entryPath)(entryPath);
    if (typeof renderer.renderMedia !== 'function' || typeof renderer.selectComposition !== 'function') {
        throw new Error('Staged Remotion renderer cannot be loaded');
    }
    await fs.writeFile(path.join(outputDirectory, 'manifest.json'), JSON.stringify({ packages }, null, 2));
    return entryPath;
}

module.exports = { prepareRemotionRendererRuntime };

if (require.main === module) {
    const outputDirectory = path.resolve(__dirname, '..', '.remotion-renderer-runtime');
    prepareRemotionRendererRuntime(outputDirectory).then(() => {
        process.stdout.write(`Remotion renderer runtime ready: ${outputDirectory}\n`);
    }).catch((error) => {
        process.stderr.write(`${error.stack || error}\n`);
        process.exitCode = 1;
    });
}
