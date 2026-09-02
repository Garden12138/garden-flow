import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowRight, Bell, Clapperboard, FileText, Folder, Image, ImagePlus, Lightbulb, Loader2, MessageSquareText, Mic2, PenLine, RefreshCw, Send, Sparkles, X } from 'lucide-react';
import { ApprovalPanel } from './Approval';
import { subscribeDataChanged } from '../bridge/appEvents';
import { formatTimestampDate, parseTimestampMs } from '../utils/time';
import type { ThrivePluginHomeAction, ThrivePluginHomeWidget } from '../types';
import { dispatchAppIntent } from '../features/app-shell/appIntent';
import type { FlowStage } from '../features/app-shell/types';
import { WorkbenchStatePanel } from '../features/workbench/WorkbenchPrimitives';

interface HomeProps {
    isActive?: boolean;
    onNavigateToCoverStudio?: () => void;
    onNavigateToGenerationStudio?: (mode: 'image' | 'video' | 'audio' | 'cover') => void;
    onOpenManuscript?: (filePath: string) => void;
}

interface KnowledgeCountResponse {
    total?: number;
    items?: unknown[];
}

interface SubjectListResponse {
    success?: boolean;
    subjects?: unknown[];
    error?: string;
}

interface MediaListResponse {
    success?: boolean;
    assets?: unknown[];
    total?: number;
    error?: string;
}

interface FileNode {
    name?: string;
    path?: string;
    isDirectory: boolean;
    children?: FileNode[];
    title?: string;
    draftType?: 'longform' | 'video' | 'audio' | 'unknown';
    updatedAt?: number;
    summary?: string;
}

interface ReviewDocketStats {
    pending?: number;
    resolved?: number;
}

interface HomeStats {
    knowledge: number;
    assets: number;
    media: number;
    manuscripts: number;
    pendingApprovals: number;
}

interface RecentManuscript {
    path: string;
    name: string;
    title: string;
    draftType: 'longform' | 'video' | 'audio' | 'unknown';
    updatedAt: number;
    summary: string;
}

type PluginHomeCommand = ThrivePluginHomeAction | ThrivePluginHomeWidget;

const EMPTY_STATS: HomeStats = {
    knowledge: 0,
    assets: 0,
    media: 0,
    manuscripts: 0,
    pendingApprovals: 0,
};

function countFiles(nodes: FileNode[]): number {
    return nodes.reduce((total, node) => {
        if (!node?.isDirectory) return total + 1;
        return total + countFiles(Array.isArray(node.children) ? node.children : []);
    }, 0);
}

function collectManuscriptFiles(nodes: FileNode[]): FileNode[] {
    const result: FileNode[] = [];
    const visit = (items: FileNode[]) => {
        for (const item of items) {
            if (item?.isDirectory) {
                visit(Array.isArray(item.children) ? item.children : []);
            } else {
                result.push(item);
            }
        }
    };
    visit(nodes);
    return result;
}

function isInternalPackageFile(filePath: string): boolean {
    void filePath;
    return false;
}

function stripDraftExtension(fileName: string): string {
    return fileName.replace(/\.md$/i, '');
}

function resolveDraftTypeLabel(type: RecentManuscript['draftType']): string {
    if (type === 'video') return '视频';
    if (type === 'audio') return '音频';
    if (type === 'longform') return '长文';
    return '稿件';
}

function formatRecentDate(updatedAt: number): string {
    const timestamp = parseTimestampMs(updatedAt);
    if (!timestamp) return '最近更新';
    const deltaMs = Date.now() - timestamp;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (deltaMs >= 0 && deltaMs < hour) return `${Math.max(1, Math.floor(deltaMs / minute))} 分钟前`;
    if (deltaMs >= 0 && deltaMs < day) return `${Math.floor(deltaMs / hour)} 小时前`;
    if (deltaMs >= 0 && deltaMs < 7 * day) return `${Math.floor(deltaMs / day)} 天前`;
    return formatTimestampDate(timestamp) || '最近更新';
}

function buildRecentManuscripts(nodes: FileNode[]): RecentManuscript[] {
    return collectManuscriptFiles(nodes)
        .filter((item) => {
            const path = String(item.path || '').trim();
            return path && !isInternalPackageFile(path);
        })
        .map((item) => {
            const path = String(item.path || '').trim();
            const name = String(item.name || path.split('/').pop() || '').trim();
            const draftType = item.draftType || 'unknown';
            return {
                path,
                name,
                title: String(item.title || '').trim() || stripDraftExtension(name) || '未命名稿件',
                draftType,
                updatedAt: Number(item.updatedAt || 0) || 0,
                summary: String(item.summary || '').trim(),
            };
        })
        .sort((left, right) => {
            if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
            return right.path.localeCompare(left.path, 'zh-Hans-CN');
        })
        .slice(0, 4);
}

function InlineStat({
    label,
    value,
    icon: Icon,
}: {
    label: string;
    value: number;
    icon: typeof Archive;
}) {
    return (
        <div className="inline-flex items-center gap-1.5 text-[12px] text-text-tertiary">
            <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
            <span>{label}</span>
            <span className="font-semibold tabular-nums text-text-secondary">{value.toLocaleString('zh-CN')}</span>
        </div>
    );
}

function QuickAppButton({
    label,
    description,
    icon: Icon,
    tintClassName,
    onClick,
}: {
    label: string;
    description: string;
    icon: typeof Archive;
    tintClassName: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="workbench-home__quick-app group flex min-h-[96px] min-w-0 items-center gap-3 border-y border-border bg-surface-primary px-3 py-3 text-left transition-colors hover:bg-surface-secondary"
        >
            <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tintClassName}`}>
                <Icon className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-text-primary">{label}</span>
                <span className="mt-1 block text-[12px] leading-5 text-text-tertiary">{description}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-text-secondary" strokeWidth={1.8} />
        </button>
    );
}

function RecentManuscriptCard({
    manuscript,
    onOpen,
}: {
    manuscript: RecentManuscript;
    onOpen?: (filePath: string) => void;
}) {
    const Icon = manuscript.draftType === 'video'
        ? Clapperboard
        : FileText;

    return (
        <button
            type="button"
            onClick={() => onOpen?.(manuscript.path)}
            className="workbench-home__manuscript group overflow-hidden border border-border bg-surface-primary text-left transition-colors hover:border-accent-secondary/50 hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/35"
            title={manuscript.title}
        >
            <div className="relative aspect-[16/7] overflow-hidden bg-surface-secondary">
                <div className="flex h-full w-full items-center justify-center bg-surface-secondary">
                    <Icon className="h-8 w-8 text-accent-primary/65 transition-transform group-hover:scale-105" strokeWidth={1.6} />
                </div>
                <span className="absolute left-3 top-3 rounded-full border border-white/50 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-text-secondary shadow-sm backdrop-blur">
                    {resolveDraftTypeLabel(manuscript.draftType)}
                </span>
            </div>
            <div className="p-3">
                <div className="truncate text-[13px] font-semibold text-text-primary group-hover:text-accent-primary">{manuscript.title}</div>
                <div className="mt-1 truncate text-[11px] leading-4 text-text-tertiary">
                    {formatRecentDate(manuscript.updatedAt)}
                </div>
            </div>
        </button>
    );
}

function pluginMetricValue(widget: ThrivePluginHomeWidget): string {
    const total = widget.data?.total;
    if (typeof total === 'number') return total.toLocaleString('zh-CN');
    if (typeof total === 'string' && total.trim()) return total;
    return '--';
}

function pluginListItems(widget: ThrivePluginHomeWidget): Array<Record<string, unknown>> {
    const data = widget.data || {};
    const rawItems = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.assets)
            ? data.assets
            : Array.isArray(data.subjects)
                ? data.subjects
                : [];
    return rawItems.filter((item): item is Record<string, unknown> => item != null && typeof item === 'object').slice(0, 4);
}

function pluginItemTitle(item: Record<string, unknown>): string {
    return String(item.title || item.name || item.fileName || item.path || item.id || '未命名').trim();
}

function pluginToneClass(tone?: string | null): string {
    if (tone === 'sky') return 'bg-sky-500/10 text-sky-700';
    if (tone === 'violet') return 'bg-violet-500/10 text-violet-700';
    if (tone === 'amber') return 'bg-amber-500/10 text-amber-700';
    if (tone === 'rose') return 'bg-rose-500/10 text-rose-700';
    return 'bg-emerald-500/10 text-emerald-700';
}

function PluginHomeWidgetCard({
    widget,
    onRun,
}: {
    widget: ThrivePluginHomeWidget;
    onRun: (command: PluginHomeCommand) => void;
}) {
    const canRun = Boolean(widget.prompt || widget.kind === 'action');
    const items = widget.kind === 'list' ? pluginListItems(widget) : [];
    const failed = widget.data?.success === false;

    return (
        <button
            type="button"
            onClick={() => canRun && onRun(widget)}
            disabled={!canRun}
            className="group min-h-[112px] rounded-xl border border-border bg-surface-primary p-4 text-left shadow-sm transition-all enabled:hover:-translate-y-0.5 enabled:hover:border-accent-primary/30 enabled:hover:shadow-md disabled:cursor-default"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-text-primary">{widget.title}</div>
                    {widget.subtitle && (
                        <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-text-tertiary">{widget.subtitle}</div>
                    )}
                </div>
                <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${pluginToneClass(widget.tone)}`}>
                    <Sparkles className="h-4 w-4" strokeWidth={1.8} />
                </span>
            </div>
            {failed ? (
                <div className="mt-4 line-clamp-2 text-[12px] leading-5 text-red-600">{String(widget.data?.error || '插件数据不可用')}</div>
            ) : widget.kind === 'metric' ? (
                <div className="mt-4 text-[28px] font-semibold leading-none tracking-[-0.03em] text-text-primary">{pluginMetricValue(widget)}</div>
            ) : widget.kind === 'list' ? (
                <div className="mt-3 space-y-1.5">
                    {items.length > 0 ? items.map((item, index) => (
                        <div key={`${widget.id}:${index}`} className="truncate text-[12px] leading-5 text-text-secondary">
                            {pluginItemTitle(item)}
                        </div>
                    )) : (
                        <div className="text-[12px] leading-5 text-text-tertiary">暂无数据</div>
                    )}
                </div>
            ) : (
                <div className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-text-tertiary group-enabled:group-hover:text-text-primary">
                    {widget.label || '执行'}
                    <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                </div>
            )}
        </button>
    );
}

export function Home({ isActive = true, onNavigateToCoverStudio, onNavigateToGenerationStudio, onOpenManuscript }: HomeProps) {
    const [stats, setStats] = useState<HomeStats>(EMPTY_STATS);
    const [recentManuscripts, setRecentManuscripts] = useState<RecentManuscript[]>([]);
    const [pluginHomeWidgets, setPluginHomeWidgets] = useState<ThrivePluginHomeWidget[]>([]);
    const [pluginSidebarSections, setPluginSidebarSections] = useState<ThrivePluginHomeWidget[]>([]);
    const [pluginQuickActions, setPluginQuickActions] = useState<ThrivePluginHomeAction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [approvalOpen, setApprovalOpen] = useState(false);
    const [inspectorOpen, setInspectorOpen] = useState(false);
    const [quickTask, setQuickTask] = useState('');
    const requestIdRef = useRef(0);
    const hasSnapshotRef = useRef(false);

    const loadPluginHome = useCallback(() => {
        // Plugin home contributions are optional and the public Electron runtime does not
        // register their IPC handlers. Keep startup quiet and let plugin management remain
        // available from Settings until a runtime explicitly wires these contributions in.
        setPluginHomeWidgets([]);
        setPluginSidebarSections([]);
        setPluginQuickActions([]);
    }, []);

    const loadStats = useCallback(async () => {
        const requestId = ++requestIdRef.current;
        if (!hasSnapshotRef.current) setLoading(true);
        setError('');
        try {
            const [knowledgeResult, subjectsResult, mediaResult, manuscriptTree, approvalStats] = await Promise.all([
                window.ipcRenderer.knowledge.listPage<KnowledgeCountResponse>({ limit: 1 }),
                window.ipcRenderer.subjects.list({ limit: 500 }) as Promise<SubjectListResponse>,
                window.ipcRenderer.media.list({ limit: 500 }) as Promise<MediaListResponse>,
                window.ipcRenderer.manuscripts.list() as Promise<FileNode[]>,
                window.ipcRenderer.teamRuntime.reviewDocketStats() as Promise<ReviewDocketStats>,
            ]);
            if (requestId !== requestIdRef.current) return;
            if (subjectsResult?.success === false) throw new Error(subjectsResult.error || '资产统计失败');
            if (mediaResult?.success === false) throw new Error(mediaResult.error || '媒体统计失败');
            setStats({
                knowledge: Number.isFinite(knowledgeResult?.total)
                    ? Number(knowledgeResult.total)
                    : Array.isArray(knowledgeResult?.items) ? knowledgeResult.items.length : 0,
                assets: Array.isArray(subjectsResult?.subjects) ? subjectsResult.subjects.length : 0,
                media: Number.isFinite(mediaResult?.total)
                    ? Number(mediaResult.total)
                    : Array.isArray(mediaResult?.assets) ? mediaResult.assets.length : 0,
                manuscripts: countFiles(Array.isArray(manuscriptTree) ? manuscriptTree : []),
                pendingApprovals: Number(approvalStats?.pending || 0),
            });
            setRecentManuscripts(buildRecentManuscripts(Array.isArray(manuscriptTree) ? manuscriptTree : []));
            hasSnapshotRef.current = true;
        } catch (loadError) {
            if (requestId !== requestIdRef.current) return;
            console.error('Failed to load home stats:', loadError);
            setError(loadError instanceof Error ? loadError.message : '统计加载失败');
            if (!hasSnapshotRef.current) setStats(EMPTY_STATS);
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isActive) return;
        void loadStats();
        void loadPluginHome();
    }, [isActive, loadPluginHome, loadStats]);

    useEffect(() => {
        if (!inspectorOpen) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setInspectorOpen(false);
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [inspectorOpen]);

    useEffect(() => {
        if (!isActive) return;
        const handleRuntimeEvent = (_event: unknown, envelope?: unknown) => {
            const eventRecord = envelope && typeof envelope === 'object' ? envelope as Record<string, unknown> : {};
            if (String(eventRecord.eventType || '') === 'runtime:review-docket-changed') {
                void loadStats();
            }
        };
        const handleDataChanged = () => void loadStats();
        const handlePluginsChanged = () => void loadPluginHome();
        window.ipcRenderer.teamRuntime.onEvent(handleRuntimeEvent);
        const unsubscribeDataChanged = subscribeDataChanged(handleDataChanged);
        window.ipcRenderer.plugins.onChanged(handlePluginsChanged);
        return () => {
            window.ipcRenderer.teamRuntime.offEvent(handleRuntimeEvent);
            unsubscribeDataChanged();
            window.ipcRenderer.plugins.offChanged(handlePluginsChanged);
        };
    }, [isActive, loadPluginHome, loadStats]);

    const tiles = useMemo(() => [
        { key: 'knowledge', label: '知识库', value: stats.knowledge, icon: Archive },
        { key: 'assets', label: '资产', value: stats.assets, icon: Folder },
        { key: 'media', label: '媒体', value: stats.media, icon: Image },
        { key: 'manuscripts', label: '稿件', value: stats.manuscripts, icon: FileText },
    ], [stats]);

    const aiSuggestions = useMemo(() => [
        {
            label: '整理今天的选题',
            icon: Lightbulb,
            prompt: '帮我整理今天适合推进的内容选题，结合现有稿件给出优先级和下一步。',
        },
        {
            label: '续写最近稿件',
            icon: PenLine,
            prompt: recentManuscripts[0]
                ? `帮我检查并续写最近稿件《${recentManuscripts[0].title}》，先给出可执行修改建议。`
                : '帮我创建一篇新的内容稿，先从选题、结构和开头草稿开始。',
        },
        {
            label: '改成短视频脚本',
            icon: Clapperboard,
            prompt: recentManuscripts[0]
                ? `把最近稿件《${recentManuscripts[0].title}》改成一版短视频脚本，保留核心观点。`
                : '帮我把一个长文选题设计成短视频脚本结构。',
        },
        {
            label: '生成封面方向',
            icon: ImagePlus,
            prompt: '根据我的近期内容，给出 3 个封面方向，包括标题、画面元素和风格关键词。',
        },
    ], [recentManuscripts]);

    const sendAiSuggestion = useCallback((prompt: string, label?: string) => {
        dispatchAppIntent({
            type: 'flow.open',
            stage: 'compose',
            handoff: {
                kind: 'chat-draft',
                message: {
                    content: prompt,
                    displayContent: label || prompt,
                    sessionRouting: 'current',
                    deliveryMode: 'draft',
                },
            },
        });
    }, []);

    const submitQuickTask = useCallback(() => {
        const prompt = quickTask.trim();
        if (!prompt) return;
        sendAiSuggestion(prompt);
        setQuickTask('');
    }, [quickTask, sendAiSuggestion]);

    const openFlowStage = useCallback((stage: FlowStage) => {
        dispatchAppIntent({ type: 'flow.open', stage });
    }, []);

    const runPluginHomeCommand = useCallback((command: PluginHomeCommand) => {
        const prompt = typeof command.prompt === 'string' ? command.prompt.trim() : '';
        const label = 'label' in command && typeof command.label === 'string'
            ? command.label
            : 'title' in command ? command.title : undefined;
        if (prompt) {
            sendAiSuggestion(prompt, label || command.pluginName || '插件动作');
            return;
        }
        if ('target' in command) {
            if (command.target === 'coverStudio') {
                onNavigateToGenerationStudio?.('cover');
            } else if (command.target === 'generationStudio') {
                onNavigateToGenerationStudio?.(command.mode === 'video' ? 'video' : 'image');
            }
        }
    }, [onNavigateToCoverStudio, onNavigateToGenerationStudio, sendAiSuggestion]);

    return (
        <main className="workbench-home h-full min-h-0 overflow-y-auto px-7 py-6" aria-label="工作台">
            <div className="grid min-h-full w-full gap-7 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="flex min-w-0 flex-col gap-7">
                    <div className="workbench-home__heading flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <div className="workbench-home__eyebrow">NATURAL NEWSROOM · TODAY</div>
                            <h1 className="mt-2 text-[32px] font-semibold tracking-[-0.03em] text-text-primary">今天，把一件作品向前推进</h1>
                            <p className="mt-2 text-[13px] text-text-tertiary">从素材、灵感和最近稿件继续，所有上下文会跟着流程走。</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 pt-1">
                            {tiles.map((tile) => (
                                <InlineStat key={tile.key} label={tile.label} value={tile.value} icon={tile.icon} />
                            ))}
                            <button
                                type="button"
                                onClick={() => setApprovalOpen(true)}
                                className="relative inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-primary px-3 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                            >
                                <Bell className="h-4 w-4" strokeWidth={1.75} />
                                审批
                                {stats.pendingApprovals > 0 && (
                                    <span className="absolute -right-2 -top-2 min-w-[20px] rounded-full bg-[#c75d43] px-1.5 py-0.5 text-center text-[10px] font-semibold leading-4 text-white">
                                        {stats.pendingApprovals > 99 ? '99+' : stats.pendingApprovals}
                                    </span>
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => setInspectorOpen(true)}
                                className="workbench-home__inspector-toggle relative inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-primary px-3 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                                aria-expanded={inspectorOpen}
                            >
                                <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                                今日批注
                            </button>
                            <button
                                type="button"
                                onClick={() => void loadStats()}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                                title="刷新"
                                aria-label="刷新"
                            >
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>

                    <section className="workbench-home__flow-map" aria-label="创作流程">
                        {([
                            { stage: 'collect', index: '01', label: '素材', meta: `${stats.knowledge} 条资料` },
                            { stage: 'ideate', index: '02', label: '灵感', meta: '形成方向' },
                            { stage: 'compose', index: '03', label: '创作', meta: `${stats.manuscripts} 篇稿件` },
                            { stage: 'produce', index: '04', label: '生成', meta: `${stats.media} 项媒体` },
                            { stage: 'schedule', index: '05', label: '计划', meta: stats.pendingApprovals > 0 ? `${stats.pendingApprovals} 项待审批` : '安排发布' },
                        ] as Array<{ stage: FlowStage; index: string; label: string; meta: string }>).map((item) => (
                            <button
                                key={item.stage}
                                type="button"
                                className="workbench-home__flow-step"
                                onClick={() => openFlowStage(item.stage)}
                            >
                                <span>{item.index}</span>
                                <strong>{item.label}</strong>
                                <small>{item.meta}</small>
                                <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
                            </button>
                        ))}
                    </section>

                    {error && (
                        <WorkbenchStatePanel state="error" title="工作台数据暂时不可用" description={error} onRetry={() => void loadStats()} />
                    )}
                    <section className="workbench-home__quick-task" aria-label="快速任务">
                        <div>
                            <span>QUICK TASK</span>
                            <h2>告诉编辑台，这次要推进什么</h2>
                        </div>
                        <div className="workbench-home__quick-task-input">
                            <input
                                value={quickTask}
                                onChange={(event) => setQuickTask(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                        event.preventDefault();
                                        submitQuickTask();
                                    }
                                }}
                                placeholder="例如：根据刚收集的素材，整理一份短视频创作简报"
                                aria-label="快速任务内容"
                            />
                            <button
                                type="button"
                                onClick={submitQuickTask}
                                disabled={!quickTask.trim()}
                                aria-label="转到创作"
                            >
                                <span>转到创作</span>
                                <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
                            </button>
                        </div>
                    </section>

                    <section>
                        <div className="workbench-home__section-title">
                            <span>PRODUCTION DESK</span>
                            <h2>快速生产</h2>
                        </div>
                        <div className="grid gap-x-4 sm:grid-cols-2 xl:grid-cols-4">
                        <QuickAppButton
                            label="制作封面"
                            description="生成适合发布的视觉封面"
                            icon={ImagePlus}
                            tintClassName="bg-emerald-500/10 text-emerald-700"
                            onClick={() => onNavigateToGenerationStudio?.('cover')}
                        />
                        <QuickAppButton
                            label="生图"
                            description="用提示词生成素材图片"
                            icon={Sparkles}
                            tintClassName="bg-sky-500/10 text-sky-700"
                            onClick={() => onNavigateToGenerationStudio?.('image')}
                        />
                        <QuickAppButton
                            label="生视频"
                            description="把想法推进成视频片段"
                            icon={Clapperboard}
                            tintClassName="bg-violet-500/10 text-violet-700"
                            onClick={() => onNavigateToGenerationStudio?.('video')}
                        />
                        <QuickAppButton
                            label="生音频"
                            description="用角色音色合成旁白"
                            icon={Mic2}
                            tintClassName="bg-amber-500/10 text-amber-700"
                            onClick={() => onNavigateToGenerationStudio?.('audio')}
                        />
                        </div>
                    </section>

                    {pluginHomeWidgets.length > 0 && (
                        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            {pluginHomeWidgets.map((widget) => (
                                <PluginHomeWidgetCard
                                    key={widget.id}
                                    widget={widget}
                                    onRun={runPluginHomeCommand}
                                />
                            ))}
                        </section>
                    )}

                    <section className="flex min-h-[310px] flex-col gap-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="workbench-home__section-title">
                                <span>RECENT WORK</span>
                                <h2>最近稿件</h2>
                            </div>
                        </div>
                        {recentManuscripts.length > 0 ? (
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                {recentManuscripts.map((manuscript) => (
                                    <RecentManuscriptCard
                                        key={manuscript.path}
                                        manuscript={manuscript}
                                        onOpen={onOpenManuscript}
                                    />
                                ))}
                            </div>
                        ) : (
                            <WorkbenchStatePanel state="empty" title="还没有稿件" description="从快速任务创建一份创作简报，或从灵感桌交接一个方向。" />
                        )}
                    </section>

                </div>

                {inspectorOpen && (
                    <button
                        type="button"
                        className="workbench-home__inspector-backdrop"
                        onClick={() => setInspectorOpen(false)}
                        aria-label="关闭编辑建议"
                    />
                )}
                <aside className={`workbench-home__inspector min-h-[520px] border-l border-border bg-surface-primary px-6 py-5 ${inspectorOpen ? 'is-open' : ''}`} aria-label="编辑建议">
                    <div className="flex items-center justify-between gap-3">
                        <div className="inline-flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                            <Sparkles className="h-4 w-4 text-emerald-600" strokeWidth={1.8} />
                            今日批注
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => sendAiSuggestion('看一下我当前的内容工作台，建议今天最值得推进的 3 件事。', '今天做什么')}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                                title="询问 AI"
                                aria-label="询问 AI"
                            >
                                <Send className="h-4 w-4" strokeWidth={1.8} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setInspectorOpen(false)}
                                className="workbench-home__inspector-close inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                                title="关闭编辑建议"
                                aria-label="关闭编辑建议"
                            >
                                <X className="h-4 w-4" strokeWidth={1.8} />
                            </button>
                        </div>
                    </div>
                    <div className="workbench-home__editorial-note mt-7 p-5">
                        <h2 className="text-[17px] font-semibold leading-6 tracking-[-0.02em] text-text-primary">今天先推进哪件事？</h2>
                        <p className="mt-3 text-[13px] leading-6 text-text-secondary">从最近稿件开始，整理结构、改写脚本或生成封面方向。</p>
                    </div>
                    <div className="mt-5 divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface-primary">
                        {aiSuggestions.map((suggestion) => {
                            const Icon = suggestion.icon;
                            return (
                                <button
                                    key={suggestion.label}
                                    type="button"
                                    onClick={() => sendAiSuggestion(suggestion.prompt, suggestion.label)}
                                    className="group flex w-full items-center gap-3 px-3 py-3 text-left text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                                >
                                    <Icon className="h-4 w-4 shrink-0 text-text-tertiary group-hover:text-accent-primary" strokeWidth={1.8} />
                                    <span className="min-w-0 flex-1 truncate">{suggestion.label}</span>
                                    <ArrowRight className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" strokeWidth={1.8} />
                                </button>
                            );
                        })}
                        {pluginQuickActions.map((action) => (
                            <button
                                key={action.id}
                                type="button"
                                onClick={() => runPluginHomeCommand(action)}
                                className="group flex w-full items-center gap-3 px-3 py-3 text-left text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                            >
                                <Sparkles className="h-4 w-4 shrink-0 text-text-tertiary group-hover:text-accent-primary" strokeWidth={1.8} />
                                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                                <ArrowRight className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" strokeWidth={1.8} />
                            </button>
                        ))}
                    </div>
                    {pluginSidebarSections.length > 0 && (
                        <div className="mt-5 space-y-3">
                            {pluginSidebarSections.map((widget) => (
                                <PluginHomeWidgetCard
                                    key={widget.id}
                                    widget={widget}
                                    onRun={runPluginHomeCommand}
                                />
                            ))}
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={() => sendAiSuggestion('我想继续推进内容创作，请先问我 3 个必要问题，然后给出下一步。', 'Ask anything')}
                        className="mt-5 flex h-11 w-full items-center justify-between rounded-xl bg-surface-secondary px-4 text-left text-[13px] font-medium text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary"
                    >
                        <span>继续询问编辑台...</span>
                        <MessageSquareText className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                </aside>
            </div>

            {approvalOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 px-4 py-5">
                    <div className="flex h-full max-h-[760px] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface-primary shadow-2xl">
                        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
                            <div className="text-[14px] font-semibold text-text-primary">审批</div>
                            <button
                                type="button"
                                onClick={() => {
                                    setApprovalOpen(false);
                                    void loadStats();
                                }}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                                title="关闭"
                                aria-label="关闭"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1">
                            <ApprovalPanel isActive={approvalOpen} />
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
