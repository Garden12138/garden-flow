import type { IntentRoute, RuntimeMode } from './types';

export function readSkipSubagentOrchestration(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const record = metadata as Record<string, unknown>;
  if (Boolean(record.skipSubagentOrchestration)) {
    return true;
  }
  // Builtin unattended tasks must drive tools themselves. Reused background
  // sessions may drop the explicit skip flag; the task identity is enough.
  if (String(record.automationKind || '').trim() === 'builtin') {
    return true;
  }
  if (String(record.builtinTaskId || '').trim().startsWith('builtin:')) {
    return true;
  }
  return false;
}

export function shouldRunSubagentOrchestration(params: {
  runtimeMode: RuntimeMode;
  route?: Pick<IntentRoute, 'intent' | 'requiresMultiAgent'>;
  skipSubagentOrchestration?: boolean;
}): boolean {
  if (params.skipSubagentOrchestration) {
    return false;
  }
  if (params.runtimeMode === 'background-maintenance') {
    return true;
  }
  if (params.route?.intent === 'automation' || params.route?.intent === 'long_running_task') {
    return true;
  }
  return Boolean(params.route?.requiresMultiAgent);
}

export function shouldUseCoordinator(params: {
  runtimeMode: RuntimeMode;
  route?: Pick<IntentRoute, 'intent' | 'requiresMultiAgent'>;
  skipSubagentOrchestration?: boolean;
}): boolean {
  if (params.skipSubagentOrchestration) {
    return false;
  }
  return Boolean(
    params.runtimeMode === 'background-maintenance'
    || params.route?.intent === 'automation'
    || params.route?.intent === 'long_running_task'
    || params.route?.requiresMultiAgent,
  );
}
