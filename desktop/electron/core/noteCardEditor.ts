import { recordCreationMetric } from './creationMetrics';
import { randomUUID, createHash } from 'node:crypto';
import { getWorkspacePaths, runInWorkspaceSpace } from '../db';
import { NoteCardTurnSchema, NoteCardContentSchema, cardContent, type NoteCardTurn, type NoteCardRuntime } from '../../shared/noteCards';
import { getXhsNoteProject, enqueueXhsMutation, saveXhsNoteProjectUnlocked } from './xhsNoteProjectStore';
import { readCreationSource } from './creationSources';

const emptyRuntime = (): NoteCardRuntime => ({ draftEpoch: 0, undo: [], receipts: [], unapplied: [] });
export async function readNoteCard(inputPath: string) {
    const snapshot = await getXhsNoteProject(inputPath);
    if (snapshot.document.noteType !== 'image' || snapshot.document.productImageSet) throw new Error('当前作品不是普通图文卡片');
    return { ...snapshot, runtime: snapshot.document.cardRuntime || emptyRuntime(), content: cardContent(snapshot.document) };
}
export async function validateCardSources(content: ReturnType<typeof cardContent>, previous?: ReturnType<typeof cardContent>) {
    for (const ref of content.creationConfig.sourceRefs) if (!previous?.creationConfig.sourceRefs.some(old => old.id === ref.id && old.version === ref.version)) await readCreationSource(ref, { limit: 1 });
    for (const page of content.imagePages) for (const ref of page.sourceRefs) {
        if (!content.creationConfig.sourceRefs.some(source => source.id === ref.id && source.version === ref.version)) throw new Error('页面来源未绑定到当前作品');
    }
}
export async function noteCardMutation(input: NoteCardTurn, operation: 'save' | 'undo' | 'mark' | 'apply' | 'dismiss', value?: unknown, origin: 'manual' | 'ai' = 'manual') {
    const turn = NoteCardTurnSchema.parse(input); const spaceId = getWorkspacePaths().activeSpaceId;
    if (turn.spaceId !== spaceId) throw new Error('作品不属于当前空间');
    return runInWorkspaceSpace(spaceId, async () => {
        const resolved = await readNoteCard(turn.path);
        return enqueueXhsMutation(resolved.projectPath, async () => {
            const current = await readNoteCard(turn.path); const runtime = structuredClone(current.runtime);
            const digest = createHash('sha256').update(JSON.stringify({ operation, value, revision: turn.expectedRevision, epoch: turn.expectedDraftEpoch })).digest('hex');
            const receipt = runtime.receipts.find(receipt => receipt.id === turn.requestId);
            if (receipt) { if (receipt.digest !== digest) throw new Error('同一请求 ID 对应不同修改'); return current; }
            const content = operation === 'save' ? NoteCardContentSchema.parse(value) : undefined;
            const stale = current.version !== turn.expectedRevision || runtime.draftEpoch !== turn.expectedDraftEpoch;
            if (operation !== 'mark' && stale) {
                if (origin === 'ai' && content && !runtime.unapplied.some(item => item.id === turn.requestId)) { runtime.unapplied = [...runtime.unapplied, { id: turn.requestId, content, reason: '作品或手动输入已变化' }].slice(-5); await saveXhsNoteProjectUnlocked({ path: current.relativePath, expectedRevision: current.version, document: { cardRuntime: runtime }, trustedNoteCardState: true }); }
                throw new Error('作品或手动输入已变化，修改未应用；请按最新内容重试');
            }
            if (origin === 'ai' && content && JSON.stringify(content.creationConfig.sourceRefs) !== JSON.stringify(current.content.creationConfig.sourceRefs)) throw new Error('来源绑定由用户在作品设置中明确更改，AI 修改必须保留已绑定来源');
            let next = current.content;
            if (operation === 'mark') runtime.draftEpoch++;
            else if (operation === 'save' && turn.policy === 'propose' && origin === 'ai') {
                await validateCardSources(content!, current.content);
                runtime.proposal = { id: turn.requestId, basedOnRevision: current.version + 1, basedOnEpoch: runtime.draftEpoch, content: content! };
            } else if (operation === 'dismiss') runtime.proposal = undefined;
            else {
                if (operation === 'undo') { const previous = runtime.undo.pop(); if (!previous) throw new Error('没有可撤销的修改'); next = previous; }
                else {
                    if (operation === 'apply') { if (!runtime.proposal || runtime.proposal.basedOnRevision !== current.version || runtime.proposal.basedOnEpoch !== runtime.draftEpoch) throw new Error('重组方案已过期，请重新生成'); next = runtime.proposal.content; }
                    else next = content!;
                    await validateCardSources(next, current.content);
                    runtime.undo = [...runtime.undo, current.content].slice(-30);
                }
                runtime.proposal = undefined;
            }
            runtime.receipts = [...runtime.receipts, { id: turn.requestId, digest }].slice(-100);
            const saved = await saveXhsNoteProjectUnlocked({ path: current.relativePath, document: { ...next, cardRuntime: runtime }, expectedRevision: current.version, trustedNoteCardState: true });
            if (!current.content.imagePages.some(page => page.title.trim() || page.copy.trim()) && next.imagePages.some(page => page.title.trim() || page.copy.trim())) await recordCreationMetric('draft.' + next.creationConfig.presetId);
            return { ...saved, runtime, content: cardContent(saved.document) };
        });
    });
}
export async function noteCardTurn(inputPath: string, selectedId?: string, policy: NoteCardTurn['policy'] = 'direct'): Promise<NoteCardTurn> {
    const current = await readNoteCard(inputPath);
    if (selectedId && !current.content.imagePages.some(page => page.id === selectedId)) throw new Error('选中页面不存在');
    return { path: current.relativePath, spaceId: getWorkspacePaths().activeSpaceId, expectedRevision: current.version, expectedDraftEpoch: current.runtime.draftEpoch, selectedId, policy, requestId: randomUUID() };
}
