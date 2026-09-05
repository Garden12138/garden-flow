import type { McpServerConfig, RuntimePerfPreset } from '../../pages/settings/shared';
import { createDefaultMcpServer } from '../../pages/settings/shared';

export const DEFAULT_VOICE_TTS_MODEL = 'cosyvoice-v3.5-plus';
export const DEFAULT_VOICE_CLONE_MODEL = 'cosyvoice-v3.5-plus-voice-clone';
export const MINIMAX_VOICE_CLONE_MODEL = 'minimax-voice-clone';
export const FILE_INDEX_DASHBOARD_CACHE_TTL_MS = 60_000;
export const FILE_INDEX_DASHBOARD_POLL_MS = 30_000;
export const DEFAULT_VISUAL_INDEX_PROMPT_VERSION = 'visual-manifest-v2-zh';
export const RUNTIME_PERF_HISTORY_LIMIT = 12;
export const RUNTIME_PERF_TIMELINE_LIMIT = 40;
export const RUNTIME_PERF_CHECKPOINT_WINDOW_MS = 1500;
export const RUNTIME_PERF_PRESETS: RuntimePerfPreset[] = [
  {
    id: 'latency-smoke',
    label: '延迟冒烟',
    description: '验证纯文本响应路径，观察 thinking 到首个 response 的延迟。',
    message: '请直接回答：用三句话说明当前 runtime mode 的职责、主要风险和最先检查的观测点。不要调用工具。',
  },
  {
    id: 'tooling-probe',
    label: '工具探测',
    description: '尽量触发一次真实工具调用，检查 tool-start/tool-end 延迟和成功率。',
    message: '先调用一个最适合当前运行时的诊断类工具读取状态，再用两条结论总结发现。若当前上下文没有合适工具，再明确说明原因。',
  },
  {
    id: 'long-response',
    label: '长响应',
    description: '拉长输出链路，观察持续流式输出和总耗时。',
    message: '围绕当前 runtime mode 输出一个结构化调试清单，至少包含：入口、关键事件、常见瓶颈、建议日志位、回归检查项，每项 2 到 3 句。',
  },
];

export type SettingsTab = 'general' | 'ai' | 'team' | 'platforms' | 'skills' | 'mcp' | 'tools' | 'profile' | 'remote' | 'experimental';
export type SettingsNavigationTarget = {
  tab?: SettingsTab;
  aiModelSubTab?: 'custom' | 'login';
  nonce?: number;
};

export type AiModelRouteMode = 'custom' | 'disabled';
export type AiModelRouteScope =
  | 'chat'
  | 'wander'
  | 'team'
  | 'knowledge'
  | 'gardenflow'
  | 'transcription'
  | 'embedding'
  | 'image'
  | 'visualIndex'
  | 'videoAnalysis'
  | 'voiceTts'
  | 'voiceClone';

export type AiModelRouteConfig = {
  mode: AiModelRouteMode;
  sourceId?: string;
  model?: string;
};

export type AiModelRoutes = Record<AiModelRouteScope, AiModelRouteConfig>;

export const DEFAULT_VIDEO_ANALYSIS_ENABLED = true;
export const DEFAULT_VISUAL_INDEX_ENABLED = false;

export const DEFAULT_AI_MODEL_ROUTES: AiModelRoutes = {
  chat: { mode: 'disabled', sourceId: '', model: '' },
  wander: { mode: 'disabled', sourceId: '', model: '' },
  team: { mode: 'disabled', sourceId: '', model: '' },
  knowledge: { mode: 'disabled', sourceId: '', model: '' },
  gardenflow: { mode: 'disabled', sourceId: '', model: '' },
  transcription: { mode: 'disabled', sourceId: '', model: '' },
  embedding: { mode: 'disabled', sourceId: '', model: '' },
  image: { mode: 'disabled', sourceId: '', model: '' },
  visualIndex: { mode: 'disabled', sourceId: '', model: '' },
  videoAnalysis: { mode: 'disabled', sourceId: '', model: '' },
  voiceTts: { mode: 'disabled', sourceId: '', model: '' },
  voiceClone: { mode: 'disabled', sourceId: '', model: '' },
};

export const normalizeModelKey = (value: string) => String(value || '').trim().toLowerCase();

export const cloneModelForVoiceTtsModel = (ttsModel: string, fallback = DEFAULT_VOICE_CLONE_MODEL) => {
  const key = normalizeModelKey(ttsModel);
  if (key.includes('cosyvoice')) return DEFAULT_VOICE_CLONE_MODEL;
  if (key.startsWith('speech-') || key.startsWith('speech_') || key.includes('minimax')) return MINIMAX_VOICE_CLONE_MODEL;
  return fallback || DEFAULT_VOICE_CLONE_MODEL;
};

export type SettingsSkill = {
  name: string;
  description: string;
  location: string;
  sourceScope?: string;
  isBuiltin?: boolean;
  disabled?: boolean;
};

export type McpServerDraft = McpServerConfig & {
  envPassthrough: string[];
};

export function formatSettingsSkillSource(scope?: string) {
  switch (scope) {
    case 'builtin':
      return '内置';
    case 'workspace':
      return '当前空间';
    case 'user':
      return '用户目录';
    case 'market':
      return '市场';
    default:
      return scope?.startsWith('thrive-plugin:') ? '插件' : scope || '技能';
  }
}

export function formatMcpTime(value?: number) {
  if (!value) return '未使用';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未使用' : date.toLocaleString();
}

export function mcpDraftFromServer(server?: McpServerConfig): McpServerDraft {
  const base = server || { ...createDefaultMcpServer(), name: '' };
  return {
    ...base,
    name: base.name === 'New MCP Server' ? '' : base.name,
    enabled: base.enabled !== false,
    transport: base.transport || 'stdio',
    command: base.command || '',
    args: Array.isArray(base.args) ? base.args : [],
    env: base.env || {},
    cwd: base.cwd || '',
    url: base.url || '',
    oauth: {
      ...(base.oauth || {}),
      gardenflow: {
        ...(base.oauth?.gardenflow || {}),
        envPassthrough: base.oauth?.gardenflow?.envPassthrough || [],
      },
    },
    envPassthrough: base.oauth?.gardenflow?.envPassthrough || [],
  };
}

export function mcpServerFromDraft(draft: McpServerDraft): McpServerConfig {
  const env = Object.fromEntries(
    Object.entries(draft.env || {})
      .map(([key, value]) => [key.trim(), String(value || '').trim()])
      .filter(([key, value]) => Boolean(key && value)),
  );
  const envPassthrough = draft.envPassthrough.map((item) => item.trim()).filter(Boolean);
  return {
    ...draft,
    name: draft.name.trim() || 'MCP Server',
    command: draft.transport === 'stdio' ? String(draft.command || '').trim() : '',
    args: draft.transport === 'stdio' ? (draft.args || []).map((item) => item.trim()).filter(Boolean) : [],
    env,
    cwd: draft.transport === 'stdio' ? String(draft.cwd || '').trim() : '',
    url: draft.transport === 'stdio' ? '' : String(draft.url || '').trim(),
    oauth: {
      ...(draft.oauth || {}),
      gardenflow: {
        ...(draft.oauth?.gardenflow || {}),
        envPassthrough,
      },
    },
  };
}

export function normalizeVisualIndexPromptVersion(value: unknown): string {
  const text = String(value || '').trim();
  if (!text || text === 'visual-manifest-v1') {
    return DEFAULT_VISUAL_INDEX_PROMPT_VERSION;
  }
  return text;
}


export function normalizeAiModelRoutes(value: unknown): AiModelRoutes {
  const parsed = typeof value === 'string'
    ? (() => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    })()
    : value;
  const source = parsed && typeof parsed === 'object' ? parsed as Partial<Record<AiModelRouteScope, Partial<AiModelRouteConfig>>> : {};
  const next = { ...DEFAULT_AI_MODEL_ROUTES } as AiModelRoutes;
  for (const key of Object.keys(DEFAULT_AI_MODEL_ROUTES) as AiModelRouteScope[]) {
    const route = source[key];
    if (!route || typeof route !== 'object') continue;
    const mode = String(route.mode || '').trim();
    next[key] = {
      mode: mode === 'custom' || mode === 'disabled' ? mode : DEFAULT_AI_MODEL_ROUTES[key].mode,
      sourceId: String(route.sourceId || '').trim(),
      model: String(route.model || '').trim(),
    };
  }
  return next;
}

export {
    DEFAULT_IMAGE_HOSTING_CONFIG_ID,
    IMAGE_HOSTING_JSON_KEY,
    createDefaultImageHostingSettings,
    getActiveImageHostingConfig,
    isImageHostingReady,
    normalizeImageHostingSettings,
    serializeImageHostingSettings,
    updateActiveImageHostingSettings,
    type ImageHostingConfig,
    type ImageHostingGithubConfig,
    type ImageHostingProviderType,
    type ImageHostingSettings,
    type GithubPublicUrlStyle,
} from './imageHostingModel';
