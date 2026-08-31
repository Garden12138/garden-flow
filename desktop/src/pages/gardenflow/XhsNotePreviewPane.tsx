import { useCallback, useEffect, useMemo, useState, type ReactNode, type VideoHTMLAttributes } from 'react';
import { AlertTriangle, Check, Copy, Download, Image as ImageIcon, Loader2, Pencil, RefreshCw, Save, Upload, Video } from 'lucide-react';
import { clsx } from 'clsx';
import type { ChatMessageLinkTarget } from '../../components/MessageItem';
import type {
    XhsImagePage,
    XhsNoteDocument,
    XhsNoteProjectSnapshot,
    XhsSubtitleItem,
    XhsVideoStoryboardItem,
} from '../../../shared/xhsNote';
import { isXhsMediaCompatible, renderXhsNoteMarkdown } from '../../../shared/xhsNote';
import { resolveAssetUrl } from '../../utils/pathManager';
import { subscribeDataChanged } from '../../bridge/appEvents';

type PreviewTab = 'publish' | 'copy' | 'assets';

interface XhsNotePreviewPaneProps {
    target: ChatMessageLinkTarget;
}

interface XhsBridgeResult extends Partial<XhsNoteProjectSnapshot> {
    success?: boolean;
    error?: string;
    canceled?: boolean;
    xhsNote?: XhsNoteDocument;
    outputPath?: string;
}

interface ImportedMediaAsset {
    id: string;
    mimeType?: string;
}

interface MediaImportResult {
    success?: boolean;
    canceled?: boolean;
    error?: string;
    imported?: ImportedMediaAsset[];
}

async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        return copied;
    }
}

const splitLines = (value: string): string[] => value.split('\n').map((item) => item.trim()).filter(Boolean);

function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={() => void copyText(text).then((ok) => {
                setCopied(ok);
                window.setTimeout(() => setCopied(false), 1200);
            })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-primary px-2.5 text-xs font-medium text-text-secondary transition hover:bg-surface-secondary"
        >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? '已复制' : label}
        </button>
    );
}

function CopySection({ title, text, children }: { title: string; text: string; children: ReactNode }) {
    return (
        <section className="rounded-2xl border border-border bg-surface-primary p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
                <CopyButton text={text} />
            </div>
            <div className="text-sm leading-6 text-text-secondary">{children}</div>
        </section>
    );
}

function isVideoAtEnd(video: HTMLVideoElement): boolean {
    return video.ended || (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= video.duration - 0.05);
}

function resetEndedVideo(video: HTMLVideoElement): void {
    if (!isVideoAtEnd(video)) return;
    try {
        video.currentTime = 0;
    } catch {
        // A later pointer or play event retries once the final media read has settled.
    }
}

function ReplayableVideo({ onEnded, onPlay, onPointerDownCapture, ...props }: VideoHTMLAttributes<HTMLVideoElement>) {
    return (
        <video
            {...props}
            preload={props.preload || 'metadata'}
            onPointerDownCapture={(event) => {
                resetEndedVideo(event.currentTarget);
                onPointerDownCapture?.(event);
            }}
            onPlay={(event) => {
                resetEndedVideo(event.currentTarget);
                onPlay?.(event);
            }}
            onEnded={(event) => {
                const video = event.currentTarget;
                onEnded?.(event);
                window.setTimeout(() => resetEndedVideo(video), 0);
            }}
        />
    );
}

const inputClass = 'w-full rounded-xl border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary outline-none transition focus:border-accent-primary';
const textareaClass = `${inputClass} min-h-[96px] resize-y leading-6`;

function mediaForRole(document: XhsNoteDocument, slotId: string) {
    return document.mediaSlots.find((slot) => slot.id === slotId);
}

function updatePage(pages: XhsImagePage[], pageId: string, patch: Partial<XhsImagePage>): XhsImagePage[] {
    return pages.map((page) => page.id === pageId ? { ...page, ...patch } : page);
}

function updateStoryboard(items: XhsVideoStoryboardItem[], itemId: string, patch: Partial<XhsVideoStoryboardItem>): XhsVideoStoryboardItem[] {
    return items.map((item) => item.id === itemId ? { ...item, ...patch } : item);
}

function subtitleLines(items: XhsSubtitleItem[]): string {
    return items.map((item) => `${item.startSeconds}\t${item.endSeconds}\t${item.text}`).join('\n');
}

function parseSubtitleLines(value: string): XhsSubtitleItem[] {
    return value.split('\n').map((line, index) => {
        const [startRaw, endRaw, ...textParts] = line.split('\t');
        const startSeconds = Math.max(0, Number(startRaw) || 0);
        return {
            id: `subtitle-${index + 1}`,
            startSeconds,
            endSeconds: Math.max(startSeconds, Number(endRaw) || startSeconds + 1),
            text: textParts.join('\t').trim(),
        };
    }).filter((item) => item.text);
}

export function XhsNotePreviewPane({ target }: XhsNotePreviewPaneProps) {
    const [tab, setTab] = useState<PreviewTab>('publish');
    const [document, setDocument] = useState<XhsNoteDocument | null>(target.xhsNote || null);
    const [draft, setDraft] = useState<XhsNoteDocument | null>(target.xhsNote || null);
    const [editing, setEditing] = useState(false);
    const [busy, setBusy] = useState<'save' | 'refresh' | 'export' | `upload:${string}` | null>(null);
    const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const [activePageSlotId, setActivePageSlotId] = useState('cover');

    const projectPath = target.projectPath || target.localPathCandidate || target.href;

    const applySnapshot = useCallback((result: XhsBridgeResult) => {
        const next = result.xhsNote || result.document;
        if (!next) return;
        setDocument(next);
        setDraft(next);
    }, []);

    useEffect(() => {
        setDocument(target.xhsNote || null);
        setDraft(target.xhsNote || null);
        setEditing(false);
        setMessage(null);
        setActivePageSlotId('cover');
    }, [target.href, target.version, target.xhsNote]);

    useEffect(() => subscribeDataChanged((_event, payload?: { scope?: string }) => {
        if (payload?.scope !== 'manuscripts' && payload?.scope !== 'media') return;
        void window.ipcRenderer.manuscripts.getXhsNote<XhsBridgeResult>(projectPath).then((result) => {
            if (result?.success) applySnapshot(result);
        });
    }), [applySnapshot, projectPath]);

    const refresh = async () => {
        setBusy('refresh');
        setMessage(null);
        try {
            const result = await window.ipcRenderer.manuscripts.getXhsNote<XhsBridgeResult>(projectPath);
            if (!result?.success) throw new Error(result?.error || '刷新失败');
            applySnapshot(result);
        } catch (error) {
            setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(null);
        }
    };

    const save = async () => {
        if (!draft || !document) return;
        setBusy('save');
        setMessage(null);
        try {
            const result = await window.ipcRenderer.manuscripts.saveXhsNote<XhsBridgeResult>({
                path: projectPath,
                document: draft,
                expectedRevision: document.revision,
            });
            if (!result?.success) throw new Error(result?.error || '保存失败');
            applySnapshot(result);
            setEditing(false);
            setMessage({ tone: 'success', text: `已保存版本 ${result.version || result.xhsNote?.revision || ''}` });
        } catch (error) {
            setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(null);
        }
    };

    const exportPackage = async () => {
        setBusy('export');
        setMessage(null);
        try {
            const result = await window.ipcRenderer.manuscripts.exportXhsMaterialPackage<XhsBridgeResult>({ path: projectPath });
            if (result?.canceled) return;
            if (!result?.success) throw new Error(result?.error || '导出失败');
            setMessage({ tone: 'success', text: `素材包已导出：${result.outputPath || ''}` });
        } catch (error) {
            setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(null);
        }
    };

    const uploadToSlot = async (slotId: string) => {
        if (!document) return;
        const slot = document.mediaSlots.find((item) => item.id === slotId);
        if (!slot) {
            setMessage({ tone: 'error', text: `未找到素材槽位：${slotId}` });
            return;
        }
        setBusy(`upload:${slotId}`);
        setMessage(null);
        try {
            const imported = await window.ipcRenderer.media.importFiles<MediaImportResult>({
                kind: slot.role === 'video' ? 'video' : 'image',
                multiple: false,
            });
            if (imported?.canceled) return;
            if (!imported?.success) throw new Error(imported?.error || '上传素材失败');
            const candidates = Array.isArray(imported.imported) ? imported.imported : [];
            const asset = candidates.find((item) => isXhsMediaCompatible(slot.role, item.mimeType));
            if (!asset?.id) {
                throw new Error(slot.role === 'video'
                    ? '该槽位需要视频文件，请选择 MP4、MOV 或 WebM 等视频素材。'
                    : '该槽位需要图片文件，请选择 PNG、JPG 或 WebP 等图片素材。');
            }
            const result = await window.ipcRenderer.manuscripts.bindXhsNoteMedia<XhsBridgeResult>({
                path: projectPath,
                slotId,
                assetId: asset.id,
                expectedRevision: document.revision,
            });
            if (!result?.success) throw new Error(result?.error || '素材已导入，但绑定笔记槽位失败');
            applySnapshot(result);
            setMessage({ tone: 'success', text: `${slot.label}上传并绑定成功` });
        } catch (error) {
            setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(null);
        }
    };

    const copyAll = async () => {
        if (!document) return;
        const copied = await copyText(renderXhsNoteMarkdown(document));
        setMessage(copied ? { tone: 'success', text: '已复制完整运营稿' } : { tone: 'error', text: '复制失败' });
    };

    const copyPayload = useMemo(() => {
        if (!document) return { tags: '', pages: '', storyboard: '', subtitles: '' };
        return {
            tags: document.hashtags.map((tag) => `#${tag}`).join(' '),
            pages: document.imagePages.map((page) => `第 ${page.index} 页${page.title ? `：${page.title}` : ''}\n${page.copy}\n画面：${page.visualBrief}\n提示词：${page.imagePrompt}`).join('\n\n'),
            storyboard: document.storyboard.map((item) => `${item.shot}\t${item.durationSeconds}s\t${item.visual}\t${item.voiceover}\t${item.onScreenText}`).join('\n'),
            subtitles: subtitleLines(document.subtitles),
        };
    }, [document]);

    if (!document || !draft) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
                未读取到结构化小红书笔记
            </div>
        );
    }

    const coverSlot = mediaForRole(document, 'cover');
    const videoSlot = mediaForRole(document, 'final-video');
    const selectedSlot = mediaForRole(document, activePageSlotId) || coverSlot;
    const publishMedia = document.noteType === 'video' ? videoSlot || coverSlot : selectedSlot;
    const publishUrl = publishMedia?.previewUrl ? resolveAssetUrl(publishMedia.previewUrl) : '';
    const coverUrl = coverSlot?.previewUrl ? resolveAssetUrl(coverSlot.previewUrl) : '';

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface-secondary/25">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-primary px-4 py-3">
                <div className="flex rounded-xl bg-surface-secondary p-1">
                    {([
                        ['publish', '发布预览'],
                        ['copy', '可复制内容'],
                        ['assets', '素材'],
                    ] as Array<[PreviewTab, string]>).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setTab(value)}
                            className={clsx(
                                'rounded-lg px-3 py-1.5 text-xs font-medium transition',
                                tab === value ? 'bg-surface-primary text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary',
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => void refresh()} disabled={Boolean(busy)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition hover:bg-surface-secondary" title="刷新">
                        <RefreshCw className={clsx('h-4 w-4', busy === 'refresh' && 'animate-spin')} />
                    </button>
                    <button type="button" onClick={() => void copyAll()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-text-secondary transition hover:bg-surface-secondary">
                        <Copy className="h-3.5 w-3.5" />复制全文
                    </button>
                    <button type="button" onClick={() => void exportPackage()} disabled={Boolean(busy)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-text-primary px-2.5 text-xs font-medium text-surface-primary transition hover:opacity-90 disabled:opacity-50">
                        {busy === 'export' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}素材包
                    </button>
                </div>
            </div>

            {message && (
                <div className={clsx(
                    'mx-4 mt-3 rounded-xl border px-3 py-2 text-xs',
                    message.tone === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700',
                )}>
                    {message.text}
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto p-4">
                {tab === 'publish' && (
                    <div className="mx-auto max-w-[460px]">
                        <div className="overflow-hidden rounded-[30px] border border-border bg-surface-primary shadow-xl shadow-black/5">
                            <div className={clsx('relative flex aspect-[3/4] items-center justify-center overflow-hidden', document.noteType === 'video' ? 'bg-black' : 'bg-gradient-to-br from-rose-100 to-amber-50')}>
                                {publishUrl ? document.noteType === 'video' && publishMedia?.role === 'video' ? (
                                    <ReplayableVideo src={publishUrl} poster={coverUrl || undefined} controls playsInline className="h-full w-full object-contain" />
                                ) : (
                                    <img src={publishUrl} alt={publishMedia?.label || '笔记图片'} className="h-full w-full object-cover" />
                                ) : (
                                    <div className="flex flex-col items-center gap-3 text-text-tertiary">
                                        {document.noteType === 'video' ? <Video className="h-8 w-8" /> : <ImageIcon className="h-8 w-8" />}
                                        <span className="text-sm">{document.noteType === 'video' ? '视频待确认生成' : `${publishMedia?.label || '图片'}待生成`}</span>
                                    </div>
                                )}
                                {document.noteType === 'image' && document.coverText && activePageSlotId === 'cover' && !publishUrl && (
                                    <div className="absolute inset-x-8 text-center text-2xl font-black leading-tight text-zinc-800">{document.coverText}</div>
                                )}
                            </div>
                            {document.noteType === 'image' && (
                                <div className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2">
                                    <button type="button" onClick={() => setActivePageSlotId('cover')} className={clsx('shrink-0 rounded-full px-2.5 py-1 text-[11px]', activePageSlotId === 'cover' ? 'bg-text-primary text-surface-primary' : 'bg-surface-secondary text-text-secondary')}>封面</button>
                                    {document.imagePages.map((page) => (
                                        <button key={page.id} type="button" onClick={() => setActivePageSlotId(page.mediaSlotId)} className={clsx('shrink-0 rounded-full px-2.5 py-1 text-[11px]', activePageSlotId === page.mediaSlotId ? 'bg-text-primary text-surface-primary' : 'bg-surface-secondary text-text-secondary')}>第 {page.index} 页</button>
                                    ))}
                                </div>
                            )}
                            <div className="p-5">
                                <h1 className="text-lg font-bold leading-7 text-text-primary">{document.finalTitle || '未命名小红书笔记'}</h1>
                                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-text-secondary">{document.body}</p>
                                <p className="mt-3 text-sm leading-6 text-blue-600">{copyPayload.tags}</p>
                            </div>
                        </div>
                    </div>
                )}

                {tab === 'copy' && !editing && (
                    <div className="mx-auto grid max-w-[760px] gap-3">
                        <div className="flex justify-end">
                            <button type="button" onClick={() => setEditing(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-primary px-3 text-xs font-medium text-text-secondary hover:bg-surface-secondary"><Pencil className="h-3.5 w-3.5" />编辑各分区</button>
                        </div>
                        <CopySection title="最终标题" text={document.finalTitle}><p>{document.finalTitle}</p></CopySection>
                        <CopySection title="标题候选" text={document.titleCandidates.join('\n')}><ul className="list-disc space-y-1 pl-5">{document.titleCandidates.map((item) => <li key={item}>{item}</li>)}</ul></CopySection>
                        <CopySection title="封面文案" text={document.coverText}><p className="whitespace-pre-wrap">{document.coverText}</p></CopySection>
                        <CopySection title="正文" text={document.body}><p className="whitespace-pre-wrap">{document.body}</p></CopySection>
                        <CopySection title="标签" text={copyPayload.tags}><p className="text-blue-600">{copyPayload.tags}</p></CopySection>
                        {document.imagePages.length > 0 && <CopySection title="逐页方案" text={copyPayload.pages}><div className="space-y-4">{document.imagePages.map((page) => <div key={page.id}><strong>第 {page.index} 页{page.title ? ` · ${page.title}` : ''}</strong><p className="mt-1 whitespace-pre-wrap">{page.copy}</p><p className="mt-1 text-xs text-text-tertiary">画面：{page.visualBrief}</p></div>)}</div></CopySection>}
                        {document.noteType === 'video' && <CopySection title="口播稿" text={document.voiceover}><p className="whitespace-pre-wrap">{document.voiceover}</p></CopySection>}
                        {document.noteType === 'video' && <CopySection title="分镜表" text={copyPayload.storyboard}><div className="overflow-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead><tr className="text-text-tertiary"><th className="pb-2">镜头</th><th className="pb-2">时长</th><th className="pb-2">画面</th><th className="pb-2">口播</th><th className="pb-2">屏幕文字</th></tr></thead><tbody>{document.storyboard.map((item) => <tr key={item.id} className="border-t border-border align-top"><td className="py-2 pr-2">{item.shot}</td><td className="py-2 pr-2">{item.durationSeconds}s</td><td className="py-2 pr-2">{item.visual}</td><td className="py-2 pr-2">{item.voiceover}</td><td className="py-2">{item.onScreenText}</td></tr>)}</tbody></table></div></CopySection>}
                        {document.noteType === 'video' && <CopySection title="字幕" text={copyPayload.subtitles}><div className="space-y-1">{document.subtitles.map((item) => <p key={item.id}><span className="mr-2 font-mono text-xs text-text-tertiary">{item.startSeconds}s–{item.endSeconds}s</span>{item.text}</p>)}</div></CopySection>}
                    </div>
                )}

                {tab === 'copy' && editing && (
                    <div className="mx-auto grid max-w-[760px] gap-4 rounded-2xl border border-border bg-surface-primary p-5">
                        <label className="grid gap-1.5 text-xs font-medium text-text-secondary">最终标题<input className={inputClass} value={draft.finalTitle} onChange={(event) => setDraft({ ...draft, finalTitle: event.target.value })} /></label>
                        <label className="grid gap-1.5 text-xs font-medium text-text-secondary">标题候选（每行一个）<textarea className={textareaClass} value={draft.titleCandidates.join('\n')} onChange={(event) => setDraft({ ...draft, titleCandidates: splitLines(event.target.value) })} /></label>
                        <label className="grid gap-1.5 text-xs font-medium text-text-secondary">封面文案<textarea className={textareaClass} value={draft.coverText} onChange={(event) => setDraft({ ...draft, coverText: event.target.value })} /></label>
                        <label className="grid gap-1.5 text-xs font-medium text-text-secondary">正文<textarea className={`${textareaClass} min-h-[180px]`} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
                        <label className="grid gap-1.5 text-xs font-medium text-text-secondary">标签（每行一个）<textarea className={textareaClass} value={draft.hashtags.join('\n')} onChange={(event) => setDraft({ ...draft, hashtags: splitLines(event.target.value).map((item) => item.replace(/^#+/, '')) })} /></label>
                        {draft.imagePages.map((page) => (
                            <fieldset key={page.id} className="grid gap-3 rounded-xl border border-border p-4">
                                <legend className="px-2 text-xs font-semibold text-text-primary">第 {page.index} 页</legend>
                                <input className={inputClass} placeholder="页面标题" value={page.title} onChange={(event) => setDraft({ ...draft, imagePages: updatePage(draft.imagePages, page.id, { title: event.target.value }) })} />
                                <textarea className={textareaClass} placeholder="页面文案" value={page.copy} onChange={(event) => setDraft({ ...draft, imagePages: updatePage(draft.imagePages, page.id, { copy: event.target.value }) })} />
                                <textarea className={textareaClass} placeholder="画面方案" value={page.visualBrief} onChange={(event) => setDraft({ ...draft, imagePages: updatePage(draft.imagePages, page.id, { visualBrief: event.target.value }) })} />
                                <textarea className={textareaClass} placeholder="图片生成提示词" value={page.imagePrompt} onChange={(event) => setDraft({ ...draft, imagePages: updatePage(draft.imagePages, page.id, { imagePrompt: event.target.value }) })} />
                            </fieldset>
                        ))}
                        {draft.noteType === 'video' && <label className="grid gap-1.5 text-xs font-medium text-text-secondary">口播稿<textarea className={`${textareaClass} min-h-[180px]`} value={draft.voiceover} onChange={(event) => setDraft({ ...draft, voiceover: event.target.value })} /></label>}
                        {draft.noteType === 'video' && <div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-xs font-medium text-text-secondary">时长（秒）<input type="number" min="1" className={inputClass} value={draft.durationSeconds} onChange={(event) => setDraft({ ...draft, durationSeconds: Number(event.target.value) || 0 })} /></label><label className="grid gap-1.5 text-xs font-medium text-text-secondary">比例<input className={inputClass} value={draft.aspectRatio} onChange={(event) => setDraft({ ...draft, aspectRatio: event.target.value })} /></label></div>}
                        {draft.noteType === 'video' && draft.storyboard.map((item) => (
                            <fieldset key={item.id} className="grid gap-3 rounded-xl border border-border p-4">
                                <legend className="px-2 text-xs font-semibold text-text-primary">分镜 {item.index}</legend>
                                <div className="grid grid-cols-[1fr_110px] gap-3"><input className={inputClass} placeholder="镜头名称" value={item.shot} onChange={(event) => setDraft({ ...draft, storyboard: updateStoryboard(draft.storyboard, item.id, { shot: event.target.value }) })} /><input type="number" min="0" className={inputClass} value={item.durationSeconds} onChange={(event) => setDraft({ ...draft, storyboard: updateStoryboard(draft.storyboard, item.id, { durationSeconds: Number(event.target.value) || 0 }) })} /></div>
                                <textarea className={textareaClass} placeholder="画面" value={item.visual} onChange={(event) => setDraft({ ...draft, storyboard: updateStoryboard(draft.storyboard, item.id, { visual: event.target.value }) })} />
                                <textarea className={textareaClass} placeholder="视频生成提示词（只描述画面、材质、光影、动作、运镜和风格；文字留给后期）" value={item.generationPrompt} onChange={(event) => setDraft({ ...draft, storyboard: updateStoryboard(draft.storyboard, item.id, { generationPrompt: event.target.value }) })} />
                                <textarea className={textareaClass} placeholder="口播" value={item.voiceover} onChange={(event) => setDraft({ ...draft, storyboard: updateStoryboard(draft.storyboard, item.id, { voiceover: event.target.value }) })} />
                                <input className={inputClass} placeholder="屏幕文字" value={item.onScreenText} onChange={(event) => setDraft({ ...draft, storyboard: updateStoryboard(draft.storyboard, item.id, { onScreenText: event.target.value }) })} />
                            </fieldset>
                        ))}
                        {draft.noteType === 'video' && <label className="grid gap-1.5 text-xs font-medium text-text-secondary">字幕（每行：开始秒 Tab 结束秒 Tab 文案）<textarea className={`${textareaClass} min-h-[160px] font-mono text-xs`} value={subtitleLines(draft.subtitles)} onChange={(event) => setDraft({ ...draft, subtitles: parseSubtitleLines(event.target.value) })} /></label>}
                        <div className="flex justify-end gap-2 border-t border-border pt-4">
                            <button type="button" onClick={() => { setDraft(document); setEditing(false); }} disabled={Boolean(busy)} className="h-9 rounded-xl border border-border px-4 text-sm font-medium text-text-secondary hover:bg-surface-secondary">取消</button>
                            <button type="button" onClick={() => void save()} disabled={Boolean(busy)} className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent-primary px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存修改</button>
                        </div>
                    </div>
                )}

                {tab === 'assets' && (
                    <div className="mx-auto grid max-w-[760px] gap-3 sm:grid-cols-2">
                        {document.mediaSlots.map((slot) => {
                            const url = slot.previewUrl ? resolveAssetUrl(slot.previewUrl) : '';
                            return (
                                <article key={slot.id} className="overflow-hidden rounded-2xl border border-border bg-surface-primary">
                                    <div className="flex aspect-video w-full items-center justify-center bg-surface-secondary/60">
                                        {url ? slot.role === 'video' ? <ReplayableVideo src={url} controls playsInline className="h-full w-full object-contain" /> : <img src={url} alt={slot.label} className="h-full w-full object-cover" /> : (
                                            <button
                                                type="button"
                                                onClick={() => void uploadToSlot(slot.id)}
                                                disabled={Boolean(busy)}
                                                className="flex h-full w-full flex-col items-center justify-center gap-2 text-text-tertiary transition hover:bg-surface-secondary hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-60"
                                                title={`上传并绑定${slot.label}`}
                                            >
                                                {busy === `upload:${slot.id}` ? <Loader2 className="h-7 w-7 animate-spin" /> : slot.status === 'failed' ? <AlertTriangle className="h-7 w-7 text-amber-500" /> : <ImageIcon className="h-7 w-7" />}
                                                <span className="text-xs">点击上传{slot.role === 'video' ? '视频' : '图片'}</span>
                                            </button>
                                        )}
                                    </div>
                                    <div className="p-3">
                                        <div className="flex items-center justify-between gap-2"><strong className="text-sm text-text-primary">{slot.label}</strong><span className={clsx('rounded-full px-2 py-0.5 text-[10px]', slot.status === 'ready' ? 'bg-green-100 text-green-700' : slot.status === 'failed' || slot.status === 'missing' ? 'bg-red-100 text-red-700' : 'bg-zinc-100 text-zinc-600')}>{slot.status}</span></div>
                                        <p className="mt-1 truncate text-xs text-text-tertiary">{slot.assetId || '尚未绑定素材'}</p>
                                        {slot.error && <p className="mt-2 text-xs text-red-500">{slot.error}</p>}
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => void uploadToSlot(slot.id)}
                                                disabled={Boolean(busy)}
                                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-primary px-2.5 text-xs font-medium text-text-secondary transition hover:bg-surface-secondary disabled:opacity-50"
                                            >
                                                {busy === `upload:${slot.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                                                {slot.status === 'ready' ? '替换素材' : '上传素材'}
                                            </button>
                                            {(slot.status === 'failed' || slot.status === 'missing') && <CopyButton text={`请重试生成并绑定小红书笔记 ${target.uri || target.href} 的媒体槽位 ${slot.id}`} label="复制重试指令" />}
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
