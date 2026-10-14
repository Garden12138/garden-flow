import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { addChatMessage, getChatMessages, getWorkspacePaths, insertPublicationCompletion, listPublicationCompletions, listPendingPublicationCompletions, updatePublicationCompletion, runInWorkspaceSpace } from '../db';
import type { PublicationSource, PublicationCompletion } from '../../shared/publication';
import { readPublicationSource } from './publicationSource';
import { PUBLICATION_AUTOMATION_IDS } from './builtinAutomationTasks';
import { emitPublicationChanged, listPublicationJobs, actOnPublication } from './unifiedPublisherService';

export async function publicationAutomationEnabled(platform: keyof typeof PUBLICATION_AUTOMATION_IDS): Promise<boolean> {
    const config = await fs.readFile(path.join(getWorkspacePaths().gardenflow, 'background-runner.json'), 'utf8').then(JSON.parse).catch(() => ({}));
    return config.builtinTasks?.[PUBLICATION_AUTOMATION_IDS[platform]]?.enabled === true;
}
export async function recordCompletedPublication(source: PublicationSource): Promise<void> {
    try {
        const snapshot = await readPublicationSource(source, true, false);
        const enabled = await publicationAutomationEnabled(snapshot.platform);
        const event: PublicationCompletion = { id: `publication-completion-${randomUUID()}`, spaceId: snapshot.spaceId, source: snapshot.source,
            semanticDigest: snapshot.semanticDigest, snapshot, state: enabled ? 'pending' : 'skipped', messageId: `publication-offer-${randomUUID()}`, createdAt: Date.now() };
        const inserted = insertPublicationCompletion(event);
        if (!enabled) return;
        if (!inserted) {
            const previous = listPublicationCompletions().find(item => JSON.stringify(item.source) === JSON.stringify(event.source) && item.semanticDigest === event.semanticDigest);
            if (previous?.state !== 'skipped') return;
            const resumed = { ...event, id: previous.id }; updatePublicationCompletion(resumed); await deliver(resumed); return;
        }
        await deliver(event);
    } catch (error) { console.warn('[Publication] Completed export is not publishable', String(error)); }
}
async function deliver(event: PublicationCompletion): Promise<void> {
    if (!await publicationAutomationEnabled(event.snapshot.platform)) { updatePublicationCompletion({ ...event, state: 'cancelled' }); return; }
    const latest = await readPublicationSource(event.source, true, false).catch(() => null);
    if (!latest || latest.semanticDigest !== event.semanticDigest) { updatePublicationCompletion({ ...event, state: 'cancelled' }); return; }
    if (!await publicationAutomationEnabled(event.snapshot.platform) || listPublicationCompletions().find(item => item.id === event.id)?.state !== 'pending') return;
    if (!getChatMessages(latest.sessionId).some(message => message.id === event.messageId)) addChatMessage({ id: event.messageId, session_id: latest.sessionId, role: 'assistant',
        content: `《${latest.title}》已导出。是否准备${{ xiaohongshu: '小红书', douyin: '抖音', tiktok: 'TikTok' }[latest.platform]}发布？上传与最终提交会分别确认。`,
        metadata: JSON.stringify({ publicationOffer: { id: event.id, platform: latest.platform, source: latest.source, title: latest.title, semanticDigest: event.semanticDigest } }) });
    updatePublicationCompletion({ ...event, snapshot: latest, state: 'offered' }); emitPublicationChanged();
}
export function dismissPublicationOffer(id: string): void {
    const event = listPublicationCompletions().find(item => item.id === id);
    if (!event || event.state !== 'offered') throw new Error('当前空间的发布询问不存在或已处理');
    updatePublicationCompletion({ ...event, state: 'dismissed' }); emitPublicationChanged();
}
export async function recoverPublicationCompletions(): Promise<void> {
    for (const event of listPendingPublicationCompletions()) await runInWorkspaceSpace(event.spaceId, async () => {
        const handled = listPublicationJobs().some(job => job.context?.snapshot.versionId === event.snapshot.versionId && job.context.snapshot.semanticDigest === event.semanticDigest && !['cancelled', 'superseded'].includes(job.status));
        if (handled) { updatePublicationCompletion({ ...event, state: 'handled' }); return; }
        if (event.state === 'pending') await deliver(event);
        else if (!await publicationAutomationEnabled(event.snapshot.platform)) updatePublicationCompletion({ ...event, state: 'cancelled' });
    });
}
export async function cancelAutomaticPublications(taskId: string): Promise<void> {
    const platform = (Object.keys(PUBLICATION_AUTOMATION_IDS) as Array<keyof typeof PUBLICATION_AUTOMATION_IDS>).find(key => PUBLICATION_AUTOMATION_IDS[key] === taskId);
    if (!platform) return;
    for (const event of listPublicationCompletions().filter(item => item.snapshot.platform === platform && ['pending', 'offered'].includes(item.state))) updatePublicationCompletion({ ...event, state: 'cancelled' });
    for (const job of listPublicationJobs().filter(item => item.platform === platform && item.context?.origin === 'completion' && item.publishStatus === 'not_submitted'
        && ['awaiting_confirmation', 'queued', 'blocked', 'uploading', 'preflighting'].includes(item.status))) await actOnPublication({ platform, jobId: job.id, expectedDigest: job.contentDigest }, 'cancel');
    emitPublicationChanged();
}
