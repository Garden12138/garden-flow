import { spawn } from 'node:child_process';

const DEFAULT_MAX_EDGE = 768;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export type ProductVideoImageDecodeResult = {
    jpeg: Buffer;
    decoder: 'native-image' | 'ffmpeg';
};

export function buildProductVideoImageFfmpegArgs(inputPath: string, maxEdge = DEFAULT_MAX_EDGE): string[] {
    const normalizedMaxEdge = Math.max(64, Math.round(Number(maxEdge) || DEFAULT_MAX_EDGE));
    return [
        '-v', 'error',
        '-i', inputPath,
        '-frames:v', '1',
        '-vf', `scale=w='min(${normalizedMaxEdge},iw)':h='min(${normalizedMaxEdge},ih)':force_original_aspect_ratio=decrease`,
        '-q:v', '5',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        'pipe:1',
    ];
}

export async function transcodeProductVideoImageToJpeg(input: {
    ffmpegCommand: string;
    inputPath: string;
    maxEdge?: number;
    timeoutMs?: number;
    maxOutputBytes?: number;
    signal?: AbortSignal;
}): Promise<Buffer> {
    const timeoutMs = Math.max(1_000, Number(input.timeoutMs || DEFAULT_TIMEOUT_MS));
    const maxOutputBytes = Math.max(1024, Number(input.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES));
    const args = buildProductVideoImageFfmpegArgs(input.inputPath, input.maxEdge);

    return new Promise<Buffer>((resolve, reject) => {
        if (input.signal?.aborted) {
            reject(new Error('商品图片解码已取消'));
            return;
        }

        const child = spawn(input.ffmpegCommand, args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const chunks: Buffer[] = [];
        let outputBytes = 0;
        let stderr = '';
        let settled = false;

        const finish = (error?: Error, jpeg?: Buffer) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            input.signal?.removeEventListener('abort', handleAbort);
            if (error) {
                reject(error);
                return;
            }
            resolve(jpeg || Buffer.alloc(0));
        };
        const handleAbort = () => {
            child.kill('SIGKILL');
            finish(new Error('商品图片解码已取消'));
        };
        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            finish(new Error(`商品图片解码超时（${timeoutMs}ms）`));
        }, timeoutMs);

        input.signal?.addEventListener('abort', handleAbort, { once: true });
        child.stdout?.on('data', (chunk: Buffer) => {
            if (settled || !chunk?.length) return;
            outputBytes += chunk.length;
            if (outputBytes > maxOutputBytes) {
                child.kill('SIGKILL');
                finish(new Error(`商品图片解码结果超过限制（${maxOutputBytes} bytes）`));
                return;
            }
            chunks.push(Buffer.from(chunk));
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr += String(chunk || '');
            if (stderr.length > 4_000) stderr = stderr.slice(-4_000);
        });
        child.once('error', (error) => {
            finish(error);
        });
        child.once('close', (code) => {
            if (settled) return;
            const jpeg = Buffer.concat(chunks);
            if (code === 0 && jpeg.length > 0) {
                finish(undefined, jpeg);
                return;
            }
            finish(new Error(`ffmpeg 商品图片解码失败（code=${code}）：${stderr || '没有输出图片'}`));
        });
    });
}

export async function decodeProductVideoImage(input: {
    decodeNative: () => Buffer | null;
    decodeFallback: () => Promise<Buffer>;
}): Promise<ProductVideoImageDecodeResult | null> {
    try {
        const nativeJpeg = input.decodeNative();
        if (nativeJpeg?.length) {
            return { jpeg: nativeJpeg, decoder: 'native-image' };
        }
    } catch {
        // Continue with the bundled decoder for formats unsupported by nativeImage.
    }

    try {
        const fallbackJpeg = await input.decodeFallback();
        return fallbackJpeg.length > 0
            ? { jpeg: fallbackJpeg, decoder: 'ffmpeg' }
            : null;
    } catch {
        return null;
    }
}
