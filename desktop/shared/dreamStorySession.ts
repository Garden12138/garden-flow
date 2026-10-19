/** Resolve only an explicit dream binding in the current workspace. */
export function dreamStorySessionProjectId(metadata: unknown, spaceId: string): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const value = metadata as Record<string, unknown>;
    const projectId = value.dreamStoryProjectId;
    if (value.contextType !== 'dream-story' || value.editorBindingKind !== 'dream-story'
        || value.spaceId !== spaceId || typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(projectId)
        || value.contextId !== `dream-story:${spaceId}:${projectId}`) return null;
    return projectId;
}
