import { lazy, Suspense, useEffect, useState } from 'react';
import type { VideoEditorV2Project } from '../../shared/videoAutoEdit';
const ProductVideoWorkbench = lazy(async () => ({ default: (await import('./ProductVideoWorkbench')).ProductVideoWorkbench }));
const DreamStoryWorkbench = lazy(async () => ({ default: (await import('./DreamStoryWorkbench')).DreamStoryWorkbench }));
export function VideoProjectWorkbench({ projectId, onClose }: { projectId: string; onClose?: () => void }) {
    const [kind, setKind] = useState(''); const [error, setError] = useState('');
    useEffect(() => { let active = true; setKind(''); setError(''); void window.ipcRenderer.videoEditorV2.getProject({ projectId }).then(raw => {
        const result = raw as { success: boolean; project?: VideoEditorV2Project; error?: string };
        if (!active) return; if (!result.success || !result.project) setError(result.error || '工程不存在'); else setKind(result.project.projectKind);
    }).catch(reason => { if (active) setError(String(reason)); }); return () => { active = false; }; }, [projectId]);
    return error ? <div className="p-6"><p role="alert">{error}</p><button type="button" onClick={onClose}>返回创作</button></div> : <Suspense fallback={<p className="p-6">加载作品…</p>}>{kind === 'dream-story' ? <DreamStoryWorkbench key={projectId} projectId={projectId} onClose={onClose} /> : kind ? <ProductVideoWorkbench projectId={projectId} onClose={onClose} /> : <p className="p-6">读取作品…</p>}</Suspense>;
}
