import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { getChatSession, getWorkspacePaths, listAgentTasks, parseAgentTaskRecord } from '../db';
import { getAbsoluteMediaPath, listMediaAssets } from './mediaLibraryStore';
import { isPathWithinRoots } from './localAssetManager';
import { getXhsNoteProject } from './xhsNoteProjectStore';
import { getVideoEditorV2Project } from './video-editor-v2/videoEditorV2ProjectStore';
import { assertCurrentVideoExport, compositionFingerprint, videoRenderFingerprint } from './video-editor-v2/videoPublicationPolicy';
import type { VideoEditorV2RemotionComposition } from '../../shared/videoAutoEditRemotion';
import type { XhsNoteDocument } from '../../shared/xhsNote';
import { selectPublishProjectId, type XhsPublishSource } from './xhsPublishPreparation';

function record(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
        try { return record(JSON.parse(value)); } catch { return {}; }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function currentProjectExport(projectId: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('视频工程 ID 不合法');
    const project = await getVideoEditorV2Project(projectId);
    if (!project) throw new Error('视频工程不存在');
    let legacyFingerprint: string | undefined;
    const output = project.renderOutputs[0];
    const snapshot = project.remotionSnapshot;
    if (output && !output.renderFingerprint && snapshot
        && Date.parse(snapshot.updatedAt) <= Date.parse(output.createdAt)
        && isPathWithinRoots(path.resolve(snapshot.compositionPath), [path.resolve(project.projectDir)])) {
        try {
            legacyFingerprint = compositionFingerprint(JSON.parse(await fs.readFile(snapshot.compositionPath, 'utf8')) as VideoEditorV2RemotionComposition);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
    }
    assertCurrentVideoExport(project, legacyFingerprint);
    return { project, output: project.renderOutputs[0], fingerprint: videoRenderFingerprint(project) };
}

export async function assertXhsSourceExportCurrent(source: NonNullable<XhsNoteDocument['sourceVideoExport']>): Promise<void> {
    const { output, fingerprint } = await currentProjectExport(source.projectId);
    if (output.id !== source.renderId || output.mediaAssetId !== source.mediaAssetId || fingerprint !== source.renderFingerprint) {
        throw new Error('视频工程或成片已更新，请重新准备发布并确认新版本');
    }
}

export async function readXhsVideoPublishSource(input: { sessionId: string; projectId?: string; assetId?: string; notePath?: string }): Promise<XhsPublishSource> {
    const metadata = record(getChatSession(input.sessionId)?.metadata);
    let notePath = input.notePath;
    if (!input.projectId && !input.assetId && !notePath && metadata.activeXhsNotePath) {
        notePath = String(metadata.activeXhsNotePath);
    }
    const note = notePath ? await getXhsNoteProject(notePath) : undefined;
    const noteVideo = note?.document.mediaSlots.find((slot) => slot.id === 'final-video');
    const linkedProjectId = note?.document.sourceVideoExport?.projectId;
    let projectId = input.projectId || linkedProjectId;
    let assetId = input.assetId || (!projectId ? noteVideo?.assetId : undefined);
    if (!projectId && !assetId) {
        const projectIds = listAgentTasks({ ownerSessionId: input.sessionId, limit: 500 })
            .flatMap((task) => parseAgentTaskRecord(task)?.artifacts || [])
            .filter((artifact) => artifact.type === 'product-video-project')
            .map((artifact) => String(record(artifact.metadata).projectId || ''));
        projectId = selectPublishProjectId(projectIds, String(metadata.activeVideoProjectId || '') || undefined);
    }
    const assets = await listMediaAssets(10000);
    // A rendered asset still belongs to its editable source project; selecting it
    // explicitly must not bypass stale-export checks.
    if (!projectId && assetId) {
        const asset = assets.find((item) => item.id === assetId);
        if (asset?.renderId && asset.projectId?.startsWith('video_edit_v2_')) projectId = asset.projectId;
    }
    const resolved = projectId ? await currentProjectExport(projectId) : undefined;
    if (resolved && assetId && resolved.output.mediaAssetId !== assetId) throw new Error('所选视频不是工程当前成片，请选择最新导出版本');
    assetId = resolved?.output.mediaAssetId || assetId;
    const asset = assets.find((item) => item.id === assetId);
    if (!asset?.relativePath || !String(asset.mimeType || '').startsWith('video/')) throw new Error('没有可发布的资产库视频');
    const absolutePath = path.resolve(getAbsoluteMediaPath(asset.relativePath));
    if (!isPathWithinRoots(absolutePath, [path.resolve(getWorkspacePaths().media)]) || !fsSync.existsSync(absolutePath) || !fsSync.statSync(absolutePath).isFile()) {
        throw new Error('资产库视频文件不存在或路径不合法');
    }
    return {
        projectId,
        assetId: asset.id,
        title: resolved?.project.title || note?.document.finalTitle || asset.title || '视频',
        durationSeconds: resolved ? resolved.project.timeline.durationMs / 1000 : note?.document.durationSeconds || 0,
        aspectRatio: resolved?.project.canvas.aspectRatio || asset.aspectRatio || '9:16',
        productFacts: resolved?.project.productVideo?.productSnapshot,
        sourceVideoExport: resolved ? {
            projectId: resolved.project.id,
            renderId: resolved.output.id,
            mediaAssetId: asset.id,
            renderFingerprint: resolved.fingerprint,
        } : undefined,
        existingCopy: note ? { title: note.document.finalTitle, body: note.document.body, hashtags: note.document.hashtags } : undefined,
        notePath: note?.projectPath,
    };
}
