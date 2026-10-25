const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);

// identity:null intentionally disables Developer ID signing. Seal that local
// macOS bundle ad hoc after its resources have been assembled; Electron's old
// resource signature is no longer valid after packaging changes Info.plist.
exports.default = async function signLocalMacBundle(context) {
    if (context.electronPlatformName !== 'darwin' || context.packager.platformSpecificBuildOptions.identity !== null) return;
    if (process.platform !== 'darwin') throw new Error('Local macOS ad-hoc signing requires codesign on macOS.');
    const name = context.packager.appInfo.productFilename;
    if (typeof name !== 'string' || !name || path.basename(name) !== name) throw new Error('Invalid packaged macOS application name.');
    const bundle = path.join(context.appOutDir, name + '.app');
    await run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', bundle]);
    await run('codesign', ['--verify', '--deep', '--strict', bundle]);
    process.stdout.write('Local macOS ad-hoc signature verified (no Developer ID or notarization).\n');
};
