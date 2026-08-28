export type BackgroundSessionPlan = {
  action: 'reuse' | 'create';
  discardExisting: boolean;
};

export function planBackgroundSession(input: {
  fresh?: boolean;
  existingCount: number;
}): BackgroundSessionPlan {
  if (input.fresh) {
    return {
      action: 'create',
      discardExisting: input.existingCount > 0,
    };
  }
  if (input.existingCount > 0) {
    return { action: 'reuse', discardExisting: false };
  }
  return { action: 'create', discardExisting: false };
}

export function createBackgroundSessionId(contextId: string, now = Date.now()): string {
  const safeContext = contextId.replace(/[^a-zA-Z0-9_:-]/g, '_');
  return `session_bg_${safeContext}_${now}_${Math.random().toString(36).slice(2, 8)}`;
}
