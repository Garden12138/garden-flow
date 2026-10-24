import { useEffect, useRef, useState } from 'react';
import type { ExperimentTask } from '../../../shared/contentExperimentPlans';

export function ExperimentTaskContextPanel({ workspaceId }: { workspaceId: string }) {
    const [open, setOpen] = useState(false); const [tasks, setTasks] = useState<ExperimentTask[]>([]); const [error, setError] = useState(''); const epoch = useRef(0);
    useEffect(() => {
        const clear = () => { epoch.current++; setOpen(false); setTasks([]); setError(''); };
        clear(); window.ipcRenderer.spaces.onChanged(clear);
        return () => { clear(); window.ipcRenderer.spaces.offChanged(clear); };
    }, [workspaceId]);
    return <section className="shrink-0 border-b border-border px-3 py-2 text-xs text-text-secondary">
        <button type="button" aria-expanded={open} onClick={async () => {
            const token = ++epoch.current; if (open) { setOpen(false); return; }
            setOpen(true); setTasks([]); setError('');
            try {
                const result = await window.ipcRenderer.contentIntelligence.experimentTasks({ workspaceId });
                if (token !== epoch.current) return; if (result.success === false) throw new Error(result.error); setTasks(result.data);
            } catch (reason) { if (token === epoch.current) setError(String(reason)); }
        }}>实验编辑任务{open ? ' ▴' : ' ▾'}</button>
        {open && <div className="max-h-64 space-y-3 overflow-y-auto pt-2">
            {error ? <p role="alert">{error}</p> : !tasks.length ? <p>此工程尚未关联实验编辑任务。</p> : tasks.map(task => <article key={task.id} className="space-y-1 rounded border border-border p-2">
                <p><strong>{task.change.name}</strong> · {task.workspaceId === workspaceId ? '下一轮副本' : '任务来源'} · {task.state === 'ready_to_edit' ? '副本已创建，待人工编辑' : task.state === 'needs_review' ? '复制结果待复核' : task.state === 'copying' ? '正在创建副本' : task.state === 'cancelled' ? '已取消任务，保留工程' : '待确认创建副本'}</p>
                <p className="whitespace-pre-wrap break-words">修改前：{task.change.before}</p><p className="whitespace-pre-wrap break-words">计划修改为：{task.change.after}</p>
                <p>依据假设：{task.basis.hypothesis}</p><p>修改理由：{task.change.rationale}</p>
                <p>保持：{task.change.preserve.join('；')}</p>
                <p>指标口径：{task.basis.metric.definition}（{task.basis.metric.unit}）</p>
                {task.basis.limitations.map((value, index) => <p key={index}>限制：{value}</p>)}
                {task.completionOrigin === 'manual-review' && <p>此工程经人工复核关联，未取得完整复制版本证明。</p>}
                <p>请在下方编辑器中执行这一项修改。创建副本不会自动改文案或生成媒体。</p>
            </article>)}
        </div>}
    </section>;
}
