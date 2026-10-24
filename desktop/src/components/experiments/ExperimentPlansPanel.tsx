import { useEffect, useRef, useState } from 'react';
import type { CiResult } from '../../../shared/contentIntelligence';
import type { MetricObservation, MetricWorkSummary, PublicationLink } from '../../../shared/contentExperiments';
import { ExternalExperimentArmSchema, isExperimentWorkArm, type ContentExperiment, type ContentExperimentDetail, type ExperimentTask, type ExperimentWork, type ExperimentArm } from '../../../shared/contentExperimentPlans';
import { dispatchAppIntent } from '../../features/app-shell/appIntent';

const buttonClass = 'rounded border border-border px-3 py-2 text-xs disabled:opacity-40';
const fieldClass = 'w-full rounded border border-border bg-surface-primary p-2 text-sm';
const kinds = { title: '标题', cover: '封面', opening: '开头', body: '正文', cta: '行动提示', timing: '发布安排', format: '内容形式', other: '其他明确变量' } as const;
type Kind = keyof typeof kinds;
const emptyForm = () => ({ title: '', hypothesis: '', baseline: '', variant: '', kind: 'title' as Kind, name: '', before: '', after: '', metricKey: '', definition: '', unit: 'count' as 'count' | 'seconds' | 'ratio', limitations: '' });
const emptyChange = () => ({ kind: 'title' as Exclude<Kind, 'format'>, name: '', before: '', after: '', rationale: '', preserve: '' });
const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);
function data<T>(result: CiResult<T>): T { if (result.success === false) throw new Error(result.error); return result.data; }
const ref = (work: ExperimentWork) => ({ workspaceId: work.workspaceId, revision: work.revision, draftEpoch: work.draftEpoch, contentVersion: work.contentVersion });
const armRef = (arm: ExperimentArm) => isExperimentWorkArm(arm) ? ref(arm) : { publicationLinkId: arm.publicationLinkId };
const armLabel = (arm: ExperimentArm) => arm.title || (isExperimentWorkArm(arm) ? arm.workspaceId : arm.externalWorkId);

export function ExperimentPlansPanel({ works, links, observations }: { works: MetricWorkSummary[]; links: PublicationLink[]; observations: MetricObservation[] }) {
    const api = window.ipcRenderer.contentIntelligence;
    const [plans, setPlans] = useState<ContentExperiment[]>([]); const [selected, setSelected] = useState(''); const [detail, setDetail] = useState<ContentExperimentDetail | null>(null);
    const [form, setForm] = useState(emptyForm); const [preview, setPreview] = useState<{ baseline: ExperimentArm; variant: ExperimentArm } | null>(null); const [acknowledged, setAcknowledged] = useState(false);
    const [baselineObservation, setBaselineObservation] = useState(''); const [variantObservation, setVariantObservation] = useState('');
    const [sourceRole, setSourceRole] = useState<'baseline' | 'variant'>('baseline'); const [change, setChange] = useState(emptyChange); const [taskPreview, setTaskPreview] = useState<ExperimentWork | null>(null);
    const [alternateSource, setAlternateSource] = useState(''); const [differentSourceAck, setDifferentSourceAck] = useState(false);
    const [confirmations, setConfirmations] = useState<Record<string, boolean>>({}); const [reviewTargets, setReviewTargets] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false); const [error, setError] = useState('');
    const epoch = useRef(0); const locked = useRef(false); const requests = useRef(new Map<string, { digest: string; id: string }>());
    const requestId = (operation: string, input: unknown) => {
        const digest = JSON.stringify(input); const previous = requests.current.get(operation);
        if (previous?.digest === digest) return previous.id;
        const id = crypto.randomUUID(); requests.current.set(operation, { digest, id }); return id;
    };
    const load = async (token: number, id = selected) => {
        const [list, value] = await Promise.all([api.experiments(), id ? api.experiment(id) : Promise.resolve(null)]);
        if (token !== epoch.current) return; setPlans(data(list)); setDetail(value ? data(value) : null);
    };
    useEffect(() => {
        const clear = () => {
            const token = ++epoch.current; locked.current = false; requests.current.clear();
            setPlans([]); setSelected(''); setDetail(null); setForm(emptyForm()); setPreview(null); setAcknowledged(false); setBaselineObservation(''); setVariantObservation('');
            setSourceRole('baseline'); setChange(emptyChange()); setTaskPreview(null); setConfirmations({}); setReviewTargets({}); setBusy(false); setError('');
            setAlternateSource(''); setDifferentSourceAck(false);
            void load(token, '').catch(reason => { if (token === epoch.current) setError(String(reason)); });
        };
        clear(); window.ipcRenderer.spaces.onChanged(clear);
        return () => { epoch.current++; window.ipcRenderer.spaces.offChanged(clear); };
    }, []);
    const act = async (operation: (token: number) => Promise<void>) => {
        if (locked.current) return; const token = epoch.current; locked.current = true; setBusy(true); setError('');
        try { await operation(token); } catch (reason) { if (token === epoch.current) setError(String(reason)); }
        finally { if (token === epoch.current) { locked.current = false; setBusy(false); } }
    };
    const selectPlan = (id: string) => {
        setSelected(id); setDetail(null); setTaskPreview(null); setChange(emptyChange()); setSourceRole('baseline'); setBaselineObservation(''); setVariantObservation(''); setConfirmations({});
        setAlternateSource(''); setDifferentSourceAck(false);
        void act(token => load(token, id));
    };
    const observationLabel = (value: MetricObservation) => `${links.find(link => link.id === value.input.publicationLinkId)?.externalWorkId || '作品未知'} · ${value.input.metric.key} ${value.input.value} ${value.input.metric.unit} · v${value.revision}`;
    const experiment = detail?.experiment;
    const sourceArm = experiment?.[sourceRole];
    const sourceWorkspaceId = alternateSource || (sourceArm && 'workspaceId' in sourceArm ? sourceArm.workspaceId : '');
    const differentSource = Boolean(sourceArm && (!('workspaceId' in sourceArm) || sourceWorkspaceId !== sourceArm.workspaceId));
    const inspectArm = async (selection: string): Promise<ExperimentArm> => {
        if (!selection.startsWith('publication:')) return data(await api.inspectExperimentWork(selection));
        const link = links.find(value => value.id === selection.slice('publication:'.length));
        if (!link || link.workspaceId) throw new Error('历史作品不属于当前可用范围');
        return ExternalExperimentArmSchema.parse({ publicationLinkId: link.id, platform: link.platform, title: link.title || link.externalWorkId,
            externalWorkId: link.externalWorkId, accountAlias: link.accountAlias, contentKind: link.externalContentKind || 'unknown', engineering: 'unlinked', sourceNote: link.sourceNote });
    };
    const observationsFor = (arm: ExperimentArm) => observations.filter(value => isExperimentWorkArm(arm)
        ? links.find(link => link.id === value.input.publicationLinkId)?.workspaceId === arm.workspaceId : value.input.publicationLinkId === arm.publicationLinkId);
    const savePlan = () => void act(async token => {
        if (!preview || !acknowledged) return;
        const input = { title: form.title, hypothesis: form.hypothesis, baseline: armRef(preview.baseline), variant: armRef(preview.variant),
            variable: { kind: form.kind, name: form.name, baselineTreatment: form.before, variantTreatment: form.after },
            metric: { key: form.metricKey, definition: form.definition, unit: form.unit }, limitations: lines(form.limitations), singleVariableAcknowledged: true as const };
        const saved = data(await api.createExperiment({ ...input, requestId: requestId('plan', input) }));
        if (token !== epoch.current) return; setSelected(saved.id); setChange(emptyChange()); setSourceRole('baseline'); setTaskPreview(null); setAlternateSource(''); setDifferentSourceAck(false); await load(token, saved.id);
    });
    const bind = () => void act(async token => {
        if (!experiment) return;
        const baseline = observations.find(value => value.id === baselineObservation); const variant = observations.find(value => value.id === variantObservation); if (!baseline || !variant) return;
        const input = { id: experiment.id, expectedRevision: experiment.revision, observations: { baseline: { id: baseline.id, revision: baseline.revision }, variant: { id: variant.id, revision: variant.revision } } };
        data(await api.bindExperiment({ ...input, requestId: requestId('bind', input) })); await load(token);
    });
    const taskAction = (task: ExperimentTask, operation: 'start' | 'review' | 'cancel') => void act(async token => {
        if (operation === 'cancel') data(await api.cancelExperimentTask({ id: task.id, expectedRevision: task.revision }));
        else {
            if (!confirmations[task.id]) return;
            const input = { id: task.id, expectedRevision: task.revision, confirmed: true as const };
            if (operation === 'start') data(await api.startExperimentTask(input));
            else data(await api.reviewExperimentTask({ ...input, workspaceId: reviewTargets[task.id] || task.targetWorkspaceId }));
        }
        if (token !== epoch.current) return; setConfirmations({}); await load(token);
    });
    return <section aria-label="假设与下一轮任务" className="space-y-4 rounded border border-border p-4">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">假设与下一轮任务</h2><button className={buttonClass} disabled={busy} onClick={() => void act(load)}>刷新实验</button></div>
        <p className="text-xs text-text-secondary">先记录可被观测推翻的假设，再选择已有工程和指标。下一轮只创建待人工编辑的副本，每项媒体生成和发布继续使用现有确认。</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <details><summary className="cursor-pointer text-sm">建立实验假设</summary><form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); savePlan(); }}>
            <div className="grid gap-3 md:grid-cols-2">{(['title', 'hypothesis'] as const).map(key => <label key={key} className="text-xs">{key === 'title' ? '实验名称' : '可验证假设'}<textarea aria-label={key === 'title' ? '实验名称' : '实验假设'} required maxLength={key === 'title' ? 200 : 2000} className={fieldClass} disabled={busy} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}</div>
            <div className="grid gap-3 md:grid-cols-2">{(['baseline', 'variant'] as const).map(role => <label key={role} className="text-xs">{role === 'baseline' ? '对照工程或历史作品' : '变体工程或历史作品'}<select aria-label={role === 'baseline' ? '实验对照工程' : '实验变体工程'} required className={fieldClass} disabled={busy} value={form[role]} onChange={event => { setForm({ ...form, [role]: event.target.value }); setPreview(null); setAcknowledged(false); }}><option value="">选择当前空间的工程或未关联原工程的历史作品</option>{works.map(work => <option key={work.id} value={work.id}>{work.title} · {work.platform} · {work.capability} · {work.id}</option>)}{links.filter(link => !link.workspaceId).map(link => <option key={link.id} value={'publication:' + link.id}>历史作品 · {link.title || link.externalWorkId} · {link.platform} · 原工程未关联</option>)}</select></label>)}</div>
            <label className="block text-xs">待研究变量<select aria-label="实验变量类型" className={fieldClass} disabled={busy} value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value as Kind })}>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <div className="grid gap-3 md:grid-cols-3">{(['name', 'before', 'after'] as const).map(key => <label key={key} className="text-xs">{({ name: '变量的具体名称', before: '对照处理', after: '变体处理' })[key]}<textarea aria-label={`实验变量${key}`} required maxLength={key === 'name' ? 200 : 2000} className={fieldClass} disabled={busy} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}</div>
            <label className="block text-xs">沿用已有观测的口径（可选）<select aria-label="实验指标来源" className={fieldClass} disabled={busy} value="" onChange={event => { const metric = observations.find(value => value.id === event.target.value)?.input.metric; if (metric) setForm({ ...form, metricKey: metric.key, definition: metric.definition, unit: metric.unit }); }}><option value="">选择口径或在下方填写</option>{observations.map(value => <option key={value.id} value={value.id}>{observationLabel(value)} · {value.input.metric.definition}</option>)}</select></label>
            <div className="grid gap-3 md:grid-cols-3"><label className="text-xs">指标键<input aria-label="实验指标键" required className={fieldClass} disabled={busy} value={form.metricKey} onChange={event => setForm({ ...form, metricKey: event.target.value })} /></label><label className="text-xs">指标口径<textarea aria-label="实验指标口径" required maxLength={2000} className={fieldClass} disabled={busy} value={form.definition} onChange={event => setForm({ ...form, definition: event.target.value })} /></label><label className="text-xs">单位<select aria-label="实验指标单位" className={fieldClass} disabled={busy} value={form.unit} onChange={event => setForm({ ...form, unit: event.target.value as typeof form.unit })}><option value="count">次数</option><option value="seconds">秒</option><option value="ratio">比例 0–1</option></select></label></div>
            <label className="block text-xs">限制与未控制的干扰因素（每行一项）<textarea aria-label="实验限制" className={fieldClass} disabled={busy} value={form.limitations} onChange={event => setForm({ ...form, limitations: event.target.value })} /></label>
            <button type="button" className={buttonClass} disabled={busy || !form.baseline || !form.variant || form.baseline === form.variant} onClick={() => void act(async token => {
                const [baseline, variant] = await Promise.all([inspectArm(form.baseline), inspectArm(form.variant)]);
                if (token === epoch.current) { setPreview({ baseline, variant }); setAcknowledged(false); }
            })}>预览实验工程版本</button>
            {preview && <div className="space-y-2 text-xs"><p>已读取对照 {armLabel(preview.baseline)} / 变体 {armLabel(preview.variant)}。保存时再次核对来源与版本，后续编辑不会改变这个历史快照。</p>{(!('workspaceId' in preview.baseline) || !('workspaceId' in preview.variant)) && <p>历史作品的原工程与发布版本未知，不能据此证明实施过单变量控制。</p>}<label className="flex gap-2"><input aria-label="确认实验假设范围" type="checkbox" disabled={busy} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />确认这是待验证的假设，已如实记录未控制因素，下一轮将选择一项明确变化。</label></div>}
            <button className={buttonClass} disabled={busy || !preview || !acknowledged}>保存实验假设</button>
        </form></details>
        {!plans.length && <p className="text-sm">还没有实验假设，暂无实验结论。</p>}
        <select aria-label="选择内容实验" className={fieldClass} disabled={busy} value={selected} onChange={event => selectPlan(event.target.value)}><option value="">选择已保存实验</option>{plans.map(value => <option key={value.id} value={value.id}>{value.title} · {value.status} · v{value.revision}</option>)}</select>
        {experiment && <div aria-label="实验详情" className="space-y-4">
            <div className="space-y-1 text-sm"><p><strong>{experiment.title}</strong> · v{experiment.revision}</p><p>假设：{experiment.hypothesis}</p><p>待研究变量：{experiment.variable.name}；对照「{experiment.variable.baselineTreatment}」，变体「{experiment.variable.variantTreatment}」</p><p>口径：{experiment.metric.definition}（{experiment.metric.unit}）</p>{experiment.limitations.map((value, index) => <p key={index}>限制：{value}</p>)}<p className="break-words text-xs">对照 {armLabel(experiment.baseline)} / 变体 {armLabel(experiment.variant)}。原工程或原生版本缺少对应证明时不生成表现结论。</p></div>
            <div className="grid gap-3 md:grid-cols-2">{(['baseline', 'variant'] as const).map(role => <label key={role} className="text-xs">{role === 'baseline' ? '绑定对照观测' : '绑定变体观测'}<select aria-label={role === 'baseline' ? '实验对照观测' : '实验变体观测'} className={fieldClass} disabled={busy || experiment.status === 'archived'} value={role === 'baseline' ? baselineObservation : variantObservation} onChange={event => (role === 'baseline' ? setBaselineObservation : setVariantObservation)(event.target.value)}><option value="">选择此对象的观测版本</option>{observationsFor(experiment[role]).map(value => <option key={value.id} value={value.id}>{observationLabel(value)} · {value.input.metric.definition}</option>)}</select></label>)}</div>
            <button className={buttonClass} disabled={busy || !baselineObservation || !variantObservation || experiment.status === 'archived'} onClick={bind}>确认绑定观测版本</button>
            {detail.observationRevisionsChanged && <p className="text-sm">观测已有修订，本报告仍引用原版本。重新选择并确认后才会更新报告。</p>}
            <div aria-label="实验观察报告" className="rounded border border-border p-3 text-sm">{detail.comparison ? <><p>{detail.comparison.comparable ? `观察差值 ${detail.comparison.difference}；相对变化 ${detail.comparison.relativeChange === null ? 'N/A' : (detail.comparison.relativeChange * 100).toFixed(2) + '%'}` : `不足以判断：${detail.comparison.reasons.join('；')}`}</p><p>干扰因素：{detail.comparison.confounders.join('；') || '未提供，不代表不存在'}</p><p>历史观察不能证明因果。</p></> : <p>尚未绑定观测，没有表现结论。</p>}</div>
            <div className="flex gap-2">{(experiment.status === 'archived' ? ['collecting'] : ['completed', 'archived']).filter(to => to !== experiment.status).map(to => <button key={to} className={buttonClass} disabled={busy} onClick={() => void act(async token => {
                const input = { id: experiment.id, expectedRevision: experiment.revision, to: to as 'collecting' | 'completed' | 'archived' };
                data(await api.transitionExperiment({ ...input, requestId: requestId('transition', input) })); await load(token);
            })}>{to === 'archived' ? '归档实验' : to === 'completed' ? '结束本轮，保留不足结论' : '重新打开实验'}</button>)}</div>
            {experiment.status !== 'archived' && <details><summary className="cursor-pointer text-sm">规划下一轮单变量编辑</summary><form className="mt-3 space-y-3" onSubmit={event => {
                event.preventDefault(); void act(async token => {
                    if (!taskPreview || differentSource && !differentSourceAck) return;
                    const input = { experimentId: experiment.id, expectedRevision: experiment.revision, sourceRole, source: ref(taskPreview), change: { ...change, preserve: lines(change.preserve) }, ...(differentSource ? { differentSourceAcknowledged: true as const } : {}) };
                    data(await api.createExperimentTask({ ...input, requestId: requestId('task', input) }));
                    if (token === epoch.current) { setTaskPreview(null); await load(token); }
                });
            }}><label className="block text-xs">参考哪一组观察<select aria-label="下一轮来源工程" className={fieldClass} disabled={busy} value={sourceRole} onChange={event => { setSourceRole(event.target.value as typeof sourceRole); setTaskPreview(null); setAlternateSource(''); setDifferentSourceAck(false); }}><option value="baseline">对照对象</option><option value="variant">变体对象</option></select></label>
                <label className="block text-xs">下一轮工程起点<select aria-label="下一轮另选工程" className={fieldClass} disabled={busy} value={alternateSource} onChange={event => { setAlternateSource(event.target.value); setTaskPreview(null); setDifferentSourceAck(false); }}><option value="">{sourceArm && 'workspaceId' in sourceArm ? '使用对应原工程的当前已保存版本' : '选择一个可用工程，不冒充历史原件'}</option>{works.filter(work => work.platform === sourceArm?.platform).map(work => <option key={work.id} value={work.id}>{work.title} · {work.capability} · {work.id}</option>)}</select></label>
                {differentSource && <label className="flex gap-2 text-xs"><input aria-label="确认另选工程为起点" type="checkbox" disabled={busy} checked={differentSourceAck} onChange={event => { setDifferentSourceAck(event.target.checked); setTaskPreview(null); }} />确认此工程只是另行选定的下一轮起点，不是已核实的历史发布原件；历史观测不能证明它的表现。</label>}
                <label className="block text-xs">只修改哪一项<select aria-label="下一轮变量类型" className={fieldClass} disabled={busy} value={change.kind} onChange={event => setChange({ ...change, kind: event.target.value as typeof change.kind })}>{Object.entries(kinds).filter(([key]) => key !== 'format').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <div className="grid gap-3 md:grid-cols-2">{(['name', 'before', 'after', 'rationale', 'preserve'] as const).map(key => <label key={key} className="text-xs">{({ name: '具体变量', before: '当前处理', after: '计划处理', rationale: '修改理由与不确定性', preserve: '保持不变（每行一项）' })[key]}<textarea aria-label={`下一轮${key}`} required maxLength={key === 'name' ? 200 : key === 'preserve' ? 12000 : 2000} className={fieldClass} disabled={busy} value={change[key]} onChange={event => setChange({ ...change, [key]: event.target.value })} /></label>)}</div>
                <button type="button" className={buttonClass} disabled={busy || !sourceWorkspaceId || differentSource && !differentSourceAck} onClick={() => void act(async token => { const value = data(await api.inspectExperimentWork(sourceWorkspaceId)); if (token === epoch.current) setTaskPreview(value); })}>核对下一轮来源版本</button>
                {taskPreview && <p className="text-xs">将从当前已核对版本建立任务，保留旧工程；副本建立后由你在现有编辑器执行上述一项修改。</p>}
                <button className={buttonClass} disabled={busy || !taskPreview || differentSource && !differentSourceAck}>保存下一轮编辑任务</button>
            </form></details>}
            <div className="space-y-3">{detail.tasks.map(task => <article key={task.id} className="space-y-2 rounded border border-border p-3 text-xs"><p><strong>{task.change.name}</strong> · {task.state === 'ready' ? '待确认复制' : task.state === 'copying' ? '正在复制' : task.state === 'ready_to_edit' ? '副本已建立，待人工编辑' : task.state === 'cancelled' ? '已取消，工程保留' : '待人工复核'}</p><p>{task.change.before} → {task.change.after}</p><p>{task.change.rationale}；保持：{task.change.preserve.join('；')}</p>
                {task.basis.sourceDiffersFromArm && <p>已明确另选工程起点；该工程不是已核实的历史发布原件。</p>}
                {task.state === 'needs_review' && <><p>复制中断、来源变化或关联保存失败。工程保持原状，不会自动重建。核对候选内容后，可明确关联已有工程；否则取消本任务并按最新版本另建任务。</p><select aria-label={`复核工程 ${task.id}`} className={fieldClass} disabled={busy} value={reviewTargets[task.id] || task.targetWorkspaceId} onChange={event => setReviewTargets({ ...reviewTargets, [task.id]: event.target.value })}><option value={task.targetWorkspaceId}>原复制目标 {task.targetWorkspaceId}</option>{works.filter(work => work.id !== task.targetWorkspaceId && work.id !== task.source.workspaceId && work.platform === task.source.platform && work.capability === task.source.capability).map(work => <option key={work.id} value={work.id}>{work.title} · {work.id}</option>)}</select></>}
                {['ready', 'needs_review'].includes(task.state) && <label className="flex gap-2"><input aria-label={`确认实验任务 ${task.id}`} type="checkbox" disabled={busy} checked={Boolean(confirmations[task.id])} onChange={event => setConfirmations({ ...confirmations, [task.id]: event.target.checked })} />{task.state === 'ready' ? '确认复制当前已核对工程；不自动修改或生成媒体' : '已人工核对候选内容，确认关联；无完整复制证明时保留人工复核标记'}</label>}
                <div className="flex flex-wrap gap-2">{task.state === 'ready' && <button className={buttonClass} disabled={busy || !confirmations[task.id]} onClick={() => taskAction(task, 'start')}>确认建立下一轮副本</button>}{task.state === 'needs_review' && <button className={buttonClass} disabled={busy || !confirmations[task.id]} onClick={() => taskAction(task, 'review')}>确认关联复核工程</button>}{task.workspaceId && <button className={buttonClass} disabled={busy} onClick={() => dispatchAppIntent({ type: 'creation.open', workspaceId: task.workspaceId! })}>打开下一轮工程</button>}{!['copying', 'cancelled'].includes(task.state) && <button className={buttonClass} disabled={busy} onClick={() => taskAction(task, 'cancel')}>取消任务，保留工程</button>}</div>
            </article>)}</div>
        </div>}
    </section>;
}
