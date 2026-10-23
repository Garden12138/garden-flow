import { useEffect, useRef, useState } from 'react';
import type { SourceSnapshot, CiResult } from '../../../shared/contentIntelligence';
import type { ResearchRun } from '../../../shared/consumerResearch';
import { dispatchAppIntent } from '../../features/app-shell/appIntent';

const buttonClass = 'rounded border border-border px-3 py-1.5 text-xs hover:bg-surface-secondary disabled:opacity-40';
const statusLabels = { queued: '待确认', running: '分析中', interrupted: '已中断，不会自动重试', partial: '部分完成，请复核', succeeded: '分析完成', failed: '分析失败', cancelled: '已取消' };
const sourceKey = (source: SourceSnapshot['source']) => JSON.stringify([source.kind, source.namespace, source.id]);
function data<T>(result: CiResult<T>): T { if (result.success === false) throw new Error(result.error); return result.data; }
export function ConsumerResearchPanel({ onResults }: { onResults: () => void }) {
    const [sources, setSources] = useState<SourceSnapshot[]>([]); const [selected, setSelected] = useState<string[]>([]);
    const [runs, setRuns] = useState<ResearchRun[]>([]); const [preview, setPreview] = useState<ResearchRun | null>(null);
    const [maxComments, setMaxComments] = useState(100); const [completeOnly, setCompleteOnly] = useState(false); const [goal, setGoal] = useState('');
    const [consent, setConsent] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
    const epoch = useRef(0); const locked = useRef(false); const onResultsRef = useRef(onResults); onResultsRef.current = onResults;
    const request = useRef<{ scope: string; id: string }>();
    const load = async (token: number) => {
        const [allSources, allRuns] = await Promise.all([window.ipcRenderer.contentIntelligence.sources(), window.ipcRenderer.contentIntelligence.researchRuns()]);
        if (token !== epoch.current) return; setSources(data(allSources)); setRuns(data(allRuns));
    };
    useEffect(() => {
        const clear = () => { epoch.current++; locked.current = false; request.current = undefined; setSources([]); setSelected([]); setRuns([]); setPreview(null); setConsent(false); setGoal(''); setError(''); setBusy(false); };
        clear(); const token = epoch.current; void load(token).catch(reason => { if (token === epoch.current) setError(String(reason)); });
        window.ipcRenderer.spaces.onChanged(clear);
        return () => { epoch.current++; window.ipcRenderer.spaces.offChanged(clear); };
    }, []);
    const active = runs.filter(run => run.status === 'running').map(run => run.id).join('|');
    useEffect(() => {
        if (!active) return; const token = epoch.current; let attempts = 0; let pending = false; let alive = true;
        const timer = window.setInterval(async () => {
            if (pending || !alive) return;
            if (++attempts > 80) { window.clearInterval(timer); if (token === epoch.current) setError('自动刷新已结束，可点击刷新查看任务状态；不会重发模型请求。'); return; }
            pending = true;
            try {
                const result = data(await window.ipcRenderer.contentIntelligence.researchRuns()); if (token !== epoch.current || !alive) return;
                setRuns(result); setPreview(old => old ? result.find(run => run.id === old.id) || old : null);
                if (result.some(run => active.split('|').includes(run.id) && !['running', 'queued'].includes(run.status))) onResultsRef.current();
            } catch (reason) { if (token === epoch.current && alive) setError(String(reason)); } finally { pending = false; }
        }, 1500);
        return () => { alive = false; window.clearInterval(timer); };
    }, [active]);
    async function act(operation: (token: number) => Promise<void>) {
        if (locked.current) return; locked.current = true; const token = epoch.current; setBusy(true); setError('');
        try { await operation(token); } catch (reason) { if (token === epoch.current) setError(String(reason)); }
        finally { if (token === epoch.current) { locked.current = false; setBusy(false); } }
    }
    const updateRun = (run: ResearchRun) => { setRuns(old => [run, ...old.filter(value => value.id !== run.id)]); setPreview(run); };
    const invalidate = () => { setPreview(null); setConsent(false); request.current = undefined; };
    return <section aria-label="消费者研究" className="mb-4 space-y-3 rounded border border-border p-4 text-sm">
        <div className="flex flex-wrap items-center gap-3"><h3 className="flex-1 font-semibold">从已入库资料研究内容机会</h3><button type="button" className={buttonClass} disabled={busy} onClick={() => void act(token => load(token))}>刷新资料与运行记录</button></div>
        <p className="text-xs text-text-secondary">只向你配置的灵感文本模型发送明确选中的原文。采样不代表全平台，模型只提议，引用由程序定位。</p>
        {!sources.length && <p className="text-xs">当前空间还没有可用来源。先采集或导入资料；手动机会仍可使用。</p>}
        <div className="max-h-44 space-y-2 overflow-y-auto rounded border border-border p-2">{sources.map(source => {
            const key = sourceKey(source.source); return <label key={key} className="flex items-start gap-2 text-xs"><input data-research-source type="checkbox" checked={selected.includes(key)} disabled={busy || !selected.includes(key) && selected.length >= 20} onChange={event => { invalidate(); setSelected(old => event.target.checked ? [...old, key] : old.filter(value => value !== key)); }} />
                <span className="min-w-0 break-words">{source.title} · {source.source.namespace} · 已保存评论 {source.coverage.captured} 条 · {source.coverage.partial ? '部分资料' : '本次采集完整'}{source.capturedAt ? ` · ${new Date(source.capturedAt).toLocaleString()}` : ' · 采集时间缺失'}</span>
            </label>;
        })}</div>
        <div className="flex flex-wrap items-center gap-4 text-xs"><label>评论上限 <input aria-label="研究评论上限" type="number" min={0} max={200} value={maxComments} disabled={busy} className="w-20 rounded border border-border bg-surface-primary p-1" onChange={event => { invalidate(); setMaxComments(Number(event.target.value)); }} /></label>
            <label className="flex gap-2"><input type="checkbox" checked={completeOnly} disabled={busy} onChange={event => { invalidate(); setCompleteOnly(event.target.checked); }} />仅接受完整入库来源</label><span>最多选 20 个来源</span></div>
        <label className="block text-xs">研究目标（可选）<input aria-label="研究目标" maxLength={1000} value={goal} disabled={busy} onChange={event => { invalidate(); setGoal(event.target.value); }} className="mt-1 w-full rounded border border-border bg-surface-primary p-2" /></label>
        <button type="button" className={buttonClass} disabled={busy || !selected.length} onClick={() => void act(async token => {
            const scope = { sources: sources.filter(source => selected.includes(sourceKey(source.source))).map(source => ({ source: source.source, version: source.version })), maxComments, completeOnly, goal };
            const serialized = JSON.stringify(scope); if (request.current?.scope !== serialized) request.current = { scope: serialized, id: crypto.randomUUID() };
            const run = data(await window.ipcRenderer.contentIntelligence.previewResearch({ requestId: request.current.id, scope })); if (token !== epoch.current) return; updateRun(run); setConsent(false);
        })}>预览本轮范围与模型</button>
        {error && <p role="alert" className="rounded border border-red-400 p-2 text-xs">{error}</p>}
        {preview && <div aria-label="研究范围预览" className="space-y-2 rounded border border-border bg-surface-secondary p-3 text-xs">
            <strong>{statusLabels[preview.status]}</strong><p>{preview.sourceCount} 个来源 · 已保存评论 {preview.coverage.captured} 条 · 本轮分析评论 {preview.commentCount} 条 · 发送 {preview.referenceCount} 个片段，共 {preview.inputCharacters} 字符</p>
            <p>{preview.coverage.partial ? '存在部分采集或采样限制' : '仅代表本次已入库范围'}；以上字符数不是供应商计费 Token 数。</p>
            {preview.coverage.issues.map((issue, index) => <p key={index}>{issue}</p>)}
            {preview.model ? <p>模型：{preview.model.name} · 供应商主机：{preview.model.host}</p> : <p>尚未配置灵感文本模型。<button type="button" className="underline" onClick={() => dispatchAppIntent({ type: 'settings.open', tab: 'ai' })}>打开设置</button></p>}
            {preview.status === 'queued' && <><label className="flex items-start gap-2"><input aria-label="确认研究模型费用" type="checkbox" checked={consent} disabled={busy || !preview.model} onChange={event => setConsent(event.target.checked)} /><span>确认将上述所选原文发送给此供应商；文本请求可能收费。本轮最多调用一次，失败或取消后不会自动重试。</span></label>
                <button type="button" className={buttonClass} disabled={busy || !consent || !preview.model || !preview.inputCharacters} onClick={() => void act(async token => {
                    const run = data(await window.ipcRenderer.contentIntelligence.startResearch({ id: preview.id, expectedRevision: preview.revision, consent: true, modelFingerprint: preview.model!.fingerprint }));
                    if (token !== epoch.current) return; updateRun(run); setConsent(false);
                })}>确认并运行分析</button></>}
            {preview.errorCode && <p>失败类别：{preview.errorCode}。请检查资料或模型，再重新选择范围并确认；不会自动追加调用。</p>}
            {['partial', 'succeeded'].includes(preview.status) && <p>形成 {preview.opportunityIds.length} 个候选机会。模型总结与排序仍需核对原文，0 个可信机会也是有效结果。</p>}
        </div>}
        {!!runs.length && <details><summary className="cursor-pointer text-xs">最近 50 次研究记录（含待确认预览）</summary><div className="mt-2 space-y-2">{runs.map(run => <div key={run.id} className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-xs"><span className="flex-1">{new Date(run.createdAt).toLocaleString()} · {statusLabels[run.status]} · {run.opportunityIds.length} 个机会 · 已请求 {run.calls} 次</span>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => { setPreview(run); setConsent(false); }}>查看范围</button>
            {['queued', 'running'].includes(run.status) && <button type="button" className={buttonClass} disabled={busy} onClick={() => void act(async token => { const result = data(await window.ipcRenderer.contentIntelligence.cancelResearch({ id: run.id, expectedRevision: run.revision })); if (token === epoch.current) updateRun(result); })}>取消本轮</button>}
            {['failed', 'cancelled', 'interrupted'].includes(run.status) && <button type="button" className={buttonClass} disabled={busy} onClick={() => { setSelected(run.scope.sources.map(ref => sourceKey(ref.source))); setGoal(run.scope.goal); setMaxComments(run.scope.maxComments); setCompleteOnly(run.scope.completeOnly); invalidate(); }}>重新选择并预览</button>}
        </div>)}</div></details>}
    </section>;
}
