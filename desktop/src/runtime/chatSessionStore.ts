import { useSyncExternalStore } from 'react';
import type { ChatRunPhase, ChatRunStatus } from '../../shared/chatRunState';

type UnknownRecord = Record<string, unknown>;

export interface ChatSessionRunState {
    sessionId: string;
    runId: string;
    userMessageId: string;
    assistantMessageId: string;
    sequence: number;
    status: ChatRunStatus;
    phase: ChatRunPhase;
    content: string;
    startedAt: number;
    updatedAt: number;
}

export interface ChatSessionCache<TMessage = unknown, TContext = unknown> {
    sessionId: string;
    messages: TMessage[];
    contextUsage: TContext | null;
    draft: string;
    pendingAttachments: unknown[];
    runtimeEvents: unknown[];
    run: ChatSessionRunState | null;
    scrollTop: number;
    wasNearBottom: boolean;
    unreadCount: number;
    updatedAt: number;
}

export interface ChatSessionActivity {
    sessionId: string;
    status: ChatRunStatus | 'idle';
    phase: ChatRunPhase | 'idle';
    unreadCount: number;
    updatedAt: number;
}

export function resolveChatSendSessionId(input: {
    forceNewSession: boolean;
    fixedSessionId?: string | null;
    currentSessionIdRef?: string | null;
    currentSessionId?: string | null;
}): string | null {
    if (input.forceNewSession) return null;
    return toText(input.fixedSessionId)
        || toText(input.currentSessionIdRef)
        || toText(input.currentSessionId)
        || null;
}

const MAX_CACHED_SESSIONS = 20;
const MAX_CACHED_RUNTIME_EVENTS = 2_000;
const caches = new Map<string, ChatSessionCache>();
const listeners = new Set<() => void>();
let activitySnapshot: ChatSessionActivity[] = [];
let started = false;

function toRecord(value: unknown): UnknownRecord {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : {};
}

function toText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function trimCache(): void {
    if (caches.size <= MAX_CACHED_SESSIONS) return;
    const oldest = [...caches.values()]
        .filter((cache) => cache.run?.status !== 'running' && cache.run?.status !== 'queued')
        .sort((left, right) => left.updatedAt - right.updatedAt)[0];
    if (oldest) caches.delete(oldest.sessionId);
}

function emitChange(): void {
    activitySnapshot = [...caches.values()].map((cache) => ({
        sessionId: cache.sessionId,
        status: cache.run?.status || 'idle',
        phase: cache.run?.phase || 'idle',
        unreadCount: cache.unreadCount,
        updatedAt: cache.updatedAt,
    }));
    listeners.forEach((listener) => listener());
}

function ensureCache(sessionId: string): ChatSessionCache {
    const existing = caches.get(sessionId);
    if (existing) {
        caches.delete(sessionId);
        caches.set(sessionId, existing);
        return existing;
    }
    const created: ChatSessionCache = {
        sessionId,
        messages: [],
        contextUsage: null,
        draft: '',
        pendingAttachments: [],
        runtimeEvents: [],
        run: null,
        scrollTop: 0,
        wasNearBottom: true,
        unreadCount: 0,
        updatedAt: Date.now(),
    };
    caches.set(sessionId, created);
    trimCache();
    return created;
}

function runtimeEventRecord(value: unknown): UnknownRecord {
    return toRecord(value);
}

function runtimeEventIdentity(value: unknown): string {
    const event = runtimeEventRecord(value);
    const payload = toRecord(event.payload);
    const runId = toText(event.runId || event.run_id || payload.runId || payload.run_id);
    const sequence = Number(event.sequence ?? payload.sequence);
    const eventType = toText(event.eventType || event.event_type || event.type);
    if (runId && Number.isFinite(sequence)) return `${runId}:${sequence}:${eventType}`;
    const explicitId = toText(event.eventId || event.event_id || event.id);
    if (explicitId) return explicitId;
    return '';
}

export function mergeChatRuntimeEvents(...sources: unknown[][]): unknown[] {
    const merged = new Map<string, unknown>();
    let anonymousIndex = 0;
    for (const source of sources) {
        for (const event of source) {
            const identity = runtimeEventIdentity(event) || `anonymous:${anonymousIndex++}`;
            merged.set(identity, event);
        }
    }
    return [...merged.values()].slice(-MAX_CACHED_RUNTIME_EVENTS);
}

export function reduceChatRunEnvelope(
    previous: ChatSessionRunState | null,
    rawEnvelope: unknown,
): ChatSessionRunState | null {
    const envelope = toRecord(rawEnvelope);
    const payload = toRecord(envelope.payload);
    const sessionId = toText(envelope.sessionId);
    const runId = toText(envelope.runId || payload.runId);
    const assistantMessageId = toText(envelope.assistantMessageId || payload.assistantMessageId);
    const sequence = Number(envelope.sequence ?? payload.sequence);
    if (!sessionId || !runId || !assistantMessageId || !Number.isFinite(sequence)) return previous;
    if (previous?.runId === runId && sequence <= previous.sequence) return previous;
    const eventTimestamp = Number(envelope.timestamp || Date.now());
    const startedAt = Number(payload.startedAt || eventTimestamp);
    if (previous?.runId !== runId && previous && startedAt < previous.startedAt) return previous;
    const eventType = toText(envelope.eventType);
    const checkpointType = toText(payload.checkpointType);
    const checkpointPayload = toRecord(payload.payload);
    let status = (toText(envelope.status) || previous?.status || 'running') as ChatRunStatus;
    let phase = (toText(envelope.phase) || previous?.phase || 'thinking') as ChatRunPhase;
    let content = previous?.runId === runId ? previous.content : '';

    if (eventType === 'runtime:text-delta' && toText(payload.stream || 'response') !== 'thought') {
        content += String(payload.content || '');
        phase = 'responding';
        status = 'running';
    } else if (eventType === 'runtime:done') {
        content = String(payload.content || content);
        phase = 'completed';
        status = 'completed';
    } else if (checkpointType === 'chat.error') {
        const errorPayload = checkpointPayload;
        if (!content) content = `处理未完成：${String(errorPayload.message || errorPayload.raw || '任务执行失败')}`;
        phase = 'failed';
        status = 'failed';
    } else if (checkpointType === 'chat.cancelled') {
        if (!content) content = '已停止当前回复。';
        phase = 'cancelled';
        status = 'cancelled';
    }

    return {
        sessionId,
        runId,
        userMessageId: toText(envelope.userMessageId || payload.userMessageId),
        assistantMessageId,
        sequence,
        status,
        phase,
        content,
        startedAt,
        updatedAt: eventTimestamp,
    };
}

function ingestRuntimeEnvelope(rawEnvelope: unknown): void {
    const envelope = toRecord(rawEnvelope);
    const sessionId = toText(envelope.sessionId);
    if (!sessionId) return;
    const cache = ensureCache(sessionId);
    cache.runtimeEvents = mergeChatRuntimeEvents(cache.runtimeEvents, [rawEnvelope]);
    const previousRun = cache.run;
    const nextRun = reduceChatRunEnvelope(previousRun, rawEnvelope);
    if (!nextRun || nextRun === previousRun) return;
    const wasTerminal = previousRun?.status === 'completed' || previousRun?.status === 'failed' || previousRun?.status === 'cancelled';
    const isTerminal = nextRun.status === 'completed' || nextRun.status === 'failed' || nextRun.status === 'cancelled';
    cache.run = nextRun;
    cache.updatedAt = cache.run.updatedAt;
    if (!wasTerminal && isTerminal) cache.unreadCount += 1;
    emitChange();
}

export function ensureChatSessionStoreStarted(): void {
    if (started || typeof window === 'undefined' || !window.ipcRenderer?.runtime) return;
    started = true;
    window.ipcRenderer.runtime.onEvent((_: unknown, envelope?: unknown) => {
        ingestRuntimeEnvelope(envelope);
    });
}

export function readChatSessionCache<TMessage, TContext>(sessionId: string | null | undefined): ChatSessionCache<TMessage, TContext> | null {
    const key = toText(sessionId);
    if (!key) return null;
    return (caches.get(key) as ChatSessionCache<TMessage, TContext> | undefined) || null;
}

export function writeChatSessionCache<TMessage, TContext>(
    sessionId: string | null | undefined,
    patch: Partial<Omit<ChatSessionCache<TMessage, TContext>, 'sessionId'>>,
): void {
    const key = toText(sessionId);
    if (!key) return;
    const cache = ensureCache(key) as ChatSessionCache<TMessage, TContext>;
    Object.assign(cache, patch, { updatedAt: Date.now() });
    if (Object.prototype.hasOwnProperty.call(patch, 'run') || Object.prototype.hasOwnProperty.call(patch, 'unreadCount')) {
        emitChange();
    }
}

export function clearChatSessionCache(sessionId: string | null | undefined): void {
    const key = toText(sessionId);
    if (!key) return;
    caches.delete(key);
    emitChange();
}

export function markChatSessionRead(sessionId: string): void {
    const cache = caches.get(sessionId);
    if (!cache || cache.unreadCount === 0) return;
    cache.unreadCount = 0;
    emitChange();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getActivitySnapshot(): ChatSessionActivity[] {
    return activitySnapshot;
}

export function useChatSessionActivities(): ChatSessionActivity[] {
    ensureChatSessionStoreStarted();
    return useSyncExternalStore(subscribe, getActivitySnapshot, getActivitySnapshot);
}
