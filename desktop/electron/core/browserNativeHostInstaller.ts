import compatibility from '../../shared/brandCompatibility.cjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
    BROWSER_CAPTURE_EXTENSION_ORIGIN,
    BROWSER_CAPTURE_NATIVE_HOST_NAME,
    browserCaptureStateRoot,
} from './browserCaptureProtocol.ts';
import { XHS_PUBLISHER_EXTENSION_ORIGIN } from '../../shared/xhsPublisher.ts';

const execFileAsync = promisify(execFile);

type BrowserTarget = {
    id: string;
    label: string;
    profileRoot: string;
    manifestPath: string;
    registryKey?: string;
};

export type BrowserNativeHostTargetStatus = {
    id: string;
    label: string;
    manifestPath: string;
    installed: boolean;
    stale: boolean;
    error?: string;
};

export type BrowserNativeHostStatus = {
    supported: boolean;
    installedTargets: BrowserNativeHostTargetStatus[];
    staleTargets: BrowserNativeHostTargetStatus[];
    missingTargets: BrowserNativeHostTargetStatus[];
    failures: BrowserNativeHostTargetStatus[];
};

export function browserNativeHostNeedsInstall(status: BrowserNativeHostStatus): boolean {
    return status.supported && (
        status.staleTargets.length > 0
        || status.missingTargets.length > 0
        || status.failures.length > 0
    );
}

export const WINDOWS_BROWSER_NATIVE_HOST_RELATIVE_PATH = path.join(
    'native-host',
    'gardenflow-browser-native-host.exe',
);
export const UNIX_BROWSER_NATIVE_HOST_RELATIVE_PATH = path.join(
    'native-host',
    'gardenflow-browser-native-host.cjs',
);

export type BrowserNativeHostInstallOptions = {
    appExecutable: string;
    appPath: string;
    isPackaged: boolean;
    resourcesPath?: string;
};

function targets(): BrowserTarget[] {
    if (process.platform === 'darwin') {
        const root = path.join(os.homedir(), 'Library/Application Support');
        return [
            unixTarget('chrome', 'Google Chrome', path.join(root, 'Google/Chrome')),
            unixTarget('edge', 'Microsoft Edge', path.join(root, 'Microsoft Edge')),
            unixTarget('brave', 'Brave Browser', path.join(root, 'BraveSoftware/Brave-Browser')),
        ];
    }
    if (process.platform === 'win32') {
        const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local');
        const manifestRoot = path.join(browserCaptureStateRoot(), 'manifests');
        return [
            windowsTarget('chrome', 'Google Chrome', path.join(local, 'Google/Chrome/User Data'), manifestRoot, 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts'),
            windowsTarget('edge', 'Microsoft Edge', path.join(local, 'Microsoft/Edge/User Data'), manifestRoot, 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts'),
            windowsTarget('brave', 'Brave Browser', path.join(local, 'BraveSoftware/Brave-Browser/User Data'), manifestRoot, 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts'),
        ];
    }
    const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return [
        unixTarget('chrome', 'Google Chrome', path.join(config, 'google-chrome')),
        unixTarget('edge', 'Microsoft Edge', path.join(config, 'microsoft-edge')),
        unixTarget('brave', 'Brave Browser', path.join(config, 'BraveSoftware/Brave-Browser')),
    ];
}

function unixTarget(id: string, label: string, profileRoot: string): BrowserTarget {
    return {
        id,
        label,
        profileRoot,
        manifestPath: path.join(profileRoot, 'NativeMessagingHosts', `${BROWSER_CAPTURE_NATIVE_HOST_NAME}.json`),
    };
}

function windowsTarget(id: string, label: string, profileRoot: string, manifestRoot: string, registryRoot: string): BrowserTarget {
    return {
        id,
        label,
        profileRoot,
        manifestPath: path.join(manifestRoot, `${id}.${BROWSER_CAPTURE_NATIVE_HOST_NAME}.json`),
        registryKey: `${registryRoot}\\${BROWSER_CAPTURE_NATIVE_HOST_NAME}`,
    };
}

function shellQuote(value: string): string {
    return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function resolvePackagedBrowserNativeHostExecutable(
    options: Pick<BrowserNativeHostInstallOptions, 'appExecutable' | 'resourcesPath'>,
    platform = process.platform,
): string {
    if (platform !== 'win32') {
        return path.resolve(options.appExecutable);
    }
    const resourcesPath = String(options.resourcesPath || '').trim();
    if (!resourcesPath) {
        throw new Error('Windows Native Host 缺少 resourcesPath，无法完成注册');
    }
    return path.win32.resolve(resourcesPath, WINDOWS_BROWSER_NATIVE_HOST_RELATIVE_PATH);
}

export function resolvePackagedUnixBrowserNativeHostRuntime(
    options: Pick<BrowserNativeHostInstallOptions, 'resourcesPath'>,
): string {
    const resourcesPath = String(options.resourcesPath || '').trim();
    if (!resourcesPath) {
        throw new Error('Unix Native Host 缺少 resourcesPath，无法完成注册');
    }
    return path.resolve(resourcesPath, UNIX_BROWSER_NATIVE_HOST_RELATIVE_PATH);
}

export function buildUnixBrowserNativeHostLauncherScript(appExecutable: string, runtimePath: string): string {
    return [
        '#!/bin/sh',
        '# Generated by GardenFlow. Runs Native Messaging without claiming the desktop app identity.',
        'export ELECTRON_RUN_AS_NODE=1',
        'export GARDENFLOW_NATIVE_HOST_NODE_MODE=1',
        `exec ${shellQuote(path.resolve(appExecutable))} ${shellQuote(path.resolve(runtimePath))} "$@"`,
        '',
    ].join('\n');
}

async function resolveHostExecutable(options: BrowserNativeHostInstallOptions): Promise<string> {
    if (options.isPackaged) {
        if (process.platform === 'win32') {
            const hostPath = resolvePackagedBrowserNativeHostExecutable(options);
            try {
                await fs.access(hostPath);
            } catch {
                throw new Error(`Windows Native Host 文件不存在: ${hostPath}`);
            }
            return hostPath;
        }
        const runtimePath = resolvePackagedUnixBrowserNativeHostRuntime(options);
        try {
            await fs.access(runtimePath);
        } catch {
            throw new Error(`Unix Native Host 文件不存在: ${runtimePath}`);
        }
        const launcherPath = path.join(browserCaptureStateRoot(), `${BROWSER_CAPTURE_NATIVE_HOST_NAME}.launcher.sh`);
        await fs.mkdir(path.dirname(launcherPath), { recursive: true, mode: 0o700 });
        await fs.writeFile(
            launcherPath,
            buildUnixBrowserNativeHostLauncherScript(options.appExecutable, runtimePath),
            { encoding: 'utf8', mode: 0o700 },
        );
        await fs.chmod(launcherPath, 0o700);
        return launcherPath;
    }
    if (process.platform === 'win32') {
        throw new Error('Windows 开发模式不能注册 Native Host，请使用打包后的 GardenFlow 验证');
    }
    const launcherPath = path.join(browserCaptureStateRoot(), `${BROWSER_CAPTURE_NATIVE_HOST_NAME}.dev-launcher.sh`);
    const script = [
        '#!/bin/sh',
        '# Generated by GardenFlow for local browser-extension development.',
        `exec ${shellQuote(path.resolve(options.appExecutable))} ${shellQuote(path.resolve(options.appPath))} "$@"`,
        '',
    ].join('\n');
    await fs.mkdir(path.dirname(launcherPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(launcherPath, script, { encoding: 'utf8', mode: 0o700 });
    await fs.chmod(launcherPath, 0o700);
    return launcherPath;
}

function manifest(hostPath: string, hostName = BROWSER_CAPTURE_NATIVE_HOST_NAME) {
    return {
        name: hostName,
        description: 'GardenFlow local content capture bridge',
        path: hostPath,
        type: 'stdio',
        allowed_origins: [BROWSER_CAPTURE_EXTENSION_ORIGIN, XHS_PUBLISHER_EXTENSION_ORIGIN],
    };
}

function manifestMatches(value: unknown, hostPath: string): boolean {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return source.name === BROWSER_CAPTURE_NATIVE_HOST_NAME
        && path.resolve(String(source.path || '')) === path.resolve(hostPath)
        && Array.isArray(source.allowed_origins)
        && source.allowed_origins.length === 2
        && source.allowed_origins.includes(BROWSER_CAPTURE_EXTENSION_ORIGIN)
        && source.allowed_origins.includes(XHS_PUBLISHER_EXTENSION_ORIGIN);
}

async function inspectTarget(target: BrowserTarget, hostPath: string): Promise<BrowserNativeHostTargetStatus> {
    try {
        const parsed = JSON.parse(await fs.readFile(target.manifestPath, 'utf8'));
        let stale = !manifestMatches(parsed, hostPath);
        if (!stale && target.registryKey) {
            try {
                const { stdout } = await execFileAsync('reg.exe', ['QUERY', target.registryKey, '/ve'], { windowsHide: true });
                stale = !String(stdout || '').toLowerCase().includes(target.manifestPath.toLowerCase());
            } catch {
                stale = true;
            }
        }
        return {
            id: target.id,
            label: target.label,
            manifestPath: target.manifestPath,
            installed: !stale,
            stale,
        };
    } catch (error) {
        const code = String((error as { code?: unknown })?.code || '');
        if (code !== 'ENOENT') {
            return {
                id: target.id,
                label: target.label,
                manifestPath: target.manifestPath,
                installed: false,
                stale: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
        return {
            id: target.id,
            label: target.label,
            manifestPath: target.manifestPath,
            installed: false,
            stale: false,
        };
    }
}

function selectedTargets(): BrowserTarget[] {
    return targets();
}

export async function inspectBrowserNativeHost(options: BrowserNativeHostInstallOptions): Promise<BrowserNativeHostStatus> {
    if (!['darwin', 'win32', 'linux'].includes(process.platform)) {
        return { supported: false, installedTargets: [], staleTargets: [], missingTargets: [], failures: [] };
    }
    let hostPath: string;
    try {
        hostPath = await resolveHostExecutable(options);
    } catch (error) {
        return {
            supported: false,
            installedTargets: [],
            staleTargets: [],
            missingTargets: [],
            failures: [{
                id: 'runtime',
                label: 'Native Host runtime',
                manifestPath: '',
                installed: false,
                stale: false,
                error: error instanceof Error ? error.message : String(error),
            }],
        };
    }
    const statuses = await Promise.all(selectedTargets().map((target) => inspectTarget(target, hostPath)));
    return {
        supported: true,
        installedTargets: statuses.filter((item) => item.installed),
        staleTargets: statuses.filter((item) => item.stale),
        missingTargets: statuses.filter((item) => !item.installed && !item.stale && !item.error),
        failures: statuses.filter((item) => item.error),
    };
}

export async function installBrowserNativeHost(options: BrowserNativeHostInstallOptions): Promise<BrowserNativeHostStatus> {
    const hostPath = await resolveHostExecutable(options);
    const installedTargets: BrowserNativeHostTargetStatus[] = [];
    const failures: BrowserNativeHostTargetStatus[] = [];
    for (const target of selectedTargets()) {
        try {
            await fs.mkdir(path.dirname(target.manifestPath), { recursive: true });
            await fs.writeFile(target.manifestPath, `${JSON.stringify(manifest(hostPath), null, 2)}\n`, 'utf8');
            if (target.registryKey) {
                await execFileAsync('reg.exe', [
                    'ADD',
                    target.registryKey,
                    '/ve',
                    '/t',
                    'REG_SZ',
                    '/d',
                    target.manifestPath,
                    '/f',
                ], { windowsHide: true });
            }
            const legacyPath = target.manifestPath.replace(BROWSER_CAPTURE_NATIVE_HOST_NAME, compatibility.identity.legacy.nativeHost);
            await fs.writeFile(legacyPath, JSON.stringify(manifest(hostPath, compatibility.identity.legacy.nativeHost), null, 2) + '\n', 'utf8');
            if (target.registryKey) await execFileAsync('reg.exe', ['ADD', target.registryKey.replace(BROWSER_CAPTURE_NATIVE_HOST_NAME, compatibility.identity.legacy.nativeHost), '/ve', '/t', 'REG_SZ', '/d', legacyPath, '/f'], { windowsHide: true });
            installedTargets.push({
                id: target.id,
                label: target.label,
                manifestPath: target.manifestPath,
                installed: true,
                stale: false,
            });
        } catch (error) {
            failures.push({
                id: target.id,
                label: target.label,
                manifestPath: target.manifestPath,
                installed: false,
                stale: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return {
        supported: true,
        installedTargets,
        staleTargets: [],
        missingTargets: [],
        failures,
    };
}
