import { loadAndRenderPrompt } from '../../prompts/runtime';
import { normalizeApiBaseUrl, safeUrlJoin } from '../urlUtils';
import { fetchLlmWithRetry } from '../llmFetchRetry';
import {
  INTENT_NAMES,
  recommendedRoleForIntent,
  requiredCapabilitiesForIntent,
  resolveIntentExecutionPolicy,
} from './intentRoutePolicy';
import { applyProductVideoWorkflowPolicy } from './productVideoWorkflowPolicy';
import { applyXhsPublishWorkflowPolicy } from './xhsPublishWorkflowPolicy';
import { parseXhsPublishReply } from '../xhsPublishConversation';
import type { IntentName, IntentRoute, IntentRoutingDiagnostic, IntentRoutingFailure, RoleId, RuntimeContext } from './types';

export { applyProductVideoWorkflowPolicy, readExplicitProductRefs } from './productVideoWorkflowPolicy';

type RuntimeLlmConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs?: number;
};

const ROUTE_INTENT_SYSTEM_PROMPT_PATH = 'runtime/ai/route_intent_system.txt';
const ROUTE_INTENT_USER_PROMPT_PATH = 'runtime/ai/route_intent_user.txt';
const DEFAULT_ROUTE_TIMEOUT_MS = 90000;

class IntentRouterError extends Error {
  constructor(readonly failure: IntentRoutingFailure, readonly diagnostic: IntentRoutingDiagnostic) {
    super(`intent-router ${failure}`);
  }
}

const ROLE_IDS: RoleId[] = [
  'planner',
  'researcher',
  'copywriter',
  'image-director',
  'video-director',
  'audio-director',
  'reviewer',
  'ops-coordinator',
];

const normalizeIntentName = (value: unknown): IntentName | null => {
  const text = String(value || '').trim() as IntentName;
  return INTENT_NAMES.includes(text) ? text : null;
};

const normalizeRoleId = (value: unknown): RoleId | null => {
  const text = String(value || '').trim() as RoleId;
  return ROLE_IDS.includes(text) ? text : null;
};

const normalizeIntentList = (value: unknown): IntentName[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeIntentName(item))
    .filter((item): item is IntentName => Boolean(item));
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 16);
};

const parseJsonObject = (raw: string): Record<string, unknown> | null => {
  const text = String(raw || '').trim();
  if (!text) return null;

  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    candidates.unshift(fenced[1].trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }
  return null;
};

const inferStructuredIntent = (context: RuntimeContext): IntentName => {
  const metadata = (context.metadata && typeof context.metadata === 'object')
    ? context.metadata as Record<string, unknown>
    : {};
  const forcedIntent = normalizeIntentName(metadata.intent);
  if (forcedIntent) return forcedIntent;
  if (context.runtimeMode === 'gardenflow' && metadata.xhsPublishContext) return 'xhs_publishing';
  switch (context.runtimeMode) {
    case 'background-maintenance':
      return 'automation';
    case 'knowledge':
      return 'knowledge_retrieval';
    case 'chatroom':
    case 'advisor-discussion':
      return 'discussion';
    case 'gardenflow':
    default:
      break;
  }
  if (metadata.longCycleTaskId || metadata.longCycleRound || metadata.longCycleStep) {
    return 'long_running_task';
  }
  if (metadata.scheduledTaskId || metadata.automationId || metadata.runnerReason) {
    return 'automation';
  }
  if (metadata.attachmentType === 'wander-references') {
    return 'manuscript_creation';
  }
  if (metadata.channelProvider === 'weixin' && metadata.weixinSecretaryMode === true) {
    return 'direct_answer';
  }
  return context.runtimeMode === 'gardenflow' ? 'manuscript_creation' : 'direct_answer';
};

const shouldRequireMultiAgent = (context: RuntimeContext, intent: IntentName): boolean => {
  const metadata = (context.metadata && typeof context.metadata === 'object')
    ? context.metadata as Record<string, unknown>
    : {};
  if (Boolean(metadata.forceMultiAgent)) return true;
  if (context.runtimeMode === 'chatroom') return true;
  if (intent === 'advisor_persona') return true;
  return Array.isArray(metadata.subagentRoles) && metadata.subagentRoles.length > 0;
};

const shouldRequireLongRunningTask = (context: RuntimeContext, intent: IntentName): boolean => {
  const metadata = (context.metadata && typeof context.metadata === 'object')
    ? context.metadata as Record<string, unknown>
    : {};
  if (Boolean(metadata.forceLongRunningTask)) return true;
  if (context.runtimeMode === 'background-maintenance') return true;
  if (intent === 'long_running_task' || intent === 'automation') return true;
  if (metadata.longCycleTaskId || metadata.longCycleRound || metadata.longCycleStep) return true;
  return Boolean(metadata.scheduledTaskId || metadata.automationId || metadata.runnerReason);
};

const buildFallbackRoute = (context: RuntimeContext): IntentRoute => {
  const input = String(context.userInput || '').trim();
  const metadata = (context.metadata && typeof context.metadata === 'object')
    ? context.metadata as Record<string, unknown>
    : {};
  const contextType = String((metadata.contextType as string) || '').trim().toLowerCase();
  const intent = inferStructuredIntent(context);
  const recommendedRole = recommendedRoleForIntent(intent);
  const requiresLongRunningTask = shouldRequireLongRunningTask(context, intent);
  const requiresMultiAgent = shouldRequireMultiAgent(context, intent);
  const requiresHumanApproval = Boolean(metadata.requiresHumanApproval);

  return {
    intent,
    secondaryIntents: [],
    goal: input || '处理当前用户请求',
    deliverables: [],
    requiredCapabilities: requiredCapabilitiesForIntent(intent),
    recommendedRole,
    requiresLongRunningTask,
    requiresMultiAgent,
    requiresHumanApproval,
    confidence: intent === 'direct_answer' ? 0.55 : 0.82,
    reasoning: `rule-fallback:intent=${intent}; contextType=${contextType || 'none'}; role=${recommendedRole}`,
    source: 'rule',
  };
};

const validateLlmRoute = (parsed: Record<string, unknown>, fallback: IntentRoute): IntentRoute | null => {
  const intent = normalizeIntentName(parsed.primary_intent || parsed.intent);
  const recommendedRole = normalizeRoleId(parsed.recommended_role || parsed.role_id);
  if (!intent || !recommendedRole) {
    return null;
  }

  const goal = String(parsed.goal || parsed.primary_goal || fallback.goal || '').trim();
  const confidenceRaw = Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : fallback.confidence;
  const declaredCapabilities = normalizeStringList(parsed.required_capabilities);
  const executionPolicy = resolveIntentExecutionPolicy({
    intent,
    declaredCapabilities,
    recommendedRole,
  });
  const secondaryIntents = normalizeIntentList(parsed.secondary_intents);
  const xhsAction = parseXhsPublishReply(
    parsed.xhs_publish_action && typeof parsed.xhs_publish_action === 'object' && !Array.isArray(parsed.xhs_publish_action)
      ? parsed.xhs_publish_action as Record<string, unknown> : null,
  );
  xhsAction.confidence = Math.min(xhsAction.confidence,
    typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? confidence : 0);
  const requiredCapabilities = Array.from(new Set([
    ...executionPolicy.requiredCapabilities,
    ...secondaryIntents.flatMap((secondaryIntent) => requiredCapabilitiesForIntent(secondaryIntent)),
  ]));

  return {
    intent,
    secondaryIntents,
    ...(intent === 'xhs_publishing' ? { xhsPublishAction: xhsAction } : {}),
    goal: goal || fallback.goal,
    deliverables: normalizeStringList(parsed.deliverables),
    requiredCapabilities,
    recommendedRole: executionPolicy.recommendedRole,
    requiresLongRunningTask: parsed.requires_long_running_task === undefined
      ? fallback.requiresLongRunningTask
      : Boolean(parsed.requires_long_running_task),
    requiresMultiAgent: parsed.requires_multi_agent === undefined
      ? fallback.requiresMultiAgent
      : Boolean(parsed.requires_multi_agent),
    requiresHumanApproval: parsed.requires_human_approval === undefined
      ? fallback.requiresHumanApproval
      : Boolean(parsed.requires_human_approval),
    confidence,
    reasoning: String(parsed.reasoning || parsed.route_reasoning || '').trim() || fallback.reasoning,
    source: 'llm+rule',
  };
};

const callLlmRouter = async (params: {
  context: RuntimeContext;
  llm: RuntimeLlmConfig;
  fallback: IntentRoute;
  signal?: AbortSignal;
}): Promise<{ route: IntentRoute | null; diagnostic: IntentRoutingDiagnostic }> => {
  const startedAt = Date.now();
  const requestedTimeout = Number(params.llm.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(180000, Math.max(8000, requestedTimeout)) : DEFAULT_ROUTE_TIMEOUT_MS;
  let endpointHost = '';
  try { endpointHost = new URL(params.llm.baseURL).hostname; } catch { /* Invalid configuration is handled by the request. */ }
  let attempts = 0;
  let httpStatus: number | undefined;
  const diagnostic = (): IntentRoutingDiagnostic => ({
    model: params.llm.model.replace(/[^\w.\-:/]/g, '').slice(0, 128), endpointHost,
    elapsedMs: Math.max(0, Date.now() - startedAt), timeoutMs, attempts,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });
  if (params.signal?.aborted) throw new IntentRouterError('cancelled', diagnostic());
  const systemPrompt = loadAndRenderPrompt(ROUTE_INTENT_SYSTEM_PROMPT_PATH, {}, [
    'You are the intent router for GardenFlow.',
    'Return strict JSON only.',
  ].join('\n'));
  const userPrompt = loadAndRenderPrompt(ROUTE_INTENT_USER_PROMPT_PATH, {
    runtime_mode: params.context.runtimeMode,
    user_input: params.context.userInput,
    context_type: String((params.context.metadata?.contextType as string) || ''),
    context_id: String((params.context.metadata?.contextId as string) || ''),
    associated_file_path: String((params.context.metadata?.associatedFilePath as string) || ''),
    xhs_publish_context: JSON.stringify(params.context.metadata?.xhsPublishContext || null),
    fallback_intent: params.fallback.intent,
    fallback_role: params.fallback.recommendedRole,
    fallback_reasoning: params.fallback.reasoning,
    intent_names: INTENT_NAMES.join(', '),
    role_ids: ROLE_IDS.join(', '),
  }, [
    'User input:',
    '{{user_input}}',
  ].join('\n'));

  try {
    const commonMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const attempt = async (body: Record<string, unknown>) => {
      if (params.signal?.aborted) throw new IntentRouterError('cancelled', diagnostic());
      // A compatibility retry gets its own deadline, including response-body reads.
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      params.signal?.addEventListener('abort', onAbort, { once: true });
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      attempts += 1;
      httpStatus = undefined;
      try {
        const response = await fetchLlmWithRetry(safeUrlJoin(normalizeApiBaseUrl(params.llm.baseURL), '/chat/completions'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params.llm.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }, {
          maxAttempts: 1,
        });
        httpStatus = response.status;
        const rawText = await response.text();
        if (params.signal?.aborted) throw new IntentRouterError('cancelled', diagnostic());
        if (timedOut) throw new IntentRouterError('timeout', diagnostic());
        return { response, rawText };
      } catch (error) {
        if (params.signal?.aborted) throw new IntentRouterError('cancelled', diagnostic());
        if (timedOut) throw new IntentRouterError('timeout', diagnostic());
        if (error instanceof IntentRouterError) throw error;
        throw new IntentRouterError('network-error', diagnostic());
      } finally {
        clearTimeout(timeout);
        params.signal?.removeEventListener('abort', onAbort);
      }
    };

    let firstAttempt = await attempt({
      model: params.llm.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: commonMessages,
    });

    if (!firstAttempt.response.ok) {
      const lower = `${firstAttempt.rawText} ${firstAttempt.response.statusText}`.toLowerCase();
      const responseFormatRejected = lower.includes('response_format') || lower.includes('json_object');
      if ([400, 422].includes(firstAttempt.response.status) && responseFormatRejected) {
        firstAttempt = await attempt({
          model: params.llm.model,
          temperature: 0,
          messages: commonMessages,
        });
      }
    }

    if (!firstAttempt.response.ok) {
      throw new IntentRouterError('http-error', diagnostic());
    }

    const parsedOuter = parseJsonObject(firstAttempt.rawText);
    const first = Array.isArray(parsedOuter?.choices) ? parsedOuter.choices[0] as unknown : null;
    const message = first && typeof first === 'object' && 'message' in first ? first.message : null;
    const content = message && typeof message === 'object' && 'content' in message && typeof message.content === 'string'
      ? message.content : '';
    const parsed = parseJsonObject(content);
    if (!parsed) {
      throw new IntentRouterError('invalid-output', diagnostic());
    }
    return { route: validateLlmRoute(parsed, params.fallback), diagnostic: diagnostic() };
  } catch (error) {
    if (error instanceof IntentRouterError) throw error;
    throw new IntentRouterError('request-failed', diagnostic());
  }
};

export const routeIntent = async (params: {
  context: RuntimeContext;
  llm?: RuntimeLlmConfig;
  signal?: AbortSignal;
}): Promise<IntentRoute> => {
  const fallback = applyXhsPublishWorkflowPolicy(applyProductVideoWorkflowPolicy(buildFallbackRoute(params.context), params.context), params.context);
  if (!params.llm?.apiKey || !params.llm.baseURL || !params.llm.model) {
    return { ...fallback, routingFailure: 'unavailable' };
  }

  try {
    const routed = await callLlmRouter({
      context: params.context,
      llm: params.llm,
      fallback,
      signal: params.signal,
    });
    if (routed.route) {
      return { ...applyXhsPublishWorkflowPolicy(applyProductVideoWorkflowPolicy(routed.route, params.context), params.context), routingDiagnostic: routed.diagnostic };
    }
    return { ...fallback, routingFailure: 'invalid-output', routingDiagnostic: routed.diagnostic };
  } catch (error) {
    console.warn('[IntentRouter] llm-route-failed', {
      sessionId: params.context.sessionId,
      runtimeMode: params.context.runtimeMode,
      failure: error instanceof IntentRouterError ? error.failure : 'request-failed',
      diagnostic: error instanceof IntentRouterError ? error.diagnostic : undefined,
      fallbackIntent: fallback.intent,
    });
    return { ...fallback, routingFailure: error instanceof IntentRouterError ? error.failure : 'request-failed',
      ...(error instanceof IntentRouterError ? { routingDiagnostic: error.diagnostic } : {}) };
  }
};
