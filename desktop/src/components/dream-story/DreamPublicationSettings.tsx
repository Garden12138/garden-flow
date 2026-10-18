import { useEffect, useState } from 'react';
import type { TikTokVideoVersion, TikTokPublishSettings } from '../../../shared/tiktokVideo';
export function DreamPublicationSettings({ projectId, disabled, registerFlush }: { projectId: string; disabled: boolean; registerFlush?: (flush: () => Promise<void>) => void }) {
    const [version, setVersion] = useState<TikTokVideoVersion | null>(null);
    const [description, setDescription] = useState(''); const [tags, setTags] = useState('');
    const [settings, setSettings] = useState<Partial<TikTokPublishSettings>>({}); const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    useEffect(() => { void window.ipcRenderer.tiktokVideo.getVersion({ projectId }).then(raw => {
        const result = raw as { success: boolean; version?: TikTokVideoVersion; error?: string };
        if (result.version) { setVersion(result.version); setDescription(result.version.description); setTags(result.version.hashtags.join(' ')); setSettings(result.version.publishSettings || {}); }
        else if (!result.success) setError(result.error || '发布资料读取失败');
    }); }, [projectId]);
    const field = 'mt-1 w-full rounded-lg border border-border bg-surface-primary p-2 text-xs';
    const save = async () => {
        if (!version || (description === version.description && tags === version.hashtags.join(' ') && JSON.stringify(settings) === JSON.stringify(version.publishSettings || {}))) return;
        setSaving(true); setError('');
        try { const raw = await window.ipcRenderer.tiktokVideo.saveVersion({ versionId: version.id, expectedRevision: version.revision,
            title: version.title, description, hashtags: tags.split(/[\s,#，]+/u).filter(Boolean), language: version.language, market: version.market, publishSettings: Object.keys(settings).length ? settings : null });
            const result = raw as { success: boolean; error?: string; version?: TikTokVideoVersion };
            if (!result.success || !result.version) throw new Error(result.error || '保存失败'); setVersion(result.version);
        } catch (reason) { setError(String(reason)); throw reason; } finally { setSaving(false); }
    };
    useEffect(() => { registerFlush?.(save); return () => registerFlush?.(async () => undefined); });
    return <section className="space-y-3 rounded-xl border border-border p-4"><h3 className="font-medium">TikTok 发布资料</h3>
        <p className="text-xs text-text-tertiary">封面候选：建议从成片开场核对选择；请在 Studio 中确认实际封面。生成内容建议开启 AI 标记。</p>
        <label className="block text-xs">描述<textarea aria-label="TikTok 描述" rows={4} value={description} className={field} onChange={event => setDescription(event.target.value)} /></label>
        <label className="block text-xs">话题<input aria-label="TikTok 话题" value={tags} className={field} onChange={event => setTags(event.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3 text-xs"><label>可见范围<select aria-label="TikTok 可见范围" className={field} value={settings.visibility || ''} onChange={event => setSettings(old => ({ ...old, visibility: event.target.value as TikTokPublishSettings['visibility'] }))}><option value="">请选择</option><option value="everyone">所有人</option><option value="friends">互关好友</option><option value="only_me">仅自己</option></select></label>
            <label>商业披露<select aria-label="商业披露" className={field} value={settings.commercialContent || ''} onChange={event => setSettings(old => ({ ...old, commercialContent: event.target.value as TikTokPublishSettings['commercialContent'] }))}><option value="">请选择</option><option value="none">无</option><option value="own_brand">自有品牌</option><option value="paid_partnership">品牌合作</option></select></label>
            {([['allowComments', '允许评论'], ['allowReuse', '允许内容复用'], ['allowRemix', '允许 Remix'], ['audience18Plus', '仅成年观众'], ['aiGenerated', 'AI 内容标记']] as const).map(([key, label]) => <label key={key}>{label}<select aria-label={label} className={field} value={settings[key] === undefined ? '' : String(settings[key])} onChange={event => setSettings(old => ({ ...old, [key]: event.target.value === '' ? undefined : event.target.value === 'true' }))}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select></label>)}
        </div>
        <button type="button" disabled={disabled || saving || !version} onClick={() => void save().catch(() => undefined)} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">保存发布文案与设置</button><button type="button" className="ml-2 text-xs underline" onClick={() => { void window.ipcRenderer.tiktokVideo.getVersion({ projectId }).then(raw => { const result = raw as { version?: TikTokVideoVersion; error?: string }; if (!result.version) { setError(result.error || '读取失败'); return; } setVersion(result.version); setDescription(result.version.description); setTags(result.version.hashtags.join(' ')); setSettings(result.version.publishSettings || {}); setError(''); }); }}>放弃本地修改，重新加载</button>{error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </section>;
}
