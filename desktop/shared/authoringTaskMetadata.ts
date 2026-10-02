/** Keep a new composer selection while using only recovered, validated project bindings. */
export function mergeAuthoringTaskMetadata(
    sessionMetadata: Record<string, unknown>,
    taskHints: Record<string, unknown>,
): Record<string, unknown> {
    const metadata = { ...sessionMetadata, ...taskHints };
    const hasBindingHint = Boolean(
        sessionMetadata.activeXhsNotePath
        || sessionMetadata.activeXhsNoteUri
        || taskHints.activeXhsNotePath
        || taskHints.activeXhsNoteUri
        || taskHints.xhsNoteType
        || taskHints.artifactType === 'xiaohongshu-note',
    );
    if (!hasBindingHint) return metadata;

    const hasRecoveredProject = Boolean(sessionMetadata.activeXhsNotePath || sessionMetadata.activeXhsNoteUri);
    return {
        ...metadata,
        artifactType: sessionMetadata.artifactType,
        activeXhsNotePath: sessionMetadata.activeXhsNotePath,
        activeXhsNoteUri: sessionMetadata.activeXhsNoteUri,
        xhsNoteType: hasRecoveredProject ? sessionMetadata.xhsNoteType : taskHints.xhsNoteType,
    };
}
