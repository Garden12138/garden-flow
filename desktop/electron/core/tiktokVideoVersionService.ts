import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { getActiveSpaceId, getTikTokVideoVersion, getTikTokVideoVersionByProject,
    insertTikTokVideoVersion, listTikTokVideoVersions, updateTikTokVideoVersion, getWorkspacePaths } from '../db';
import { cloneProductVideoProject, getVideoEditorV2Project } from './video-editor-v2/videoEditorV2ProjectStore';
import type { TikTokVideoVersion } from '../../shared/tiktokVideo';
import { validateTikTokPublishSettings } from '../../shared/tiktokVideo';

const creating = new Map<string, Promise<TikTokVideoVersion>>();

export async function createTikTokVideoVersion(input: { sourceProjectId: string; duplicate?: boolean }): Promise<TikTokVideoVersion> {
    const spaceId = getActiveSpaceId();
    const mediaRoot = getWorkspacePaths().media;
    const sourceProjectId = String(input.sourceProjectId || '').trim();
    const key = `${spaceId}:${sourceProjectId}`;
    if (!input.duplicate) {
        const existing = getTikTokVideoVersionByProject(sourceProjectId, spaceId) || listTikTokVideoVersions(sourceProjectId, spaceId)[0];
        if (existing) return existing;
        if (creating.has(key)) return creating.get(key)!;
    }
    const operation = (async () => {
        const source = await getVideoEditorV2Project(sourceProjectId);
        if (spaceId !== getActiveSpaceId()) throw new Error('工作空间已变化，请重新创建');
        if (!source?.productVideo || source.projectKind !== 'product-video') throw new Error('来源商品视频工程不存在');
        const previous = getTikTokVideoVersionByProject(sourceProjectId, spaceId);
        const project = await cloneProductVideoProject(sourceProjectId, `${source.title} · TikTok`, mediaRoot);
        const now = Date.now();
        const version: TikTokVideoVersion = {
            id: `tkver_${randomUUID()}`, spaceId, sourceProjectId: previous?.sourceProjectId || sourceProjectId,
            sourceProductId: source.productVideo.productSnapshot.id,
            sourceProductUpdatedAt: source.productVideo.productSnapshot.updatedAt,
            projectId: project.id, title: previous?.title || source.title,
            description: previous?.description || '', hashtags: previous?.hashtags || [],
            language: previous?.language || 'en', market: previous?.market || 'International',
            publishSettings: previous?.publishSettings, revision: 1, createdAt: now, updatedAt: now,
        };
        try {
            if (spaceId !== getActiveSpaceId()) throw new Error('创建期间工作空间已变化，请重新创建');
            insertTikTokVideoVersion(version);
        } catch (error) {
            await fs.rm(project.projectDir, { recursive: true, force: true });
            throw error;
        }
        return version;
    })();
    if (!input.duplicate) creating.set(key, operation);
    try { return await operation; }
    finally { if (creating.get(key) === operation) creating.delete(key); }
}

export async function saveTikTokVideoVersion(input: {
    versionId: string; expectedRevision: number; title: string; description: string;
    hashtags: string[]; language: string; market: string; publishSettings?: unknown;
}): Promise<TikTokVideoVersion> {
    const existing = getTikTokVideoVersion(input.versionId);
    if (!existing) throw new Error('TikTok 版本不存在或不属于当前空间');
    if (!Number.isInteger(input.expectedRevision) || existing.revision !== input.expectedRevision) throw new Error('TikTok 版本已更新，请刷新后保存');
    const title = String(input.title || '').trim();
    const description = String(input.description || '').trim();
    const language = String(input.language || '').trim();
    const market = String(input.market || '').trim();
    if (!title || title.length > 200 || !description || description.length > 4_000
        || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) || !market || market.length > 100) throw new Error('请填写有效的标题、文案、语言代码和目标市场');
    if (!Array.isArray(input.hashtags) || input.hashtags.length > 30
        || input.hashtags.some((tag) => typeof tag !== 'string' || !/^[\p{L}\p{N}_]+$/u.test(tag.replace(/^#+/, '')) || tag.length > 100)) throw new Error('话题须为不含空格的文字、数字或下划线');
    if ([description, input.hashtags.map(tag => '#' + tag.replace(/^#+/, '')).join(' ')].filter(Boolean).join('\n').length > 4000) throw new Error('TikTok 文案与话题合计最多 4000 字符');
    const next: TikTokVideoVersion = {
        ...existing, title, description, language, market,
        hashtags: [...new Set(input.hashtags.map((tag) => tag.replace(/^#+/, '')))],
        publishSettings: input.publishSettings === undefined ? existing.publishSettings : input.publishSettings === null ? undefined : validateTikTokPublishSettings(input.publishSettings),
        revision: existing.revision + 1, updatedAt: Date.now(),
    };
    if (!updateTikTokVideoVersion(next, existing.revision)) throw new Error('TikTok 版本已更新，请刷新后保存');
    return next;
}
