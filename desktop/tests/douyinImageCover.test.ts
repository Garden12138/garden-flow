import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { prepareDouyinImageCover } from '../electron/core/douyinImageCover.ts';

const command = createRequire(import.meta.url)('ffmpeg-static') as string;
const run = promisify(execFile);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('real decoder creates deterministic platform covers, binds source bytes and confines paths', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'douyin-cover-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const projectDir = path.join(root, 'project');
    await fs.mkdir(projectDir);
    const source = path.join(projectDir, 'source.png');
    await run(command, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x480', '-frames:v', '1', source]);
    const project = { projectDir, assets: [{ id: 'image-1', kind: 'image', projectPath: source }] } as any;
    assert.equal(await prepareDouyinImageCover(project, undefined), undefined);
    const first = await prepareDouyinImageCover(project, 'image-1', command);
    assert.equal(first!.sourceSha256, hash(await fs.readFile(source)));
    assert.equal(first!.crop, 'center');
    for (const file of first!.files) {
        assert.equal(file.sha256, hash(await fs.readFile(file.path)));
        const decoded = await run(command, ['-v', 'error', '-i', file.path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 6_000_000 });
        assert.equal(decoded.stdout.length, file.width * file.height * 3);
    }
    assert.deepEqual(await prepareDouyinImageCover(project, 'image-1', command), first);
    const outputDir = path.dirname(first!.files[0].path);
    assert.deepEqual((await fs.readdir(outputDir)).sort(), ['landscape.jpg', 'portrait.jpg']);
    await assert.rejects(prepareDouyinImageCover(project, 'another-image', command), /不属于/);
    await run(command, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:size=640x480', '-frames:v', '1', source]);
    const changed = await prepareDouyinImageCover(project, 'image-1', command);
    assert.notEqual(changed!.sourceSha256, first!.sourceSha256);
    assert.notEqual(changed!.files[0].sha256, first!.files[0].sha256);
    const redirectedDir = path.join(root, 'redirected-project');
    await fs.mkdir(redirectedDir);
    const redirectedSource = path.join(redirectedDir, 'source.png');
    await fs.copyFile(source, redirectedSource);
    await fs.symlink(root, path.join(redirectedDir, 'publication-covers'));
    await assert.rejects(prepareDouyinImageCover({ projectDir: redirectedDir,
        assets: [{ id: 'image-1', kind: 'image', projectPath: redirectedSource }] } as any, 'image-1', command), /输出目录/);
    assert.equal(await fs.stat(path.join(root, changed!.sourceSha256)).then(() => true, () => false), false);
    const outside = path.join(root, 'outside.png');
    await fs.copyFile(source, outside);
    await fs.symlink(outside, path.join(projectDir, 'escape.png'));
    await assert.rejects(prepareDouyinImageCover({ ...project, assets: [{ id: 'image-1', kind: 'image', projectPath: path.join(projectDir, 'escape.png') }] }, 'image-1', command), /不属于/);
    await fs.writeFile(source, 'not an image');
    await assert.rejects(prepareDouyinImageCover(project, 'image-1', command), /无法解码/);
    await fs.rm(source);
    await assert.rejects(prepareDouyinImageCover(project, 'image-1', command), /丢失/);
});
