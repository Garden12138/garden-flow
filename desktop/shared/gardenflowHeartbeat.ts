export function gardenFlowHeartbeatSessionBinding(activeSpaceIdInput: string) {
    const activeSpaceId = String(activeSpaceIdInput || '').trim() || 'default';
    return {
        sessionId: `session_gardenflow_heartbeat_${activeSpaceId}`,
        contextId: `gardenflow-heartbeat:${activeSpaceId}`,
        contextType: 'gardenflow-heartbeat',
        title: `GardenFlow 心跳 · ${activeSpaceId}`,
    } as const;
}
