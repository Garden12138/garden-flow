export function isChatComposerTextEditable(input: {
    readOnly: boolean;
    disabled: boolean;
    isBusy: boolean;
}): boolean {
    // A running reply blocks another submit, but should not lock the draft
    // editor. Users can prepare or delete the next message while waiting.
    return !input.readOnly && !input.disabled;
}

export function canPersistChatComposerDraft(input: {
    sessionId: string | null | undefined;
    hydratedSessionId: string | null | undefined;
}): boolean {
    const sessionId = String(input.sessionId || '').trim();
    if (!sessionId) return false;
    return sessionId === String(input.hydratedSessionId || '').trim();
}
