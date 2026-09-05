export function buildFallbackResponse(channel: string, error: unknown): any {
  const message = error instanceof Error ? error.message : String(error);
  if (channel === 'llm-readiness:get-state') {
    return {
      success: false,
      ready: false,
      mode: 'disabled',
      reason: 'host_unavailable',
      canUseCustom: true,
      updatedAt: new Date().toISOString(),
      error: message,
    };
  }
  return {
    success: false,
    error: `GardenFlow host request failed for "${channel}": ${message}`,
  };
}
