import { useEffect, useState } from 'react';
import { Moon, Plus } from 'lucide-react';
import type { VideoEditorV2Project } from '../../../shared/videoAutoEdit';
import { dispatchAppIntent } from '../../features/app-shell/appIntent';
export function DreamStoryEntry({ compact = false }: { compact?: boolean }) {
    const [projects, setProjects] = useState<VideoEditorV2Project[]>([]);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('recent');
    useEffect(() => { void window.ipcRenderer.dreamStory.list().then(result => {
        if (result.success) setProjects((result.projects || []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        else setError(result.error || '梦境作品读取失败');
    }); }, []);
    return <section className={compact ? 'flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-xs' : 'rounded-xl border border-border bg-surface-primary p-4'}>
        <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-secondary" onClick={() => dispatchAppIntent({ type: 'dream-story.new' })}><Moon className="h-4 w-4" />{compact ? '梦境故事' : '记下一个梦'}<Plus className="h-3 w-3" /></button>
        {compact ? <span className="text-text-tertiary">从零散片段开始创作</span> : <>
            <div className="my-3 flex items-center justify-between"><p className="text-sm font-medium">梦境作品</p><select aria-label="梦境作品筛选" value={filter} onChange={event => setFilter(event.target.value)} className="rounded border border-border bg-transparent p-1 text-xs"><option value="recent">最近作品</option><option value="all">全部梦境故事</option></select></div>
            <div className="flex flex-wrap gap-2">{(filter === 'recent' ? projects.slice(0, 5) : projects).map(project => <button key={project.id} type="button" className="rounded-lg border border-border px-3 py-2 text-left text-xs hover:bg-surface-secondary" onClick={() => dispatchAppIntent({ type: 'video-project.open', projectId: project.id })}>{project.title}<span className="ml-2 text-text-tertiary">{project.dreamStory?.stage === 'record' ? '已记录' : '继续创作'}</span></button>)}{!projects.length && <p className="text-xs text-text-tertiary">先保存记得的片段，稍后继续做成自己的故事短片。</p>}</div>
        </>}{error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </section>;
}
