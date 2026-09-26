import fs from 'node:fs';
import path from 'node:path';
import { extractLocalAssetPathCandidate, isLocalAssetSource } from '../../shared/localAsset.ts';

const SUPPORTED_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.webp']);
const KNOWN_UNSUPPORTED_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.heic', '.heif', '.svg', '.tif', '.tiff']);
const SUPPORTED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
]);
const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;

function supportedImageMime(buffer: Buffer): string | null {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return 'image/png';
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        return 'image/webp';
    }
    return null;
}

export function resolveAliyunReferenceFfmpegCommand(): string {
    const candidates: string[] = [];
    const configured = String(process.env.GARDENFLOW_FFMPEG_PATH || process.env.FFMPEG_PATH || '').trim();
    if (configured) candidates.push(configured);
    try {
        const bundled = require('ffmpeg-static') as string | null;
        if (bundled) candidates.push(bundled);
    } catch {
        // The packaged binary path below remains available when module resolution differs.
    }
    if (process.resourcesPath) {
        candidates.push(path.join(
            process.resourcesPath,
            'app.asar.unpacked',
            'node_modules',
            'ffmpeg-static',
            process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
        ));
    }
    for (const candidate of candidates) {
        const resolved = candidate.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
        if (fs.existsSync(resolved)) return resolved;
    }
    if (process.env.GARDENFLOW_ALLOW_SYSTEM_FFMPEG === '1') return 'ffmpeg';
    throw new Error('商品视频参考图需要转换格式，但内置 ffmpeg 不可用。请重新安装应用后重试。');
}

export async function normalizeAliyunVideoReferenceImages(input: {
    references: string[];
    normalize: (value: string) => Promise<string>;
    transcodeLocalImage: (absolutePath: string) => Promise<Buffer>;
    readLocalImage?: (absolutePath: string) => Promise<Buffer>;
}): Promise<string[]> {
    return Promise.all(input.references.map(async (reference) => {
        const raw = String(reference || '').trim();
        if (!raw) throw new Error('阿里云参考图路径为空。');

        const localPath = isLocalAssetSource(raw) ? extractLocalAssetPathCandidate(raw) : '';
        if (localPath) {
            if (SUPPORTED_EXTENSIONS.has(path.extname(localPath).toLowerCase())) {
                let source: Buffer;
                try {
                    source = await (input.readLocalImage || fs.promises.readFile)(localPath);
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    throw new Error(`阿里云参考图读取失败：${path.basename(localPath)}；${reason}`);
                }
                const mime = supportedImageMime(source);
                if (mime && source.length <= MAX_REFERENCE_IMAGE_BYTES) {
                    return `data:${mime};base64,${source.toString('base64')}`;
                }
            }
            let jpeg: Buffer;
            try {
                jpeg = await input.transcodeLocalImage(localPath);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                throw new Error(`阿里云参考图格式转换失败：${path.basename(localPath)}；${reason}`);
            }
            if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9) {
                throw new Error(`阿里云参考图格式转换失败：${path.basename(localPath)} 未生成有效 JPEG。`);
            }
            if (jpeg.length > MAX_REFERENCE_IMAGE_BYTES) {
                throw new Error(`阿里云参考图格式转换失败：${path.basename(localPath)} 超过 20 MB 限制。`);
            }
            return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
        }

        const dataMime = /^data:([^;,]+)/i.exec(raw)?.[1]?.toLowerCase();
        if (dataMime && !SUPPORTED_MIME_TYPES.has(dataMime)) {
            throw new Error(`阿里云不支持 ${dataMime} 参考图；请使用本地原图，应用会自动转换为 JPEG。`);
        }
        if (dataMime) return raw;
        if (/^https?:\/\//i.test(raw)) {
            const extension = path.extname(new URL(raw).pathname).toLowerCase();
            if (KNOWN_UNSUPPORTED_EXTENSIONS.has(extension)) {
                throw new Error(`阿里云不支持 ${extension} 参考图；请使用本地原图，应用会自动转换为 JPEG。`);
            }
        }
        return input.normalize(raw);
    }));
}
