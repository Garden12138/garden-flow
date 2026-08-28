export function mergeContextSessionMetadata(params: {
    currentMetadata?: Record<string, unknown> | null;
    requestedMetadata?: Record<string, unknown> | null;
    contextId: string;
    contextType: string;
    initialContext?: string;
}): Record<string, unknown> {
    const currentMetadata = params.currentMetadata || {};
    return {
        ...currentMetadata,
        ...(params.requestedMetadata || {}),
        contextId: params.contextId,
        contextType: params.contextType,
        contextContent: params.initialContext === undefined
            ? String(currentMetadata.contextContent || '')
            : params.initialContext,
        isContextBound: true,
    };
}
