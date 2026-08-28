export type ChatRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ChatRunPhase = 'queued' | 'thinking' | 'tool' | 'responding' | 'completed' | 'failed' | 'cancelled';

export interface ChatSendReceipt {
    accepted: boolean;
    sessionId: string;
    runId: string;
    userMessageId: string;
    assistantMessageId: string;
    error?: string;
}

export interface ChatRunSnapshot {
    sessionId: string;
    runId: string;
    userMessageId: string;
    assistantMessageId: string;
    taskId?: string;
    status: ChatRunStatus;
    phase: ChatRunPhase;
    content: string;
    sequence: number;
    startedAt: number;
    updatedAt: number;
    finishedAt?: number;
    error?: string;
}

export interface ChatRunEvent {
    eventId: string;
    eventType: string;
    sessionId: string;
    runId: string;
    userMessageId?: string;
    assistantMessageId: string;
    sequence: number;
    phase: ChatRunPhase;
    status: ChatRunStatus;
    taskId?: string | null;
    runtimeId?: string | null;
    parentRuntimeId?: string | null;
    payload: Record<string, unknown>;
    timestamp: number;
}

export interface ChatRunMessageState {
    messageKind: 'chat-run';
    runId: string;
    status: ChatRunStatus;
    startedAt: number;
    userMessageId?: string;
    assistantMessageId?: string;
    phase?: ChatRunPhase;
    sequence?: number;
    updatedAt?: number;
    finishedAt?: number;
    error?: string;
}

export function buildChatRunMessageMetadata(state: ChatRunMessageState): string {
    return JSON.stringify(state);
}

export function parseChatRunMessageMetadata(raw: unknown): ChatRunMessageState | null {
    let value: unknown = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return null;
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    if (record.messageKind !== 'chat-run') return null;
    const runId = String(record.runId || '').trim();
    const status = String(record.status || '').trim() as ChatRunStatus;
    const startedAt = Number(record.startedAt);
    if (!runId || !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(status)) return null;
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null;

    const finishedAt = Number(record.finishedAt);
    const error = String(record.error || '').trim();
    const userMessageId = String(record.userMessageId || '').trim();
    const assistantMessageId = String(record.assistantMessageId || '').trim();
    const rawPhase = String(record.phase || '').trim() as ChatRunPhase;
    const phase = ['queued', 'thinking', 'tool', 'responding', 'completed', 'failed', 'cancelled'].includes(rawPhase)
        ? rawPhase
        : undefined;
    const sequence = Number(record.sequence);
    const updatedAt = Number(record.updatedAt);
    return {
        messageKind: 'chat-run',
        runId,
        status,
        startedAt,
        ...(userMessageId ? { userMessageId } : {}),
        ...(assistantMessageId ? { assistantMessageId } : {}),
        ...(phase ? { phase } : {}),
        ...(Number.isFinite(sequence) && sequence >= 0 ? { sequence } : {}),
        ...(Number.isFinite(updatedAt) && updatedAt > 0 ? { updatedAt } : {}),
        finishedAt: Number.isFinite(finishedAt) && finishedAt > 0 ? finishedAt : undefined,
        error: error || undefined,
    };
}
