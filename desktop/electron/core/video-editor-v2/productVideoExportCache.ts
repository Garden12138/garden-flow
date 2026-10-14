import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { getWorkspacePaths } from '../../db';
import { getAbsoluteMediaPath, getMediaAssetById } from '../mediaLibraryStore';
import type { RenderOutputRecord, VideoEditorV2Project } from '../../../shared/videoAutoEdit';
import { videoRenderFingerprint } from './videoPublicationPolicy';

export async function renderedVideoSha256(file: string): Promise<string> {
    const digest = createHash('sha256');
    for await (const bytes of createReadStream(file)) digest.update(bytes);
    return digest.digest('hex');
}

/** Reuse only the current, independently owned library artifact with verified bytes. */
export async function findReusableProductVideoExport(project: VideoEditorV2Project): Promise<{ output: RenderOutputRecord; sourcePath: string } | null> {
    const output = project.renderOutputs[0];
    if (!project.productVideo || !output?.mediaAssetId || !/^[a-f0-9]{64}$/.test(output.outputSha256 || '')
        || output.renderFingerprint !== videoRenderFingerprint(project)) return null;
    try {
        const asset = await getMediaAssetById(output.mediaAssetId);
        if (!asset?.relativePath || asset.projectId !== project.id || asset.renderId !== output.id || asset.mimeType !== 'video/mp4') return null;
        const sourcePath = await fs.realpath(getAbsoluteMediaPath(asset.relativePath));
        const mediaRoot = await fs.realpath(getWorkspacePaths().media);
        if (!sourcePath.startsWith(mediaRoot + path.sep) || !(await fs.stat(sourcePath)).isFile()
            || await renderedVideoSha256(sourcePath) !== output.outputSha256) return null;
        return { output, sourcePath };
    } catch { return null; }
}
