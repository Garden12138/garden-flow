import type { BridgeCore } from '../types';
import type { NoteCardContent, NoteCardTurn } from '../../../shared/noteCards';
import type { XhsNoteProjectSnapshot } from '../../../shared/xhsNote';
export interface NoteCardResult extends XhsNoteProjectSnapshot { content: NoteCardContent; runtime: import('../../../shared/noteCards').NoteCardRuntime; outputs?: Record<string, { state: 'ready' | 'stale' | 'missing' | 'failed'; previewUrl?: string; error?: string }>; }
export function createNoteCardBridge(core: BridgeCore) {
    const invoke = <T>(name: string, input: unknown) => core.invokeChannel(`note-card:${name}`, input) as Promise<{ success: boolean; error?: string; result?: T }>;
    return { noteCard: {
        generationConfig: () => invoke<{ configured: boolean; model: string; reason?: string; configurationKey: string }>('generation-config', {}),
        generate: (input: { path: string; pageId: string; expectedRevision: number; requestId: string; confirmed: true; reviewedConfigurationKey: string }) => invoke<NoteCardResult & { warning?: string }>('generate', input),
        read: (path: string) => invoke<NoteCardResult>('read', { path }),
        turn: (path: string, selectedId?: string, policy?: NoteCardTurn['policy']) => invoke<NoteCardTurn>('turn', { path, selectedId, policy }),
        save: (turn: NoteCardTurn, content: NoteCardContent) => invoke<NoteCardResult>('save', { turn, content }),
        undo: (turn: NoteCardTurn) => invoke<NoteCardResult>('undo', { turn }),
        mark: (turn: NoteCardTurn) => invoke<NoteCardResult>('mark', { turn }),
        apply: (turn: NoteCardTurn) => invoke<NoteCardResult>('apply', { turn }),
        dismiss: (turn: NoteCardTurn) => invoke<NoteCardResult>('dismiss', { turn }),
        importSource: (input: { kind: 'attachment' | 'knowledge' | 'manuscript'; path: string; sourceId?: string; itemId?: string; name?: string }) => invoke<import('../../../shared/noteCards').SourceRef & { status: string; error?: string }>('import-source', input),
        source: (input: { path: string; sourceId: string; reread?: boolean; offset?: number; limit?: number }) => invoke<any>('source', input),
        preview: (input: Record<string, unknown>) => invoke<{ html: string; fingerprint: string }>('preview', input),
        export: (input: { path: string; expectedRevision: number; format: 'png' | 'directory' | 'zip'; pageId?: string }) => invoke<{ canceled?: boolean; complete: boolean; outputPath?: string; failures: Array<{ pageId: string; index: number; error: string }>; rendered: number }>('export', input),
    } };
}
