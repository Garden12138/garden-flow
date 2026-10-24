import { useEffect, useRef, useState } from 'react';
import { CAMPAIGN_ROLE_LABELS, type ContentCampaign } from '../../../shared/contentCampaigns';
import { CREATION_CAPABILITY_LABELS } from '../../../shared/creationWorkspace';
import { PRODUCT_PLATFORM_LABELS } from '../../../shared/productCreationTarget';

export function CampaignContextPanel({ workspaceId }: { workspaceId: string }) {
    const [open, setOpen] = useState(false); const [campaigns, setCampaigns] = useState<ContentCampaign[]>([]); const [error, setError] = useState(''); const epoch = useRef(0);
    useEffect(() => {
        const clear = () => { epoch.current++; setOpen(false); setCampaigns([]); setError(''); }; clear(); window.ipcRenderer.spaces.onChanged(clear);
        return () => { epoch.current++; window.ipcRenderer.spaces.offChanged(clear); };
    }, [workspaceId]);
    return <section className="shrink-0 border-b border-border px-3 py-2 text-xs text-text-secondary"><button type="button" aria-expanded={open} onClick={async () => {
        const token = ++epoch.current; if (open) { setOpen(false); return; } setOpen(true); setCampaigns([]); setError('');
        try { const result = await window.ipcRenderer.contentIntelligence.campaignsForWork(workspaceId); if (token !== epoch.current) return; if (result.success === false) throw new Error(result.error); setCampaigns(result.data); }
        catch (reason) { if (token === epoch.current) setError(String(reason)); }
    }}>成组内容任务{open ? ' ▴' : ' ▾'}</button>
        {open && <div className="max-h-64 space-y-2 overflow-auto pt-2">{error ? <p role="alert">{error}</p> : !campaigns.length ? <p>此工程尚未关联成组内容。</p> : campaigns.map(campaign => <article key={campaign.id} className="space-y-1 rounded border border-border p-2"><p><strong>{campaign.title}</strong> · {campaign.status === 'archived' ? '组已归档，工程保留' : '进行中'}</p><p>目标：{campaign.goal}；受众：{campaign.audience}</p>
            {campaign.items.filter(item => item.workspaceId === workspaceId).map(item => <div key={item.id}><p>本条：{item.title} · {CAMPAIGN_ROLE_LABELS[item.role]}</p><p>职责与理由（待核实）：{item.why}</p><p>素材需求估计：{item.assetNeeds.join('；') || '未填写，不代表没有需求'}</p><p>目标：{PRODUCT_PLATFORM_LABELS[item.target.platform]} · {CREATION_CAPABILITY_LABELS[item.target.capability]}</p></div>)}
            {campaign.limitations.map((value, index) => <p key={index}>限制：{value}</p>)}<p>创建工程仅登记任务，文案、媒体与发布需在现有工作台逐项处理。</p>
        </article>)}</div>}
    </section>;
}
