export type ModelScope = 'default' | 'wander' | 'chatroom' | 'knowledge' | 'gardenflow';

const MODEL_SCOPE_KEY_MAP: Record<Exclude<ModelScope, 'default'>, string> = {
  wander: 'model_name_wander',
  chatroom: 'model_name_chatroom',
  knowledge: 'model_name_knowledge',
  gardenflow: 'model_name_gardenflow',
};

const readSetting = (settings: Record<string, unknown>, key: string): string => {
  return String(settings[key] || '').trim();
};

export const resolveScopedModelName = (
  settings: Record<string, unknown>,
  scope: ModelScope,
  fallback = 'gpt-4o',
): string => {
  const defaultModel = readSetting(settings, 'model_name') || fallback;
  if (scope === 'default') {
    return defaultModel;
  }
  const overrideKey = MODEL_SCOPE_KEY_MAP[scope];
  const scopedModel = readSetting(settings, overrideKey);
  return scopedModel || defaultModel;
};

export const resolveModelScopeFromContextType = (contextType: string): ModelScope => {
  const normalized = String(contextType || '').trim().toLowerCase();
  if (normalized === 'gardenflow') return 'gardenflow';
  if (normalized === 'note' || normalized === 'knowledge') return 'knowledge';
  return 'default';
};
