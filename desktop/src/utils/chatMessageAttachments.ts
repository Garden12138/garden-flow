type UnknownRecord = Record<string, unknown>;

function objectRecord(value: unknown): UnknownRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : null;
}

export function parseChatMessageJson(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    const text = value.trim();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

export function chatMessageMetadataRecord(value: unknown): UnknownRecord {
    return objectRecord(parseChatMessageJson(value)) || {};
}

function uploadedAttachment(value: unknown): UnknownRecord | null {
    const record = objectRecord(value);
    if (!record || String(record.type || '').trim() !== 'uploaded-file') return null;
    return record;
}

export function chatAttachmentIdentity(value: unknown): string {
    const record = objectRecord(value);
    if (!record) return '';
    return String(
        record.attachmentId
        || record.absolutePath
        || record.workspaceRelativePath
        || record.toolPath
        || record.localUrl
        || record.name
        || '',
    ).trim();
}

function mergeUploadedAttachments(...sources: unknown[][]): UnknownRecord[] {
    const merged: UnknownRecord[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
        for (const value of source) {
            const attachment = uploadedAttachment(value);
            if (!attachment) continue;
            const identity = chatAttachmentIdentity(attachment);
            if (identity && seen.has(identity)) continue;
            if (identity) seen.add(identity);
            merged.push(attachment);
        }
    }
    return merged;
}

/**
 * Restores the complete attachment list for a persisted chat message.
 * `metadata.uploadedAttachments` is canonical for multi-file messages; the
 * `attachment` column carries the primary attachment used by message cards.
 */
export function uploadedAttachmentsFromPersistedMessage(message: {
    attachments?: unknown;
    attachment?: unknown;
    metadata?: unknown;
}): UnknownRecord[] {
    const explicit = Array.isArray(message.attachments) ? message.attachments : [];
    const metadata = chatMessageMetadataRecord(message.metadata);
    const fromMetadata = Array.isArray(metadata.uploadedAttachments)
        ? metadata.uploadedAttachments
        : [];
    const parsedAttachment = parseChatMessageJson(message.attachment);
    const primaryColumnItems = Array.isArray(parsedAttachment)
        ? parsedAttachment
        : parsedAttachment
            ? [parsedAttachment]
            : [];
    return mergeUploadedAttachments(explicit, fromMetadata, primaryColumnItems);
}

export function primaryAttachmentFromPersistedMessage(message: {
    attachments?: unknown;
    attachment?: unknown;
    metadata?: unknown;
}): UnknownRecord | undefined {
    const parsedAttachment = parseChatMessageJson(message.attachment);
    const primary = Array.isArray(parsedAttachment)
        ? objectRecord(parsedAttachment[0])
        : objectRecord(parsedAttachment);
    if (primary && String(primary.type || '').trim() !== 'uploaded-file') return primary;
    return uploadedAttachmentsFromPersistedMessage(message)[0];
}
