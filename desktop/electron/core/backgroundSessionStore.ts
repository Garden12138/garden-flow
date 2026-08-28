import {
  createChatSession,
  deleteChatSession,
  listChatSessionsByContext,
  updateChatSessionMetadata,
} from '../db';
import { createBackgroundSessionId, planBackgroundSession } from './backgroundSessionPlan';

export type BackgroundSessionSpec = {
  contextId: string;
  contextType: string;
  title: string;
  contextContent?: string;
  runtimeMode?: string;
  metadata?: Record<string, unknown>;
  fresh?: boolean;
};

export { createBackgroundSessionId, planBackgroundSession } from './backgroundSessionPlan';

export class BackgroundSessionStore {
  ensureSession(spec: BackgroundSessionSpec) {
    const existing = listChatSessionsByContext(spec.contextId, spec.contextType);
    const plan = planBackgroundSession({
      fresh: spec.fresh,
      existingCount: existing.length,
    });
    const nextMetadata = {
      contextId: spec.contextId,
      contextType: spec.contextType,
      contextContent: spec.contextContent || '',
      runtimeMode: spec.runtimeMode || 'background-maintenance',
      isContextBound: true,
      isBackgroundSession: true,
      ...spec.metadata,
    };

    if (plan.discardExisting) {
      for (const session of existing) {
        deleteChatSession(session.id);
      }
    }

    if (plan.action === 'reuse') {
      const session = existing[0];
      updateChatSessionMetadata(session.id, nextMetadata);
      return {
        ...session,
        metadata: JSON.stringify(nextMetadata),
      };
    }

    return createChatSession(
      createBackgroundSessionId(spec.contextId),
      spec.title,
      nextMetadata,
    );
  }
}

let backgroundSessionStore: BackgroundSessionStore | null = null;

export function getBackgroundSessionStore(): BackgroundSessionStore {
  if (!backgroundSessionStore) {
    backgroundSessionStore = new BackgroundSessionStore();
  }
  return backgroundSessionStore;
}
