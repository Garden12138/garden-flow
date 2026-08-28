export interface ChatMessageSnapshot {
    id: string;
    clientMessageId?: string;
    role?: string;
    content?: string;
    displayContent?: string;
    createdAt?: number;
    processingStartedAt?: number;
    runId?: string;
    runSequence?: number;
    isStreaming?: boolean;
    timeline?: Array<{ id?: string; status?: string; toolData?: { callId?: string } }>;
    tools?: unknown[];
    attachment?: unknown;
    attachments?: unknown[];
}

function sequenceOf(message: ChatMessageSnapshot): number {
    const sequence = Number(message.runSequence);
    return Number.isFinite(sequence) ? sequence : -1;
}

function timelineIdentity(item: NonNullable<ChatMessageSnapshot['timeline']>[number], index: number): string {
    return String(item.id || item.toolData?.callId || `timeline:${index}`);
}

function mergeTimeline(
    persisted: ChatMessageSnapshot['timeline'],
    cached: ChatMessageSnapshot['timeline'],
): ChatMessageSnapshot['timeline'] {
    if (!persisted?.length) return cached;
    if (!cached?.length) return persisted;
    const merged = new Map<string, NonNullable<ChatMessageSnapshot['timeline']>[number]>();
    persisted.forEach((item, index) => merged.set(timelineIdentity(item, index), item));
    cached.forEach((item, index) => {
        const identity = timelineIdentity(item, index);
        const previous = merged.get(identity);
        if (!previous) {
            merged.set(identity, item);
            return;
        }
        const cachedIsTerminal = item.status === 'done' || item.status === 'failed';
        const persistedIsTerminal = previous.status === 'done' || previous.status === 'failed';
        merged.set(identity, cachedIsTerminal || !persistedIsTerminal ? { ...previous, ...item } : { ...item, ...previous });
    });
    return [...merged.values()];
}

function chooseContent(persisted: ChatMessageSnapshot, cached: ChatMessageSnapshot): string | undefined {
    const persistedContent = String(persisted.content || '');
    const cachedContent = String(cached.content || '');
    const persistedSequence = sequenceOf(persisted);
    const cachedSequence = sequenceOf(cached);
    if (cachedSequence > persistedSequence) return cachedContent;
    if (persistedSequence > cachedSequence) return persistedContent;
    if (!persistedContent) return cachedContent;
    if (!cachedContent) return persistedContent;
    if (cachedContent.startsWith(persistedContent)) return cachedContent;
    if (persistedContent.startsWith(cachedContent)) return persistedContent;
    return persistedContent;
}

function messageTimestamp(message: ChatMessageSnapshot): number | null {
    const explicit = Number(message.createdAt ?? message.processingStartedAt);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    if (/^\d{10,}$/.test(message.id)) {
        const fromId = Number(message.id);
        if (Number.isFinite(fromId)) return fromId;
    }
    return null;
}

function semanticContent(message: ChatMessageSnapshot): string {
    return String(message.displayContent || message.content || '').trim();
}

function contentCompatible(left: ChatMessageSnapshot, right: ChatMessageSnapshot): boolean {
    const leftContent = semanticContent(left);
    const rightContent = semanticContent(right);
    if (!leftContent || !rightContent) return true;
    return leftContent === rightContent
        || leftContent.startsWith(rightContent)
        || rightContent.startsWith(leftContent);
}

function findCachedMatchIndex(
    persisted: ChatMessageSnapshot,
    cachedMessages: ChatMessageSnapshot[],
    usedIndexes: Set<number>,
): number {
    const exact = cachedMessages.findIndex((cached, index) => (
        !usedIndexes.has(index)
        && (
            cached.id === persisted.id
            || cached.id === persisted.clientMessageId
            || cached.clientMessageId === persisted.id
            || Boolean(cached.runId && persisted.runId && cached.runId === persisted.runId)
        )
    ));
    if (exact >= 0) return exact;

    const persistedTimestamp = messageTimestamp(persisted);
    if (persistedTimestamp === null) return -1;
    let closestIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;
    cachedMessages.forEach((cached, index) => {
        if (usedIndexes.has(index) || cached.role !== persisted.role || !contentCompatible(cached, persisted)) return;
        const cachedTimestamp = messageTimestamp(cached);
        if (cachedTimestamp === null) return;
        const distance = Math.abs(cachedTimestamp - persistedTimestamp);
        if (distance <= 30_000 && distance < closestDistance) {
            closestIndex = index;
            closestDistance = distance;
        }
    });
    return closestIndex;
}

function chooseAttachments(persisted: ChatMessageSnapshot, cached: ChatMessageSnapshot): unknown[] | undefined {
    const persistedAttachments = persisted.attachments || [];
    const cachedAttachments = cached.attachments || [];
    return cachedAttachments.length > persistedAttachments.length
        ? cachedAttachments
        : persisted.attachments;
}

export function reconcileOptimisticChatMessageIds<T extends ChatMessageSnapshot>(
    messages: T[],
    input: {
        optimisticUserMessageId?: string;
        optimisticAssistantMessageId?: string;
        userMessageId: string;
        assistantMessageId: string;
        runId: string;
    },
): T[] {
    return messages.map((message) => {
        if (message.id === input.optimisticUserMessageId) {
            return { ...message, id: input.userMessageId, clientMessageId: input.optimisticUserMessageId };
        }
        if (message.id === input.optimisticAssistantMessageId) {
            return {
                ...message,
                id: input.assistantMessageId,
                clientMessageId: input.optimisticAssistantMessageId,
                runId: input.runId,
                runSequence: 0,
            };
        }
        return message;
    }) as T[];
}

/**
 * Reconciles a database snapshot with the renderer's warmer session snapshot.
 * Persisted identity and newer run sequences win, while richer live content and
 * execution details are retained when the database snapshot is older or sparse.
 */
export function mergeChatMessageSnapshots<T extends ChatMessageSnapshot>(
    persistedMessages: T[],
    cachedMessages: T[],
): T[] {
    if (cachedMessages.length === 0) return persistedMessages;
    if (persistedMessages.length === 0) return cachedMessages;

    const usedCachedIndexes = new Set<number>();
    const merged = persistedMessages.map((persisted) => {
        const cachedIndex = findCachedMatchIndex(persisted, cachedMessages, usedCachedIndexes);
        const cached = cachedIndex >= 0 ? cachedMessages[cachedIndex] : undefined;
        if (!cached) return persisted;
        usedCachedIndexes.add(cachedIndex);
        const cachedIsNewer = sequenceOf(cached) > sequenceOf(persisted);
        const base = cachedIsNewer
            ? { ...persisted, ...cached }
            : { ...cached, ...persisted };
        return {
            ...base,
            content: chooseContent(persisted, cached),
            timeline: mergeTimeline(persisted.timeline, cached.timeline),
            tools: (cached.tools?.length || 0) > (persisted.tools?.length || 0)
                ? cached.tools
                : persisted.tools,
            attachment: chooseAttachments(persisted, cached)?.[0] || persisted.attachment || cached.attachment,
            attachments: chooseAttachments(persisted, cached),
        } as T;
    });
    const newestPersistedTimestamp = Math.max(
        0,
        ...persistedMessages.map((message) => messageTimestamp(message) || 0),
    );
    cachedMessages.forEach((message, index) => {
        if (usedCachedIndexes.has(index)) return;
        const nextMessageIsStreaming = Boolean(cachedMessages[index + 1]?.isStreaming);
        const timestamp = messageTimestamp(message) || 0;
        if (message.isStreaming || nextMessageIsStreaming || timestamp > newestPersistedTimestamp + 1_000) {
            merged.push(message);
        }
    });
    return merged;
}
