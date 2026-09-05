import { BrowserWindow } from 'electron';
import {
    addChatMessage,
    getChatMessages,
    updateChatMessage,
} from '../db';
import { getSessionRuntimeStore } from './sessionRuntimeStore';
import {
    buildChatRunMessageMetadata,
    parseChatRunMessageMetadata,
    type ChatRunEvent,
    type ChatRunPhase,
    type ChatRunSnapshot,
    type ChatRunStatus,
    type ChatSendReceipt,
} from '../../shared/chatRunState';

type UnknownRecord = Record<string, unknown>;

interface NormalizedRuntimeEvent {
    eventType: string;
    phase: ChatRunPhase;
    payload: UnknownRecord;
}

function toRecord(value: unknown): UnknownRecord {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : {};
}

function normalizeRuntimeEvent(channel: string, data: unknown): NormalizedRuntimeEvent | null {
    const payload = toRecord(data);
    switch (channel) {
        case 'chat:phase-start':
            return {
                eventType: 'runtime:stream-start',
                phase: 'thinking',
                payload: { ...payload, phase: String(payload.name || 'thinking'), stream: 'thought' },
            };
        case 'chat:thought-start':
            return {
                eventType: 'runtime:stream-start',
                phase: 'thinking',
                payload: { ...payload, phase: 'thinking', stream: 'thought', messagePhase: 'thought' },
            };
        case 'chat:thought-delta':
            return {
                eventType: 'runtime:text-delta',
                phase: 'thinking',
                payload: { ...payload, stream: 'thought', messagePhase: 'thought' },
            };
        case 'chat:thought-end':
            return {
                eventType: 'runtime:checkpoint',
                phase: 'thinking',
                payload: { checkpointType: 'chat.thought_end', payload },
            };
        case 'chat:response-chunk':
            return {
                eventType: 'runtime:text-delta',
                phase: 'responding',
                payload: { ...payload, stream: 'response', messagePhase: 'final_answer' },
            };
        case 'chat:tool-start':
            return { eventType: 'runtime:tool-start', phase: 'tool', payload };
        case 'chat:tool-update':
            return { eventType: 'runtime:tool-update', phase: 'tool', payload };
        case 'chat:tool-end':
            return { eventType: 'runtime:tool-end', phase: 'tool', payload };
        case 'chat:plan-updated':
            return {
                eventType: 'runtime:checkpoint',
                phase: 'thinking',
                payload: { checkpointType: 'chat.plan_updated', payload },
            };
        case 'chat:response-end':
            return {
                eventType: 'runtime:done',
                phase: 'completed',
                payload: { ...payload, status: 'completed' },
            };
        case 'chat:error':
            return {
                eventType: 'runtime:checkpoint',
                phase: 'failed',
                payload: { checkpointType: 'chat.error', payload },
            };
        case 'chat:cancelled':
            return {
                eventType: 'runtime:checkpoint',
                phase: 'cancelled',
                payload: { checkpointType: 'chat.cancelled', payload },
            };
        case 'chat:skill-activated':
            return {
                eventType: 'runtime:checkpoint',
                phase: 'thinking',
                payload: { checkpointType: 'chat.skill_activated', payload },
            };
        case 'chat:tool-confirm-request':
            return {
                eventType: 'runtime:checkpoint',
                phase: 'tool',
                payload: { checkpointType: 'chat.tool_confirm_request', payload },
            };
        default:
            return null;
    }
}

function broadcastRuntimeEvent(event: ChatRunEvent): void {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        if (browserWindow.isDestroyed()) continue;
        try {
            browserWindow.webContents.send('runtime:event', event);
        } catch (error) {
            console.error('[ChatRunLifecycle] Failed to broadcast runtime event:', error);
        }
    }
}

function createId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class ChatRunLifecycle {
    private sequence = 0;
    private status: ChatRunStatus = 'queued';
    private phase: ChatRunPhase = 'queued';
    private content = '';
    private updatedAt: number;
    private finishedAt?: number;
    private error?: string;
    private taskId?: string;
    private persistTimer: NodeJS.Timeout | null = null;

    constructor(
        readonly sessionId: string,
        readonly runId: string,
        readonly userMessageId: string,
        readonly assistantMessageId: string,
        readonly startedAt: number,
    ) {
        this.updatedAt = startedAt;
    }

    setTaskId(taskId: string | null | undefined): void {
        this.taskId = String(taskId || '').trim() || undefined;
    }

    markRunning(): void {
        if (this.isTerminal()) return;
        this.status = 'running';
        this.updatedAt = Date.now();
        this.persistNow();
    }

    publishChannelEvent(channel: string, data: unknown): ChatRunEvent | null {
        if (this.isTerminal()) return null;
        const normalized = normalizeRuntimeEvent(channel, data);
        if (!normalized) return null;

        if (this.status === 'queued') this.status = 'running';
        if (!this.isTerminal()) this.phase = normalized.phase;

        const sequence = ++this.sequence;
        const rawPayload = toRecord(data);
        if (channel === 'chat:response-chunk') {
            this.content += String(rawPayload.content || '');
            this.schedulePersist();
        } else if (channel === 'chat:response-end') {
            const finalContent = String(rawPayload.content || '').trim();
            this.complete(finalContent || this.content);
        } else if (channel === 'chat:error') {
            const error = String(rawPayload.raw || rawPayload.message || '任务执行失败');
            this.fail(error);
        } else if (channel === 'chat:cancelled') {
            this.cancel(String(rawPayload.reason || '用户已停止当前执行'));
        }

        const payload = {
            ...normalized.payload,
            runId: this.runId,
            userMessageId: this.userMessageId,
            assistantMessageId: this.assistantMessageId,
            startedAt: this.startedAt,
            sequence,
        };
        let persisted: {
            id: string;
            runtimeId?: string | null;
            parentRuntimeId?: string | null;
            createdAt: number;
        };
        try {
            persisted = getSessionRuntimeStore().appendRuntimeEvent({
                category: 'chat-run',
                eventType: normalized.eventType,
                sessionId: this.sessionId,
                taskId: this.taskId,
                payload,
            });
        } catch (error) {
            console.error('[ChatRunLifecycle] Failed to persist runtime event; continuing live delivery:', error);
            persisted = {
                id: createId('runtime_event'),
                createdAt: Date.now(),
            };
        }
        const event: ChatRunEvent = {
            eventId: persisted.id,
            eventType: normalized.eventType,
            sessionId: this.sessionId,
            runId: this.runId,
            userMessageId: this.userMessageId,
            assistantMessageId: this.assistantMessageId,
            sequence,
            phase: this.phase,
            status: this.status,
            taskId: this.taskId || null,
            runtimeId: persisted.runtimeId,
            parentRuntimeId: persisted.parentRuntimeId,
            payload,
            timestamp: persisted.createdAt,
        };
        broadcastRuntimeEvent(event);
        return event;
    }

    complete(content: string): void {
        if (this.status === 'completed') return;
        if (this.status === 'failed' || this.status === 'cancelled') return;
        this.content = String(content || this.content).trim();
        this.status = 'completed';
        this.phase = 'completed';
        this.finishedAt = Date.now();
        this.updatedAt = this.finishedAt;
        this.persistNow();
        activeRuns.delete(this.sessionId);
    }

    fail(error: string): void {
        if (this.isTerminal()) return;
        this.error = String(error || '任务执行失败').trim().slice(0, 6000);
        this.status = 'failed';
        this.phase = 'failed';
        this.finishedAt = Date.now();
        this.updatedAt = this.finishedAt;
        if (!this.content.trim()) this.content = `处理未完成：${this.error}`;
        this.persistNow();
        activeRuns.delete(this.sessionId);
    }

    cancel(reason: string): void {
        if (this.isTerminal()) return;
        this.error = String(reason || '用户已停止当前执行').trim();
        this.status = 'cancelled';
        this.phase = 'cancelled';
        this.finishedAt = Date.now();
        this.updatedAt = this.finishedAt;
        if (!this.content.trim()) this.content = '已停止当前回复。';
        this.persistNow();
        activeRuns.delete(this.sessionId);
    }

    snapshot(): ChatRunSnapshot {
        return {
            sessionId: this.sessionId,
            runId: this.runId,
            userMessageId: this.userMessageId,
            assistantMessageId: this.assistantMessageId,
            taskId: this.taskId,
            status: this.status,
            phase: this.phase,
            content: this.content,
            sequence: this.sequence,
            startedAt: this.startedAt,
            updatedAt: this.updatedAt,
            finishedAt: this.finishedAt,
            error: this.error,
        };
    }

    private isTerminal(): boolean {
        return this.status === 'completed' || this.status === 'failed' || this.status === 'cancelled';
    }

    private schedulePersist(): void {
        this.updatedAt = Date.now();
        if (this.persistTimer) return;
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            this.persistNow();
        }, 160);
    }

    private persistNow(): void {
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
        try {
            updateChatMessage(this.assistantMessageId, {
                content: this.content,
                metadata: buildChatRunMessageMetadata({
                    messageKind: 'chat-run',
                    runId: this.runId,
                    userMessageId: this.userMessageId,
                    assistantMessageId: this.assistantMessageId,
                    status: this.status,
                    phase: this.phase,
                    sequence: this.sequence,
                    startedAt: this.startedAt,
                    updatedAt: this.updatedAt,
                    finishedAt: this.finishedAt,
                    error: this.error,
                }),
            });
        } catch (error) {
            console.error('[ChatRunLifecycle] Failed to persist assistant snapshot:', error);
        }
    }
}

const activeRuns = new Map<string, ChatRunLifecycle>();

export function startChatRun(sessionId: string, userMessageId?: string): { receipt: ChatSendReceipt; run: ChatRunLifecycle } {
    const existing = activeRuns.get(sessionId);
    if (existing && ['queued', 'running'].includes(existing.snapshot().status)) {
        const snapshot = existing.snapshot();
        return {
            receipt: {
                accepted: false,
                sessionId,
                runId: snapshot.runId,
                userMessageId: snapshot.userMessageId,
                assistantMessageId: snapshot.assistantMessageId,
                error: '当前会话已有回复正在生成',
            },
            run: existing,
        };
    }

    const startedAt = Date.now();
    const runId = createId('chat_run');
    const resolvedUserMessageId = userMessageId || createId('chat_user');
    const assistantMessageId = createId('chat_assistant');
    addChatMessage({
        id: assistantMessageId,
        session_id: sessionId,
        role: 'assistant',
        content: '',
        metadata: buildChatRunMessageMetadata({
            messageKind: 'chat-run',
            runId,
            userMessageId: resolvedUserMessageId,
            assistantMessageId,
            status: 'queued',
            phase: 'queued',
            sequence: 0,
            startedAt,
            updatedAt: startedAt,
        }),
        timestamp: startedAt,
    });
    const run = new ChatRunLifecycle(
        sessionId,
        runId,
        resolvedUserMessageId,
        assistantMessageId,
        startedAt,
    );
    activeRuns.set(sessionId, run);
    return {
        receipt: {
            accepted: true,
            sessionId,
            runId,
            userMessageId: resolvedUserMessageId,
            assistantMessageId,
        },
        run,
    };
}

export function getActiveChatRun(sessionId: string): ChatRunLifecycle | null {
    return activeRuns.get(sessionId) || null;
}

export function getPersistedChatRunSnapshot(sessionId: string): ChatRunSnapshot | null {
    const active = activeRuns.get(sessionId);
    if (active) return active.snapshot();
    const messages = getChatMessages(sessionId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const metadata = parseChatRunMessageMetadata(message.metadata);
        if (!metadata) continue;
        return {
            sessionId,
            runId: metadata.runId,
            userMessageId: metadata.userMessageId || '',
            assistantMessageId: metadata.assistantMessageId || message.id,
            status: metadata.status,
            phase: metadata.phase || (metadata.status === 'running' ? 'thinking' : metadata.status),
            content: message.content,
            sequence: metadata.sequence || 0,
            startedAt: metadata.startedAt,
            updatedAt: metadata.updatedAt || metadata.finishedAt || metadata.startedAt,
            finishedAt: metadata.finishedAt,
            error: metadata.error,
        };
    }
    return null;
}
