import { useState } from 'react';
import { FileText, Image, Video, ShoppingBag, Moon, ArrowRight, X } from 'lucide-react';
import { CREATION_CAPABILITY_LABELS, type CreationCapability } from '../../../shared/creationWorkspace';
import { dispatchAppIntent } from '../app-shell/appIntent';
import { useDialogFocus } from '../workbench/useDialogFocus';

const choices = [
    { kind: 'writing', title: '文章与脚本', description: '从资料或想法开始写作', icon: FileText },
    { kind: 'note-image', title: '图文笔记', description: '可编辑的图文与卡片', icon: Image },
    { kind: 'note-video', title: '视频笔记', description: '将选题制作成视频', icon: Video },
    { kind: 'product-video', title: '商品视频', description: '围绕真实商品规划分镜', icon: ShoppingBag },
    { kind: 'product-image-set', title: '商品套图', description: '封面与内容页一起制作', icon: Image },
    { kind: 'product-remix', title: '视频混剪', description: '复用已有视频与素材', icon: Video },
    { kind: 'dream-story', title: '梦境故事', description: '把记忆片段变成故事', icon: Moon },
] as const;

export function CreationChooser({ onClose }: { onClose: () => void }) {
    const [kind, setKind] = useState<string>('writing');
    const ref = useDialogFocus(onClose);
    const start = () => {
        onClose();
        if (kind === 'writing') dispatchAppIntent({ type: 'gardenflow.open', action: 'new' });
        else if (kind === 'dream-story') dispatchAppIntent({ type: 'dream-story.new' });
        else if (Object.hasOwn(CREATION_CAPABILITY_LABELS, kind)) dispatchAppIntent({ type: 'creation.prepare', capability: kind as CreationCapability });
    };
    return <div className="workspace-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
        <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="creation-chooser-title" className="workspace-dialog">
            <header className="flex items-start justify-between gap-4"><div><p className="workspace-eyebrow">开始一件作品</p><h2 id="creation-chooser-title" className="text-2xl font-semibold">这次想创作什么？</h2><p className="mt-2 text-sm text-text-secondary">选择形式，再补充平台、资料与创作要求。</p></div><button aria-label="关闭新建作品" onClick={onClose} className="workspace-icon-button"><X size={18} /></button></header>
            <div className="my-6 grid grid-cols-2 gap-3">{choices.map(({ kind: id, title, description, icon: Icon }) => <button key={id} aria-pressed={kind === id} className={`creation-choice ${kind === id ? 'is-selected' : ''}`} onClick={() => setKind(id)}><Icon size={20} /><strong>{title}</strong><span>{description}</span></button>)}</div>
            <footer className="flex justify-end"><button className="workspace-primary-button" onClick={start}>继续<ArrowRight size={16} /></button></footer>
        </section>
    </div>;
}
