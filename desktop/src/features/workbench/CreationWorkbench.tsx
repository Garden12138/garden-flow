import { useDialogFocus } from './useDialogFocus';
import { registerCreationFlush } from './creationNavigation';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CreationContext } from '../creation/CreationContext';
import { SlidersHorizontal, MessageSquare, BookOpenText, X, PanelRightClose } from 'lucide-react';

export interface CreationAdapter {
    id: string;
    title: string;
    changeToken?: string | number;
    focusChatSignal?: number;
    subtitle?: string;
    status?: string;
    chat: ReactNode;
    editor: ReactNode;
    preview: ReactNode;
    navigation?: ReactNode;
    timeline?: ReactNode;
    actions?: ReactNode;
    notice?: ReactNode;
    flush?: () => Promise<unknown>;
}

/** A single shell for every authoring format. Panels never own a second document. */
export function CreationWorkbench({ adapter }: { adapter: CreationAdapter }) {
    const flush = useRef(adapter.flush); flush.current = adapter.flush;
    useEffect(() => registerCreationFlush(async () => flush.current?.()), []);
    const root = useRef<HTMLDivElement>(null);
    const fieldValues = useRef(new Map<string, string>());
    useEffect(() => {
        const controls = root.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[aria-label="作品编辑"] input, [aria-label="作品编辑"] textarea, [aria-label="作品编辑"] select');
        const highlighted: Element[] = [];
        controls?.forEach((control, index) => {
            const key = control.tagName + ':' + (control.getAttribute('aria-label') || control.getAttribute('placeholder') || index);
            const previous = fieldValues.current.get(key); fieldValues.current.set(key, control.value);
            if (previous !== undefined && previous !== control.value) { control.classList.add('ring-2', 'ring-accent-primary/40'); highlighted.push(control); }
        });
        const timer = window.setTimeout(() => highlighted.forEach(control => control.classList.remove('ring-2', 'ring-accent-primary/40')), 2200);
        return () => { window.clearTimeout(timer); highlighted.forEach(control => control.classList.remove('ring-2', 'ring-accent-primary/40')); };
    }, [adapter.changeToken]);
    const context = useContext(CreationContext);
    const [narrow, setNarrow] = useState(false);
    const [inspectorOpen, setInspectorOpen] = useState(true);
    const [tab, setTab] = useState<'editor' | 'ai' | 'context'>('editor');
    const inspectorRef = useDialogFocus(() => setInspectorOpen(false), narrow && inspectorOpen);
    useEffect(() => {
        const measure = () => setNarrow((root.current?.getBoundingClientRect().width || window.innerWidth) < 1200);
        const observer = new ResizeObserver(measure); measure(); if (root.current) observer.observe(root.current);
        return () => observer.disconnect();
    }, []);
    useEffect(() => { if (narrow) setInspectorOpen(false); }, [narrow]);
    useEffect(() => {
        if (!adapter.focusChatSignal) return;
        setTab('ai'); setInspectorOpen(true);
        const frame = window.requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-label="创作对话"] [contenteditable="true"]')?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [adapter.focusChatSignal]);
    const openTab = (value: typeof tab) => { setTab(value); setInspectorOpen(true); };
    return <div ref={root} data-creation-workbench={adapter.id} data-creation-narrow={narrow} className="creation-canvas-shell">
        <header className="creation-canvas-header">
            <div className="min-w-0 flex-1"><h1>{adapter.title}</h1><p>{adapter.subtitle}<span className="creation-save-status">{adapter.status}</span></p></div>
            <div className="creation-canvas-actions">{context?.versions && <details className="creation-version-menu"><summary>平台与版本</summary><div>{context.versions}</div></details>}{adapter.actions}</div>
            <button type="button" className="workspace-icon-button" aria-label={inspectorOpen ? '收起辅助面板' : '展开辅助面板'} aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(value => !value)}><PanelRightClose size={18} /></button>
        </header>
        {adapter.notice}
        <div className="creation-canvas-body">
            {adapter.navigation && <nav aria-label="页面与镜头" className="creation-canvas-navigation">{adapter.navigation}</nav>}
            <div className="creation-canvas-stage"><section aria-label="效果预览" className="creation-canvas-preview">{adapter.preview}</section>{adapter.timeline && <section aria-label="视频时间线" className="creation-canvas-timeline">{adapter.timeline}</section>}</div>
            {narrow && inspectorOpen && <button className="creation-inspector-backdrop" aria-label="关闭辅助面板" onClick={() => setInspectorOpen(false)} />}
            <aside ref={inspectorRef} role={narrow ? 'dialog' : 'complementary'} aria-modal={narrow && inspectorOpen ? true : undefined} className={`creation-inspector ${inspectorOpen ? 'is-open' : ''}`} aria-label="创作辅助面板" onKeyDown={event => { if (event.key === 'Escape' && narrow) { event.stopPropagation(); setInspectorOpen(false); } }}>
                <div className="creation-inspector-tabs" role="tablist" aria-label="创作工具">{([{ id: 'editor', label: '属性', icon: SlidersHorizontal }, { id: 'ai', label: 'AI 助手', icon: MessageSquare }, ...(context ? [{ id: 'context', label: '创作上下文', icon: BookOpenText }] : [])] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={tab === id} id={`creation-tab-${id}`} aria-controls={`creation-panel-${id}`} onClick={() => openTab(id as typeof tab)}><Icon size={15} />{label}</button>)}{narrow && <button aria-label="关闭辅助面板" onClick={() => setInspectorOpen(false)}><X size={16} /></button>}</div>
                <section id="creation-panel-editor" role="tabpanel" aria-labelledby="creation-tab-editor" aria-label="作品编辑" hidden={tab !== 'editor'}>{adapter.editor}</section>
                <section id="creation-panel-ai" role="tabpanel" aria-labelledby="creation-tab-ai" aria-label="创作对话" hidden={tab !== 'ai'}>{adapter.chat}</section>
                {context && <section id="creation-panel-context" role="tabpanel" aria-labelledby="creation-tab-context" hidden={tab !== 'context'}>{context?.content}</section>}
            </aside>
            {narrow && !inspectorOpen && <div className="creation-floating-tools"><button onClick={() => openTab('editor')}><SlidersHorizontal size={16} />属性</button><button onClick={() => openTab('ai')}><MessageSquare size={16} />AI 助手</button>{context && <button onClick={() => openTab('context')}><BookOpenText size={16} />依据</button>}</div>}
        </div>
    </div>;
}
