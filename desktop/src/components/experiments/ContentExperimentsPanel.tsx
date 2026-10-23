import { useEffect, useRef, useState } from 'react';
import type { CiResult } from '../../../shared/contentIntelligence';
import { MetricCsvFields, type MetricImportPreview, type MetricObservation, type PublicationLink, type MetricWorkSummary, type MetricComparison } from '../../../shared/contentExperiments';
import { dispatchAppIntent } from '../../features/app-shell/appIntent';

const buttonClass = 'rounded border border-border px-3 py-2 text-xs disabled:opacity-40';
const fieldClass = 'w-full rounded border border-border bg-surface-primary p-2 text-sm';
const labels: Record<typeof MetricCsvFields[number], string> = { publicationLinkId: '发布关联 ID', metric: '指标键', definition: '指标口径', unit: '单位 count/seconds/ratio', value: '数值', start: '窗口开始（ISO 含偏移）', end: '窗口结束（ISO 含偏移）', timeZone: '时间区（如 Asia/Shanghai）', alignment: '对齐 calendar/post-age', ageStartHours: '发布后开始小时（可空）', ageEndHours: '发布后结束小时（可空）', confounders: '干扰因素（用 | 分隔，可空）', sourceNote: '数据来源说明', observedAt: '实际观测时间（旧文件可留空映射，不能比较）' };
const initialMapping = () => Object.fromEntries(MetricCsvFields.map(key => [key, key])) as Record<typeof MetricCsvFields[number], string>;
function data<T>(result: CiResult<T>): T { if (result.success === false) throw new Error(result.error); return result.data; }
export function ContentExperimentsPanel() {
    const [works, setWorks] = useState<MetricWorkSummary[]>([]); const [links, setLinks] = useState<PublicationLink[]>([]); const [observations, setObservations] = useState<MetricObservation[]>([]);
    const [workId, setWorkId] = useState(''); const [alias, setAlias] = useState(''); const [externalId, setExternalId] = useState(''); const [url, setUrl] = useState(''); const [sourceNote, setSourceNote] = useState('');
    const [csv, setCsv] = useState(''); const [mapping, setMapping] = useState(initialMapping); const [preview, setPreview] = useState<MetricImportPreview | null>(null);
    const [confirmed, setConfirmed] = useState(false); const [revise, setRevise] = useState(false); const [history, setHistory] = useState<MetricObservation[]>([]);
    const [baseline, setBaseline] = useState(''); const [variant, setVariant] = useState(''); const [comparison, setComparison] = useState<MetricComparison | null>(null);
    const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
    const epoch = useRef(0); const locked = useRef(false); const importRequest = useRef<{ digest: string; id: string }>();
    const api = window.ipcRenderer.contentIntelligence;
    const load = async (token: number) => {
        const values = await Promise.all([api.metricWorks(), api.publications(), api.metrics()]);
        if (token !== epoch.current) return; setWorks(data(values[0])); setLinks(data(values[1])); setObservations(data(values[2]));
    };
    useEffect(() => {
        const clear = () => {
            const token = ++epoch.current; locked.current = false; importRequest.current = undefined;
            setWorks([]); setLinks([]); setObservations([]); setWorkId(''); setAlias(''); setExternalId(''); setUrl(''); setSourceNote(''); setCsv(''); setMapping(initialMapping()); setPreview(null); setConfirmed(false); setRevise(false); setHistory([]); setBaseline(''); setVariant(''); setComparison(null); setError(''); setMessage(''); setBusy(false);
            void load(token).catch(reason => { if (token === epoch.current) setError(String(reason)); });
        };
        clear(); window.ipcRenderer.spaces.onChanged(clear);
        return () => { epoch.current++; window.ipcRenderer.spaces.offChanged(clear); };
    }, []);
    const act = async (operation: (token: number) => Promise<void>) => {
        if (locked.current) return; const token = epoch.current; locked.current = true; setBusy(true); setError(''); setMessage('');
        try { await operation(token); } catch (reason) { if (token === epoch.current) setError(String(reason)); }
        finally { if (token === epoch.current) { locked.current = false; setBusy(false); } }
    };
    const invalidate = () => { setPreview(null); setConfirmed(false); setRevise(false); importRequest.current = undefined; };
    const work = works.find(value => value.id === workId);
    const observationLabel = (observation: MetricObservation) => {
        const link = links.find(value => value.id === observation.input.publicationLinkId);
        return `${link?.platform || '来源不可用'} · ${link?.accountAlias || ''} · ${link?.externalWorkId || ''} · ${observation.input.metric.key} = ${observation.input.value} · v${observation.revision}`;
    };
    return <section aria-label="内容观测与实验" className="space-y-5 p-6">
        <div className="flex items-start justify-between gap-3"><div><h1 className="text-xl font-semibold">内容观测与实验</h1><p className="mt-2 text-sm text-text-secondary">使用已有发布记录或明确标注的手工关联，再导入真实观测。没有数据时保持空态；观察差异不能证明因果。</p></div><button className={buttonClass} disabled={busy} onClick={() => void act(load)}>刷新</button></div>
        {error && <p role="alert" className="rounded border border-red-400 p-3 text-sm">{error}</p>}{message && <p role="status" className="rounded border border-border p-3 text-sm">{message}</p>}
        <section className="space-y-3 rounded border border-border p-4"><h2 className="font-semibold">工程与发布结果</h2>
            <select aria-label="观测工程" className={fieldClass} disabled={busy} value={workId} onChange={event => setWorkId(event.target.value)}><option value="">选择当前空间的已有工程</option>{works.map(item => <option key={item.id} value={item.id}>{item.title} · {item.platform} · {item.id}</option>)}</select>
            <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || !work} onClick={() => void act(async token => { await api.syncPublication(workId).then(data); await load(token); if (token === epoch.current) setMessage('已读取本工程的现有提交与可信回执。没有记录时可手工补充。'); })}>读取已有发布关联</button><button className={buttonClass} disabled={!work || busy} onClick={() => dispatchAppIntent({ type: 'creation.open', workspaceId: workId })}>打开工程</button></div>
            <details><summary className="cursor-pointer text-sm">手工补充已发布作品（来源标为人工声明）</summary><form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={event => {
                event.preventDefault(); if (!work) return;
                void act(async token => {
                    data(await api.attachPublication({ requestId: crypto.randomUUID(), workspaceId: work.id, expectedRevision: work.revision, platform: work.platform, accountAlias: alias, externalWorkId: externalId, ...(url.trim() ? { url: url.trim() } : {}), sourceNote, observedAt: Date.now() }));
                    await load(token); if (token === epoch.current) setMessage('已保存人工声明，尚未由程序核实发布状态。');
                });
            }}>
                <label className="text-xs">脱敏账号别名<input aria-label="观测账号别名" required maxLength={100} className={fieldClass} value={alias} disabled={busy} onChange={event => setAlias(event.target.value)} /></label>
                <label className="text-xs">平台作品 ID<input aria-label="平台作品ID" required maxLength={160} className={fieldClass} value={externalId} disabled={busy} onChange={event => setExternalId(event.target.value)} /></label>
                <label className="text-xs">作品网址（可空，须与平台和 ID 一致）<input aria-label="观测作品网址" type="url" className={fieldClass} value={url} disabled={busy} onChange={event => setUrl(event.target.value)} /></label>
                <label className="text-xs">人工核实来源与限制<input aria-label="发布关联来源说明" required maxLength={2000} className={fieldClass} value={sourceNote} disabled={busy} onChange={event => setSourceNote(event.target.value)} /></label>
                <button className={buttonClass} disabled={busy || !work}>保存人工发布关联</button>
            </form></details>
            {!links.length && <p className="text-sm text-text-secondary">还没有发布结果关联。导出成功不会自动计为已发布。</p>}
            <div className="max-h-72 space-y-2 overflow-y-auto">{links.map(link => <article key={link.id} className="rounded border border-border p-3 text-xs"><p>{link.platform} · {link.accountAlias} · 作品 {link.externalWorkId || '尚无可信作品 ID'}</p><p>{link.origin === 'manual' ? '人工声明，未由程序核实发布' : link.origin === 'receipt' ? '可信作品回执' : '已提交，审核结果未知'} · {link.sourceNote}</p><p className="break-all select-text">发布关联 ID：{link.id}</p><p>工程 {link.workspaceId} · 关联时版本 {link.workspaceRevision} {link.nativeRevision ? `· 发布快照版本 ${link.nativeRevision}` : ''}</p></article>)}</div>
        </section>
        <section className="space-y-3 rounded border border-border p-4"><h2 className="font-semibold">CSV 观测导入</h2><p className="text-xs">每行一条指标。count 为整数；seconds 为秒；ratio 为 0–1。窗口使用带偏移的 ISO 时间，账号与平台取自发布关联。累计值需在口径中注明；不能冒充窗口新增值。</p>
            <div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={busy} onClick={() => { setCsv(MetricCsvFields.join(',') + '\n'); invalidate(); }}>填入空白模板标题</button><label className={buttonClass}>选择本地 CSV<input aria-label="选择指标CSV" className="ml-2 max-w-56" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (!file) return; void act(async token => { if (file.size > 1000000) throw new Error('CSV 文件超过 1 MB'); const text = await file.text(); if (token === epoch.current) { setCsv(text); invalidate(); } }); }} /></label></div>
            <textarea aria-label="指标CSV内容" className={`${fieldClass} min-h-32 font-mono text-xs`} maxLength={1000000} value={csv} disabled={busy} onChange={event => { setCsv(event.target.value); invalidate(); }} />
            <details><summary className="cursor-pointer text-sm">字段映射（填写 CSV 中的列名）</summary><div className="mt-3 grid gap-2 md:grid-cols-3">{MetricCsvFields.map(field => <label key={field} className="text-xs">{labels[field]}<input aria-label={`映射 ${field}`} className={fieldClass} disabled={busy} value={mapping[field]} onChange={event => { setMapping({ ...mapping, [field]: event.target.value }); invalidate(); }} /></label>)}</div></details>
            <button className={buttonClass} disabled={busy || !csv.trim()} onClick={() => void act(async token => { const result = data(await api.previewMetrics({ csv, mapping })); if (token === epoch.current) { setPreview(result); setConfirmed(false); setRevise(false); } })}>预览观测导入</button>
            {preview && <div aria-label="观测导入预览" className="space-y-3"><p className="text-sm">共 {preview.rows.length} 行：新增 {preview.rows.filter(row => row.status === 'new').length}；重复 {preview.rows.filter(row => row.status === 'duplicate').length}；冲突 {preview.rows.filter(row => row.status === 'conflict').length}；错误 {preview.rows.filter(row => row.status === 'error').length}。</p>
                <div className="max-h-64 space-y-2 overflow-y-auto">{preview.rows.map(row => {
                    const linked = links.find(link => link.id === row.input?.publicationLinkId);
                    return <article key={row.row} className="break-words rounded border border-border p-2 text-xs"><p>第 {row.row} 行 · {({ new: '新增', duplicate: '重复，不追加', conflict: '冲突，需确认修订', error: '错误' })[row.status]} {row.error || ''}</p>{row.input && <>
                        <p>{linked?.platform} · {linked?.accountAlias} · 作品 {linked?.externalWorkId} · {row.input.metric.key} = {row.input.value} {row.input.metric.unit}</p><p>口径：{row.input.metric.definition}</p>
                        <p>窗口：{new Date(row.input.window.startAt).toISOString()} → {new Date(row.input.window.endAt).toISOString()} · {row.input.window.timeZone} · {row.input.window.alignment}{row.input.window.alignment === 'post-age' ? ` · 发布后 ${row.input.window.ageStartMs! / 3600000}–${row.input.window.ageEndMs! / 3600000} 小时` : ''}</p>
                        <p>实际观测时间：{row.input.observedAt === undefined ? '未提供（不能比较）' : new Date(row.input.observedAt).toISOString()}</p><p>干扰因素：{row.input.confounders.join('；') || '未提供'} · 来源：{row.input.sourceNote}</p>
                    </>}</article>;
                })}</div>
                {preview.rows.some(row => row.status === 'conflict') && <label className="flex gap-2 text-xs"><input aria-label="确认修订观测冲突" type="checkbox" checked={revise} disabled={busy} onChange={event => setRevise(event.target.checked)} />确认修订冲突值，保留全部旧版本供审计。</label>}
                <label className="flex gap-2 text-xs"><input aria-label="确认导入观测" type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />已核对上述数据来源、口径和窗口，确认写入当前空间。</label>
                <button className={buttonClass} disabled={busy || !confirmed || !preview.rows.length || preview.rows.some(row => row.status === 'error') || (preview.rows.some(row => row.status === 'conflict') && !revise)} onClick={() => void act(async token => {
                    if (importRequest.current?.digest !== preview.digest) importRequest.current = { digest: preview.digest, id: crypto.randomUUID() };
                    const result = data(await api.importMetrics({ csv, mapping, requestId: importRequest.current.id, previewDigest: preview.digest, confirmed: true, reviseConflicts: revise }));
                    await load(token); if (token === epoch.current) { invalidate(); setComparison(null); setHistory([]); setMessage(`已写入 ${result.changed.length} 条观测版本，跳过 ${result.duplicates} 条重复。`); }
                })}>确认导入观测</button>
            </div>}
        </section>
        <section className="space-y-3 rounded border border-border p-4"><h2 className="font-semibold">观测比较与审计</h2>
            {!observations.length && <p className="text-sm">还没有观测，暂无表现结论。</p>}
            <div className="grid gap-3 md:grid-cols-2">{(['baseline', 'variant'] as const).map(role => <label key={role} className="text-xs">{role === 'baseline' ? '对照观测' : '变体观测'}<select aria-label={role === 'baseline' ? '对照观测' : '变体观测'} disabled={busy} className={fieldClass} value={role === 'baseline' ? baseline : variant} onChange={event => { (role === 'baseline' ? setBaseline : setVariant)(event.target.value); setComparison(null); setHistory([]); }}><option value="">选择已有观测</option>{observations.map(value => <option key={value.id} value={value.id}>{observationLabel(value)}</option>)}</select></label>)}</div>
            <div className="flex gap-2"><button className={buttonClass} disabled={busy || !baseline || !variant} onClick={() => void act(async token => { const result = data(await api.compareMetrics(baseline, variant, observations.find(value => value.id === baseline)!.revision, observations.find(value => value.id === variant)!.revision)); if (token === epoch.current) setComparison(result); })}>计算观察差异</button><button className={buttonClass} disabled={busy || !baseline} onClick={() => void act(async token => { const result = data(await api.metricHistory(baseline)); if (token === epoch.current) setHistory(result); })}>查看对照审计版本</button></div>
            {comparison && <div aria-label="观测比较结果" className="rounded border border-border p-3 text-sm"><p>{comparison.comparable ? `对照 ${comparison.baseline} / 变体 ${comparison.variant}；观察差值：${comparison.difference}；相对变化：${comparison.relativeChange === null ? 'N/A（分母为零或数值超界）' : (comparison.relativeChange * 100).toFixed(2) + '%'}` : '不足以判断：' + comparison.reasons.join('；')}</p><p>上述为观察比较，不代表单一变量导致变化。</p><p>已记录干扰因素：{comparison.confounders.join('；') || '未提供，不代表不存在。请核对付费流量、推广和发布时间。'}</p></div>}
            {history.length > 0 && <div aria-label="观测审计历史" className="max-h-56 space-y-2 overflow-y-auto">{history.map(value => <article key={value.revision} className="break-words rounded border border-border p-2 text-xs"><p>v{value.revision} · {value.input.value} {value.input.metric.unit} · {value.input.metric.definition}</p><p>{new Date(value.input.window.startAt).toISOString()} → {new Date(value.input.window.endAt).toISOString()} · {value.input.window.timeZone} · {value.input.window.alignment}</p><p>观测于 {value.input.observedAt === undefined ? '未知' : new Date(value.input.observedAt).toISOString()} · 导入于 {new Date(value.recordedAt).toISOString()}</p><p>{value.input.sourceNote} · 干扰因素 {value.input.confounders.join('；') || '未提供'} · 文件摘要 {value.importDigest.slice(0, 16)}</p></article>)}</div>}
        </section>
    </section>;
}
