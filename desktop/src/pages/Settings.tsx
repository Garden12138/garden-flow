import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  Download,
  FolderOpen,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Video,
} from 'lucide-react';
import clsx from 'clsx';
import {
  AI_SOURCE_PRESETS,
  DEFAULT_AI_PRESET_ID,
  findAiPresetById,
  type AiSourceConfig,
} from '../config/aiSources';
import {
  DEFAULT_AI_MODEL_ROUTES,
  normalizeAiModelRoutes,
  type AiModelRouteScope,
  type AiModelRoutes,
  type SettingsNavigationTarget,
} from '../features/settings/settingsModel';

type SettingsView = 'general' | 'ai' | 'media' | 'privacy';
type VideoProviderPreset = 'aliyun-bailian' | 'minimax' | 'new-api-aliyun' | 'new-api-minimax' | 'custom';

type VideoProviderConfig = {
  id: string;
  name: string;
  preset: VideoProviderPreset;
  endpoint: string;
  apiKey: string;
  model: string;
};

const ROUTE_LABELS: Record<AiModelRouteScope, string> = {
  chat: '对话',
  wander: '灵感选题',
  team: '团队协作',
  knowledge: '知识处理',
  gardenflow: '内容创作',
  transcription: '语音转写',
  embedding: '向量嵌入',
  image: '图片生成',
  visualIndex: '视觉索引',
  videoAnalysis: '视频理解',
  voiceTts: '语音合成',
  voiceClone: '音色克隆',
};

const VIDEO_PRESETS: Array<{ id: VideoProviderPreset; label: string; endpoint: string }> = [
  { id: 'aliyun-bailian', label: '阿里云百炼', endpoint: 'https://dashscope.aliyuncs.com/api/v1' },
  { id: 'minimax', label: 'MiniMax', endpoint: 'https://api.minimaxi.com/v1' },
  { id: 'new-api-aliyun', label: 'New API · 阿里云上游', endpoint: '' },
  { id: 'new-api-minimax', label: 'New API · MiniMax 上游', endpoint: '' },
  { id: 'custom', label: '自定义兼容接口', endpoint: '' },
];

const inputClass = 'h-10 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm text-text-primary outline-none transition focus:border-accent-primary';
const labelClass = 'mb-1.5 block text-xs font-medium text-text-secondary';

function parseList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isLocalEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
  } catch {
    return false;
  }
}

function sourceReady(source: AiSourceConfig): boolean {
  return Boolean(source.baseURL.trim() && source.model.trim() && (source.apiKey.trim() || isLocalEndpoint(source.baseURL)));
}

function SectionCard({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface-primary p-5 shadow-[var(--ui-shadow-1)]">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-5 text-text-tertiary">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Settings({
  isActive = true,
  onOpenGardenFlowOnboarding,
  navigationTarget,
  onReturn,
}: {
  isActive?: boolean;
  onOpenGardenFlowOnboarding?: () => void;
  gardenflowOnboardingVersion?: number;
  navigationTarget?: SettingsNavigationTarget | null;
  onReturn?: () => void;
}) {
  const [view, setView] = useState<SettingsView>('ai');
  const [rawSettings, setRawSettings] = useState<Record<string, unknown>>({});
  const [sources, setSources] = useState<AiSourceConfig[]>([]);
  const [routes, setRoutes] = useState<AiModelRoutes>({ ...DEFAULT_AI_MODEL_ROUTES });
  const [videoProviders, setVideoProviders] = useState<VideoProviderConfig[]>([]);
  const [activeVideoProviderId, setActiveVideoProviderId] = useState('');
  const [workspaceDir, setWorkspaceDir] = useState('');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [debugLogging, setDebugLogging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [pluginMessage, setPluginMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const settings = (await window.ipcRenderer.getSettings() || {}) as Record<string, unknown>;
      const loadedSources = parseList<AiSourceConfig>(settings.ai_sources_json).map((source) => ({
        ...source,
        protocol: source.protocol || 'openai',
        models: Array.isArray(source.models) ? source.models : [],
      }));
      const loadedVideo = parseList<VideoProviderConfig>(settings.video_providers_json).filter((provider) => (
        VIDEO_PRESETS.some((preset) => preset.id === provider.preset)
      ));
      setRawSettings(settings);
      setSources(loadedSources);
      setRoutes(normalizeAiModelRoutes(settings.ai_model_routes_json));
      setVideoProviders(loadedVideo);
      setActiveVideoProviderId(String(settings.active_video_provider_id || loadedVideo[0]?.id || ''));
      setWorkspaceDir(String(settings.workspace_dir || ''));
      setProxyEnabled(Boolean(settings.proxy_enabled));
      setProxyUrl(String(settings.proxy_url || ''));
      setDebugLogging(Boolean(settings.debug_log_enabled));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '设置读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) void load();
  }, [isActive, load]);

  useEffect(() => {
    if (!navigationTarget?.tab) return;
    setView(navigationTarget.tab === 'ai' ? 'ai' : 'general');
  }, [navigationTarget]);

  const readySources = useMemo(() => sources.filter(sourceReady), [sources]);
  const selectedVideo = videoProviders.find((provider) => provider.id === activeVideoProviderId) || null;

  const updateSource = (id: string, patch: Partial<AiSourceConfig>) => {
    setSources((current) => current.map((source) => source.id === id ? { ...source, ...patch } : source));
  };

  const addSource = () => {
    const preset = findAiPresetById(DEFAULT_AI_PRESET_ID)!;
    const id = uid('provider');
    setSources((current) => [...current, {
      id,
      name: preset.label,
      presetId: preset.id,
      baseURL: preset.baseURL,
      apiKey: '',
      model: '',
      models: [],
      protocol: preset.protocol,
    }]);
  };

  const deleteSource = (id: string) => {
    setSources((current) => current.filter((source) => source.id !== id));
    setRoutes((current) => Object.fromEntries(
      Object.entries(current).map(([scope, route]) => [
        scope,
        route.sourceId === id ? { mode: 'disabled', sourceId: '', model: '' } : route,
      ]),
    ) as AiModelRoutes);
  };

  const addVideoProvider = () => {
    const id = uid('video');
    setVideoProviders((current) => [...current, {
      id,
      name: 'New API · 阿里云上游',
      preset: 'new-api-aliyun',
      endpoint: '',
      apiKey: '',
      model: '',
    }]);
    setActiveVideoProviderId(id);
  };

  const updateVideoProvider = (id: string, patch: Partial<VideoProviderConfig>) => {
    setVideoProviders((current) => current.map((provider) => provider.id === id ? { ...provider, ...patch } : provider));
  };

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const sanitizedSources = sources.map((source) => ({
        ...source,
        name: source.name.trim(),
        baseURL: source.baseURL.trim().replace(/\/+$/, ''),
        apiKey: source.apiKey.trim(),
        model: source.model.trim(),
        models: Array.from(new Set([...(source.models || []), source.model].map((item) => String(item || '').trim()).filter(Boolean))),
      }));
      const normalizedRoutes = Object.fromEntries(
        Object.entries(routes).map(([scope, route]) => {
          const source = sanitizedSources.find((item) => item.id === route.sourceId);
          const ready = source ? sourceReady(source) : false;
          return [scope, ready && route.model.trim()
            ? { mode: 'custom', sourceId: source!.id, model: route.model.trim() }
            : { mode: 'disabled', sourceId: '', model: '' }];
        }),
      ) as AiModelRoutes;
      const activeVideo = videoProviders.find((provider) => provider.id === activeVideoProviderId);
      if (activeVideo && (!activeVideo.endpoint.trim() || !activeVideo.apiKey.trim() || !activeVideo.model.trim())) {
        throw new Error('启用的视频供应商必须填写 endpoint、key 和 model。');
      }
      const chatSource = sanitizedSources.find((source) => source.id === normalizedRoutes.chat.sourceId);
      const imageSource = sanitizedSources.find((source) => source.id === normalizedRoutes.image.sourceId);
      const transcriptionSource = sanitizedSources.find((source) => source.id === normalizedRoutes.transcription.sourceId);
      const embeddingSource = sanitizedSources.find((source) => source.id === normalizedRoutes.embedding.sourceId);
      const payload = {
        ...rawSettings,
        workspace_dir: workspaceDir.trim(),
        proxy_enabled: proxyEnabled,
        proxy_url: proxyUrl.trim(),
        debug_log_enabled: debugLogging,
        ai_sources_json: JSON.stringify(sanitizedSources),
        ai_model_routes_json: JSON.stringify(normalizedRoutes),
        default_ai_source_id: chatSource?.id || '',
        api_endpoint: chatSource?.baseURL || '',
        api_key: chatSource?.apiKey || '',
        model_name: normalizedRoutes.chat.model || '',
        model_name_wander: normalizedRoutes.wander.model || '',
        model_name_chatroom: normalizedRoutes.team.model || '',
        model_name_knowledge: normalizedRoutes.knowledge.model || '',
        model_name_gardenflow: normalizedRoutes.gardenflow.model || '',
        image_endpoint: imageSource?.baseURL || '',
        image_api_key: imageSource?.apiKey || '',
        image_model: normalizedRoutes.image.model || '',
        transcription_endpoint: transcriptionSource?.baseURL || '',
        transcription_key: transcriptionSource?.apiKey || '',
        transcription_model: normalizedRoutes.transcription.model || '',
        embedding_endpoint: embeddingSource?.baseURL || '',
        embedding_key: embeddingSource?.apiKey || '',
        embedding_model: normalizedRoutes.embedding.model || '',
        video_providers_json: JSON.stringify(videoProviders),
        active_video_provider_id: activeVideo?.id || '',
        video_endpoint: activeVideo?.endpoint.trim() || '',
        video_api_key: activeVideo?.apiKey.trim() || '',
        video_model: activeVideo?.model.trim() || '',
        video_models_json: JSON.stringify(activeVideo?.model ? [activeVideo.model.trim()] : []),
      };
      await window.ipcRenderer.saveSettings(payload);
      setRawSettings(payload);
      setSources(sanitizedSources);
      setRoutes(normalizedRoutes);
      setMessage('设置已保存');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '设置保存失败');
    } finally {
      setSaving(false);
    }
  };

  const preparePlugin = async () => {
    setPluginMessage('正在准备浏览器插件…');
    try {
      const result = await window.ipcRenderer.browserPlugin.prepare() as { path?: string; error?: string };
      setPluginMessage(result?.error || (result?.path ? '插件已准备，可打开目录后在浏览器中加载。' : '插件已准备。'));
    } catch (error) {
      setPluginMessage(error instanceof Error ? error.message : '插件准备失败');
    }
  };

  const exportDiagnostics = async () => {
    setPluginMessage('正在导出本地诊断包…');
    try {
      const result = await window.ipcRenderer.logs.exportBundle();
      setPluginMessage(result.success ? `诊断包已导出：${result.path}` : (result.error || '导出失败'));
    } catch (error) {
      setPluginMessage(error instanceof Error ? error.message : '导出失败');
    }
  };

  const navItems: Array<{ id: SettingsView; label: string; icon: typeof Bot }> = [
    { id: 'general', label: '通用', icon: HardDrive },
    { id: 'ai', label: 'AI 供应商', icon: Bot },
    { id: 'media', label: '视频服务', icon: Video },
    { id: 'privacy', label: '隐私与诊断', icon: ShieldCheck },
  ];

  if (loading) {
    return <div className="flex h-full items-center justify-center text-text-tertiary"><Loader2 className="mr-2 h-4 w-4 animate-spin" />读取设置…</div>;
  }

  return (
    <div className="flex h-full min-h-0 bg-surface-secondary/30">
      <aside className="w-56 shrink-0 border-r border-border bg-surface-primary p-4">
        <div className="mb-5 flex items-center gap-2">
          {onReturn ? (
            <button type="button" onClick={onReturn} className="rounded-lg p-2 text-text-secondary hover:bg-surface-secondary" aria-label="返回">
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : null}
          <div>
            <div className="text-sm font-semibold text-text-primary">设置</div>
            <div className="text-[11px] text-text-tertiary">本地优先 · 自带密钥</div>
          </div>
        </div>
        <nav className="space-y-1">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={clsx(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition',
                view === id ? 'bg-accent-muted text-accent-primary' : 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl space-y-5 p-6 pb-28">
          <header>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent-primary">GardenFlow Settings</div>
            <h1 className="mt-1 text-2xl font-semibold text-text-primary">{navItems.find((item) => item.id === view)?.label}</h1>
          </header>

          {view === 'general' ? (
            <>
              <SectionCard title="工作空间" description="GardenFlow 将数据库、稿件和媒体保存在你选择的本地目录。">
                <label className={labelClass}>工作空间目录</label>
                <div className="flex gap-2">
                  <input className={inputClass} value={workspaceDir} onChange={(event) => setWorkspaceDir(event.target.value)} placeholder="留空使用默认 .gardenflow 目录" />
                  <button type="button" onClick={() => void window.ipcRenderer.openWorkspaceDir()} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border px-3 text-sm text-text-secondary hover:bg-surface-secondary">
                    <FolderOpen className="h-4 w-4" />打开
                  </button>
                </div>
              </SectionCard>
              <SectionCard title="网络代理" description="仅在需要时启用。代理配置应用于外部 AI 和素材请求。">
                <label className="flex items-center gap-3 text-sm text-text-primary">
                  <input type="checkbox" checked={proxyEnabled} onChange={(event) => setProxyEnabled(event.target.checked)} />
                  启用代理
                </label>
                {proxyEnabled ? <input className={clsx(inputClass, 'mt-3')} value={proxyUrl} onChange={(event) => setProxyUrl(event.target.value)} placeholder="http://127.0.0.1:7890" /> : null}
              </SectionCard>
              <SectionCard title="首次使用引导">
                <button type="button" onClick={onOpenGardenFlowOnboarding} className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-secondary">重新打开产品引导</button>
              </SectionCard>
            </>
          ) : null}

          {view === 'ai' ? (
            <>
              <SectionCard title="供应商" description="密钥仅保存在本机。支持 OpenAI、Anthropic、Gemini、本地服务以及任意兼容接口。">
                {sources.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center">
                    <Bot className="mx-auto h-8 w-8 text-accent-primary" />
                    <div className="mt-3 text-sm font-medium text-text-primary">尚未配置 AI 供应商</div>
                    <p className="mt-1 text-xs text-text-tertiary">添加供应商并填写 endpoint、key 与 model 后，相关能力才会启用。</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sources.map((source) => (
                      <div key={source.id} className="rounded-xl border border-border bg-surface-secondary/30 p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={clsx('h-2.5 w-2.5 rounded-full', sourceReady(source) ? 'bg-emerald-500' : 'bg-amber-500')} />
                            <span className="text-sm font-semibold text-text-primary">{source.name || '未命名供应商'}</span>
                            <span className="text-[11px] text-text-tertiary">{sourceReady(source) ? '可用' : '待配置'}</span>
                          </div>
                          <button type="button" onClick={() => deleteSource(source.id)} className="rounded-lg p-2 text-text-tertiary hover:bg-red-500/10 hover:text-red-500" aria-label="删除供应商"><Trash2 className="h-4 w-4" /></button>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label><span className={labelClass}>预设</span>
                            <select
                              className={inputClass}
                              value={source.presetId}
                              onChange={(event) => {
                                const preset = findAiPresetById(event.target.value);
                                if (!preset) return;
                                updateSource(source.id, { presetId: preset.id, name: preset.label, baseURL: preset.baseURL, protocol: preset.protocol });
                              }}
                            >
                              {AI_SOURCE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                            </select>
                          </label>
                          <label><span className={labelClass}>名称</span><input className={inputClass} value={source.name} onChange={(event) => updateSource(source.id, { name: event.target.value })} /></label>
                          <label className="md:col-span-2"><span className={labelClass}>Endpoint</span><input className={inputClass} value={source.baseURL} onChange={(event) => updateSource(source.id, { baseURL: event.target.value })} placeholder="https://api.example.com/v1" /></label>
                          <label><span className={labelClass}>API Key {isLocalEndpoint(source.baseURL) ? '（本地可留空）' : ''}</span><input type="password" className={inputClass} value={source.apiKey} onChange={(event) => updateSource(source.id, { apiKey: event.target.value })} /></label>
                          <label><span className={labelClass}>默认模型</span><input className={inputClass} value={source.model} onChange={(event) => updateSource(source.id, { model: event.target.value })} placeholder="例如 gpt-5-mini" /></label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" onClick={addSource} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-secondary"><Plus className="h-4 w-4" />添加供应商</button>
              </SectionCard>

              <SectionCard title="能力路由" description="每项能力都可显式关闭，或指定一个已配置供应商和模型。">
                <div className="space-y-2">
                  {(Object.keys(ROUTE_LABELS) as AiModelRouteScope[]).map((scope) => {
                    const route = routes[scope];
                    return (
                      <div key={scope} className="grid items-center gap-2 rounded-lg border border-border/70 p-3 md:grid-cols-[120px_110px_1fr_1fr]">
                        <div className="text-sm font-medium text-text-primary">{ROUTE_LABELS[scope]}</div>
                        <select className={inputClass} value={route.mode} onChange={(event) => setRoutes((current) => ({ ...current, [scope]: { ...route, mode: event.target.value as 'custom' | 'disabled' } }))}>
                          <option value="disabled">关闭</option>
                          <option value="custom">自定义</option>
                        </select>
                        <select
                          className={inputClass}
                          value={route.sourceId || ''}
                          disabled={route.mode === 'disabled'}
                          onChange={(event) => {
                            const source = sources.find((item) => item.id === event.target.value);
                            setRoutes((current) => ({ ...current, [scope]: { mode: 'custom', sourceId: event.target.value, model: source?.model || '' } }));
                          }}
                        >
                          <option value="">选择供应商</option>
                          {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                        </select>
                        <input className={inputClass} value={route.model || ''} disabled={route.mode === 'disabled'} onChange={(event) => setRoutes((current) => ({ ...current, [scope]: { ...route, model: event.target.value } }))} placeholder="模型 ID" />
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            </>
          ) : null}

          {view === 'media' ? (
            <SectionCard title="视频供应商" description="New API 配置必须显式选择上游类型，并填写 endpoint、key 和 model；不会根据 URL 或模型名猜测。">
              {videoProviders.length === 0 ? <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-text-tertiary">尚未配置视频供应商</div> : null}
              <div className="space-y-3">
                {videoProviders.map((provider) => (
                  <div key={provider.id} className={clsx('rounded-xl border p-4', provider.id === activeVideoProviderId ? 'border-accent-primary bg-accent-muted/30' : 'border-border')}>
                    <div className="mb-3 flex items-center justify-between">
                      <label className="flex items-center gap-2 text-sm font-semibold text-text-primary"><input type="radio" checked={provider.id === activeVideoProviderId} onChange={() => setActiveVideoProviderId(provider.id)} />启用此供应商</label>
                      <button type="button" onClick={() => { setVideoProviders((items) => items.filter((item) => item.id !== provider.id)); if (activeVideoProviderId === provider.id) setActiveVideoProviderId(''); }} className="rounded-lg p-2 text-text-tertiary hover:bg-red-500/10 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label><span className={labelClass}>类型</span><select className={inputClass} value={provider.preset} onChange={(event) => { const preset = VIDEO_PRESETS.find((item) => item.id === event.target.value)!; updateVideoProvider(provider.id, { preset: preset.id, name: preset.label, endpoint: preset.endpoint }); }}>{VIDEO_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
                      <label><span className={labelClass}>名称</span><input className={inputClass} value={provider.name} onChange={(event) => updateVideoProvider(provider.id, { name: event.target.value })} /></label>
                      <label className="md:col-span-2"><span className={labelClass}>Endpoint</span><input className={inputClass} value={provider.endpoint} onChange={(event) => updateVideoProvider(provider.id, { endpoint: event.target.value })} /></label>
                      <label><span className={labelClass}>API Key</span><input type="password" className={inputClass} value={provider.apiKey} onChange={(event) => updateVideoProvider(provider.id, { apiKey: event.target.value })} /></label>
                      <label><span className={labelClass}>模型 ID</span><input className={inputClass} value={provider.model} onChange={(event) => updateVideoProvider(provider.id, { model: event.target.value })} /></label>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addVideoProvider} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-secondary"><Plus className="h-4 w-4" />添加视频供应商</button>
            </SectionCard>
          ) : null}

          {view === 'privacy' ? (
            <>
              <SectionCard title="数据与隐私" description="内容、配置与诊断记录默认保存在本机。GardenFlow 不包含遥测或自动上传。">
                <div className="grid gap-3 text-sm text-text-secondary md:grid-cols-3">
                  {['无使用分析', '无官方账号', '无自动诊断上传'].map((text) => <div key={text} className="flex items-center gap-2 rounded-lg bg-surface-secondary/50 p-3"><Check className="h-4 w-4 text-emerald-500" />{text}</div>)}
                </div>
              </SectionCard>
              <SectionCard title="本地诊断" description="诊断报告会先脱敏并保存在本地，仅在你主动导出后离开设备。">
                <label className="flex items-center gap-3 text-sm text-text-primary"><input type="checkbox" checked={debugLogging} onChange={(event) => setDebugLogging(event.target.checked)} />启用调试日志</label>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={exportDiagnostics} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-secondary"><Download className="h-4 w-4" />导出诊断包</button>
                  <button type="button" onClick={() => void window.ipcRenderer.logs.openDir()} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-secondary"><FolderOpen className="h-4 w-4" />打开日志目录</button>
                </div>
              </SectionCard>
              <SectionCard title="浏览器插件" description="插件通过本机 Native Messaging 与桌面端通信。">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={preparePlugin} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-secondary"><RefreshCw className="h-4 w-4" />准备插件</button>
                  <button type="button" onClick={() => void window.ipcRenderer.browserPlugin.openDir()} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-secondary"><FolderOpen className="h-4 w-4" />打开插件目录</button>
                </div>
                {pluginMessage ? <p className="mt-3 break-all text-xs text-text-tertiary">{pluginMessage}</p> : null}
              </SectionCard>
            </>
          ) : null}
        </div>
      </main>

      <div className="fixed bottom-0 right-0 z-20 flex w-[calc(100%-14rem)] items-center justify-between border-t border-border bg-surface-primary/95 px-6 py-3 backdrop-blur">
        <div className={clsx('text-xs', message === '设置已保存' ? 'text-emerald-600' : 'text-text-tertiary')}>{message || `${readySources.length} 个可用 AI 供应商${selectedVideo ? ' · 1 个视频供应商已启用' : ''}`}</div>
        <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-accent-primary px-5 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存设置
        </button>
      </div>
    </div>
  );
}
