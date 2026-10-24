import { useEffect, useRef, useState } from 'react';
import type { ContentExperimentDetail } from '../../../shared/contentExperimentPlans';
import type { ExplanationRun, ExperimentExplanationProposal } from '../../../shared/experimentExplanation';
import type { CiResult } from '../../../shared/contentIntelligence';
import { dispatchAppIntent } from '../../features/app-shell/appIntent';

const buttonClass = 'rounded border border-border px-3 py-2 text-xs disabled:opacity-40';
const labels = { queued: '待确认', running: '解释中', succeeded: '已形成待复核提议', failed: '失败，不会自动重试', cancelled: '已取消', interrupted: '已中断，不会自动重试' };
function data<T>(result: CiResult<T>): T { if (result.success === false) throw new Error(result.error); return result.data; }
export function ExperimentExplanationPanel({ detail, onSuggestion }: { detail: ContentExperimentDetail; onSuggestion: (change: ExperimentExplanationProposal['suggestions'][number]) => void }) {
    const api = window.ipcRenderer.contentIntelligence; const experiment = detail.experiment;
    const [runs, setRuns] = useState<ExplanationRun[]>([]); const [selected, setSelected] = useState(''); const [consent, setConsent] = useState(false);
    const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
    const epoch = useRef(0); const locked = useRef(false); const requestId = useRef<string>();
    const run = runs.find(value => value.id === selected);
    const update = (value: ExplanationRun) => { setRuns(old => [value, ...old.filter(item => item.id !== value.id)]); setSelected(value.id); setConsent(false); };
    async function load(token: number) { const values = data(await api.experimentExplanations(experiment.id)); if (token === epoch.current) setRuns(values); }
    useEffect(() => {
        const clear = () => { epoch.current++; locked.current = false; requestId.current = undefined; setRuns([]); setSelected(''); setConsent(false); setError(''); setBusy(false); };
        clear(); const token = epoch.current; void load(token).catch(reason => { if (token === epoch.current) setError(String(reason)); });
        window.ipcRenderer.spaces.onChanged(clear); return () => { epoch.current++; window.ipcRenderer.spaces.offChanged(clear); };
    }, [experiment.id, experiment.revision]);
    const active = runs.filter(value => value.status === 'running').map(value => value.id).join('|');
    useEffect(() => {
        if (!active) return; const token = epoch.current; let alive = true; let pending = false; let attempts = 0;
        const timer = window.setInterval(async () => {
            if (!alive || pending) return;
            if (++attempts > 80) { window.clearInterval(timer); if (token === epoch.current) setError('自动刷新已结束，请手动刷新记录；不会重发模型请求。'); return; }
            pending = true; try { await load(token); } catch (reason) { if (alive && token === epoch.current) setError(String(reason)); } finally { pending = false; }
        }, 1500);
        return () => { alive = false; window.clearInterval(timer); };
    }, [active]);
    async function act(operation: (token: number) => Promise<void>) {
        if (locked.current) return; const token = epoch.current; locked.current = true; setBusy(true); setError('');
        try { await operation(token); } catch (reason) { if (token === epoch.current) setError(String(reason)); }
        finally { if (token === epoch.current) { locked.current = false; setBusy(false); } }
    }
    const current = run?.input.experimentRevision === experiment.revision && run?.input.observationRevisionsChanged === detail.observationRevisionsChanged;
    return <details aria-label="可选模型解释" className="space-y-3 rounded border border-border p-3 text-xs">
        <summary className="cursor-pointer text-sm">解释观测与提议下一轮（可选文本模型）</summary>
        <p>只发送此实验、两组冻结观测和程序报告。模型观点与建议未经事实验证；程序报告始终优先。先预览范围和供应商，再确认可能收费的一次请求。</p>
        <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy || !detail.comparison || experiment.status === 'archived'} onClick={() => void act(async token => {
            requestId.current ||= crypto.randomUUID(); const value = data(await api.previewExperimentExplanation({ requestId: requestId.current, experimentId: experiment.id, expectedRevision: experiment.revision }));
            if (token === epoch.current) update(value);
        })}>预览实验解释范围</button><button type="button" className={buttonClass} disabled={busy} onClick={() => void act(load)}>刷新解释记录</button></div>
        {!detail.comparison && <p>尚未绑定两组观测，不请求模型，也没有业绩解释。</p>}
        {error && <p role="alert">{error}</p>}
        {!!runs.length && <label className="block">解释记录<select aria-label="选择实验解释" className="w-full rounded border border-border bg-surface-primary p-2" value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setConsent(false); }}><option value="">选择记录</option>{runs.map(value => <option key={value.id} value={value.id}>{new Date(value.createdAt).toLocaleString()} · {labels[value.status]} · 已请求 {value.calls} 次</option>)}</select></label>}
        {run && <div aria-label="实验解释预览" className="space-y-2">
            <p>{labels[run.status]} · 实验 v{run.input.experimentRevision} · 资料 {run.inputCharacters} 字符（另加系统提示、结构契约与请求封装，非计费Token数）· 输出最多4000 tokens</p>
            {run.model ? <p>模型：{run.model.name} · 供应商主机：{run.model.host}</p> : <p>未配置灵感文本模型。<button type="button" className="underline" onClick={() => dispatchAppIntent({ type: 'settings.open', tab: 'ai' })}>打开模型设置</button></p>}
            <details><summary className="cursor-pointer">查看冻结的发送数据</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(run.input, null, 2)}</pre></details>
            {!current && <p>实验或观测状态已有变化；此记录只代表历史输入，请重新预览。</p>}
            {run.status === 'queued' && <><label className="flex gap-2"><input aria-label="确认实验解释费用" type="checkbox" disabled={busy || !run.model || !current} checked={consent} onChange={event => setConsent(event.target.checked)} />确认将预览数据发送给上述供应商，可能产生文本模型费用。最多请求一次，失败、取消和重启后不自动重试。</label>
                <button type="button" className={buttonClass} disabled={busy || !consent || !run.model || !current} onClick={() => void act(async token => {
                    const value = data(await api.startExperimentExplanation({ id: run.id, expectedRevision: run.revision, consent: true, modelFingerprint: run.model!.fingerprint }));
                    if (token === epoch.current) update(value);
                })}>确认一次文本解释</button></>}
            {['queued', 'running'].includes(run.status) && <button type="button" className={buttonClass} disabled={busy} onClick={() => void act(async token => {
                const value = data(await api.cancelExperimentExplanation({ id: run.id, expectedRevision: run.revision })); if (token === epoch.current) update(value);
            })}>取消实验解释</button>}
            {['failed', 'cancelled', 'interrupted'].includes(run.status) && <button type="button" className={buttonClass} disabled={busy} onClick={() => { requestId.current = undefined; setSelected(''); setConsent(false); }}>重新选择范围并预览</button>}
            {run.errorCode && <p>失败类别：{run.errorCode}；无模型原始错误内容，不会自动重试。</p>}
            {run.proposal && <div aria-label="待复核模型提议" className="space-y-2"><strong>模型观点与新假设（未验证）</strong><p>引用、数值和报告已与冻结输入逐值核对。这不验证以下观点、当前稿件描述或效果推断。</p>
                {run.proposal.considerations.map((value, index) => <p key={index}>{value}</p>)}
                {!run.proposal.suggestions.length && <p>本轮没有修改提议。</p>}
                {run.proposal.suggestions.map((change, index) => <div key={index} className="space-y-1 rounded border border-border p-2"><p>{change.name}：{change.before} → {change.after}</p><p>{change.rationale}</p><p>保持：{change.preserve.join('；')}</p><button type="button" className={buttonClass} disabled={busy || !current || experiment.status === 'archived'} onClick={() => onSuggestion(change)}>填入下一轮草稿，核对后再建任务</button></div>)}
            </div>}
        </div>}
    </details>;
}
