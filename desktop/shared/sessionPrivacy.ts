export function isProjectPrivateSession(session: { metadata?: unknown }): boolean {
    let metadata = session.metadata;
    if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { return false; } }
    if (!metadata || typeof metadata !== 'object') return false;
    const value = metadata as Record<string, unknown>;
    return value.contextType === 'dream-story' || value.privacyScope === 'project';
}
export function memoryEligibleSessions<T extends { metadata?: unknown }>(sessions: T[]): T[] {
    return sessions.filter(session => !isProjectPrivateSession(session));
}
