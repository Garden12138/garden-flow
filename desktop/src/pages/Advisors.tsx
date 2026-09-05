import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Bot,
    FileText,
    Loader2,
    Pencil,
    Plus,
    Trash2,
    Upload,
    UserRound,
    X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { hasRenderableAssetUrl, resolveAssetUrl } from '../utils/pathManager';
import { appAlert, appConfirm } from '../utils/appDialogs';

export interface Advisor {
    id: string;
    name: string;
    avatar: string;
    personality: string;
    systemPrompt: string;
    knowledgeLanguage?: string;
    knowledgeFiles: string[];
    gardenflowVisible?: boolean;
    gardenflowOrder?: number;
    createdAt: string;
}

export type AdvisorProfile = Advisor;
export type AdvisorCreateMode = 'manual';

interface PendingKnowledgeFile {
    path: string;
    name: string;
}

const AVATAR_OPTIONS = ['🧠', '💡', '📊', '🎨', '📝', '🔍', '💼', '🎯', '🌟', '🚀'];

function advisorAvatar(advisor: Pick<Advisor, 'avatar' | 'name'>, className: string) {
    if (hasRenderableAssetUrl(advisor.avatar)) {
        return (
            <img
                src={resolveAssetUrl(advisor.avatar)}
                alt={advisor.name}
                className={clsx(className, 'object-cover')}
            />
        );
    }
    return (
        <span className="leading-none" aria-hidden="true">
            {String(advisor.avatar || advisor.name || '成').trim().slice(0, 2)}
        </span>
    );
}

async function pickKnowledgeFiles(): Promise<PendingKnowledgeFile[]> {
    const result = await window.ipcRenderer.advisors.pickKnowledgeFiles<{
        files?: Array<{ path?: string; name?: string }>;
    }>();
    if (!Array.isArray(result?.files)) return [];
    return result.files
        .map((file) => {
            const path = String(file?.path || '').trim();
            const name = String(file?.name || '').trim() || path.split(/[\\/]/).pop() || '未命名文件';
            return { path, name };
        })
        .filter((file) => file.path);
}

export function AdvisorModal({
    advisor,
    onSave,
    onClose,
}: {
    advisor: Advisor | null;
    defaultMode?: AdvisorCreateMode;
    onSave: (
        data: Omit<Advisor, 'id' | 'createdAt' | 'knowledgeFiles'>,
        youtubeParams?: { url: string; count: number; channelId?: string },
        knowledgeFilePaths?: string[],
    ) => Promise<void>;
    onClose: () => void;
}) {
    const [name, setName] = useState(advisor?.name || '');
    const [avatar, setAvatar] = useState(advisor?.avatar || AVATAR_OPTIONS[0]);
    const [personality, setPersonality] = useState(advisor?.personality || '');
    const [systemPrompt, setSystemPrompt] = useState(advisor?.systemPrompt || '');
    const [knowledgeLanguage, setKnowledgeLanguage] = useState(advisor?.knowledgeLanguage || '中文');
    const [pendingKnowledgeFiles, setPendingKnowledgeFiles] = useState<PendingKnowledgeFile[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isSubmitting) onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSubmitting, onClose]);

    const handleSelectAvatar = async () => {
        try {
            const selected = await window.ipcRenderer.advisors.selectAvatar();
            if (selected) setAvatar(String(selected));
        } catch (selectError) {
            console.error('Failed to select member avatar:', selectError);
            setError('头像选择失败，请重试。');
        }
    };

    const handlePickKnowledgeFiles = async () => {
        try {
            const selected = await pickKnowledgeFiles();
            setPendingKnowledgeFiles((current) => {
                const byPath = new Map(current.map((file) => [file.path, file]));
                selected.forEach((file) => byPath.set(file.path, file));
                return Array.from(byPath.values());
            });
        } catch (selectError) {
            console.error('Failed to select member knowledge files:', selectError);
            setError('知识文件选择失败，请重试。');
        }
    };

    const handleSubmit = async () => {
        const normalizedName = name.trim();
        if (!normalizedName || isSubmitting) {
            if (!normalizedName) setError('请填写成员名称。');
            return;
        }
        setError('');
        setIsSubmitting(true);
        try {
            await onSave({
                name: normalizedName,
                avatar: avatar || AVATAR_OPTIONS[0],
                personality: personality.trim(),
                systemPrompt: systemPrompt.trim(),
                knowledgeLanguage: knowledgeLanguage.trim() || '中文',
                gardenflowVisible: advisor?.gardenflowVisible,
                gardenflowOrder: advisor?.gardenflowOrder,
            }, undefined, pendingKnowledgeFiles.map((file) => file.path));
        } catch (submitError) {
            console.error('Failed to save member:', submitError);
            setError(submitError instanceof Error ? submitError.message : '保存失败，请重试。');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
            <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-surface-primary shadow-2xl">
                <header className="flex items-center justify-between border-b border-border px-6 py-5">
                    <div>
                        <h2 className="text-lg font-semibold text-text-primary">
                            {advisor ? '编辑成员' : '创建本地成员'}
                        </h2>
                        <p className="mt-1 text-xs text-text-tertiary">角色资料和知识文件只保存在当前空间。</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-primary disabled:opacity-50"
                        aria-label="关闭"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </header>

                <div className="space-y-5 overflow-y-auto px-6 py-5">
                    <div className="flex items-center gap-4">
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface-secondary text-2xl">
                            {advisorAvatar({ avatar, name }, 'h-full w-full')}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap gap-2">
                                {AVATAR_OPTIONS.map((option) => (
                                    <button
                                        key={option}
                                        type="button"
                                        onClick={() => setAvatar(option)}
                                        className={clsx(
                                            'inline-flex h-8 w-8 items-center justify-center rounded-lg border text-base transition-colors',
                                            avatar === option
                                                ? 'border-accent-primary bg-accent-primary/10'
                                                : 'border-border hover:bg-surface-secondary',
                                        )}
                                        aria-label={`使用头像 ${option}`}
                                    >
                                        {option}
                                    </button>
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={() => void handleSelectAvatar()}
                                className="text-xs font-medium text-accent-primary hover:underline"
                            >
                                选择本地图片
                            </button>
                        </div>
                    </div>

                    <label className="block">
                        <span className="mb-2 block text-sm font-medium text-text-primary">成员名称</span>
                        <input
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder="例如：选题策划"
                            autoFocus
                            className="w-full rounded-xl border border-border bg-surface-secondary/60 px-4 py-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent-primary"
                        />
                    </label>

                    <label className="block">
                        <span className="mb-2 block text-sm font-medium text-text-primary">职责描述</span>
                        <input
                            value={personality}
                            onChange={(event) => setPersonality(event.target.value)}
                            placeholder="一句话说明这个成员擅长什么"
                            className="w-full rounded-xl border border-border bg-surface-secondary/60 px-4 py-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent-primary"
                        />
                    </label>

                    <label className="block">
                        <span className="mb-2 block text-sm font-medium text-text-primary">角色指令</span>
                        <textarea
                            value={systemPrompt}
                            onChange={(event) => setSystemPrompt(event.target.value)}
                            placeholder="说明工作原则、输出格式与专业边界"
                            rows={6}
                            className="w-full resize-y rounded-xl border border-border bg-surface-secondary/60 px-4 py-3 text-sm leading-6 text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent-primary"
                        />
                    </label>

                    <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
                        <label className="block">
                            <span className="mb-2 block text-sm font-medium text-text-primary">知识语言</span>
                            <select
                                value={knowledgeLanguage}
                                onChange={(event) => setKnowledgeLanguage(event.target.value)}
                                className="w-full rounded-xl border border-border bg-surface-secondary/60 px-3 py-3 text-sm text-text-primary outline-none focus:border-accent-primary"
                            >
                                <option value="中文">中文</option>
                                <option value="English">English</option>
                                <option value="多语言">多语言</option>
                            </select>
                        </label>
                        <div>
                            <span className="mb-2 block text-sm font-medium text-text-primary">知识文件（可选）</span>
                            <button
                                type="button"
                                onClick={() => void handlePickKnowledgeFiles()}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-text-secondary transition-colors hover:border-accent-primary hover:text-accent-primary"
                            >
                                <Upload className="h-4 w-4" />
                                选择 Markdown 或文本文件
                            </button>
                        </div>
                    </div>

                    {pendingKnowledgeFiles.length > 0 && (
                        <div className="space-y-2 rounded-2xl bg-surface-secondary/55 p-3">
                            {pendingKnowledgeFiles.map((file) => (
                                <div key={file.path} className="flex items-center gap-2 text-xs text-text-secondary">
                                    <FileText className="h-3.5 w-3.5 shrink-0" />
                                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                                    <button
                                        type="button"
                                        onClick={() => setPendingKnowledgeFiles((current) => current.filter((item) => item.path !== file.path))}
                                        className="rounded p-1 text-text-tertiary hover:bg-surface-primary hover:text-text-primary"
                                        aria-label={`移除 ${file.name}`}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {error && (
                        <p className="rounded-xl bg-status-error/10 px-3 py-2 text-sm text-status-error" role="alert">
                            {error}
                        </p>
                    )}
                </div>

                <footer className="flex justify-end gap-3 border-t border-border px-6 py-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="rounded-xl px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-secondary disabled:opacity-50"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleSubmit()}
                        disabled={isSubmitting || !name.trim()}
                        className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                        {advisor ? '保存修改' : '创建成员'}
                    </button>
                </footer>
            </div>
        </div>
    );
}

export function Advisors({
    isActive = true,
    hideAdvisorList = false,
    selectedAdvisorId,
    onSelectedAdvisorIdChange,
    onAdvisorsChange,
    createRequestKey,
}: {
    isActive?: boolean;
    hideAdvisorList?: boolean;
    selectedAdvisorId?: string | null;
    onSelectedAdvisorIdChange?: (advisorId: string | null) => void;
    onAdvisorsChange?: (advisors: Advisor[]) => void;
    createRequestKey?: number;
    createRequestMode?: AdvisorCreateMode;
}) {
    const [advisors, setAdvisors] = useState<Advisor[]>([]);
    const [internalSelectedAdvisorId, setInternalSelectedAdvisorId] = useState<string | null>(null);
    const [editingAdvisor, setEditingAdvisor] = useState<Advisor | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');
    const createRequestRef = useRef(createRequestKey);

    const activeAdvisorId = selectedAdvisorId === undefined
        ? internalSelectedAdvisorId
        : selectedAdvisorId;

    const setActiveAdvisorId = useCallback((advisorId: string | null) => {
        if (selectedAdvisorId === undefined) setInternalSelectedAdvisorId(advisorId);
        onSelectedAdvisorIdChange?.(advisorId);
    }, [onSelectedAdvisorIdChange, selectedAdvisorId]);

    const loadAdvisors = useCallback(async () => {
        try {
            setError('');
            const list = await window.ipcRenderer.advisors.list<Advisor>();
            const next = Array.isArray(list) ? list : [];
            setAdvisors(next);
            onAdvisorsChange?.(next);
            const preferredId = selectedAdvisorId === undefined ? internalSelectedAdvisorId : selectedAdvisorId;
            if (!preferredId || !next.some((item) => item.id === preferredId)) {
                setActiveAdvisorId(next[0]?.id || null);
            }
        } catch (loadError) {
            console.error('Failed to load members:', loadError);
            setError('成员列表读取失败。');
        } finally {
            setIsLoading(false);
        }
    }, [internalSelectedAdvisorId, onAdvisorsChange, selectedAdvisorId, setActiveAdvisorId]);

    useEffect(() => {
        if (!isActive) return;
        void loadAdvisors();
        const handleChanged = () => void loadAdvisors();
        window.ipcRenderer.advisors.onChanged(handleChanged);
        return () => window.ipcRenderer.advisors.offChanged(handleChanged);
    }, [isActive, loadAdvisors]);

    useEffect(() => {
        if (createRequestKey === undefined || createRequestRef.current === createRequestKey) return;
        createRequestRef.current = createRequestKey;
        setEditingAdvisor(null);
        setIsModalOpen(true);
    }, [createRequestKey]);

    const selectedAdvisor = useMemo(
        () => advisors.find((advisor) => advisor.id === activeAdvisorId) || null,
        [activeAdvisorId, advisors],
    );

    const saveAdvisor = async (
        data: Omit<Advisor, 'id' | 'createdAt' | 'knowledgeFiles'>,
        _youtubeParams?: { url: string; count: number; channelId?: string },
        knowledgeFilePaths?: string[],
    ) => {
        if (editingAdvisor) {
            const result = await window.ipcRenderer.advisors.update({
                ...data,
                id: editingAdvisor.id,
            }) as { success?: boolean; error?: string };
            if (result?.success === false) throw new Error(result.error || '成员更新失败');
            if (knowledgeFilePaths?.length) {
                await window.ipcRenderer.advisors.uploadKnowledge({
                    advisorId: editingAdvisor.id,
                    filePaths: knowledgeFilePaths,
                });
            }
            setActiveAdvisorId(editingAdvisor.id);
        } else {
            const result = await window.ipcRenderer.advisors.create({ ...data }) as {
                success?: boolean;
                id?: string;
                error?: string;
            };
            if (result?.success === false || !result?.id) {
                throw new Error(result?.error || '成员创建失败');
            }
            if (knowledgeFilePaths?.length) {
                await window.ipcRenderer.advisors.uploadKnowledge({
                    advisorId: result.id,
                    filePaths: knowledgeFilePaths,
                });
            }
            setActiveAdvisorId(result.id);
        }
        await loadAdvisors();
        setIsModalOpen(false);
        setEditingAdvisor(null);
    };

    const addKnowledgeFiles = async () => {
        if (!selectedAdvisor || isUploading) return;
        setIsUploading(true);
        setError('');
        try {
            const files = await pickKnowledgeFiles();
            if (files.length === 0) return;
            const result = await window.ipcRenderer.advisors.uploadKnowledge({
                advisorId: selectedAdvisor.id,
                filePaths: files.map((file) => file.path),
            }) as { success?: boolean; error?: string };
            if (result?.success === false) throw new Error(result.error || '知识文件导入失败');
            await loadAdvisors();
        } catch (uploadError) {
            console.error('Failed to upload member knowledge:', uploadError);
            setError(uploadError instanceof Error ? uploadError.message : '知识文件导入失败。');
        } finally {
            setIsUploading(false);
        }
    };

    const deleteAdvisor = async () => {
        if (!selectedAdvisor) return;
        const confirmed = await appConfirm(
            `删除成员“${selectedAdvisor.name}”及其本地知识文件？`,
            { title: '删除成员', confirmLabel: '删除', tone: 'danger' },
        );
        if (!confirmed) return;
        const result = await window.ipcRenderer.advisors.delete(selectedAdvisor.id) as {
            success?: boolean;
        };
        if (result?.success === false) {
            await appAlert('成员删除失败，请重试。', { title: '删除失败', tone: 'danger' });
            return;
        }
        setActiveAdvisorId(null);
        await loadAdvisors();
    };

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在读取本地成员…
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 bg-surface-primary">
            {!hideAdvisorList && (
                <aside className="w-72 shrink-0 overflow-y-auto border-r border-border bg-surface-secondary/25 p-4">
                    <div className="mb-4 flex items-center justify-between">
                        <div>
                            <h2 className="font-semibold text-text-primary">本地成员</h2>
                            <p className="mt-1 text-xs text-text-tertiary">{advisors.length} 位成员</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setEditingAdvisor(null);
                                setIsModalOpen(true);
                            }}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-primary text-white hover:opacity-90"
                            aria-label="创建成员"
                        >
                            <Plus className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="space-y-2">
                        {advisors.map((advisor) => (
                            <button
                                key={advisor.id}
                                type="button"
                                onClick={() => setActiveAdvisorId(advisor.id)}
                                className={clsx(
                                    'flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors',
                                    activeAdvisorId === advisor.id
                                        ? 'border-accent-primary/30 bg-accent-primary/10'
                                        : 'border-transparent hover:border-border hover:bg-surface-primary',
                                )}
                            >
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-primary text-base">
                                    {advisorAvatar(advisor, 'h-full w-full')}
                                </div>
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-text-primary">{advisor.name}</div>
                                    <div className="mt-0.5 truncate text-xs text-text-tertiary">{advisor.personality || '尚未填写职责'}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </aside>
            )}

            <main className="min-w-0 flex-1 overflow-y-auto">
                {selectedAdvisor ? (
                    <div className="mx-auto max-w-4xl space-y-6 px-8 py-8">
                        <div className="flex items-start justify-between gap-6">
                            <div className="flex min-w-0 items-center gap-4">
                                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface-secondary text-2xl">
                                    {advisorAvatar(selectedAdvisor, 'h-full w-full')}
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-xs font-medium text-accent-primary">
                                        <Bot className="h-3.5 w-3.5" />
                                        本地 AI 成员
                                    </div>
                                    <h1 className="mt-1 truncate text-2xl font-semibold text-text-primary">{selectedAdvisor.name}</h1>
                                    <p className="mt-1 text-sm text-text-secondary">{selectedAdvisor.personality || '尚未填写职责描述'}</p>
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditingAdvisor(selectedAdvisor);
                                        setIsModalOpen(true);
                                    }}
                                    className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                                >
                                    <Pencil className="h-4 w-4" />
                                    编辑
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void deleteAdvisor()}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border text-text-tertiary hover:border-status-error/30 hover:bg-status-error/10 hover:text-status-error"
                                    aria-label="删除成员"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <section className="rounded-3xl border border-border bg-surface-secondary/25 p-6">
                            <h2 className="text-sm font-semibold text-text-primary">角色指令</h2>
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-text-secondary">
                                {selectedAdvisor.systemPrompt || '尚未填写角色指令。编辑成员后，可定义工作原则、表达风格与输出格式。'}
                            </p>
                        </section>

                        <section className="rounded-3xl border border-border p-6">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <h2 className="text-sm font-semibold text-text-primary">本地知识</h2>
                                    <p className="mt-1 text-xs text-text-tertiary">
                                        {selectedAdvisor.knowledgeFiles?.length || 0} 个文件 · {selectedAdvisor.knowledgeLanguage || '中文'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void addKnowledgeFiles()}
                                    disabled={isUploading}
                                    className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                                >
                                    {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                    添加文件
                                </button>
                            </div>
                            {selectedAdvisor.knowledgeFiles?.length ? (
                                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                    {selectedAdvisor.knowledgeFiles.map((fileName) => (
                                        <div key={fileName} className="flex items-center gap-2 rounded-xl bg-surface-secondary/60 px-3 py-2.5 text-sm text-text-secondary">
                                            <FileText className="h-4 w-4 shrink-0 text-accent-primary" />
                                            <span className="min-w-0 truncate">{fileName}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="mt-4 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-text-tertiary">
                                    添加 Markdown 或文本文件，让成员基于你的资料工作。
                                </div>
                            )}
                        </section>

                        {error && <p className="text-sm text-status-error">{error}</p>}
                    </div>
                ) : (
                    <div className="flex h-full min-h-[28rem] flex-col items-center justify-center px-6 text-center">
                        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent-primary/10 text-accent-primary">
                            <UserRound className="h-7 w-7" />
                        </div>
                        <h2 className="mt-5 text-lg font-semibold text-text-primary">创建第一位本地成员</h2>
                        <p className="mt-2 max-w-sm text-sm leading-6 text-text-tertiary">
                            定义角色职责和知识范围，再在 GardenFlow 或团队中调用。
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                setEditingAdvisor(null);
                                setIsModalOpen(true);
                            }}
                            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent-primary px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
                        >
                            <Plus className="h-4 w-4" />
                            创建成员
                        </button>
                    </div>
                )}
            </main>

            {isModalOpen && (
                <AdvisorModal
                    advisor={editingAdvisor}
                    onSave={saveAdvisor}
                    onClose={() => {
                        setIsModalOpen(false);
                        setEditingAdvisor(null);
                    }}
                />
            )}
        </div>
    );
}
