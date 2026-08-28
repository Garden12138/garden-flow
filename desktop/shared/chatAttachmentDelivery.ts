export function attachmentRequiresDirectModelInput(attachment: Record<string, unknown>): boolean {
    const deliveryPlan = attachment.deliveryPlan && typeof attachment.deliveryPlan === 'object'
        ? attachment.deliveryPlan as Record<string, unknown>
        : {};
    const deliveryMode = String(attachment.deliveryMode || deliveryPlan.mode || '').trim();
    const stableToolPath = String(
        attachment.toolPath
        || attachment.workspaceRelativePath
        || attachment.absolutePath
        || '',
    ).trim();
    return deliveryMode === 'direct-input' || (!stableToolPath && Boolean(attachment.requiresMultimodal));
}

export function attachmentParticipatesInChatRuntime(attachment: { displayOnly?: unknown }): boolean {
    return attachment.displayOnly !== true;
}
