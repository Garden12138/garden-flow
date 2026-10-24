import { useEffect, useRef, useState } from 'react';
import type { CiResult, EvidenceSourceView, SourceSnapshot } from '../../../shared/contentIntelligence';
import type { MaintenanceSourceOption, MaintenanceReportSummary, MaintenanceDetail, MaintenanceDecision } from '../../../shared/sourceMaintenance';
import { EvidenceSource } from '../../features/creation/ContentEvidencePanel';
import { dispatchAppIntent } from '../../features/app-shell/appIntent';

const buttonClass = 'rounded border border-border px-3 py-1.5 text-xs hover:bg-surface-secondary disabled:opacity-40';
const inputClass = 'w-full rounded border border-border bg-surface-primary p-2 text-sm';
const actions = { 'keep-historical': '保留历史依据', 'collect-evidence': '计划补充证据', 'edit-manually': '计划手动修改' };
const kinds = { evidence: '证据', opportunity: '机会', workspace: '工程' };
const quoteLabels = { 'matches-current-location': '当前定位文字相同，来源版本仍已变化', 'differs-current-location': '当前定位文字不同或已不在本次采集片段中', 'source-unavailable': '当前来源不可用' };
const fieldLabels: Record<string, string> = { selectedSku: '选中规格', price: '价格与条件', title: '名称', capturedAt: '采集时间', sourceUrl: '来源地址', coverage: '采集范围' };
function data<T>(value: CiResult<T>): T { if (value.success === false) throw new Error(value.error); return value.data; }
function Snapshot({ value, label }: { value: SourceSnapshot | null; label: string }) {
    return <details className="min-w-0 rounded border border-border p-3 text-xs"><summary className="cursor-pointer">{label} · {value ? value.version.slice(0, 12) : '不可用'}</summary>
        {value && <div className="mt-2 max-h-64 space-y-2 overflow-auto"><p className="break-words">{value.title} · {value.source.namespace}</p><p>{value.capturedAt === undefined ? '采集时间未知' : new Date(value.capturedAt).toLocaleString()}</p>
            <p>已采集评论 {value.coverage.captured} 条 · {value.coverage.partial ? '部分样本' : '本次已采集样本'}</p>{value.coverage.issues.map((issue, index) => <p key={index}>{issue}</p>)}
            {value.segments.map(segment => <div key={segment.key}><strong className="break-all">{segment.key}</strong><p className="whitespace-pre-wrap break-words">{segment.text}</p></div>)}</div>}
    </details>;
}
export function SourceMaintenancePanel() {
    const [sources, setSources] = useState<MaintenanceSourceOption[]>([]); const [next, setNext] = useState<number>(); const [sourceId, setSourceId] = useState('');
    const [reports, setReports] = useState<MaintenanceReportSummary[]>([]); const [detail, setDetail] = useState<MaintenanceDetail | null>(null);
    const [filter, setFilter] = useState<keyof typeof kinds>('workspace'); const [impactId, setImpactId] = useState('');
    const [action, setAction] = useState<keyof typeof actions>('collect-evidence'); const [note, setNote] = useState(''); const [confirmed, setConfirmed] = useState(false);
    const [history, setHistory] = useState<MaintenanceDecision[] | null>(null); const [view, setView] = useState<EvidenceSourceView | null>(null);
    const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
    const epoch = useRef(0); const pending = useRef(false); const requests = useRef(new Map<string, { intent: string; id: string }>());
    function requestId(slot: string, input: unknown) { const intent = JSON.stringify(input); const previous = requests.current.get(slot); if (previous?.intent === intent) return previous.id; const id = crypto.randomUUID(); requests.current.set(slot, { intent, id }); return id; }
    function clearSelection() { setImpactId(''); setNote(''); setConfirmed(false); setHistory(null); setView(null); }
    function show(value: MaintenanceDetail) { setDetail(value); setFilter(value.report.impacts.some(item => item.kind === 'workspace') ? 'workspace' : 'evidence'); clearSelection(); }
    async function load(token: number) {
        const [page, list] = await Promise.all([window.ipcRenderer.contentIntelligence.maintenanceSources(), window.ipcRenderer.contentIntelligence.maintenanceReports()]);
        if (token !== epoch.current) return; const values = data(page); setSources(values.items); setNext(values.nextRowId); setReports(data(list));
    }
    useEffect(() => {
        let mounted = true;
        const clear = () => { const token = ++epoch.current; pending.current = false; requests.current.clear(); setSources([]); setNext(undefined); setSourceId(''); setReports([]); setDetail(null); clearSelection(); setError(''); setMessage(''); setBusy(false);
            void load(token).catch(reason => { if (mounted && token === epoch.current) setError(String(reason)); }); };
        clear(); window.ipcRenderer.spaces.onChanged(clear);
        return () => { mounted = false; epoch.current++; window.ipcRenderer.spaces.offChanged(clear); };
    }, []);
    async function act(operation: (token: number) => Promise<void>) {
        if (pending.current) return; const token = epoch.current; pending.current = true; setBusy(true); setError(''); setMessage('');
        try { await operation(token); } catch (reason) { if (token === epoch.current) setError(String(reason)); }
        finally { if (token === epoch.current) { pending.current = false; setBusy(false); } }
    }
    const selectedSource = sources.find(source => String(source.rowId) === sourceId);
    const impact = detail?.report.impacts.find(item => item.id === impactId); const decision = detail?.decisions.find(item => item.impactId === impactId);
    return <section aria-label="来源复核" className="mb-4 space-y-3 rounded border border-border p-4 text-sm">
        <div><h3 className="font-semibold">来源变化与内容维护</h3><p className="mt-1 text-xs text-text-secondary">选择曾引用的来源版本，与当前空间已入库资料核对。检查只创建待复核清单；处理记录表示人工决定，实际修改请打开原工程完成。</p></div>
        <div className="flex flex-wrap gap-2"><select aria-label="选择旧来源版本" disabled={busy} value={sourceId} onChange={event => setSourceId(event.target.value)} className={inputClass + ' min-w-0 flex-1'}><option value="">选择已保存的来源版本</option>{sources.map(source => <option key={source.rowId} value={source.rowId}>{source.title} · {source.source.namespace} · {source.version.slice(0, 12)} · {source.evidenceCount} 条引用</option>)}</select>
            <button type="button" disabled={busy || !selectedSource} className={buttonClass} onClick={() => void act(async token => {
                if (!selectedSource) return; const input = { source: selectedSource.source, previousVersion: selectedSource.version };
                const value = data(await window.ipcRenderer.contentIntelligence.checkMaintenance({ ...input, requestId: requestId('check', input) }));
                if (token !== epoch.current) return; requests.current.delete('check');
                if (value.detail) show(value.detail); else { setDetail(null); clearSelection(); setMessage('与当前已入库版本相同，未创建复核清单。'); }
                await load(token);
            })}>检查当前入库版本</button>
            {next && <button type="button" disabled={busy} className={buttonClass} onClick={() => void act(async token => { const value = data(await window.ipcRenderer.contentIntelligence.maintenanceSources({ afterRowId: next })); if (token !== epoch.current) return; setSources(old => [...old, ...value.items.filter(item => !old.some(existing => existing.rowId === item.rowId))]); setNext(value.nextRowId); })}>更多旧版本</button>}
        </div>
        <label className="block text-xs">最近 50 轮复核<select aria-label="选择复核记录" className={inputClass} disabled={busy} value={detail?.report.id || ''} onChange={event => { const id = event.target.value; if (!id) { setDetail(null); clearSelection(); return; } void act(async token => { const value = data(await window.ipcRenderer.contentIntelligence.maintenanceDetail(id)); if (token === epoch.current) show(value); }); }}><option value="">选择历史清单</option>{reports.map(report => <option key={report.id} value={report.id}>{report.sourceTitle} · {new Date(report.createdAt).toLocaleString()} · {report.impacts} 项</option>)}</select></label>
        {error && <p role="alert" className="text-red-600">{error}</p>}{message && <p role="status">{message}</p>}
        {detail && <div className="space-y-3" aria-label="来源复核清单">
            <p className="text-xs">冻结检查：{new Date(detail.report.createdAt).toLocaleString()} · 待记录决定 {detail.pending} / {detail.report.impacts.length} 项。历史清单保持原样，需核对后续变化时请再次检查。</p>
            <div className="grid gap-2 md:grid-cols-2"><Snapshot value={detail.previous} label="历史来源" /><Snapshot value={detail.current} label="本轮当前来源" /></div>
            {!detail.current && <p className="text-xs">当前本地来源不可用，无法判断字段是否从平台删除。</p>}
            <div className="rounded bg-surface-secondary p-3 text-xs"><p>扫描注册工程 {detail.report.coverage.scannedWorkspaces} / {detail.report.coverage.totalWorkspaceRecords} 条，排除不可安全读取记录 {detail.report.coverage.excludedWorkspaces} 条 · {detail.report.coverage.completeWithinScope ? '已覆盖本轮注册工程与直接关联' : '扫描不完整，请先核对排除记录'}。</p>
                <p>同商品但无旧版本引用链 {detail.report.coverage.unversionedSameProductWorkspaces} 条，未计入已确认影响。未注册的旧工程未扫描。</p></div>
            <details open className="text-xs"><summary className="cursor-pointer font-medium">变化字段（{detail.report.fields.length}）</summary><p className="my-2 text-text-secondary">以下为原始入库字段。字段未出现在新采集快照，不代表平台已删除；价格、SKU、币种和条件须一并核对。</p>
                <div className="max-h-80 space-y-2 overflow-y-auto">{detail.report.fields.map(field => <div key={field.kind + field.key} className="rounded border border-border p-2"><strong className="break-all">{field.kind === 'metadata' ? '采集元信息' : '资料'} · {fieldLabels[field.key] || (field.previousKind === 'comment' || field.currentKind === 'comment' ? '评论片段' : field.key)} · {({ added: '新增', removed: '本次未采集', changed: '变化' })[field.change]}</strong><div className="mt-1 grid gap-2 md:grid-cols-2"><p className="whitespace-pre-wrap break-words">旧：{field.previous ?? '无此字段'}</p><p className="whitespace-pre-wrap break-words">新：{field.current ?? '无此字段'}</p></div></div>)}</div></details>
            <div className="flex flex-wrap gap-2">{(Object.keys(kinds) as Array<keyof typeof kinds>).map(kind => <button type="button" className={buttonClass} aria-pressed={filter === kind} disabled={busy} key={kind} onClick={() => { setFilter(kind); clearSelection(); }}>{kinds[kind]} {detail.report.impacts.filter(item => item.kind === kind).length}</button>)}</div>
            <div className="grid gap-3 lg:grid-cols-2"><div className="max-h-96 space-y-2 overflow-y-auto">{detail.report.impacts.filter(item => item.kind === filter).map(item => <button type="button" data-maintenance-impact={item.targetId} disabled={busy} aria-pressed={impactId === item.id} key={item.id} className="block w-full rounded border border-border p-3 text-left text-xs hover:bg-surface-secondary" onClick={() => { clearSelection(); setImpactId(item.id); setAction(item.kind === 'workspace' ? 'edit-manually' : 'collect-evidence'); }}><strong className="block break-words">{item.title}</strong><span>{detail.decisions.some(value => value.impactId === item.id) ? '已记录人工决定' : '待复核'}{item.availability ? ` · ${{ available: '工程可读取', missing: '工程文件缺失', unreadable: '工程不可安全读取' }[item.availability]}` : ''}</span></button>)}</div>
                {impact && <div className="space-y-2 rounded border border-border p-3 text-xs" aria-label="逐项维护决定"><h4 className="break-words font-semibold">{impact.title}</h4><p>{({ 'source-version': '引用了旧来源版本', 'linked-opportunity': '引用上述旧版证据', 'direct-work': '通过机会直接关联的工程', 'inherited-work': '从关联工程派生，继承历史依据' })[impact.reason]}</p>
                    {impact.quoteStatus && <p>{quoteLabels[impact.quoteStatus]}</p>}
                    <details><summary className="cursor-pointer">引用链与版本定位</summary><p className="break-all">{kinds[impact.kind]}：{impact.targetId}{impact.targetRevision && <><br />检查时版本：{impact.targetRevision}</>}{impact.viaWorkspaceId && <><br />来源工程：{impact.viaWorkspaceId}</>}<br />证据：{impact.evidenceIds.join('、') || '无'}<br />机会：{impact.opportunityIds.join('、') || '无'}</p></details>
                    <div className="flex flex-wrap gap-2">{impact.evidenceIds.map((id, index) => <button type="button" disabled={busy} key={id} className={buttonClass} onClick={() => void act(async token => { const value = data(await window.ipcRenderer.contentIntelligence.evidenceSource(id)); if (token === epoch.current) setView(value); })}>查看原始证据 {index + 1}</button>)}
                        {impact.kind === 'workspace' && <button type="button" disabled={busy || impact.availability !== 'available'} className={buttonClass} onClick={() => dispatchAppIntent({ type: 'creation.open', workspaceId: impact.targetId })}>打开原工程手动复核</button>}</div>
                    {decision && <p className="whitespace-pre-wrap break-words">最近决定 v{decision.revision}：{actions[decision.action]} · {decision.note}</p>}
                    <label className="block">处理决定<select aria-label="维护动作" className={inputClass} value={action} disabled={busy} onChange={event => { setAction(event.target.value as typeof action); setConfirmed(false); }}>{Object.entries(actions).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                    <label className="block">范围、理由与后续处理<textarea aria-label="维护说明" className={inputClass} maxLength={2000} value={note} disabled={busy} onChange={event => { setNote(event.target.value); setConfirmed(false); }} /></label>
                    <label className="flex items-start gap-2"><input type="checkbox" aria-label="确认记录维护决定" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />我已核对本项；记录决定后，稿件仍需自行修改和核实。</label>
                    <button type="button" disabled={busy || !note.trim() || !confirmed} className={buttonClass} onClick={() => void act(async token => {
                        const input = { reportId: detail.report.id, impactId: impact.id, impactVersion: impact.versionDigest, expectedDecisionRevision: decision?.revision || 0, action, note, confirmed: true as const };
                        data(await window.ipcRenderer.contentIntelligence.decideMaintenance({ ...input, requestId: requestId('decision', input) })); if (token !== epoch.current) return;
                        requests.current.delete('decision'); const updated = data(await window.ipcRenderer.contentIntelligence.maintenanceDetail(detail.report.id)); if (token !== epoch.current) return;
                        setDetail(updated); setNote(''); setConfirmed(false); setHistory(null); setMessage('已记录人工决定；请在原工程中执行后续处理。');
                    })}>确认记录本项决定</button>
                    <button type="button" disabled={busy} className={buttonClass} onClick={() => void act(async token => { const value = data(await window.ipcRenderer.contentIntelligence.maintenanceHistory(detail.report.id, impact.id)); if (token === epoch.current) setHistory(value); })}>查看最近 100 次处理记录</button>
                    {history && <div aria-label="维护审计记录" className="max-h-48 space-y-2 overflow-y-auto">{history.length ? history.map(value => <p className="whitespace-pre-wrap break-words" key={value.id}>v{value.revision} · {new Date(value.createdAt).toLocaleString()} · {actions[value.action]}：{value.note}</p>) : <p>尚无处理记录。</p>}</div>}
                </div>}</div>
            {view && <EvidenceSource view={view} onClose={() => setView(null)} />}
        </div>}
    </section>;
}
