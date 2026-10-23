import { useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import { resolveAssetUrl } from '../../utils/pathManager';
import type { Note } from './knowledgeModel';

export function SocialPostDetail({ note, onClose, onRefresh, onChat }: { note: Note; onClose: () => void; onRefresh: () => void; onChat: () => void }) {
    const [index, setIndex] = useState(0);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [commentLimit, setCommentLimit] = useState(note.capture?.commentLimit ?? 5);
    const images = note.images || [];
    const comments = note.commentsSnapshot || [];
    const label = (note.captureKind || note.type || '').startsWith('douyin-') ? '抖音' : 'TikTok';
    const retry = async () => {
        if (!note.sourceUrl || busy) return;
        setBusy(true); setMessage('正在通过浏览器补采…');
        try {
            const result = await window.ipcRenderer.capture.saveUrl({ url: note.sourceUrl, commentLimit });
            if (!result.success) throw new Error(result.error || '补采失败');
            setMessage(result.capture?.status === 'partial' ? `已保存可获取的内容：${result.capture.errors.join('；')}` : '补采完成');
            onRefresh();
        } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
    };
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
        <section role="dialog" aria-modal="true" aria-label={`${label}作品详情`} onClick={(event) => event.stopPropagation()} className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface-primary shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-border p-4">
                <div className="min-w-0"><p className="text-xs text-text-secondary">{label} · {note.contentType === 'video' || note.video ? '视频' : '图集 / 作品资料'}</p><h2 className="mt-1 line-clamp-2 text-lg font-semibold">{note.title}</h2><p className="mt-1 text-xs text-text-secondary">{note.author} {(note.publishedAt || note.createdAt) ? `· ${new Date(note.publishedAt || note.createdAt).toLocaleString()}` : ''}</p></div>
                <button aria-label="关闭作品详情" onClick={onClose} className="rounded-lg p-2 hover:bg-surface-secondary"><X className="h-4 w-4" /></button>
            </header>
            <div className="grid overflow-auto md:grid-cols-2">
                <div className="relative flex min-h-64 items-center justify-center bg-black/95 p-4">
                    {note.video ? <video key={note.video} controls playsInline preload="metadata" poster={resolveAssetUrl(note.cover)} src={resolveAssetUrl(note.video)} className="max-h-[65vh] w-full" />
                        : images.length ? <div className="w-full"><img src={resolveAssetUrl(images[Math.min(index, images.length - 1)])} alt={`${note.title} · 第 ${index + 1} 张`} className="max-h-[60vh] w-full object-contain" />{images.length > 1 && <div className="mt-3 flex items-center justify-center gap-5 text-sm text-white"><button aria-label="上一张" onClick={() => setIndex((index + images.length - 1) % images.length)}><ChevronLeft /></button><span>{index + 1} / {images.length}</span><button aria-label="下一张" onClick={() => setIndex((index + 1) % images.length)}><ChevronRight /></button></div>}</div>
                            : <p className="p-8 text-center text-sm text-white/70">媒体尚未保存，可打开原文核对后补采。</p>}
                </div>
                <div className="space-y-5 p-5">
                    <div className={`rounded-lg border p-3 text-sm ${note.capture?.status === 'partial' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-border bg-surface-secondary'}`}>
                        <p>{note.capture?.status === 'partial' ? '部分保存，资料待补充' : '已保存'} · 已保存 {comments.length} 条评论</p>
                        {note.capture?.errors.map((error, index) => <p key={index} className="mt-1 text-xs">{error}</p>)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="flex items-center gap-2">评论数量<input aria-label="补采评论数量" type="number" min={0} max={200} value={commentLimit} disabled={busy} onChange={(event) => setCommentLimit(Math.max(0, Math.min(200, Number(event.target.value) || 0)))} className="w-16 rounded border border-border bg-surface-primary px-2 py-1.5" /></label>
                        <button onClick={() => void retry()} disabled={busy || !note.sourceUrl} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 disabled:opacity-50">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}重试补采</button>
                        {note.sourceUrl && <button onClick={() => void window.ipcRenderer.openExternalUrl(note.sourceUrl!)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2"><ExternalLink className="h-3 w-3" />打开原文</button>}
                        <button onClick={onChat} className="rounded-lg border border-border px-3 py-2">用于创作</button>
                    </div>
                    {message && <p role="status" className="text-sm text-text-secondary">{message}</p>}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{note.content}</p>
                    <p className="text-xs text-text-secondary">点赞 {note.stats?.likes ?? '—'} · 收藏 {note.stats?.collects ?? '—'} · 评论 {note.stats?.comments ?? '—'}</p>
                    {note.transcript && <details><summary className="cursor-pointer text-sm font-semibold">视频转写</summary><p className="mt-2 whitespace-pre-wrap text-sm">{note.transcript}</p></details>}
                    <section className="space-y-3"><h3 className="text-sm font-semibold">评论采样{note.capture?.comments === 'skipped' ? '（本次关闭）' : ''}</h3>{comments.map((comment, index) => <article key={comment.id || index} className={`rounded-lg bg-surface-secondary p-3 ${comment.level ? 'ml-4' : ''}`}><p className="text-xs text-text-secondary">{comment.author || '用户'} · {comment.createdAt || ''} · 赞 {comment.likes ?? 0}</p><p className="mt-1 whitespace-pre-wrap text-sm">{comment.text}</p></article>)}{!comments.length && <p className="text-xs text-text-secondary">暂无已保存的评论。</p>}</section>
                </div>
            </div>
        </section>
    </div>;
}
