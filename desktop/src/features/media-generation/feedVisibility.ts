import type { FeedEntry, GenerationFeedEntry } from './feedModel';

export function isSuccessfulAgentGenerationEntry(
    entry: FeedEntry,
    ownerSessionId?: string | null,
): entry is GenerationFeedEntry {
    return entry.kind === 'generation'
        && entry.status === 'success'
        && entry.queueMode === 'ai_generation'
        && Boolean(ownerSessionId)
        && entry.ownerSessionId === ownerSessionId;
}
