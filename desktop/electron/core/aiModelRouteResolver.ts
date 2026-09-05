import { parseAiModelRoutesValue } from '../../src/features/settings/modelRouteValue.ts';
import { resolveModelScopeFromContextType, resolveScopedModelName } from './modelScopeSettings.ts';
import { normalizeApiBaseUrl } from './urlUtils.ts';

export type AiRouteScope = 'chat' | 'wander' | 'knowledge' | 'gardenflow';

export interface ResolvedSettingsLlm {
  modelName: string;
  baseURL: string;
  apiKey: string;
  sourceId: string;
  scope: AiRouteScope;
  mode: string;
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function canonicalizeSourceId(sourceId: string): string {
  return text(sourceId);
}

function parseAiSources(settings: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = settings.ai_sources_json;
  if (Array.isArray(raw)) {
    return raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  } catch {
    return [];
  }
}

function routeRecord(settings: Record<string, unknown>, scope: AiRouteScope): Record<string, unknown> {
  const routes = parseAiModelRoutesValue(settings.ai_model_routes_json);
  const route = routes[scope];
  if (route && typeof route === 'object' && !Array.isArray(route)) {
    return route as Record<string, unknown>;
  }
  return {};
}

function findSource(
  sources: Array<Record<string, unknown>>,
  sourceId: string,
): Record<string, unknown> | null {
  const wanted = canonicalizeSourceId(sourceId);
  if (!wanted) return null;
  return sources.find((item) => canonicalizeSourceId(text(item.id)) === wanted) || null;
}

function scopeFromContext(contextType: string, preferChat: boolean): AiRouteScope {
  if (preferChat) return 'chat';
  const modelScope = resolveModelScopeFromContextType(contextType);
  if (modelScope === 'gardenflow') return 'gardenflow';
  if (modelScope === 'knowledge') return 'knowledge';
  if (modelScope === 'wander') return 'wander';
  return 'chat';
}

/**
 * Resolve the persisted AI-source route (endpoint + key + model). Chat and
 * background automation share this resolver so every task follows the
 * provider selected in settings.
 */
export function resolveSettingsLlm(
  settings: Record<string, unknown>,
  options?: {
    preferChat?: boolean;
    contextType?: string;
  },
): ResolvedSettingsLlm | null {
  const scope = scopeFromContext(String(options?.contextType || ''), Boolean(options?.preferChat));
  const route = routeRecord(settings, scope);
  const sources = parseAiSources(settings);
  const sourceId = canonicalizeSourceId(
    text(route.sourceId || route.source_id)
    || (scope === 'chat' ? text(settings.default_ai_source_id) : ''),
  );
  const source = findSource(sources, sourceId);
  if (!source) {
    return null;
  }

  const sourceBaseURL = normalizeApiBaseUrl(
    text(source.baseURL || source.baseUrl),
    '',
  );
  const sourceKey = text(source.apiKey || source.key);
  const apiKey = sourceKey;
  const baseURL = sourceBaseURL;
  const modelName = text(route.model || route.modelName || route.model_name)
    || text(source.model || source.modelName)
    || resolveScopedModelName(
      settings,
      scope === 'chat' ? 'default' : scope,
      text(settings.model_name || settings.openaiModel) || 'gpt-4o',
    );
  let resolvedApiKey = apiKey;
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase();
    if (!resolvedApiKey && ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) {
      resolvedApiKey = 'local';
    }
  } catch {
    // URL validation is handled by the caller.
  }
  if (!modelName || !baseURL || !resolvedApiKey) {
    return null;
  }
  return {
    modelName,
    baseURL,
    apiKey: resolvedApiKey,
    sourceId,
    scope,
    mode: 'custom',
  };
}
