import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { PRODUCT_PLATFORM_LABELS, ProductCreationSelectionSchema, resolveProductCreationTarget, type ProductCreationSelection, type ProductCreationTarget, type ProductPlatform } from '../../../shared/productCreationTarget';

type SelectionResult = { target: ProductCreationTarget; durationSeconds: number; pageCount: number; brief: string };
const control = 'w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm';

export function ProductCreationSetup({ initial, initialBrief = '', onSelect, onCancel, videoOnly = false, modeLocked = false, extraContent, confirmLabel = '按此目标规划' }: { confirmLabel?: string; initialBrief?: string; extraContent?: ReactNode; videoOnly?: boolean; modeLocked?: boolean; initial?: ProductCreationSelection; onSelect: (value: SelectionResult) => void; onCancel: () => void }) {
    const [platform, setPlatform] = useState<ProductPlatform>(initial?.platform || 'xiaohongshu');
    const [kind, setKind] = useState<'video' | 'image-set'>(initial?.contentKind || 'video');
    const [mode, setMode] = useState<'product-images' | 'existing-clips'>(initial?.compositionMode || 'product-images');
    const [ratio, setRatio] = useState<'9:16' | '16:9'>(initial?.aspectRatio === '16:9' ? '16:9' : '9:16');
    const [language, setLanguage] = useState(initial?.language || (platform === 'tiktok' ? 'en' : 'zh-CN'));
    const [market, setMarket] = useState(initial?.market || (platform === 'tiktok' ? 'International' : '中国'));
    const [duration, setDuration] = useState(String(initial?.durationSeconds || 15));
    const [count, setCount] = useState(String(initial?.pageCount || 5));
    const [ready, setReady] = useState(false);
    const [capabilities, setCapabilities] = useState<Array<{ platform: string; contentKind: string; creation: boolean }>>([]);
    const [error, setError] = useState('');
    const [brief, setBrief] = useState(initialBrief);
    useEffect(() => {
        let active = true;
        void window.ipcRenderer.videoEditorV2.getProductCapabilities().then(result => {
            if (active) { if (!result.success) throw new Error(result.error || '目标规格不可用'); setCapabilities(result.capabilities); setReady(true); }
        }).catch(error => { if (active) setError(String(error)); });
        return () => { active = false; };
    }, []);
    const supported = capabilities.some(item => item.platform === platform && item.contentKind === kind && item.creation);
    const choosePlatform = (value: ProductPlatform) => { setPlatform(value); setRatio('9:16'); setLanguage(value === 'tiktok' ? 'en' : 'zh-CN'); setMarket(value === 'tiktok' ? 'International' : '中国'); setError(''); };
    const submit = () => {
        try {
            const selection = ProductCreationSelectionSchema.parse({ platform, contentKind: kind, compositionMode: mode, aspectRatio: kind === 'image-set' ? '3:4' : ratio, language, market, durationSeconds: kind === 'video' ? Number(duration) : 15, pageCount: kind === 'image-set' ? Number(count) : 5 });
            onSelect({ target: resolveProductCreationTarget(selection), durationSeconds: selection.durationSeconds, pageCount: selection.pageCount, brief });
        } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    };
    return <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="选择商品创作目标">
        <section className="w-full max-w-xl rounded-2xl border border-border bg-surface-primary shadow-2xl">
            <header className="flex items-center border-b border-border p-5"><h2 className="mr-auto font-semibold">选择商品创作目标</h2><button onClick={onCancel} aria-label="关闭创作目标选择"><X className="h-4 w-4" /></button></header>
            <div className="grid grid-cols-2 gap-4 p-5 text-sm">
                <label>目标平台<select aria-label="目标平台" className={control} value={platform} onChange={event => choosePlatform(event.target.value as ProductPlatform)}>{Object.entries(PRODUCT_PLATFORM_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <label>内容形式<select aria-label="内容形式" className={control} value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="video">视频</option><option disabled={videoOnly} value="image-set">商品套图{platform !== 'xiaohongshu' ? ' · 待适配' : ''}</option></select></label>
                {kind === 'video' ? <>
                    <label>视频来源<select aria-label="视频来源" disabled={modeLocked} className={control} value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="product-images">商品原图编排</option><option value="existing-clips">已有片段混剪</option></select></label>
                    <label>画幅<select aria-label="画幅" className={control} value={ratio} onChange={event => setRatio(event.target.value as typeof ratio)}><option value="9:16">9:16 · 1080×1920</option>{platform === 'xiaohongshu' && <option value="16:9">16:9 · 1920×1080</option>}</select></label>
                    {!videoOnly && <><label>目标时长（秒）<input aria-label="目标时长" type="number" min={1} max={240} className={control} value={duration} onChange={event => setDuration(event.target.value)} /></label><p className="self-center text-xs text-text-tertiary">30fps · 最多 8 镜头，每镜头最多 30 秒</p></>}
                </> : <><label>图片数量（含封面）<input aria-label="套图数量" type="number" min={1} max={20} className={control} value={count} onChange={event => setCount(event.target.value)} /></label><p className="self-center text-xs text-text-tertiary">3:4 · 1440×1920 PNG · 封面固定首张</p></>}
                <label>文案／字幕语言<input aria-label="目标语言" className={control} value={language} onChange={event => setLanguage(event.target.value)} placeholder="en / zh-CN" /></label>
                <label>目标市场<input aria-label="目标市场" className={control} value={market} onChange={event => setMarket(event.target.value)} /></label>
                <p className="col-span-2 text-xs text-text-tertiary">{supported ? kind === 'video' ? '可创作、导出，并使用现有平台发布流程。' : '可创作、导出及准备小红书发布；应用发布上限 18 张。' : '此平台的套图规格和发布适配尚未完成，暂不可创建。'} 默认使用已有素材和可编辑本地文字，图片、视频、语音生成均须另行确认。</p>
                {!videoOnly && <label className="col-span-2">创作要求（可选）<textarea aria-label="创作要求" className={control} rows={3} maxLength={4000} value={brief} onChange={event => setBrief(event.target.value)} placeholder="希望强调的卖点、风格或用途" /></label>}
                {extraContent}
                {error && <p role="status" className="col-span-2 text-xs text-red-600">{error}</p>}
            </div>
            <footer className="flex justify-end gap-2 border-t border-border p-5"><button className="rounded-lg border border-border px-4 py-2 text-xs" onClick={onCancel}>取消</button><button className="rounded-lg bg-accent-primary px-4 py-2 text-xs text-white disabled:opacity-40" disabled={!ready || !supported} onClick={submit}>{confirmLabel}</button></footer>
        </section>
    </div>;
}
