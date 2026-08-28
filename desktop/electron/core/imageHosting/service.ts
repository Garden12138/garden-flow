import fs from 'node:fs/promises';
import path from 'node:path';
import {
    extractLocalAssetPathCandidate,
    isLocalAssetSource,
} from '../../../shared/localAsset.ts';
import {
    getActiveImageHostingConfig,
    isImageHostingReady,
    normalizeImageHostingSettings,
    type ImageHostingSettings,
} from '../../../shared/imageHosting.ts';
import { githubImageHostingAdapter } from './githubAdapter.ts';
import type { ImageHostingAdapter, ImageHostingUploadInput, ImageHostingUploadResult } from './types.ts';
import { buildRemotePath, rewriteGithubRawPublicUrl } from './url.ts';

const IMAGE_HOSTING_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
]);

const ADAPTERS: Record<string, ImageHostingAdapter> = {
    github: githubImageHostingAdapter,
};

export type NormalizeMediaValueDeps = {
    settings?: ImageHostingSettings | unknown;
    getSettings?: () => unknown;
    fetchImpl?: typeof fetch;
    readFile?: (filePath: string) => Promise<Buffer>;
    now?: Date;
    randomId?: string;
};

function loadImageHostingSettings(deps: NormalizeMediaValueDeps = {}): ImageHostingSettings {
    if (deps.settings !== undefined) {
        return normalizeImageHostingSettings(deps.settings);
    }
    if (deps.getSettings) {
        const raw = deps.getSettings() as { image_hosting_json?: unknown } | undefined;
        return normalizeImageHostingSettings(raw?.image_hosting_json);
    }
    return normalizeImageHostingSettings(null);
}

function inferMimeTypeFromPath(filePath: string): string {
    const ext = path.extname(String(filePath || '').trim()).toLowerCase();
    switch (ext) {
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.webp':
            return 'image/webp';
        case '.gif':
            return 'image/gif';
        case '.mp3':
            return 'audio/mpeg';
        case '.wav':
            return 'audio/wav';
        case '.m4a':
            return 'audio/mp4';
        case '.mp4':
            return 'video/mp4';
        default:
            return 'application/octet-stream';
    }
}

function extensionFromMime(mimeType: string): string {
    switch (String(mimeType || '').trim().toLowerCase()) {
        case 'image/jpeg':
        case 'image/jpg':
            return 'jpg';
        case 'image/webp':
            return 'webp';
        case 'image/gif':
            return 'gif';
        default:
            return 'png';
    }
}

export function isHostedImageMime(mimeType: string): boolean {
    return IMAGE_HOSTING_MIME_TYPES.has(String(mimeType || '').trim().toLowerCase());
}

function parseDataUrl(value: string): { buffer: Buffer; mimeType: string } | null {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value || '').trim());
    if (!match) return null;
    try {
        return {
            mimeType: String(match[1] || '').trim().toLowerCase() || 'application/octet-stream',
            buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
        };
    } catch {
        return null;
    }
}

function looksLikeRawBase64(value: string): boolean {
    const raw = String(value || '').trim();
    return raw.length > 128 && /^[A-Za-z0-9+/=]+$/.test(raw);
}

function getImageHostingAdapter(type: string): ImageHostingAdapter {
    const adapter = ADAPTERS[type];
    if (!adapter) {
        throw new Error(`暂不支持的图床类型：${type}`);
    }
    return adapter;
}

export async function uploadImageBuffer(
    input: ImageHostingUploadInput,
    deps: NormalizeMediaValueDeps = {},
): Promise<ImageHostingUploadResult> {
    const settings = loadImageHostingSettings(deps);
    if (!settings.enabled) {
        throw new Error('请先在设置中启用图床。');
    }
    const config = getActiveImageHostingConfig(settings);
    if (!isImageHostingReady(settings)) {
        throw new Error('图床已启用但配置不完整，请填写仓库名、分支和 Token。');
    }
    const adapter = getImageHostingAdapter(config.type);
    const remotePath = input.remotePath || buildRemotePath({
        pathPrefix: config.github.pathPrefix,
        fileName: input.fileName,
        now: deps.now,
        randomId: deps.randomId,
    });
    return adapter.upload({
        ...input,
        remotePath,
    }, config, { fetchImpl: deps.fetchImpl });
}

export async function normalizeMediaValueForRemote(
    value: string,
    deps: NormalizeMediaValueDeps = {},
): Promise<string> {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(https?:)?\/\//i.test(raw)) {
        const settings = loadImageHostingSettings(deps);
        const config = getActiveImageHostingConfig(settings);
        return rewriteGithubRawPublicUrl(raw, {
            customDomain: config.github.customDomain,
            publicUrlStyle: config.github.publicUrlStyle,
        });
    }

    const readFile = deps.readFile || ((filePath: string) => fs.readFile(filePath));
    const settings = loadImageHostingSettings(deps);
    const dataUrl = parseDataUrl(raw);
    const filePath = isLocalAssetSource(raw) ? extractLocalAssetPathCandidate(raw) || raw : raw;
    const mimeType = dataUrl?.mimeType || inferMimeTypeFromPath(filePath);
    const canUploadImage = isHostedImageMime(mimeType);

    if (canUploadImage && (dataUrl || isLocalAssetSource(raw) || looksLikeExistingFilePath(raw))) {
        if (settings.enabled && !isImageHostingReady(settings)) {
            throw new Error('图床已启用但配置不完整，请填写仓库名、分支和 Token。');
        }
        if (isImageHostingReady(settings)) {
            const buffer = dataUrl?.buffer || await readFile(filePath);
            const fileName = dataUrl
                ? `image.${extensionFromMime(mimeType)}`
                : path.basename(filePath) || `image.${extensionFromMime(mimeType)}`;
            const uploaded = await uploadImageBuffer({
                buffer,
                fileName,
                mimeType,
            }, { ...deps, settings });
            return uploaded.publicUrl;
        }
    }

    if (dataUrl || raw.startsWith('data:')) return raw;
    if (looksLikeRawBase64(raw)) return raw;
    try {
        const buffer = await readFile(filePath);
        return `data:${inferMimeTypeFromPath(filePath)};base64,${buffer.toString('base64')}`;
    } catch {
        return raw;
    }
}

function looksLikeExistingFilePath(value: string): boolean {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('data:')) return false;
    return raw.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\');
}

export const TEST_IMAGE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export async function uploadTestPng(deps: NormalizeMediaValueDeps = {}): Promise<{
    ok: boolean;
    publicUrl?: string;
    error?: string;
}> {
    try {
        const result = await uploadImageBuffer({
            buffer: Buffer.from(TEST_IMAGE_PNG_BASE64, 'base64'),
            fileName: 'image-hosting-test.png',
            mimeType: 'image/png',
        }, deps);
        return { ok: true, publicUrl: result.publicUrl };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error || '图床测试上传失败'),
        };
    }
}
