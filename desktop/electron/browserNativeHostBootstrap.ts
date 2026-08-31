import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import { UNIX_BROWSER_NATIVE_HOST_RELATIVE_PATH } from './core/browserNativeHostInstaller.ts';

function packagedRuntimePath(): string {
    return path.join(process.resourcesPath, UNIX_BROWSER_NATIVE_HOST_RELATIVE_PATH);
}

function developmentRuntimePath(): string {
    return path.join(app.getAppPath(), '.native-host-runtime', 'unix', 'gardenflow-browser-native-host.cjs');
}

export function handoffBrowserNativeHostToNodeRuntime(): boolean {
    if (process.platform === 'win32' || process.env.GARDENFLOW_NATIVE_HOST_NODE_MODE === '1') {
        return false;
    }

    const runtimePath = app.isPackaged ? packagedRuntimePath() : developmentRuntimePath();
    if (!fs.existsSync(runtimePath)) {
        return false;
    }

    const child = spawn(process.execPath, [runtimePath, ...process.argv.slice(1)], {
        detached: true,
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            GARDENFLOW_NATIVE_HOST_NODE_MODE: '1',
        },
        stdio: ['inherit', 'inherit', 'ignore'],
    });
    if (!child.pid) {
        return false;
    }
    child.unref();
    app.exit(0);
    return true;
}
