import { parseAiModelRoutesValue } from '../../src/features/settings/modelRouteValue.ts';
import { resolveModelScopeFromContextType, resolveScopedModelName } from './modelScopeSettings.ts';
import { normalizeApiBaseUrl } from './urlUtils.ts';

export type AiRouteScope = 'chat' | 'wander' | 'knowledge' | 'redclaw';

export interface ResolvedSettingsLlm {
  modelName: string;
  baseURL: string;
  apiKey: string;
  sourceId: string;
  scope: AiRouteScope;
  mode: string;
}

const OFFICIAL_SOURCE_IDS = new Set([
  'redbox_official_auto',
  'bojin_official_auto',
]);

function text(value: unknown): string {
  return String(value || '').trim();
}

function canonicalizeSourceId(sourceId: string): string {
  const normalized = text(sourceId);
  if (OFFICIAL_SOURCE_IDS.has(normalized.toLowerCase())) {
    return 'redbox_official_auto';
  }
  return normalized;
}

function isOfficialSourceId(sourceId: string): boolean {
  return canonicalizeSourceId(sourceId) === 'redbox_official_auto';
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
  if (modelScope === 'redclaw') return 'redclaw';
  if (modelScope === 'knowledge') return 'knowledge';
  if (modelScope === 'wander') return 'wander';
  return 'chat';
}

/**
 * Resolve the persisted AI-source route (endpoint + key + model), not just the
 * leftover global `api_endpoint`. Chat and background automation should share
 * this so switching chat to 百炼 actually moves unattended tasks off the official gateway.
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
  const official = isOfficialSourceId(sourceId);
  const apiKey = sourceKey || (official ? text(settings.api_key || settings.openaiApiKey) : '');
  const baseURL = sourceBaseURL || (official
    ? normalizeApiBaseUrl(text(settings.api_endpoint || settings.openaiApiBase), '')
    : '');
  const modelName = text(route.model || route.modelName || route.model_name)
    || text(source.model || source.modelName)
    || resolveScopedModelName(
      settings,
      scope === 'chat' ? 'default' : scope,
      text(settings.model_name || settings.openaiModel) || 'gpt-4o',
    );
  if (!modelName || !baseURL || !apiKey) {
    return null;
  }
  return {
    modelName,
    baseURL,
    apiKey,
    sourceId,
    scope,
    mode: text(route.mode) || (official ? 'official' : 'custom'),
  };
}
