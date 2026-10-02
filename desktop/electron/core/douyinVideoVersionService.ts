import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import {
    getActiveSpaceId,
    getDouyinVideoVersion,
    getDouyinVideoVersionByProject,
    insertDouyinVideoVersion,
    listDouyinVideoVersions,
    updateDouyinVideoVersion,
} from '../db';
import { getXhsNoteProject } from './xhsNoteProjectStore';
import { cloneProductVideoProject, getVideoEditorV2Project } from './video-editor-v2/videoEditorV2ProjectStore';
import type { DouyinVideoVersion } from '../../shared/platformVideoVersion';

const creatingVersions = new Map<string, Promise<DouyinVideoVersion>>();

export async function createDouyinVideoVersion(input: {
    sourceProjectId: string;
    sourceNotePath?: string;
    duplicate?: boolean;
}): Promise<DouyinVideoVersion> {
    const spaceId = getActiveSpaceId();
    const sourceProjectId = String(input.sourceProjectId || '').trim();
    const key = `${spaceId}:${sourceProjectId}`;
    if (!input.duplicate) {
        const existing = getDouyinVideoVersionByProject(sourceProjectId, spaceId)
            || listDouyinVideoVersions(sourceProjectId, spaceId)[0];
        if (existing) return existing;
        const pending = creatingVersions.get(key);
        if (pending) return pending;
    }
    const operation = (async () => {
        const source = await getVideoEditorV2Project(sourceProjectId);
        if (!source?.productVideo || source.projectKind !== 'product-video') throw new Error('来源商品视频工程不存在');
        const linkedVersion = getDouyinVideoVersionByProject(sourceProjectId, spaceId);
        const note = input.sourceNotePath
            ? await getXhsNoteProject(input.sourceNotePath)
            : await getXhsNoteProject(`xiaohongshu/video-${sourceProjectId}.redvideo`).catch((error: unknown) => {
                if (error instanceof Error && error.message.includes('缺少 note.json')) return undefined;
                throw error;
            });
        if (note && note.document.sourceVideoExport?.projectId !== sourceProjectId) {
            throw new Error('所选小红书稿件与来源视频工程不一致');
        }
        const project = await cloneProductVideoProject(sourceProjectId);
        const now = Date.now();
        const version: DouyinVideoVersion = {
            id: `dyver_${randomUUID()}`,
            spaceId,
            sourceProjectId: linkedVersion?.sourceProjectId || sourceProjectId,
            sourceNotePath: note?.relativePath || linkedVersion?.sourceNotePath,
            sourceNoteRevision: note?.version || linkedVersion?.sourceNoteRevision,
            sourceProductId: source.productVideo.productSnapshot.id,
            sourceProductUpdatedAt: source.productVideo.productSnapshot.updatedAt,
            projectId: project.id,
            title: note?.document.finalTitle || linkedVersion?.title || source.title,
            description: note?.document.body || linkedVersion?.description || '',
            hashtags: note?.document.hashtags || linkedVersion?.hashtags || [],
            revision: 1,
            createdAt: now,
            updatedAt: now,
        };
        try {
            insertDouyinVideoVersion(version);
        } catch (error) {
            await fs.rm(project.projectDir, { recursive: true, force: true });
            throw error;
        }
        return version;
    })();
    if (!input.duplicate) creatingVersions.set(key, operation);
    try {
        return await operation;
    } finally {
        if (creatingVersions.get(key) === operation) creatingVersions.delete(key);
    }
}

export async function saveDouyinVideoVersion(input: {
    versionId: string;
    expectedRevision: number;
    title: string;
    description: string;
    hashtags: string[];
    coverAssetId?: string;
}): Promise<DouyinVideoVersion> {
    const existing = getDouyinVideoVersion(input.versionId);
    if (!existing) throw new Error('抖音版本不存在或不属于当前空间');
    if (existing.revision !== input.expectedRevision) throw new Error('抖音版本已更新，请重新加载后再保存');
    const title = String(input.title || '').trim();
    const description = String(input.description || '').trim();
    if (!title || !description) throw new Error('请填写内部标题和发布描述');
    const coverAssetId = String(input.coverAssetId || '').trim();
    if (coverAssetId) {
        const project = await getVideoEditorV2Project(existing.projectId);
        if (!project?.assets.some((asset) => asset.id === coverAssetId && asset.kind === 'image')) {
            throw new Error('封面素材不属于当前抖音工程');
        }
    }
    const hashtags = [...new Set((input.hashtags || []).map((tag) => String(tag || '').trim().replace(/^#+/, '')).filter(Boolean))];
    const next: DouyinVideoVersion = {
        ...existing,
        title,
        description,
        hashtags,
        coverAssetId: coverAssetId || undefined,
        revision: existing.revision + 1,
        updatedAt: Date.now(),
    };
    if (!updateDouyinVideoVersion(next, existing.revision)) throw new Error('抖音版本已更新，请重新加载后再保存');
    return next;
}
