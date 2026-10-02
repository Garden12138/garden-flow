import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DouyinImageCoverFile, DouyinImageCoverSnapshot } from '../../shared/platformPublisher';
import type { VideoEditorV2Project } from '../../shared/videoAutoEdit';

const localRequire = createRequire(import.meta.url);
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const dimensions = { portrait: [1080, 1440], landscape: [1440, 1080] } as const;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function douyinCoverFfmpegArgs(source: string, target: string, width: number, height: number): string[] {
    return ['-v', 'error', '-nostdin', '-y', '-i', source, '-frames:v', '1', '-vf',
        `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`,
        '-q:v', '2', target];
}

async function renderCover(source: string, target: string, width: number, height: number, command: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, douyinCoverFfmpegArgs(source, target, width, height), {
            windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
        });
        let finished = false;
        const finish = (error?: Error) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            error ? reject(error) : resolve();
        };
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            finish(new Error('抖音封面处理超时，请更换图片后重试'));
        }, 20_000);
        child.once('error', () => finish(new Error('内置图片处理工具不可用')));
        // Drain diagnostics without returning source paths or complete decoder output.
        child.stderr?.on('data', () => {});
        child.once('close', (code) => finish(code === 0 ? undefined : new Error('抖音封面图片无法解码，请更换图片后重试')));
    });
}

export async function prepareDouyinImageCover(
    project: VideoEditorV2Project,
    assetId: string | undefined,
    ffmpegCommand?: string,
): Promise<DouyinImageCoverSnapshot | undefined> {
    if (!assetId) return undefined;
    const asset = project.assets.find((item) => item.id === assetId && item.kind === 'image');
    if (!asset) throw new Error('封面素材不属于当前抖音工程');
    const root = await fs.realpath(project.projectDir);
    const source = await fs.realpath(asset.projectPath).catch(() => { throw new Error('所选封面文件已丢失'); });
    const relative = path.relative(root, source);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
        throw new Error('封面素材路径不属于当前抖音工程');
    }
    const stat = await fs.stat(source);
    if (!stat.isFile() || !stat.size || stat.size > MAX_SOURCE_BYTES) throw new Error('封面图片文件为空或超过 32 MB');
    const bytes = await fs.readFile(source);
    if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) throw new Error('封面图片文件为空或超过 32 MB');
    const sourceSha256 = digest(bytes);
    const outputRoot = path.join(root, 'publication-covers');
    await fs.mkdir(outputRoot, { recursive: true });
    if (await fs.realpath(outputRoot) !== outputRoot) throw new Error('封面输出目录不属于当前工程');
    const outputDir = path.join(outputRoot, sourceSha256);
    await fs.mkdir(outputDir, { recursive: true });
    if (await fs.realpath(outputDir) !== outputDir) throw new Error('封面输出目录不属于当前工程');
    const binary = ffmpegCommand || String(localRequire('ffmpeg-static') || '').replace('app.asar', 'app.asar.unpacked');
    if (!binary) throw new Error('内置图片处理工具不可用');
    const files: DouyinImageCoverFile[] = [];
    for (const orientation of ['portrait', 'landscape'] as const) {
        const [width, height] = dimensions[orientation];
        const target = path.join(outputDir, `${orientation}.jpg`);
        // Always render from the bytes whose digest is bound to the confirmation.
        const input = path.join(outputDir, `source-${randomUUID()}${path.extname(source)}`);
        const temporary = path.join(outputDir, `${orientation}-${randomUUID()}.jpg`);
        try {
            await fs.writeFile(input, bytes);
            await renderCover(input, temporary, width, height, binary);
            const rendered = await fs.readFile(temporary);
            await fs.rename(temporary, target);
            files.push({ orientation, path: target, sha256: digest(rendered), width, height });
        } finally {
            await fs.rm(input, { force: true });
            await fs.rm(temporary, { force: true });
        }
    }
    return { assetId, sourceSha256, crop: 'center', files: files as DouyinImageCoverSnapshot['files'] };
}
