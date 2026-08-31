import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const BROWSER_EXTENSION_SYNC_META_FILE = '.gardenflow-plugin-meta.json';

export type BrowserExtensionManifestIdentity = {
    key: string;
    manifestVersion: number;
    name: string;
    version: string;
};

export type BrowserExtensionSyncOptions = {
    appVersion: string;
    backupDir?: string;
    bundleFingerprint?: string;
    force?: boolean;
    requireMatchingExistingKey?: boolean;
    sourceDir: string;
    sourceLabel: string;
    targetDir: string;
};

export type BrowserExtensionSyncResult = {
    backupCreated: boolean;
    bundleFingerprint: string;
    updated: boolean;
};

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function collectDirectoryEntries(rootDir: string, relativeDir = ''): Promise<string[]> {
    const absoluteDir = path.join(rootDir, relativeDir);
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const relativePath = path.join(relativeDir, entry.name);
        if (relativePath === BROWSER_EXTENSION_SYNC_META_FILE) continue;
        if (entry.isDirectory()) {
            result.push(...await collectDirectoryEntries(rootDir, relativePath));
            continue;
        }
        result.push(relativePath);
    }
    return result;
}

export async function computeBrowserExtensionFingerprint(extensionDir: string): Promise<string> {
    const resolvedDir = path.resolve(extensionDir);
    const stats = await fs.stat(resolvedDir);
    if (!stats.isDirectory()) {
        throw new Error(`Browser extension source is not a directory: ${resolvedDir}`);
    }
    const hash = createHash('sha256');
    const entries = await collectDirectoryEntries(resolvedDir);
    for (const relativePath of entries) {
        const absolutePath = path.join(resolvedDir, relativePath);
        const entryStats = await fs.lstat(absolutePath);
        const normalizedPath = relativePath.split(path.sep).join('/');
        hash.update(normalizedPath);
        hash.update('\0');
        if (entryStats.isSymbolicLink()) {
            hash.update('symlink\0');
            hash.update(await fs.readlink(absolutePath));
        } else if (entryStats.isFile()) {
            hash.update('file\0');
            hash.update(await fs.readFile(absolutePath));
        } else {
            throw new Error(`Unsupported browser extension entry: ${absolutePath}`);
        }
        hash.update('\0');
    }
    return hash.digest('hex');
}

export async function readBrowserExtensionManifestIdentity(
    extensionDir: string,
): Promise<BrowserExtensionManifestIdentity> {
    const manifestPath = path.join(extensionDir, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    return {
        key: String(manifest.key || '').trim(),
        manifestVersion: Number(manifest.manifest_version || 0),
        name: String(manifest.name || '').trim(),
        version: String(manifest.version || '').trim(),
    };
}

async function readInstalledFingerprint(targetDir: string): Promise<string> {
    try {
        const raw = await fs.readFile(path.join(targetDir, BROWSER_EXTENSION_SYNC_META_FILE), 'utf8');
        const metadata = JSON.parse(raw) as { bundleFingerprint?: unknown };
        return String(metadata.bundleFingerprint || '').trim();
    } catch {
        return '';
    }
}

async function createBackupOnce(sourceDir: string, backupDir: string): Promise<boolean> {
    if (await pathExists(backupDir)) return false;
    await fs.mkdir(path.dirname(backupDir), { recursive: true });
    const stagedBackup = `${backupDir}.incomplete-${process.pid}-${Date.now()}`;
    try {
        await fs.cp(sourceDir, stagedBackup, { recursive: true, errorOnExist: true, force: false });
        await fs.rename(stagedBackup, backupDir);
        return true;
    } finally {
        await fs.rm(stagedBackup, { recursive: true, force: true });
    }
}

export async function syncBrowserExtensionDirectory(
    options: BrowserExtensionSyncOptions,
): Promise<BrowserExtensionSyncResult> {
    const sourceDir = path.resolve(options.sourceDir);
    const targetDir = path.resolve(options.targetDir);
    if (sourceDir === targetDir) {
        throw new Error('Browser extension source and target directories must differ');
    }

    const sourceIdentity = await readBrowserExtensionManifestIdentity(sourceDir);
    if (sourceIdentity.manifestVersion !== 3 || !sourceIdentity.key) {
        throw new Error(`Bundled browser extension identity is invalid: ${sourceDir}`);
    }
    const targetExists = await pathExists(targetDir);
    if (targetExists && options.requireMatchingExistingKey) {
        const targetIdentity = await readBrowserExtensionManifestIdentity(targetDir);
        if (!targetIdentity.key || targetIdentity.key !== sourceIdentity.key) {
            throw new Error(`Refusing to replace browser extension with a different public key: ${targetDir}`);
        }
    }

    const bundleFingerprint = options.bundleFingerprint
        || await computeBrowserExtensionFingerprint(sourceDir);
    if (targetExists && !options.force) {
        const installedFingerprint = await readInstalledFingerprint(targetDir);
        if (installedFingerprint === bundleFingerprint) {
            return { backupCreated: false, bundleFingerprint, updated: false };
        }
    }

    let backupCreated = false;
    if (targetExists && options.backupDir) {
        backupCreated = await createBackupOnce(targetDir, path.resolve(options.backupDir));
    }

    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    const nonce = `${process.pid}-${Date.now()}`;
    const stageDir = path.join(path.dirname(targetDir), `.${path.basename(targetDir)}.gardenflow-stage-${nonce}`);
    const rollbackDir = path.join(path.dirname(targetDir), `.${path.basename(targetDir)}.gardenflow-rollback-${nonce}`);
    let targetMoved = false;
    try {
        await fs.cp(sourceDir, stageDir, { recursive: true, errorOnExist: true, force: false });
        await fs.writeFile(path.join(stageDir, BROWSER_EXTENSION_SYNC_META_FILE), JSON.stringify({
            appVersion: options.appVersion,
            bundleFingerprint,
            preparedAt: new Date().toISOString(),
            sourceDir: options.sourceLabel,
        }, null, 2), 'utf8');
        if (targetExists) {
            await fs.rename(targetDir, rollbackDir);
            targetMoved = true;
        }
        await fs.rename(stageDir, targetDir);
        if (targetMoved) {
            await fs.rm(rollbackDir, { recursive: true, force: true });
            targetMoved = false;
        }
    } catch (error) {
        if (targetMoved && !await pathExists(targetDir) && await pathExists(rollbackDir)) {
            await fs.rename(rollbackDir, targetDir);
            targetMoved = false;
        }
        throw error;
    } finally {
        await fs.rm(stageDir, { recursive: true, force: true });
        if (!targetMoved) {
            await fs.rm(rollbackDir, { recursive: true, force: true });
        }
    }

    return { backupCreated, bundleFingerprint, updated: true };
}
