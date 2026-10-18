import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { nativeImage } from 'electron';
import { DreamReferenceCropSchema, type DreamImageReference, type DreamFrozenReference } from '../../shared/dreamStory';
import type { VideoEditorV2Project } from '../../shared/videoAutoEdit';
import { isPathWithinRoots } from './localAssetManager';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function sourceBytes(project: VideoEditorV2Project, reference: DreamImageReference): Promise<Buffer> {
    const asset = project.assets.find(item => item.id === reference.assetId && item.kind === 'image');
    if (!asset) throw new Error('参考图不属于当前作品');
    const real = await fs.realpath(asset.projectPath);
    if (!isPathWithinRoots(real, [await fs.realpath(project.projectDir)])) throw new Error('参考图越出工程');
    const bytes = await fs.readFile(real);
    if (sha(bytes) !== asset.hash) throw new Error('参考图文件已变化，请重新导入');
    return bytes;
}
export async function freezeDreamReference(project: VideoEditorV2Project, reference: DreamImageReference): Promise<DreamFrozenReference> {
    const bytes = await sourceBytes(project, reference);
    if (!reference.crop) return { ...reference, sha256: sha(bytes) };
    const crop = DreamReferenceCropSchema.parse(reference.crop);
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error('参考图无法解码');
    const size = image.getSize();
    const x = Math.floor(crop.x * size.width); const y = Math.floor(crop.y * size.height);
    const width = Math.min(size.width - x, Math.round(crop.width * size.width));
    const height = Math.min(size.height - y, Math.round(crop.height * size.height));
    if (width < 32 || height < 32) throw new Error('裁切后的参考图至少需要32×32像素');
    const cropped = image.crop({ x, y, width, height }).toPNG();
    if (!cropped.length) throw new Error('无法创建参考裁切');
    const contentSha256 = sha(cropped);
    const previewRelativePath = 'private/reference-crops/' + contentSha256 + '.png';
    const privateDirectory = path.join(project.projectDir, 'private');
    await fs.mkdir(privateDirectory, { recursive: true });
    if (!isPathWithinRoots(await fs.realpath(privateDirectory), [await fs.realpath(project.projectDir)])) throw new Error('裁切目录越出工程');
    const directory = path.join(privateDirectory, 'reference-crops');
    await fs.mkdir(directory, { recursive: true });
    if (!isPathWithinRoots(await fs.realpath(directory), [await fs.realpath(project.projectDir)])) throw new Error('裁切目录越出工程');
    // Same content is immutable; a changed/corrupt cache is rejected, never silently replaced.
    const output = path.join(project.projectDir, previewRelativePath);
    try { await fs.writeFile(output, cropped, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const frozen = { ...reference, crop, sha256: sha(bytes), contentSha256, previewRelativePath };
    await frozenDreamReferencePath(project, frozen);
    return frozen;
}
export async function frozenDreamReferencePath(project: VideoEditorV2Project, reference: DreamFrozenReference): Promise<string> {
    const bytes = await sourceBytes(project, reference);
    if (sha(bytes) !== reference.sha256) throw new Error('参考图文件已变化，请重新预览');
    if (!reference.crop) return project.assets.find(item => item.id === reference.assetId)!.projectPath;
    DreamReferenceCropSchema.parse(reference.crop);
    if (!/^[a-f0-9]{64}$/.test(reference.contentSha256 || '') || reference.previewRelativePath !== 'private/reference-crops/' + reference.contentSha256 + '.png') throw new Error('裁切参考记录无效');
    const file = await fs.realpath(path.join(project.projectDir, reference.previewRelativePath));
    if (!isPathWithinRoots(file, [await fs.realpath(project.projectDir)]) || sha(await fs.readFile(file)) !== reference.contentSha256) throw new Error('裁切参考文件缺失或变化，请重新预览');
    return file;
}
