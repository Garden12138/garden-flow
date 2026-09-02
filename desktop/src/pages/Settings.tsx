import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type SetStateAction } from 'react';
import { Save, RefreshCw, AlertCircle, FolderOpen, Wrench, Download, LayoutGrid, Cpu, Trash2, Eye, EyeOff, Info, Plus, Star, ChevronDown, Check, FileText, FlaskConical, Users, GripVertical, Settings as SettingsIcon, ArrowLeft, Server, Store, X, MessageSquareText, Search } from 'lucide-react';
import clsx from 'clsx';
import {
  AI_SOURCE_PRESETS,
  type AiSourcePreset,
  type AiSourceConfig,
  DEFAULT_AI_PRESET_ID,
  OFFICIAL_AI_SOURCE_BASE_URL,
  OFFICIAL_AUTO_SOURCE_ID,
  OFFICIAL_AI_SOURCE_DISPLAY_NAME,
  canonicalizeOfficialAutoSourceId,
  createOfficialAiSource,
  findAiPresetById,
  inferPresetIdByEndpoint,
  isOfficialAutoSourceId
} from '../config/aiSources';
import { RUNTIME_FEATURES } from '../config/runtimeFeatures';
import {
  PRIVATE_GATEWAY_BASE_URL,
  PRIVATE_GATEWAY_DISPLAY_HINT,
  PRIVATE_GATEWAY_VIDEO_MODELS,
  isPrivateGatewayEndpoint,
} from '../../shared/privateGateway';
import { appAlert, appConfirm } from '../utils/appDialogs';
import { AdvisorModal, AdvisorSettingsPanel, type Advisor } from './Advisors';
import { subscribeSettingsUpdated } from '../bridge/appEvents';
import { hasRenderableAssetUrl, resolveAssetUrl } from '../utils/pathManager';
import {
  type AgentTaskSnapshot,
  type AgentTaskTrace,
  type AiProtocol,
  type AiPresetGroup,
  type RoleSpec,
  type BackgroundTaskItem,
  type BackgroundWorkerPoolState,
  type CreateAiSourceDraft,
  type LocalAiGuide,
  type McpServerRuntimeItem,
  type McpServerConfig,
  type McpSessionState,
  type RuntimePerfBenchmarkMode,
  type RuntimePerfRunResult,
  type RuntimePerfTimelineItem,
  type ToolDiagnosticDescriptor,
  type ToolDiagnosticRunResult,
  AiPresetLogo,
  AiPresetSelect,
  AiModelSelect,
  AiSourceLogo,
  AiSourceSelect,
  IMAGE_ASPECT_RATIO_OPTIONS,
  PasswordInput,
  type AiModelDescriptor,
  createAiSourceDraftFromPreset,
  buildModelCapabilityBadges,
  buildModelInputIcons,
  createAiSourceFromPreset,
  filterAiModelsByCapability,
  generateAiSourceId,
  inferImageTemplateByProvider,
  normalizeAiModelDescriptors,
  normalizeSourceModels,
  parseAiSources,
  parseEnvText,
  parseMcpServers,
  resolveDefaultImageEndpoint,
  stringifyEnvRecord,
  toAiModelDescriptor,
} from './settings/shared';
import { type ModelCapability } from '../../shared/modelCapabilities';
import type {
  CliRuntimeEnvironmentRecord,
  CliRuntimeEnvironmentScope,
  CliRuntimeToolRecord,
  DiagnosticsLogStatus,
  DiagnosticsPendingReport,
  CodexPluginMarketplaceItem,
  NotificationSettingsPayload,
  ThriveSkillMarketplaceItem,
  ThrivePluginMarketplaceItem,
  ThrivePluginSummary,
} from '../types';
import {
  GARDENFLOW_OFFICIAL_VIDEO_BASE_URL,
  GARDENFLOW_OFFICIAL_VIDEO_MODELS,
} from '../../shared/gardenflowVideo';
import {
  isGardenFlowOnboardingCompleted,
  type GardenFlowOnboardingState,
} from './gardenflow/onboardingState';
import { hasOfficialAiPanel, loadOfficialAiPanelModule, type OfficialAiPanelProps } from '../features/official';
import {
  ECOMMERCE_PLATFORM_GROUPS,
  ECOMMERCE_PLATFORM_IDS,
  createDefaultEcommercePlatformsSettings,
  ecommercePlatformIconPath,
  normalizeEcommercePlatformsSettings,
  serializeEcommercePlatformsSettings,
  type EcommercePlatformsSettings,
} from '../features/ecommerce-platforms/catalog';
import { useOfficialAuthState } from '../hooks/useOfficialAuthState';
import { useI18n, type I18nKey } from '../i18n';
import {
  GeneralSettingsSection,
  ExperimentalSettingsSection,
  RemoteConnectionSettingsSection,
  SettingsSaveBar,
  ToolsSettingsSection,
  type FileIndexDashboard,
} from './settings/SettingsSections';
import { subscribeRuntimeEventStream } from '../runtime/runtimeEventStream';
import { playTestNotificationSound } from '../notifications/audio';
import { DEFAULT_NOTIFICATION_SETTINGS, parseNotificationSettings } from '../notifications/types';
import { APP_BRAND } from '../config/brand';
import { SHOW_CURRENT_RELEASE_NOTES_EVENT } from '../utils/currentReleaseNotes';
import {
  DEFAULT_VOICE_TTS_MODEL,
  DEFAULT_VOICE_CLONE_MODEL,
  MINIMAX_VOICE_CLONE_MODEL,
  FILE_INDEX_DASHBOARD_CACHE_TTL_MS,
  FILE_INDEX_DASHBOARD_POLL_MS,
  DEFAULT_VISUAL_INDEX_PROMPT_VERSION,
  RUNTIME_PERF_HISTORY_LIMIT,
  RUNTIME_PERF_TIMELINE_LIMIT,
  RUNTIME_PERF_CHECKPOINT_WINDOW_MS,
  AiPricingRate,
  AiPricingModel,
  AiPricingGroup,
  AiPricingCatalog,
  normalizePricingNumber,
  formatPricingPoints,
  hasMeaningfulPricingValue,
  formatPricingUpdatedAt,
  parseAiPricingCatalog,
  pricingModeLabel,
  pricingRateLabel,
  pricingRateValue,
  pricingRateCellValue,
  pricingModelFields,
  RUNTIME_PERF_PRESETS,
  SettingsTab,
  SettingsNavigationTarget,
  AiModelRouteMode,
  AiModelRouteScope,
  AiModelRouteConfig,
  AiModelRoutes,
  DEFAULT_VIDEO_ANALYSIS_ENABLED,
  DEFAULT_VISUAL_INDEX_ENABLED,
  DEFAULT_AI_MODEL_ROUTES,
  normalizeModelKey,
  cloneModelForVoiceTtsModel,
  SettingsSkill,
  McpServerDraft,
  formatSettingsSkillSource,
  formatMcpTime,
  mcpDraftFromServer,
  mcpServerFromDraft,
  normalizeVisualIndexPromptVersion,
  normalizeAiModelRoutes,
  serializeImageHostingSettings,
} from '../features/settings/settingsModel';
import { ImageHostingSettingsSection } from './settings/ImageHostingSettingsSection';

const MIN_CHAT_MAX_TOKENS = 1024;
const DEFAULT_CHAT_MAX_TOKENS = 262144;
const DEFAULT_CHAT_MAX_TOKENS_DEEPSEEK = 131072;
const DEVELOPER_MODE_UNLOCK_TAP_COUNT = 7;
const DEVELOPER_MODE_TTL_MS = 24 * 60 * 60 * 1000;
const SETTINGS_ACTIVATION_DEBOUNCE_MS = 80;
const SETTINGS_TAB_POLL_DELAY_MS = 300;
const FILE_INDEX_DASHBOARD_CACHE_KEY = 'gardenflow:file-index-dashboard:v1';

// 官方源以「私有 new-api 网关」形态呈现：baseURL 由代码锁定、令牌可编辑、无需账号登录。
// 与闭源官方登录面板（hasOfficialAiPanel）互斥，避免两套鉴权形态同时出现。
const OFFICIAL_SOURCE_IS_PRIVATE_GATEWAY = RUNTIME_FEATURES.privateGateway && !hasOfficialAiPanel;

const normalizeVideoModelList = (raw: unknown, selectedModel?: unknown): string[] => {
  let candidates: unknown[] = [];
  if (Array.isArray(raw)) {
    candidates = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      candidates = Array.isArray(parsed) ? parsed : [raw];
    } catch {
      candidates = raw.split(/[\n,]/);
    }
  }

  const normalized = Array.from(new Set(
    candidates
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));
  const selected = String(selectedModel || '').trim();
  if (selected && !normalized.includes(selected)) {
    normalized.push(selected);
  }
  return normalized;
};

type VideoGenerationProviderPreset = 'gardenflow' | 'aliyun-bailian' | 'minimax' | 'new-api' | 'custom';

const PRIVATE_GATEWAY_VIDEO_MODEL_IDS = PRIVATE_GATEWAY_VIDEO_MODELS.map((item) => item.id);

type VideoGenerationProviderConfig = {
  id: string;
  name: string;
  preset: VideoGenerationProviderPreset;
  endpoint: string;
  apiKey: string;
  model: string;
  models: string[];
};

const generateVideoProviderId = () => `video-provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const inferVideoProviderPreset = (
  endpoint: string,
  models: string[],
  declaredPreset?: unknown,
): VideoGenerationProviderPreset => {
  const normalizedEndpoint = String(endpoint || '').trim();
  const normalizedModels = models.map((model) => model.toLowerCase());
  // 与 resolveVideoProvider 保持同样的优先级：endpoint 命中私有网关时优先于按模型名的判定。
  if (isPrivateGatewayEndpoint(normalizedEndpoint)) {
    return 'new-api';
  }
  if (
    /(?:aliyuncs\.com|dashscope)/i.test(normalizedEndpoint)
    || normalizedModels.some((model) => model.includes('happyhorse'))
  ) {
    return 'aliyun-bailian';
  }
  if (
    /api\.minimaxi\.com/i.test(normalizedEndpoint)
    || normalizedModels.some((model) => model === 'minimax-h3')
  ) {
    return 'minimax';
  }
  if (
    normalizedEndpoint === GARDENFLOW_OFFICIAL_VIDEO_BASE_URL
    && normalizedModels.length > 0
    && normalizedModels.every((model) => model.startsWith('seedance-'))
  ) {
    return 'gardenflow';
  }
  if (
    declaredPreset === 'gardenflow'
    || declaredPreset === 'aliyun-bailian'
    || declaredPreset === 'minimax'
    || declaredPreset === 'new-api'
  ) {
    return declaredPreset;
  }
  return 'custom';
};

const defaultVideoProviderName = (preset: VideoGenerationProviderPreset): string => {
  if (preset === 'gardenflow') return 'GardenFlow Seedance';
  if (preset === 'aliyun-bailian') return '阿里云百炼 HappyHorse';
  if (preset === 'minimax') return 'MiniMax';
  if (preset === 'new-api') return `${APP_BRAND.displayName}私有网关`;
  return '自定义视频服务商';
};

const normalizeVideoProviderConfigs = (
  raw: unknown,
  legacy: {
    endpoint?: unknown;
    apiKey?: unknown;
    model?: unknown;
    modelsJson?: unknown;
  } = {},
): VideoGenerationProviderConfig[] => {
  let candidates: unknown[] = [];
  if (Array.isArray(raw)) {
    candidates = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      candidates = Array.isArray(parsed) ? parsed : [];
    } catch {
      candidates = [];
    }
  }

  const seenIds = new Set<string>();
  const seenConfigs = new Set<string>();
  const providers = candidates.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const fallbackId = `video-provider-imported-${index + 1}`;
    let id = String(record.id || fallbackId).trim() || fallbackId;
    while (seenIds.has(id)) id = `${id}-${index + 1}`;
    seenIds.add(id);
    const model = String(record.model || '').trim();
    const models = normalizeVideoModelList(record.models, model);
    const storedEndpoint = String(record.endpoint || '').trim();
    const preset = inferVideoProviderPreset(storedEndpoint, models, record.preset);
    const endpointWasAssignedByWrongGardenFlowMigration = (
      preset === 'aliyun-bailian'
      && record.preset === 'gardenflow'
      && storedEndpoint === GARDENFLOW_OFFICIAL_VIDEO_BASE_URL
    );
    const endpoint = endpointWasAssignedByWrongGardenFlowMigration ? '' : storedEndpoint;
    const storedName = String(record.name || '').trim();
    const nameWasGeneratedForWrongPreset = (
      (storedName === 'GardenFlow Seedance' && preset !== 'gardenflow')
      || (storedName === '阿里云百炼 HappyHorse' && preset !== 'aliyun-bailian')
      || (storedName === 'MiniMax' && preset !== 'minimax')
      || (storedName === '自定义视频服务商' && preset !== 'custom')
    );
    const provider = {
      id,
      name: nameWasGeneratedForWrongPreset
        ? defaultVideoProviderName(preset)
        : (storedName || defaultVideoProviderName(preset)),
      preset,
      endpoint,
      apiKey: String(record.apiKey || '').trim(),
      model: model || models[0] || '',
      models,
    } satisfies VideoGenerationProviderConfig;
    const signature = JSON.stringify({
      name: provider.name,
      preset: provider.preset,
      endpoint: provider.endpoint,
      apiKey: provider.apiKey,
      model: provider.model,
      models: provider.models,
    });
    if (seenConfigs.has(signature)) return [];
    seenConfigs.add(signature);
    return [provider];
  });
  if (providers.length > 0) return providers;

  const endpoint = String(legacy.endpoint || GARDENFLOW_OFFICIAL_VIDEO_BASE_URL).trim();
  const apiKey = String(legacy.apiKey || '').trim();
  const model = String(legacy.model || GARDENFLOW_OFFICIAL_VIDEO_MODELS['text-to-video']).trim();
  const models = normalizeVideoModelList(legacy.modelsJson, model);
  const preset = inferVideoProviderPreset(endpoint, models);
  return [{
    id: preset === 'gardenflow'
      ? 'video-provider-gardenflow'
      : preset === 'aliyun-bailian'
        ? 'video-provider-aliyun-bailian'
        : preset === 'minimax'
          ? 'video-provider-minimax'
          : preset === 'new-api'
            ? 'video-provider-private-gateway'
            : 'video-provider-migrated',
    name: preset === 'custom' ? '现有视频服务商' : defaultVideoProviderName(preset),
    preset,
    endpoint,
    apiKey,
    model,
    models,
  }];
};

const createVideoProviderPreset = (preset: VideoGenerationProviderPreset): VideoGenerationProviderConfig => {
  if (preset === 'gardenflow') {
    const model = GARDENFLOW_OFFICIAL_VIDEO_MODELS['text-to-video'];
    return {
      id: generateVideoProviderId(),
      name: 'GardenFlow Seedance',
      preset,
      endpoint: GARDENFLOW_OFFICIAL_VIDEO_BASE_URL,
      apiKey: '',
      model,
      models: [model],
    };
  }
  if (preset === 'aliyun-bailian') {
    return {
      id: generateVideoProviderId(),
      name: '阿里云百炼 HappyHorse',
      preset,
      endpoint: '',
      apiKey: '',
      model: 'happyhorse-1.1-r2v',
      models: ['happyhorse-1.1-r2v'],
    };
  }
  if (preset === 'minimax') {
    return {
      id: generateVideoProviderId(),
      name: 'MiniMax',
      preset,
      endpoint: 'https://api.minimaxi.com',
      apiKey: '',
      model: 'MiniMax-H3',
      models: ['MiniMax-H3'],
    };
  }
  if (preset === 'new-api') {
    return {
      id: generateVideoProviderId(),
      name: defaultVideoProviderName(preset),
      preset,
      endpoint: PRIVATE_GATEWAY_BASE_URL,
      apiKey: '',
      model: PRIVATE_GATEWAY_VIDEO_MODEL_IDS[0] || '',
      models: [...PRIVATE_GATEWAY_VIDEO_MODEL_IDS],
    };
  }
  return {
    id: generateVideoProviderId(),
    name: '自定义视频服务商',
    preset,
    endpoint: '',
    apiKey: '',
    model: '',
    models: [],
  };
};

type GardenFlowProfileDraft = {
  user: string;
  creatorProfile: string;
};

type WorkspaceSpace = {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
};

const EMPTY_GARDENFLOW_PROFILE_DRAFT: GardenFlowProfileDraft = {
  user: '',
  creatorProfile: '',
};

const DEFAULT_SPACE_ID = 'default';

function teamAdvisorOrder(advisor: Advisor, index: number): number {
  return Number.isFinite(advisor.gardenflowOrder) ? Number(advisor.gardenflowOrder) : index;
}

function sortTeamAdvisors(advisors: Advisor[]): Advisor[] {
  return advisors
    .map((advisor, index) => ({ advisor, index }))
    .sort((left, right) => {
      const orderDelta = teamAdvisorOrder(left.advisor, left.index) - teamAdvisorOrder(right.advisor, right.index);
      return orderDelta || left.index - right.index;
    })
    .map(({ advisor }) => advisor);
}

function advisorAvatarLabel(advisor: Advisor): string {
  return String(advisor.avatar || advisor.name || '成').trim().slice(0, 2);
}

function TeamSettingsSection({
  advisors,
  loading,
  busyAdvisorId,
  draggingAdvisorId,
  onCreateAdvisor,
  onToggleVisible,
  onOpenSettings,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  advisors: Advisor[];
  loading: boolean;
  busyAdvisorId: string | null;
  draggingAdvisorId: string | null;
  onCreateAdvisor: () => void;
  onToggleVisible: (advisor: Advisor) => void;
  onOpenSettings: (advisor: Advisor) => void;
  onDragStart: (advisorId: string) => void;
  onDragOver: (advisorId: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-medium text-text-primary">团队</h2>
          <p className="mt-1 text-sm text-text-tertiary">管理 {APP_BRAND.aiDisplayName} 新对话里出现的成员和顺序。</p>
        </div>
        <button
          type="button"
          onClick={onCreateAdvisor}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          新增成员
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface-primary">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-5 text-sm text-text-tertiary">
            <RefreshCw className="h-4 w-4 animate-spin" />
            正在读取成员
          </div>
        ) : advisors.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center text-sm text-text-tertiary">
            <span>暂无成员</span>
            <button
              type="button"
              onClick={onCreateAdvisor}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              新增成员
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {advisors.map((advisor) => {
              const visible = advisor.gardenflowVisible !== false;
              const busy = busyAdvisorId === advisor.id;
              const isDragging = draggingAdvisorId === advisor.id;
              return (
                <div
                  key={advisor.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', advisor.id);
                    onDragStart(advisor.id);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    onDragOver(advisor.id);
                  }}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    onDragOver(advisor.id);
                  }}
                  onDrop={(event) => event.preventDefault()}
                  onDragEnd={onDragEnd}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-3 transition-colors',
                    isDragging ? 'bg-surface-secondary/80' : 'bg-surface-primary'
                  )}
                >
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', advisor.id);
                      onDragStart(advisor.id);
                    }}
                    onDragEnd={onDragEnd}
                    className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-primary active:cursor-grabbing"
                    title="拖动排序"
                    aria-label="拖动排序"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>

                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-surface-secondary text-sm font-semibold text-text-secondary">
                    {hasRenderableAssetUrl(advisor.avatar) ? (
                      <img src={resolveAssetUrl(advisor.avatar)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">{advisorAvatarLabel(advisor)}</div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text-primary">{advisor.name || '未命名成员'}</div>
                    <div className="mt-0.5 truncate text-xs text-text-tertiary">{advisor.personality || '未设置描述'}</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onToggleVisible(advisor)}
                    disabled={busy}
                    className={clsx(
                      'relative h-7 w-[3.25rem] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50',
                      visible ? 'bg-[#34c759]' : 'bg-[#d1d1d6]'
                    )}
                    title={visible ? '已展示' : '已隐藏'}
                    aria-label={visible ? `在 ${APP_BRAND.aiDisplayName} 展示` : `不在 ${APP_BRAND.aiDisplayName} 展示`}
                  >
                    <span
                      className={clsx(
                        'absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.22)] transition-transform duration-200',
                        visible ? 'translate-x-6' : 'translate-x-0'
                      )}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenSettings(advisor)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                    title="设置成员"
                    aria-label="设置成员"
                  >
                    <SettingsIcon className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function EcommercePlatformsSettingsSection({
  settings,
  onTogglePlatform,
}: {
  settings: EcommercePlatformsSettings;
  onTogglePlatform: (platformId: string, enabled: boolean) => void;
}) {
  const enabledCount = ECOMMERCE_PLATFORM_IDS.filter((id) => settings.enabledById[id] !== false).length;
  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-medium text-text-primary">电商平台</h2>
          <p className="mt-1 text-sm text-text-tertiary">启用的平台会作为后续目标平台生成的候选范围。</p>
        </div>
        <div className="shrink-0 rounded-full border border-border bg-surface-secondary px-3 py-1 text-xs font-medium text-text-secondary">
          {enabledCount}/{ECOMMERCE_PLATFORM_IDS.length} 已开启
        </div>
      </div>

      <div className="space-y-4">
        {ECOMMERCE_PLATFORM_GROUPS.map((group) => {
          const groupEnabledCount = group.platforms.filter((platform) => settings.enabledById[platform.id] !== false).length;
          return (
            <div key={group.region} className="overflow-hidden rounded-xl border border-border bg-surface-primary">
              <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-surface-secondary/40 px-4 py-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-text-primary">{group.region}</h3>
                </div>
                <span className="shrink-0 text-xs text-text-tertiary">{groupEnabledCount}/{group.platforms.length}</span>
              </div>
              <div className="divide-y divide-border/70">
                {group.platforms.map((platform) => {
                  const enabled = settings.enabledById[platform.id] !== false;
                  const iconPath = ecommercePlatformIconPath(platform.id);
                  return (
                    <div key={platform.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-secondary">
                        {iconPath ? (
                          <img src={iconPath} alt="" className="h-6 w-6 object-contain" loading="lazy" />
                        ) : (
                          <Store className="h-4 w-4 text-text-tertiary" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text-primary">{platform.name}</div>
                        <div className="mt-0.5 truncate text-xs text-text-tertiary">
                          {platform.market} · {platform.platformType}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onTogglePlatform(platform.id, !enabled)}
                        className={clsx(
                          'relative h-7 w-[3.25rem] shrink-0 rounded-full transition-colors duration-200',
                          enabled ? 'bg-[#34c759]' : 'bg-[#d1d1d6]'
                        )}
                        title={enabled ? '已开启' : '已关闭'}
                        aria-label={`${enabled ? '关闭' : '开启'} ${platform.name}`}
                      >
                        <span
                          className={clsx(
                            'absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.22)] transition-transform duration-200',
                            enabled ? 'translate-x-6' : 'translate-x-0'
                          )}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type AssistantDaemonStatus = Awaited<ReturnType<typeof window.ipcRenderer.assistantDaemon.getStatus>>;
type AcpGatewayStatus = NonNullable<AssistantDaemonStatus['acpGateway']>;
type AcpClientStatus = AcpGatewayStatus['clients'][number];
type RuntimeDiagnosticsSummary = Awaited<ReturnType<typeof window.ipcRenderer.debug.getRuntimeSummary>>;
type CliRuntimeInstallMethodOption = 'npm' | 'pnpm' | 'python' | 'uv' | 'cargo' | 'go' | 'binary';
type CliRuntimeExecutionMode = 'managed' | 'host_compatible' | 'unrestricted';
const normalizeCliRuntimeExecutionMode = (value: unknown): CliRuntimeExecutionMode => {
  const normalized = String(value || '').trim();
  if (normalized === 'managed' || normalized === 'host_compatible' || normalized === 'unrestricted') {
    return normalized;
  }
  return 'host_compatible';
};
type CliRuntimeInstallQueueItem = {
  installId: string;
  toolName: string;
  environmentId?: string;
  installMethod?: string;
  spec?: string;
  status: string;
  summary?: string;
  updatedAt: number;
};
type AssistantDaemonDraft = {
  enabled: boolean;
  autoStart: boolean;
  keepAliveWhenNoWindow: boolean;
  host: string;
  port: string;
  feishu: {
    enabled: boolean;
    receiveMode: 'webhook' | 'websocket';
    endpointPath: string;
    verificationToken: string;
    encryptKey: string;
    appId: string;
    appSecret: string;
    replyUsingChatId: boolean;
  };
  relay: {
    enabled: boolean;
    endpointPath: string;
    authToken: string;
  };
  acpGateway: {
    enabled: boolean;
    requireToken: boolean;
    localOnly: boolean;
    endpointPath: string;
    manifestPath: string;
    guidePath: string;
    defaultRuntimeMode: string;
    defaultClientLabel: string;
  };
  weixin: {
    enabled: boolean;
    endpointPath: string;
    authToken: string;
    accountId: string;
    autoStartSidecar: boolean;
    cursorFile: string;
    sidecarCommand: string;
    sidecarArgs: string;
    sidecarCwd: string;
    sidecarEnvText: string;
  };
};

type AssistantDaemonWeixinLoginState = {
  sessionKey?: string;
  qrcodeUrl?: string;
  qrcodeImageUrl?: string;
  message: string;
  accountId?: string;
  userId?: string;
  connected: boolean;
  stateDir?: string;
};

const createDefaultAssistantDaemonDraft = (): AssistantDaemonDraft => ({
  enabled: true,
  autoStart: true,
  keepAliveWhenNoWindow: true,
  host: '127.0.0.1',
  port: '31937',
  feishu: {
    enabled: false,
    receiveMode: 'webhook',
    endpointPath: '/hooks/feishu/events',
    verificationToken: '',
    encryptKey: '',
    appId: '',
    appSecret: '',
    replyUsingChatId: true,
  },
  relay: {
    enabled: true,
    endpointPath: '/hooks/channel/relay',
    authToken: '',
  },
  acpGateway: {
    enabled: false,
    requireToken: false,
    localOnly: true,
    endpointPath: '/acp/v1',
    manifestPath: '/acp/v1/manifest',
    guidePath: '/acp/v1/guide',
    defaultRuntimeMode: 'default',
    defaultClientLabel: 'External Agent',
  },
  weixin: {
    enabled: false,
    endpointPath: '/hooks/weixin/relay',
    authToken: '',
    accountId: '',
    autoStartSidecar: false,
    cursorFile: '',
    sidecarCommand: '',
    sidecarArgs: '',
    sidecarCwd: '',
    sidecarEnvText: '',
  },
});

const assistantDaemonStatusToDraft = (status?: AssistantDaemonStatus | null): AssistantDaemonDraft => {
  if (!status) return createDefaultAssistantDaemonDraft();
  return {
    enabled: Boolean(status.enabled),
    autoStart: Boolean(status.autoStart),
    keepAliveWhenNoWindow: Boolean(status.keepAliveWhenNoWindow),
    host: String(status.host || '127.0.0.1'),
    port: String(status.port || 31937),
    feishu: {
      enabled: Boolean(status.feishu?.enabled),
      receiveMode: status.feishu?.receiveMode === 'websocket' ? 'websocket' : 'webhook',
      endpointPath: String(status.feishu?.endpointPath || '/hooks/feishu/events'),
      verificationToken: String(status.feishu?.verificationToken || ''),
      encryptKey: String(status.feishu?.encryptKey || ''),
      appId: String(status.feishu?.appId || ''),
      appSecret: String(status.feishu?.appSecret || ''),
      replyUsingChatId: status.feishu?.replyUsingChatId !== false,
    },
    relay: {
      enabled: status.relay?.enabled !== false,
      endpointPath: String(status.relay?.endpointPath || '/hooks/channel/relay'),
      authToken: String(status.relay?.authToken || ''),
    },
    acpGateway: {
      enabled: Boolean(status.acpGateway?.enabled),
      requireToken: Boolean(status.acpGateway?.requireToken),
      localOnly: status.acpGateway?.localOnly !== false,
      endpointPath: String(status.acpGateway?.endpointPath || '/acp/v1'),
      manifestPath: String(status.acpGateway?.manifestPath || '/acp/v1/manifest'),
      guidePath: String(status.acpGateway?.guidePath || '/acp/v1/guide'),
      defaultRuntimeMode: String(status.acpGateway?.defaultRuntimeMode || 'default'),
      defaultClientLabel: String(status.acpGateway?.defaultClientLabel || 'External Agent'),
    },
    weixin: {
      enabled: Boolean(status.weixin?.enabled),
      endpointPath: String(status.weixin?.endpointPath || '/hooks/weixin/relay'),
      authToken: String(status.weixin?.authToken || ''),
      accountId: String(status.weixin?.accountId || ''),
      autoStartSidecar: Boolean(status.weixin?.autoStartSidecar),
      cursorFile: String(status.weixin?.cursorFile || ''),
      sidecarCommand: String(status.weixin?.sidecarCommand || ''),
      sidecarArgs: Array.isArray(status.weixin?.sidecarArgs) ? status.weixin.sidecarArgs.join(' ') : '',
      sidecarCwd: String(status.weixin?.sidecarCwd || ''),
      sidecarEnvText: stringifyEnvRecord(status.weixin?.sidecarEnv || {}),
    },
  };
};

type RuntimeSessionListItem = {
  id: string;
  runtimeMode?: string;
  contextBinding?: {
    contextType?: string;
    contextId?: string;
    isContextBound?: boolean;
  } | null;
  transcriptCount: number;
  checkpointCount: number;
  metadata?: Record<string, unknown> | null;
  chatSession?: {
    id: string;
    title?: string;
    updatedAt?: string;
  } | null;
};

type RuntimeSessionTranscriptItem = {
  id: number;
  sessionId: string;
  recordType: string;
  role: string;
  content: string;
  payload?: unknown;
  createdAt: number;
};

type RuntimeSessionCheckpointItem = {
  id: string;
  sessionId: string;
  checkpointType: string;
  summary: string;
  payload?: unknown;
  createdAt: number;
};

type RuntimeSessionToolResultItem = {
  id: string;
  sessionId: string;
  callId: string;
  toolName: string;
  command?: string;
  success: boolean;
  resultText?: string;
  summaryText?: string;
  promptText?: string;
  originalChars?: number;
  promptChars?: number;
  truncated: boolean;
  payload?: unknown;
  createdAt: number;
  updatedAt: number;
};

type RuntimeHookDefinition = {
  id: string;
  event: string;
  type: string;
  matcher?: string;
  enabled?: boolean;
  sourceScope?: string;
  pluginId?: string;
  pluginRoot?: string;
  pluginDataRoot?: string;
  sourcePath?: string;
  sourceRelativePath?: string;
  command?: string;
  commandWindows?: string;
  timeoutSec?: number;
  async?: boolean;
  statusMessage?: string;
  raw?: unknown;
};

type RuntimePerfCollector = {
  runId: string;
  sessionId: string;
  startedAt: number;
  thinkingStartedMs?: number;
  thoughtFirstTokenMs?: number;
  firstResponseMs?: number;
  firstToolStartMs?: number;
  firstCheckpointMs?: number;
  toolCalls: number;
  toolSuccessCount: number;
  toolFailureCount: number;
  checkpointCount: number;
  checkpointTypes: string[];
  responseChars?: number;
  timeline: RuntimePerfTimelineItem[];
};

function toRuntimePerfRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function toRuntimePerfText(value: unknown): string {
  return String(value || '').trim();
}

function toRuntimePerfNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeCliRuntimeToolRecord(value: unknown): CliRuntimeToolRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = String(record.id || record.toolId || '').trim();
  const executable = String(record.executable || record.command || '').trim();
  const name = String(record.name || executable || id).trim();
  if (!id && !name && !executable) return null;
  return {
    id: id || name || executable,
    name: name || executable || id,
    executable: executable || name || id,
    resolvedPath: String(record.resolvedPath || record.resolved_path || '').trim() || null,
    resolvedFrom: String(record.resolvedFrom || record.resolved_from || '').trim().toLowerCase() as CliRuntimeToolRecord['resolvedFrom'],
    source: String(record.source || 'unknown').trim().toLowerCase() as CliRuntimeToolRecord['source'],
    installMethod: String(record.installMethod || record.install_method || '').trim() || null,
    installSpec: String(record.installSpec || record.install_spec || '').trim() || null,
    version: String(record.version || '').trim() || null,
    health: String(record.health || 'unknown').trim().toLowerCase() as CliRuntimeToolRecord['health'],
    manifestId: String(record.manifestId || record.manifest_id || '').trim() || null,
    environmentId: String(record.environmentId || record.environment_id || '').trim() || null,
    lastCheckedAt: toRuntimePerfNumber(record.lastCheckedAt) ?? null,
    effectivePathPreview: Array.isArray(record.effectivePathPreview)
      ? record.effectivePathPreview.map((item) => String(item || '').trim()).filter(Boolean)
      : Array.isArray(record.effective_path_preview)
        ? (record.effective_path_preview as unknown[]).map((item) => String(item || '').trim()).filter(Boolean)
        : [],
    searchedPathEntriesCount:
      toRuntimePerfNumber(record.searchedPathEntriesCount)
      ?? toRuntimePerfNumber(record.searched_path_entries_count)
      ?? null,
    isInDefaultDetectCatalog:
      record.isInDefaultDetectCatalog === true || record.is_in_default_detect_catalog === true,
    metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata as Record<string, unknown> : null,
  };
}

function normalizeCliRuntimeEnvironmentRecord(value: unknown): CliRuntimeEnvironmentRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = String(record.id || '').trim();
  const rootPath = String(record.rootPath || record.root_path || '').trim();
  if (!id && !rootPath) return null;
  return {
    id: id || rootPath,
    scope: String(record.scope || 'workspace-local').trim().toLowerCase() as CliRuntimeEnvironmentRecord['scope'],
    rootPath,
    workspaceRoot: String(record.workspaceRoot || record.workspace_root || '').trim() || null,
    pathEntries: Array.isArray(record.pathEntries)
      ? record.pathEntries.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    installedToolIds: Array.isArray(record.installedToolIds)
      ? record.installedToolIds.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    runtimes: record.runtimes && typeof record.runtimes === 'object' ? record.runtimes as Record<string, unknown> : null,
    createdAt: toRuntimePerfNumber(record.createdAt) ?? null,
    updatedAt: toRuntimePerfNumber(record.updatedAt) ?? null,
    metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata as Record<string, unknown> : null,
  };
}

function runtimePerfContextTypeForMode(mode: RuntimePerfBenchmarkMode): string {
  if (mode === 'team') return 'team';
  if (mode === 'diagnostics') return 'diagnostics';
  return mode;
}

function formatRuntimePerfRunIndex(index: number): string {
  return `Run ${String(index).padStart(2, '0')}`;
}

const sanitizeChatMaxTokensInput = (value: string, fallback: number): string => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_CHAT_MAX_TOKENS) {
    return String(fallback);
  }
  return String(Math.floor(parsed));
};

type FileIndexDashboardCacheRecord = {
  savedAt: number;
  dashboard: FileIndexDashboard;
};

function readCachedFileIndexDashboard(): FileIndexDashboardCacheRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FILE_INDEX_DASHBOARD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FileIndexDashboardCacheRecord>;
    if (!parsed || typeof parsed.savedAt !== 'number' || !parsed.dashboard) return null;
    return {
      savedAt: parsed.savedAt,
      dashboard: parsed.dashboard,
    };
  } catch (error) {
    console.warn('Failed to read cached file index dashboard:', error);
    return null;
  }
}

function writeCachedFileIndexDashboard(dashboard: FileIndexDashboard): number {
  const savedAt = Date.now();
  if (typeof window === 'undefined') return savedAt;
  try {
    window.localStorage.setItem(
      FILE_INDEX_DASHBOARD_CACHE_KEY,
      JSON.stringify({ savedAt, dashboard }),
    );
  } catch (error) {
    console.warn('Failed to cache file index dashboard:', error);
  }
  return savedAt;
}

function clearCachedFileIndexDashboard() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(FILE_INDEX_DASHBOARD_CACHE_KEY);
  } catch (error) {
    console.warn('Failed to clear cached file index dashboard:', error);
  }
}



export function Settings({
  isActive = true,
  onOpenGardenFlowOnboarding,
  gardenflowOnboardingVersion = 0,
  navigationTarget,
  onReturn,
}: {
  isActive?: boolean;
  onOpenGardenFlowOnboarding?: () => void;
  gardenflowOnboardingVersion?: number;
  navigationTarget?: SettingsNavigationTarget | null;
  onReturn?: () => void;
}) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const [teamAdvisors, setTeamAdvisors] = useState<Advisor[]>([]);
  const [isTeamAdvisorsLoading, setIsTeamAdvisorsLoading] = useState(false);
  const [teamAdvisorBusyId, setTeamAdvisorBusyId] = useState<string | null>(null);
  const [settingsSkills, setSettingsSkills] = useState<SettingsSkill[]>([]);
  const [isSettingsSkillsLoading, setIsSettingsSkillsLoading] = useState(false);
  const [settingsSkillBusyName, setSettingsSkillBusyName] = useState('');
  const [settingsSkillStatusMessage, setSettingsSkillStatusMessage] = useState('');
  const [areBuiltinSkillsExpanded, setAreBuiltinSkillsExpanded] = useState(false);
  const [isSkillMarketplaceOpen, setIsSkillMarketplaceOpen] = useState(false);
  const [skillMarketplaceItems, setSkillMarketplaceItems] = useState<ThriveSkillMarketplaceItem[]>([]);
  const [isSkillMarketplaceLoading, setIsSkillMarketplaceLoading] = useState(false);
  const [skillMarketplaceBusyId, setSkillMarketplaceBusyId] = useState('');
  const [isCreatingTeamAdvisor, setIsCreatingTeamAdvisor] = useState(false);
  const [editingTeamAdvisor, setEditingTeamAdvisor] = useState<Advisor | null>(null);
  const [settingsTeamAdvisor, setSettingsTeamAdvisor] = useState<Advisor | null>(null);
  const [draggingTeamAdvisorId, setDraggingTeamAdvisorId] = useState<string | null>(null);
  const [isTeamSystemPromptExpanded, setIsTeamSystemPromptExpanded] = useState(false);
  const [isTeamOptimizingPrompt, setIsTeamOptimizingPrompt] = useState(false);
  const teamAdvisorOrderRef = useRef<Advisor[]>([]);
  const teamAdvisorDragIdRef = useRef<string | null>(null);
  const initialFileIndexDashboardCache = useMemo(() => readCachedFileIndexDashboard(), []);
  const [baseSettingsLoadedRevision, setBaseSettingsLoadedRevision] = useState(0);
  const [settingsSubView, setSettingsSubView] = useState<'main' | 'ai-pricing'>('main');
  const [aiPricingCatalog, setAiPricingCatalog] = useState<AiPricingCatalog | null>(null);
  const [aiPricingLoading, setAiPricingLoading] = useState(false);
  const [aiPricingError, setAiPricingError] = useState('');
  const [aiPricingActiveGroup, setAiPricingActiveGroup] = useState('');
  const [aiPricingSearch, setAiPricingSearch] = useState('');
  const builtinSettingsSkills = useMemo(
    () => settingsSkills.filter((skill) => skill.isBuiltin),
    [settingsSkills]
  );
  const editableSettingsSkills = useMemo(
    () => settingsSkills.filter((skill) => !skill.isBuiltin),
    [settingsSkills]
  );
  const [formData, setFormData] = useState<any>({
    api_endpoint: '',
    api_key: '',
    model_name: '',
    workspace_dir: '',
    transcription_model: '',
    transcription_endpoint: '',
    transcription_key: '',
    embedding_endpoint: '',
    embedding_key: '',
    embedding_model: '',
    visual_index_enabled: DEFAULT_VISUAL_INDEX_ENABLED,
    visual_index_provider: 'openai-compatible',
    visual_index_endpoint: '',
    visual_index_api_key: '',
    visual_index_model: '',
    visual_index_prompt_version: DEFAULT_VISUAL_INDEX_PROMPT_VERSION,
    visual_index_timeout_seconds: '90',
    visual_index_max_image_edge: '1536',
    visual_index_skip_small_images: true,
    visual_index_pdf_max_pages: '12',
    visual_index_pdf_render_dpi: '144',
    visual_index_concurrency: '1',
    video_analysis_enabled: DEFAULT_VIDEO_ANALYSIS_ENABLED,
    video_analysis_endpoint: '',
    video_analysis_api_key: '',
    video_analysis_model: '',
    video_analysis_protocol: 'gemini',
    video_analysis_max_direct_video_bytes: String(64 * 1024 * 1024),
    docling_endpoint: '',
    tika_endpoint: '',
    unstructured_endpoint: '',
    parser_api_key: '',
    parser_timeout_seconds: '90',
    rerank_endpoint: '',
    rerank_api_key: '',
    rerank_model: '',
    rerank_timeout_seconds: '30',
    image_provider: 'openai-compatible',
    image_endpoint: '',
    image_api_key: '',
    image_model: '',
    voice_endpoint: '',
    voice_api_key: '',
    voice_tts_model: DEFAULT_VOICE_TTS_MODEL,
    tts_model: DEFAULT_VOICE_TTS_MODEL,
    voice_clone_model: DEFAULT_VOICE_CLONE_MODEL,
    video_endpoint: '',
    video_api_key: '',
    video_model: String(GARDENFLOW_OFFICIAL_VIDEO_MODELS['text-to-video']),
    video_models_json: JSON.stringify([GARDENFLOW_OFFICIAL_VIDEO_MODELS['text-to-video']]),
    video_providers_json: '',
    active_video_provider_id: '',
    image_provider_template: 'openai-images',
    image_aspect_ratio: '3:4',
    image_size: '',
    image_quality: 'medium',
    model_name_wander: '',
    model_name_chatroom: '',
    model_name_knowledge: '',
    model_name_gardenflow: '',
    proxy_enabled: false,
    proxy_url: '',
    proxy_bypass: 'localhost,127.0.0.1,::1',
    gardenflow_compact_target_tokens: '256000',
    chat_max_tokens_default: String(DEFAULT_CHAT_MAX_TOKENS),
    chat_max_tokens_deepseek: String(DEFAULT_CHAT_MAX_TOKENS_DEEPSEEK),
    wander_deep_think_enabled: false,
    debug_log_enabled: false,
    diagnostics_upload_consent: 'approved',
    diagnostics_include_advanced_context: false,
    diagnostics_auto_send_same_crash: false,
    diagnostics_last_prompted_at: '',
    analytics_consent: 'approved',
    release_log_retention_days: '7',
    release_log_max_file_mb: '10',
    cli_runtime_execution_mode: 'host_compatible',
    developer_mode_enabled: false,
    developer_mode_unlocked_at: '',
    ai_model_routes_json: JSON.stringify(DEFAULT_AI_MODEL_ROUTES),
    image_hosting_json: serializeImageHostingSettings(null),
    ecommerce_platforms_json: serializeEcommercePlatformsSettings(createDefaultEcommercePlatformsSettings()),
  });
  const [aiModelRoutes, setAiModelRoutes] = useState<AiModelRoutes>(DEFAULT_AI_MODEL_ROUTES);
  const [aiSources, setAiSources] = useState<AiSourceConfig[]>([]);
  const [defaultAiSourceId, setDefaultAiSourceId] = useState('');
  const [activeAiSourceId, setActiveAiSourceId] = useState('');
  const [detectedAiProtocol, setDetectedAiProtocol] = useState<AiProtocol>('openai');
  const [aiSourceExpandState, setAiSourceExpandState] = useState<Record<string, boolean>>({});
  const [aiSourceModelExpandState, setAiSourceModelExpandState] = useState<Record<string, boolean>>({});
  const [sourceModelDrafts, setSourceModelDrafts] = useState<Record<string, string>>({});
  const [sourceModelCapabilityDrafts, setSourceModelCapabilityDrafts] = useState<Record<string, ModelCapability>>({});
  const [discoveredModelsBySource, setDiscoveredModelsBySource] = useState<Record<string, AiModelDescriptor[]>>({});
  const [sourceModelDiscoveryBusy, setSourceModelDiscoveryBusy] = useState<Record<string, boolean>>({});
  const [sourceModelDiscoveryMessages, setSourceModelDiscoveryMessages] = useState<Record<string, string>>({});
  const [addModelModalSourceId, setAddModelModalSourceId] = useState('');
  const [videoModelDraft, setVideoModelDraft] = useState('');
  const [selectedVideoProviderId, setSelectedVideoProviderId] = useState('');
  const [isVideoProviderCreateOpen, setIsVideoProviderCreateOpen] = useState(false);
  const [videoProviderCreatePreset, setVideoProviderCreatePreset] = useState<VideoGenerationProviderPreset>('custom');
  const [videoProviderCreateName, setVideoProviderCreateName] = useState('自定义视频服务商');
  const [isCreateAiSourceModalOpen, setIsCreateAiSourceModalOpen] = useState(false);
  const [createAiSourceDraft, setCreateAiSourceDraft] = useState<CreateAiSourceDraft>(() => createAiSourceDraftFromPreset(DEFAULT_AI_PRESET_ID));
  const [missingCustomSourceNoticeScope, setMissingCustomSourceNoticeScope] = useState<AiModelRouteScope | null>(null);
  const [transcriptionSourceId, setTranscriptionSourceId] = useState('');
  const [embeddingSourceId, setEmbeddingSourceId] = useState('');
  const [visualIndexSourceId, setVisualIndexSourceId] = useState('');
  const [videoAnalysisSourceId, setVideoAnalysisSourceId] = useState('');
  const [imageSourceId, setImageSourceId] = useState('');
  const [voiceSourceId, setVoiceSourceId] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');
  const [recentDebugLogs, setRecentDebugLogs] = useState<string[]>([]);
  const [isDebugLogsLoading, setIsDebugLogsLoading] = useState(false);
  const [fileIndexDashboard, setFileIndexDashboard] = useState<FileIndexDashboard | null>(
    () => initialFileIndexDashboardCache?.dashboard ?? null,
  );
  const [isFileIndexDashboardLoading, setIsFileIndexDashboardLoading] = useState(false);
  const [logStatus, setLogStatus] = useState<DiagnosticsLogStatus | null>(null);
  const [pendingDiagnosticReports, setPendingDiagnosticReports] = useState<DiagnosticsPendingReport[]>([]);
  const [diagnosticsActionBusy, setDiagnosticsActionBusy] = useState<string | null>(null);
  const [toolDiagnostics, setToolDiagnostics] = useState<ToolDiagnosticDescriptor[]>([]);
  const [toolDiagnosticResults, setToolDiagnosticResults] = useState<Record<string, ToolDiagnosticRunResult | undefined>>({});
  const [toolDiagnosticRunning, setToolDiagnosticRunning] = useState<Record<string, 'direct' | 'ai' | undefined>>({});
  const [runtimeTasks, setRuntimeTasks] = useState<AgentTaskSnapshot[]>([]);
  const [runtimeRoles, setRuntimeRoles] = useState<RoleSpec[]>([]);
  const [runtimeDiagnosticsSummary, setRuntimeDiagnosticsSummary] = useState<RuntimeDiagnosticsSummary | null>(null);
  const [runtimeSessions, setRuntimeSessions] = useState<RuntimeSessionListItem[]>([]);
  const [selectedRuntimeTaskId, setSelectedRuntimeTaskId] = useState('');
  const [selectedRuntimeSessionId, setSelectedRuntimeSessionId] = useState('');
  const [runtimeTaskTraces, setRuntimeTaskTraces] = useState<AgentTaskTrace[]>([]);
  const [runtimeSessionTranscript, setRuntimeSessionTranscript] = useState<RuntimeSessionTranscriptItem[]>([]);
  const [runtimeSessionCheckpoints, setRuntimeSessionCheckpoints] = useState<RuntimeSessionCheckpointItem[]>([]);
  const [runtimeSessionToolResults, setRuntimeSessionToolResults] = useState<RuntimeSessionToolResultItem[]>([]);
  const [runtimeHooks, setRuntimeHooks] = useState<RuntimeHookDefinition[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTaskItem[]>([]);
  const [backgroundWorkerPool, setBackgroundWorkerPool] = useState<BackgroundWorkerPoolState>({ json: [], runtime: [] });
  const [selectedBackgroundTaskId, setSelectedBackgroundTaskId] = useState('');
  const [selectedBackgroundTaskDetail, setSelectedBackgroundTaskDetail] = useState<BackgroundTaskItem | null>(null);
  const [runtimeDraftInput, setRuntimeDraftInput] = useState('');
  const [runtimeDraftMode, setRuntimeDraftMode] = useState<'gardenflow' | 'knowledge' | 'team' | 'advisor-discussion' | 'background-maintenance' | 'diagnostics'>('gardenflow');
  const [isRuntimeLoading, setIsRuntimeLoading] = useState(false);
  const [isRuntimeTraceLoading, setIsRuntimeTraceLoading] = useState(false);
  const [isRuntimeSessionLoading, setIsRuntimeSessionLoading] = useState(false);
  const [isBackgroundTasksLoading, setIsBackgroundTasksLoading] = useState(false);
  const [isRuntimeCreating, setIsRuntimeCreating] = useState(false);
  const [runtimeTaskActionRunning, setRuntimeTaskActionRunning] = useState<Record<string, 'resume' | 'cancel' | undefined>>({});
  const [backgroundTaskActionRunning, setBackgroundTaskActionRunning] = useState<Record<string, 'cancel' | undefined>>({});
  const [runtimePerfMode, setRuntimePerfMode] = useState<RuntimePerfBenchmarkMode>('diagnostics');
  const [runtimePerfPresetId, setRuntimePerfPresetId] = useState<string>(RUNTIME_PERF_PRESETS[0].id);
  const [runtimePerfMessage, setRuntimePerfMessage] = useState<string>(RUNTIME_PERF_PRESETS[0].message);
  const [runtimePerfIterations, setRuntimePerfIterations] = useState(1);
  const [isRuntimePerfRunning, setIsRuntimePerfRunning] = useState(false);
  const [runtimePerfStatusMessage, setRuntimePerfStatusMessage] = useState('');
  const [runtimePerfResults, setRuntimePerfResults] = useState<RuntimePerfRunResult[]>([]);
  const [activeRuntimePerfRunId, setActiveRuntimePerfRunId] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState('');
  const [gardenflowProfileDraft, setGardenFlowProfileDraft] = useState<GardenFlowProfileDraft>(EMPTY_GARDENFLOW_PROFILE_DRAFT);
  const [savedGardenFlowProfileDraft, setSavedGardenFlowProfileDraft] = useState<GardenFlowProfileDraft>(EMPTY_GARDENFLOW_PROFILE_DRAFT);
  const [gardenflowProfileRoot, setGardenFlowProfileRoot] = useState('');
  const [isGardenFlowProfileLoading, setIsGardenFlowProfileLoading] = useState(false);
  const [gardenflowProfileDirty, setGardenFlowProfileDirty] = useState(false);
  const [gardenflowProfileMessage, setGardenFlowProfileMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [gardenflowOnboardingState, setGardenFlowOnboardingState] = useState<GardenFlowOnboardingState>(null);
  const [currentSpaceId, setCurrentSpaceId] = useState(DEFAULT_SPACE_ID);
  const [spaces, setSpaces] = useState<WorkspaceSpace[]>([]);
  const [assistantDaemonStatus, setAssistantDaemonStatus] = useState<AssistantDaemonStatus | null>(null);
  const [assistantDaemonDraft, setAssistantDaemonDraftState] = useState<AssistantDaemonDraft>(() => createDefaultAssistantDaemonDraft());
  const [assistantDaemonLogs, setAssistantDaemonLogs] = useState<string[]>([]);
  const [assistantDaemonBusy, setAssistantDaemonBusy] = useState(false);
  const [assistantDaemonDraftDirty, setAssistantDaemonDraftDirty] = useState(false);
  const [assistantDaemonAcpToken, setAssistantDaemonAcpToken] = useState('');
  const [assistantDaemonWeixinLoginBusy, setAssistantDaemonWeixinLoginBusy] = useState(false);
  const [assistantDaemonWeixinLogin, setAssistantDaemonWeixinLogin] = useState<AssistantDaemonWeixinLoginState | null>(null);
  const [developerVersionTapCount, setDeveloperVersionTapCount] = useState(0);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettingsPayload>(DEFAULT_NOTIFICATION_SETTINGS);
  const hasSelectedRuntimeSession = useMemo(
    () => Boolean(selectedRuntimeSessionId && runtimeSessions.some((session) => session.id === selectedRuntimeSessionId)),
    [runtimeSessions, selectedRuntimeSessionId],
  );
  const gardenflowOnboardingCompleted = useMemo(
    () => isGardenFlowOnboardingCompleted(gardenflowOnboardingState),
    [gardenflowOnboardingState],
  );
  const currentSpaceName = useMemo(
    () => spaces.find((space) => space.id === currentSpaceId)?.name || currentSpaceId,
    [currentSpaceId, spaces],
  );
  const ecommercePlatformsSettings = useMemo(
    () => normalizeEcommercePlatformsSettings(formData.ecommerce_platforms_json),
    [formData.ecommerce_platforms_json],
  );

  const handleToggleEcommercePlatform = useCallback((platformId: string, enabled: boolean) => {
    setFormData((prev: any) => {
      const nextSettings = normalizeEcommercePlatformsSettings(prev.ecommerce_platforms_json);
      nextSettings.enabledById = {
        ...nextSettings.enabledById,
        [platformId]: enabled,
      };
      return {
        ...prev,
        ecommerce_platforms_json: serializeEcommercePlatformsSettings(nextSettings),
      };
    });
  }, []);

  const updateRuntimePerfRun = useCallback((runId: string, updater: (run: RuntimePerfRunResult) => RuntimePerfRunResult) => {
    setRuntimePerfResults((prev) =>
      prev.map((run) => (run.id === runId ? updater(run) : run))
    );
  }, []);

  const snapshotRuntimePerfCollector = useCallback((collector: RuntimePerfCollector) => ({
    thinkingStartedMs: collector.thinkingStartedMs,
    thoughtFirstTokenMs: collector.thoughtFirstTokenMs,
    firstResponseMs: collector.firstResponseMs,
    firstToolStartMs: collector.firstToolStartMs,
    firstCheckpointMs: collector.firstCheckpointMs,
    responseChars: collector.responseChars,
    toolCalls: collector.toolCalls,
    toolSuccessCount: collector.toolSuccessCount,
    toolFailureCount: collector.toolFailureCount,
    checkpointCount: collector.checkpointCount,
    checkpointTypes: [...collector.checkpointTypes],
    timeline: [...collector.timeline],
  }), []);

  const appendRuntimePerfTimeline = useCallback((
    collector: RuntimePerfCollector,
    event: Omit<RuntimePerfTimelineItem, 'id' | 'offsetMs'> & { offsetMs?: number },
  ) => {
    const offsetMs = typeof event.offsetMs === 'number'
      ? event.offsetMs
      : Math.max(0, event.at - collector.startedAt);
    const item: RuntimePerfTimelineItem = {
      id: `${collector.runId}:${collector.timeline.length}:${event.eventType}:${event.at}`,
      at: event.at,
      offsetMs,
      eventType: event.eventType,
      label: event.label,
      detail: event.detail,
      tone: event.tone,
    };
    collector.timeline = [...collector.timeline, item].slice(-RUNTIME_PERF_TIMELINE_LIMIT);
  }, []);

  const buildWeixinQrImageUrl = useCallback(async (rawUrl?: string): Promise<string | undefined> => {
    const text = String(rawUrl || '').trim();
    if (!text) return undefined;
    try {
      const QRCode = await import('qrcode');
      return await QRCode.toDataURL(text, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 320,
      });
    } catch (error) {
      console.error('Failed to build Weixin QR image', error);
      return undefined;
    }
  }, []);

  const setGardenFlowProfileDirtyState = useCallback((next: boolean) => {
    gardenflowProfileDirtyRef.current = next;
    setGardenFlowProfileDirty(next);
  }, []);

  const setCurrentSpaceState = useCallback((spaceId?: string | null) => {
    const normalized = String(spaceId || '').trim() || DEFAULT_SPACE_ID;
    currentSpaceIdRef.current = normalized;
    setCurrentSpaceId(normalized);
    return normalized;
  }, []);

  const loadSpaceContext = useCallback(async () => {
    try {
      const result = await window.ipcRenderer.spaces.list() as { spaces?: WorkspaceSpace[]; activeSpaceId?: string } | null;
      const nextSpaces = Array.isArray(result?.spaces) ? result.spaces : [];
      setSpaces(nextSpaces);
      if (result?.activeSpaceId) {
        setCurrentSpaceState(result.activeSpaceId);
      }
    } catch (error) {
      console.error('Failed to load settings spaces:', error);
    }
  }, [setCurrentSpaceState]);

  const resetGardenFlowProfileState = useCallback(() => {
    gardenflowProfileLoadRequestRef.current += 1;
    setGardenFlowProfileRoot('');
    setSavedGardenFlowProfileDraft(EMPTY_GARDENFLOW_PROFILE_DRAFT);
    setGardenFlowProfileDraft(EMPTY_GARDENFLOW_PROFILE_DRAFT);
    setGardenFlowOnboardingState(null);
    setGardenFlowProfileDirtyState(false);
    setGardenFlowProfileMessage(null);
    setIsGardenFlowProfileLoading(false);
  }, [setGardenFlowProfileDirtyState]);

  const loadGardenFlowProfileBundle = useCallback(async (options?: { preserveDraft?: boolean; expectedSpaceId?: string }) => {
    const expectedSpaceId = String(options?.expectedSpaceId || currentSpaceIdRef.current || DEFAULT_SPACE_ID).trim() || DEFAULT_SPACE_ID;
    const requestId = ++gardenflowProfileLoadRequestRef.current;
    setIsGardenFlowProfileLoading(true);
    try {
      const bundle = await window.ipcRenderer.gardenflowProfile.getBundle();
      if (requestId !== gardenflowProfileLoadRequestRef.current) return;
      const responseSpaceId = String(bundle.activeSpaceId || expectedSpaceId).trim() || DEFAULT_SPACE_ID;
      if (responseSpaceId !== currentSpaceIdRef.current) {
        setCurrentSpaceState(responseSpaceId);
      }
      setGardenFlowOnboardingState(
        bundle.onboardingState && typeof bundle.onboardingState === 'object'
          ? bundle.onboardingState as Record<string, unknown>
          : null
      );
      if (options?.preserveDraft && gardenflowProfileDirtyRef.current) {
        setGardenFlowProfileRoot(String(bundle.profileRoot || '').trim());
        return;
      }
      const files = bundle.files || {};
      const nextDraft: GardenFlowProfileDraft = {
        user: String(bundle.user || files.user || ''),
        creatorProfile: String(bundle.creatorProfile || files.creatorProfile || ''),
      };
      setGardenFlowProfileRoot(String(bundle.profileRoot || '').trim());
      setSavedGardenFlowProfileDraft(nextDraft);
      setGardenFlowProfileDraft(nextDraft);
      setGardenFlowProfileDirtyState(false);
      setGardenFlowProfileMessage(null);
    } catch (error) {
      if (requestId !== gardenflowProfileLoadRequestRef.current) return;
      console.error('Failed to load AI profile bundle', error);
      setGardenFlowProfileMessage({
        tone: 'error',
        text: `加载用户档案失败：${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      if (requestId === gardenflowProfileLoadRequestRef.current) {
        setIsGardenFlowProfileLoading(false);
      }
    }
  }, [setGardenFlowProfileDirtyState]);

  const handleGardenFlowProfileDraftChange = useCallback((field: keyof GardenFlowProfileDraft, value: string) => {
    setGardenFlowProfileDraft((prev) => {
      const next = {
        ...prev,
        [field]: value,
      };
      const dirty = next.user !== savedGardenFlowProfileDraft.user
        || next.creatorProfile !== savedGardenFlowProfileDraft.creatorProfile;
      setGardenFlowProfileDirtyState(dirty);
      return next;
    });
    setGardenFlowProfileMessage(null);
    setStatus('idle');
  }, [savedGardenFlowProfileDraft.creatorProfile, savedGardenFlowProfileDraft.user, setGardenFlowProfileDirtyState]);

  const settingsLoadRequestRef = useRef(0);
  const debugLogsLoadRequestRef = useRef(0);
  const runtimeTasksLoadRequestRef = useRef(0);
  const runtimeSummaryLoadRequestRef = useRef(0);
  const runtimeSessionsLoadRequestRef = useRef(0);
  const runtimeTaskTracesLoadRequestRef = useRef(0);
  const runtimeSessionDetailsLoadRequestRef = useRef(0);
  const runtimeObservabilityRefreshTimerRef = useRef<number | null>(null);
  const runtimePerfCollectorRef = useRef<RuntimePerfCollector | null>(null);
  const runtimePerfRunCounterRef = useRef(0);
  const backgroundTasksLoadRequestRef = useRef(0);
  const backgroundWorkerPoolLoadRequestRef = useRef(0);
  const fileIndexDashboardLoadRequestRef = useRef(0);
  const fileIndexDashboardInFlightRef = useRef<Promise<FileIndexDashboard | null> | null>(null);
  const fileIndexDashboardRefreshTimerRef = useRef<number | null>(null);
  const fileIndexDashboardCurrentRef = useRef<FileIndexDashboard | null>(
    initialFileIndexDashboardCache?.dashboard ?? null,
  );
  const fileIndexDashboardLoadedAtRef = useRef(initialFileIndexDashboardCache?.savedAt ?? 0);
  const assistantDaemonLogBufferRef = useRef<string[]>([]);
  const assistantDaemonLogFlushTimerRef = useRef<number | null>(null);
  const aiSourceAutosaveTimerRef = useRef<number | null>(null);
  const remoteTabWarmTimerRef = useRef<number | null>(null);
  const settingsActivationTimerRef = useRef<number | null>(null);
  const gardenflowProfileLoadRequestRef = useRef(0);
  const baseSettingsLoadedRef = useRef(false);
  const baseSettingsInFlightRef = useRef(false);
  const aiSourceDraftDirtyRef = useRef(false);
  const aiSourceEditGenerationRef = useRef(0);
  const gardenflowProfileDirtyRef = useRef(false);
  const currentSpaceIdRef = useRef(DEFAULT_SPACE_ID);
  const tabWarmRef = useRef<Record<SettingsTab, boolean>>({
    general: false,
    ai: false,
    team: false,
    platforms: false,
    skills: false,
    mcp: false,
    tools: false,
    profile: false,
    remote: false,
    experimental: false,
  });
  const tabInFlightRef = useRef<Record<SettingsTab, boolean>>({
    general: false,
    ai: false,
    team: false,
    platforms: false,
    skills: false,
    mcp: false,
    tools: false,
    profile: false,
    remote: false,
    experimental: false,
  });

  const markAiSourceDraftDirty = useCallback(() => {
    aiSourceDraftDirtyRef.current = true;
    aiSourceEditGenerationRef.current += 1;
  }, []);

  const clearAiSourceDraftDirty = useCallback((expectedGeneration?: number) => {
    if (
      typeof expectedGeneration === 'number'
      && aiSourceEditGenerationRef.current !== expectedGeneration
    ) {
      return;
    }
    aiSourceDraftDirtyRef.current = false;
  }, []);

  const officialAiSourcePlaceholder = useMemo(() => createOfficialAiSource(), []);

  const activeAiSource = useMemo(() => {
    const normalizedActiveId = canonicalizeOfficialAutoSourceId(activeAiSourceId);
    if (!aiSources.length) {
      return isOfficialAutoSourceId(normalizedActiveId) ? officialAiSourcePlaceholder : null;
    }
    const matchedSource = aiSources.find((source) => source.id === normalizedActiveId);
    if (matchedSource) return matchedSource;
    if (isOfficialAutoSourceId(normalizedActiveId)) return officialAiSourcePlaceholder;
    return aiSources[0] || null;
  }, [aiSources, activeAiSourceId, officialAiSourcePlaceholder]);

  const addModelModalSource = useMemo(() => {
    if (!addModelModalSourceId) return null;
    return aiSources.find((source) => source.id === addModelModalSourceId) || null;
  }, [aiSources, addModelModalSourceId]);

  const getSourceModelList = useCallback((source: AiSourceConfig) => {
    const merged = new Map<string, AiModelDescriptor>();
    for (const raw of (source.modelsMeta || [])) {
      const descriptor = toAiModelDescriptor(raw);
      if (!descriptor) continue;
      merged.set(descriptor.id, descriptor);
    }
    for (const raw of [...(source.models || []), source.model]) {
      const descriptor = toAiModelDescriptor(raw);
      if (!descriptor) continue;
      const previous = merged.get(descriptor.id);
      merged.set(descriptor.id, {
        id: descriptor.id,
        capabilities: Array.from(new Set([...(previous?.capabilities || []), ...descriptor.capabilities])),
        inputCapabilities: Array.from(new Set([...(previous?.inputCapabilities || []), ...descriptor.inputCapabilities])),
      });
    }
    return Array.from(merged.values());
  }, []);

  const getAddedSourceModelList = useCallback((source: AiSourceConfig) => {
    return normalizeAiModelDescriptors([
      ...(source.modelsMeta || []),
      ...(source.models || []).map((id) => ({ id })),
      source.model ? { id: source.model } : null,
    ]);
  }, []);

  const getAiSourceById = useCallback((sourceId: string): AiSourceConfig | null => {
    const normalizedSourceId = canonicalizeOfficialAutoSourceId(sourceId);
    if (!normalizedSourceId) return null;
    return aiSources.find((source) => source.id === normalizedSourceId)
      || (isOfficialAutoSourceId(normalizedSourceId) ? officialAiSourcePlaceholder : null);
  }, [aiSources, officialAiSourcePlaceholder]);

  const pickBestModelForSource = useCallback((
    source: AiSourceConfig | null,
    preferredModel?: string,
    capability: ModelCapability = 'chat',
  ): string => {
    if (!source) return '';
    const normalizedPreferredModel = String(preferredModel || '').trim();
    const sourceModels = getSourceModelList(source);
    const matchingModels = filterAiModelsByCapability(sourceModels, capability);
    if (normalizedPreferredModel && matchingModels.some((item) => item.id === normalizedPreferredModel)) {
      return normalizedPreferredModel;
    }
    const currentDefault = String(source.model || '').trim();
    if (currentDefault && matchingModels.some((item) => item.id === currentDefault)) {
      return currentDefault;
    }
    return String(matchingModels[0]?.id || '').trim();
  }, [getSourceModelList]);

  const pickCapabilityModelForSource = useCallback((
    source: AiSourceConfig | null,
    preferredModel: string,
    capability: ModelCapability,
  ): string => {
    if (!source) return '';
    const normalizedPreferredModel = String(preferredModel || '').trim();
    const matchingModels = filterAiModelsByCapability(getSourceModelList(source), capability);
    if (normalizedPreferredModel && matchingModels.some((item) => item.id === normalizedPreferredModel)) {
      return normalizedPreferredModel;
    }
    const currentDefault = String(source.model || '').trim();
    if (currentDefault && matchingModels.some((item) => item.id === currentDefault)) {
      return currentDefault;
    }
    return String(matchingModels[0]?.id || '').trim();
  }, [getSourceModelList]);

  const filterVisualIndexModels = useCallback((models: AiModelDescriptor[]): AiModelDescriptor[] => {
    const multimodalChatModels = models.filter((model) => (
      model.capabilities.includes('chat') && model.inputCapabilities.includes('image')
    ));
    if (multimodalChatModels.length > 0) return multimodalChatModels;
    const chatModels = filterAiModelsByCapability(models, 'chat');
    return chatModels.length > 0 ? chatModels : models;
  }, []);

  const filterVideoAnalysisModels = useCallback((models: AiModelDescriptor[]): AiModelDescriptor[] => {
    return models.filter((model) => (
      model.inputCapabilities.includes('video')
    ));
  }, []);

  const pickBestVisualIndexModelForSource = useCallback((
    source: AiSourceConfig | null,
    preferredModel?: string,
  ): string => {
    if (!source) return '';
    const normalizedPreferredModel = String(preferredModel || '').trim();
    const sourceModels = getSourceModelList(source);
    const visualModels = filterVisualIndexModels(sourceModels);
    if (normalizedPreferredModel && visualModels.some((item) => item.id === normalizedPreferredModel)) {
      return normalizedPreferredModel;
    }
    const currentDefault = String(source.model || '').trim();
    if (currentDefault && visualModels.some((item) => item.id === currentDefault)) {
      return currentDefault;
    }
    return String(visualModels[0]?.id || currentDefault || sourceModels[0]?.id || '').trim();
  }, [filterVisualIndexModels, getSourceModelList]);

  const pickBestVideoAnalysisModelForSource = useCallback((
    source: AiSourceConfig | null,
    preferredModel?: string,
  ): string => {
    if (!source) return '';
    const normalizedPreferredModel = String(preferredModel || '').trim();
    const sourceModels = getSourceModelList(source);
    const videoModels = filterVideoAnalysisModels(sourceModels);
    if (normalizedPreferredModel && videoModels.some((item) => item.id === normalizedPreferredModel)) {
      return normalizedPreferredModel;
    }
    const currentDefault = String(source.model || '').trim();
    if (currentDefault && videoModels.some((item) => item.id === currentDefault)) {
      return currentDefault;
    }
    return String(videoModels[0]?.id || '').trim();
  }, [filterVideoAnalysisModels, getSourceModelList]);

  const resolveLinkedSourceId = useCallback((options: {
    endpoint?: string;
    apiKey?: string;
    model?: string;
    fallbackId?: string;
  }): string => {
    if (!aiSources.length) return '';
    const normalizedEndpoint = String(options.endpoint || '').trim();
    const normalizedApiKey = String(options.apiKey || '').trim();
    const normalizedModel = String(options.model || '').trim();
    let bestSourceId = '';
    let bestScore = -1;

    for (const source of aiSources) {
      let score = 0;
      const sourceEndpoint = String(source.baseURL || '').trim();
      const sourceApiKey = String(source.apiKey || '').trim();
      const sourceModels = getSourceModelList(source).map((item) => item.id);
      if (normalizedEndpoint && sourceEndpoint === normalizedEndpoint) score += 4;
      if (normalizedApiKey && sourceApiKey && sourceApiKey === normalizedApiKey) score += 2;
      if (normalizedModel && sourceModels.includes(normalizedModel)) score += 1;
      if (score > bestScore) {
        bestScore = score;
        bestSourceId = source.id;
      }
    }

    if (bestScore > 0 && bestSourceId) return bestSourceId;
    const fallbackId = String(options.fallbackId || '').trim();
    if (fallbackId && aiSources.some((source) => source.id === fallbackId)) return fallbackId;
    return aiSources[0]?.id || '';
  }, [aiSources, getSourceModelList]);

  const inferImageRoutingFromSource = useCallback((source: AiSourceConfig) => {
    const presetId = String(source.presetId || inferPresetIdByEndpoint(source.baseURL || '') || '').trim().toLowerCase();
    if (presetId === 'buts') {
      return { provider: 'buts', template: 'dashscope-wan-native' };
    }
    if (presetId.includes('dashscope') || presetId.includes('qwen')) {
      return { provider: 'dashscope', template: 'dashscope-wan-native' };
    }
    if (presetId.includes('jimeng')) {
      return { provider: 'jimeng', template: 'jimeng-openai-wrapper' };
    }
    if (presetId.includes('ark')) {
      return { provider: 'ark-seedream', template: 'ark-seedream-native' };
    }
    if (presetId.includes('gemini')) {
      return { provider: 'gemini', template: 'gemini-openai-images' };
    }
    return { provider: 'openai-compatible', template: 'openai-images' };
  }, []);

  const handleLinkedSourceChange = useCallback((feature: 'transcription' | 'embedding' | 'visual' | 'videoAnalysis' | 'image' | 'voice' | 'video', nextSourceId: string) => {
    const source = getAiSourceById(nextSourceId);
    if (!source) return;
    markAiSourceDraftDirty();

    const linkedRouteScope: AiModelRouteScope | null = (() => {
      if (feature === 'transcription') return 'transcription';
      if (feature === 'embedding') return 'embedding';
      if (feature === 'visual') return 'visualIndex';
      if (feature === 'videoAnalysis') return 'videoAnalysis';
      if (feature === 'image') return 'image';
      if (feature === 'voice') return 'voiceTts';
      return null;
    })();
    if (linkedRouteScope) {
      const normalizedSourceId = canonicalizeOfficialAutoSourceId(source.id);
      setAiModelRoutes((prev) => {
        const next = {
          ...prev,
          [linkedRouteScope]: {
            ...prev[linkedRouteScope],
            mode: isOfficialAutoSourceId(normalizedSourceId) ? 'official' : 'custom',
            sourceId: normalizedSourceId,
          },
        } as AiModelRoutes;
        setFormData((data) => ({ ...data, ai_model_routes_json: JSON.stringify(next) }));
        return next;
      });
    }

    if (feature === 'transcription') setTranscriptionSourceId(nextSourceId);
    if (feature === 'embedding') setEmbeddingSourceId(nextSourceId);
    if (feature === 'visual') setVisualIndexSourceId(nextSourceId);
    if (feature === 'videoAnalysis') setVideoAnalysisSourceId(nextSourceId);
    if (feature === 'image') setImageSourceId(nextSourceId);
    if (feature === 'voice') setVoiceSourceId(nextSourceId);
    setFormData((prev) => {
      if (feature === 'transcription') {
        return {
          ...prev,
          transcription_endpoint: String(source.baseURL || '').trim(),
          transcription_key: String(source.apiKey || '').trim(),
          transcription_model: pickBestModelForSource(source, prev.transcription_model, 'transcription'),
        };
      }
      if (feature === 'embedding') {
        return {
          ...prev,
          embedding_endpoint: String(source.baseURL || '').trim(),
          embedding_key: String(source.apiKey || '').trim(),
          embedding_model: pickBestModelForSource(source, prev.embedding_model, 'embedding'),
        };
      }
      if (feature === 'visual') {
        return {
          ...prev,
          visual_index_provider: 'openai-compatible',
          visual_index_endpoint: String(source.baseURL || '').trim(),
          visual_index_api_key: String(source.apiKey || '').trim(),
          visual_index_model: pickBestVisualIndexModelForSource(source, prev.visual_index_model),
        };
      }
      if (feature === 'videoAnalysis') {
        return {
          ...prev,
          video_analysis_endpoint: String(source.baseURL || '').trim(),
          video_analysis_api_key: String(source.apiKey || '').trim(),
          video_analysis_protocol: source.protocol || findAiPresetById(source.presetId)?.protocol || 'openai',
          video_analysis_model: pickBestVideoAnalysisModelForSource(source, prev.video_analysis_model),
        };
      }
      if (feature === 'video') {
        return prev;
      }
      if (feature === 'voice') {
        const ttsModel = pickBestModelForSource(source, prev.voice_tts_model || prev.tts_model, 'tts')
          || pickBestModelForSource(source, prev.voice_tts_model || prev.tts_model, 'audio');
        const nextTtsModel = ttsModel || prev.voice_tts_model || DEFAULT_VOICE_TTS_MODEL;
        const nextCloneModel = cloneModelForVoiceTtsModel(nextTtsModel, prev.voice_clone_model || DEFAULT_VOICE_CLONE_MODEL);
        return {
          ...prev,
          voice_endpoint: String(source.baseURL || '').trim(),
          voice_api_key: String(source.apiKey || '').trim(),
          voice_tts_model: nextTtsModel,
          tts_model: nextTtsModel,
          voice_clone_model: nextCloneModel,
        };
      }

      const nextRouting = inferImageRoutingFromSource(source);
      const nextTemplate = inferImageTemplateByProvider(nextRouting.provider, nextRouting.template);
      const nextModel = pickBestModelForSource(source, prev.image_model, 'image');

      return {
        ...prev,
        image_provider: nextRouting.provider,
        image_provider_template: nextTemplate,
        image_endpoint: String(source.baseURL || '').trim(),
        image_api_key: String(source.apiKey || '').trim(),
        image_model: nextModel,
      };
    });
  }, [getAiSourceById, inferImageRoutingFromSource, markAiSourceDraftDirty, pickBestModelForSource, pickBestVideoAnalysisModelForSource, pickBestVisualIndexModelForSource]);

  const selectedTranscriptionSource = useMemo(() => {
    return getAiSourceById(transcriptionSourceId);
  }, [getAiSourceById, transcriptionSourceId]);

  const selectedEmbeddingSource = useMemo(() => {
    return getAiSourceById(embeddingSourceId);
  }, [embeddingSourceId, getAiSourceById]);

  const selectedVisualIndexSource = useMemo(() => {
    return getAiSourceById(visualIndexSourceId);
  }, [getAiSourceById, visualIndexSourceId]);

  const selectedVideoAnalysisSource = useMemo(() => {
    return getAiSourceById(videoAnalysisSourceId);
  }, [getAiSourceById, videoAnalysisSourceId]);

  const selectedImageSource = useMemo(() => {
    return getAiSourceById(imageSourceId);
  }, [getAiSourceById, imageSourceId]);

  const selectedVoiceSource = useMemo(() => {
    return getAiSourceById(voiceSourceId);
  }, [getAiSourceById, voiceSourceId]);

  const transcriptionSourceModels = useMemo(() => {
    return selectedTranscriptionSource ? filterAiModelsByCapability(getSourceModelList(selectedTranscriptionSource), 'transcription') : [];
  }, [getSourceModelList, selectedTranscriptionSource]);

  const embeddingSourceModels = useMemo(() => {
    return selectedEmbeddingSource ? filterAiModelsByCapability(getSourceModelList(selectedEmbeddingSource), 'embedding') : [];
  }, [getSourceModelList, selectedEmbeddingSource]);

  const visualIndexSourceModels = useMemo(() => {
    return selectedVisualIndexSource ? filterVisualIndexModels(getSourceModelList(selectedVisualIndexSource)) : [];
  }, [filterVisualIndexModels, getSourceModelList, selectedVisualIndexSource]);

  const videoAnalysisSourceModels = useMemo(() => {
    return selectedVideoAnalysisSource ? filterVideoAnalysisModels(getSourceModelList(selectedVideoAnalysisSource)) : [];
  }, [filterVideoAnalysisModels, getSourceModelList, selectedVideoAnalysisSource]);

  const imageSourceModels = useMemo(() => {
    return selectedImageSource ? filterAiModelsByCapability(getSourceModelList(selectedImageSource), 'image') : [];
  }, [getSourceModelList, selectedImageSource]);

  const voiceTtsSourceModels = useMemo(() => {
    const sourceModels = selectedVoiceSource ? getSourceModelList(selectedVoiceSource) : [];
    const ttsModels = filterAiModelsByCapability(sourceModels, 'tts');
    return ttsModels.length > 0 ? ttsModels : filterAiModelsByCapability(sourceModels, 'audio');
  }, [getSourceModelList, selectedVoiceSource]);

  const videoProviders = useMemo(() => normalizeVideoProviderConfigs(
    formData.video_providers_json,
    {
      endpoint: formData.video_endpoint,
      apiKey: formData.video_api_key,
      model: formData.video_model,
      modelsJson: formData.video_models_json,
    },
  ), [
    formData.video_api_key,
    formData.video_endpoint,
    formData.video_model,
    formData.video_models_json,
    formData.video_providers_json,
  ]);

  const activeVideoProviderId = videoProviders.some((provider) => provider.id === formData.active_video_provider_id)
    ? String(formData.active_video_provider_id)
    : (videoProviders[0]?.id || '');

  const selectedVideoProvider = videoProviders.find((provider) => provider.id === selectedVideoProviderId)
    || videoProviders.find((provider) => provider.id === activeVideoProviderId)
    || videoProviders[0]
    || null;

  const videoModelOptions = selectedVideoProvider?.models || [];

  const addModelModalRemoteModels = useMemo(() => {
    if (!addModelModalSource) return [];
    return normalizeAiModelDescriptors([
      ...(discoveredModelsBySource[addModelModalSource.id] || []),
      ...getAddedSourceModelList(addModelModalSource),
    ]);
  }, [addModelModalSource, discoveredModelsBySource, getAddedSourceModelList]);

  const addModelModalDraft = addModelModalSource
    ? String(sourceModelDrafts[addModelModalSource.id] || '')
    : '';

  const addModelModalDraftTrimmed = addModelModalDraft.trim();
  const addModelModalCapability = addModelModalSource
    ? (sourceModelCapabilityDrafts[addModelModalSource.id] || 'chat')
    : 'chat';

  const addModelModalFilteredModels = useMemo(() => filterAiModelsByCapability(
    addModelModalRemoteModels,
    addModelModalCapability,
  ), [addModelModalCapability, addModelModalRemoteModels]);

  const groupedAiPresets = useMemo<AiPresetGroup[]>(() => {
    const codingPlan = AI_SOURCE_PRESETS.filter((preset) => preset.group === 'coding-plan');
    const general = AI_SOURCE_PRESETS.filter((preset) => preset.group !== 'coding-plan');
    return [
      { id: 'general', label: '通用供应商', items: general },
      { id: 'coding-plan', label: 'Coding Plan', items: codingPlan },
    ].filter((group) => group.items.length > 0);
  }, []);

  // Tools State
  const [thrivePlugins, setThrivePlugins] = useState<ThrivePluginSummary[]>([]);
  const [thrivePluginMarketplace, setThrivePluginMarketplace] = useState<ThrivePluginMarketplaceItem[]>([]);
  const [codexPluginMarketplace, setCodexPluginMarketplace] = useState<CodexPluginMarketplaceItem[]>([]);
  const [thrivePluginMarketplaceLoading, setThrivePluginMarketplaceLoading] = useState(false);
  const [codexPluginMarketplaceLoading, setCodexPluginMarketplaceLoading] = useState(false);
  const [thrivePluginsLoading, setThrivePluginsLoading] = useState(false);
  const [thrivePluginBusyId, setThrivePluginBusyId] = useState('');
  const [thrivePluginStatusMessage, setThrivePluginStatusMessage] = useState('');
  const [thrivePluginRepoInput, setThrivePluginRepoInput] = useState('');
  const [cliRuntimeTools, setCliRuntimeTools] = useState<CliRuntimeToolRecord[]>([]);
  const [cliRuntimeEnvironments, setCliRuntimeEnvironments] = useState<CliRuntimeEnvironmentRecord[]>([]);
  const [cliRuntimeInstallDraft, setCliRuntimeInstallDraft] = useState<{
    environmentId: string;
    installMethod: CliRuntimeInstallMethodOption;
    spec: string;
    toolName: string;
  }>({
    environmentId: '',
    installMethod: 'pnpm',
    spec: '',
    toolName: '',
  });
  const [cliRuntimeInstallQueue, setCliRuntimeInstallQueue] = useState<CliRuntimeInstallQueueItem[]>([]);
  const [cliRuntimeInstalling, setCliRuntimeInstalling] = useState(false);
  const [cliRuntimeStatusMessage, setCliRuntimeStatusMessage] = useState('');
  const [isCliRuntimeRefreshing, setIsCliRuntimeRefreshing] = useState(false);
  const [cliRuntimeInspectingToolId, setCliRuntimeInspectingToolId] = useState('');
  const [cliRuntimeDiagnosticCommand, setCliRuntimeDiagnosticCommand] = useState('');
  const [cliRuntimeExecutionMode, setCliRuntimeExecutionMode] = useState<CliRuntimeExecutionMode>('host_compatible');
  const [cliRuntimeDiscoverQuery, setCliRuntimeDiscoverQuery] = useState('');
  const [cliRuntimeDiscoverResults, setCliRuntimeDiscoverResults] = useState<CliRuntimeToolRecord[]>([]);
  const [cliRuntimeDiscovering, setCliRuntimeDiscovering] = useState(false);
  const [cliRuntimeCreatingEnvironment, setCliRuntimeCreatingEnvironment] = useState<CliRuntimeEnvironmentScope | ''>('');
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpStatusMessage, setMcpStatusMessage] = useState('');
  const [isSyncingMcp, setIsSyncingMcp] = useState(false);
  const [mcpTestingId, setMcpTestingId] = useState('');
  const [mcpOauthState, setMcpOauthState] = useState<Record<string, { connected: boolean; tokenPath?: string }>>({});
  const [mcpLiveSessions, setMcpLiveSessions] = useState<McpSessionState[]>([]);
  const [mcpRuntimeItems, setMcpRuntimeItems] = useState<McpServerRuntimeItem[]>([]);
  const [mcpInspectingId, setMcpInspectingId] = useState('');
  const [mcpDraft, setMcpDraft] = useState<McpServerDraft | null>(null);
  const [mcpDraftOriginalId, setMcpDraftOriginalId] = useState('');
  const settingsMcpRuntimeMap = useMemo(
    () => Object.fromEntries(mcpRuntimeItems.map((item) => [item.server.id, item.session || null])) as Record<string, McpSessionState | null>,
    [mcpRuntimeItems],
  );

  // Update State
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const [showAiModelSettings, setShowAiModelSettings] = useState(!hasOfficialAiPanel);
  const [officialAiPanelEnabled, setOfficialAiPanelEnabled] = useState(false);
  const [OfficialAiPanelComponent, setOfficialAiPanelComponent] = useState<ComponentType<OfficialAiPanelProps> | null>(null);
  const officialAiPanelRef = useRef<HTMLDivElement | null>(null);
  const pendingOfficialAiPanelScrollRef = useRef(false);
  const { snapshot: officialAuthState, bootstrapped: officialAuthBootstrapped } = useOfficialAuthState();

  useEffect(() => {
    if (!navigationTarget) return;
    if (navigationTarget.tab) {
      setActiveTab(navigationTarget.tab);
    }
    if (navigationTarget.tab === 'ai' && navigationTarget.aiModelSubTab === 'custom') {
      setShowAiModelSettings(true);
    }
    if (navigationTarget.tab === 'ai' && navigationTarget.aiModelSubTab === 'login') {
      if (!hasOfficialAiPanel) {
        setShowAiModelSettings(true);
        return;
      }
      setShowAiModelSettings(false);
      pendingOfficialAiPanelScrollRef.current = true;
      window.setTimeout(() => {
        officialAiPanelRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, 80);
    }
  }, [navigationTarget]);

  useEffect(() => {
    if (activeTab !== 'ai' || !officialAiPanelEnabled || !pendingOfficialAiPanelScrollRef.current) return;
    const handle = window.setTimeout(() => {
      officialAiPanelRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      pendingOfficialAiPanelScrollRef.current = false;
    }, OfficialAiPanelComponent ? 80 : 180);
    return () => window.clearTimeout(handle);
  }, [OfficialAiPanelComponent, activeTab, officialAiPanelEnabled]);

  const isDeprecatedEmptyOpenAiSource = useCallback((source?: AiSourceConfig | null): boolean => {
    if (!source) return false;
    const presetId = String(source.presetId || '').trim().toLowerCase();
    const name = String(source.name || '').trim();
    const baseURL = String(source.baseURL || '').trim().replace(/\/+$/, '');
    const model = String(source.model || '').trim();
    const models = Array.isArray(source.models) ? source.models.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const apiKey = String(source.apiKey || '').trim();
    return (
      presetId === 'openai'
      && name === 'OpenAI'
      && baseURL === 'https://api.openai.com/v1'
      && !apiKey
      && !model
      && models.length === 0
    );
  }, []);

  useEffect(() => {
    if (!hasOfficialAiPanel) {
      setOfficialAiPanelEnabled(false);
      setOfficialAiPanelComponent(null);
      return;
    }
    setOfficialAiPanelEnabled(true);
  }, []);

  useEffect(() => {
    if (!hasOfficialAiPanel || !officialAiPanelEnabled) return;
    if (activeTab !== 'ai' || OfficialAiPanelComponent) return;
    let canceled = false;
    void loadOfficialAiPanelModule().then((module) => {
      if (canceled) return;
      const nextComponent = module?.default || null;
      setOfficialAiPanelComponent(() => nextComponent);
    });
    return () => {
      canceled = true;
    };
  }, [OfficialAiPanelComponent, activeTab, officialAiPanelEnabled]);

  const isLocalAiSource = useCallback((source?: { presetId?: string; baseURL?: string; protocol?: AiProtocol } | null): boolean => {
    if (!source) return false;
    if (source.protocol && source.protocol !== 'openai') return false;
    const preset = String(source.presetId || '').toLowerCase();
    const base = String(source.baseURL || '').toLowerCase();
    return (
      preset.endsWith('-local') ||
      preset.includes('local') ||
      base.includes('127.0.0.1') ||
      base.includes('localhost') ||
      base.includes('0.0.0.0') ||
      base.includes('::1')
    );
  }, []);

  const isOfficialManagedSource = useCallback((source?: {
    id?: string;
    name?: string;
    presetId?: string;
  } | null): boolean => {
    if (!source) return false;
    const sourceId = String(source.id || '').trim().toLowerCase();
    const sourceName = String(source.name || '').trim().toLowerCase();
    const presetId = String(source.presetId || '').trim().toLowerCase();
    return isOfficialAutoSourceId(sourceId)
      || sourceName === 'gardenflow official'
      || sourceName === `${APP_BRAND.displayName} official`.toLowerCase()
      || sourceName === OFFICIAL_AI_SOURCE_DISPLAY_NAME.toLowerCase()
      || presetId === 'gardenflow-official';
  }, []);

  const hasOfficialManagedSource = useMemo(
    () => aiSources.some((source) => isOfficialManagedSource(source)),
    [aiSources, isOfficialManagedSource]
  );

  const displayedAiSources = useMemo<AiSourceConfig[]>(() => {
    if (!hasOfficialAiPanel) {
      if (!OFFICIAL_SOURCE_IS_PRIVATE_GATEWAY) {
        return aiSources.filter((source) => !isOfficialManagedSource(source));
      }
      return hasOfficialManagedSource ? aiSources : [officialAiSourcePlaceholder, ...aiSources];
    }
    if (!officialAiPanelEnabled || hasOfficialManagedSource) {
      return aiSources;
    }
    return [
      officialAiSourcePlaceholder,
      ...aiSources,
    ];
  }, [aiSources, hasOfficialManagedSource, isOfficialManagedSource, officialAiPanelEnabled, officialAiSourcePlaceholder]);

  const officialAuthStatus = String((officialAuthState as { status?: string } | null)?.status || '').trim();
  const officialAuthKnown = officialAuthBootstrapped;
  const officialAuthPending = !officialAuthBootstrapped
    || officialAuthStatus === 'restoring'
    || officialAuthStatus === 'refreshing';
  const officialAuthLoggedIn = officialAuthKnown
    && officialAuthStatus !== 'anonymous'
    && officialAuthStatus !== 'reauthRequired'
    && officialAuthStatus !== 'restoring'
    && Boolean((officialAuthState as { loggedIn?: boolean } | null)?.loggedIn);
  const officialAuthNeedsLogin = officialAuthKnown && !officialAuthPending && !officialAuthLoggedIn;
  const officialAiSource = useMemo(() => (
    displayedAiSources.find((source) => isOfficialManagedSource(source)) || null
  ), [displayedAiSources, isOfficialManagedSource]);
  const customAiSources = useMemo(() => (
    aiSources.filter((source) => !isOfficialManagedSource(source))
  ), [aiSources, isOfficialManagedSource]);
  const firstCustomAiSource = customAiSources[0] || null;
  // 私有网关形态下官方源不再依赖账号登录：填了网关令牌即视为可用。
  const officialSourceAuthorized = useMemo(() => (
    officialAuthLoggedIn
    || (OFFICIAL_SOURCE_IS_PRIVATE_GATEWAY && Boolean(String(officialAiSource?.apiKey || '').trim()))
  ), [officialAiSource, officialAuthLoggedIn]);

  useEffect(() => {
    if (firstCustomAiSource && missingCustomSourceNoticeScope) {
      setMissingCustomSourceNoticeScope(null);
    }
  }, [firstCustomAiSource, missingCustomSourceNoticeScope]);

  const chatRouteSource = useMemo(() => (
    aiModelRoutes.chat.mode === 'official'
      ? officialAiSource
      : aiModelRoutes.chat.mode === 'custom'
        ? getAiSourceById(aiModelRoutes.chat.sourceId || '') || firstCustomAiSource
        : null
  ), [aiModelRoutes.chat.mode, aiModelRoutes.chat.sourceId, firstCustomAiSource, getAiSourceById, officialAiSource]);
  const chatRouteSourceModels = useMemo(() => {
    if (!chatRouteSource) return [];
    if (isOfficialManagedSource(chatRouteSource) && !officialSourceAuthorized) return [];
    return filterAiModelsByCapability(getSourceModelList(chatRouteSource), 'chat');
  }, [chatRouteSource, filterAiModelsByCapability, getSourceModelList, isOfficialManagedSource, officialSourceAuthorized]);

  const getLocalGuideForSource = useCallback((source?: AiSourceConfig | null): LocalAiGuide | null => {
    if (!source) return null;
    switch (source.presetId) {
      case 'ollama-local':
        return {
          title: 'Ollama 本地服务',
          command: 'ollama serve',
          tip: '建议先执行 `ollama pull <模型名>`，Endpoint 使用 http://127.0.0.1:11434/v1',
        };
      case 'lmstudio-local':
        return {
          title: 'LM Studio 本地服务',
          command: '在 LM Studio 中启动 Developer > Local Server',
          tip: '默认 Endpoint 为 http://127.0.0.1:1234/v1',
        };
      case 'vllm-local':
        return {
          title: 'vLLM 本地服务',
          command: 'vllm serve <model> --port 8000',
          tip: 'Endpoint 使用 http://127.0.0.1:8000/v1；如你配置了 --api-key，请在此填写对应 Key',
        };
      case 'localai-local':
        return {
          title: 'LocalAI 本地服务',
          command: 'docker run -p 8080:8080 localai/localai:latest',
          tip: 'Endpoint 使用 http://127.0.0.1:8080/v1；若设置了 LOCALAI_API_KEY，请同步填写 Key',
        };
      case 'llama-cpp-local':
        return {
          title: 'llama.cpp Server',
          command: 'llama-server -m model.gguf --port 8080',
          tip: 'Endpoint 使用 http://127.0.0.1:8080/v1；如启动时启用了 --api-key，请同步填写 Key',
        };
      default:
        return null;
    }
  }, []);

  const setAssistantDaemonDraft = useCallback((updater: SetStateAction<AssistantDaemonDraft>) => {
    setAssistantDaemonDraftDirty(true);
    setAssistantDaemonDraftState(updater);
  }, []);

  const replaceAssistantDaemonDraft = useCallback((nextDraft: AssistantDaemonDraft) => {
    setAssistantDaemonDraftDirty(false);
    setAssistantDaemonDraftState(nextDraft);
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    if (activeTab !== 'remote') {
      return;
    }

    const flushAssistantDaemonLogs = () => {
      assistantDaemonLogFlushTimerRef.current = null;
      const nextLines = assistantDaemonLogBufferRef.current;
      assistantDaemonLogBufferRef.current = [];
      if (!nextLines.length) return;
      setAssistantDaemonLogs((prev) => [...nextLines.reverse(), ...prev].slice(0, 20));
    };

    const handleDaemonStatus = (_: unknown, status: AssistantDaemonStatus) => {
      setAssistantDaemonStatus(status);
      setAssistantDaemonDraftState((prev) => {
        if (assistantDaemonBusy || assistantDaemonDraftDirty) return prev;
        return assistantDaemonStatusToDraft(status);
      });
    };
    const handleDaemonLog = (_: unknown, payload: { at?: string; level?: string; message?: string; details?: Record<string, unknown> }) => {
      const line = [
        payload?.at || new Date().toISOString(),
        payload?.level || 'info',
        payload?.message || '',
        payload?.details ? JSON.stringify(payload.details) : '',
      ].filter(Boolean).join(' | ');
      assistantDaemonLogBufferRef.current.push(line);
      if (assistantDaemonLogFlushTimerRef.current == null) {
        assistantDaemonLogFlushTimerRef.current = window.setTimeout(flushAssistantDaemonLogs, 300);
      }
    };
    window.ipcRenderer.assistantDaemon.onStatus(handleDaemonStatus);
    window.ipcRenderer.assistantDaemon.onLog(handleDaemonLog);
    return () => {
      window.ipcRenderer.assistantDaemon.offStatus(handleDaemonStatus);
      window.ipcRenderer.assistantDaemon.offLog(handleDaemonLog);
      if (assistantDaemonLogFlushTimerRef.current != null) {
        window.clearTimeout(assistantDaemonLogFlushTimerRef.current);
        assistantDaemonLogFlushTimerRef.current = null;
      }
      assistantDaemonLogBufferRef.current = [];
    };
  }, [activeTab, assistantDaemonBusy, assistantDaemonDraftDirty, isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (activeTab !== 'tools' || !formData.developer_mode_enabled) return;
    const onBackgroundTaskUpdated = (_event: unknown, task: BackgroundTaskItem) => {
      if (!task?.id) return;
      setBackgroundTasks((prev) => {
        const next = [...prev];
        const index = next.findIndex((item) => item.id === task.id);
        if (index >= 0) {
          next[index] = task;
        } else {
          next.unshift(task);
        }
        return next.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 200);
      });
      setSelectedBackgroundTaskId((prev) => prev || task.id);
      setSelectedBackgroundTaskDetail((prev) => (prev?.id === task.id ? { ...prev, ...task } : prev));
    };
    window.ipcRenderer.backgroundTasks.onUpdated(onBackgroundTaskUpdated);
    return () => {
      window.ipcRenderer.backgroundTasks.offUpdated(onBackgroundTaskUpdated);
    };
  }, [activeTab, formData.developer_mode_enabled, isActive]);

  useEffect(() => {
    if (activeTab !== 'tools' || !formData.developer_mode_enabled) return;
    if (!selectedRuntimeTaskId || !runtimeTasks.some((task) => task.id === selectedRuntimeTaskId)) return;
    void loadRuntimeTaskTraces(selectedRuntimeTaskId);
  }, [activeTab, formData.developer_mode_enabled, runtimeTasks, selectedRuntimeTaskId]);

  useEffect(() => {
    if (activeTab !== 'tools' || !formData.developer_mode_enabled) return;
    if (!selectedRuntimeSessionId || !hasSelectedRuntimeSession) return;
    void loadRuntimeSessionDetails(selectedRuntimeSessionId);
  }, [activeTab, formData.developer_mode_enabled, hasSelectedRuntimeSession, selectedRuntimeSessionId]);

  useEffect(() => {
    if (activeTab !== 'tools' || !formData.developer_mode_enabled) return;
    if (!selectedBackgroundTaskId) {
      setSelectedBackgroundTaskDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const detail = await window.ipcRenderer.backgroundTasks.get(selectedBackgroundTaskId);
      if (cancelled) return;
      setSelectedBackgroundTaskDetail(detail && typeof detail === 'object' ? detail as BackgroundTaskItem : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, formData.developer_mode_enabled, selectedBackgroundTaskId]);

  useEffect(() => {
    setTestStatus('idle');
    setTestMsg('');
    setDetectedAiProtocol((activeAiSource?.protocol || 'openai') as AiProtocol);
  }, [activeAiSourceId, activeAiSource?.protocol]);

  useEffect(() => {
    if (!mcpStatusMessage) return;
    const timer = window.setTimeout(() => setMcpStatusMessage(''), 2800);
    return () => window.clearTimeout(timer);
  }, [mcpStatusMessage]);

  useEffect(() => {
    if (!cliRuntimeStatusMessage) return;
    const timer = window.setTimeout(() => setCliRuntimeStatusMessage(''), 3200);
    return () => window.clearTimeout(timer);
  }, [cliRuntimeStatusMessage]);

  useEffect(() => {
    if (activeTab !== 'mcp') return;
    void loadMcpRuntimeData();
    for (const server of mcpServers) {
      void handleRefreshMcpOAuth(server);
    }
  }, [activeTab, mcpServers]);

  const loadMcpRuntimeData = useCallback(async () => {
    try {
      const result = await window.ipcRenderer.mcp.list();
      if (!result?.success) return null;
      const servers = Array.isArray(result.servers) ? (result.servers as McpServerConfig[]) : [];
      setMcpServers((prev) => (
        JSON.stringify(prev) === JSON.stringify(servers) ? prev : servers
      ));
      setMcpLiveSessions(Array.isArray(result.sessions) ? (result.sessions as McpSessionState[]) : []);
      setMcpRuntimeItems(Array.isArray(result.items) ? (result.items as McpServerRuntimeItem[]) : []);
      return servers;
    } catch (error) {
      console.error('Failed to load MCP runtime state:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!activeAiSource) return;
    setDetectedAiProtocol((activeAiSource?.protocol || 'openai') as AiProtocol);
  }, [activeAiSource?.id, activeAiSource?.baseURL, activeAiSource?.presetId, activeTab]);

  useEffect(() => {
    return undefined;
  }, []);

  const buildAiSourcePersistenceSnapshot = useCallback((
    sources: AiSourceConfig[] = aiSources,
    legacyChatSourceId: string = aiModelRoutes.chat.sourceId || defaultAiSourceId,
  ) => {
    const normalizedChatSourceId = canonicalizeOfficialAutoSourceId(legacyChatSourceId)
      || OFFICIAL_AUTO_SOURCE_ID;
    let sanitizedSources: AiSourceConfig[] = sources
      .map((source) => ({
        ...source,
        id: canonicalizeOfficialAutoSourceId(source.id),
        name: source.name.trim(),
        presetId: source.presetId.trim() || 'custom',
        baseURL: source.baseURL.trim(),
        apiKey: source.apiKey.trim(),
        models: normalizeSourceModels([...(source.models || []), source.model]),
        modelsMeta: normalizeAiModelDescriptors([
          ...(source.modelsMeta || []),
          ...(source.models || []).map((id) => ({ id })),
          source.model ? { id: source.model } : null,
        ]),
        model: String(source.model || '').trim(),
        protocol: source.protocol || findAiPresetById(source.presetId)?.protocol || 'openai',
      }))
      .map((source) => ({
        ...source,
        model: source.model || source.models?.[0] || '',
        models: normalizeSourceModels([...(source.models || []), source.model]),
        modelsMeta: normalizeAiModelDescriptors([
          ...(source.modelsMeta || []),
          ...(source.models || []).map((id) => ({ id })),
          source.model ? { id: source.model } : null,
        ]),
      }))
      .filter((source) => !isDeprecatedEmptyOpenAiSource(source));

    if (
      isOfficialAutoSourceId(normalizedChatSourceId)
      && !sanitizedSources.some((source) => isOfficialManagedSource(source))
    ) {
      sanitizedSources = [officialAiSourcePlaceholder, ...sanitizedSources];
    }

    const legacyChatSource = sanitizedSources.find((source) => source.id === normalizedChatSourceId)
      || (isOfficialAutoSourceId(normalizedChatSourceId) ? officialAiSourcePlaceholder : sanitizedSources[0]);
    return {
      sanitizedSources,
      resolvedLegacyChatSourceId: normalizedChatSourceId,
      legacyChatSource,
      resolvedApiEndpoint: String(legacyChatSource?.baseURL || '').trim(),
      resolvedApiKey: String(legacyChatSource?.apiKey || '').trim(),
      resolvedModelName: String(aiModelRoutes.chat.model || legacyChatSource?.model || '').trim(),
    };
  }, [aiModelRoutes.chat.model, aiModelRoutes.chat.sourceId, aiSources, defaultAiSourceId, isDeprecatedEmptyOpenAiSource, isOfficialManagedSource, officialAiSourcePlaceholder]);

  const persistAiSourcesSnapshot = useCallback(async (
    sources: AiSourceConfig[] = aiSources,
    legacyChatSourceId: string = aiModelRoutes.chat.sourceId || defaultAiSourceId,
  ) => {
    const saveGeneration = aiSourceEditGenerationRef.current;
    const snapshot = buildAiSourcePersistenceSnapshot(sources, legacyChatSourceId);
    await window.ipcRenderer.saveSettings({
      ai_sources_json: JSON.stringify(snapshot.sanitizedSources),
      default_ai_source_id: snapshot.resolvedLegacyChatSourceId || snapshot.legacyChatSource?.id || '',
      api_endpoint: snapshot.resolvedApiEndpoint,
      api_key: snapshot.resolvedApiKey,
      model_name: snapshot.resolvedModelName,
    });
    clearAiSourceDraftDirty(saveGeneration);
  }, [aiModelRoutes.chat.sourceId, aiSources, buildAiSourcePersistenceSnapshot, clearAiSourceDraftDirty, defaultAiSourceId]);

  const updateAiSource = useCallback((sourceId: string, updater: (source: AiSourceConfig) => AiSourceConfig) => {
    markAiSourceDraftDirty();
    setAiSources((prev) => {
      if (prev.some((source) => source.id === sourceId)) {
        return prev.map((source) => (source.id === sourceId ? updater(source) : source));
      }
      // 官方源在设置页可能只是占位条目（尚未落库），编辑时需要补进列表才能持久化。
      if (isOfficialAutoSourceId(sourceId)) {
        return [updater(createOfficialAiSource()), ...prev];
      }
      return prev;
    });
  }, [markAiSourceDraftDirty]);

  useEffect(() => {
    if (!baseSettingsLoadedRef.current) return;
    if (!aiSourceDraftDirtyRef.current) return;
    if (aiSourceAutosaveTimerRef.current != null) {
      window.clearTimeout(aiSourceAutosaveTimerRef.current);
    }
    aiSourceAutosaveTimerRef.current = window.setTimeout(() => {
      aiSourceAutosaveTimerRef.current = null;
      void persistAiSourcesSnapshot().catch((error) => {
        console.error('Failed to persist AI source snapshot:', error);
        setStatus('error');
        setTestStatus('error');
        setTestMsg(error instanceof Error ? error.message : '供应商配置自动保存失败');
      });
    }, 350);

    return () => {
      if (aiSourceAutosaveTimerRef.current != null) {
        window.clearTimeout(aiSourceAutosaveTimerRef.current);
        aiSourceAutosaveTimerRef.current = null;
      }
    };
  }, [aiSources, baseSettingsLoadedRevision, defaultAiSourceId, persistAiSourcesSnapshot]);

  const fetchAiSourceModels = useCallback(async (
    source: AiSourceConfig,
    options: { skipInvalid?: boolean } = {},
  ): Promise<AiModelDescriptor[]> => {
    const sourceId = canonicalizeOfficialAutoSourceId(source.id);
    const baseURL = String(source.baseURL || '').trim();
    const apiKey = String(source.apiKey || '').trim();
    const allowEmptyKey = isLocalAiSource(source);
    if (!baseURL || (!apiKey && !allowEmptyKey)) {
      if (!options.skipInvalid) {
        const message = !baseURL ? '请先填写 API Endpoint' : '请先填写 API Key';
        setSourceModelDiscoveryMessages((prev) => ({ ...prev, [sourceId]: message }));
        setTestStatus('error');
        setTestMsg(message);
      }
      return [];
    }

    setActiveAiSourceId(sourceId);
    setSourceModelDiscoveryBusy((prev) => ({ ...prev, [sourceId]: true }));
    setSourceModelDiscoveryMessages((prev) => ({ ...prev, [sourceId]: '正在获取模型列表…' }));
    setTestStatus('idle');
    setTestMsg('正在获取模型列表…');
    try {
      const result = await window.ipcRenderer.fetchModels({
        apiKey,
        baseURL,
        presetId: source.presetId,
        protocol: source.protocol || findAiPresetById(source.presetId)?.protocol || 'openai',
      });
      const models = normalizeAiModelDescriptors(Array.isArray(result) ? result : []);
      setDiscoveredModelsBySource((prev) => ({ ...prev, [sourceId]: models }));
      const message = models.length > 0
        ? `已获取 ${models.length} 个可用模型，请从列表选择`
        : '供应商连接成功，但没有返回可选择的模型；仍可手动添加模型 ID';
      setSourceModelDiscoveryMessages((prev) => ({ ...prev, [sourceId]: message }));
      setTestStatus('success');
      setTestMsg(message);
      setAiSourceModelExpandState((prev) => ({ ...prev, [sourceId]: true }));
      return models;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = `获取模型列表失败：${rawMessage}`.slice(0, 600);
      setSourceModelDiscoveryMessages((prev) => ({ ...prev, [sourceId]: message }));
      setTestStatus('error');
      setTestMsg(message);
      return [];
    } finally {
      setSourceModelDiscoveryBusy((prev) => ({ ...prev, [sourceId]: false }));
    }
  }, [isLocalAiSource]);

  const openCreateAiSourceModal = () => {
    setCreateAiSourceDraft(createAiSourceDraftFromPreset(DEFAULT_AI_PRESET_ID));
    setIsCreateAiSourceModalOpen(true);
  };

  const closeCreateAiSourceModal = () => {
    setIsCreateAiSourceModalOpen(false);
  };

  const handleCreateAiSource = () => {
    const preset = findAiPresetById(createAiSourceDraft.presetId) || findAiPresetById(DEFAULT_AI_PRESET_ID);
    const nextSource: AiSourceConfig = {
      id: generateAiSourceId(),
      name: String(createAiSourceDraft.name || '').trim() || preset?.label || '未命名供应商',
      presetId: createAiSourceDraft.presetId || preset?.id || 'custom',
      baseURL: String(createAiSourceDraft.baseURL || '').trim(),
      apiKey: String(createAiSourceDraft.apiKey || '').trim(),
      models: [],
      modelsMeta: [],
      model: '',
      protocol: createAiSourceDraft.protocol || preset?.protocol || 'openai',
    };

    markAiSourceDraftDirty();
    setAiSources((prev) => [...prev, nextSource]);
    setActiveAiSourceId(nextSource.id);
    setAiSourceExpandState((prev) => ({ ...prev, [nextSource.id]: true }));
    setAiSourceModelExpandState((prev) => ({ ...prev, [nextSource.id]: true }));
    setIsCreateAiSourceModalOpen(false);
    void fetchAiSourceModels(nextSource, { skipInvalid: true });
  };

  const handleDeleteAiSource = (sourceId: string) => {
    markAiSourceDraftDirty();
    setAiSources((prev) => {
      const next = prev.filter((source) => source.id !== sourceId);
      if (!next.length) {
        const fallback = createAiSourceFromPreset(DEFAULT_AI_PRESET_ID);
        setActiveAiSourceId(fallback.id);
        setDefaultAiSourceId(fallback.id);
        return [fallback];
      }
      setDefaultAiSourceId((prevDefaultId) => (prevDefaultId === sourceId ? next[0].id : prevDefaultId));
      setActiveAiSourceId((prevActiveId) => (prevActiveId === sourceId ? next[0].id : prevActiveId));
      return next;
    });
    setAiSourceExpandState((prev) => {
      const next = { ...prev };
      delete next[sourceId];
      return next;
    });
    setAiSourceModelExpandState((prev) => {
      const next = { ...prev };
      delete next[sourceId];
      return next;
    });
    setSourceModelDrafts((prev) => {
      const next = { ...prev };
      delete next[sourceId];
      return next;
    });
    setDiscoveredModelsBySource((prev) => {
      const next = { ...prev };
      delete next[sourceId];
      return next;
    });
    setSourceModelDiscoveryBusy((prev) => {
      const next = { ...prev };
      delete next[sourceId];
      return next;
    });
    setSourceModelDiscoveryMessages((prev) => {
      const next = { ...prev };
      delete next[sourceId];
      return next;
    });
    setAddModelModalSourceId((prev) => (prev === sourceId ? '' : prev));
  };

  const handleToggleAiSourceExpand = (sourceId: string) => {
    const normalizedSourceId = canonicalizeOfficialAutoSourceId(sourceId);
    const isOpening = !(aiSourceExpandState[normalizedSourceId] ?? false);
    setAiSourceExpandState((prev) => {
      const currentExpanded = prev[normalizedSourceId] ?? false;
      if (currentExpanded) {
        return { ...prev, [normalizedSourceId]: false };
      }
      return displayedAiSources.reduce<Record<string, boolean>>((acc, source) => {
        acc[source.id] = source.id === normalizedSourceId;
        return acc;
      }, {});
    });
    setActiveAiSourceId(normalizedSourceId);
    if (isOpening && discoveredModelsBySource[normalizedSourceId] === undefined) {
      const source = displayedAiSources.find((item) => item.id === normalizedSourceId);
      if (source && !isOfficialManagedSource(source)) {
        void fetchAiSourceModels(source, { skipInvalid: true });
      }
    }
  };

  const handleToggleAiSourceModelExpand = (sourceId: string) => {
    setAiSourceModelExpandState((prev) => ({
      ...prev,
      [sourceId]: !(prev[sourceId] ?? false),
    }));
  };

  const ensureDisplayedAiSourcePersisted = (sourceId: string) => {
    const normalizedSourceId = canonicalizeOfficialAutoSourceId(sourceId);
    if (!normalizedSourceId) return;
    const displayedSource = displayedAiSources.find((source) => source.id === normalizedSourceId);
    if (!displayedSource) return;
    setAiSources((prev) => {
      if (prev.some((source) => source.id === normalizedSourceId)) return prev;
      return [displayedSource, ...prev];
    });
  };

  const handleSetSourceDefaultModel = (sourceId: string, modelId: string) => {
    const normalizedModel = String(modelId || '').trim();
    if (!normalizedModel) return;
    const applyModel = (source: AiSourceConfig): AiSourceConfig => ({
      ...source,
      model: normalizedModel,
      models: normalizeSourceModels([...(source.models || []), normalizedModel]),
      modelsMeta: normalizeAiModelDescriptors([
        ...(source.modelsMeta || []),
        ...((source.models || []).map((id) => ({ id }))),
        { id: normalizedModel, capabilities: (getSourceModelList(source).find((item) => item.id === normalizedModel)?.capabilities || ['chat']) },
      ]),
    });
    markAiSourceDraftDirty();
    setAiSources((prev) => {
      let found = false;
      const next = prev.map((source) => {
        if (source.id !== sourceId) return source;
        found = true;
        return applyModel(source);
      });
      if (found) return next;
      const displayedSource = displayedAiSources.find((source) => source.id === sourceId);
      return displayedSource ? [applyModel(displayedSource), ...next] : next;
    });
  };

  const getRouteSource = useCallback((route: AiModelRouteConfig): AiSourceConfig | null => {
    if (route.mode === 'official') return officialAiSource;
    if (route.mode === 'custom') {
      return getAiSourceById(route.sourceId || '') || firstCustomAiSource;
    }
    return null;
  }, [firstCustomAiSource, getAiSourceById, officialAiSource]);

  const updateAiModelRoute = useCallback((scope: AiModelRouteScope, patch: Partial<AiModelRouteConfig>) => {
    setAiModelRoutes((prev) => {
      const next = {
        ...prev,
        [scope]: {
          ...prev[scope],
          ...patch,
        },
      } as AiModelRoutes;
      setFormData((data) => ({ ...data, ai_model_routes_json: JSON.stringify(next) }));
      return next;
    });
  }, []);

  const applyRouteSource = useCallback((scope: AiModelRouteScope, mode: AiModelRouteMode) => {
    const nextMode = (
      (scope === 'visualIndex' || scope === 'videoAnalysis') && mode === 'disabled'
        ? 'official'
        : mode
    );
    if (nextMode === 'custom' && !firstCustomAiSource) {
      setMissingCustomSourceNoticeScope(scope);
      return;
    }
    setMissingCustomSourceNoticeScope(null);
    const source = nextMode === 'official' ? officialAiSource : nextMode === 'custom' ? firstCustomAiSource : null;
    const nextSourceId = source?.id || (nextMode === 'official' ? OFFICIAL_AUTO_SOURCE_ID : '');
    const nextModel = scope === 'chat' && source ? pickBestModelForSource(source, '', 'chat') : '';
    updateAiModelRoute(scope, { mode: nextMode, sourceId: nextSourceId, model: nextModel });
    if (!source) {
      if (scope === 'videoAnalysis') {
        setFormData((prev) => ({ ...prev, video_analysis_enabled: true }));
      }
      return;
    }

    if (scope === 'chat') {
      ensureDisplayedAiSourcePersisted(source.id);
      setActiveAiSourceId(source.id);
      setFormData((prev) => ({ ...prev, model_name: nextModel }));
      return;
    }
    if (scope === 'transcription') handleLinkedSourceChange('transcription', source.id);
    if (scope === 'embedding') handleLinkedSourceChange('embedding', source.id);
    if (scope === 'image') handleLinkedSourceChange('image', source.id);
    if (scope === 'voiceTts') handleLinkedSourceChange('voice', source.id);
    if (scope === 'visualIndex') {
      handleLinkedSourceChange('visual', source.id);
    }
    if (scope === 'videoAnalysis') {
      setFormData((prev) => ({ ...prev, video_analysis_enabled: true }));
      handleLinkedSourceChange('videoAnalysis', source.id);
    }
  }, [firstCustomAiSource, handleLinkedSourceChange, officialAiSource, pickBestModelForSource, updateAiModelRoute]);

  const applyRouteModel = useCallback((scope: AiModelRouteScope, modelId: string) => {
    const normalizedModel = String(modelId || '').trim();
    updateAiModelRoute(scope, { model: normalizedModel });
    if (scope === 'chat') {
      setFormData((prev) => ({ ...prev, model_name: normalizedModel }));
    } else if (scope === 'wander') {
      setFormData((prev) => ({ ...prev, model_name_wander: normalizedModel }));
    } else if (scope === 'team') {
      setFormData((prev) => ({ ...prev, model_name_chatroom: normalizedModel }));
    } else if (scope === 'knowledge') {
      setFormData((prev) => ({ ...prev, model_name_knowledge: normalizedModel }));
    } else if (scope === 'gardenflow') {
      setFormData((prev) => ({ ...prev, model_name_gardenflow: normalizedModel }));
    } else if (scope === 'transcription') {
      setFormData((prev) => ({ ...prev, transcription_model: normalizedModel }));
    } else if (scope === 'embedding') {
      setFormData((prev) => ({ ...prev, embedding_model: normalizedModel }));
    } else if (scope === 'image') {
      setFormData((prev) => ({ ...prev, image_model: normalizedModel }));
    } else if (scope === 'visualIndex') {
      setFormData((prev) => ({ ...prev, visual_index_model: normalizedModel }));
    } else if (scope === 'videoAnalysis') {
      setFormData((prev) => ({ ...prev, video_analysis_model: normalizedModel }));
    } else if (scope === 'voiceTts') {
      const nextCloneModel = cloneModelForVoiceTtsModel(normalizedModel, formData.voice_clone_model || DEFAULT_VOICE_CLONE_MODEL);
      updateAiModelRoute('voiceClone', { model: nextCloneModel });
      setFormData((prev) => ({ ...prev, voice_tts_model: normalizedModel, tts_model: normalizedModel, voice_clone_model: nextCloneModel }));
    } else if (scope === 'voiceClone') {
      setFormData((prev) => ({ ...prev, voice_clone_model: normalizedModel }));
    }
  }, [formData.voice_clone_model, updateAiModelRoute]);

  const updateVideoProviders = (
    updater: (providers: VideoGenerationProviderConfig[]) => VideoGenerationProviderConfig[],
    nextActiveProviderId?: string,
  ) => {
    setFormData((prev) => {
      const providers = normalizeVideoProviderConfigs(prev.video_providers_json, {
        endpoint: prev.video_endpoint,
        apiKey: prev.video_api_key,
        model: prev.video_model,
        modelsJson: prev.video_models_json,
      });
      const nextProviders = updater(providers);
      if (!nextProviders.length) return prev;
      const requestedActiveId = nextActiveProviderId === undefined
        ? String(prev.active_video_provider_id || '').trim()
        : nextActiveProviderId;
      const nextActiveId = nextProviders.some((provider) => provider.id === requestedActiveId)
        ? requestedActiveId
        : nextProviders[0].id;
      const activeProvider = nextProviders.find((provider) => provider.id === nextActiveId) || nextProviders[0];
      return {
        ...prev,
        video_providers_json: JSON.stringify(nextProviders),
        active_video_provider_id: nextActiveId,
        video_endpoint: activeProvider.endpoint,
        video_api_key: activeProvider.apiKey,
        video_model: activeProvider.model,
        video_models_json: JSON.stringify(activeProvider.models),
      };
    });
  };

  const handleVideoProviderCreatePresetChange = (preset: VideoGenerationProviderPreset) => {
    setVideoProviderCreatePreset(preset);
    setVideoProviderCreateName(defaultVideoProviderName(preset));
  };

  const openVideoProviderCreate = () => {
    handleVideoProviderCreatePresetChange('custom');
    setIsVideoProviderCreateOpen(true);
  };

  const handleAddVideoProvider = () => {
    const preset = videoProviderCreatePreset;
    if (preset !== 'custom') {
      const existingProvider = videoProviders.find((provider) => provider.preset === preset);
      if (existingProvider) {
        setSelectedVideoProviderId(existingProvider.id);
        setIsVideoProviderCreateOpen(false);
        setTestStatus('success');
        setTestMsg(`${existingProvider.name} 已存在，已为你切换到该配置`);
        return;
      }
    }
    const provider = createVideoProviderPreset(preset);
    provider.name = videoProviderCreateName.trim() || defaultVideoProviderName(preset);
    updateVideoProviders((providers) => [...providers, provider]);
    setSelectedVideoProviderId(provider.id);
    setVideoModelDraft('');
    setIsVideoProviderCreateOpen(false);
  };

  const handleRemoveVideoProvider = (providerId: string) => {
    if (videoProviders.length <= 1) return;
    const nextProviders = videoProviders.filter((provider) => provider.id !== providerId);
    const nextActiveId = providerId === activeVideoProviderId
      ? nextProviders[0]?.id || ''
      : activeVideoProviderId;
    updateVideoProviders(() => nextProviders, nextActiveId);
    if (selectedVideoProvider?.id === providerId) {
      setSelectedVideoProviderId(nextActiveId || nextProviders[0]?.id || '');
    }
    setVideoModelDraft('');
  };

  const handleActivateVideoProvider = (providerId: string) => {
    updateVideoProviders((providers) => providers, providerId);
  };

  const updateSelectedVideoProvider = (updates: Partial<VideoGenerationProviderConfig>) => {
    if (!selectedVideoProvider) return;
    updateVideoProviders((providers) => providers.map((provider) => (
      provider.id === selectedVideoProvider.id
        ? { ...provider, ...updates }
        : provider
    )));
  };

  const selectConfiguredVideoModel = (modelId: string) => {
    const model = String(modelId || '').trim();
    if (!model || !selectedVideoProvider) return;
    const models = normalizeVideoModelList(selectedVideoProvider.models, model);
    updateSelectedVideoProvider({ model, models });
  };

  const handleAddVideoModel = () => {
    const model = videoModelDraft.trim();
    if (!model) return;
    selectConfiguredVideoModel(model);
    setVideoModelDraft('');
  };

  const handleRemoveVideoModel = (modelId: string) => {
    const normalizedModel = String(modelId || '').trim();
    if (!normalizedModel || !selectedVideoProvider || selectedVideoProvider.models.length <= 1) return;
    const nextModels = selectedVideoProvider.models.filter((model) => model !== normalizedModel);
    updateSelectedVideoProvider({
      model: selectedVideoProvider.model === normalizedModel ? (nextModels[0] || '') : selectedVideoProvider.model,
      models: nextModels,
    });
  };

  const handleRemoveSourceModel = (sourceId: string, modelId: string) => {
    const normalizedModel = String(modelId || '').trim();
    if (!normalizedModel) return;
    updateAiSource(sourceId, (source) => {
      const nextModels = normalizeSourceModels((source.models || []).filter((item) => item !== normalizedModel));
      const nextModelsMeta = normalizeAiModelDescriptors((source.modelsMeta || []).filter((item) => String(item?.id || '').trim() !== normalizedModel));
      const fallbackModel = source.model === normalizedModel ? (nextModels[0] || '') : source.model;
      return {
        ...source,
        models: nextModels,
        modelsMeta: nextModelsMeta,
        model: fallbackModel,
      };
    });
  };

  const handleAddSourceModel = (sourceId: string) => {
    const draft = String(sourceModelDrafts[sourceId] || '').trim();
    if (!draft) return;
    const selectedCapability = sourceModelCapabilityDrafts[sourceId] || 'chat';
    updateAiSource(sourceId, (source) => {
      const nextModels = normalizeSourceModels([...(source.models || []), draft]);
      return {
        ...source,
        models: nextModels,
        modelsMeta: normalizeAiModelDescriptors([
          ...(source.modelsMeta || []),
          ...nextModels.map((id) => ({ id })),
          { id: draft, capabilities: [selectedCapability] },
        ]),
        model: source.model || draft,
      };
    });
    setSourceModelDrafts((prev) => ({ ...prev, [sourceId]: '' }));
    setSourceModelCapabilityDrafts((prev) => ({ ...prev, [sourceId]: 'chat' }));
    setAiSourceModelExpandState((prev) => ({ ...prev, [sourceId]: true }));
    setAddModelModalSourceId('');
  };

  const handleAddDiscoveredSourceModel = (sourceId: string, model: AiModelDescriptor) => {
    const modelId = String(model.id || '').trim();
    if (!modelId) return;
    updateAiSource(sourceId, (source) => ({
      ...source,
      models: normalizeSourceModels([...(source.models || []), modelId]),
      modelsMeta: normalizeAiModelDescriptors([
        ...(source.modelsMeta || []),
        model,
      ]),
      model: source.model || modelId,
    }));
  };

  const closeAddModelModal = useCallback(() => {
    setAddModelModalSourceId('');
  }, []);

  const openAddModelModal = (source: AiSourceConfig) => {
    setAddModelModalSourceId(source.id);
    setActiveAiSourceId(source.id);
    setSourceModelCapabilityDrafts((prev) => ({
      ...prev,
      [source.id]: prev[source.id] || 'chat',
    }));
    if (discoveredModelsBySource[source.id] === undefined) {
      void fetchAiSourceModels(source, { skipInvalid: true });
    }
  };

  const handleAddModelCapabilityChange = (sourceId: string, capability: ModelCapability) => {
    const currentDraft = String(sourceModelDrafts[sourceId] || '').trim();
    const currentDescriptor = addModelModalRemoteModels.find((model) => model.id === currentDraft);
    setSourceModelCapabilityDrafts((prev) => ({ ...prev, [sourceId]: capability }));
    if (currentDescriptor && !currentDescriptor.capabilities.includes(capability)) {
      setSourceModelDrafts((prev) => ({ ...prev, [sourceId]: '' }));
    }
  };

  useEffect(() => {
    if (!activeAiSource) return;
    const baseURL = activeAiSource.baseURL.trim();
    const apiKey = activeAiSource.apiKey.trim();
    const allowEmptyKey = isLocalAiSource(activeAiSource);
    if (!baseURL || (!apiKey && !allowEmptyKey)) {
      setTestStatus('idle');
      setTestMsg('');
    }
  }, [
    activeTab,
    activeAiSource?.id,
    activeAiSource?.baseURL,
    activeAiSource?.apiKey,
    activeAiSource?.presetId,
    activeAiSource?.protocol,
    isLocalAiSource,
  ]);

  const persistMcpServers = useCallback(async (nextServers: McpServerConfig[], tip?: string) => {
    setIsSyncingMcp(true);
    try {
      const result = await window.ipcRenderer.mcp.save(nextServers);
      if (!result?.success) {
        setMcpStatusMessage(result?.error || 'MCP 配置保存失败');
        return false;
      }
      setMcpServers((result.servers || nextServers) as McpServerConfig[]);
      await loadMcpRuntimeData();
      if (tip) setMcpStatusMessage(tip);
      return true;
    } catch (error) {
      console.error('Failed to persist MCP servers:', error);
      setMcpStatusMessage('MCP 配置保存失败');
      return false;
    } finally {
      setIsSyncingMcp(false);
    }
  }, [loadMcpRuntimeData]);

  const handleAddMcpServer = () => {
    setMcpDraft(mcpDraftFromServer());
    setMcpDraftOriginalId('');
  };

  const handleDeleteMcpServer = async (serverId: string) => {
    const server = mcpServers.find((item) => item.id === serverId);
    if (server && !(await appConfirm(`确定删除 MCP Server "${server.name || server.id}" 吗？`, {
      title: '删除 MCP Server',
      confirmLabel: '删除',
      tone: 'danger',
    }))) {
      return;
    }
    const next = mcpServers.filter((item) => item.id !== serverId);
    await persistMcpServers(next, '已删除 MCP Server');
  };

  const handleUpdateMcpServer = (serverId: string, updater: (server: McpServerConfig) => McpServerConfig) => {
    setMcpServers((prev) => prev.map((server) => (server.id === serverId ? updater(server) : server)));
  };

  const handleToggleMcpServer = useCallback(async (server: McpServerConfig) => {
    const nextEnabled = !(server.enabled !== false);
    const next = mcpServers.map((item) => (
      item.id === server.id ? { ...item, enabled: nextEnabled } : item
    ));
    setMcpServers(next);
    const saved = await persistMcpServers(next, `${server.name || server.id} 已${nextEnabled ? '打开' : '关闭'}`);
    if (!saved) {
      setMcpServers(mcpServers);
    }
  }, [mcpServers, persistMcpServers]);

  const handleEditMcpServer = useCallback((server: McpServerConfig) => {
    setMcpDraft(mcpDraftFromServer(server));
    setMcpDraftOriginalId(server.id);
  }, []);

  const handleSaveMcpDraft = useCallback(async () => {
    if (!mcpDraft) return;
    const server = mcpServerFromDraft(mcpDraft);
    const next = mcpDraftOriginalId
      ? mcpServers.map((item) => (item.id === mcpDraftOriginalId ? server : item))
      : [...mcpServers, server];
    const saved = await persistMcpServers(next, mcpDraftOriginalId ? 'MCP Server 已保存' : '已新增 MCP Server');
    if (saved) {
      setMcpDraft(null);
      setMcpDraftOriginalId('');
    }
  }, [mcpDraft, mcpDraftOriginalId, mcpServers, persistMcpServers]);

  const handleCancelMcpDraft = useCallback(() => {
    setMcpDraft(null);
    setMcpDraftOriginalId('');
  }, []);

  const handleSaveMcpServers = async () => {
    await persistMcpServers(mcpServers, 'MCP 配置已保存');
  };

  const handleDiscoverAndImportMcp = useCallback(async () => {
    setIsSyncingMcp(true);
    try {
      const result = await window.ipcRenderer.mcp.importLocal();
      if (!result?.success) {
        setMcpStatusMessage(result?.error || '导入本机 MCP 配置失败');
        return;
      }
      setMcpServers((result.servers || []) as McpServerConfig[]);
      await loadMcpRuntimeData();
      setMcpStatusMessage(`已导入 ${result.imported || 0} 个 MCP Server（共 ${result.total || 0} 个）`);
    } catch (error) {
      console.error('Failed to import local MCP configs:', error);
      setMcpStatusMessage('导入本机 MCP 配置失败');
    } finally {
      setIsSyncingMcp(false);
    }
  }, [loadMcpRuntimeData]);

  const handleTestMcpServer = useCallback(async (server: McpServerConfig) => {
    setMcpTestingId(server.id);
    try {
      const result = await window.ipcRenderer.mcp.test(server);
      setMcpStatusMessage(`${server.name}：${result.message}`);
      await loadMcpRuntimeData();
    } catch (error) {
      console.error('Failed to test MCP server:', error);
      setMcpStatusMessage(`${server.name}：测试失败`);
    } finally {
      setMcpTestingId('');
    }
  }, [loadMcpRuntimeData]);

  const handleDisconnectMcpServer = useCallback(async (server: McpServerConfig) => {
    setMcpInspectingId(server.id);
    try {
      const result = await window.ipcRenderer.mcp.disconnect(server);
      if (result?.success) {
        setMcpLiveSessions(Array.isArray(result.sessions) ? (result.sessions as McpSessionState[]) : []);
        await loadMcpRuntimeData();
        setMcpStatusMessage(`${server.name}：连接已断开`);
      }
    } catch (error) {
      console.error('Failed to disconnect MCP server:', error);
      setMcpStatusMessage(`${server.name}：断开连接失败`);
    } finally {
      setMcpInspectingId('');
    }
  }, [loadMcpRuntimeData]);

  const handleDisconnectAllMcpSessions = useCallback(async () => {
    setMcpInspectingId('__all__');
    try {
      const result = await window.ipcRenderer.mcp.disconnectAll();
      if (result?.success) {
        setMcpLiveSessions(Array.isArray(result.sessions) ? (result.sessions as McpSessionState[]) : []);
        await loadMcpRuntimeData();
        setMcpStatusMessage('已断开全部 MCP 会话');
      }
    } catch (error) {
      console.error('Failed to disconnect all MCP sessions:', error);
      setMcpStatusMessage('断开全部 MCP 会话失败');
    } finally {
      setMcpInspectingId('');
    }
  }, [loadMcpRuntimeData]);

  const handleRefreshMcpOAuth = async (server: McpServerConfig) => {
    try {
      const result = await window.ipcRenderer.mcp.oauthStatus(server.id);
      if (!result?.success) return;
      setMcpOauthState((prev) => ({
        ...prev,
        [server.id]: {
          connected: Boolean(result.connected),
          tokenPath: result.tokenPath,
        },
      }));
    } catch (error) {
      console.error('Failed to query MCP oauth status:', error);
    }
  };

  const loadAppVersion = useCallback(async () => {
    try {
      const version = await window.ipcRenderer.getAppVersion();
      const normalizedVersion = typeof version === 'string'
        ? version.trim()
        : String(version || '').trim();
      setAppVersion(normalizedVersion || '未读取到版本号');
    } catch (e) {
      console.error('Failed to load app version:', e);
      setAppVersion('读取失败');
    }
  }, []);

  const loadRecentDebugLogs = useCallback(async () => {
    const requestId = ++debugLogsLoadRequestRef.current;
    setIsDebugLogsLoading(true);
    try {
      const result = await window.ipcRenderer.logs.getRecent(120);
      if (requestId !== debugLogsLoadRequestRef.current) return;
      setRecentDebugLogs(Array.isArray(result?.lines) ? result.lines : []);
    } catch (e) {
      console.error('Failed to load debug logs', e);
    } finally {
      if (requestId === debugLogsLoadRequestRef.current) {
        setIsDebugLogsLoading(false);
      }
    }
  }, []);

  const isEmptyFileIndexDashboardFallback = useCallback((dashboard: FileIndexDashboard | null | undefined): boolean => {
    if (!dashboard) return true;
    const overall = dashboard.overall;
    return (dashboard.lanes || []).length === 0
      && (dashboard.scopes || []).length === 0
      && (!overall
        || (
          Number(overall.indexedFiles || 0) === 0
          && Number(overall.totalFiles || 0) === 0
          && Number(overall.failedFiles || 0) === 0
        ));
  }, []);

  const loadFileIndexDashboard = useCallback(async (options: { force?: boolean; background?: boolean } = {}) => {
    const cachedDashboard = fileIndexDashboardCurrentRef.current;
    const cacheAge = Date.now() - fileIndexDashboardLoadedAtRef.current;
    if (
      !options.force
      && cachedDashboard
      && cacheAge >= 0
      && cacheAge < FILE_INDEX_DASHBOARD_CACHE_TTL_MS
    ) {
      return cachedDashboard;
    }
    if (fileIndexDashboardInFlightRef.current) {
      return fileIndexDashboardInFlightRef.current;
    }

    const requestId = ++fileIndexDashboardLoadRequestRef.current;
    const shouldShowLoading = !options.background || !cachedDashboard;
    if (shouldShowLoading) {
      setIsFileIndexDashboardLoading(true);
    }

    let request: Promise<FileIndexDashboard | null>;
    request = (async () => {
      try {
        const dashboard = await window.ipcRenderer.knowledge.getFileIndexDashboard<FileIndexDashboard>();
        if (requestId !== fileIndexDashboardLoadRequestRef.current) {
          return fileIndexDashboardCurrentRef.current;
        }

        let nextDashboard = dashboard || fileIndexDashboardCurrentRef.current || null;
        if (
          isEmptyFileIndexDashboardFallback(dashboard)
          && fileIndexDashboardCurrentRef.current
          && !isEmptyFileIndexDashboardFallback(fileIndexDashboardCurrentRef.current)
        ) {
          nextDashboard = fileIndexDashboardCurrentRef.current;
        }

        if (nextDashboard) {
          fileIndexDashboardCurrentRef.current = nextDashboard;
          fileIndexDashboardLoadedAtRef.current = writeCachedFileIndexDashboard(nextDashboard);
          setFileIndexDashboard(nextDashboard);
        }
        return nextDashboard;
      } catch (error) {
        if (requestId === fileIndexDashboardLoadRequestRef.current) {
          console.error('Failed to load file index dashboard:', error);
        }
        return fileIndexDashboardCurrentRef.current;
      } finally {
        if (fileIndexDashboardInFlightRef.current === request) {
          fileIndexDashboardInFlightRef.current = null;
          if (shouldShowLoading) {
            setIsFileIndexDashboardLoading(false);
          }
        }
      }
    })();

    fileIndexDashboardInFlightRef.current = request;
    return request;
  }, [isEmptyFileIndexDashboardFallback]);

  const loadLoggingStatus = useCallback(async () => {
    try {
      const result = await window.ipcRenderer.logs.getStatus();
      setLogStatus(result || null);
    } catch (error) {
      console.error('Failed to load logging status', error);
    }
  }, []);

  const loadPendingDiagnosticReports = useCallback(async () => {
    try {
      const result = await window.ipcRenderer.logs.listPendingReports();
      setPendingDiagnosticReports(Array.isArray(result) ? result : []);
    } catch (error) {
      console.error('Failed to load pending diagnostic reports', error);
    }
  }, []);

  const openDebugLogDirectory = async () => {
    const result = await window.ipcRenderer.logs.openDir();
    if (!result?.success && result?.error) {
      void appAlert(`打开日志目录失败：${result.error}`);
    }
  };

  const handleExportDiagnosticBundle = useCallback(async (reportId?: string) => {
    setDiagnosticsActionBusy(reportId || 'manual-export');
    try {
      const result = await window.ipcRenderer.logs.exportBundle(reportId, {
        includeAdvancedContext: Boolean(formData.debug_log_enabled || formData.diagnostics_include_advanced_context),
      });
      if (!result?.success) {
        throw new Error(result?.error || '导出诊断包失败');
      }
      await appAlert(`诊断包已导出到：\n${result.path}`);
      await Promise.all([loadLoggingStatus(), loadPendingDiagnosticReports()]);
    } catch (error) {
      void appAlert(`导出诊断包失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDiagnosticsActionBusy(null);
    }
  }, [formData.debug_log_enabled, formData.diagnostics_include_advanced_context, loadLoggingStatus, loadPendingDiagnosticReports]);

  const handleOpenFeedbackReport = useCallback(() => {
    window.dispatchEvent(new CustomEvent('gardenflow:open-feedback-report', {
      detail: {
        sourcePage: 'settings',
        operation: 'manual_feedback',
      },
    }));
  }, []);

  const handleUploadPendingReport = useCallback(async (reportId: string) => {
    setDiagnosticsActionBusy(reportId);
    try {
      const result = await window.ipcRenderer.logs.uploadReport(reportId);
      if (!result?.success) {
        throw new Error(result?.error || '上传诊断报告失败');
      }
      await appAlert('诊断报告已上传。');
      await Promise.all([loadLoggingStatus(), loadPendingDiagnosticReports()]);
    } catch (error) {
      void appAlert(`上传诊断报告失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDiagnosticsActionBusy(null);
    }
  }, [loadLoggingStatus, loadPendingDiagnosticReports]);

  const handleDismissPendingReport = useCallback(async (reportId: string) => {
    setDiagnosticsActionBusy(reportId);
    try {
      const result = await window.ipcRenderer.logs.dismissReport(reportId);
      if (!result?.success) {
        throw new Error(result?.error || '删除待发送报告失败');
      }
      await Promise.all([loadLoggingStatus(), loadPendingDiagnosticReports()]);
    } catch (error) {
      void appAlert(`删除待发送报告失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDiagnosticsActionBusy(null);
    }
  }, [loadLoggingStatus, loadPendingDiagnosticReports]);

  const loadToolDiagnostics = useCallback(async () => {
    try {
      const result = await window.ipcRenderer.toolDiagnostics.list();
      setToolDiagnostics(Array.isArray(result) ? result : []);
    } catch (e) {
      console.error('Failed to load tool diagnostics', e);
    }
  }, []);

  const loadRuntimeRoles = useCallback(async () => {
    try {
      const result = await window.ipcRenderer.aiRoles.list();
      setRuntimeRoles(Array.isArray(result) ? result : []);
    } catch (e) {
      console.error('Failed to load runtime roles', e);
    }
  }, []);

  const loadRuntimeSummary = useCallback(async () => {
    const requestId = ++runtimeSummaryLoadRequestRef.current;
    try {
      const result = await window.ipcRenderer.debug.getRuntimeSummary();
      if (requestId !== runtimeSummaryLoadRequestRef.current) return;
      setRuntimeDiagnosticsSummary(result || null);
    } catch (e) {
      console.error('Failed to load runtime diagnostics summary', e);
    }
  }, []);

  const loadRuntimeTasks = useCallback(async (preserveSelection = true) => {
    const requestId = ++runtimeTasksLoadRequestRef.current;
    setIsRuntimeLoading(true);
    try {
      const result = await window.ipcRenderer.tasks.list({ limit: 40 });
      if (requestId !== runtimeTasksLoadRequestRef.current) return;
      const taskList = Array.isArray(result) ? result : [];
      setRuntimeTasks(taskList);
      setSelectedRuntimeTaskId((prev) => {
        if (preserveSelection && prev && taskList.some((task) => task.id === prev)) {
          return prev;
        }
        return taskList[0]?.id || '';
      });
    } catch (e) {
      console.error('Failed to load runtime tasks', e);
      if (!preserveSelection) {
        setSelectedRuntimeTaskId('');
      }
    } finally {
      if (requestId === runtimeTasksLoadRequestRef.current) {
        setIsRuntimeLoading(false);
      }
    }
  }, []);

  const loadRuntimeSessions = useCallback(async (preserveSelection = true) => {
    const requestId = ++runtimeSessionsLoadRequestRef.current;
    try {
      const result = await window.ipcRenderer.sessions.list();
      if (requestId !== runtimeSessionsLoadRequestRef.current) return;
      const sessionList = Array.isArray(result) ? result as RuntimeSessionListItem[] : [];
      setRuntimeSessions(sessionList);
      setSelectedRuntimeSessionId((prev) => {
        if (preserveSelection && prev && sessionList.some((session) => session.id === prev)) {
          return prev;
        }
        return sessionList[0]?.id || '';
      });
    } catch (e) {
      console.error('Failed to load runtime sessions', e);
      if (!preserveSelection) {
        setSelectedRuntimeSessionId('');
      }
    }
  }, []);

  const loadRuntimeTaskTraces = useCallback(async (taskId: string) => {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) {
      setRuntimeTaskTraces([]);
      return;
    }
    const requestId = ++runtimeTaskTracesLoadRequestRef.current;
    setIsRuntimeTraceLoading(true);
    try {
      const result = await window.ipcRenderer.tasks.trace({ taskId: normalizedTaskId, limit: 120 });
      if (requestId !== runtimeTaskTracesLoadRequestRef.current) return;
      setRuntimeTaskTraces(Array.isArray(result) ? result : []);
    } catch (e) {
      console.error('Failed to load runtime task traces', e);
    } finally {
      if (requestId === runtimeTaskTracesLoadRequestRef.current) {
        setIsRuntimeTraceLoading(false);
      }
    }
  }, []);

  const loadRuntimeSessionDetails = useCallback(async (sessionId: string, options?: { background?: boolean }) => {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      setRuntimeSessionTranscript([]);
      setRuntimeSessionCheckpoints([]);
      setRuntimeSessionToolResults([]);
      return;
    }
    const requestId = ++runtimeSessionDetailsLoadRequestRef.current;
    if (!options?.background) {
      setIsRuntimeSessionLoading(true);
    }
    try {
      const [transcript, checkpoints, toolResults] = await Promise.all([
        window.ipcRenderer.sessions.getTranscript(normalizedSessionId, 120),
        window.ipcRenderer.runtime.getCheckpoints({ sessionId: normalizedSessionId, limit: 80 }),
        window.ipcRenderer.runtime.getToolResults({ sessionId: normalizedSessionId, limit: 120 }),
      ]);
      if (requestId !== runtimeSessionDetailsLoadRequestRef.current) return;
      setRuntimeSessionTranscript(Array.isArray(transcript) ? transcript as RuntimeSessionTranscriptItem[] : []);
      setRuntimeSessionCheckpoints(Array.isArray(checkpoints) ? checkpoints as RuntimeSessionCheckpointItem[] : []);
      setRuntimeSessionToolResults(Array.isArray(toolResults) ? toolResults as RuntimeSessionToolResultItem[] : []);
    } catch (e) {
      console.error('Failed to load runtime session details', e);
    } finally {
      if (!options?.background && requestId === runtimeSessionDetailsLoadRequestRef.current) {
        setIsRuntimeSessionLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    if (activeTab !== 'tools' || !formData.developer_mode_enabled) return;
    const scheduleRefresh = () => {
      if (runtimeObservabilityRefreshTimerRef.current != null) {
        window.clearTimeout(runtimeObservabilityRefreshTimerRef.current);
      }
      runtimeObservabilityRefreshTimerRef.current = window.setTimeout(() => {
        runtimeObservabilityRefreshTimerRef.current = null;
        void loadRuntimeSessions();
        if (selectedRuntimeSessionId) {
          void loadRuntimeSessionDetails(selectedRuntimeSessionId, { background: true });
        }
      }, 450);
    };
    const onRuntimeEvent = () => scheduleRefresh();
    const onWanderProgress = () => scheduleRefresh();
    window.ipcRenderer.runtime.onEvent(onRuntimeEvent as (...args: unknown[]) => void);
    window.ipcRenderer.wander.onProgress(onWanderProgress as (...args: unknown[]) => void);
    return () => {
      window.ipcRenderer.runtime.offEvent(onRuntimeEvent as (...args: unknown[]) => void);
      window.ipcRenderer.wander.offProgress(onWanderProgress as (...args: unknown[]) => void);
      if (runtimeObservabilityRefreshTimerRef.current != null) {
        window.clearTimeout(runtimeObservabilityRefreshTimerRef.current);
        runtimeObservabilityRefreshTimerRef.current = null;
      }
    };
  }, [activeTab, formData.developer_mode_enabled, isActive, loadRuntimeSessionDetails, loadRuntimeSessions, selectedRuntimeSessionId]);

  useEffect(() => {
    if (!isActive) return;
    if (activeTab !== 'tools' || !formData.developer_mode_enabled) return;

    const onRuntimePerfEvent = (_event: unknown, envelope?: unknown) => {
      const collector = runtimePerfCollectorRef.current;
      if (!collector) return;

      const record = toRuntimePerfRecord(envelope);
      const eventType = toRuntimePerfText(record.eventType);
      const sessionId = toRuntimePerfText(record.sessionId);
      const timestamp = toRuntimePerfNumber(record.timestamp) || Date.now();
      if (!eventType || sessionId !== collector.sessionId) return;

      const payload = toRuntimePerfRecord(record.payload);
      let changed = false;

      if (eventType === 'runtime:stream-start') {
        const phase = toRuntimePerfText(payload.phase) || 'unknown';
        if (phase === 'thinking' && collector.thinkingStartedMs == null) {
          collector.thinkingStartedMs = Math.max(0, timestamp - collector.startedAt);
          changed = true;
        }
        appendRuntimePerfTimeline(collector, {
          at: timestamp,
          eventType,
          label: `phase · ${phase}`,
          detail: toRuntimePerfText(payload.runtimeMode) || undefined,
          tone: 'neutral',
        });
        changed = true;
      } else if (eventType === 'runtime:text-delta') {
        const stream = toRuntimePerfText(payload.stream);
        const content = toRuntimePerfText(payload.content);
        if (stream === 'thought' && collector.thoughtFirstTokenMs == null) {
          collector.thoughtFirstTokenMs = Math.max(0, timestamp - collector.startedAt);
          appendRuntimePerfTimeline(collector, {
            at: timestamp,
            eventType,
            label: 'thought first token',
            detail: `${content.length} chars`,
            tone: 'neutral',
          });
          changed = true;
        }
        if (stream === 'response') {
          if (collector.firstResponseMs == null) {
            collector.firstResponseMs = Math.max(0, timestamp - collector.startedAt);
            appendRuntimePerfTimeline(collector, {
              at: timestamp,
              eventType,
              label: 'response first token',
              detail: `${content.length} chars`,
              tone: 'success',
            });
            changed = true;
          }
          const nextChars = (collector.responseChars || 0) + content.length;
          if (nextChars !== collector.responseChars) {
            collector.responseChars = nextChars;
            changed = true;
          }
        }
      } else if (eventType === 'runtime:tool-start') {
        collector.toolCalls += 1;
        if (collector.firstToolStartMs == null) {
          collector.firstToolStartMs = Math.max(0, timestamp - collector.startedAt);
        }
        appendRuntimePerfTimeline(collector, {
          at: timestamp,
          eventType,
          label: `tool start · ${toRuntimePerfText(payload.name) || 'tool'}`,
          detail: toRuntimePerfText(payload.description) || undefined,
          tone: 'warning',
        });
        changed = true;
      } else if (eventType === 'runtime:tool-end') {
        const output = toRuntimePerfRecord(payload.output);
        const success = output.success !== false;
        if (success) {
          collector.toolSuccessCount += 1;
        } else {
          collector.toolFailureCount += 1;
        }
        appendRuntimePerfTimeline(collector, {
          at: timestamp,
          eventType,
          label: `tool ${success ? 'done' : 'failed'} · ${toRuntimePerfText(payload.name) || 'tool'}`,
          detail: toRuntimePerfText(output.content) || undefined,
          tone: success ? 'success' : 'error',
        });
        changed = true;
      } else if (eventType === 'runtime:checkpoint') {
        const checkpointType = toRuntimePerfText(payload.checkpointType) || 'checkpoint';
        collector.checkpointCount += 1;
        if (collector.firstCheckpointMs == null) {
          collector.firstCheckpointMs = Math.max(0, timestamp - collector.startedAt);
        }
        if (checkpointType && !collector.checkpointTypes.includes(checkpointType)) {
          collector.checkpointTypes = [...collector.checkpointTypes, checkpointType];
        }
        appendRuntimePerfTimeline(collector, {
          at: timestamp,
          eventType,
          label: `checkpoint · ${checkpointType}`,
          detail: toRuntimePerfText(payload.summary) || undefined,
          tone: checkpointType === 'chat.error' ? 'error' : 'neutral',
        });
        changed = true;
      } else if (eventType === 'runtime:done') {
        appendRuntimePerfTimeline(collector, {
          at: timestamp,
          eventType,
          label: `done · ${toRuntimePerfText(payload.status) || 'completed'}`,
          detail: toRuntimePerfText(payload.reason) || undefined,
          tone: toRuntimePerfText(payload.status) === 'error' ? 'error' : 'success',
        });
        const content = toRuntimePerfText(payload.content);
        if (content) {
          collector.responseChars = Math.max(collector.responseChars || 0, content.length);
        }
        changed = true;
      }

      if (!changed) return;

      updateRuntimePerfRun(collector.runId, (run) => ({
        ...run,
        ...snapshotRuntimePerfCollector(collector),
      }));
    };

    window.ipcRenderer.runtime.onEvent(onRuntimePerfEvent as (...args: unknown[]) => void);
    return () => {
      window.ipcRenderer.runtime.offEvent(onRuntimePerfEvent as (...args: unknown[]) => void);
    };
  }, [
    activeTab,
    appendRuntimePerfTimeline,
    formData.developer_mode_enabled,
    isActive,
    snapshotRuntimePerfCollector,
    updateRuntimePerfRun,
  ]);

  const loadRuntimeHooks = useCallback(async () => {
    try {
      const result = await window.ipcRenderer.toolHooks.list();
      setRuntimeHooks(Array.isArray(result) ? result as RuntimeHookDefinition[] : []);
    } catch (e) {
      console.error('Failed to load runtime hooks', e);
    }
  }, []);

  const loadBackgroundTasks = useCallback(async (preserveSelection = true) => {
    const requestId = ++backgroundTasksLoadRequestRef.current;
    setIsBackgroundTasksLoading(true);
    try {
      const result = await window.ipcRenderer.backgroundTasks.list();
      if (requestId !== backgroundTasksLoadRequestRef.current) return;
      const taskList = Array.isArray(result) ? result as BackgroundTaskItem[] : [];
      setBackgroundTasks(taskList);
      setSelectedBackgroundTaskId((prev) => {
        if (preserveSelection && prev && taskList.some((task) => task.id === prev)) {
          return prev;
        }
        return taskList[0]?.id || '';
      });
      setSelectedBackgroundTaskDetail((prev) => (
        prev && taskList.some((task) => task.id === prev.id) ? prev : null
      ));
    } catch (e) {
      console.error('Failed to load background tasks', e);
      if (!preserveSelection) {
        setSelectedBackgroundTaskId('');
      }
    } finally {
      if (requestId === backgroundTasksLoadRequestRef.current) {
        setIsBackgroundTasksLoading(false);
      }
    }
  }, []);

  const loadBackgroundWorkerPool = useCallback(async () => {
    const requestId = ++backgroundWorkerPoolLoadRequestRef.current;
    try {
      const result = await window.ipcRenderer.backgroundWorkers.getPoolState();
      if (requestId !== backgroundWorkerPoolLoadRequestRef.current) return;
      setBackgroundWorkerPool({
        json: Array.isArray(result?.json) ? result.json : [],
        runtime: Array.isArray(result?.runtime) ? result.runtime : [],
      });
    } catch (e) {
      console.error('Failed to load background worker pool', e);
    }
  }, []);

  const loadRuntimeDeveloperData = useCallback(async () => {
    await Promise.all([
      loadRuntimeRoles(),
      loadRuntimeSummary(),
      loadToolDiagnostics(),
    ]);
    await Promise.all([
      loadRuntimeTasks(),
      loadRuntimeSessions(),
      loadRuntimeHooks(),
    ]);
    await Promise.all([
      loadBackgroundTasks(),
      loadBackgroundWorkerPool(),
    ]);
  }, [
    loadBackgroundTasks,
    loadBackgroundWorkerPool,
    loadRuntimeHooks,
    loadRuntimeRoles,
    loadRuntimeSummary,
    loadRuntimeSessions,
    loadRuntimeTasks,
    loadToolDiagnostics,
  ]);

  const handleApplyRuntimePerfPreset = useCallback((presetId: string) => {
    const preset = RUNTIME_PERF_PRESETS.find((item) => item.id === presetId) || RUNTIME_PERF_PRESETS[0];
    setRuntimePerfPresetId(preset.id);
    setRuntimePerfMessage(preset.message);
  }, []);

  const ensureRuntimePerfSession = useCallback(async (
    mode: RuntimePerfBenchmarkMode,
    index: number,
  ): Promise<{ id: string }> => {
    const contextType = runtimePerfContextTypeForMode(mode);
    const timestamp = Date.now();
    const contextId = `developer-runtime-perf-${mode}-${timestamp}-${index}`;
    const title = `Runtime Perf · ${mode} · ${formatRuntimePerfRunIndex(index)}`;
    if (mode === 'diagnostics') {
      return await window.ipcRenderer.chat.createDiagnosticsSession({
        title,
        contextId,
        contextType,
      }) as { id: string };
    }
    return await window.ipcRenderer.chat.createContextSession({
      contextId,
      contextType,
      title,
    }) as { id: string };
  }, []);

  const handleClearRuntimePerfResults = useCallback(() => {
    runtimePerfCollectorRef.current = null;
    setActiveRuntimePerfRunId('');
    setRuntimePerfResults([]);
    setRuntimePerfStatusMessage('');
  }, []);

  const handleRunRuntimePerfBenchmark = useCallback(async () => {
    const trimmedMessage = runtimePerfMessage.trim();
    if (!trimmedMessage || isRuntimePerfRunning) return;

    setIsRuntimePerfRunning(true);
    setRuntimePerfStatusMessage(`准备执行 ${runtimePerfIterations} 轮 runtime benchmark...`);

    try {
      for (let iterationIndex = 0; iterationIndex < runtimePerfIterations; iterationIndex += 1) {
        const runNumber = ++runtimePerfRunCounterRef.current;
        const session = await ensureRuntimePerfSession(runtimePerfMode, runNumber);
        const sessionId = String(session?.id || '').trim();
        if (!sessionId) {
          throw new Error('性能测试未拿到有效 sessionId');
        }

        const startedAt = Date.now();
        const runId = `runtime-perf-${startedAt}-${runNumber}`;
        const collector: RuntimePerfCollector = {
          runId,
          sessionId,
          startedAt,
          toolCalls: 0,
          toolSuccessCount: 0,
          toolFailureCount: 0,
          checkpointCount: 0,
          checkpointTypes: [],
          timeline: [],
        };
        runtimePerfCollectorRef.current = collector;
        setActiveRuntimePerfRunId(runId);
        setSelectedRuntimeSessionId(sessionId);
        appendRuntimePerfTimeline(collector, {
          at: startedAt,
          eventType: 'run:start',
          label: '测试开始',
          detail: `${runtimePerfMode} · ${formatRuntimePerfRunIndex(runNumber)}`,
          tone: 'neutral',
          offsetMs: 0,
        });
        const pendingRun: RuntimePerfRunResult = {
          id: runId,
          index: runNumber,
          runtimeMode: runtimePerfMode,
          sessionId,
          presetId: runtimePerfPresetId,
          message: trimmedMessage,
          status: 'running',
          startedAt,
          toolCalls: 0,
          toolSuccessCount: 0,
          toolFailureCount: 0,
          checkpointCount: 0,
          checkpointTypes: [],
          timeline: [...collector.timeline],
        };
        setRuntimePerfResults((prev) => [
          pendingRun,
          ...prev,
        ].slice(0, RUNTIME_PERF_HISTORY_LIMIT));

        setRuntimePerfStatusMessage(`执行中：第 ${iterationIndex + 1}/${runtimePerfIterations} 轮`);

        let finalStatus: RuntimePerfRunResult['status'] = 'completed';
        let finalError = '';
        let finalResponseChars = 0;
        let routeValue: unknown = null;
        let orchestrationValue: unknown = null;

        try {
          const result = await window.ipcRenderer.runtime.query({
            sessionId,
            message: trimmedMessage,
          }) as {
            success?: boolean;
            response?: string;
            route?: unknown;
            orchestration?: unknown;
          };
          if (result?.success === false) {
            throw new Error('runtime query returned success=false');
          }
          finalResponseChars = String(result?.response || '').length;
          routeValue = result?.route;
          orchestrationValue = result?.orchestration;
        } catch (error) {
          finalStatus = 'failed';
          finalError = error instanceof Error ? error.message : String(error);
        }

        const completedAt = Date.now();
        appendRuntimePerfTimeline(collector, {
          at: completedAt,
          eventType: 'run:finish',
          label: finalStatus === 'completed' ? '测试完成' : '测试失败',
          detail: finalError || undefined,
          tone: finalStatus === 'completed' ? 'success' : 'error',
        });

        const [summary, checkpoints, toolResults] = await Promise.all([
          window.ipcRenderer.debug.getRuntimeSummary(),
          window.ipcRenderer.runtime.getCheckpoints({ sessionId, limit: 120 }),
          window.ipcRenderer.runtime.getToolResults({ sessionId, limit: 120 }),
        ]);
        setRuntimeDiagnosticsSummary(summary || null);

        const checkpointRows = (Array.isArray(checkpoints) ? checkpoints : []).filter((item) => {
          const createdAt = toRuntimePerfNumber((item as Record<string, unknown>)?.createdAt) || 0;
          return createdAt >= (startedAt - RUNTIME_PERF_CHECKPOINT_WINDOW_MS);
        }) as RuntimeSessionCheckpointItem[];
        const toolRows = (Array.isArray(toolResults) ? toolResults : []).filter((item) => {
          const createdAt = toRuntimePerfNumber((item as Record<string, unknown>)?.createdAt) || 0;
          return createdAt >= (startedAt - RUNTIME_PERF_CHECKPOINT_WINDOW_MS);
        }) as RuntimeSessionToolResultItem[];
        const recentRuntimeMetrics = Array.isArray(summary?.phase0?.runtimeQueries?.recent)
          ? summary.phase0.runtimeQueries.recent as Array<Record<string, unknown>>
          : [];
        const matchingMetric = recentRuntimeMetrics.find((item) =>
          String(item.sessionId || '').trim() === sessionId
          && (toRuntimePerfNumber(item.createdAt) || 0) >= (startedAt - RUNTIME_PERF_CHECKPOINT_WINDOW_MS)
        );

        const toolSuccessCount = toolRows.filter((item) => Boolean(item.success)).length;
        const toolFailureCount = toolRows.length - toolSuccessCount;
        const checkpointTypes = checkpointRows
          .map((item) => String(item.checkpointType || '').trim())
          .filter(Boolean);

        collector.responseChars = collector.responseChars ?? finalResponseChars;
        collector.toolCalls = Math.max(collector.toolCalls, toolRows.length);
        collector.toolSuccessCount = Math.max(collector.toolSuccessCount, toolSuccessCount);
        collector.toolFailureCount = Math.max(collector.toolFailureCount, toolFailureCount);
        collector.checkpointCount = Math.max(collector.checkpointCount, checkpointRows.length);
        collector.checkpointTypes = checkpointTypes.length ? checkpointTypes : collector.checkpointTypes;

        updateRuntimePerfRun(runId, (run) => ({
          ...run,
          status: finalStatus,
          completedAt,
          totalElapsedMs: Math.max(0, completedAt - startedAt),
          promptChars: toRuntimePerfNumber(matchingMetric?.promptChars),
          activeSkillCount: toRuntimePerfNumber(matchingMetric?.activeSkillCount),
          responseChars: collector.responseChars ?? finalResponseChars,
          toolCalls: collector.toolCalls,
          toolSuccessCount: collector.toolSuccessCount,
          toolFailureCount: collector.toolFailureCount,
          checkpointCount: collector.checkpointCount,
          checkpointTypes: [...collector.checkpointTypes],
          route: routeValue,
          orchestration: orchestrationValue,
          error: finalError || undefined,
          ...snapshotRuntimePerfCollector(collector),
        }));

        runtimePerfCollectorRef.current = null;
        setActiveRuntimePerfRunId('');
        await loadRuntimeSessions();
        await loadRuntimeSessionDetails(sessionId);
      }
      setRuntimePerfStatusMessage(`已完成 ${runtimePerfIterations} 轮 runtime benchmark`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimePerfStatusMessage(`runtime benchmark 失败：${message}`);
      const activeCollector = runtimePerfCollectorRef.current;
      if (activeCollector) {
        const completedAt = Date.now();
        appendRuntimePerfTimeline(activeCollector, {
          at: completedAt,
          eventType: 'run:error',
          label: '执行异常',
          detail: message,
          tone: 'error',
        });
        updateRuntimePerfRun(activeCollector.runId, (run) => ({
          ...run,
          status: 'failed',
          completedAt,
          totalElapsedMs: Math.max(0, completedAt - run.startedAt),
          error: message,
          ...snapshotRuntimePerfCollector(activeCollector),
        }));
      }
    } finally {
      runtimePerfCollectorRef.current = null;
      setActiveRuntimePerfRunId('');
      setIsRuntimePerfRunning(false);
    }
  }, [
    appendRuntimePerfTimeline,
    ensureRuntimePerfSession,
    isRuntimePerfRunning,
    loadRuntimeSessionDetails,
    loadRuntimeSessions,
    runtimePerfIterations,
    runtimePerfMessage,
    runtimePerfMode,
    runtimePerfPresetId,
    snapshotRuntimePerfCollector,
    updateRuntimePerfRun,
  ]);

  const handleCreateRuntimeTask = async () => {
    setIsRuntimeCreating(true);
    try {
      const created = await window.ipcRenderer.tasks.create({
        runtimeMode: runtimeDraftMode,
        sessionId: `dev_task_${Date.now()}`,
        userInput: runtimeDraftInput.trim() || '开发者手动创建任务',
        metadata: {
          source: 'settings-developer-runtime',
        },
      });
      setRuntimeDraftInput('');
      if (created?.id) {
        setSelectedRuntimeTaskId(created.id);
        await loadRuntimeTasks(false);
        await loadRuntimeTaskTraces(created.id);
      } else {
        await loadRuntimeTasks(false);
      }
    } catch (e) {
      console.error('Failed to create runtime task', e);
    } finally {
      setIsRuntimeCreating(false);
    }
  };

  const handleResumeRuntimeTask = async (taskId: string) => {
    setRuntimeTaskActionRunning((prev) => ({ ...prev, [taskId]: 'resume' }));
    try {
      await window.ipcRenderer.tasks.resume({ taskId });
      await loadRuntimeTasks();
      await loadRuntimeTaskTraces(taskId);
    } catch (e) {
      console.error('Failed to resume runtime task', e);
    } finally {
      setRuntimeTaskActionRunning((prev) => ({ ...prev, [taskId]: undefined }));
    }
  };

  const handleCancelRuntimeTask = async (taskId: string) => {
    setRuntimeTaskActionRunning((prev) => ({ ...prev, [taskId]: 'cancel' }));
    try {
      await window.ipcRenderer.tasks.cancel({ taskId });
      await loadRuntimeTasks();
      await loadRuntimeTaskTraces(taskId);
    } catch (e) {
      console.error('Failed to cancel runtime task', e);
    } finally {
      setRuntimeTaskActionRunning((prev) => ({ ...prev, [taskId]: undefined }));
    }
  };

  const handleCancelBackgroundTask = async (taskId: string) => {
    setBackgroundTaskActionRunning((prev) => ({ ...prev, [taskId]: 'cancel' }));
    try {
      await window.ipcRenderer.backgroundTasks.cancel(taskId);
      await loadBackgroundTasks();
    } catch (e) {
      console.error('Failed to cancel background task', e);
    } finally {
      setBackgroundTaskActionRunning((prev) => ({ ...prev, [taskId]: undefined }));
    }
  };

  const runToolDiagnostic = async (toolName: string, mode: 'direct' | 'ai') => {
    setToolDiagnosticRunning((prev) => ({ ...prev, [toolName]: mode }));
    try {
      const result = mode === 'direct'
        ? await window.ipcRenderer.toolDiagnostics.runDirect(toolName)
        : await window.ipcRenderer.toolDiagnostics.runAi(toolName);
      setToolDiagnosticResults((prev) => ({ ...prev, [toolName]: result }));
      await loadRecentDebugLogs();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setToolDiagnosticResults((prev) => ({
        ...prev,
        [toolName]: {
          success: false,
          mode,
          toolName,
          request: null,
          error: errorMessage,
        },
      }));
    } finally {
      setToolDiagnosticRunning((prev) => ({ ...prev, [toolName]: undefined }));
    }
  };

  const runAllToolDiagnostics = async (mode: 'direct' | 'ai') => {
    const candidates = toolDiagnostics.filter((tool) => tool.availabilityStatus === 'available');
    for (const tool of candidates) {
      // eslint-disable-next-line no-await-in-loop
      await runToolDiagnostic(tool.name, mode);
    }
  };

  const persistDeveloperModeState = useCallback(async (enabled: boolean, unlockedAt: string | null) => {
    await window.ipcRenderer.saveSettings({
      developer_mode_enabled: enabled,
      developer_mode_unlocked_at: unlockedAt,
    });
  }, []);

  const expireDeveloperMode = useCallback(async () => {
    setFormData((prev) => ({
      ...prev,
      developer_mode_enabled: false,
      developer_mode_unlocked_at: '',
    }));
    try {
      await persistDeveloperModeState(false, null);
    } catch (error) {
      console.error('Failed to persist developer mode expiration', error);
    }
  }, [persistDeveloperModeState]);

  const handleCliRuntimeExecutionModeChange = useCallback((mode: CliRuntimeExecutionMode) => {
    const nextMode = normalizeCliRuntimeExecutionMode(mode);
    setCliRuntimeExecutionMode(nextMode);
    setFormData((prev) => ({
      ...prev,
      cli_runtime_execution_mode: nextMode,
    }));
    void window.ipcRenderer.saveSettings({
      cli_runtime_execution_mode: nextMode,
    }).then(() => {
      setCliRuntimeStatusMessage(
        nextMode === 'unrestricted'
          ? 'CLI Runtime 已切换为完全访问；仅对你明确授权的命令使用。'
          : nextMode === 'managed'
            ? 'CLI Runtime 已切换为安全模式。'
            : 'CLI Runtime 已切换为兼容模式。',
      );
    }).catch((error) => {
      console.error('Failed to persist CLI runtime execution mode', error);
      setCliRuntimeStatusMessage(`保存 CLI Runtime 模式失败：${String(error)}`);
    });
  }, []);

  const handleVersionTap = useCallback(() => {
    setDeveloperVersionTapCount((prev) => {
      const next = prev + 1;
      if (next < DEVELOPER_MODE_UNLOCK_TAP_COUNT) {
        return next;
      }

      const unlockedAt = new Date().toISOString();
      setFormData((current) => ({
        ...current,
        developer_mode_enabled: true,
        developer_mode_unlocked_at: unlockedAt,
      }));
      void persistDeveloperModeState(true, unlockedAt);
      if (activeTab === 'tools') {
        void loadToolDiagnostics();
        void loadRuntimeDeveloperData();
      }
      void appAlert('开发者模式已开启（24 小时内有效）');
      return 0;
    });
  }, [activeTab, persistDeveloperModeState]);

  const handleShowCurrentReleaseNotes = useCallback(() => {
    window.dispatchEvent(new CustomEvent(SHOW_CURRENT_RELEASE_NOTES_EVENT, {
      detail: { version: appVersion || '2.0.0' },
    }));
  }, [appVersion]);

  const handleInstallBrowserPlugin = useCallback(async () => {
    try {
      const prepared = await window.ipcRenderer.browserPlugin.prepare() as { success?: boolean; error?: string; recovery?: string };
      if (!prepared?.success) {
        void appAlert(`${prepared?.error || '准备浏览器插件失败'}${prepared?.recovery ? `\n\n${prepared.recovery}` : ''}`);
        return;
      }
      const opened = await window.ipcRenderer.browserPlugin.openDir() as { success?: boolean; error?: string };
      if (!opened?.success) {
        void appAlert(opened?.error || '打开浏览器插件目录失败');
      }
    } catch (error) {
      console.error('Failed to prepare browser plugin:', error);
      const detail = error instanceof Error ? error.message : String(error || '未知错误');
      void appAlert(`准备浏览器插件失败\n\n${detail}`);
    }
  }, []);

  const loadSettings = useCallback(async (options?: { preserveViewState?: boolean; preserveRemoteModels?: boolean }) => {
    const preserveViewState = Boolean(options?.preserveViewState);
    const requestId = ++settingsLoadRequestRef.current;
    const hadLocalAiSourceDraft = aiSourceDraftDirtyRef.current;
    const requestAiSourceEditGeneration = aiSourceEditGenerationRef.current;
    try {
      const settings = await window.ipcRenderer.getSettings();
      if (requestId !== settingsLoadRequestRef.current) return;
      if (
        preserveViewState
        && (
          hadLocalAiSourceDraft
          || aiSourceDraftDirtyRef.current
          || requestAiSourceEditGeneration !== aiSourceEditGenerationRef.current
        )
      ) {
        return;
      }
      if (settings) {
        const resolveLinkedSourceIdFromList = (params: {
          endpoint?: string;
          apiKey?: string;
          model?: string;
          fallbackId?: string;
          fallbackCapability?: ModelCapability;
        }): string => {
          const normalizedEndpoint = String(params.endpoint || '').trim();
          const normalizedApiKey = String(params.apiKey || '').trim();
          const normalizedModel = String(params.model || '').trim();
          let bestSourceId = '';
          let bestScore = -1;

          for (const source of sourceList) {
            let score = 0;
            const sourceEndpoint = String(source.baseURL || '').trim();
            const sourceApiKey = String(source.apiKey || '').trim();
            const sourceModels = [
              ...(source.models || []),
              source.model,
              ...(source.modelsMeta || []).map((item) => String(item?.id || '').trim()),
            ].filter(Boolean);
            if (normalizedEndpoint && sourceEndpoint === normalizedEndpoint) score += 4;
            if (normalizedApiKey && sourceApiKey && sourceApiKey === normalizedApiKey) score += 2;
            if (normalizedModel && sourceModels.includes(normalizedModel)) score += 1;
            if (score > bestScore) {
              bestScore = score;
              bestSourceId = source.id;
            }
          }

          if (bestScore > 0 && bestSourceId) return bestSourceId;
          if (params.fallbackCapability) {
            const capabilitySource = sourceList.find((source) => (
              normalizeAiModelDescriptors([
                ...(source.modelsMeta || []),
                ...(source.models || []).map((id) => ({ id })),
                source.model ? { id: source.model } : null,
              ]).some((model) => model.capabilities.includes(params.fallbackCapability as ModelCapability))
            ));
            if (capabilitySource) return capabilitySource.id;
          }
          const fallbackId = String(params.fallbackId || '').trim();
          if (fallbackId && sourceList.some((source) => source.id === fallbackId)) return fallbackId;
          return normalizedDefaultId;
        };

        const requestedDefaultSourceId = canonicalizeOfficialAutoSourceId(String(settings.default_ai_source_id || '').trim());
        const prefersOfficialDefault = isOfficialAutoSourceId(requestedDefaultSourceId);
        let sourceList = parseAiSources(settings.ai_sources_json).filter((source) => !isDeprecatedEmptyOpenAiSource(source));
        if (!sourceList.length && !prefersOfficialDefault && (settings.api_endpoint || settings.api_key || settings.model_name)) {
          const inferredPresetId = inferPresetIdByEndpoint(settings.api_endpoint || '');
          sourceList = [{
            id: generateAiSourceId(),
            name: findAiPresetById(inferredPresetId)?.label || '导入供应商',
            presetId: inferredPresetId,
            baseURL: settings.api_endpoint || '',
            apiKey: settings.api_key || '',
            models: normalizeSourceModels([settings.model_name || '']),
            modelsMeta: normalizeAiModelDescriptors([settings.model_name || '']),
            model: settings.model_name || '',
            protocol: findAiPresetById(inferredPresetId)?.protocol || 'openai',
          }];
        }
        // 私有网关形态下官方源必须始终在列表中，各能力的「供应商」下拉才能选到它。
        if (OFFICIAL_SOURCE_IS_PRIVATE_GATEWAY && !sourceList.some((source) => isOfficialManagedSource(source))) {
          sourceList = [createOfficialAiSource(), ...sourceList];
        }

        const loadedDefaultId = requestedDefaultSourceId || sourceList[0]?.id || OFFICIAL_AUTO_SOURCE_ID;
        const normalizedDefaultId = sourceList.some((source) => source.id === loadedDefaultId)
          ? loadedDefaultId
          : (loadedDefaultId === OFFICIAL_AUTO_SOURCE_ID ? OFFICIAL_AUTO_SOURCE_ID : (sourceList[0]?.id || OFFICIAL_AUTO_SOURCE_ID));
        const resolvedDefaultSource = sourceList.find((source) => source.id === normalizedDefaultId)
          || (isOfficialAutoSourceId(normalizedDefaultId) ? officialAiSourcePlaceholder : sourceList[0])
          || null;
        const legacyTranscriptionSourceId = resolveLinkedSourceIdFromList({
          endpoint: String(settings.transcription_endpoint || settings.api_endpoint || '').trim(),
          apiKey: String(settings.transcription_key || settings.api_key || '').trim(),
          model: String(settings.transcription_model || '').trim(),
          fallbackId: normalizedDefaultId,
        });
        const legacyEmbeddingSourceId = resolveLinkedSourceIdFromList({
          endpoint: String(settings.embedding_endpoint || settings.api_endpoint || '').trim(),
          apiKey: String(settings.embedding_key || settings.api_key || '').trim(),
          model: String(settings.embedding_model || '').trim(),
          fallbackId: normalizedDefaultId,
        });
        const legacyVisualIndexSourceId = resolveLinkedSourceIdFromList({
          endpoint: String(settings.visual_index_endpoint || settings.api_endpoint || '').trim(),
          apiKey: String(settings.visual_index_api_key || settings.api_key || '').trim(),
          model: String(settings.visual_index_model || '').trim(),
          fallbackId: normalizedDefaultId,
        });
        const legacyVideoAnalysisSourceId = resolveLinkedSourceIdFromList({
          endpoint: String(settings.video_analysis_endpoint || settings.api_endpoint || '').trim(),
          apiKey: String(settings.video_analysis_api_key || settings.api_key || '').trim(),
          model: String(settings.video_analysis_model || '').trim(),
          fallbackId: normalizedDefaultId,
        });
        const legacyImageSourceId = resolveLinkedSourceIdFromList({
          endpoint: String(settings.image_endpoint || '').trim(),
          apiKey: String(settings.image_api_key || '').trim(),
          model: String(settings.image_model || '').trim(),
          fallbackId: normalizedDefaultId,
          fallbackCapability: 'image',
        });
        const legacyVoiceSourceId = resolveLinkedSourceIdFromList({
          endpoint: String(settings.voice_endpoint || settings.tts_endpoint || settings.api_endpoint || '').trim(),
          apiKey: String(settings.voice_api_key || settings.tts_api_key || settings.api_key || '').trim(),
          model: String(settings.voice_tts_model || settings.tts_model || '').trim(),
          fallbackId: normalizedDefaultId,
        });
        const unlockedAt = String(settings.developer_mode_unlocked_at || '').trim();
        const unlockedAtMs = unlockedAt ? Date.parse(unlockedAt) : NaN;
        const developerModeEnabled = Boolean(settings.developer_mode_enabled)
          && Number.isFinite(unlockedAtMs)
          && (Date.now() - unlockedAtMs) < DEVELOPER_MODE_TTL_MS;
        const loadedCliRuntimeExecutionMode = normalizeCliRuntimeExecutionMode(
          settings.cli_runtime_execution_mode,
        );
        const loadedModelRoutes = normalizeAiModelRoutes(settings.ai_model_routes_json);
        const hasPersistedModelRoutes = typeof settings.ai_model_routes_json === 'string'
          && settings.ai_model_routes_json.trim().length > 0;
        const resolvePersistedRouteSourceId = (
          route: AiModelRouteConfig,
          legacySourceId: string,
          preferExplicitLegacyCustomSource = false,
        ): string => {
          if (!hasPersistedModelRoutes) return legacySourceId;
          if (
            preferExplicitLegacyCustomSource
            && legacySourceId
            && !isOfficialAutoSourceId(legacySourceId)
            && sourceList.some((source) => source.id === legacySourceId)
          ) {
            return legacySourceId;
          }
          const routeSourceId = canonicalizeOfficialAutoSourceId(String(route.sourceId || '').trim());
          if (route.mode === 'official' || isOfficialAutoSourceId(routeSourceId)) {
            return OFFICIAL_AUTO_SOURCE_ID;
          }
          if (route.mode === 'disabled') return '';
          if (routeSourceId && sourceList.some((source) => source.id === routeSourceId)) {
            return routeSourceId;
          }
          return legacySourceId;
        };
        const resolvedTranscriptionSourceId = resolvePersistedRouteSourceId(
          loadedModelRoutes.transcription,
          legacyTranscriptionSourceId,
        );
        const resolvedEmbeddingSourceId = resolvePersistedRouteSourceId(
          loadedModelRoutes.embedding,
          legacyEmbeddingSourceId,
        );
        const resolvedImageSourceId = resolvePersistedRouteSourceId(
          loadedModelRoutes.image,
          legacyImageSourceId,
        );
        const resolvedVisualIndexSourceId = resolvePersistedRouteSourceId(
          loadedModelRoutes.visualIndex,
          legacyVisualIndexSourceId,
          Boolean(String(settings.visual_index_endpoint || '').trim()),
        );
        const resolvedVideoAnalysisSourceId = resolvePersistedRouteSourceId(
          loadedModelRoutes.videoAnalysis,
          legacyVideoAnalysisSourceId,
          Boolean(String(settings.video_analysis_endpoint || '').trim()),
        );
        const resolvedVoiceSourceId = resolvePersistedRouteSourceId(
          loadedModelRoutes.voiceTts,
          legacyVoiceSourceId,
          Boolean(String(settings.voice_endpoint || settings.tts_endpoint || '').trim()),
        );
        const routeSourceMode = (sourceId: string, fallback: AiModelRouteMode = 'custom'): AiModelRouteMode => {
          const normalizedSourceId = canonicalizeOfficialAutoSourceId(sourceId);
          if (isOfficialAutoSourceId(normalizedSourceId)) return 'official';
          if (fallback === 'disabled') return 'disabled';
          return normalizedSourceId ? 'custom' : fallback;
        };
        const firstCustomSourceIdFromList = sourceList.find((source) => !isOfficialManagedSource(source))?.id || '';
        const loadedChatRouteSourceId = canonicalizeOfficialAutoSourceId(String(loadedModelRoutes.chat.sourceId || '').trim());
        const resolvedChatSourceId = loadedModelRoutes.chat.mode === 'official'
          ? OFFICIAL_AUTO_SOURCE_ID
          : loadedChatRouteSourceId
            || (loadedModelRoutes.chat.mode === 'custom' ? firstCustomSourceIdFromList : '')
            || normalizedDefaultId
            || OFFICIAL_AUTO_SOURCE_ID;
        const resolvedChatSource = sourceList.find((source) => source.id === resolvedChatSourceId)
          || (isOfficialAutoSourceId(resolvedChatSourceId) ? officialAiSourcePlaceholder : null)
          || resolvedDefaultSource
          || null;
        const loadedVoiceTtsModel = String(loadedModelRoutes.voiceTts.model || settings.voice_tts_model || settings.tts_model || DEFAULT_VOICE_TTS_MODEL).trim();
        const loadedVoiceCloneModel = cloneModelForVoiceTtsModel(
          loadedVoiceTtsModel,
          String(loadedModelRoutes.voiceClone.model || settings.voice_clone_model || DEFAULT_VOICE_CLONE_MODEL).trim(),
        );
        const routeModelFirst = (routeModel: string, legacyModel: unknown) => (
          String(routeModel || legacyModel || '').trim()
        );
        const resolvedImageSource = sourceList.find((source) => source.id === resolvedImageSourceId) || null;
        const loadedImageRouting = resolvedImageSource
          ? inferImageRoutingFromSource(resolvedImageSource)
          : {
            provider: settings.image_provider || 'openai-compatible',
            template: settings.image_provider_template || '',
          };
        const loadedImageProvider = loadedImageRouting.provider || settings.image_provider || 'openai-compatible';
        const loadedImageTemplate = inferImageTemplateByProvider(
          loadedImageProvider,
          loadedImageRouting.template || settings.image_provider_template || '',
        );
        const loadedImageModel = pickCapabilityModelForSource(
          resolvedImageSource,
          routeModelFirst(loadedModelRoutes.image.model, settings.image_model),
          'image',
        );
        const loadedVideoProviders = normalizeVideoProviderConfigs(settings.video_providers_json, {
          endpoint: settings.video_endpoint,
          apiKey: settings.video_api_key,
          model: settings.video_model,
          modelsJson: settings.video_models_json,
        });
        const requestedActiveVideoProviderId = String(settings.active_video_provider_id || '').trim();
        const loadedActiveVideoProviderId = loadedVideoProviders.some((provider) => provider.id === requestedActiveVideoProviderId)
          ? requestedActiveVideoProviderId
          : (loadedVideoProviders[0]?.id || '');
        const loadedActiveVideoProvider = loadedVideoProviders.find((provider) => provider.id === loadedActiveVideoProviderId)
          || loadedVideoProviders[0];
        const loadedVideoModel = loadedActiveVideoProvider?.model || GARDENFLOW_OFFICIAL_VIDEO_MODELS['text-to-video'];
        const loadedVideoModels = loadedActiveVideoProvider?.models || [loadedVideoModel];
        const nextModelRoutes: AiModelRoutes = {
          ...loadedModelRoutes,
          chat: {
            ...loadedModelRoutes.chat,
            mode: routeSourceMode(resolvedChatSourceId, loadedModelRoutes.chat.mode),
            sourceId: resolvedChatSourceId,
            model: routeModelFirst(loadedModelRoutes.chat.model, resolvedChatSource?.model || settings.model_name),
          },
          wander: {
            ...loadedModelRoutes.wander,
            model: routeModelFirst(loadedModelRoutes.wander.model, settings.model_name_wander),
          },
          team: {
            ...loadedModelRoutes.team,
            model: routeModelFirst(loadedModelRoutes.team.model, settings.model_name_chatroom),
          },
          knowledge: {
            ...loadedModelRoutes.knowledge,
            model: routeModelFirst(loadedModelRoutes.knowledge.model, settings.model_name_knowledge),
          },
          gardenflow: {
            ...loadedModelRoutes.gardenflow,
            model: routeModelFirst(loadedModelRoutes.gardenflow.model, settings.model_name_gardenflow),
          },
          transcription: {
            ...loadedModelRoutes.transcription,
            mode: routeSourceMode(resolvedTranscriptionSourceId, loadedModelRoutes.transcription.mode),
            sourceId: resolvedTranscriptionSourceId,
            model: routeModelFirst(loadedModelRoutes.transcription.model, settings.transcription_model),
          },
          embedding: {
            ...loadedModelRoutes.embedding,
            mode: routeSourceMode(resolvedEmbeddingSourceId, loadedModelRoutes.embedding.mode),
            sourceId: resolvedEmbeddingSourceId,
            model: routeModelFirst(loadedModelRoutes.embedding.model, settings.embedding_model),
          },
          image: {
            ...loadedModelRoutes.image,
            mode: routeSourceMode(resolvedImageSourceId, loadedModelRoutes.image.mode),
            sourceId: resolvedImageSourceId,
            model: loadedImageModel,
          },
          visualIndex: {
            ...loadedModelRoutes.visualIndex,
            mode: routeSourceMode(resolvedVisualIndexSourceId, loadedModelRoutes.visualIndex.mode === 'disabled' ? 'official' : loadedModelRoutes.visualIndex.mode),
            sourceId: resolvedVisualIndexSourceId,
            model: routeModelFirst(loadedModelRoutes.visualIndex.model, settings.visual_index_model),
          },
          videoAnalysis: {
            ...loadedModelRoutes.videoAnalysis,
            mode: routeSourceMode(resolvedVideoAnalysisSourceId, loadedModelRoutes.videoAnalysis.mode === 'disabled' ? 'official' : loadedModelRoutes.videoAnalysis.mode),
            sourceId: resolvedVideoAnalysisSourceId,
            model: routeModelFirst(loadedModelRoutes.videoAnalysis.model, settings.video_analysis_model),
          },
          voiceTts: {
            ...loadedModelRoutes.voiceTts,
            mode: routeSourceMode(resolvedVoiceSourceId, loadedModelRoutes.voiceTts.mode),
            sourceId: resolvedVoiceSourceId,
            model: loadedVoiceTtsModel,
          },
          voiceClone: {
            ...loadedModelRoutes.voiceClone,
            mode: 'official',
            sourceId: OFFICIAL_AUTO_SOURCE_ID,
            model: loadedVoiceCloneModel,
          },
        };

        setCurrentSpaceState(
          (settings as { active_space_id?: string; activeSpaceId?: string }).active_space_id
          || (settings as { active_space_id?: string; activeSpaceId?: string }).activeSpaceId
        );

        setAiSources(sourceList);
        setDefaultAiSourceId(normalizedDefaultId);
        setActiveAiSourceId((prevActiveId) => {
          if (!preserveViewState) return resolvedChatSourceId;
          const currentActiveId = canonicalizeOfficialAutoSourceId(prevActiveId);
          if (isOfficialAutoSourceId(currentActiveId)) {
            return currentActiveId;
          }
          if (currentActiveId && sourceList.some((source) => source.id === currentActiveId)) {
            return currentActiveId;
          }
          return resolvedChatSourceId;
        });
        setDetectedAiProtocol((resolvedChatSource?.protocol || findAiPresetById(resolvedChatSource?.presetId || '')?.protocol || 'openai') as AiProtocol);
        const registryMcpServers = await loadMcpRuntimeData();
        if (!registryMcpServers) {
          setMcpServers(parseMcpServers(settings.mcp_servers_json));
        }
        setCliRuntimeExecutionMode(loadedCliRuntimeExecutionMode);
        setTranscriptionSourceId(resolvedTranscriptionSourceId);
        setEmbeddingSourceId(resolvedEmbeddingSourceId);
        setVisualIndexSourceId(resolvedVisualIndexSourceId);
        setVideoAnalysisSourceId(resolvedVideoAnalysisSourceId);
        setImageSourceId(resolvedImageSourceId);
        setVoiceSourceId(resolvedVoiceSourceId);
        setSelectedVideoProviderId((currentId) => (
          preserveViewState && loadedVideoProviders.some((provider) => provider.id === currentId)
            ? currentId
            : loadedActiveVideoProviderId
        ));
        setAiModelRoutes(nextModelRoutes);
        setNotificationSettings(parseNotificationSettings(settings.notifications_json));
        clearAiSourceDraftDirty();
          console.log('[settings][ai] loadSettings-applied', {
          sourceCount: sourceList.length,
          defaultAiSourceId: normalizedDefaultId,
          chatSourceId: resolvedChatSourceId,
          transcriptionSourceId: resolvedTranscriptionSourceId,
          embeddingSourceId: resolvedEmbeddingSourceId,
          visualIndexSourceId: resolvedVisualIndexSourceId,
          videoAnalysisSourceId: resolvedVideoAnalysisSourceId,
          imageSourceId: resolvedImageSourceId,
          voiceSourceId: resolvedVoiceSourceId,
        });

        setFormData({
          api_endpoint: resolvedChatSource?.baseURL || '',
          api_key: resolvedChatSource?.apiKey || '',
          model_name: nextModelRoutes.chat.model || resolvedChatSource?.model || '',
          workspace_dir: settings.workspace_dir || '',
          transcription_model: nextModelRoutes.transcription.model || '',
          transcription_endpoint: settings.transcription_endpoint || '',
          transcription_key: settings.transcription_key || '',
          embedding_endpoint: settings.embedding_endpoint || '',
          embedding_key: settings.embedding_key || '',
          embedding_model: nextModelRoutes.embedding.model || '',
          visual_index_enabled: Boolean(settings.visual_index_enabled),
          visual_index_provider: settings.visual_index_provider || 'openai-compatible',
          visual_index_endpoint: settings.visual_index_endpoint || '',
          visual_index_api_key: settings.visual_index_api_key || '',
          visual_index_model: nextModelRoutes.visualIndex.model || '',
          visual_index_prompt_version: normalizeVisualIndexPromptVersion(settings.visual_index_prompt_version),
          visual_index_timeout_seconds: String(settings.visual_index_timeout_seconds || 90),
          visual_index_max_image_edge: String(settings.visual_index_max_image_edge || 1536),
          visual_index_skip_small_images: settings.visual_index_skip_small_images !== false,
          visual_index_pdf_max_pages: String(settings.visual_index_pdf_max_pages || 12),
          visual_index_pdf_render_dpi: String(settings.visual_index_pdf_render_dpi || 144),
          visual_index_concurrency: String(settings.visual_index_concurrency || 1),
          video_analysis_enabled: settings.video_analysis_enabled === undefined
            ? DEFAULT_VIDEO_ANALYSIS_ENABLED
            : Boolean(settings.video_analysis_enabled),
          video_analysis_endpoint: settings.video_analysis_endpoint || '',
          video_analysis_api_key: settings.video_analysis_api_key || '',
          video_analysis_model: nextModelRoutes.videoAnalysis.model || '',
          video_analysis_protocol: settings.video_analysis_protocol || 'gemini',
          video_analysis_max_direct_video_bytes: String(settings.video_analysis_max_direct_video_bytes || 64 * 1024 * 1024),
          docling_endpoint: settings.docling_endpoint || settings.parser_docling_endpoint || '',
          tika_endpoint: settings.tika_endpoint || settings.parser_tika_endpoint || '',
          unstructured_endpoint: settings.unstructured_endpoint || settings.parser_unstructured_endpoint || '',
          parser_api_key: settings.parser_api_key || '',
          parser_timeout_seconds: String(settings.parser_timeout_seconds || 90),
          rerank_endpoint: settings.rerank_endpoint || settings.cross_encoder_rerank_endpoint || '',
          rerank_api_key: settings.rerank_api_key || '',
          rerank_model: settings.rerank_model || '',
          rerank_timeout_seconds: String(settings.rerank_timeout_seconds || 30),
          image_provider: loadedImageProvider,
          image_endpoint: settings.image_endpoint || resolveDefaultImageEndpoint(
            loadedImageProvider,
            loadedImageTemplate || 'openai-images'
          ),
          image_api_key: settings.image_api_key || '',
          image_provider_template: loadedImageTemplate,
          image_model: loadedImageModel,
          voice_endpoint: settings.voice_endpoint || settings.tts_endpoint || '',
          voice_api_key: settings.voice_api_key || settings.tts_api_key || '',
          voice_tts_model: loadedVoiceTtsModel,
          tts_model: loadedVoiceTtsModel,
          voice_clone_model: loadedVoiceCloneModel,
          video_endpoint: loadedActiveVideoProvider?.endpoint || GARDENFLOW_OFFICIAL_VIDEO_BASE_URL,
          video_api_key: loadedActiveVideoProvider?.apiKey || '',
          video_model: loadedVideoModel,
          video_models_json: JSON.stringify(loadedVideoModels),
          video_providers_json: JSON.stringify(loadedVideoProviders),
          active_video_provider_id: loadedActiveVideoProviderId,
          image_aspect_ratio: settings.image_aspect_ratio || '3:4',
          image_size: '',
          image_quality: settings.image_quality === 'low' || settings.image_quality === 'medium' || settings.image_quality === 'high' ? settings.image_quality : 'medium',
          model_name_wander: nextModelRoutes.wander.model || '',
          model_name_chatroom: nextModelRoutes.team.model || '',
          model_name_knowledge: nextModelRoutes.knowledge.model || '',
          model_name_gardenflow: nextModelRoutes.gardenflow.model || '',
          proxy_enabled: Boolean(settings.proxy_enabled),
          proxy_url: settings.proxy_url || '',
          proxy_bypass: settings.proxy_bypass || 'localhost,127.0.0.1,::1',
          gardenflow_compact_target_tokens: String(settings.gardenflow_compact_target_tokens || 256000),
          chat_max_tokens_default: sanitizeChatMaxTokensInput(String(settings.chat_max_tokens_default || DEFAULT_CHAT_MAX_TOKENS), DEFAULT_CHAT_MAX_TOKENS),
          chat_max_tokens_deepseek: sanitizeChatMaxTokensInput(String(settings.chat_max_tokens_deepseek || DEFAULT_CHAT_MAX_TOKENS_DEEPSEEK), DEFAULT_CHAT_MAX_TOKENS_DEEPSEEK),
          wander_deep_think_enabled: Boolean(settings.wander_deep_think_enabled),
          debug_log_enabled: Boolean(settings.debug_log_enabled),
          diagnostics_upload_consent: settings.diagnostics_upload_consent === 'none' ? 'none' : 'approved',
          diagnostics_include_advanced_context: Boolean(settings.diagnostics_include_advanced_context),
          diagnostics_auto_send_same_crash: Boolean(settings.diagnostics_auto_send_same_crash),
          diagnostics_last_prompted_at: String(settings.diagnostics_last_prompted_at || ''),
          analytics_consent: settings.analytics_consent === 'none' ? 'none' : 'approved',
          release_log_retention_days: String(settings.release_log_retention_days || 7),
          release_log_max_file_mb: String(settings.release_log_max_file_mb || 10),
          cli_runtime_execution_mode: loadedCliRuntimeExecutionMode,
          developer_mode_enabled: developerModeEnabled,
          developer_mode_unlocked_at: developerModeEnabled ? unlockedAt : '',
          ai_model_routes_json: JSON.stringify(nextModelRoutes),
          image_hosting_json: serializeImageHostingSettings(settings.image_hosting_json),
          ecommerce_platforms_json: serializeEcommercePlatformsSettings(
            normalizeEcommercePlatformsSettings(settings.ecommerce_platforms_json)
          ),
        });

        if (Boolean(settings.developer_mode_enabled) && !developerModeEnabled) {
          void persistDeveloperModeState(false, null);
        }
      } else {
        if (requestId !== settingsLoadRequestRef.current) return;
        setCurrentSpaceState(DEFAULT_SPACE_ID);
        setAiSources([]);
        setDefaultAiSourceId(OFFICIAL_AUTO_SOURCE_ID);
        setActiveAiSourceId((prevActiveId) => {
          const currentActiveId = canonicalizeOfficialAutoSourceId(prevActiveId);
          if (preserveViewState && isOfficialAutoSourceId(currentActiveId)) {
            return currentActiveId;
          }
          return OFFICIAL_AUTO_SOURCE_ID;
        });
        setDetectedAiProtocol('openai');
        setMcpServers([]);
        setCliRuntimeExecutionMode('host_compatible');
        setAiModelRoutes(DEFAULT_AI_MODEL_ROUTES);
        setNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS);
        clearAiSourceDraftDirty();
      }
    } catch (e) {
      if (requestId !== settingsLoadRequestRef.current) return;
      console.error("Failed to load settings", e);
    }
  }, [clearAiSourceDraftDirty, inferImageRoutingFromSource, isDeprecatedEmptyOpenAiSource, isOfficialManagedSource, loadMcpRuntimeData, officialAiSourcePlaceholder, persistDeveloperModeState, pickCapabilityModelForSource, setCurrentSpaceState]);

  const reloadCustomAiSettings = useCallback(async (options?: { preserveViewState?: boolean; preserveRemoteModels?: boolean }) => {
    await loadSettings({
      preserveViewState: true,
      preserveRemoteModels: true,
      ...options,
    });
  }, [loadSettings]);

  useEffect(() => {
    if (!formData.developer_mode_enabled || !formData.developer_mode_unlocked_at) {
      return;
    }
    const unlockedAtMs = Date.parse(formData.developer_mode_unlocked_at);
    if (!Number.isFinite(unlockedAtMs)) {
      void expireDeveloperMode();
      return;
    }
    const remaining = DEVELOPER_MODE_TTL_MS - (Date.now() - unlockedAtMs);
    if (remaining <= 0) {
      void expireDeveloperMode();
      return;
    }
    const timer = window.setTimeout(() => {
      void expireDeveloperMode();
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [expireDeveloperMode, formData.developer_mode_enabled, formData.developer_mode_unlocked_at]);

  const upsertCliRuntimeInstallQueueItem = useCallback((item: CliRuntimeInstallQueueItem) => {
    setCliRuntimeInstallQueue((prev) => {
      const next = prev.filter((entry) => entry.installId !== item.installId);
      next.unshift(item);
      return next
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, 8);
    });
  }, []);

  const loadCliRuntimeDashboard = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsCliRuntimeRefreshing(true);
    }
    try {
      const [detectResult, environmentsResult] = await Promise.all([
        window.ipcRenderer.cliRuntime.detect(),
        window.ipcRenderer.cliRuntime.listEnvironments(),
      ]);
      const detectedToolsRaw = Array.isArray(detectResult)
        ? detectResult
        : Array.isArray((detectResult as { tools?: unknown[] } | null)?.tools)
          ? (detectResult as { tools?: unknown[] }).tools || []
          : [];
      const nextTools = detectedToolsRaw
        .map(normalizeCliRuntimeToolRecord)
        .filter((item): item is CliRuntimeToolRecord => Boolean(item))
        .sort((left, right) => left.name.localeCompare(right.name));
      const nextEnvironments = (Array.isArray(environmentsResult) ? environmentsResult : [])
        .map(normalizeCliRuntimeEnvironmentRecord)
        .filter((item): item is CliRuntimeEnvironmentRecord => Boolean(item))
        .sort((left, right) => left.scope.localeCompare(right.scope) || left.id.localeCompare(right.id));
      setCliRuntimeTools(nextTools);
      setCliRuntimeEnvironments(nextEnvironments);
      if (!options?.silent) {
        setCliRuntimeStatusMessage(`已刷新 CLI runtime：${nextTools.length} 个工具，${nextEnvironments.length} 个环境`);
      }
      setCliRuntimeInstallDraft((current) => {
        if (current.environmentId && nextEnvironments.some((item) => item.id === current.environmentId)) {
          return current;
        }
        const fallbackEnvironment = nextEnvironments[0]?.id || '';
        if (!fallbackEnvironment || fallbackEnvironment === current.environmentId) {
          return current;
        }
        return {
          ...current,
          environmentId: fallbackEnvironment,
        };
      });
    } catch (error) {
      console.error('Failed to load CLI runtime dashboard', error);
      if (!options?.silent) {
        setCliRuntimeStatusMessage(`刷新 CLI runtime 失败：${String(error)}`);
      }
    } finally {
      if (!options?.silent) {
        setIsCliRuntimeRefreshing(false);
      }
    }
  }, []);

  const handleInspectCliRuntimeTool = useCallback(async (toolId: string) => {
    const normalizedToolId = String(toolId || '').trim();
    if (!normalizedToolId) return;
    setCliRuntimeInspectingToolId(normalizedToolId);
    try {
      const result = await window.ipcRenderer.cliRuntime.inspect({ toolId: normalizedToolId });
      const normalized = normalizeCliRuntimeToolRecord(result);
      if (normalized) {
        setCliRuntimeTools((prev) => {
          const next = prev.map((item) => (item.id === normalizedToolId ? { ...item, ...normalized } : item));
          if (!next.some((item) => item.id === normalizedToolId)) {
            next.unshift(normalized);
          }
          return next.sort((left, right) => left.name.localeCompare(right.name));
        });
        setCliRuntimeStatusMessage(`已检查 ${normalized.name || normalized.executable}`);
      } else {
        setCliRuntimeStatusMessage(`未返回 ${normalizedToolId} 的 inspect 数据`);
      }
    } catch (error) {
      console.error('Failed to inspect CLI runtime tool', error);
      setCliRuntimeStatusMessage(`Inspect 失败：${String(error)}`);
    } finally {
      setCliRuntimeInspectingToolId('');
    }
  }, []);

  const handleDiagnoseCliRuntimeCommand = useCallback(async () => {
    const command = String(cliRuntimeDiagnosticCommand || '').trim();
    if (!command) {
      setCliRuntimeStatusMessage('请先输入要诊断的 CLI 命令名，例如 lark-cli');
      return;
    }
    setCliRuntimeInspectingToolId(command);
    try {
      const result = await window.ipcRenderer.cliRuntime.diagnose({
        command,
        executionMode: cliRuntimeExecutionMode,
      });
      const normalized = normalizeCliRuntimeToolRecord((result as { tool?: unknown } | null)?.tool);
      if (normalized) {
        setCliRuntimeTools((prev) => {
          const next = prev.filter((item) => item.id !== normalized.id);
          next.unshift(normalized);
          return next.sort((left, right) => left.name.localeCompare(right.name));
        });
        const sandbox = (result as { sandbox?: { mode?: string; backend?: string; allowNetwork?: boolean } } | null)?.sandbox;
        const summary = String((result as { summary?: string } | null)?.summary || '').trim();
        setCliRuntimeStatusMessage(
          normalized.resolvedPath
            ? `${summary || `已解析 ${command}`} · ${sandbox?.backend || 'runtime'} · ${normalized.resolvedPath}`
            : summary || `未在当前 PATH 中解析到 ${command}`,
        );
      } else {
        setCliRuntimeStatusMessage(`未返回 ${command} 的诊断数据`);
      }
    } catch (error) {
      console.error('Failed to diagnose CLI runtime command', error);
      setCliRuntimeStatusMessage(`诊断失败：${String(error)}`);
    } finally {
      setCliRuntimeInspectingToolId('');
    }
  }, [cliRuntimeDiagnosticCommand, cliRuntimeExecutionMode]);

  const handleDiscoverCliRuntimeTools = useCallback(async () => {
    setCliRuntimeDiscovering(true);
    try {
      const result = await window.ipcRenderer.cliRuntime.discover({
        query: String(cliRuntimeDiscoverQuery || '').trim() || undefined,
        limit: 80,
      });
      const discoveredToolsRaw = Array.isArray((result as { tools?: unknown[] } | null)?.tools)
        ? (result as { tools?: unknown[] }).tools || []
        : Array.isArray(result)
          ? result
          : [];
      const normalizedTools = discoveredToolsRaw
        .map(normalizeCliRuntimeToolRecord)
        .filter((item): item is CliRuntimeToolRecord => Boolean(item))
        .sort((left, right) => left.name.localeCompare(right.name));
      setCliRuntimeDiscoverResults(normalizedTools);
      setCliRuntimeStatusMessage(
        normalizedTools.length > 0
          ? `已搜索 PATH，命中 ${normalizedTools.length} 个 CLI`
          : '当前 PATH 搜索没有命中结果',
      );
    } catch (error) {
      console.error('Failed to discover CLI runtime tools', error);
      setCliRuntimeStatusMessage(`PATH 搜索失败：${String(error)}`);
    } finally {
      setCliRuntimeDiscovering(false);
    }
  }, [cliRuntimeDiscoverQuery]);

  const handleCreateCliRuntimeEnvironment = useCallback(async (scope: CliRuntimeEnvironmentScope) => {
    setCliRuntimeCreatingEnvironment(scope);
    try {
      const workspaceRoot = scope === 'workspace-local'
        ? String(formData.workspace_dir || '').trim() || undefined
        : undefined;
      const result = await window.ipcRenderer.cliRuntime.createEnvironment({ scope, workspaceRoot });
      const normalized = normalizeCliRuntimeEnvironmentRecord(result);
      if (normalized) {
        setCliRuntimeEnvironments((prev) => {
          const next = prev.filter((item) => item.id !== normalized.id);
          next.unshift(normalized);
          return next.sort((left, right) => left.scope.localeCompare(right.scope) || left.id.localeCompare(right.id));
        });
        setCliRuntimeStatusMessage(`已创建环境 ${normalized.id}`);
      } else if ((result as { success?: boolean; error?: string } | null)?.success === false) {
        setCliRuntimeStatusMessage((result as { error?: string }).error || '创建 CLI environment 失败');
      } else {
        await loadCliRuntimeDashboard({ silent: true });
        setCliRuntimeStatusMessage(`已触发环境创建：${scope}`);
      }
    } catch (error) {
      console.error('Failed to create CLI runtime environment', error);
      setCliRuntimeStatusMessage(`创建环境失败：${String(error)}`);
    } finally {
      setCliRuntimeCreatingEnvironment('');
    }
  }, [formData.workspace_dir, loadCliRuntimeDashboard]);

  const handleInstallCliRuntimeTool = useCallback(async () => {
    const environmentId = String(cliRuntimeInstallDraft.environmentId || '').trim()
      || cliRuntimeEnvironments[0]?.id
      || '';
    const spec = String(cliRuntimeInstallDraft.spec || '').trim();
    const toolName = String(cliRuntimeInstallDraft.toolName || '').trim();
    if (!environmentId) {
      setCliRuntimeStatusMessage('请先选择一个 CLI environment');
      return;
    }
    if (!spec) {
      setCliRuntimeStatusMessage('请填写要安装的 spec，例如 ffmpeg-static 或 @scope/tool');
      return;
    }
    setCliRuntimeInstalling(true);
    try {
      const result = await window.ipcRenderer.cliRuntime.install({
        environmentId,
        installMethod: cliRuntimeInstallDraft.installMethod,
        spec,
        toolName: toolName || undefined,
        executionMode: cliRuntimeExecutionMode,
      });
      const installId = String((result as { installId?: string } | null)?.installId || '').trim();
      if (installId) {
        upsertCliRuntimeInstallQueueItem({
          installId,
          toolName: String((result as { toolName?: string } | null)?.toolName || toolName || spec),
          environmentId,
          installMethod: cliRuntimeInstallDraft.installMethod,
          spec,
          status: String((result as { status?: string } | null)?.status || 'queued'),
          summary: String((result as { summary?: string } | null)?.summary || ''),
          updatedAt: Date.now(),
        });
      }
      await loadCliRuntimeDashboard({ silent: true });
      setCliRuntimeStatusMessage(
        String((result as { summary?: string } | null)?.summary || `已触发安装：${toolName || spec}`),
      );
      setCliRuntimeInstallDraft((current) => ({
        ...current,
        toolName: '',
        spec: '',
        environmentId,
      }));
    } catch (error) {
      console.error('Failed to install CLI runtime tool', error);
      setCliRuntimeStatusMessage(`安装失败：${String(error)}`);
    } finally {
      setCliRuntimeInstalling(false);
    }
  }, [
    cliRuntimeEnvironments,
    cliRuntimeInstallDraft,
    loadCliRuntimeDashboard,
    upsertCliRuntimeInstallQueueItem,
  ]);

  const handleOpenCliRuntimeEnvironmentRoot = useCallback(async (rootPath: string) => {
    const normalizedPath = String(rootPath || '').trim();
    if (!normalizedPath) return;
    try {
      const result = await window.ipcRenderer.openPath(normalizedPath);
      if (!result?.success) {
        throw new Error(result?.error || '打开目录失败');
      }
    } catch (error) {
      console.error('Failed to open CLI runtime environment root', error);
      setCliRuntimeStatusMessage(`打开目录失败：${String(error)}`);
    }
  }, []);

  useEffect(() => subscribeRuntimeEventStream({
    eventTypes: [
      'runtime:cli-install-started',
      'runtime:cli-install-finished',
    ],
    onCliInstallStarted: ({
      installId,
      toolName,
      environmentId,
      installMethod,
      spec,
    }) => {
      const normalizedInstallId = String(installId || '').trim();
      if (!normalizedInstallId) return;
      upsertCliRuntimeInstallQueueItem({
        installId: normalizedInstallId,
        toolName,
        environmentId,
        installMethod,
        spec,
        status: 'running',
        summary: `正在安装 ${toolName}`,
        updatedAt: Date.now(),
      });
    },
    onCliInstallFinished: ({
      installId,
      toolName,
      environmentId,
      status,
      summary,
      raw,
    }) => {
      const normalizedInstallId = String(installId || '').trim();
      if (!normalizedInstallId) return;
      upsertCliRuntimeInstallQueueItem({
        installId: normalizedInstallId,
        toolName,
        environmentId,
        installMethod: typeof raw.installMethod === 'string' ? raw.installMethod : undefined,
        spec: typeof raw.spec === 'string' ? raw.spec : undefined,
        status,
        summary,
        updatedAt: Date.now(),
      });
      void loadCliRuntimeDashboard({ silent: true });
    },
  }), [loadCliRuntimeDashboard, upsertCliRuntimeInstallQueueItem]);

  const loadThrivePlugins = useCallback(async () => {
    setThrivePluginsLoading(true);
    try {
      const result = await window.ipcRenderer.plugins.list();
      setThrivePlugins(Array.isArray(result.plugins) ? result.plugins : []);
      setThrivePluginStatusMessage(result.success === false && result.error ? result.error : '');
    } catch (error) {
      console.error('Failed to load Thrive plugins', error);
      setThrivePluginStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setThrivePluginsLoading(false);
    }
  }, []);

  const loadThrivePluginMarketplace = useCallback(async () => {
    setThrivePluginMarketplaceLoading(true);
    try {
      const result = await window.ipcRenderer.plugins.marketplace();
      if (result.success === false) {
        throw new Error(result.error || '插件市场加载失败');
      }
      setThrivePluginMarketplace(Array.isArray(result.plugins) ? result.plugins : []);
      setThrivePluginStatusMessage('');
    } catch (error) {
      console.error('Failed to load Thrive plugin marketplace', error);
      setThrivePluginMarketplace([]);
      setThrivePluginStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setThrivePluginMarketplaceLoading(false);
    }
  }, []);

  const loadCodexPluginMarketplace = useCallback(async () => {
    setCodexPluginMarketplaceLoading(true);
    try {
      const result = await window.ipcRenderer.plugins.codexMarketplace();
      if (result.success === false) {
        throw new Error(result.error || 'Codex 插件市场加载失败');
      }
      setCodexPluginMarketplace(Array.isArray(result.plugins) ? result.plugins : []);
      setThrivePluginStatusMessage('');
    } catch (error) {
      console.error('Failed to load Codex plugin marketplace', error);
      setCodexPluginMarketplace([]);
      setThrivePluginStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCodexPluginMarketplaceLoading(false);
    }
  }, []);

  const handleInstallThriveMarketplacePlugin = useCallback(async (plugin: ThrivePluginMarketplaceItem) => {
    setThrivePluginBusyId(plugin.installedPluginId || plugin.id);
    setThrivePluginStatusMessage(`正在安装 ${plugin.displayName || plugin.name}`);
    try {
      const result = await window.ipcRenderer.plugins.installMarketplace({
        id: plugin.id,
        repo: plugin.repo,
        version: plugin.version || undefined,
        packageUrl: plugin.packageUrl || undefined,
      });
      if (result.success === false) {
        throw new Error(result.error || '插件安装失败');
      }
      setThrivePluginStatusMessage(result.plugin ? `已安装 ${result.plugin.displayName}` : '插件已安装');
      await Promise.all([
        loadThrivePlugins(),
        loadThrivePluginMarketplace(),
      ]);
    } catch (error) {
      console.error('Failed to install Thrive marketplace plugin', error);
      setThrivePluginStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setThrivePluginBusyId('');
    }
  }, [loadThrivePluginMarketplace, loadThrivePlugins]);

  const handleInstallCodexMarketplacePlugin = useCallback(async (plugin: CodexPluginMarketplaceItem) => {
    if (!plugin.sourceRoot && !plugin.remotePluginId) {
      setThrivePluginStatusMessage('Codex 插件缺少可安装来源');
      return;
    }
    setThrivePluginBusyId(plugin.installedPluginId || plugin.id);
    setThrivePluginStatusMessage(`正在安装 ${plugin.displayName || plugin.name}`);
    try {
      const result = plugin.sourceRoot
        ? await window.ipcRenderer.plugins.installCodex({
          path: plugin.sourceRoot,
          pluginName: plugin.name,
        })
        : await window.ipcRenderer.plugins.installCodex({
          remotePluginId: plugin.remotePluginId || undefined,
          remoteMarketplaceName: plugin.sourceLabel,
          pluginName: plugin.name,
        });
      if (result.success === false) {
        throw new Error(result.error || 'Codex 插件安装失败');
      }
      setThrivePluginStatusMessage(result.plugin ? `已安装 ${result.plugin.displayName}` : 'Codex 插件已安装');
      await Promise.all([
        loadThrivePlugins(),
        loadCodexPluginMarketplace(),
      ]);
    } catch (error) {
      console.error('Failed to install Codex marketplace plugin', error);
      setThrivePluginStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setThrivePluginBusyId('');
    }
  }, [loadCodexPluginMarketplace, loadThrivePlugins]);

  const handleInstallThrivePluginFromRepo = useCallback(async () => {
    const repo = thrivePluginRepoInput
      .trim()
      .replace(/^https:\/\/github\.com\//, '')
      .replace(/\/$/, '')
      .replace(/\.git$/, '');
    if (!repo) {
      setThrivePluginStatusMessage('请输入 GitHub 仓库，例如 owner/codex-plugin');
      return;
    }
    const id = repo.split('/').pop() || repo;
    setThrivePluginBusyId(`repo:${repo}`);
    setThrivePluginStatusMessage(`正在安装 ${repo}`);
    try {
      const result = await window.ipcRenderer.plugins.installMarketplace({ id, repo });
      if (result.success === false) {
        throw new Error(result.error || '插件安装失败');
      }
      setThrivePluginRepoInput('');
      setThrivePluginStatusMessage(result.plugin ? `已安装 ${result.plugin.displayName}` : '插件已安装');
      await Promise.all([
        loadThrivePlugins(),
        loadThrivePluginMarketplace(),
      ]);
    } catch (error) {
      console.error('Failed to install Thrive plugin from repo', error);
      setThrivePluginStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setThrivePluginBusyId('');
    }
  }, [loadThrivePluginMarketplace, loadThrivePlugins, thrivePluginRepoInput]);

  const handleToggleThrivePlugin = useCallback(async (plugin: ThrivePluginSummary) => {
    setThrivePluginBusyId(plugin.id);
    setThrivePluginStatusMessage(plugin.enabled ? `正在停用 ${plugin.displayName}` : `正在启用 ${plugin.displayName}`);
    try {
      const result = await window.ipcRenderer.plugins.setEnabled({
        pluginId: plugin.id,
        enabled: !plugin.enabled,
      });
      if (result.success === false) {
        throw new Error(result.error || '插件状态更新失败');
      }
      setThrivePluginStatusMessage(result.plugin ? `${result.plugin.displayName} 已${result.plugin.enabled ? '启用' : '停用'}` : '插件状态已更新');
      await loadThrivePlugins();
    } catch (error) {
      console.error('Failed to toggle Thrive plugin', error);
      setThrivePluginStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setThrivePluginBusyId('');
    }
  }, [loadThrivePlugins]);

  const handleUninstallThrivePlugin = useCallback(async (plugin: ThrivePluginSummary) => {
    const confirmed = await appConfirm(`卸载 ${APP_BRAND.displayName} 插件”${plugin.displayName}”？\n\n插件缓存会被删除，插件数据目录会保留。`);
    if (!confirmed) return;
    setThrivePluginBusyId(plugin.id);
    setThrivePluginStatusMessage(`正在卸载 ${plugin.displayName}`);
    try {
      const result = await window.ipcRenderer.plugins.uninstall({ pluginId: plugin.id });
      if (result.success === false) {
        throw new Error(result.error || '插件卸载失败');
      }
      setThrivePluginStatusMessage(`${plugin.displayName} 已卸载`);
      await loadThrivePlugins();
    } catch (error) {
      console.error('Failed to uninstall Thrive plugin', error);
      setThrivePluginStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setThrivePluginBusyId('');
    }
  }, [loadThrivePlugins]);

  const handleOpenThrivePluginDataDir = useCallback(async (pluginId?: string) => {
    try {
      const result = await window.ipcRenderer.plugins.openDataDir(pluginId ? { pluginId } : {});
      if (result.success === false) {
        throw new Error(result.error || '打开插件数据目录失败');
      }
      setThrivePluginStatusMessage(result.path ? `已打开 ${result.path}` : '已打开插件数据目录');
    } catch (error) {
      console.error('Failed to open Thrive plugin data dir', error);
      setThrivePluginStatusMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    if (!isActive || activeTab !== 'tools') return;
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer != null) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadCliRuntimeDashboard({ silent: true });
      }, 450);
    };
    const handleRuntimeEvent = (_event: unknown, envelope?: unknown) => {
      const record = envelope && typeof envelope === 'object' ? envelope as Record<string, unknown> : {};
      const eventType = String(record.eventType || '').trim();
      if (eventType.startsWith('runtime:cli-')) {
        scheduleRefresh();
      }
    };
    window.ipcRenderer.runtime.onEvent(handleRuntimeEvent as (...args: unknown[]) => void);
    return () => {
      window.ipcRenderer.runtime.offEvent(handleRuntimeEvent as (...args: unknown[]) => void);
      if (refreshTimer != null) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [activeTab, isActive, loadCliRuntimeDashboard]);

  const withTimeout = useCallback(<T,>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error(label));
      }, timeoutMs);
      task.then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      }).catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
    });
  }, []);

  const loadAssistantDaemonStatus = useCallback(async (options?: {
    timeoutMs?: number;
    suppressAlert?: boolean;
  }) => {
    try {
      const request = window.ipcRenderer.assistantDaemon.getStatus() as Promise<AssistantDaemonStatus>;
      const status = typeof options?.timeoutMs === 'number' && options.timeoutMs > 0
        ? await withTimeout(request, options.timeoutMs, '远程连接状态加载超时')
        : await request;
      setAssistantDaemonStatus(status);
      replaceAssistantDaemonDraft(assistantDaemonStatusToDraft(status));
    } catch (error) {
      console.error('Failed to load assistant daemon status', error);
      if (!options?.suppressAlert) {
        void appAlert(`加载远程连接状态失败：${String(error)}`);
      }
    }
  }, [replaceAssistantDaemonDraft, withTimeout]);

  const scheduleRemoteTabWarmup = useCallback(() => {
    if (remoteTabWarmTimerRef.current != null) {
      window.clearTimeout(remoteTabWarmTimerRef.current);
    }
    remoteTabWarmTimerRef.current = window.setTimeout(() => {
      remoteTabWarmTimerRef.current = null;
      void loadAssistantDaemonStatus({
        timeoutMs: 1500,
        suppressAlert: true,
      });
    }, 0);
  }, [loadAssistantDaemonStatus]);

  const buildAssistantDaemonPayload = useCallback(() => ({
    enabled: assistantDaemonDraft.enabled,
    autoStart: assistantDaemonDraft.autoStart,
    keepAliveWhenNoWindow: assistantDaemonDraft.keepAliveWhenNoWindow,
    host: String(assistantDaemonDraft.host || '').trim(),
    port: Number(assistantDaemonDraft.port || 0) || undefined,
    feishu: {
      enabled: assistantDaemonDraft.feishu.enabled,
      receiveMode: assistantDaemonDraft.feishu.receiveMode,
      endpointPath: String(assistantDaemonDraft.feishu.endpointPath || '').trim(),
      verificationToken: String(assistantDaemonDraft.feishu.verificationToken || '').trim() || undefined,
      encryptKey: String(assistantDaemonDraft.feishu.encryptKey || '').trim() || undefined,
      appId: String(assistantDaemonDraft.feishu.appId || '').trim() || undefined,
      appSecret: String(assistantDaemonDraft.feishu.appSecret || '').trim() || undefined,
      replyUsingChatId: assistantDaemonDraft.feishu.replyUsingChatId,
    },
    relay: {
      enabled: assistantDaemonDraft.relay.enabled,
      endpointPath: String(assistantDaemonDraft.relay.endpointPath || '').trim(),
      authToken: String(assistantDaemonDraft.relay.authToken || '').trim() || undefined,
    },
    acpGateway: {
      enabled: assistantDaemonDraft.acpGateway.enabled,
      requireToken: assistantDaemonDraft.acpGateway.requireToken,
      localOnly: assistantDaemonDraft.acpGateway.localOnly,
      endpointPath: String(assistantDaemonDraft.acpGateway.endpointPath || '').trim() || '/acp/v1',
      manifestPath: String(assistantDaemonDraft.acpGateway.manifestPath || '').trim() || '/acp/v1/manifest',
      guidePath: String(assistantDaemonDraft.acpGateway.guidePath || '').trim() || '/acp/v1/guide',
      defaultRuntimeMode: String(assistantDaemonDraft.acpGateway.defaultRuntimeMode || '').trim() || 'default',
      defaultClientLabel: String(assistantDaemonDraft.acpGateway.defaultClientLabel || '').trim() || 'External Agent',
    },
    weixin: {
      enabled: assistantDaemonDraft.weixin.enabled,
      endpointPath: String(assistantDaemonDraft.weixin.endpointPath || '').trim(),
      authToken: String(assistantDaemonDraft.weixin.authToken || '').trim() || undefined,
      accountId: String(assistantDaemonDraft.weixin.accountId || '').trim() || undefined,
      autoStartSidecar: assistantDaemonDraft.weixin.autoStartSidecar,
      cursorFile: String(assistantDaemonDraft.weixin.cursorFile || '').trim() || undefined,
      sidecarCommand: String(assistantDaemonDraft.weixin.sidecarCommand || '').trim() || undefined,
      sidecarArgs: String(assistantDaemonDraft.weixin.sidecarArgs || '').trim()
        ? String(assistantDaemonDraft.weixin.sidecarArgs || '').trim().split(/\s+/)
        : undefined,
      sidecarCwd: String(assistantDaemonDraft.weixin.sidecarCwd || '').trim() || undefined,
      sidecarEnv: parseEnvText(assistantDaemonDraft.weixin.sidecarEnvText || ''),
    },
  }), [assistantDaemonDraft]);

  const handleSaveAssistantDaemonConfig = useCallback(async () => {
    setAssistantDaemonBusy(true);
    try {
      const status = await window.ipcRenderer.assistantDaemon.setConfig(buildAssistantDaemonPayload()) as AssistantDaemonStatus;
      setAssistantDaemonStatus(status);
      replaceAssistantDaemonDraft(assistantDaemonStatusToDraft(status));
    } catch (error) {
      console.error('Failed to save assistant daemon config', error);
      void appAlert(`保存后台通信配置失败：${String(error)}`);
    } finally {
      setAssistantDaemonBusy(false);
    }
  }, [buildAssistantDaemonPayload, replaceAssistantDaemonDraft]);

  const handleCreateAssistantDaemonAcpClient = useCallback(async (name: string, kind: string) => {
    setAssistantDaemonBusy(true);
    try {
      const result = await window.ipcRenderer.assistantDaemon.createAcpClient({
        name: String(name || '').trim() || 'External Agent',
        kind: String(kind || '').trim() || 'generic_agent',
      });
      const status = result?.status as AssistantDaemonStatus | undefined;
      if (status) {
        setAssistantDaemonStatus(status);
        replaceAssistantDaemonDraft(assistantDaemonStatusToDraft(status));
      } else {
        await loadAssistantDaemonStatus({ suppressAlert: true });
      }
      setAssistantDaemonAcpToken(String(result?.token || ''));
    } catch (error) {
      console.error('Failed to create ACP client', error);
      void appAlert(`创建 ACP 客户端失败：${String(error)}`);
    } finally {
      setAssistantDaemonBusy(false);
    }
  }, [loadAssistantDaemonStatus, replaceAssistantDaemonDraft]);

  const handleRevokeAssistantDaemonAcpClient = useCallback(async (clientId: string) => {
    const safeClientId = String(clientId || '').trim();
    if (!safeClientId) return;
    setAssistantDaemonBusy(true);
    try {
      const result = await window.ipcRenderer.assistantDaemon.revokeAcpClient({ clientId: safeClientId });
      const status = result?.status as AssistantDaemonStatus | undefined;
      if (status) {
        setAssistantDaemonStatus(status);
        replaceAssistantDaemonDraft(assistantDaemonStatusToDraft(status));
      } else {
        await loadAssistantDaemonStatus({ suppressAlert: true });
      }
    } catch (error) {
      console.error('Failed to revoke ACP client', error);
      void appAlert(`撤销 ACP 客户端失败：${String(error)}`);
    } finally {
      setAssistantDaemonBusy(false);
    }
  }, [loadAssistantDaemonStatus, replaceAssistantDaemonDraft]);

  const handleStartAssistantDaemon = useCallback(async () => {
    setAssistantDaemonBusy(true);
    try {
      const status = await window.ipcRenderer.assistantDaemon.start(buildAssistantDaemonPayload()) as AssistantDaemonStatus;
      setAssistantDaemonStatus(status);
      replaceAssistantDaemonDraft(assistantDaemonStatusToDraft(status));
    } catch (error) {
      console.error('Failed to start assistant daemon', error);
      void appAlert(`启动后台值守失败：${String(error)}`);
    } finally {
      setAssistantDaemonBusy(false);
    }
  }, [buildAssistantDaemonPayload, replaceAssistantDaemonDraft]);

  const handleStopAssistantDaemon = useCallback(async () => {
    setAssistantDaemonBusy(true);
    try {
      const status = await window.ipcRenderer.assistantDaemon.stop() as AssistantDaemonStatus;
      setAssistantDaemonStatus(status);
      replaceAssistantDaemonDraft(assistantDaemonStatusToDraft(status));
    } catch (error) {
      console.error('Failed to stop assistant daemon', error);
      void appAlert(`停止后台值守失败：${String(error)}`);
    } finally {
      setAssistantDaemonBusy(false);
    }
  }, [replaceAssistantDaemonDraft]);

  const handleStartAssistantDaemonWeixinLogin = useCallback(async () => {
    setAssistantDaemonWeixinLoginBusy(true);
    try {
      const result = await window.ipcRenderer.assistantDaemon.startWeixinLogin({
        accountId: String(assistantDaemonDraft.weixin.accountId || '').trim() || undefined,
        force: true,
      });
      const qrcodeImageUrl = await buildWeixinQrImageUrl(result.qrcodeUrl);
      if (!result.success || !result.qrcodeUrl) {
        setAssistantDaemonWeixinLogin({
          sessionKey: result.sessionKey,
          qrcodeUrl: result.qrcodeUrl,
          qrcodeImageUrl,
          message: result.message,
          connected: false,
          stateDir: result.stateDir,
        });
        void appAlert(result.message || '启动微信扫码失败。');
        return;
      }
      setAssistantDaemonWeixinLogin({
        sessionKey: result.sessionKey,
        qrcodeUrl: result.qrcodeUrl,
        qrcodeImageUrl,
        message: result.message,
        connected: false,
        stateDir: result.stateDir,
      });
    } catch (error) {
      console.error('Failed to start Weixin login', error);
      void appAlert(`启动微信扫码失败：${String(error)}`);
    } finally {
      setAssistantDaemonWeixinLoginBusy(false);
    }
  }, [assistantDaemonDraft.weixin.accountId, buildWeixinQrImageUrl]);

  const handleCheckAssistantDaemonWeixinLogin = useCallback(async () => {
    const sessionKey = String(assistantDaemonWeixinLogin?.sessionKey || '').trim();
    if (!sessionKey) {
      void appAlert('请先点击“开始扫码”，生成微信二维码。');
      return;
    }
    setAssistantDaemonWeixinLoginBusy(true);
    try {
      const result = await window.ipcRenderer.assistantDaemon.waitForWeixinLogin({
        sessionKey,
        timeoutMs: 1500,
      });
      setAssistantDaemonWeixinLogin((prev) => ({
        sessionKey,
        qrcodeUrl: prev?.qrcodeUrl,
        qrcodeImageUrl: prev?.qrcodeImageUrl,
        stateDir: prev?.stateDir,
        message: result.message,
        connected: result.connected,
        accountId: result.accountId,
        userId: result.userId,
      }));
      if (result.connected) {
        setAssistantDaemonDraft((prev) => ({
          ...prev,
          weixin: {
            ...prev.weixin,
            enabled: true,
            autoStartSidecar: true,
            accountId: result.accountId || prev.weixin.accountId,
          },
        }));
        await loadAssistantDaemonStatus();
      }
    } catch (error) {
      console.error('Failed to wait for Weixin login', error);
      void appAlert(`检查微信登录状态失败：${String(error)}`);
    } finally {
      setAssistantDaemonWeixinLoginBusy(false);
    }
  }, [assistantDaemonWeixinLogin?.sessionKey, loadAssistantDaemonStatus, setAssistantDaemonDraft]);

  const handleClearAssistantDaemonWeixinLogin = useCallback(() => {
    setAssistantDaemonWeixinLogin(null);
  }, []);

  const ensureBaseSettingsLoaded = useCallback(async (force = false) => {
    if (baseSettingsInFlightRef.current) return;
    if (!force && baseSettingsLoadedRef.current) return;
    baseSettingsInFlightRef.current = true;
    try {
      await Promise.all([
        loadSettings({
          preserveViewState: true,
          preserveRemoteModels: true,
        }),
        loadSpaceContext(),
      ]);
      baseSettingsLoadedRef.current = true;
      setBaseSettingsLoadedRevision((prev) => prev + 1);
      tabWarmRef.current.ai = true;
    } finally {
      baseSettingsInFlightRef.current = false;
    }
  }, [loadSettings, loadSpaceContext]);

  const loadTeamAdvisors = useCallback(async () => {
    setIsTeamAdvisorsLoading(true);
    try {
      const list = await window.ipcRenderer.advisors.list<Advisor>();
      const sorted = sortTeamAdvisors(Array.isArray(list) ? list : []);
      setTeamAdvisors(sorted);
      teamAdvisorOrderRef.current = sorted;
      return sorted;
    } catch (error) {
      console.error('Failed to load team advisors:', error);
      setTestMsg('成员列表读取失败');
      setStatus('error');
      return [];
    } finally {
      setIsTeamAdvisorsLoading(false);
    }
  }, []);

  const loadSettingsSkills = useCallback(async () => {
    setIsSettingsSkillsLoading(true);
    try {
      const list = await window.ipcRenderer.listSkills();
      const normalized = (Array.isArray(list) ? list : [])
        .map((skill) => ({
          name: String(skill.name || '').trim(),
          description: String(skill.description || '').trim(),
          location: String(skill.location || '').trim(),
          sourceScope: skill.sourceScope,
          isBuiltin: Boolean(skill.isBuiltin || skill.sourceScope === 'builtin'),
          disabled: Boolean(skill.disabled),
        }))
        .filter((skill) => skill.name);
      normalized.sort((left, right) => {
        const leftBuiltIn = left.isBuiltin ? 0 : 1;
        const rightBuiltIn = right.isBuiltin ? 0 : 1;
        return leftBuiltIn - rightBuiltIn || left.name.localeCompare(right.name);
      });
      setSettingsSkills(normalized);
      return normalized;
    } catch (error) {
      console.error('Failed to load skills:', error);
      setSettingsSkillStatusMessage('技能列表读取失败');
      return [];
    } finally {
      setIsSettingsSkillsLoading(false);
    }
  }, []);

  const handleToggleSettingsSkill = useCallback(async (skill: SettingsSkill) => {
    if (skill.isBuiltin) return;
    const nextDisabled = !skill.disabled;
    setSettingsSkillBusyName(skill.name);
    setSettingsSkillStatusMessage('');
    setSettingsSkills((prev) => prev.map((item) => (
      item.name === skill.name ? { ...item, disabled: nextDisabled } : item
    )));
    try {
      const action = nextDisabled ? window.ipcRenderer.skills.disable : window.ipcRenderer.skills.enable;
      const result = await action({ name: skill.name }) as { success?: boolean; error?: string };
      if (result && result.success === false) {
        throw new Error(result.error || '技能状态保存失败');
      }
      setSettingsSkillStatusMessage(nextDisabled ? `已关闭 ${skill.name}` : `已打开 ${skill.name}`);
      await loadSettingsSkills();
      tabWarmRef.current.skills = true;
    } catch (error) {
      console.error('Failed to update skill state:', error);
      setSettingsSkills((prev) => prev.map((item) => (
        item.name === skill.name ? { ...item, disabled: skill.disabled } : item
      )));
      setSettingsSkillStatusMessage(error instanceof Error ? error.message : '技能状态保存失败');
    } finally {
      setSettingsSkillBusyName('');
    }
  }, [loadSettingsSkills]);

  const loadSkillMarketplace = useCallback(async () => {
    setIsSkillMarketplaceLoading(true);
    try {
      const result = await window.ipcRenderer.skills.marketplace();
      if (result.success === false) {
        throw new Error(result.error || '技能市场加载失败');
      }
      setSkillMarketplaceItems(Array.isArray(result.skills) ? result.skills : []);
      setSettingsSkillStatusMessage('');
    } catch (error) {
      console.error('Failed to load skill marketplace:', error);
      setSkillMarketplaceItems([]);
      setSettingsSkillStatusMessage(error instanceof Error ? error.message : '技能市场加载失败');
    } finally {
      setIsSkillMarketplaceLoading(false);
    }
  }, []);

  const openSkillMarketplace = useCallback(() => {
    setIsSkillMarketplaceOpen(true);
    void loadSkillMarketplace();
  }, [loadSkillMarketplace]);

  const handleUninstallSettingsSkill = useCallback(async (skill: SettingsSkill) => {
    if (skill.isBuiltin) return;
    const confirmed = await appConfirm(`删除技能“${skill.name}”？`, {
      title: '删除技能',
      confirmLabel: '删除',
      tone: 'danger',
    });
    if (!confirmed) return;
    setSettingsSkillBusyName(skill.name);
    setSettingsSkillStatusMessage('');
    try {
      const result = await window.ipcRenderer.skills.uninstall({ name: skill.name }) as { success?: boolean; error?: string };
      if (result && result.success === false) {
        throw new Error(result.error || '技能删除失败');
      }
      setSettingsSkillStatusMessage(`已删除 ${skill.name}`);
      await loadSettingsSkills();
      if (isSkillMarketplaceOpen) {
        await loadSkillMarketplace();
      }
      tabWarmRef.current.skills = true;
    } catch (error) {
      console.error('Failed to uninstall skill:', error);
      setSettingsSkillStatusMessage(error instanceof Error ? error.message : '技能删除失败');
    } finally {
      setSettingsSkillBusyName('');
    }
  }, [isSkillMarketplaceOpen, loadSettingsSkills, loadSkillMarketplace]);

  const handleInstallMarketplaceSkill = useCallback(async (skill: ThriveSkillMarketplaceItem) => {
    setSkillMarketplaceBusyId(skill.id);
    setSettingsSkillStatusMessage(`正在安装 ${skill.name}`);
    try {
      const result = await window.ipcRenderer.skills.marketInstall({
        id: skill.id,
        repo: skill.repo,
      }) as {
        success?: boolean;
        error?: string;
        installed?: Array<{ name?: string }>;
      };
      if (result.success === false) {
        throw new Error(result.error || '技能安装失败');
      }
      const installedName = result.installed?.[0]?.name || skill.name;
      setSettingsSkillStatusMessage(`已安装 ${installedName}`);
      await Promise.all([
        loadSettingsSkills(),
        loadSkillMarketplace(),
      ]);
      tabWarmRef.current.skills = true;
    } catch (error) {
      console.error('Failed to install marketplace skill:', error);
      setSettingsSkillStatusMessage(error instanceof Error ? error.message : '技能安装失败');
    } finally {
      setSkillMarketplaceBusyId('');
    }
  }, [loadSettingsSkills, loadSkillMarketplace]);

  const persistTeamAdvisorOrder = useCallback(async (items: Advisor[]) => {
    await Promise.all(items.map((advisor, index) => (
      window.ipcRenderer.advisors.update({
        id: advisor.id,
        gardenflowOrder: index,
        gardenflowVisible: advisor.gardenflowVisible !== false,
      })
    )));
    teamAdvisorOrderRef.current = items;
    window.dispatchEvent(new Event('gardenflow:team-settings-changed'));
  }, []);

  const handleToggleTeamAdvisorVisible = useCallback((advisor: Advisor) => {
    const nextVisible = advisor.gardenflowVisible === false;
    setTeamAdvisorBusyId(advisor.id);
    setTeamAdvisors((prev) => prev.map((item) => (
      item.id === advisor.id ? { ...item, gardenflowVisible: nextVisible } : item
    )));
    void window.ipcRenderer.advisors.update({
      id: advisor.id,
      gardenflowVisible: nextVisible,
    }).then(() => {
      window.dispatchEvent(new Event('gardenflow:team-settings-changed'));
    }).catch((error) => {
      console.error('Failed to update advisor visibility:', error);
      setTeamAdvisors((prev) => prev.map((item) => (
        item.id === advisor.id ? { ...item, gardenflowVisible: advisor.gardenflowVisible } : item
      )));
      setTestMsg('成员展示设置保存失败');
      setStatus('error');
    }).finally(() => {
      setTeamAdvisorBusyId(null);
    });
  }, []);

  const handleTeamAdvisorDragStart = useCallback((advisorId: string) => {
    teamAdvisorDragIdRef.current = advisorId;
    setDraggingTeamAdvisorId(advisorId);
  }, []);

  const handleTeamAdvisorDragOver = useCallback((targetAdvisorId: string) => {
    setTeamAdvisors((prev) => {
      const draggingId = teamAdvisorDragIdRef.current;
      if (!draggingId || draggingId === targetAdvisorId) return prev;
      const fromIndex = prev.findIndex((item) => item.id === draggingId);
      const toIndex = prev.findIndex((item) => item.id === targetAdvisorId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const ordered = next.map((item, index) => ({ ...item, gardenflowOrder: index }));
      teamAdvisorOrderRef.current = ordered;
      return ordered;
    });
  }, []);

  const handleTeamAdvisorDragEnd = useCallback(() => {
    if (!teamAdvisorDragIdRef.current) return;
    teamAdvisorDragIdRef.current = null;
    setDraggingTeamAdvisorId(null);
    void persistTeamAdvisorOrder(teamAdvisorOrderRef.current).catch((error) => {
      console.error('Failed to persist advisor order:', error);
      setTestMsg('成员排序保存失败');
      setStatus('error');
      void loadTeamAdvisors();
    });
  }, [loadTeamAdvisors, persistTeamAdvisorOrder]);

  const refreshTeamAdvisor = useCallback(async (advisorId: string) => {
    const list = await loadTeamAdvisors();
    const updated = list.find((item) => item.id === advisorId) || null;
    if (updated) {
      setSettingsTeamAdvisor(updated);
      setEditingTeamAdvisor((prev) => prev?.id === advisorId ? updated : prev);
    }
    return updated;
  }, [loadTeamAdvisors]);

  const handleOpenTeamAdvisorSettings = useCallback((advisor: Advisor) => {
    setSettingsTeamAdvisor(advisor);
    setIsTeamSystemPromptExpanded(false);
  }, []);

  const handleCreateTeamAdvisor = useCallback(() => {
    setEditingTeamAdvisor(null);
    setIsCreatingTeamAdvisor(true);
  }, []);

  const handleDeleteTeamAdvisor = useCallback(async (advisor: Advisor) => {
    if (!(await appConfirm('确定要删除这个智囊团成员吗？', { title: '删除成员', confirmLabel: '删除', tone: 'danger' }))) return;
    try {
      await window.ipcRenderer.advisors.delete(advisor.id);
      setSettingsTeamAdvisor(null);
      setEditingTeamAdvisor(null);
      await loadTeamAdvisors();
      window.dispatchEvent(new Event('gardenflow:team-settings-changed'));
    } catch (error) {
      console.error('Failed to delete advisor:', error);
      setTestMsg('成员删除失败');
      setStatus('error');
    }
  }, [loadTeamAdvisors]);

  const handleUploadTeamAdvisorKnowledge = useCallback(async (advisor: Advisor) => {
    try {
      await window.ipcRenderer.advisors.uploadKnowledge(advisor.id);
      await refreshTeamAdvisor(advisor.id);
    } catch (error) {
      console.error('Failed to upload advisor knowledge:', error);
      setTestMsg('知识库上传失败');
      setStatus('error');
    }
  }, [refreshTeamAdvisor]);

  const handleDeleteTeamAdvisorKnowledge = useCallback(async (advisor: Advisor, fileName: string) => {
    if (!(await appConfirm(`确定要删除知识库文件 "${fileName}" 吗？`, { title: '删除知识文件', confirmLabel: '删除', tone: 'danger' }))) return;
    try {
      await window.ipcRenderer.advisors.deleteKnowledge({ advisorId: advisor.id, fileName });
      await refreshTeamAdvisor(advisor.id);
    } catch (error) {
      console.error('Failed to delete advisor knowledge:', error);
      setTestMsg('知识文件删除失败');
      setStatus('error');
    }
  }, [refreshTeamAdvisor]);

  const handleOptimizeTeamAdvisorPrompt = useCallback(async (advisor: Advisor) => {
    setIsTeamOptimizingPrompt(true);
    try {
      const result = await window.ipcRenderer.advisors.optimizePromptDeep({
        advisorId: advisor.id,
        name: advisor.name,
        personality: advisor.personality,
        currentPrompt: advisor.systemPrompt,
      }) as { success: boolean; prompt?: string; error?: string };
      if (!result.success || !result.prompt) {
        throw new Error(result.error || '优化失败');
      }
      await window.ipcRenderer.advisors.update({
        ...advisor,
        systemPrompt: result.prompt,
      });
      await refreshTeamAdvisor(advisor.id);
    } catch (error) {
      console.error('Failed to optimize advisor prompt:', error);
      void appAlert(`优化失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsTeamOptimizingPrompt(false);
    }
  }, [refreshTeamAdvisor]);

  const handlePromoteTeamMemberSkillCandidate = useCallback(async (advisor: Advisor) => {
    try {
      await window.ipcRenderer.advisors.promoteMemberSkillCandidate({
        advisorId: advisor.id,
        candidateVersion: advisor.memberSkillCandidateVersion,
      });
      await refreshTeamAdvisor(advisor.id);
    } catch (error) {
      console.error('Failed to promote member skill candidate:', error);
      setTestMsg('成员技能候选发布失败');
      setStatus('error');
    }
  }, [refreshTeamAdvisor]);

  const handleDiscardTeamMemberSkillCandidate = useCallback(async (advisor: Advisor) => {
    try {
      await window.ipcRenderer.advisors.discardMemberSkillCandidate({ advisorId: advisor.id });
      await refreshTeamAdvisor(advisor.id);
    } catch (error) {
      console.error('Failed to discard member skill candidate:', error);
      setTestMsg('成员技能候选丢弃失败');
      setStatus('error');
    }
  }, [refreshTeamAdvisor]);

  const handleRefreshTeamMemberSkill = useCallback(async (advisor: Advisor) => {
    try {
      const result = await window.ipcRenderer.advisors.distillMemberSkill({ advisorId: advisor.id }) as { success?: boolean; error?: string };
      if (result && result.success === false) {
        throw new Error(result.error || '成员技能蒸馏失败');
      }
      await refreshTeamAdvisor(advisor.id);
    } catch (error) {
      console.error('Failed to refresh member skill:', error);
      void appAlert(`成员技能蒸馏失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [refreshTeamAdvisor]);

  const handleRollbackTeamMemberSkillVersion = useCallback(async (advisor: Advisor, version: string) => {
    if (!version) return;
    if (!(await appConfirm(`确定要把 ${advisor.name} 回滚到成员技能版本 "${version}" 吗？`, {
      title: '回滚成员技能',
      confirmLabel: '回滚',
      tone: 'danger',
    }))) return;
    try {
      await window.ipcRenderer.advisors.rollbackMemberSkillVersion({ advisorId: advisor.id, version });
      await refreshTeamAdvisor(advisor.id);
    } catch (error) {
      console.error('Failed to rollback member skill version:', error);
      setTestMsg('成员技能回滚失败');
      setStatus('error');
    }
  }, [refreshTeamAdvisor]);

  const handleSaveTeamAdvisor = useCallback(async (
    data: Omit<Advisor, 'id' | 'createdAt' | 'knowledgeFiles'>,
    youtubeParams?: { url: string; count: number; channelId?: string },
    knowledgeFilePaths?: string[],
  ) => {
    let advisorId = editingTeamAdvisor?.id;
    if (editingTeamAdvisor) {
      await window.ipcRenderer.advisors.update({
        ...data,
        id: editingTeamAdvisor.id,
        gardenflowVisible: editingTeamAdvisor.gardenflowVisible !== false,
        gardenflowOrder: editingTeamAdvisor.gardenflowOrder,
      });
    } else {
      const createData: Record<string, unknown> = { ...data };
      if (youtubeParams?.url) {
        createData.youtubeChannel = {
          url: youtubeParams.url,
          channelId: youtubeParams.channelId || '',
        };
      }
      const result = await window.ipcRenderer.advisors.create(createData) as { success?: boolean; id?: string; error?: string };
      if (result?.success === false) {
        throw new Error(result.error || '创建成员失败');
      }
      advisorId = result?.id;
      if (advisorId && Array.isArray(knowledgeFilePaths) && knowledgeFilePaths.length > 0) {
        await window.ipcRenderer.advisors.uploadKnowledge({
          advisorId,
          filePaths: knowledgeFilePaths,
        });
      }
    }
    setEditingTeamAdvisor(null);
    setIsCreatingTeamAdvisor(false);
    await loadTeamAdvisors();
    if (advisorId) {
      await refreshTeamAdvisor(advisorId);
    }
    window.dispatchEvent(new Event('gardenflow:team-settings-changed'));
  }, [editingTeamAdvisor, loadTeamAdvisors, refreshTeamAdvisor]);

  const ensureTabResourcesLoaded = useCallback(async (tab: SettingsTab, force = false) => {
    if (!isActive) return;
    if (tabInFlightRef.current[tab]) return;
    if (!force && tabWarmRef.current[tab]) return;
    tabInFlightRef.current[tab] = true;
    try {
      if (tab === 'general') {
        await Promise.all([
          loadAppVersion(),
          loadRecentDebugLogs(),
          loadFileIndexDashboard({ force }),
          loadLoggingStatus(),
          loadPendingDiagnosticReports(),
        ]);
      } else if (tab === 'profile') {
        await loadGardenFlowProfileBundle({
          preserveDraft: true,
        });
      } else if (tab === 'team') {
        await loadTeamAdvisors();
      } else if (tab === 'skills') {
        await loadSettingsSkills();
      } else if (tab === 'mcp') {
        await loadMcpRuntimeData();
      } else if (tab === 'tools') {
        await Promise.all([
          loadCliRuntimeDashboard({ silent: true }),
          loadThrivePlugins(),
        ]);
        if (formData.developer_mode_enabled) {
          await Promise.all([
            loadToolDiagnostics(),
            loadRuntimeRoles(),
          ]);
        }
      } else if (tab === 'ai' && officialAiPanelEnabled && !OfficialAiPanelComponent) {
        const module = await loadOfficialAiPanelModule();
        const nextComponent = module?.default || null;
        setOfficialAiPanelComponent(() => nextComponent);
      }
      tabWarmRef.current[tab] = true;
    } finally {
      tabInFlightRef.current[tab] = false;
    }
  }, [
    OfficialAiPanelComponent,
    formData.developer_mode_enabled,
    isActive,
    loadGardenFlowProfileBundle,
    loadCliRuntimeDashboard,
    loadAppVersion,
    loadBackgroundTasks,
    loadBackgroundWorkerPool,
    loadThrivePlugins,
    loadFileIndexDashboard,
    loadLoggingStatus,
    loadMcpRuntimeData,
    loadPendingDiagnosticReports,
    loadRecentDebugLogs,
    loadSettingsSkills,
    loadTeamAdvisors,
    loadRuntimeHooks,
    loadRuntimeRoles,
    loadRuntimeSessions,
    loadRuntimeTasks,
    loadToolDiagnostics,
    officialAiPanelEnabled,
  ]);

  useEffect(() => {
    if (settingsActivationTimerRef.current != null) {
      window.clearTimeout(settingsActivationTimerRef.current);
    }

    settingsActivationTimerRef.current = window.setTimeout(() => {
      void ensureBaseSettingsLoaded();
      settingsActivationTimerRef.current = null;
    }, SETTINGS_ACTIVATION_DEBOUNCE_MS);

    return () => {
      if (settingsActivationTimerRef.current != null) {
        window.clearTimeout(settingsActivationTimerRef.current);
        settingsActivationTimerRef.current = null;
      }
    };
  }, [ensureBaseSettingsLoaded]);

  useEffect(() => {
    if (!isActive) return;
    const handleSettingsUpdated = () => {
      // Preserve local edits on form-driven tabs; otherwise external auth sync can
      // reload persisted settings and wipe unsaved AI source/model changes.
      const preserveLocalFormState = activeTab === 'general' || activeTab === 'ai' || activeTab === 'platforms' || activeTab === 'experimental';
      if (!preserveLocalFormState) {
        void ensureBaseSettingsLoaded(true);
      }
      tabWarmRef.current.profile = false;
      if (activeTab === 'remote') {
        scheduleRemoteTabWarmup();
      }
      if (activeTab === 'profile' && !gardenflowProfileDirtyRef.current) {
        void ensureTabResourcesLoaded('profile', true);
      }
      if (activeTab === 'general' || activeTab === 'tools' || activeTab === 'skills' || activeTab === 'mcp') {
        tabWarmRef.current[activeTab] = false;
        void ensureTabResourcesLoaded(activeTab, true);
      }
    };
    return subscribeSettingsUpdated(handleSettingsUpdated);
  }, [activeTab, ensureBaseSettingsLoaded, ensureTabResourcesLoaded, isActive, scheduleRemoteTabWarmup]);

  useEffect(() => {
    if (!isActive) return;
    const handleSpaceChanged = (payload?: { spaceId?: string; activeSpaceId?: string; changeType?: string }) => {
      const previousSpaceId = currentSpaceIdRef.current;
      const nextSpaceId = setCurrentSpaceState(payload?.activeSpaceId || payload?.spaceId);
      void loadSpaceContext();
      if (payload?.changeType === 'rename' && nextSpaceId === previousSpaceId) {
        return;
      }
      tabWarmRef.current.profile = false;
      resetGardenFlowProfileState();
      clearCachedFileIndexDashboard();
      fileIndexDashboardCurrentRef.current = null;
      fileIndexDashboardLoadedAtRef.current = 0;
      setFileIndexDashboard(null);
      tabWarmRef.current.general = false;
      if (activeTab === 'profile') {
        void loadGardenFlowProfileBundle({ expectedSpaceId: nextSpaceId });
      }
      if (activeTab === 'general') {
        void loadFileIndexDashboard({ force: true });
      }
    };
    window.ipcRenderer.spaces.onChanged(handleSpaceChanged);
    return () => {
      window.ipcRenderer.spaces.offChanged(handleSpaceChanged);
    };
  }, [activeTab, isActive, loadFileIndexDashboard, loadGardenFlowProfileBundle, loadSpaceContext, resetGardenFlowProfileState, setCurrentSpaceState]);

  useEffect(() => {
    if (!gardenflowOnboardingVersion) return;
    void loadGardenFlowProfileBundle({ expectedSpaceId: currentSpaceIdRef.current });
  }, [loadGardenFlowProfileBundle, gardenflowOnboardingVersion]);

  useEffect(() => {
    if (!isActive || activeTab !== 'general') return;
    const scheduleFileIndexRefresh = () => {
      if (fileIndexDashboardRefreshTimerRef.current != null) {
        window.clearTimeout(fileIndexDashboardRefreshTimerRef.current);
      }
      fileIndexDashboardRefreshTimerRef.current = window.setTimeout(() => {
        fileIndexDashboardRefreshTimerRef.current = null;
        void loadFileIndexDashboard({ force: true, background: true });
      }, 750);
    };
    window.ipcRenderer.knowledge.onFileIndexUpdated(scheduleFileIndexRefresh);
    window.ipcRenderer.knowledge.onCatalogUpdated(scheduleFileIndexRefresh);
    return () => {
      window.ipcRenderer.knowledge.offFileIndexUpdated(scheduleFileIndexRefresh);
      window.ipcRenderer.knowledge.offCatalogUpdated(scheduleFileIndexRefresh);
      if (fileIndexDashboardRefreshTimerRef.current != null) {
        window.clearTimeout(fileIndexDashboardRefreshTimerRef.current);
        fileIndexDashboardRefreshTimerRef.current = null;
      }
    };
  }, [activeTab, isActive, loadFileIndexDashboard]);

  useEffect(() => {
    const handleDiagnosticsReportPending = () => {
      void Promise.all([
        loadLoggingStatus(),
        loadPendingDiagnosticReports(),
      ]);
    };
    const handleFeedbackReportSubmitted = () => {
      void Promise.all([
        loadLoggingStatus(),
        loadPendingDiagnosticReports(),
      ]);
    };
    window.ipcRenderer.logs.onReportPending(handleDiagnosticsReportPending);
    window.addEventListener('gardenflow:feedback-report-submitted', handleFeedbackReportSubmitted);
    return () => {
      window.ipcRenderer.logs.offReportPending(handleDiagnosticsReportPending);
      window.removeEventListener('gardenflow:feedback-report-submitted', handleFeedbackReportSubmitted);
    };
  }, [loadLoggingStatus, loadPendingDiagnosticReports]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    if (!baseSettingsLoadedRef.current) {
      return;
    }
    let runtimePollTimer: number | null = null;
    let backgroundTaskPollTimer: number | null = null;
    let fileIndexPollTimer: number | null = null;
    if (activeTab === 'remote') {
      scheduleRemoteTabWarmup();
    }
    if (activeTab === 'general') {
      void ensureTabResourcesLoaded('general');
      fileIndexPollTimer = window.setInterval(() => {
        void loadFileIndexDashboard({ force: true, background: true });
      }, FILE_INDEX_DASHBOARD_POLL_MS);
    }
    if (activeTab === 'profile') {
      void ensureTabResourcesLoaded('profile');
    }
    if (activeTab === 'team') {
      void ensureTabResourcesLoaded('team');
    }
    if (activeTab === 'skills') {
      void ensureTabResourcesLoaded('skills');
    }
    if (activeTab === 'mcp') {
      void ensureTabResourcesLoaded('mcp');
    }
    if (activeTab === 'tools') {
      void ensureTabResourcesLoaded('tools');
      if (
        formData.developer_mode_enabled
        && (runtimeTasks.length > 0 || runtimeSessions.length > 0)
      ) {
        runtimePollTimer = window.setInterval(() => {
          void Promise.all([
            loadRuntimeTasks(),
            loadRuntimeSessions(),
          ]);
        }, Math.max(8000, SETTINGS_TAB_POLL_DELAY_MS));
      }
      if (
        formData.developer_mode_enabled
        && backgroundTasks.length > 0
      ) {
        backgroundTaskPollTimer = window.setInterval(() => {
          void Promise.all([
            loadBackgroundTasks(),
            loadBackgroundWorkerPool(),
          ]);
        }, Math.max(5000, SETTINGS_TAB_POLL_DELAY_MS));
      }
    }

    return () => {
      if (runtimePollTimer) {
        window.clearInterval(runtimePollTimer);
      }
      if (backgroundTaskPollTimer) {
        window.clearInterval(backgroundTaskPollTimer);
      }
      if (fileIndexPollTimer) {
        window.clearInterval(fileIndexPollTimer);
      }
      if (remoteTabWarmTimerRef.current != null) {
        window.clearTimeout(remoteTabWarmTimerRef.current);
        remoteTabWarmTimerRef.current = null;
      }
    };
  }, [
    activeTab,
    backgroundTasks.length,
    baseSettingsLoadedRevision,
    ensureTabResourcesLoaded,
    formData.developer_mode_enabled,
    isActive,
    loadBackgroundTasks,
    loadBackgroundWorkerPool,
    loadFileIndexDashboard,
    loadRuntimeSessions,
    loadRuntimeTasks,
    runtimeSessions.length,
    runtimeTasks.length,
    scheduleRemoteTabWarmup,
  ]);

  const handlePickWorkspaceDir = useCallback(async () => {
    try {
      const result = await window.ipcRenderer.pickWorkspaceDir();
      if (!result?.success || !String(result.path || '').trim()) {
        if (!result?.canceled && result?.error) {
          void appAlert(`选择工作区目录失败：${String(result.error)}`);
        }
        return;
      }
      setFormData((prev) => ({
        ...prev,
        workspace_dir: String(result.path || '').trim(),
      }));
    } catch (error) {
      console.error('Failed to pick workspace dir', error);
      void appAlert(`选择工作区目录失败：${String(error)}`);
    }
  }, []);

  const handleResetWorkspaceDir = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      workspace_dir: '',
    }));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (aiSourceAutosaveTimerRef.current != null) {
      window.clearTimeout(aiSourceAutosaveTimerRef.current);
      aiSourceAutosaveTimerRef.current = null;
    }
    setStatus('saving');
    setSaveErrorMessage('');
    try {
      if (activeTab === 'profile') {
        const userMarkdown = String(gardenflowProfileDraft.user || '').trim();
        const creatorProfileMarkdown = String(gardenflowProfileDraft.creatorProfile || '').trim();
        if (!userMarkdown) {
          throw new Error('用户画像不能为空');
        }
        if (!creatorProfileMarkdown) {
          throw new Error('创作档案不能为空');
        }
        let savedDocCount = 0;
        await window.ipcRenderer.gardenflowProfile.updateDoc({
          docType: 'user',
          markdown: userMarkdown,
          reason: 'settings-user-profile-save',
        });
        savedDocCount += 1;
        await window.ipcRenderer.gardenflowProfile.updateDoc({
          docType: 'creator_profile',
          markdown: creatorProfileMarkdown,
          reason: 'settings-user-profile-save',
        });
        savedDocCount += 1;
        const nextDraft: GardenFlowProfileDraft = {
          user: userMarkdown,
          creatorProfile: creatorProfileMarkdown,
        };
        setSavedGardenFlowProfileDraft(nextDraft);
        setGardenFlowProfileDraft(nextDraft);
        setGardenFlowProfileDirtyState(false);
        setGardenFlowProfileMessage({
          tone: 'success',
          text: savedDocCount === 2
            ? `用户档案已保存，${APP_BRAND.aiDisplayName} 后续会直接读取这两份长期档案。`
            : '用户档案已保存。',
        });
        tabWarmRef.current.profile = true;
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2000);
        return;
      }

      const {
        sanitizedSources,
        resolvedLegacyChatSourceId,
        legacyChatSource,
        resolvedApiEndpoint,
        resolvedApiKey,
        resolvedModelName,
      } = buildAiSourcePersistenceSnapshot();
      const aiSourceSaveGeneration = aiSourceEditGenerationRef.current;
      const fallbackRouteSource = officialAiSource || null;
      const resolvedTranscriptionSource = getAiSourceById(transcriptionSourceId) || fallbackRouteSource;
      const resolvedEmbeddingSource = getAiSourceById(embeddingSourceId) || fallbackRouteSource;
      const resolvedVisualIndexSource = getAiSourceById(visualIndexSourceId) || fallbackRouteSource;
      const resolvedVideoAnalysisSource = getAiSourceById(videoAnalysisSourceId) || fallbackRouteSource;
      const selectedImageSource = getAiSourceById(imageSourceId);
      const firstConfiguredImageSource = aiSources.find((source) => (
        filterAiModelsByCapability(getSourceModelList(source), 'image').length > 0
      )) || null;
      const resolvedImageSource = selectedImageSource
        && filterAiModelsByCapability(getSourceModelList(selectedImageSource), 'image').length > 0
          ? selectedImageSource
          : firstConfiguredImageSource || fallbackRouteSource;
      const resolvedVoiceSource = getAiSourceById(voiceSourceId) || fallbackRouteSource;
      const resolvedImageRouting = resolvedImageSource
        ? inferImageRoutingFromSource(resolvedImageSource)
        : {
          provider: formData.image_provider || 'openai-compatible',
          template: formData.image_provider_template || '',
        };
      const resolvedImageProvider = resolvedImageRouting.provider || formData.image_provider || 'openai-compatible';
      const resolvedImageProviderTemplate = inferImageTemplateByProvider(
        resolvedImageProvider,
        resolvedImageRouting.template || formData.image_provider_template || '',
      );
      const resolvedTranscriptionModel = String(formData.transcription_model || pickBestModelForSource(resolvedTranscriptionSource) || '').trim();
      const resolvedEmbeddingModel = String(formData.embedding_model || pickBestModelForSource(resolvedEmbeddingSource) || '').trim();
      const resolvedVisualIndexModel = String(formData.visual_index_model || pickBestVisualIndexModelForSource(resolvedVisualIndexSource) || '').trim();
      const resolvedVideoAnalysisModels = resolvedVideoAnalysisSource ? filterVideoAnalysisModels(getSourceModelList(resolvedVideoAnalysisSource)) : [];
      const requestedVideoAnalysisModel = String(formData.video_analysis_model || '').trim();
      const resolvedVideoAnalysisModel = String(
        requestedVideoAnalysisModel && resolvedVideoAnalysisModels.some((model) => model.id === requestedVideoAnalysisModel)
          ? requestedVideoAnalysisModel
          : pickBestVideoAnalysisModelForSource(resolvedVideoAnalysisSource),
      ).trim();
      const requestedImageModel = String(formData.image_model || aiModelRoutes.image.model || '').trim();
      const resolvedImageModel = String(
        pickCapabilityModelForSource(resolvedImageSource, requestedImageModel, 'image'),
      ).trim();
      const resolvedVoiceTtsModel = String(formData.voice_tts_model || aiModelRoutes.voiceTts.model || formData.tts_model || DEFAULT_VOICE_TTS_MODEL).trim();
      const resolvedVoiceCloneModel = cloneModelForVoiceTtsModel(
        resolvedVoiceTtsModel,
        String(formData.voice_clone_model || aiModelRoutes.voiceClone.model || DEFAULT_VOICE_CLONE_MODEL).trim(),
      );
      const resolvedVideoProviders = normalizeVideoProviderConfigs(formData.video_providers_json, {
        endpoint: formData.video_endpoint,
        apiKey: formData.video_api_key,
        model: formData.video_model,
        modelsJson: formData.video_models_json,
      });
      const requestedActiveVideoProviderId = String(formData.active_video_provider_id || '').trim();
      const resolvedActiveVideoProviderId = resolvedVideoProviders.some((provider) => provider.id === requestedActiveVideoProviderId)
        ? requestedActiveVideoProviderId
        : (resolvedVideoProviders[0]?.id || '');
      const resolvedActiveVideoProvider = resolvedVideoProviders.find((provider) => provider.id === resolvedActiveVideoProviderId)
        || resolvedVideoProviders[0];
      const resolvedVideoEndpoint = String(resolvedActiveVideoProvider?.endpoint || '').trim();
      const resolvedVideoModel = String(resolvedActiveVideoProvider?.model || '').trim();
      const resolvedVideoModels = normalizeVideoModelList(resolvedActiveVideoProvider?.models, resolvedVideoModel);
      const resolvedVideoProviderSnapshot = resolvedVideoProviders.map((provider) => (
        provider.id === resolvedActiveVideoProviderId
          ? { ...provider, model: resolvedVideoModel, models: resolvedVideoModels }
          : provider
      ));
      if (!resolvedVideoEndpoint || !resolvedVideoModel) {
        throw new Error('已启用的视频生成服务商必须填写 Endpoint，并至少选择一个模型');
      }
      const selectedImageModel = String(resolvedImageModel || '').trim();
      if (!selectedImageModel) {
        throw new Error('请填写生图模型（可手动输入或从列表选择）');
      }
      if (resolvedImageSource?.id && resolvedImageSource.id !== imageSourceId) {
        setImageSourceId(resolvedImageSource.id);
      }
      const parsedCompactTokens = Number(formData.gardenflow_compact_target_tokens);
      const compactTargetTokens = Number.isFinite(parsedCompactTokens) && parsedCompactTokens > 0
        ? Math.max(16000, Math.floor(parsedCompactTokens))
        : 256000;
      const chatMaxTokensDefault = Number(sanitizeChatMaxTokensInput(
        formData.chat_max_tokens_default,
        DEFAULT_CHAT_MAX_TOKENS,
      ));
      const chatMaxTokensDeepseek = Number(sanitizeChatMaxTokensInput(
        formData.chat_max_tokens_deepseek,
        DEFAULT_CHAT_MAX_TOKENS_DEEPSEEK,
      ));
      const releaseLogRetentionDays = Math.max(1, Number(formData.release_log_retention_days || 7) || 7);
      const releaseLogMaxFileMb = Math.max(1, Number(formData.release_log_max_file_mb || 10) || 10);
      const normalizedVisualIndexProvider = 'openai-compatible';
      const parsedVisualIndexTimeoutSeconds = Number(formData.visual_index_timeout_seconds);
      const visualIndexTimeoutSeconds = Number.isFinite(parsedVisualIndexTimeoutSeconds)
        ? Math.min(300, Math.max(10, Math.floor(parsedVisualIndexTimeoutSeconds)))
        : 90;
      const parsedVisualIndexMaxImageEdge = Number(formData.visual_index_max_image_edge);
      const visualIndexMaxImageEdge = Number.isFinite(parsedVisualIndexMaxImageEdge)
        ? Math.min(4096, Math.max(512, Math.floor(parsedVisualIndexMaxImageEdge)))
        : 1536;
      const parsedVisualIndexPdfMaxPages = Number(formData.visual_index_pdf_max_pages);
      const visualIndexPdfMaxPages = Number.isFinite(parsedVisualIndexPdfMaxPages)
        ? Math.min(200, Math.max(1, Math.floor(parsedVisualIndexPdfMaxPages)))
        : 12;
      const parsedVisualIndexPdfRenderDpi = Number(formData.visual_index_pdf_render_dpi);
      const visualIndexPdfRenderDpi = Number.isFinite(parsedVisualIndexPdfRenderDpi)
        ? Math.min(300, Math.max(72, Math.floor(parsedVisualIndexPdfRenderDpi)))
        : 144;
      const parsedVisualIndexConcurrency = Number(formData.visual_index_concurrency);
      const visualIndexConcurrency = Number.isFinite(parsedVisualIndexConcurrency)
        ? Math.min(4, Math.max(1, Math.floor(parsedVisualIndexConcurrency)))
        : 1;
      const normalizedVisualIndexEndpoint = String(resolvedVisualIndexSource?.baseURL || formData.visual_index_endpoint || resolvedApiEndpoint).trim();
      const normalizedVisualIndexApiKey = String(resolvedVisualIndexSource?.apiKey || formData.visual_index_api_key || '').trim();
      const normalizedVisualIndexModel = resolvedVisualIndexModel;
      const shouldValidateVisualIndex = Boolean(formData.visual_index_enabled)
        && aiModelRoutes.visualIndex.mode === 'custom';
      if (shouldValidateVisualIndex && (!normalizedVisualIndexEndpoint || !normalizedVisualIndexModel)) {
        throw new Error('启用知识库视觉索引时必须填写多模态 Endpoint 和模型名');
      }
      const normalizedVideoAnalysisEndpoint = String(resolvedVideoAnalysisSource?.baseURL || formData.video_analysis_endpoint || resolvedApiEndpoint).trim();
      const normalizedVideoAnalysisApiKey = String(resolvedVideoAnalysisSource?.apiKey || formData.video_analysis_api_key || '').trim();
      const normalizedVideoAnalysisProtocol = String(resolvedVideoAnalysisSource?.protocol || formData.video_analysis_protocol || 'gemini').trim();
      const shouldValidateVideoAnalysis = Boolean(formData.video_analysis_enabled)
        && aiModelRoutes.videoAnalysis.mode === 'custom';
      if (shouldValidateVideoAnalysis && (!normalizedVideoAnalysisEndpoint || !resolvedVideoAnalysisModel)) {
        throw new Error('启用视频分析专用模型时必须填写 Endpoint 和模型名');
      }
      const routeScopedSource = (scope: AiModelRouteScope) => getRouteSource(aiModelRoutes[scope]) || fallbackRouteSource;
      const routeModel = (
        scope: AiModelRouteScope,
        value: string,
        fallbackSource: AiSourceConfig | null,
        fallbackPicker: (source: AiSourceConfig | null, preferred?: string) => string,
      ) => {
        const mode = aiModelRoutes[scope].mode;
        if (mode === 'disabled') return '';
        const explicitModel = String(value || aiModelRoutes[scope].model || '').trim();
        if (explicitModel) {
          if (mode === 'official') {
            return String(fallbackPicker(fallbackSource, explicitModel) || '').trim();
          }
          return explicitModel;
        }
        return String(fallbackPicker(fallbackSource) || '').trim();
      };
      const routeChatModel = (scope: AiModelRouteScope, value: string) => routeModel(
        scope,
        value,
        routeScopedSource(scope),
        (source, preferred) => pickBestModelForSource(source, preferred, 'chat'),
      );
      const normalizeRouteForSource = (
        route: AiModelRouteConfig,
        sourceId: string,
      ): AiModelRouteConfig => {
        const normalizedSourceId = canonicalizeOfficialAutoSourceId(sourceId);
        if (route.mode === 'disabled') {
          return { ...route, sourceId: normalizedSourceId };
        }
        if (isOfficialAutoSourceId(normalizedSourceId) || route.mode === 'official') {
          return { ...route, mode: 'official', sourceId: OFFICIAL_AUTO_SOURCE_ID };
        }
        if (normalizedSourceId) {
          return { ...route, mode: 'custom', sourceId: normalizedSourceId };
        }
        return { ...route, sourceId: normalizedSourceId };
      };
      const routeTranscriptionModel = routeModel(
        'transcription',
        resolvedTranscriptionModel,
        resolvedTranscriptionSource,
        (source, preferred) => pickBestModelForSource(source, preferred, 'transcription'),
      );
      const routeEmbeddingModel = routeModel(
        'embedding',
        resolvedEmbeddingModel,
        resolvedEmbeddingSource,
        (source, preferred) => pickBestModelForSource(source, preferred, 'embedding'),
      );
      const routeImageModel = resolvedImageModel;
      const routeVisualIndexModel = resolvedVisualIndexModel;
      const routeVideoAnalysisModel = resolvedVideoAnalysisModel;
      const routeVoiceTtsModel = routeModel(
        'voiceTts',
        resolvedVoiceTtsModel,
        resolvedVoiceSource,
        (source, preferred) => pickBestModelForSource(source, preferred, 'tts') || pickBestModelForSource(source, preferred, 'audio') || DEFAULT_VOICE_TTS_MODEL,
      ) || DEFAULT_VOICE_TTS_MODEL;
      const routeVoiceCloneModel = resolvedVoiceCloneModel;
      const resolvedChatSource = routeScopedSource('chat') || legacyChatSource || null;
      const resolvedChatSourceId = canonicalizeOfficialAutoSourceId(
        resolvedChatSource?.id || (aiModelRoutes.chat.mode === 'official' ? OFFICIAL_AUTO_SOURCE_ID : resolvedLegacyChatSourceId)
      );
      const routeChatModelValue = routeModel(
        'chat',
        formData.model_name || resolvedModelName,
        resolvedChatSource,
        (source, preferred) => pickBestModelForSource(source, preferred, 'chat'),
      );
      const normalizedModelRoutes: AiModelRoutes = {
        ...aiModelRoutes,
        chat: normalizeRouteForSource({
          ...aiModelRoutes.chat,
          sourceId: resolvedChatSourceId,
          model: routeChatModelValue,
        }, resolvedChatSourceId),
        wander: normalizeRouteForSource(
          { ...aiModelRoutes.wander, model: routeChatModel('wander', formData.model_name_wander) },
          aiModelRoutes.wander.sourceId || OFFICIAL_AUTO_SOURCE_ID,
        ),
        team: normalizeRouteForSource(
          { ...aiModelRoutes.team, model: routeChatModel('team', formData.model_name_chatroom) },
          aiModelRoutes.team.sourceId || OFFICIAL_AUTO_SOURCE_ID,
        ),
        knowledge: normalizeRouteForSource(
          { ...aiModelRoutes.knowledge, model: routeChatModel('knowledge', formData.model_name_knowledge) },
          aiModelRoutes.knowledge.sourceId || OFFICIAL_AUTO_SOURCE_ID,
        ),
        gardenflow: normalizeRouteForSource(
          { ...aiModelRoutes.gardenflow, model: routeChatModel('gardenflow', formData.model_name_gardenflow) },
          aiModelRoutes.gardenflow.sourceId || OFFICIAL_AUTO_SOURCE_ID,
        ),
        transcription: normalizeRouteForSource(
          { ...aiModelRoutes.transcription, sourceId: resolvedTranscriptionSource?.id || '', model: routeTranscriptionModel },
          resolvedTranscriptionSource?.id || '',
        ),
        embedding: normalizeRouteForSource(
          { ...aiModelRoutes.embedding, sourceId: resolvedEmbeddingSource?.id || '', model: routeEmbeddingModel },
          resolvedEmbeddingSource?.id || '',
        ),
        image: normalizeRouteForSource(
          { ...aiModelRoutes.image, sourceId: resolvedImageSource?.id || '', model: routeImageModel },
          resolvedImageSource?.id || '',
        ),
        visualIndex: normalizeRouteForSource({
          ...aiModelRoutes.visualIndex,
          mode: aiModelRoutes.visualIndex.mode === 'disabled' ? 'official' : aiModelRoutes.visualIndex.mode,
          sourceId: resolvedVisualIndexSource?.id || '',
          model: routeVisualIndexModel,
        }, resolvedVisualIndexSource?.id || ''),
        videoAnalysis: normalizeRouteForSource({
          ...aiModelRoutes.videoAnalysis,
          mode: aiModelRoutes.videoAnalysis.mode === 'disabled' ? 'official' : aiModelRoutes.videoAnalysis.mode,
          sourceId: resolvedVideoAnalysisSource?.id || '',
          model: routeVideoAnalysisModel,
        }, resolvedVideoAnalysisSource?.id || ''),
        voiceTts: normalizeRouteForSource(
          { ...aiModelRoutes.voiceTts, sourceId: resolvedVoiceSource?.id || '', model: routeVoiceTtsModel },
          resolvedVoiceSource?.id || '',
        ),
        voiceClone: { mode: 'official', sourceId: OFFICIAL_AUTO_SOURCE_ID, model: routeVoiceCloneModel },
      };
      const parsedParserTimeoutSeconds = Number(formData.parser_timeout_seconds);
      const parserTimeoutSeconds = Number.isFinite(parsedParserTimeoutSeconds)
        ? Math.min(300, Math.max(10, Math.floor(parsedParserTimeoutSeconds)))
        : 90;
      const parsedRerankTimeoutSeconds = Number(formData.rerank_timeout_seconds);
      const rerankTimeoutSeconds = Number.isFinite(parsedRerankTimeoutSeconds)
        ? Math.min(120, Math.max(5, Math.floor(parsedRerankTimeoutSeconds)))
        : 30;
      if (formData.proxy_enabled && !String(formData.proxy_url || '').trim()) {
        throw new Error('启用代理时必须填写代理地址，例如 http://127.0.0.1:7890');
      }

      await window.ipcRenderer.saveSettings({
        ...formData,
        api_endpoint: String(resolvedChatSource?.baseURL || resolvedApiEndpoint).trim(),
        api_key: String(resolvedChatSource?.apiKey || resolvedApiKey).trim(),
        model_name: routeChatModelValue || resolvedModelName,
        model_name_wander: routeChatModel('wander', formData.model_name_wander),
        model_name_chatroom: routeChatModel('team', formData.model_name_chatroom),
        model_name_knowledge: routeChatModel('knowledge', formData.model_name_knowledge),
        model_name_gardenflow: routeChatModel('gardenflow', formData.model_name_gardenflow),
        proxy_enabled: Boolean(formData.proxy_enabled),
        proxy_url: String(formData.proxy_url || '').trim(),
        proxy_bypass: String(formData.proxy_bypass || '').trim(),
        transcription_model: routeTranscriptionModel,
        transcription_endpoint: String(resolvedTranscriptionSource?.baseURL || formData.transcription_endpoint || resolvedApiEndpoint).trim(),
        transcription_key: String(resolvedTranscriptionSource?.apiKey || formData.transcription_key || '').trim(),
        embedding_model: routeEmbeddingModel,
        embedding_endpoint: String(resolvedEmbeddingSource?.baseURL || formData.embedding_endpoint || resolvedApiEndpoint).trim(),
        embedding_key: String(resolvedEmbeddingSource?.apiKey || formData.embedding_key || '').trim(),
        visual_index_enabled: Boolean(formData.visual_index_enabled),
        visual_index_provider: normalizedVisualIndexProvider,
        visual_index_endpoint: normalizedVisualIndexEndpoint,
        visual_index_api_key: normalizedVisualIndexApiKey,
        visual_index_model: routeVisualIndexModel,
        visual_index_prompt_version: normalizeVisualIndexPromptVersion(formData.visual_index_prompt_version),
        visual_index_timeout_seconds: visualIndexTimeoutSeconds,
        visual_index_max_image_edge: visualIndexMaxImageEdge,
        visual_index_skip_small_images: Boolean(formData.visual_index_skip_small_images),
        visual_index_pdf_max_pages: visualIndexPdfMaxPages,
        visual_index_pdf_render_dpi: visualIndexPdfRenderDpi,
        visual_index_concurrency: visualIndexConcurrency,
        video_analysis_enabled: Boolean(formData.video_analysis_enabled),
        video_analysis_endpoint: normalizedVideoAnalysisEndpoint,
        video_analysis_api_key: normalizedVideoAnalysisApiKey,
        video_analysis_model: routeVideoAnalysisModel,
        video_analysis_protocol: normalizedVideoAnalysisProtocol,
        video_analysis_max_direct_video_bytes: Number(formData.video_analysis_max_direct_video_bytes || 64 * 1024 * 1024),
        docling_endpoint: String(formData.docling_endpoint || '').trim(),
        tika_endpoint: String(formData.tika_endpoint || '').trim(),
        unstructured_endpoint: String(formData.unstructured_endpoint || '').trim(),
        parser_api_key: String(formData.parser_api_key || '').trim(),
        parser_timeout_seconds: parserTimeoutSeconds,
        rerank_endpoint: String(formData.rerank_endpoint || '').trim(),
        rerank_api_key: String(formData.rerank_api_key || '').trim(),
        rerank_model: String(formData.rerank_model || '').trim(),
        rerank_timeout_seconds: rerankTimeoutSeconds,
        image_provider: resolvedImageProvider,
        image_provider_template: resolvedImageProviderTemplate,
        image_endpoint: String(resolvedImageSource?.baseURL || formData.image_endpoint || '').trim(),
        image_api_key: String(resolvedImageSource?.apiKey || formData.image_api_key || '').trim(),
        image_model: routeImageModel,
        voice_provider: 'voice',
        voice_endpoint: String(resolvedVoiceSource?.baseURL || formData.voice_endpoint || formData.api_endpoint || '').trim(),
        voice_api_key: String(resolvedVoiceSource?.apiKey || formData.voice_api_key || formData.api_key || '').trim(),
        voice_tts_model: routeVoiceTtsModel,
        tts_model: routeVoiceTtsModel,
        voice_clone_model: routeVoiceCloneModel,
        video_endpoint: resolvedVideoEndpoint,
        video_api_key: String(resolvedActiveVideoProvider?.apiKey || '').trim(),
        video_model: resolvedVideoModel,
        video_models_json: JSON.stringify(resolvedVideoModels),
        video_providers_json: JSON.stringify(resolvedVideoProviderSnapshot),
        active_video_provider_id: resolvedActiveVideoProviderId,
        ai_model_routes_json: JSON.stringify(normalizedModelRoutes),
        image_hosting_json: serializeImageHostingSettings(formData.image_hosting_json),
        ai_sources_json: JSON.stringify(sanitizedSources),
        default_ai_source_id: normalizedModelRoutes.chat.sourceId || resolvedLegacyChatSourceId || '',
        mcp_servers_json: JSON.stringify(mcpServers),
        gardenflow_compact_target_tokens: compactTargetTokens,
        debug_log_enabled: Boolean(formData.debug_log_enabled),
        diagnostics_upload_consent: formData.diagnostics_upload_consent,
        diagnostics_include_advanced_context: Boolean(formData.diagnostics_include_advanced_context),
        diagnostics_auto_send_same_crash: Boolean(formData.diagnostics_auto_send_same_crash),
        diagnostics_last_prompted_at: formData.diagnostics_last_prompted_at || null,
        analytics_consent: formData.analytics_consent,
        analytics_last_prompted_at: new Date().toISOString(),
        release_log_retention_days: releaseLogRetentionDays,
        release_log_max_file_mb: releaseLogMaxFileMb,
        notifications_json: JSON.stringify(notificationSettings),
        cli_runtime_execution_mode: normalizeCliRuntimeExecutionMode(formData.cli_runtime_execution_mode),
        developer_mode_enabled: Boolean(formData.developer_mode_enabled),
        developer_mode_unlocked_at: formData.developer_mode_enabled
          ? (formData.developer_mode_unlocked_at || new Date().toISOString())
          : null,
        ecommerce_platforms_json: serializeEcommercePlatformsSettings(
          normalizeEcommercePlatformsSettings(formData.ecommerce_platforms_json)
        ),
        chat_max_tokens_default: chatMaxTokensDefault,
        chat_max_tokens_deepseek: chatMaxTokensDeepseek,
      });
      const persistedSettings = await window.ipcRenderer.getSettings();
      const persistedVideoModels = normalizeVideoModelList(
        persistedSettings?.video_models_json,
        persistedSettings?.video_model,
      );
      const persistedVideoProviders = normalizeVideoProviderConfigs(persistedSettings?.video_providers_json, {
        endpoint: persistedSettings?.video_endpoint,
        apiKey: persistedSettings?.video_api_key,
        model: persistedSettings?.video_model,
        modelsJson: persistedSettings?.video_models_json,
      });
      if (
        JSON.stringify(persistedVideoModels) !== JSON.stringify(resolvedVideoModels)
        || JSON.stringify(persistedVideoProviders) !== JSON.stringify(resolvedVideoProviderSnapshot)
        || persistedSettings?.active_video_provider_id !== resolvedActiveVideoProviderId
      ) {
        throw new Error('视频生成服务商配置未能完整写入数据库，请重启应用后重新保存');
      }
      void window.ipcRenderer.analytics.track('settings_changed', {
        surface: 'settings',
        origin: 'renderer',
        properties: {
          settingKey: 'analytics_consent',
          valueKind: formData.analytics_consent,
        },
      });
      clearAiSourceDraftDirty(aiSourceSaveGeneration);
      if (formData.debug_log_enabled) {
        await loadRecentDebugLogs();
      }
      await Promise.all([
        loadLoggingStatus(),
        loadPendingDiagnosticReports(),
      ]);
      setStatus('saved');
      setSaveErrorMessage('');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (e) {
      console.error(e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      if (activeTab === 'profile') {
        setGardenFlowProfileMessage({
          tone: 'error',
          text: e instanceof Error ? e.message : String(e),
        });
      }
      if (e instanceof Error && e.message) {
        setTestStatus('error');
        setTestMsg(e.message);
      }
      setSaveErrorMessage(errorMessage || '未知错误');
      setStatus('error');
    }
  };

  const handleTestNotificationSound = useCallback(async () => {
    try {
      await playTestNotificationSound('attention', notificationSettings.sound.volume);
    } catch (error) {
      console.warn('Failed to play notification test sound:', error);
    }
  }, [notificationSettings.sound.volume]);

  const routeModelOptions = useCallback((scope: AiModelRouteScope, source: AiSourceConfig | null): AiModelDescriptor[] => {
    if (!source) return [];
    const models = getSourceModelList(source);
    if (scope === 'transcription') return filterAiModelsByCapability(models, 'transcription');
    if (scope === 'embedding') return filterAiModelsByCapability(models, 'embedding');
    if (scope === 'image') return filterAiModelsByCapability(models, 'image');
    if (scope === 'visualIndex') return filterVisualIndexModels(models);
    if (scope === 'videoAnalysis') return filterVideoAnalysisModels(models);
    if (scope === 'voiceTts') {
      const ttsModels = filterAiModelsByCapability(models, 'tts');
      return ttsModels.length > 0 ? ttsModels : filterAiModelsByCapability(models, 'audio');
    }
    if (scope === 'voiceClone') {
      const cloneModels = filterAiModelsByCapability(models, 'voice_clone');
      return cloneModels.length > 0 ? cloneModels : filterAiModelsByCapability(models, 'audio');
    }
    return filterAiModelsByCapability(models, 'chat');
  }, [filterVideoAnalysisModels, filterVisualIndexModels, getSourceModelList]);

  const currentRouteModelValue = useCallback((scope: AiModelRouteScope): string => {
    if (scope === 'chat') return String(aiModelRoutes.chat.model || formData.model_name || '').trim();
    if (scope === 'wander') return String(aiModelRoutes.wander.model || formData.model_name_wander || '').trim();
    if (scope === 'team') return String(aiModelRoutes.team.model || formData.model_name_chatroom || '').trim();
    if (scope === 'knowledge') return String(aiModelRoutes.knowledge.model || formData.model_name_knowledge || '').trim();
    if (scope === 'gardenflow') return String(aiModelRoutes.gardenflow.model || formData.model_name_gardenflow || '').trim();
    if (scope === 'transcription') return String(aiModelRoutes.transcription.model || formData.transcription_model || '').trim();
    if (scope === 'embedding') return String(aiModelRoutes.embedding.model || formData.embedding_model || '').trim();
    if (scope === 'image') return String(aiModelRoutes.image.model || formData.image_model || '').trim();
    if (scope === 'visualIndex') return String(aiModelRoutes.visualIndex.model || formData.visual_index_model || '').trim();
    if (scope === 'videoAnalysis') return String(aiModelRoutes.videoAnalysis.model || formData.video_analysis_model || '').trim();
    if (scope === 'voiceTts') return String(aiModelRoutes.voiceTts.model || formData.voice_tts_model || formData.tts_model || DEFAULT_VOICE_TTS_MODEL).trim();
    if (scope === 'voiceClone') return String(aiModelRoutes.voiceClone.model || formData.voice_clone_model || DEFAULT_VOICE_CLONE_MODEL).trim();
    return '';
  }, [
    aiModelRoutes,
    formData.embedding_model,
    formData.image_model,
    formData.model_name,
    formData.model_name_chatroom,
    formData.model_name_knowledge,
    formData.model_name_gardenflow,
    formData.model_name_wander,
    formData.transcription_model,
    formData.tts_model,
    formData.video_analysis_model,
    formData.visual_index_model,
    formData.voice_clone_model,
    formData.voice_tts_model,
  ]);

  const fallbackOfficialRouteModel = useCallback((scope: AiModelRouteScope, preferredModel = ''): string => {
    const pickFirstOfficialModel = (capability: ModelCapability = 'chat') => {
      const sourceModels = getSourceModelList(officialAiSource);
      const matchingModels = filterAiModelsByCapability(sourceModels, capability);
      return String(matchingModels[0]?.id || sourceModels[0]?.id || '').trim();
    };
    const pickFirstOfficialVisualModel = () => {
      const sourceModels = getSourceModelList(officialAiSource);
      const visualModels = filterVisualIndexModels(sourceModels);
      return String(visualModels[0]?.id || sourceModels[0]?.id || '').trim();
    };
    const pickFirstOfficialVideoModel = () => {
      const sourceModels = getSourceModelList(officialAiSource);
      const videoModels = filterVideoAnalysisModels(sourceModels);
      if (preferredModel && videoModels.some((item) => item.id === preferredModel)) {
        return preferredModel;
      }
      return String(videoModels[0]?.id || '').trim();
    };
    if (scope === 'voiceTts') return pickBestModelForSource(officialAiSource, preferredModel, 'tts') || pickBestModelForSource(officialAiSource, preferredModel, 'audio') || pickFirstOfficialModel('tts') || DEFAULT_VOICE_TTS_MODEL;
    if (scope === 'voiceClone') return pickBestModelForSource(officialAiSource, preferredModel, 'voice_clone') || pickBestModelForSource(officialAiSource, preferredModel, 'audio') || pickFirstOfficialModel('voice_clone') || DEFAULT_VOICE_CLONE_MODEL;
    if (scope === 'transcription') return pickBestModelForSource(officialAiSource, preferredModel, 'transcription') || pickFirstOfficialModel('transcription');
    if (scope === 'embedding') return pickBestModelForSource(officialAiSource, preferredModel, 'embedding') || pickFirstOfficialModel('embedding') || 'text-embedding-3-small';
    if (scope === 'image') return pickBestModelForSource(officialAiSource, preferredModel, 'image') || pickFirstOfficialModel('image');
    if (scope === 'visualIndex') return pickBestVisualIndexModelForSource(officialAiSource, preferredModel) || pickFirstOfficialVisualModel();
    if (scope === 'videoAnalysis') return pickFirstOfficialVideoModel();
    if (scope === 'chat') return pickBestModelForSource(officialAiSource, preferredModel, 'chat') || pickFirstOfficialModel('chat');
    return pickBestModelForSource(officialAiSource, preferredModel, 'chat') || pickFirstOfficialModel('chat');
  }, [
    filterVideoAnalysisModels,
    filterVisualIndexModels,
    getSourceModelList,
    officialAiSource,
    pickBestModelForSource,
    pickBestVisualIndexModelForSource,
  ]);

  const effectiveRouteModelValue = useCallback((scope: AiModelRouteScope): string => {
    if (aiModelRoutes[scope].mode === 'official') {
      const officialModel = String(aiModelRoutes[scope].model || '').trim();
      const legacyModel = currentRouteModelValue(scope);
      const preferredModel = officialModel || legacyModel;
      if (scope === 'image') {
        return pickCapabilityModelForSource(officialAiSource, preferredModel, 'image') || fallbackOfficialRouteModel(scope);
      }
      return fallbackOfficialRouteModel(scope, preferredModel);
    }
    return currentRouteModelValue(scope);
  }, [aiModelRoutes, currentRouteModelValue, fallbackOfficialRouteModel, officialAiSource, pickCapabilityModelForSource]);

  const routeModelSelectOptions = useCallback((models: AiModelDescriptor[], value: string) => {
    const normalizedValue = String(value || '').trim();
    const options = models.map((model) => ({
      id: model.id,
      label: model.id,
    }));
    if (normalizedValue && !options.some((item) => item.id === normalizedValue)) {
      options.unshift({ id: normalizedValue, label: normalizedValue });
    }
    return options;
  }, []);

  const renderRouteModeButton = (
    scope: AiModelRouteScope,
    mode: AiModelRouteMode,
    label: string,
    disabled = false,
  ) => {
    const route = aiModelRoutes[scope];
    const active = route.mode === mode;
    return (
      <button
        key={mode}
        type="button"
        disabled={disabled}
        onClick={() => applyRouteSource(scope, mode)}
        className={clsx(
          'h-8 rounded-md px-2 text-xs font-medium transition-colors',
          active
            ? 'bg-surface-primary text-text-primary shadow-sm'
            : 'text-text-tertiary hover:bg-surface-primary/70 hover:text-text-primary',
          disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent hover:text-text-tertiary'
        )}
      >
        {label}
      </button>
    );
  };

  const renderMissingCustomSourceNotice = (scope: AiModelRouteScope) => (
    missingCustomSourceNoticeScope === scope && (
      <div className="flex items-center gap-1.5 text-xs text-amber-600">
        <AlertCircle className="h-3.5 w-3.5" />
        请先在上方创建一个自定义供应商。
      </div>
    )
  );

  const renderCompactModelRouteRow = (
    label: string,
    controls: ReactNode,
    children?: ReactNode,
  ) => (
    <div className="py-2.5">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[112px_180px_minmax(0,1fr)] md:items-start">
        <div className="pt-1 text-sm font-medium text-text-primary">{label}</div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">{controls}</div>
        {children ? <div className="min-w-0 space-y-2">{children}</div> : <div />}
      </div>
    </div>
  );

  const renderCompactRouteControls = (
    scope: AiModelRouteScope,
    options: Array<{ mode: AiModelRouteMode; label: string; disabled?: boolean }>,
  ) => (
    <>
      <div className="inline-grid grid-flow-col gap-1 rounded-lg border border-border bg-surface-secondary/50 p-1">
        {options.map((option) => renderRouteModeButton(scope, option.mode, option.label, option.disabled))}
      </div>
      {renderMissingCustomSourceNotice(scope)}
    </>
  );

  const renderOfficialRouteModelField = (scope: AiModelRouteScope, placeholder = '默认模型') => {
    const value = effectiveRouteModelValue(scope);
    const models = routeModelOptions(scope, officialAiSource);
    const options = routeModelSelectOptions(models, value);
    const disabled = !officialSourceAuthorized || (!options.length && !value);
    const emptyPlaceholder = OFFICIAL_SOURCE_IS_PRIVATE_GATEWAY ? '请先填写网关令牌' : '请先登录官方账号';
    return (
      <AiModelSelect
        value={value}
        onChange={(modelId) => applyRouteModel(scope, modelId)}
        disabled={disabled}
        className="w-full min-w-0"
        placeholder={!officialSourceAuthorized ? emptyPlaceholder : placeholder}
        options={options}
      />
    );
  };

  const renderCustomRouteFields = (
    sourceValue: string,
    sources: AiSourceConfig[],
    onSourceChange: (sourceId: string) => void,
    modelValue: string,
    models: AiModelDescriptor[],
    onModelChange: (modelId: string) => void,
    modelPlaceholder = '请选择模型',
    modelDisabled = false,
  ) => (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <AiSourceSelect
        value={sourceValue}
        sources={sources}
        onChange={onSourceChange}
        className="w-full"
      />
      <AiModelSelect
        value={modelValue}
        onChange={onModelChange}
        className="w-full"
        disabled={modelDisabled || !models.length}
        placeholder={modelPlaceholder}
        options={models.map((model) => ({
          id: model.id,
          label: model.id,
          badges: buildModelCapabilityBadges(model.capabilities),
          inputIcons: buildModelInputIcons(model.inputCapabilities),
        }))}
      />
    </div>
  );

  const loadAiPricingCatalog = useCallback(async (options?: { refreshRemote?: boolean }) => {
    setAiPricingLoading(true);
    setAiPricingError('');
    try {
      const result = options?.refreshRemote
        ? await window.ipcRenderer.officialAuth.refreshPricing()
        : await window.ipcRenderer.officialAuth.getPricing();
      const catalog = parseAiPricingCatalog(result?.pricing);
      setAiPricingCatalog(catalog);
      setAiPricingActiveGroup((prev) => {
        if (prev && catalog?.groups.some((group) => group.type === prev)) return prev;
        return catalog?.groups[0]?.type || '';
      });
      if (!catalog) {
        setAiPricingError('价格表尚未同步，请重启应用后再查看。');
      }
    } catch (error) {
      setAiPricingError(error instanceof Error ? error.message : '价格表读取失败');
    } finally {
      setAiPricingLoading(false);
    }
  }, []);

  const handleOpenAiPricing = useCallback(() => {
    setSettingsSubView('ai-pricing');
    setActiveTab('ai');
    void loadAiPricingCatalog();
  }, [loadAiPricingCatalog]);

  const handleCloseAiPricing = useCallback(() => {
    setSettingsSubView('main');
  }, []);

  useEffect(() => {
    if (settingsSubView !== 'ai-pricing') return;
    const handleSettingsUpdated = () => {
      void loadAiPricingCatalog();
    };
    return subscribeSettingsUpdated(handleSettingsUpdated);
  }, [loadAiPricingCatalog, settingsSubView]);

  const activePricingGroup = useMemo(() => (
    aiPricingCatalog?.groups.find((group) => group.type === aiPricingActiveGroup)
    || aiPricingCatalog?.groups[0]
    || null
  ), [aiPricingActiveGroup, aiPricingCatalog]);

  const filteredPricingModels = useMemo(() => {
    const query = aiPricingSearch.trim().toLowerCase();
    const models = activePricingGroup?.models || [];
    if (!query) return models;
    return models.filter((model) => [
      model.model,
      model.display_name,
      model.provider,
      model.capability,
    ].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [activePricingGroup, aiPricingSearch]);

  const renderPricingRateTable = (model: AiPricingModel) => {
    const rows = Array.isArray(model.price_table) && model.price_table.length
      ? model.price_table
      : Array.isArray(model.image_quality_resolution_rates) && model.image_quality_resolution_rates.length
        ? model.image_quality_resolution_rates
        : Array.isArray(model.video_resolution_rates) && model.video_resolution_rates.length
          ? model.video_resolution_rates
          : [];
    if (!rows.length) return null;
    const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).filter((key) => (
      rows.some((row) => hasMeaningfulPricingValue(row[key]))
    ));
    if (!keys.length) return null;
    return (
      <div className="mt-3 overflow-hidden rounded-lg border border-border/70">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="bg-surface-secondary/50 text-text-tertiary">
            <tr>
              {keys.map((key) => (
                <th key={key} className="px-3 py-2 text-left font-medium">{pricingRateLabel(key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-border/50">
                {keys.map((key) => (
                  <td key={key} className="px-3 py-2 text-text-secondary">{pricingRateCellValue(key, row[key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderAiPricingPage = () => (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-surface-primary text-text-primary">
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={handleCloseAiPricing}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
            title="返回 AI 设置"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text-primary">AI 价格表</h2>
            <p className="mt-0.5 text-xs text-text-tertiary">
              更新时间：{formatPricingUpdatedAt(aiPricingCatalog?.updated_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadAiPricingCatalog({ refreshRemote: true })}
            disabled={aiPricingLoading}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-secondary/30 text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
            title="刷新价格表"
            aria-label="刷新价格表"
          >
            <RefreshCw className={clsx('h-4 w-4', aiPricingLoading && 'animate-spin')} />
          </button>
          <input
            type="search"
            value={aiPricingSearch}
            onChange={(event) => setAiPricingSearch(event.target.value)}
            placeholder="搜索模型或供应商"
            className="w-64 rounded-lg border border-border bg-surface-secondary/30 px-3 py-2 text-sm outline-none transition-colors focus:border-accent-primary"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-56 shrink-0 border-r border-border bg-surface-secondary/20 p-4">
          <div className="space-y-1">
            {(aiPricingCatalog?.groups || []).map((group) => (
              <button
                key={group.type}
                type="button"
                onClick={() => setAiPricingActiveGroup(group.type)}
                className={clsx(
                  'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  activePricingGroup?.type === group.type
                    ? 'bg-surface-secondary text-text-primary'
                    : 'text-text-secondary hover:bg-surface-secondary/60 hover:text-text-primary',
                )}
              >
                <span>{group.label}</span>
                <span className="text-xs text-text-tertiary">{group.models.length}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-auto p-6">
          {aiPricingLoading && !aiPricingCatalog ? (
            <div className="rounded-lg border border-border bg-surface-secondary/20 p-4 text-sm text-text-tertiary">正在读取本地价格表...</div>
          ) : aiPricingError && !aiPricingCatalog ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-600">{aiPricingError}</div>
          ) : activePricingGroup ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-text-primary">{activePricingGroup.label}</h3>
                  <p className="mt-1 text-xs text-text-tertiary">{filteredPricingModels.length} / {activePricingGroup.models.length} 个模型</p>
                </div>
              </div>

              {filteredPricingModels.map((model) => (
                <div key={`${activePricingGroup.type}:${model.model}`} className="rounded-xl border border-border bg-surface-primary p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-text-primary">{model.display_name || model.model}</h4>
                        {model.is_default ? (
                          <span className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-primary">默认</span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-text-tertiary">{model.provider || '-'} · {pricingModeLabel(model.pricing_mode)}</p>
                    </div>
                    {pricingModelFields(model, activePricingGroup.type).length ? (
                      <div className="flex max-w-full flex-wrap justify-end gap-2 text-right text-xs">
                        {pricingModelFields(model, activePricingGroup.type).map((field) => (
                          <div key={field.label} className="rounded-lg border border-border/70 bg-surface-secondary/20 px-2.5 py-1.5">
                            <div className="text-text-tertiary">{field.label}</div>
                            <div className="mt-0.5 font-medium text-text-primary">{field.value}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {renderPricingRateTable(model)}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-surface-secondary/20 p-4 text-sm text-text-tertiary">暂无价格表数据。</div>
          )}
        </div>
      </div>
    </div>
  );

  const renderSettingsSkillRow = useCallback((skill: SettingsSkill) => {
    const isBusy = settingsSkillBusyName === skill.name;
    const enabled = skill.isBuiltin || !skill.disabled;
    return (
      <div key={skill.location || skill.name} className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-text-primary">{skill.name}</span>
            <span className={clsx(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
              skill.isBuiltin
                ? 'bg-accent-primary/10 text-accent-primary'
                : 'bg-surface-secondary text-text-tertiary'
            )}>
              {formatSettingsSkillSource(skill.sourceScope)}
            </span>
          </div>
          {skill.description && (
            <div className="mt-1 line-clamp-2 text-xs leading-5 text-text-tertiary">
              {skill.description}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void handleToggleSettingsSkill(skill)}
            disabled={skill.isBuiltin || isBusy}
            role="switch"
            aria-checked={enabled}
            aria-label={`${enabled ? '关闭' : '打开'}技能 ${skill.name}`}
            title={skill.isBuiltin ? '内置技能不可关闭' : (enabled ? '关闭技能' : '打开技能')}
            className={clsx(
              'ui-switch-track disabled:cursor-not-allowed',
              skill.isBuiltin && 'opacity-70',
              isBusy && 'opacity-60'
            )}
            data-size="sm"
            data-state={enabled ? 'on' : 'off'}
          >
            <span className="ui-switch-thumb" />
          </button>
          {!skill.isBuiltin && (
            <button
              type="button"
              onClick={() => void handleUninstallSettingsSkill(skill)}
              disabled={isBusy}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-tertiary transition-colors hover:border-status-error/30 hover:bg-status-error/10 hover:text-status-error disabled:opacity-50"
              aria-label={`删除技能 ${skill.name}`}
              title="删除技能"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }, [handleToggleSettingsSkill, handleUninstallSettingsSkill, settingsSkillBusyName]);

  const allTabs = useMemo<Array<{ id: SettingsTab; labelKey: I18nKey; icon: ComponentType<{ className?: string }> }>>(() => [
    { id: 'ai', labelKey: 'settings.tabs.ai', icon: Cpu },
    { id: 'general', labelKey: 'settings.tabs.general', icon: LayoutGrid },
    { id: 'team', labelKey: 'settings.tabs.team', icon: Users },
    { id: 'platforms', labelKey: 'settings.tabs.platforms', icon: Store },
    { id: 'skills', labelKey: 'settings.tabs.skills', icon: Star },
    { id: 'mcp', labelKey: 'settings.tabs.mcp', icon: Server },
    { id: 'remote', labelKey: 'settings.tabs.remote', icon: MessageSquareText },
    { id: 'profile', labelKey: 'settings.tabs.profile', icon: FileText },
    { id: 'tools', labelKey: 'settings.tabs.tools', icon: Wrench },
    { id: 'experimental', labelKey: 'settings.tabs.experimental', icon: FlaskConical },
  ], []);

  const tabs = useMemo(() => {
    const visibleTabs = new Set(APP_BRAND.visibleSettingsTabs);
    if (visibleTabs.size === 0) return allTabs;
    const filteredTabs = allTabs.filter((tab) => visibleTabs.has(tab.id));
    return filteredTabs.length > 0 ? filteredTabs : allTabs;
  }, [allTabs]);

  const settingsTabGroups = useMemo(() => {
    const query = settingsSearch.trim().toLowerCase();
    const matches = (tab: typeof tabs[number]) => !query || t(tab.labelKey).toLowerCase().includes(query);
    const pick = (ids: SettingsTab[]) => tabs.filter((tab) => ids.includes(tab.id) && matches(tab));
    return [
      { id: 'priority', label: '常用', tabs: pick(['general', 'ai']) },
      { id: 'workspace', label: '协作与能力', tabs: pick(['team', 'platforms', 'skills']) },
      { id: 'connections', label: '连接', tabs: pick(['mcp', 'remote', 'profile']) },
      { id: 'advanced', label: '高级', tabs: pick(['tools', 'experimental']) },
    ].filter((group) => group.tabs.length > 0);
  }, [settingsSearch, t, tabs]);

  useEffect(() => {
    if (tabs.some((tab) => tab.id === activeTab)) return;
    setActiveTab(tabs[0]?.id || 'general');
  }, [activeTab, tabs]);

  return (
    <div className="workbench-settings flex h-full min-w-0 text-text-primary">
      {settingsSubView === 'ai-pricing' ? (
        renderAiPricingPage()
      ) : (
        <>
      {/* Sidebar */}
      <div className="workbench-settings__sidebar w-56 border-r border-border pt-6 pb-4 flex flex-col gap-1 px-3 bg-surface-secondary/20">
        {onReturn && (
          <button
            type="button"
            onClick={onReturn}
            className="mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-secondary/50 hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            返回应用
          </button>
        )}
        <h1 className="px-3 mb-3 text-xs font-bold text-text-tertiary uppercase tracking-wider">{t('settings.title')}</h1>
        <label className="workbench-settings__search">
          <Search className="h-4 w-4" strokeWidth={1.7} />
          <input
            type="search"
            value={settingsSearch}
            onChange={(event) => setSettingsSearch(event.target.value)}
            placeholder="搜索设置"
          />
        </label>
        <div className="flex flex-1 flex-col gap-3 min-h-0 overflow-y-auto pt-3">
          {settingsTabGroups.map((group) => {
            const advanced = group.id === 'advanced';
            const expanded = !advanced || advancedSettingsOpen || Boolean(settingsSearch.trim());
            return (
              <section key={group.id} className="workbench-settings__group">
                {advanced ? (
                  <button
                    type="button"
                    className="workbench-settings__group-label workbench-settings__group-toggle"
                    onClick={() => setAdvancedSettingsOpen((open) => !open)}
                    aria-expanded={expanded}
                  >
                    <span>{group.label}</span>
                    <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} strokeWidth={1.7} />
                  </button>
                ) : (
                  <div className="workbench-settings__group-label">{group.label}</div>
                )}
                {expanded && group.tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={clsx(
                      'workbench-settings__tab flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors',
                      activeTab === tab.id ? 'is-active text-text-primary' : 'text-text-secondary hover:text-text-primary'
                    )}
                  >
                    <tab.icon className="w-4 h-4" />
                    {t(tab.labelKey)}
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 overflow-auto">
        <div
          className={clsx(
            'px-8 py-8 pb-32',
            activeTab === 'ai' ? 'max-w-5xl' : activeTab === 'platforms' ? 'max-w-3xl' : 'max-w-2xl'
          )}
        >
          <form onSubmit={handleSave} className="space-y-10">

            {/* General Tab */}
            {activeTab === 'general' && (
              <GeneralSettingsSection
                appVersion={appVersion}
                formData={formData}
                setFormData={setFormData}
                notificationSettings={notificationSettings}
                setNotificationSettings={setNotificationSettings}
                handleTestNotificationSound={handleTestNotificationSound}
                handlePickWorkspaceDir={handlePickWorkspaceDir}
                handleResetWorkspaceDir={handleResetWorkspaceDir}
                fileIndexDashboard={fileIndexDashboard}
                fileIndexLoading={isFileIndexDashboardLoading}
                handleRefreshFileIndexDashboard={async () => {
                  await loadFileIndexDashboard({ force: true });
                }}
                recentDebugLogs={recentDebugLogs}
                isDebugLogsLoading={isDebugLogsLoading}
                handleRefreshDebugLogs={loadRecentDebugLogs}
                handleOpenDebugLogDir={openDebugLogDirectory}
                logStatus={logStatus}
                pendingReports={pendingDiagnosticReports}
                diagnosticsActionBusy={diagnosticsActionBusy}
                handleOpenFeedbackReport={handleOpenFeedbackReport}
                handleExportDiagnosticBundle={handleExportDiagnosticBundle}
                handleUploadPendingReport={handleUploadPendingReport}
                handleDismissPendingReport={handleDismissPendingReport}
                handleVersionTap={handleVersionTap}
                handleShowCurrentReleaseNotes={handleShowCurrentReleaseNotes}
                handleInstallBrowserPlugin={handleInstallBrowserPlugin}
              />
            )}

            {/* Experimental Tab */}
            {activeTab === 'experimental' && (
              <ExperimentalSettingsSection
                formData={formData}
                setFormData={setFormData}
              />
            )}

            {activeTab === 'remote' && (
              <RemoteConnectionSettingsSection
                assistantDaemonStatus={assistantDaemonStatus}
                assistantDaemonDraft={assistantDaemonDraft}
                setAssistantDaemonDraft={setAssistantDaemonDraft}
                assistantDaemonLogs={assistantDaemonLogs}
                assistantDaemonBusy={assistantDaemonBusy}
                assistantDaemonAcpToken={assistantDaemonAcpToken}
                assistantDaemonWeixinLogin={assistantDaemonWeixinLogin}
                assistantDaemonWeixinLoginBusy={assistantDaemonWeixinLoginBusy}
                handleReloadAssistantDaemonStatus={loadAssistantDaemonStatus}
                handleSaveAssistantDaemonConfig={handleSaveAssistantDaemonConfig}
                handleCreateAssistantDaemonAcpClient={handleCreateAssistantDaemonAcpClient}
                handleRevokeAssistantDaemonAcpClient={handleRevokeAssistantDaemonAcpClient}
                handleStartAssistantDaemon={handleStartAssistantDaemon}
                handleStopAssistantDaemon={handleStopAssistantDaemon}
                handleStartAssistantDaemonWeixinLogin={handleStartAssistantDaemonWeixinLogin}
                handleCheckAssistantDaemonWeixinLogin={handleCheckAssistantDaemonWeixinLogin}
                handleClearAssistantDaemonWeixinLogin={handleClearAssistantDaemonWeixinLogin}
              />
            )}

            {activeTab === 'platforms' && (
              <EcommercePlatformsSettingsSection
                settings={ecommercePlatformsSettings}
                onTogglePlatform={handleToggleEcommercePlatform}
              />
            )}

            {/* AI Tab */}
            {activeTab === 'ai' && (
              <div className="space-y-10">
                {/* LLM Connection Config */}
                <section className="space-y-6">
                  {officialAiPanelEnabled && (
                    <div ref={officialAiPanelRef} className="space-y-4 scroll-mt-6">
                      {OfficialAiPanelComponent ? (
                        <OfficialAiPanelComponent
                          onReloadSettings={reloadCustomAiSettings}
                          onOpenPricing={handleOpenAiPricing}
                        />
                      ) : (
                        <div className="rounded-xl border border-border bg-surface-secondary/20 p-4 text-sm text-text-tertiary">
                          正在加载账号信息...
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-xl border border-border bg-surface-secondary/20 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowAiModelSettings((prev) => !prev)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-secondary/40"
                      aria-expanded={showAiModelSettings}
                      aria-controls="ai-model-settings-panel"
                    >
                      <span className="text-sm font-medium text-text-primary">
                        {hasOfficialAiPanel ? '高级：自定义供应商' : 'AI 供应商'}
                      </span>
                      <ChevronDown className={clsx('h-4 w-4 text-text-tertiary transition-transform', showAiModelSettings && 'rotate-180')} />
                    </button>

                    {showAiModelSettings && (
                      <div id="ai-model-settings-panel" className="space-y-4 border-t border-border/70 p-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
	                      <div>
	                        <h3 className="text-sm font-medium text-text-primary">聊天供应商</h3>
	                        <p className="text-[11px] text-text-tertiary mt-1">
	                          {hasOfficialAiPanel
	                            ? '支持多供应商、多模型；聊天能力在下方单独选择官方或自定义路由。'
	                            : '支持多供应商、多模型；当前使用自定义供应商路由。'}
	                        </p>
	                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setTestStatus('idle');
                            setTestMsg('');
                          }}
                          className="px-3 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary transition-colors"
                        >
                          清除状态
                        </button>
                        <button
                          type="button"
                          onClick={openCreateAiSourceModal}
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                          添加供应商
                        </button>
                      </div>
                    </div>

	                    <div className="rounded-xl border border-border bg-surface-secondary/20 p-2 space-y-2">
	                      {displayedAiSources.length ? displayedAiSources.map((source) => {
	                        const preset = findAiPresetById(source.presetId);
	                        const isExpanded = aiSourceExpandState[source.id] ?? false;
                        const isOfficialSource = isOfficialManagedSource(source);
                        const isOfficialPlaceholder = isOfficialSource && !hasOfficialManagedSource;
                        const isModelListExpanded = aiSourceModelExpandState[source.id] ?? false;
                        const sourceModels = getAddedSourceModelList(source);
                        const discoveredModels = discoveredModelsBySource[source.id] || [];
                        const addedModelIds = new Set(sourceModels.map((model) => model.id));
                        const selectableDiscoveredModels = discoveredModels.filter((model) => !addedModelIds.has(model.id));
                        const isDiscoveringModels = Boolean(sourceModelDiscoveryBusy[source.id]);
                        const discoveryMessage = sourceModelDiscoveryMessages[source.id] || '';
                        const isPrivateGatewaySource = isOfficialSource && OFFICIAL_SOURCE_IS_PRIVATE_GATEWAY;
                        const isOfficialSourcePending = isOfficialSource && !isPrivateGatewaySource && officialAuthPending;
                        const isOfficialSourceLoggedIn = isOfficialSource && (isPrivateGatewaySource || officialAuthLoggedIn);
                        const isOfficialSourceUnavailable = isOfficialSource && !isPrivateGatewaySource && !officialAuthLoggedIn;
                        const sourceModelsForDisplay = isOfficialSource
                          ? (isOfficialSourceLoggedIn ? sourceModels : [])
                          : sourceModels;
                        const localGuide = getLocalGuideForSource(source);
                        const allowEmptyKey = isLocalAiSource(source);

                        return (
                          <div key={source.id} className="rounded-lg border border-border bg-surface-primary overflow-hidden">
                            <div className="px-3 py-2 border-b border-border/70 flex items-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => handleToggleAiSourceExpand(source.id)}
                                className="text-text-tertiary hover:text-text-primary transition-colors"
                                title={isExpanded ? '收起' : '展开'}
                              >
                                <ChevronDown className={clsx('w-4 h-4 transition-transform', !isExpanded && '-rotate-90')} />
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 min-w-0">
	                                  <AiSourceLogo source={source} />
	                                  <span className="text-sm font-medium text-text-primary truncate">{source.name || '未命名供应商'}</span>
	                                </div>
                                <p className="text-[11px] text-text-tertiary mt-0.5 truncate">
                                  {isPrivateGatewaySource
                                    ? `${PRIVATE_GATEWAY_DISPLAY_HINT} · ${source.apiKey ? '已配置令牌' : '待填写令牌'} · 默认模型：${source.model || '(未设置)'} · 已添加 ${sourceModelsForDisplay.length} 个模型`
                                    : isOfficialSource
                                    ? isOfficialSourcePending
                                      ? '官方托管供应商 · 正在检查登录状态'
                                      : isOfficialSourceUnavailable
                                      ? '官方托管供应商 · 当前未登录，登录后自动同步官方模型与凭据'
                                      : `已托管登录态 · 默认模型：${source.model || '(未设置)'} · 已添加 ${sourceModelsForDisplay.length} 个模型`
                                    : `${preset?.label || 'Custom'} · 默认模型：${source.model || '(未设置)'} · 已添加 ${sourceModels.length} 个模型`}
                                </p>
                              </div>
                              {isOfficialSourceUnavailable ? (
                                <button
                                  type="button"
                                  onClick={() => setShowAiModelSettings(false)}
                                  className="px-2 py-1 text-[11px] border rounded transition-colors border-border text-text-secondary hover:text-text-primary hover:bg-surface-secondary"
                                  disabled={isOfficialSourcePending}
                                >
                                  {isOfficialSourcePending ? '检查中' : '查看账号'}
                                </button>
	                              ) : (
	                                <>
	                                  {!isOfficialSource && (
	                                    <button
                                      type="button"
                                      onClick={() => handleDeleteAiSource(source.id)}
                                      className="p-1.5 text-text-tertiary hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                      title="删除供应商"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>

                            {isExpanded && (
                              <div className="p-3 space-y-3">
                                {isOfficialSourceUnavailable ? (
                                  <div className={clsx(
                                    'rounded border px-3 py-3 text-[11px] space-y-2',
                                    isOfficialSourcePending
                                      ? 'border-border bg-surface-secondary/30 text-text-secondary'
                                      : 'border-amber-500/25 bg-amber-500/5 text-text-secondary'
                                  )}>
                                    <div className={clsx(
                                      'font-medium',
                                      isOfficialSourcePending ? 'text-text-primary' : 'text-amber-600'
                                    )}>
                                      {isOfficialSourcePending
                                        ? '正在检查登录状态'
                                        : officialAuthNeedsLogin
                                        ? '当前账号登录已失效'
                                        : '当前账号未登录'}
                                    </div>
                                    <p>
                                      {isOfficialSourcePending
                                        ? '正在和宿主同步官方账号状态，完成后会自动刷新这里的模型与凭据。'
                                        : '官方供应商仍会固定显示在这里，但当前不会再使用旧模型和旧凭据。重新登录后会自动恢复同步。'}
                                    </p>
                                    {!isOfficialSourcePending && (
                                      <button
                                        type="button"
                                        onClick={() => setShowAiModelSettings(false)}
                                        className="px-3 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary transition-colors"
                                      >
                                        查看账号
                                      </button>
                                    )}
                                  </div>
                                ) : isPrivateGatewaySource ? (
                                  <>
                                    <div className="rounded border border-border bg-surface-secondary/30 px-3 py-2 text-[11px] text-text-secondary space-y-1">
                                      <div className="font-medium text-text-primary">{PRIVATE_GATEWAY_DISPLAY_HINT}</div>
                                      <div className="font-mono break-all text-text-tertiary">{source.baseURL || OFFICIAL_AI_SOURCE_BASE_URL}</div>
                                      <div>Endpoint 由应用锁定，只需填写网关令牌；模型可直接使用内置清单，或点「获取模型」从网关刷新。</div>
                                    </div>

                                    <PasswordInput
                                      value={source.apiKey}
                                      onChange={(e) => {
                                        updateAiSource(source.id, (prev) => ({ ...prev, apiKey: e.target.value }));
                                        setActiveAiSourceId(source.id);
                                      }}
                                      placeholder="网关令牌 (sk-...)"
                                      className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                                    />

                                    <div className="flex items-center justify-between gap-3 rounded border border-border bg-surface-secondary/20 px-3 py-2">
                                      <div className="min-w-0 text-[11px] text-text-tertiary">
                                        <div className="font-medium text-text-primary">供应商模型列表</div>
                                        <div className="truncate">
                                          {discoveryMessage || '填写网关令牌后，可从网关读取当前令牌可用的模型。'}
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => void fetchAiSourceModels(source)}
                                        disabled={isDiscoveringModels}
                                        className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] border border-border rounded hover:bg-surface-secondary transition-colors disabled:opacity-50"
                                      >
                                        <RefreshCw className={clsx('w-3 h-3', isDiscoveringModels && 'animate-spin')} />
                                        {isDiscoveringModels ? '获取中' : discoveredModels.length ? '刷新模型' : '获取模型'}
                                      </button>
                                    </div>
                                  </>
                                ) : isOfficialSource ? (
                                  <div className="rounded border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-text-secondary">
                                    <div className="font-medium text-emerald-600">已登录</div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                      <input
                                        type="text"
                                        value={source.name}
                                        onChange={(e) => updateAiSource(source.id, (prev) => ({ ...prev, name: e.target.value }))}
                                        placeholder="来源名称"
                                        className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                                      />
                                      <AiPresetSelect
                                        value={source.presetId}
                                        groups={groupedAiPresets}
                                        onChange={(nextPresetId) => {
                                          updateAiSource(source.id, (prev) => {
                                            const previousPreset = findAiPresetById(prev.presetId);
                                            const nextPreset = findAiPresetById(nextPresetId);
                                            const shouldSyncBaseURL = !prev.baseURL || (previousPreset?.baseURL && prev.baseURL === previousPreset.baseURL);
                                            const shouldSyncName = !prev.name || prev.name === previousPreset?.label;
                                            return {
                                              ...prev,
                                              presetId: nextPresetId,
                                              baseURL: shouldSyncBaseURL ? (nextPreset?.baseURL || '') : prev.baseURL,
                                              name: shouldSyncName ? (nextPreset?.label || prev.name) : prev.name,
                                              protocol: nextPreset?.protocol || prev.protocol || 'openai',
                                            };
                                          });
                                          setActiveAiSourceId(source.id);
                                        }}
                                      />
                                      <AiModelSelect
                                        value={source.protocol || 'openai'}
                                        onChange={(value) => {
                                          const protocol = value as AiProtocol;
                                          updateAiSource(source.id, (prev) => ({ ...prev, protocol }));
                                          setDetectedAiProtocol(protocol);
                                          setActiveAiSourceId(source.id);
                                        }}
                                        className="w-full"
                                        options={[
                                          { id: 'openai', label: 'OpenAI Compatible' },
                                          { id: 'anthropic', label: 'Anthropic Native' },
                                          { id: 'gemini', label: 'Gemini Native' },
                                        ]}
                                      />
                                    </div>

                                    <input
                                      type="text"
                                      value={source.baseURL}
                                      onChange={(e) => {
                                        updateAiSource(source.id, (prev) => ({ ...prev, baseURL: e.target.value }));
                                        setActiveAiSourceId(source.id);
                                      }}
                                      placeholder="API Endpoint (Base URL)"
                                      className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                                    />

                                    {localGuide && (
                                      <div className="rounded border border-border bg-surface-secondary/30 px-3 py-2 text-[11px] text-text-secondary space-y-1">
                                        <div className="font-medium text-text-primary">{localGuide.title}</div>
                                        <div className="font-mono">{localGuide.command}</div>
                                        <div className="text-text-tertiary">{localGuide.tip}</div>
                                      </div>
                                    )}

                                    <PasswordInput
                                      value={source.apiKey}
                                      onChange={(e) => {
                                        updateAiSource(source.id, (prev) => ({ ...prev, apiKey: e.target.value }));
                                        setActiveAiSourceId(source.id);
                                      }}
                                      placeholder={allowEmptyKey ? '本地源可留空' : 'API Key'}
                                      className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                                    />
                                    <div className="flex items-center justify-between gap-3 rounded border border-border bg-surface-secondary/20 px-3 py-2">
                                      <div className="min-w-0 text-[11px] text-text-tertiary">
                                        <div className="font-medium text-text-primary">供应商模型列表</div>
                                        <div className="truncate">
                                          {discoveryMessage || '保存 Endpoint 和 API Key 后，可自动读取供应商提供的模型。'}
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => void fetchAiSourceModels(source)}
                                        disabled={isDiscoveringModels}
                                        className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] border border-border rounded hover:bg-surface-secondary transition-colors disabled:opacity-50"
                                      >
                                        <RefreshCw className={clsx('w-3 h-3', isDiscoveringModels && 'animate-spin')} />
                                        {isDiscoveringModels ? '获取中' : discoveredModels.length ? '刷新模型' : '获取模型'}
                                      </button>
                                    </div>
                                  </>
                                )}

                                {(isOfficialSource && !isOfficialSourceLoggedIn) ? (
                                  <div className="rounded border border-dashed border-border px-2.5 py-2 text-[11px] text-text-tertiary">
                                    {isOfficialSourcePending
                                      ? '正在等待官方账号状态检查完成。'
                                      : '请先重新登录，登录后会同步官方模型配置。'}
                                  </div>
                                ) : (
                                  <div className="rounded border border-border bg-surface-secondary/20 p-2.5 space-y-2">
                                    <div className="flex items-center justify-between">
                                      <button
                                        type="button"
                                        onClick={() => handleToggleAiSourceModelExpand(source.id)}
                                        className="flex items-center gap-2 text-xs font-medium text-text-primary"
                                      >
                                        <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', !isModelListExpanded && '-rotate-90')} />
                                        模型列表
                                        <span className="font-normal text-text-tertiary">
                                          已选 {sourceModelsForDisplay.length}
                                          {(!isOfficialSource || isPrivateGatewaySource) && discoveredModels.length > 0 ? ` / 可用 ${discoveredModels.length}` : ''}
                                        </span>
                                      </button>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => openAddModelModal(source)}
                                          className="px-2 py-1 text-[11px] border border-border rounded hover:bg-surface-secondary transition-colors"
                                        >
                                          手动添加
                                        </button>
                                      </div>
                                    </div>

                                    {isModelListExpanded && (
                                      <div className="space-y-2">
                                        {(!isOfficialSource || isPrivateGatewaySource) && selectableDiscoveredModels.length > 0 && (
                                          <AiModelSelect
                                            value=""
                                            onChange={(modelId) => {
                                              const model = selectableDiscoveredModels.find((item) => item.id === modelId);
                                              if (model) handleAddDiscoveredSourceModel(source.id, model);
                                            }}
                                            options={selectableDiscoveredModels.map((model) => ({
                                              id: model.id,
                                              label: model.id,
                                              badges: buildModelCapabilityBadges(model.capabilities),
                                              inputIcons: buildModelInputIcons(model.inputCapabilities),
                                            }))}
                                            placeholder="从供应商可用模型中选择添加"
                                            className="w-full"
                                          />
                                        )}
                                        {sourceModelsForDisplay.length ? (
                                          <div className="space-y-1">
                                        {sourceModelsForDisplay.map((model) => {
                                          const isDefaultModel = source.model === model.id;
                                          return (
                                            <div key={model.id} className="flex items-center justify-between gap-2 rounded border border-border bg-surface-primary px-2.5 py-1.5">
                                              <div className="min-w-0 flex items-center gap-2 flex-wrap">
                                                <button
                                                  type="button"
                                                  onClick={() => handleSetSourceDefaultModel(source.id, model.id)}
                                                  className={clsx(
                                                    'text-[10px] px-1.5 py-0.5 rounded border',
                                                    isDefaultModel
                                                      ? 'border-amber-500/40 text-amber-600 bg-amber-500/10'
                                                      : 'border-border text-text-tertiary hover:text-text-primary'
                                                  )}
                                                >
                                                  默认
                                                </button>
                                                <span className="text-xs text-text-primary truncate">{model.id}</span>
                                                {buildModelCapabilityBadges(model.capabilities).map((badge) => (
                                                  <span
                                                    key={`${model.id}-${badge.text}`}
                                                    className={clsx(
                                                      'px-1.5 py-0.5 rounded text-[10px] leading-none whitespace-nowrap font-medium',
                                                      badge.className || 'text-text-tertiary'
                                                    )}
                                                  >
                                                    {badge.text}
                                                  </span>
                                                ))}
                                                <span className="ml-0.5 flex items-center gap-1">
                                                  {buildModelInputIcons(model.inputCapabilities).map((icon) => {
                                                    const Icon = icon.icon;
                                                    return (
                                                      <span
                                                        key={`${model.id}-${icon.key}`}
                                                        title={icon.label}
                                                        className={clsx('inline-flex h-5 w-5 items-center justify-center rounded-full', icon.className)}
                                                      >
                                                        <Icon className="h-3.5 w-3.5" strokeWidth={2.1} />
                                                      </span>
                                                    );
                                                  })}
                                                </span>
                                              </div>
                                              <button
                                                type="button"
                                                onClick={() => handleRemoveSourceModel(source.id, model.id)}
                                                className="p-1 text-text-tertiary hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                                title="删除模型"
                                              >
                                                <Trash2 className="w-3 h-3" />
                                              </button>
                                            </div>
                                          );
                                        })}
                                          </div>
                                        ) : (
                                          <div className="text-[11px] text-text-tertiary rounded border border-dashed border-border px-2.5 py-2">
                                            {isDiscoveringModels
                                              ? '正在读取供应商模型列表…'
                                              : discoveredModels.length > 0
                                                ? '请从上方列表选择要使用的模型。'
                                                : '暂未发现模型；可点击“获取模型”或使用“手动添加”。'}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {activeAiSourceId === source.id && (
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] text-text-tertiary">
                                      当前协议: <span className="font-mono">{detectedAiProtocol}</span>
                                    </span>
                                    <span
                                      className={clsx(
                                        'text-[11px]',
                                        testStatus === 'success' && 'text-status-success',
                                        testStatus === 'error' && 'text-status-error',
                                        testStatus === 'idle' && 'text-text-tertiary'
                                      )}
                                    >
                                      {testMsg || '等待操作'}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      }) : (
                        <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-text-tertiary">
                          暂无供应商，请先点击“添加供应商”。
                        </div>
                      )}
                    </div>
                  </div>

	                    <div className="pt-4 border-t border-border">
	                      {renderCompactModelRouteRow(
	                        '聊天',
	                        renderCompactRouteControls('chat', [
	                          ...((hasOfficialAiPanel || OFFICIAL_SOURCE_IS_PRIVATE_GATEWAY) ? [{ mode: 'official' as const, label: '官方' }] : []),
	                          { mode: 'custom', label: '自定义', disabled: customAiSources.length === 0 },
	                        ]),
	                        (hasOfficialAiPanel || OFFICIAL_SOURCE_IS_PRIVATE_GATEWAY) && aiModelRoutes.chat.mode === 'official'
	                          ? renderOfficialRouteModelField('chat', '选择聊天模型')
	                          : renderCustomRouteFields(
	                            aiModelRoutes.chat.sourceId || firstCustomAiSource?.id || '',
	                            customAiSources,
	                            (nextSourceId) => {
	                              const normalizedSourceId = canonicalizeOfficialAutoSourceId(nextSourceId);
	                              const source = getAiSourceById(normalizedSourceId) || firstCustomAiSource;
	                              const model = pickBestModelForSource(source, aiModelRoutes.chat.model, 'chat');
	                              updateAiModelRoute('chat', {
	                                mode: 'custom',
	                                sourceId: source?.id || normalizedSourceId,
	                                model,
	                              });
	                              if (source?.id) {
	                                setActiveAiSourceId(source.id);
	                                setAiSourceExpandState((prev) => ({ ...prev, [source.id]: true }));
	                              }
	                              setFormData((prev) => ({ ...prev, model_name: model }));
	                            },
	                            currentRouteModelValue('chat'),
	                            chatRouteSourceModels,
	                            (modelId) => applyRouteModel('chat', modelId),
	                            '请选择聊天模型',
	                            !chatRouteSource || chatRouteSourceModels.length === 0,
	                          )
	                      )}
	                    </div>



                  <div className="pt-4 border-t border-border space-y-3">
                    <h3 className="text-sm font-medium text-text-primary">转录模型设置</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="group">
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                          供应商
                        </label>
                        <AiSourceSelect
                          value={transcriptionSourceId}
                          sources={aiSources}
                          onChange={(nextSourceId) => handleLinkedSourceChange('transcription', nextSourceId)}
                          className="w-full"
                        />
                      </div>
                      <div className="group">
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                          模型
                        </label>
                        <AiModelSelect
                          value={formData.transcription_model}
                          onChange={(modelId) => setFormData((d) => ({ ...d, transcription_model: modelId }))}
                          options={transcriptionSourceModels.map((model) => ({
                            id: model.id,
                            label: model.id,
                            badges: buildModelCapabilityBadges(model.capabilities),
                            inputIcons: buildModelInputIcons(model.inputCapabilities),
                          }))}
                          disabled={!transcriptionSourceModels.length}
                          placeholder="请先在该供应商中添加模型"
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border space-y-3">
                    <h3 className="text-sm font-medium text-text-primary">Embedding 模型设置</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="group">
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">
                            供应商
                          </label>
                          <AiSourceSelect
                            value={embeddingSourceId}
                            sources={aiSources}
                            onChange={(nextSourceId) => handleLinkedSourceChange('embedding', nextSourceId)}
                            className="w-full"
                          />
                        </div>
                        <div className="group">
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">
                            模型
                          </label>
                          <AiModelSelect
                            value={formData.embedding_model}
                            onChange={(modelId) => setFormData((d) => ({ ...d, embedding_model: modelId }))}
                            className="w-full"
                            disabled={!embeddingSourceModels.length}
                            placeholder="请先在该供应商中添加模型"
                            options={embeddingSourceModels.map((model) => ({
                              id: model.id,
                              label: model.id,
                              badges: buildModelCapabilityBadges(model.capabilities),
                              inputIcons: buildModelInputIcons(model.inputCapabilities),
                            }))}
                          />
                        </div>
                      </div>
                  </div>

                  <div className="pt-4 border-t border-border space-y-3">
                    <h3 className="text-sm font-medium text-text-primary">生图模型设置</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="group">
                            <label className="block text-xs font-medium text-text-secondary mb-1.5">
                              供应商
                            </label>
                            <AiSourceSelect
                              value={imageSourceId}
                              sources={displayedAiSources}
                              onChange={(nextSourceId) => handleLinkedSourceChange('image', nextSourceId)}
                              className="w-full"
                            />
                          </div>
                          <div className="group">
                            <label className="block text-xs font-medium text-text-secondary mb-1.5">
                              模型
                            </label>
                            <AiModelSelect
                              value={formData.image_model}
                              onChange={(modelId) => setFormData((d) => ({ ...d, image_model: modelId }))}
                              className="w-full"
                              disabled={!imageSourceModels.length}
                              placeholder="请先在该源中添加模型"
                              options={imageSourceModels.map((model) => ({
                                id: model.id,
                                label: model.id,
                                badges: buildModelCapabilityBadges(model.capabilities),
                                inputIcons: buildModelInputIcons(model.inputCapabilities),
                              }))}
                            />
                          </div>
                        </div>
                  </div>

                  <div className="pt-4 border-t border-border space-y-3">
                    <h3 className="text-sm font-medium text-text-primary">TTS 模型设置</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="group">
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                          供应商
                        </label>
                        <AiSourceSelect
                          value={voiceSourceId}
                          sources={aiSources}
                          onChange={(nextSourceId) => handleLinkedSourceChange('voice', nextSourceId)}
                          className="w-full"
                        />
                      </div>
                      <div className="group">
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                          模型
                        </label>
                        <AiModelSelect
                          value={formData.voice_tts_model}
                          onChange={(modelId) => applyRouteModel('voiceTts', modelId)}
                          className="w-full"
                          disabled={!voiceTtsSourceModels.length}
                          placeholder="请先在该供应商中添加 TTS 模型"
                          options={voiceTtsSourceModels.map((model) => ({
                            id: model.id,
                            label: model.id,
                            badges: buildModelCapabilityBadges(model.capabilities),
                            inputIcons: buildModelInputIcons(model.inputCapabilities),
                          }))}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border">
                    <div className="mb-4">
                      <h3 className="text-sm font-medium text-text-primary">知识库视觉索引模型</h3>
                    </div>

                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="group">
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">
                            供应商
                          </label>
                          <AiSourceSelect
                            value={visualIndexSourceId}
                            sources={aiSources}
                            onChange={(nextSourceId) => handleLinkedSourceChange('visual', nextSourceId)}
                            className="w-full"
                          />
                        </div>
                        <div className="group">
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">
                            模型
                          </label>
                          <AiModelSelect
                            value={formData.visual_index_model}
                            onChange={(modelId) => setFormData((d) => ({ ...d, visual_index_model: modelId }))}
                            className="w-full"
                            disabled={!visualIndexSourceModels.length}
                            placeholder="请先在该供应商中添加支持图片输入的模型"
                            options={visualIndexSourceModels.map((model) => ({
                              id: model.id,
                              label: model.id,
                              badges: buildModelCapabilityBadges(model.capabilities),
                              inputIcons: buildModelInputIcons(model.inputCapabilities),
                            }))}
                          />
                        </div>
                      </div>

                    </div>
                  </div>

                  <div className="pt-4 border-t border-border">
                    <div className="mb-4">
                      <h3 className="text-sm font-medium text-text-primary">视频分析专用模型</h3>
                    </div>

                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="group">
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">
                            供应商
                          </label>
                          <AiSourceSelect
                            value={videoAnalysisSourceId}
                            sources={aiSources}
                            onChange={(nextSourceId) => handleLinkedSourceChange('videoAnalysis', nextSourceId)}
                            className="w-full"
                          />
                        </div>
                        <div className="group">
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">
                            模型
                          </label>
                          <AiModelSelect
                            value={formData.video_analysis_model}
                            onChange={(modelId) => setFormData((d) => ({ ...d, video_analysis_model: modelId }))}
                            className="w-full"
                            disabled={!videoAnalysisSourceModels.length}
                            placeholder="请先在该供应商中添加支持视频输入的模型"
                            options={videoAnalysisSourceModels.map((model) => ({
                              id: model.id,
                              label: model.id,
                              badges: buildModelCapabilityBadges(model.capabilities),
                              inputIcons: buildModelInputIcons(model.inputCapabilities),
                            }))}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">直传上限（bytes）</label>
                          <input
                            type="number"
                            min={1048576}
                            max={536870912}
                            value={formData.video_analysis_max_direct_video_bytes}
                            onChange={(e) => setFormData((d) => ({ ...d, video_analysis_max_direct_video_bytes: e.target.value }))}
                            className="w-full rounded border border-border bg-surface-secondary/30 px-3 py-2 text-sm transition-colors focus:border-accent-primary focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">协议</label>
                          <input
                            value={formData.video_analysis_protocol}
                            onChange={(e) => setFormData((d) => ({ ...d, video_analysis_protocol: e.target.value }))}
                            className="w-full rounded border border-border bg-surface-secondary/30 px-3 py-2 text-sm transition-colors focus:border-accent-primary focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-medium text-text-primary">视频生成服务商</h3>
                        <p className="mt-1 text-[11px] text-text-tertiary">每个服务商独立维护 Endpoint、API Key 和模型列表；同一时间只能启用一个。</p>
                      </div>
                      <button
                        type="button"
                        onClick={openVideoProviderCreate}
                        className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1.5 text-xs hover:bg-surface-secondary transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        新增服务商
                      </button>
                    </div>

                    {isVideoProviderCreateOpen && (
                      <div className="grid grid-cols-1 gap-2 rounded-lg border border-accent-primary/30 bg-accent-primary/5 p-3 md:grid-cols-[180px_minmax(0,1fr)_auto]">
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">服务商类型</label>
                          <select
                            value={videoProviderCreatePreset}
                            onChange={(e) => handleVideoProviderCreatePresetChange(e.target.value as VideoGenerationProviderPreset)}
                            className="w-full rounded border border-border bg-surface-primary px-3 py-2 text-sm focus:border-accent-primary focus:outline-none"
                          >
                            <option value="gardenflow">GardenFlow Seedance</option>
                            <option value="new-api">{defaultVideoProviderName('new-api')}</option>
                            <option value="aliyun-bailian">阿里云百炼</option>
                            <option value="minimax">MiniMax</option>
                            <option value="custom">自定义服务商</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">服务商名称</label>
                          <input
                            value={videoProviderCreateName}
                            onChange={(e) => setVideoProviderCreateName(e.target.value)}
                            className="w-full rounded border border-border bg-surface-primary px-3 py-2 text-sm focus:border-accent-primary focus:outline-none"
                          />
                        </div>
                        <div className="flex items-end gap-2">
                          <button
                            type="button"
                            onClick={() => setIsVideoProviderCreateOpen(false)}
                            className="rounded border border-border px-3 py-2 text-xs hover:bg-surface-secondary"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={handleAddVideoProvider}
                            disabled={!videoProviderCreateName.trim()}
                            className="rounded bg-text-primary px-3 py-2 text-xs text-background disabled:opacity-50"
                          >
                            确认新增
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-1.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">正在编辑的服务商</label>
                        <select
                          value={selectedVideoProvider?.id || ''}
                          onChange={(e) => {
                            setSelectedVideoProviderId(e.target.value);
                            setVideoModelDraft('');
                          }}
                          className="w-full rounded border border-border bg-surface-secondary/30 px-3 py-2 text-sm focus:border-accent-primary focus:outline-none"
                        >
                          {videoProviders.map((provider) => (
                            <option key={provider.id} value={provider.id}>
                              {provider.name}{provider.id === activeVideoProviderId ? '（启用中）' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">
                        当前启用：{videoProviders.find((provider) => provider.id === activeVideoProviderId)?.name || '未设置'}
                      </div>
                    </div>

                    {selectedVideoProvider && (
                      <div className="space-y-3 rounded-lg border border-border bg-surface-secondary/15 p-3">
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-[220px] flex-1">
                            <label className="block text-xs font-medium text-text-secondary mb-1.5">服务商名称</label>
                            <input
                              type="text"
                              value={selectedVideoProvider.name}
                              onChange={(e) => updateSelectedVideoProvider({ name: e.target.value })}
                              placeholder="输入视频生成服务商名称"
                              className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleActivateVideoProvider(selectedVideoProvider.id)}
                            disabled={selectedVideoProvider.id === activeVideoProviderId}
                            className="rounded border border-emerald-500/40 px-3 py-2 text-xs text-emerald-600 hover:bg-emerald-500/10 transition-colors disabled:cursor-default disabled:bg-emerald-500/10 disabled:opacity-70"
                          >
                            {selectedVideoProvider.id === activeVideoProviderId ? '当前已启用' : '启用此服务商'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveVideoProvider(selectedVideoProvider.id)}
                            disabled={videoProviders.length <= 1}
                            className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-xs text-text-tertiary hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500 transition-colors disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            删除
                          </button>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">Endpoint</label>
                          <input
                            type="text"
                            value={selectedVideoProvider.endpoint}
                            onChange={(e) => updateSelectedVideoProvider({ endpoint: e.target.value })}
                            placeholder={selectedVideoProvider.preset === 'aliyun-bailian'
                              ? 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis'
                              : selectedVideoProvider.preset === 'minimax'
                                ? 'https://api.minimaxi.com'
                              : 'https://example.com/v1'}
                            className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">API Key</label>
                          <PasswordInput
                            value={selectedVideoProvider.apiKey}
                            onChange={(e) => updateSelectedVideoProvider({ apiKey: e.target.value })}
                            placeholder={selectedVideoProvider.preset === 'aliyun-bailian'
                              ? 'DASHSCOPE_API_KEY'
                              : selectedVideoProvider.preset === 'minimax'
                                ? 'MINIMAX_API_KEY'
                                : '输入该服务商的 API Key'}
                            className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">当前使用模型</label>
                          <select
                            value={selectedVideoProvider.model}
                            onChange={(e) => selectConfiguredVideoModel(e.target.value)}
                            className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                          >
                            {!videoModelOptions.length && <option value="">请先添加模型</option>}
                            {videoModelOptions.map((model) => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">添加模型</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={videoModelDraft}
                              onChange={(e) => setVideoModelDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddVideoModel();
                                }
                              }}
                              placeholder={selectedVideoProvider.preset === 'minimax'
                                ? '输入模型 ID，如 MiniMax-H3'
                                : '输入模型 ID，如 happyhorse-1.1-r2v'}
                              className="min-w-0 flex-1 bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                            />
                            <button
                              type="button"
                              onClick={handleAddVideoModel}
                              disabled={!videoModelDraft.trim()}
                              className="shrink-0 inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-xs hover:bg-surface-secondary transition-colors disabled:opacity-50"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              添加
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1.5">该服务商的模型</label>
                          <div className="flex min-h-10 flex-wrap gap-1.5 rounded border border-border bg-surface-primary/60 p-2">
                            {videoModelOptions.length ? videoModelOptions.map((model) => (
                              <span
                                key={model}
                                className={clsx(
                                  'inline-flex max-w-full items-center gap-1 rounded border px-2 py-1 text-xs',
                                  model === selectedVideoProvider.model
                                    ? 'border-accent-primary/50 bg-accent-primary/10 text-text-primary'
                                    : 'border-border text-text-secondary'
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => selectConfiguredVideoModel(model)}
                                  className="max-w-[360px] truncate"
                                  title={`选择 ${model}`}
                                >
                                  {model}
                                </button>
                                {videoModelOptions.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveVideoModel(model)}
                                    className="rounded p-0.5 text-text-tertiary hover:bg-red-500/10 hover:text-red-500"
                                    title={`删除 ${model}`}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </span>
                            )) : (
                              <span className="text-xs text-text-tertiary">尚未添加模型</span>
                            )}
                          </div>
                        </div>
                        {selectedVideoProvider.preset === 'aliyun-bailian' && (
                          <p className="text-[11px] text-text-tertiary">
                            百炼 Endpoint 可填写完整 video-synthesis 地址或工作空间的 /api/v1 地址。HappyHorse 参考图模型需要 1–9 张参考图。
                          </p>
                        )}
                        {selectedVideoProvider.preset === 'minimax' && (
                          <p className="text-[11px] text-text-tertiary">
                            MiniMax H3 使用原生 V2 异步接口，支持文生视频、首尾帧和最多 9 张参考图；720p/1080p 会分别映射为 768P/2K。
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <ImageHostingSettingsSection
                    value={String(formData.image_hosting_json || '')}
                    onChange={(nextJson) => setFormData((data) => ({ ...data, image_hosting_json: nextJson }))}
                  />

                  <div className="pt-4 border-t border-border">
                    <h3 className="text-sm font-medium text-text-primary mb-4">聊天输出上限（max_tokens）</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="group">
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                          通用模型 max_tokens
                        </label>
                        <input
                          type="number"
                          min={MIN_CHAT_MAX_TOKENS}
                          step={1}
                          value={formData.chat_max_tokens_default}
                          onChange={e => setFormData(d => ({ ...d, chat_max_tokens_default: e.target.value }))}
                          onBlur={e => setFormData(d => ({
                            ...d,
                            chat_max_tokens_default: sanitizeChatMaxTokensInput(e.target.value, DEFAULT_CHAT_MAX_TOKENS),
                          }))}
                          className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                        />
                        <p className="mt-1 text-[11px] text-text-tertiary">
                          默认 262144，最低 1024。用于除 DeepSeek 外的 OpenAI 兼容模型。
                        </p>
                      </div>

                      <div className="group">
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                          DeepSeek max_tokens
                        </label>
                        <input
                          type="number"
                          min={MIN_CHAT_MAX_TOKENS}
                          step={1}
                          value={formData.chat_max_tokens_deepseek}
                          onChange={e => setFormData(d => ({ ...d, chat_max_tokens_deepseek: e.target.value }))}
                          onBlur={e => setFormData(d => ({
                            ...d,
                            chat_max_tokens_deepseek: sanitizeChatMaxTokensInput(e.target.value, DEFAULT_CHAT_MAX_TOKENS_DEEPSEEK),
                          }))}
                          className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                        />
                        <p className="mt-1 text-[11px] text-text-tertiary">
                          默认 131072，最低 1024。若服务端报 max_tokens 越界，可在此下调。
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border">
                    <h3 className="text-sm font-medium text-text-primary mb-4">{APP_BRAND.aiDisplayName} 上下文压缩策略</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="group">
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                          自动压缩阈值（tokens）
                        </label>
                        <input
                          type="number"
                          min={16000}
                          step={1000}
                          value={formData.gardenflow_compact_target_tokens}
                          onChange={e => setFormData(d => ({ ...d, gardenflow_compact_target_tokens: e.target.value }))}
                          className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                        />
                        <p className="mt-1 text-[11px] text-text-tertiary">
                          默认 256000。{APP_BRAND.aiDisplayName} 对话预计上下文超过该值时会自动 compact。
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border">
                    <h3 className="text-sm font-medium text-text-primary mb-4">选题中心模式</h3>
                    <div className="bg-surface-secondary/30 rounded-lg border border-border p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="text-sm font-medium text-text-primary">多选题模式</h4>
                          <p className="text-xs text-text-tertiary mt-1.5 leading-relaxed">
                            选题中心默认使用 Agent Runtime。关闭时每次生成 1 个方向；开启后每次基于同样素材一次性生成 3 个方向供选择。
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setFormData((d) => ({ ...d, wander_deep_think_enabled: !d.wander_deep_think_enabled }))}
                          className="ui-switch-track shrink-0 mt-0.5"
                          data-size="md"
                          data-state={formData.wander_deep_think_enabled ? 'on' : 'off'}
                        >
                          <div className="ui-switch-thumb" />
                        </button>
                      </div>
                    </div>
                  </div>
                      </div>
                    )}
                  </div>

                </section>
              </div>
            )}

            {activeTab === 'team' && (
              <TeamSettingsSection
                advisors={teamAdvisors}
                loading={isTeamAdvisorsLoading}
                busyAdvisorId={teamAdvisorBusyId}
                draggingAdvisorId={draggingTeamAdvisorId}
                onCreateAdvisor={handleCreateTeamAdvisor}
                onToggleVisible={handleToggleTeamAdvisorVisible}
                onOpenSettings={handleOpenTeamAdvisorSettings}
                onDragStart={handleTeamAdvisorDragStart}
                onDragOver={handleTeamAdvisorDragOver}
                onDragEnd={handleTeamAdvisorDragEnd}
              />
            )}

            {activeTab === 'skills' && (
              <div className="space-y-6">
                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-medium text-text-primary">技能</h2>
                      <p className="mt-1 text-xs text-text-tertiary">管理当前可用技能。内置技能由系统依赖，始终保持打开。</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={openSkillMarketplace}
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-secondary"
                      >
                        <Store className="h-3.5 w-3.5" />
                        技能市场
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadSettingsSkills()}
                        disabled={isSettingsSkillsLoading}
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-secondary disabled:opacity-50"
                      >
                        <RefreshCw className={clsx('h-3.5 w-3.5', isSettingsSkillsLoading && 'animate-spin')} />
                        刷新
                      </button>
                    </div>
                  </div>

                  {settingsSkillStatusMessage && (
                    <div className="rounded-lg border border-border bg-surface-secondary/30 px-3 py-2 text-xs text-text-secondary">
                      {settingsSkillStatusMessage}
                    </div>
                  )}
                </section>

                <section className="overflow-hidden rounded-xl border border-border bg-surface-primary">
                  {isSettingsSkillsLoading && settingsSkills.length === 0 ? (
                    <div className="flex items-center gap-2 px-4 py-5 text-sm text-text-tertiary">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      正在读取技能
                    </div>
                  ) : settingsSkills.length === 0 ? (
                    <div className="px-4 py-5 text-sm text-text-tertiary">暂无技能</div>
                  ) : (
                    <div className="divide-y divide-border">
                      {builtinSettingsSkills.length > 0 && (
                        <div>
                          <button
                            type="button"
                            onClick={() => setAreBuiltinSkillsExpanded((value) => !value)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-secondary/40"
                            aria-expanded={areBuiltinSkillsExpanded}
                          >
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-2">
                                <ChevronDown className={clsx(
                                  'h-4 w-4 shrink-0 text-text-tertiary transition-transform',
                                  !areBuiltinSkillsExpanded && '-rotate-90'
                                )} />
                                <span className="text-sm font-medium text-text-primary">内置技能</span>
                                <span className="rounded-full bg-accent-primary/10 px-2 py-0.5 text-[10px] font-medium text-accent-primary">
                                  {builtinSettingsSkills.length}
                                </span>
                              </div>
                            </div>
                            <span className="shrink-0 text-xs text-text-tertiary">
                              {areBuiltinSkillsExpanded ? '收起' : '展开'}
                            </span>
                          </button>
                          {areBuiltinSkillsExpanded && (
                            <div className="divide-y divide-border border-t border-border bg-surface-secondary/10">
                              {builtinSettingsSkills.map(renderSettingsSkillRow)}
                            </div>
                          )}
                        </div>
                      )}
                      {editableSettingsSkills.map(renderSettingsSkillRow)}
                    </div>
                  )}
                </section>

                {isSkillMarketplaceOpen && (
                  <div
                    className="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 px-5 py-6"
                    onMouseDown={() => setIsSkillMarketplaceOpen(false)}
                  >
                    <div
                      className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface-primary shadow-2xl"
                      onMouseDown={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                        <h3 className="text-sm font-medium text-text-primary">技能市场</h3>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void loadSkillMarketplace()}
                            disabled={isSkillMarketplaceLoading}
                            className="flex items-center gap-2 rounded border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-secondary disabled:opacity-50"
                          >
                            <RefreshCw className={clsx('h-3 w-3', isSkillMarketplaceLoading && 'animate-spin')} />
                            刷新
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsSkillMarketplaceOpen(false)}
                            className="flex h-8 w-8 items-center justify-center rounded border border-border text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                            aria-label="关闭"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto">
                        {isSkillMarketplaceLoading && skillMarketplaceItems.length === 0 ? (
                          <div className="flex items-center gap-2 px-4 py-6 text-xs text-text-tertiary">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            正在读取市场
                          </div>
                        ) : skillMarketplaceItems.length === 0 ? (
                          <div className="px-4 py-8 text-center text-xs text-text-tertiary">市场暂无技能</div>
                        ) : (
                          <div className="divide-y divide-border">
                            {skillMarketplaceItems.map((skill) => {
                              const busy = skillMarketplaceBusyId === skill.id;
                              return (
                                <div key={`${skill.repo}:${skill.id}`} className="px-4 py-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <div className="truncate text-sm font-medium text-text-primary">{skill.name}</div>
                                        {skill.installed ? (
                                          <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-500">已安装</span>
                                        ) : null}
                                      </div>
                                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-text-tertiary">
                                        {skill.description || skill.repo}
                                      </div>
                                      <div className="mt-2 flex flex-wrap gap-1.5">
                                        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">{skill.id}</span>
                                        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">{skill.repo}</span>
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => void handleInstallMarketplaceSkill(skill)}
                                      disabled={busy || Boolean(skill.installed)}
                                      className="flex shrink-0 items-center gap-1.5 rounded bg-accent-primary px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                                    >
                                      <Download className="h-3 w-3" />
                                      {skill.installed ? '已安装' : busy ? '安装中' : '安装'}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'mcp' && (
              <div className="space-y-6">
                {mcpDraft ? (
                  <section className="mx-auto max-w-3xl space-y-4">
                    <button
                      type="button"
                      onClick={handleCancelMcpDraft}
                      className="inline-flex items-center gap-1 text-xs text-text-tertiary transition-colors hover:text-text-primary"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      返回
                    </button>
                    <div>
                      <h2 className="text-xl font-medium text-text-primary">
                        {mcpDraftOriginalId ? '编辑 MCP Server' : '连接至自定义 MCP'}
                      </h2>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-border bg-surface-primary">
                      <div className="space-y-3 border-b border-border p-3">
                        <label className="block text-xs font-medium text-text-secondary">名称</label>
                        <input
                          value={mcpDraft.name}
                          onChange={(event) => setMcpDraft((draft) => draft ? { ...draft, name: event.target.value } : draft)}
                          placeholder="MCP server name"
                          className="w-full rounded-lg border border-border bg-surface-secondary/20 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent-primary"
                        />
                        <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-surface-secondary/20 p-0.5">
                          {([
                            ['stdio', 'STDIO'],
                            ['streamable-http', '流式 HTTP'],
                          ] as const).map(([transport, label]) => (
                            <button
                              key={transport}
                              type="button"
                              onClick={() => setMcpDraft((draft) => draft ? { ...draft, transport } : draft)}
                              className={clsx(
                                'rounded-md px-3 py-2 text-xs font-medium transition-colors',
                                mcpDraft.transport === transport
                                  ? 'bg-surface-primary text-text-primary shadow-sm'
                                  : 'text-text-tertiary hover:text-text-primary'
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {mcpDraft.transport === 'stdio' ? (
                        <>
                          <div className="space-y-3 border-b border-border p-3">
                            <label className="block text-xs font-medium text-text-secondary">启动命令</label>
                            <input
                              value={mcpDraft.command || ''}
                              onChange={(event) => setMcpDraft((draft) => draft ? { ...draft, command: event.target.value } : draft)}
                              placeholder="openai-dev-mcp"
                              className="w-full rounded-lg border border-border bg-surface-secondary/20 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent-primary"
                            />
                          </div>
                          <div className="space-y-2 border-b border-border p-3">
                            <label className="block text-xs font-medium text-text-secondary">参数</label>
                            {(mcpDraft.args && mcpDraft.args.length ? mcpDraft.args : ['']).map((arg, index) => (
                              <div key={index} className="flex items-center gap-2">
                                <input
                                  value={arg}
                                  onChange={(event) => setMcpDraft((draft) => {
                                    if (!draft) return draft;
                                    const args = [...(draft.args && draft.args.length ? draft.args : [''])];
                                    args[index] = event.target.value;
                                    return { ...draft, args };
                                  })}
                                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface-secondary/20 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent-primary"
                                />
                                <button
                                  type="button"
                                  onClick={() => setMcpDraft((draft) => draft ? { ...draft, args: (draft.args || []).filter((_, itemIndex) => itemIndex !== index) } : draft)}
                                  className="rounded-md p-2 text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-red-600"
                                  aria-label="删除参数"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => setMcpDraft((draft) => draft ? { ...draft, args: [...(draft.args || []), ''] } : draft)}
                              className="w-full rounded-lg bg-surface-secondary/40 px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-secondary"
                            >
                              + 添加参数
                            </button>
                          </div>
                          <div className="space-y-2 border-b border-border p-3">
                            <label className="block text-xs font-medium text-text-secondary">环境变量</label>
                            {Object.entries(mcpDraft.env && Object.keys(mcpDraft.env).length ? mcpDraft.env : { '': '' }).map(([key, value], index) => (
                              <div key={`${key}:${index}`} className="flex items-center gap-2">
                                <input
                                  value={key}
                                  onChange={(event) => setMcpDraft((draft) => {
                                    if (!draft) return draft;
                                    const entries = Object.entries(draft.env || {});
                                    entries[index] = [event.target.value, entries[index]?.[1] || ''];
                                    return { ...draft, env: Object.fromEntries(entries) };
                                  })}
                                  placeholder="键"
                                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface-secondary/20 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent-primary"
                                />
                                <input
                                  value={value}
                                  onChange={(event) => setMcpDraft((draft) => {
                                    if (!draft) return draft;
                                    const entries = Object.entries(draft.env || {});
                                    entries[index] = [entries[index]?.[0] || '', event.target.value];
                                    return { ...draft, env: Object.fromEntries(entries) };
                                  })}
                                  placeholder="值"
                                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface-secondary/20 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent-primary"
                                />
                                <button
                                  type="button"
                                  onClick={() => setMcpDraft((draft) => {
                                    if (!draft) return draft;
                                    const entries = Object.entries(draft.env || {}).filter((_, itemIndex) => itemIndex !== index);
                                    return { ...draft, env: Object.fromEntries(entries) };
                                  })}
                                  className="rounded-md p-2 text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-red-600"
                                  aria-label="删除环境变量"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => setMcpDraft((draft) => draft ? { ...draft, env: { ...(draft.env || {}), '': '' } } : draft)}
                              className="w-full rounded-lg bg-surface-secondary/40 px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-secondary"
                            >
                              + 添加环境变量
                            </button>
                          </div>
                          <div className="space-y-2 border-b border-border p-3">
                            <label className="block text-xs font-medium text-text-secondary">环境变量传递</label>
                            {(mcpDraft.envPassthrough.length ? mcpDraft.envPassthrough : ['']).map((key, index) => (
                              <div key={index} className="flex items-center gap-2">
                                <input
                                  value={key}
                                  onChange={(event) => setMcpDraft((draft) => {
                                    if (!draft) return draft;
                                    const envPassthrough = [...(draft.envPassthrough.length ? draft.envPassthrough : [''])];
                                    envPassthrough[index] = event.target.value;
                                    return { ...draft, envPassthrough };
                                  })}
                                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface-secondary/20 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent-primary"
                                />
                                <button
                                  type="button"
                                  onClick={() => setMcpDraft((draft) => draft ? { ...draft, envPassthrough: draft.envPassthrough.filter((_, itemIndex) => itemIndex !== index) } : draft)}
                                  className="rounded-md p-2 text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-red-600"
                                  aria-label="删除传递变量"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => setMcpDraft((draft) => draft ? { ...draft, envPassthrough: [...draft.envPassthrough, ''] } : draft)}
                              className="w-full rounded-lg bg-surface-secondary/40 px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-secondary"
                            >
                              + 添加变量
                            </button>
                          </div>
                          <div className="space-y-3 p-3">
                            <label className="block text-xs font-medium text-text-secondary">工作目录</label>
                            <input
                              value={mcpDraft.cwd || ''}
                              onChange={(event) => setMcpDraft((draft) => draft ? { ...draft, cwd: event.target.value } : draft)}
                              placeholder="~/code"
                              className="w-full rounded-lg border border-border bg-surface-secondary/20 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent-primary"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="space-y-3 p-3">
                          <label className="block text-xs font-medium text-text-secondary">URL</label>
                          <input
                            value={mcpDraft.url || ''}
                            onChange={(event) => setMcpDraft((draft) => draft ? { ...draft, url: event.target.value } : draft)}
                            placeholder="https://your-mcp-host/mcp"
                            className="w-full rounded-lg border border-border bg-surface-secondary/20 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent-primary"
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleSaveMcpDraft()}
                        disabled={isSyncingMcp}
                        className="rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        保存
                      </button>
                    </div>
                  </section>
                ) : (
                  <>
                    <section className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-medium text-text-primary">MCP 服务器</h2>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void loadMcpRuntimeData()}
                            disabled={isSyncingMcp}
                            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-secondary disabled:opacity-50"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            刷新
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDiscoverAndImportMcp()}
                            disabled={isSyncingMcp}
                            className="rounded-md border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-secondary disabled:opacity-50"
                          >
                            {isSyncingMcp ? '导入中' : '导入'}
                          </button>
                          <button
                            type="button"
                            onClick={handleAddMcpServer}
                            disabled={isSyncingMcp}
                            className="rounded-md bg-accent-primary px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                          >
                            新增
                          </button>
                        </div>
                      </div>

                      {mcpStatusMessage && (
                        <div className="rounded-lg border border-border bg-surface-secondary/30 px-3 py-2 text-xs text-text-secondary">
                          {mcpStatusMessage}
                        </div>
                      )}
                    </section>

                    <section className="overflow-hidden rounded-xl border border-border bg-surface-primary">
                      {mcpServers.length === 0 ? (
                        <div className="px-4 py-5 text-sm text-text-tertiary">暂无 MCP Server</div>
                      ) : (
                        <div className="divide-y divide-border">
                          {mcpServers.map((server) => {
                            const enabled = server.enabled !== false;
                            const runtime = settingsMcpRuntimeMap[server.id];
                            const endpoint = server.transport === 'stdio'
                              ? [server.command, ...(server.args || [])].filter(Boolean).join(' ')
                              : server.url || '';
                            return (
                              <div key={server.id} className="flex items-center justify-between gap-4 px-4 py-3">
                                <div className="min-w-0">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="truncate text-sm font-medium text-text-primary">{server.name || server.id}</span>
                                    <span className="shrink-0 rounded-full bg-surface-secondary px-2 py-0.5 text-[10px] font-medium text-text-tertiary">
                                      {server.transport}
                                    </span>
                                    {runtime && (
                                      <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                                        已连接
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-1 truncate font-mono text-xs text-text-tertiary">
                                    {endpoint || server.id}
                                  </div>
                                  {runtime && (
                                    <div className="mt-1 text-[11px] text-text-tertiary">
                                      calls {runtime.callCount} · tools {runtime.toolCount} · last {formatMcpTime(runtime.lastUsedAt)}
                                    </div>
                                  )}
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleEditMcpServer(server)}
                                    disabled={isSyncingMcp}
                                    className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-secondary disabled:opacity-50"
                                  >
                                    编辑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleTestMcpServer(server)}
                                    disabled={mcpTestingId === server.id || isSyncingMcp}
                                    className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-secondary disabled:opacity-50"
                                  >
                                    {mcpTestingId === server.id ? '测试中' : '测试'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteMcpServer(server.id)}
                                    disabled={isSyncingMcp}
                                    className="rounded-md border border-red-500/30 px-2.5 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                                  >
                                    删除
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleToggleMcpServer(server)}
                                    disabled={isSyncingMcp}
                                    role="switch"
                                    aria-checked={enabled}
                                    aria-label={`${enabled ? '关闭' : '打开'} MCP Server ${server.name || server.id}`}
                                    title={enabled ? '关闭 MCP Server' : '打开 MCP Server'}
                                    className="ui-switch-track shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                                    data-size="sm"
                                    data-state={enabled ? 'on' : 'off'}
                                  >
                                    <span className="ui-switch-thumb" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  </>
                )}
              </div>
            )}

            {/* Profile Tab */}
            {activeTab === 'profile' && (
              <div className="space-y-6">
                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <h2 className="text-lg font-medium text-text-primary">用户创作档案</h2>
                        <button
                          type="button"
                          onClick={() => onOpenGardenFlowOnboarding?.()}
                          className="text-xs font-medium text-text-tertiary underline-offset-4 transition-colors hover:text-text-primary hover:underline"
                        >
                          {gardenflowOnboardingCompleted ? '重新自定义风格' : '去定义风格'}
                        </button>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-text-tertiary">
                        <span
                          className="rounded-full bg-surface-secondary px-2 py-1"
                          title={gardenflowProfileRoot || undefined}
                        >
                          空间：{currentSpaceName}
                        </span>
                        <span className={clsx(
                          'rounded-full px-2 py-1',
                          gardenflowProfileDirty
                            ? 'bg-amber-500/10 text-amber-600'
                            : 'bg-emerald-500/10 text-emerald-600'
                        )}>
                          {gardenflowProfileDirty ? '未保存' : '已同步'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void loadGardenFlowProfileBundle()}
                        disabled={isGardenFlowProfileLoading}
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-secondary disabled:opacity-50"
                      >
                        <RefreshCw className={clsx('h-3.5 w-3.5', isGardenFlowProfileLoading && 'animate-spin')} />
                        {isGardenFlowProfileLoading ? '刷新中' : '刷新'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGardenFlowProfileDraft(savedGardenFlowProfileDraft);
                          setGardenFlowProfileDirtyState(false);
                          setGardenFlowProfileMessage(null);
                          setStatus('idle');
                        }}
                        disabled={!gardenflowProfileDirty}
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-secondary disabled:opacity-50"
                      >
                        还原
                      </button>
                    </div>
                  </div>

                  {gardenflowProfileMessage && (
                    <div className={clsx(
                      'rounded-xl border px-4 py-3 text-sm',
                      gardenflowProfileMessage.tone === 'error'
                        ? 'border-red-500/25 bg-red-500/5 text-red-600'
                        : 'border-emerald-500/25 bg-emerald-500/5 text-emerald-600'
                    )}>
                      {gardenflowProfileMessage.text}
                    </div>
                  )}
                </section>

                <section className="space-y-4">
                  <div className="rounded-xl border border-border bg-surface-secondary/20 p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-medium text-text-primary">用户画像</h3>
                      <p className="mt-1 text-xs leading-6 text-text-tertiary">
                        对应 `user.md`。适合记录称呼、长期目标、目标用户、内容赛道、风格偏好和发布节奏。
                      </p>
                    </div>
                    <textarea
                      value={gardenflowProfileDraft.user}
                      onChange={(event) => handleGardenFlowProfileDraftChange('user', event.target.value)}
                      placeholder="# user.md"
                      spellCheck={false}
                      className="min-h-[280px] w-full rounded-lg border border-border bg-surface-primary px-4 py-3 font-mono text-sm leading-6 text-text-primary focus:border-accent-primary focus:outline-none"
                    />
                  </div>

                  <div className="rounded-xl border border-border bg-surface-secondary/20 p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-medium text-text-primary">创作档案</h3>
                      <p className="mt-1 text-xs leading-6 text-text-tertiary">
                        对应 `CreatorProfile.md`。适合记录内容定位、受众痛点、视觉风格、运营策略、商业目标和长期边界。
                      </p>
                    </div>
                    <textarea
                      value={gardenflowProfileDraft.creatorProfile}
                      onChange={(event) => handleGardenFlowProfileDraftChange('creatorProfile', event.target.value)}
                      placeholder="# CreatorProfile.md"
                      spellCheck={false}
                      className="min-h-[360px] w-full rounded-lg border border-border bg-surface-primary px-4 py-3 font-mono text-sm leading-6 text-text-primary focus:border-accent-primary focus:outline-none"
                    />
                  </div>
                </section>
              </div>
            )}

            {/* Tools Tab */}
            {activeTab === 'tools' && (
              <ToolsSettingsSection
                cliRuntimeTools={cliRuntimeTools}
                cliRuntimeEnvironments={cliRuntimeEnvironments}
                cliRuntimeInstallDraft={cliRuntimeInstallDraft}
                setCliRuntimeInstallDraft={setCliRuntimeInstallDraft}
                cliRuntimeInstallQueue={cliRuntimeInstallQueue}
                cliRuntimeStatusMessage={cliRuntimeStatusMessage}
                isCliRuntimeRefreshing={isCliRuntimeRefreshing}
                cliRuntimeInstalling={cliRuntimeInstalling}
                cliRuntimeInspectingToolId={cliRuntimeInspectingToolId}
                cliRuntimeDiagnosticCommand={cliRuntimeDiagnosticCommand}
                setCliRuntimeDiagnosticCommand={setCliRuntimeDiagnosticCommand}
                cliRuntimeExecutionMode={cliRuntimeExecutionMode}
                setCliRuntimeExecutionMode={handleCliRuntimeExecutionModeChange}
                cliRuntimeDiscoverQuery={cliRuntimeDiscoverQuery}
                setCliRuntimeDiscoverQuery={setCliRuntimeDiscoverQuery}
                cliRuntimeDiscoverResults={cliRuntimeDiscoverResults}
                cliRuntimeDiscovering={cliRuntimeDiscovering}
                cliRuntimeCreatingEnvironment={cliRuntimeCreatingEnvironment}
                handleRefreshCliRuntime={loadCliRuntimeDashboard}
                handleInspectCliRuntimeTool={handleInspectCliRuntimeTool}
                handleDiagnoseCliRuntimeCommand={handleDiagnoseCliRuntimeCommand}
                handleDiscoverCliRuntimeTools={handleDiscoverCliRuntimeTools}
                handleCreateCliRuntimeEnvironment={handleCreateCliRuntimeEnvironment}
                handleInstallCliRuntimeTool={handleInstallCliRuntimeTool}
                handleOpenCliRuntimeEnvironmentRoot={handleOpenCliRuntimeEnvironmentRoot}
                isSyncingMcp={isSyncingMcp}
                handleDiscoverAndImportMcp={handleDiscoverAndImportMcp}
                handleAddMcpServer={handleAddMcpServer}
                handleSaveMcpServers={handleSaveMcpServers}
                mcpStatusMessage={mcpStatusMessage}
                mcpServers={mcpServers}
                mcpRuntimeItems={mcpRuntimeItems}
                mcpLiveSessions={mcpLiveSessions}
                handleUpdateMcpServer={handleUpdateMcpServer}
                handleDeleteMcpServer={handleDeleteMcpServer}
                handleDisconnectMcpServer={handleDisconnectMcpServer}
                handleDisconnectAllMcpSessions={handleDisconnectAllMcpSessions}
                stringifyEnvRecord={stringifyEnvRecord}
                parseEnvText={parseEnvText}
                mcpOauthState={mcpOauthState}
                handleRefreshMcpOAuth={handleRefreshMcpOAuth}
                handleTestMcpServer={handleTestMcpServer}
                mcpTestingId={mcpTestingId}
                mcpInspectingId={mcpInspectingId}
                thrivePlugins={thrivePlugins}
                thrivePluginMarketplace={thrivePluginMarketplace}
                codexPluginMarketplace={codexPluginMarketplace}
                thrivePluginMarketplaceLoading={thrivePluginMarketplaceLoading}
                codexPluginMarketplaceLoading={codexPluginMarketplaceLoading}
                thrivePluginsLoading={thrivePluginsLoading}
                thrivePluginBusyId={thrivePluginBusyId}
                thrivePluginStatusMessage={thrivePluginStatusMessage}
                thrivePluginRepoInput={thrivePluginRepoInput}
                setThrivePluginRepoInput={setThrivePluginRepoInput}
                handleRefreshThrivePlugins={loadThrivePlugins}
                handleRefreshThrivePluginMarketplace={loadThrivePluginMarketplace}
                handleRefreshCodexPluginMarketplace={loadCodexPluginMarketplace}
                handleInstallThriveMarketplacePlugin={handleInstallThriveMarketplacePlugin}
                handleInstallCodexMarketplacePlugin={handleInstallCodexMarketplacePlugin}
                handleInstallThrivePluginFromRepo={handleInstallThrivePluginFromRepo}
                handleToggleThrivePlugin={handleToggleThrivePlugin}
                handleUninstallThrivePlugin={handleUninstallThrivePlugin}
                handleOpenThrivePluginDataDir={handleOpenThrivePluginDataDir}
                showDeveloperDiagnostics={Boolean(formData.developer_mode_enabled)}
                toolDiagnostics={toolDiagnostics}
                toolDiagnosticResults={toolDiagnosticResults}
                toolDiagnosticRunning={toolDiagnosticRunning}
                handleRunDirectToolDiagnostic={(toolName) => runToolDiagnostic(toolName, 'direct')}
                handleRunAiToolDiagnostic={(toolName) => runToolDiagnostic(toolName, 'ai')}
                handleRefreshToolDiagnostics={loadToolDiagnostics}
                handleRunAllDirectToolDiagnostics={() => runAllToolDiagnostics('direct')}
                handleRunAllAiToolDiagnostics={() => runAllToolDiagnostics('ai')}
                runtimePerfPresets={RUNTIME_PERF_PRESETS}
                runtimePerfMode={runtimePerfMode}
                setRuntimePerfMode={setRuntimePerfMode}
                runtimePerfPresetId={runtimePerfPresetId}
                setRuntimePerfPresetId={setRuntimePerfPresetId}
                runtimePerfMessage={runtimePerfMessage}
                setRuntimePerfMessage={setRuntimePerfMessage}
                runtimePerfIterations={runtimePerfIterations}
                setRuntimePerfIterations={setRuntimePerfIterations}
                runtimePerfResults={runtimePerfResults}
                activeRuntimePerfRunId={activeRuntimePerfRunId}
                isRuntimePerfRunning={isRuntimePerfRunning}
                runtimePerfStatusMessage={runtimePerfStatusMessage}
                handleApplyRuntimePerfPreset={handleApplyRuntimePerfPreset}
                handleRunRuntimePerfBenchmark={handleRunRuntimePerfBenchmark}
                handleClearRuntimePerfResults={handleClearRuntimePerfResults}
                runtimeTasks={runtimeTasks}
                runtimeRoles={runtimeRoles}
                runtimeDiagnosticsSummary={runtimeDiagnosticsSummary}
                runtimeSessions={runtimeSessions}
                backgroundTasks={backgroundTasks}
                backgroundWorkerPool={backgroundWorkerPool}
                selectedRuntimeTaskId={selectedRuntimeTaskId}
                setSelectedRuntimeTaskId={setSelectedRuntimeTaskId}
                selectedRuntimeSessionId={selectedRuntimeSessionId}
                setSelectedRuntimeSessionId={setSelectedRuntimeSessionId}
                selectedBackgroundTaskId={selectedBackgroundTaskId}
                setSelectedBackgroundTaskId={setSelectedBackgroundTaskId}
                selectedBackgroundTask={selectedBackgroundTaskDetail}
                runtimeTaskTraces={runtimeTaskTraces}
                runtimeSessionTranscript={runtimeSessionTranscript}
                runtimeSessionCheckpoints={runtimeSessionCheckpoints}
                runtimeSessionToolResults={runtimeSessionToolResults}
                runtimeHooks={runtimeHooks}
                runtimeDraftInput={runtimeDraftInput}
                setRuntimeDraftInput={setRuntimeDraftInput}
                runtimeDraftMode={runtimeDraftMode}
                setRuntimeDraftMode={setRuntimeDraftMode}
                isRuntimeLoading={isRuntimeLoading}
                isRuntimeTraceLoading={isRuntimeTraceLoading}
                isRuntimeSessionLoading={isRuntimeSessionLoading}
                isBackgroundTasksLoading={isBackgroundTasksLoading}
                isRuntimeCreating={isRuntimeCreating}
                runtimeTaskActionRunning={runtimeTaskActionRunning}
                backgroundTaskActionRunning={backgroundTaskActionRunning}
                handleRefreshRuntimeData={loadRuntimeDeveloperData}
                handleCreateRuntimeTask={handleCreateRuntimeTask}
                handleResumeRuntimeTask={handleResumeRuntimeTask}
                handleCancelRuntimeTask={handleCancelRuntimeTask}
                handleCancelBackgroundTask={handleCancelBackgroundTask}
              />
            )}

            {/* Global Save Actions (Visible on all tabs usually, but maybe better inside the form only if relevant) */}
            {/* Actually, it's safer to keep the save button available for settings that need saving (General, AI). Tools operations are immediate. */}
            <SettingsSaveBar
              activeTab={activeTab}
              status={status}
              errorMessage={saveErrorMessage}
            />
          </form>
          {(editingTeamAdvisor || isCreatingTeamAdvisor) && (
            <AdvisorModal
              advisor={editingTeamAdvisor}
              defaultMode="manual"
              onSave={handleSaveTeamAdvisor}
              onClose={() => {
                setEditingTeamAdvisor(null);
                setIsCreatingTeamAdvisor(false);
              }}
            />
          )}
          {settingsTeamAdvisor && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[2px] transition-opacity"
                onClick={() => setSettingsTeamAdvisor(null)}
                aria-label="关闭成员设置"
              />
              <aside className="fixed bottom-4 right-4 top-4 z-40 w-[30rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/60 bg-white/85 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.16)] backdrop-blur-[40px] animate-slide-in-right">
                <AdvisorSettingsPanel
                  advisor={settingsTeamAdvisor}
                  isActive={isActive}
                  downloadStatus={null}
                  isSystemPromptExpanded={isTeamSystemPromptExpanded}
                  setIsSystemPromptExpanded={setIsTeamSystemPromptExpanded}
                  isOptimizingPrompt={isTeamOptimizingPrompt}
                  onOptimizePrompt={() => void handleOptimizeTeamAdvisorPrompt(settingsTeamAdvisor)}
                  onUploadKnowledge={() => void handleUploadTeamAdvisorKnowledge(settingsTeamAdvisor)}
                  onDeleteKnowledge={(fileName) => void handleDeleteTeamAdvisorKnowledge(settingsTeamAdvisor, fileName)}
                  onPromoteMemberSkillCandidate={() => void handlePromoteTeamMemberSkillCandidate(settingsTeamAdvisor)}
                  onDiscardMemberSkillCandidate={() => void handleDiscardTeamMemberSkillCandidate(settingsTeamAdvisor)}
                  onRefreshMemberSkill={() => handleRefreshTeamMemberSkill(settingsTeamAdvisor)}
                  onRollbackMemberSkillVersion={(version) => void handleRollbackTeamMemberSkillVersion(settingsTeamAdvisor, version)}
                  onEdit={() => setEditingTeamAdvisor(settingsTeamAdvisor)}
                  onDelete={() => void handleDeleteTeamAdvisor(settingsTeamAdvisor)}
                  onClose={() => setSettingsTeamAdvisor(null)}
                />
              </aside>
            </>
          )}
          {isCreateAiSourceModalOpen && (
            <div
              className="fixed inset-0 z-[140] bg-black/45 flex items-center justify-center px-6 py-6"
              onMouseDown={closeCreateAiSourceModal}
            >
              <div
                className="w-full max-w-2xl rounded-2xl border border-border bg-surface-primary shadow-2xl"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-text-primary truncate">新建供应商</h3>
                    <p className="text-xs text-text-tertiary mt-1 truncate">
                      先创建供应商，再在该供应商下添加常用模型
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeCreateAiSourceModal}
                    className="px-2.5 py-1 text-xs border border-border rounded hover:bg-surface-secondary transition-colors"
                  >
                    关闭
                  </button>
                </div>

                <div className="px-5 py-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-medium text-text-secondary">平台预设</label>
                      <AiPresetSelect
                        value={createAiSourceDraft.presetId}
                        groups={groupedAiPresets}
                        onChange={(nextPresetId) => {
                          const previousPreset = findAiPresetById(createAiSourceDraft.presetId);
                          const nextPreset = findAiPresetById(nextPresetId);
                          const shouldSyncBaseURL = !createAiSourceDraft.baseURL
                            || (previousPreset?.baseURL && createAiSourceDraft.baseURL === previousPreset.baseURL);
                          const shouldSyncName = !createAiSourceDraft.name
                            || createAiSourceDraft.name === previousPreset?.label;
                          setCreateAiSourceDraft((prev) => ({
                            ...prev,
                            presetId: nextPresetId,
                            baseURL: shouldSyncBaseURL ? (nextPreset?.baseURL || '') : prev.baseURL,
                            name: shouldSyncName ? (nextPreset?.label || prev.name) : prev.name,
                            protocol: nextPreset?.protocol || prev.protocol || 'openai',
                          }));
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-medium text-text-secondary">来源名称</label>
                      <input
                        type="text"
                        value={createAiSourceDraft.name}
                        onChange={(e) => setCreateAiSourceDraft((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="例如：DashScope (Qwen)"
                        className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                        autoFocus
                      />
                    </div>
                  </div>

	                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
	                    <div className="space-y-1.5">
	                      <label className="block text-[11px] font-medium text-text-secondary">协议类型</label>
	                      <AiModelSelect
                        value={createAiSourceDraft.protocol}
                        onChange={(value) => setCreateAiSourceDraft((prev) => ({ ...prev, protocol: value as AiProtocol }))}
                        className="w-full"
                        options={[
                          { id: 'openai', label: 'OpenAI Compatible' },
                          { id: 'anthropic', label: 'Anthropic Native' },
                          { id: 'gemini', label: 'Gemini Native' },
                        ]}
	                      />
	                    </div>
	                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-medium text-text-secondary">API Endpoint (Base URL)</label>
                    <input
                      type="text"
                      value={createAiSourceDraft.baseURL}
                      onChange={(e) => setCreateAiSourceDraft((prev) => ({ ...prev, baseURL: e.target.value }))}
                      placeholder="https://api.openai.com/v1"
                      className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-medium text-text-secondary">API Key</label>
                    <PasswordInput
                      value={createAiSourceDraft.apiKey}
                      onChange={(e) => setCreateAiSourceDraft((prev) => ({ ...prev, apiKey: e.target.value }))}
                      placeholder="可先留空，后续再补充"
                      className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                    />
                  </div>
                </div>

                <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeCreateAiSourceModal}
                    className="px-3 py-1.5 text-xs border border-border rounded hover:bg-surface-secondary transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateAiSource}
                    className="px-3 py-1.5 text-xs bg-text-primary text-background rounded hover:opacity-90 transition-opacity"
                  >
                    创建供应商
                  </button>
                </div>
              </div>
            </div>
          )}

          {addModelModalSource && (
            <div
              className="fixed inset-0 z-[140] bg-black/45 flex items-center justify-center px-6 py-6"
              onMouseDown={closeAddModelModal}
            >
              <div
                className="w-full max-w-xl rounded-2xl border border-border bg-surface-primary shadow-2xl"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-text-primary truncate">添加模型</h3>
                    <p className="text-xs text-text-tertiary mt-1 truncate">
                      {addModelModalSource.name || '未命名供应商'} · 当前类型可选择 {addModelModalFilteredModels.length} 个模型
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeAddModelModal}
                    className="px-2.5 py-1 text-xs border border-border rounded hover:bg-surface-secondary transition-colors"
                  >
                    关闭
                  </button>
                </div>

                <div className="px-5 py-4 space-y-3">
                  <div className="text-[12px] text-text-tertiary">
                    可从供应商模型列表中选择，也可以直接手动输入模型 ID；百炼原生生图等未提供模型列表的接口仍可在这里添加。
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr),160px] gap-2">
                    <input
                      type="text"
                      list={`ai-source-model-options-${addModelModalSource.id}`}
                      value={addModelModalDraft}
                      onChange={(e) => setSourceModelDrafts((prev) => ({ ...prev, [addModelModalSource.id]: e.target.value }))}
                      placeholder="输入或选择模型ID"
                      className="flex-1 bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                      autoFocus
                    />
                    <datalist id={`ai-source-model-options-${addModelModalSource.id}`}>
                      {addModelModalFilteredModels.map((item) => (
                        <option key={item.id} value={item.id} />
                      ))}
                    </datalist>
                    <select
                      value={addModelModalCapability}
                      onChange={(e) => handleAddModelCapabilityChange(
                        addModelModalSource.id,
                        e.target.value as ModelCapability,
                      )}
                      className="bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                    >
                      <option value="chat">语言模型</option>
                      <option value="transcription">转录模型</option>
                      <option value="audio">音频生成</option>
                      <option value="tts">语音合成</option>
                      <option value="voice_clone">音色克隆</option>
                      <option value="image">图片生成</option>
                      <option value="video">视频生成</option>
                      <option value="embedding">向量模型</option>
                    </select>
                  </div>
                  <div className="max-h-40 overflow-auto rounded border border-border bg-surface-secondary/20 p-2">
                    {addModelModalFilteredModels.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {addModelModalFilteredModels.slice(0, 80).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setSourceModelDrafts((prev) => ({ ...prev, [addModelModalSource.id]: item.id }));
                            }}
                            className="px-2 py-1 text-[11px] rounded border border-border hover:bg-surface-secondary transition-colors flex items-center gap-1.5"
                          >
                            <span>{item.id}</span>
                            {buildModelCapabilityBadges(item.capabilities).map((badge) => (
                              <span
                                key={`${item.id}-${badge.text}`}
                                className={clsx(
                                  'px-1 py-0.5 rounded text-[10px] leading-none whitespace-nowrap font-medium',
                                  badge.className || 'text-text-tertiary'
                                )}
                              >
                                {badge.text}
                              </span>
                            ))}
                            <span className="ml-0.5 flex items-center gap-1">
                              {buildModelInputIcons(item.inputCapabilities).map((icon) => {
                                const Icon = icon.icon;
                                return (
                                  <span
                                    key={`${item.id}-${icon.key}`}
                                    title={icon.label}
                                    className={clsx('inline-flex h-4.5 w-4.5 items-center justify-center rounded-full', icon.className)}
                                  >
                                    <Icon className="h-3 w-3" strokeWidth={2.1} />
                                  </span>
                                );
                              })}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-text-tertiary">
                        当前类型没有匹配的供应商模型，可直接手动输入模型 ID。
                      </div>
                    )}
                  </div>
                </div>

                <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeAddModelModal}
                    className="px-3 py-1.5 text-xs border border-border rounded hover:bg-surface-secondary transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddSourceModel(addModelModalSource.id)}
                    disabled={!addModelModalDraftTrimmed}
                    className="px-3 py-1.5 text-xs bg-text-primary text-background rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    确认添加
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}
