import { parseChatRunMessageMetadata } from './chatRunState.ts';

type WarmMessageLike = {
    id: string;
    role: string;
    content?: unknown;
    isStreaming?: boolean;
    runSequence?: number;
};

type WarmSnapshotLike = {
    messages: WarmMessageLike[];
};

type PersistedMessageLike = {
    id?: unknown;
    content?: unknown;
    metadata?: unknown;
};

export function shouldPreserveFixedSessionWarmMessages(
    warm: WarmSnapshotLike | null,
    history: PersistedMessageLike[],
): boolean {
    if (!warm?.messages.length) return false;
    const activeMessage = [...warm.messages].reverse().find((message) => message.role === 'ai' && message.isStreaming);
    if (!activeMessage) return false;

    const persistedMessage = history.find((message) => message.id === activeMessage.id);
    const persistedRun = parseChatRunMessageMetadata(persistedMessage?.metadata);
    if (
        persistedRun?.status === 'completed'
        || persistedRun?.status === 'failed'
        || persistedRun?.status === 'cancelled'
    ) {
        return false;
    }

    if (history.length < warm.messages.length) return true;
    if (!persistedMessage) return true;
    if ((activeMessage.runSequence || 0) > (persistedRun?.sequence || 0)) return true;
    return String(activeMessage.content || '').length > String(persistedMessage.content || '').length;
}
