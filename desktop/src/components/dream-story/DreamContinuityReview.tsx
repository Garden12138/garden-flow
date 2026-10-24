import { useEffect, useState } from 'react';
import type { VideoEditorV2Project } from '../../../shared/videoAutoEdit';
import { reviewDreamContinuity, type DreamSpatialChange } from '../../../shared/dreamStoryContinuity';

const spatialLabel = (anchor: DreamSpatialChange['previous']) => anchor ? `${anchor.object} × ${anchor.count}；位置：${anchor.location}；状态：${anchor.state}` : '本幕未登记此约束';
export function DreamContinuityReview({ project }: { project: VideoEditorV2Project }) {
    const [open, setOpen] = useState(false); const [available, setAvailable] = useState(true);
    const spaceId = project.dreamStory?.spaceId;
    useEffect(() => {
        setOpen(false); setAvailable(true);
        const clear = () => { setOpen(false); setAvailable(false); };
        window.ipcRenderer.spaces.onChanged(clear); return () => window.ipcRenderer.spaces.offChanged(clear);
    }, [project.id, spaceId]);
    const report = open && available ? reviewDreamContinuity(project) : null;
    return <section className="space-y-3 rounded-xl border border-border p-4 text-xs">
        <button type="button" className="font-semibold disabled:opacity-40" aria-expanded={open} disabled={!available} onClick={() => setOpen(value => !value)}>连续性复核（不生成）{open ? ' ▴' : ' ▾'}</button>
        {report && <div aria-label="梦境连续性复核" className="space-y-3">
            <p>基于当前已保存分镜、参考归属和媒体登记状态。不会修改工程、调用模型或授权生成；人物、动作、数量与空间关系仍需逐幕看图。文件完整性由原生成确认流程另行检查。</p>
            {project.dreamStory?.dirty && <p className="text-amber-700">存在待保存输入；以下只反映最近保存的分镜。</p>}
            {report.schemaVersion === 1 && <p>旧版分镜未登记连续关系。本面板保留原语义，继续使用原有制作与逐幕确认流程。</p>}
            <p role="status">{report.state === 'not-planned' ? '尚无已保存分镜。' : report.state === 'needs-review' ? `本轮 ${report.findings.length} 项登记信息需要核对。` : '本轮未发现登记结构问题；这不代表画面已通过连续性检查。'}</p>
            <div className="max-h-[32rem] space-y-2 overflow-y-auto">{report.shots.map(shot => <article key={shot.sceneId} className="space-y-2 rounded border border-border p-3" data-continuity-scene={shot.sceneId}>
                <h4 className="font-semibold">第 {shot.index + 1} 幕 · {shot.transition === 'continue' ? '延续前幕' : shot.transition === 'cut' ? '切场' : '旧版未登记'}</h4><p className="whitespace-pre-wrap break-words">{shot.visual}</p>
                <p>本次参考 {shot.references.length} 张 · {shot.referenceMode === 'previous' ? '仅上一幕图片，固定基准本次不发送' : '固定基准；延续镜头另沿用前幕'}{shot.settingId ? ` · 场景：${shot.settingId}` : ''}</p>
                {shot.predecessor && <p>{shot.predecessor.confirmation === 'registered-confirmed' ? '前幕已登记确认；调用前仍须检查文件与版本。' : '前幕尚未登记确认。'}</p>}
                {report.findings.filter(item => item.sceneId === shot.sceneId).map((finding, index) => <p key={index} className="text-amber-700">{finding.message}</p>)}
                {shot.spatialChanges.map(change => <div key={change.id} className="grid gap-2 rounded bg-surface-secondary p-2 md:grid-cols-2"><p className="whitespace-pre-wrap break-words">前幕：{spatialLabel(change.previous)}</p><p className="whitespace-pre-wrap break-words">本幕：{spatialLabel(change.current)}</p></div>)}
                {!shot.spatialChanges.length && shot.transition === 'continue' && <p className="text-text-tertiary">已登记空间约束无变化；未登记的对象无法据此判断。</p>}
            </article>)}</div>
        </div>}
    </section>;
}
