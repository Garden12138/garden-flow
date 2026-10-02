const fs = require('node:fs/promises');
const path = require('node:path');
const { bundle } = require('@remotion/bundler');
const { prepareRemotionRendererRuntime } = require('./prepare-remotion-renderer-runtime.cjs');

const desktopRoot = path.resolve(__dirname, '..');
const outputDirectory = path.join(desktopRoot, '.remotion-render-bundle');
const compositorOutputDirectory = path.join(desktopRoot, '.remotion-compositor');

async function prepareCompositor() {
    const packageName = process.platform === 'win32'
        ? '@remotion/compositor-win32-x64-msvc'
        : `@remotion/compositor-${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : ''}`;
    const rendererEntry = require.resolve('@remotion/renderer');
    const compositorEntry = require.resolve(packageName, { paths: [path.dirname(rendererEntry)] });
    const targetDirectory = path.join(compositorOutputDirectory, `${process.platform}-${process.arch}`);
    await fs.rm(targetDirectory, { recursive: true, force: true });
    await fs.cp(path.dirname(compositorEntry), targetDirectory, { recursive: true });
    await fs.access(path.join(targetDirectory, process.platform === 'win32' ? 'remotion.exe' : 'remotion'));
    process.stdout.write(`Remotion compositor ready: ${targetDirectory}\n`);
}

async function main() {
    const entryPoint = path.join(desktopRoot, 'src', 'remotion', 'index.ts');
    await bundle({
        entryPoint,
        rootDir: desktopRoot,
        publicDir: path.join(desktopRoot, 'public'),
        outDir: outputDirectory,
        ignoreRegisterRootWarning: true,
    });
    await fs.access(path.join(outputDirectory, 'index.html'));
    await prepareCompositor();
    await prepareRemotionRendererRuntime(path.join(desktopRoot, '.remotion-renderer-runtime'));
    process.stdout.write(`Remotion render bundle ready: ${outputDirectory}\n`);
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
});
