import { FileText, Film, Image, ArrowUpRight, AlertCircle } from 'lucide-react';
import type { WorkCatalogItem } from '../../../shared/workCatalog';
import { CREATION_CAPABILITY_LABELS } from '../../../shared/creationWorkspace';
import { dispatchAppIntent } from '../app-shell/appIntent';
import { resolveAssetUrl } from '../../utils/pathManager';

export function openCatalogWork(item: WorkCatalogItem) {
    const target = item.target;
    if (target.kind === 'workspace') dispatchAppIntent({ type: 'creation.open', workspaceId: target.id });
    else if (target.kind === 'video') dispatchAppIntent({ type: 'video-project.open', projectId: target.id });
    else dispatchAppIntent({ type: 'manuscript.open', manuscriptPath: target.path });
}
export function workKindLabel(kind: string) {
    return CREATION_CAPABILITY_LABELS[kind as keyof typeof CREATION_CAPABILITY_LABELS] || ({ longform: '文章', writing: '文章', video: '视频脚本', audio: '音频脚本', 'subtitle-edit': '视频' } as Record<string, string>)[kind] || '稿件';
}
const platforms: Record<string, string> = { xiaohongshu: '小红书', douyin: '抖音', tiktok: 'TikTok' };
export function WorkGallery({ items, layout = 'grid' }: { items: WorkCatalogItem[]; layout?: 'grid' | 'list' }) {
    return <div className={`work-gallery work-gallery--${layout}`}>{items.map(item => {
        const Icon = item.kind.includes('video') || item.kind === 'dream-story' || item.kind === 'product-remix' ? Film : item.kind.includes('image') ? Image : FileText;
        return <button key={item.id} className="work-gallery-item" disabled={item.availability === 'unreadable'} onClick={() => openCatalogWork(item)}>
            <div className="work-gallery-preview">{item.previewUrl ? <img src={resolveAssetUrl(item.previewUrl)} alt="" loading="lazy" /> : <div className="work-gallery-placeholder"><Icon size={32} strokeWidth={1.25} /><span>{workKindLabel(item.kind)}</span></div>}<span className="work-gallery-open"><ArrowUpRight size={17} /></span></div>
            <div className="work-gallery-copy"><p className="work-gallery-kind">{workKindLabel(item.kind)}{item.platform ? ` · ${platforms[item.platform] || item.platform}` : ''}</p><h3>{item.title}</h3>{item.availability === 'ready' ? <span className="work-gallery-date">{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '更新时间未知'}</span> : <span className="work-gallery-issue"><AlertCircle size={13} />{item.issue || '文件不可用'}</span>}</div>
        </button>;
    })}</div>;
}
