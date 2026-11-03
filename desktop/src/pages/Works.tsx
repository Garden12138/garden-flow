import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, List, Plus, RefreshCw, Search, FolderOpen } from 'lucide-react';
import { useWorkCatalog } from '../features/workbench/useWorkCatalog';
import { WorkGallery, workKindLabel } from '../features/workbench/WorkGallery';
import { dispatchAppIntent } from '../features/app-shell/appIntent';

interface Preferences { query: string; kind: string; platform: string; sort: string; layout: 'grid' | 'list'; scroll: number; }
const defaults: Preferences = { query: '', kind: '', platform: '', sort: 'recent', layout: 'grid', scroll: 0 };
export function Works() {
    const { items, loading, error, partial, refresh } = useWorkCatalog();
    const [preferences, setPreferences] = useState(defaults);
    const [preferencesReady, setPreferencesReady] = useState(false);
    const scope = useRef(''); const container = useRef<HTMLDivElement>(null);
    useEffect(() => {
        let active = true; let request = 0;
        const load = () => {
            const token = ++request; scope.current = ''; setPreferences(defaults); setPreferencesReady(false);
            void window.ipcRenderer.spaces.list().then(result => {
                if (!active || token !== request) return;
                scope.current = `gardenflow:works:${result.activeSpaceId || 'default'}`;
                try {
                    const saved = JSON.parse(window.sessionStorage.getItem(scope.current) || '{}') as Partial<Preferences>;
                    setPreferences({ query: typeof saved.query === 'string' ? saved.query : '', kind: typeof saved.kind === 'string' ? saved.kind : '', platform: typeof saved.platform === 'string' ? saved.platform : '', sort: saved.sort === 'title' ? 'title' : 'recent', layout: saved.layout === 'list' ? 'list' : 'grid', scroll: typeof saved.scroll === 'number' && Number.isFinite(saved.scroll) ? Math.max(0, saved.scroll) : 0 });
                } catch { setPreferences(defaults); }
                setPreferencesReady(true);
            }).catch(reason => { if (active && token === request) { console.warn('Failed to restore work filters:', reason); setPreferencesReady(true); } });
        };
        load(); window.ipcRenderer.spaces.onChanged(load);
        return () => { active = false; request++; window.ipcRenderer.spaces.offChanged(load); };
    }, []);
    useEffect(() => { if (scope.current && preferencesReady) window.sessionStorage.setItem(scope.current, JSON.stringify(preferences)); }, [preferences, preferencesReady]);
    useEffect(() => { if (!loading && container.current) container.current.scrollTop = preferences.scroll; }, [loading, preferencesReady]);
    const update = (patch: Partial<Preferences>) => setPreferences(current => ({ ...current, ...patch }));
    const visible = useMemo(() => items.filter(item => (!preferences.query || `${item.title} ${workKindLabel(item.kind)}`.toLocaleLowerCase().includes(preferences.query.toLocaleLowerCase())) && (!preferences.kind || item.kind === preferences.kind) && (!preferences.platform || item.platform === preferences.platform)).sort((a, b) => preferences.sort === 'title' ? a.title.localeCompare(b.title) : b.updatedAt.localeCompare(a.updatedAt)), [items, preferences]);
    return <div className="workspace-page" ref={container} onScroll={event => update({ scroll: event.currentTarget.scrollTop })}>
        <header className="workspace-page-header"><div><p className="workspace-eyebrow">创作</p><h1>我的作品</h1><p>把想法做成作品，随时从上次停下的地方继续。</p></div><button className="workspace-primary-button" onClick={() => dispatchAppIntent({ type: 'creation.choose' })}><Plus size={16} />新建作品</button></header>
        <div className="workspace-filterbar"><label className="workspace-search"><Search size={16} /><input aria-label="搜索作品" placeholder="搜索作品" value={preferences.query} onChange={event => update({ query: event.target.value })} /></label><select aria-label="作品形式" value={preferences.kind} onChange={event => update({ kind: event.target.value })}><option value="">全部形式</option>{[...new Set(items.map(item => item.kind))].map(kind => <option key={kind} value={kind}>{workKindLabel(kind)}</option>)}</select><select aria-label="作品平台" value={preferences.platform} onChange={event => update({ platform: event.target.value })}><option value="">全部平台</option><option value="xiaohongshu">小红书</option><option value="douyin">抖音</option><option value="tiktok">TikTok</option></select><select aria-label="作品排序" value={preferences.sort} onChange={event => update({ sort: event.target.value })}><option value="recent">最近编辑</option><option value="title">作品名称</option></select><div className="ml-auto flex gap-1"><button className="workspace-icon-button" aria-label="画廊视图" aria-pressed={preferences.layout === 'grid'} onClick={() => update({ layout: 'grid' })}><LayoutGrid size={17} /></button><button className="workspace-icon-button" aria-label="列表视图" aria-pressed={preferences.layout === 'list'} onClick={() => update({ layout: 'list' })}><List size={17} /></button><button className="workspace-icon-button" aria-label="刷新作品" onClick={() => void refresh()}><RefreshCw size={16} /></button></div></div>
        {error && <div role="alert" className="workspace-error">{error}<button onClick={() => void refresh()}>重试</button></div>}
        {partial && <p role="status" className="workspace-notice">作品记录较多，当前目录未完整加载。原文件与工程保留。</p>}
        {loading ? <div className="workspace-skeleton-grid" aria-label="正在加载作品">{[1, 2, 3, 4, 5, 6].map(id => <div key={id} />)}</div> : visible.length ? <WorkGallery items={visible} layout={preferences.layout} /> : <div className="workspace-empty"><FolderOpen size={34} /><h2>{items.length ? '没有符合筛选的作品' : '从第一件作品开始'}</h2><p>{items.length ? '调整搜索或筛选，查找已有作品。' : '可以从资料、消费者机会或一个新想法开始。'}</p><button className="workspace-primary-button" onClick={() => items.length ? setPreferences(defaults) : dispatchAppIntent({ type: 'creation.choose' })}>{items.length ? '清除筛选' : '开始创作'}</button></div>}
    </div>;
}
