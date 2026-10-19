import { registerCreationFlush } from './creationNavigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PanelLeftClose, PanelRightClose, Pencil, Eye } from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

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
    const [narrow, setNarrow] = useState(false);
    const [tab, setTab] = useState<'editor' | 'preview'>('editor');
    const [chatOpen, setChatOpen] = useState(true);
    const [previewOpen, setPreviewOpen] = useState(true);
    useEffect(() => {
        const measure = () => setNarrow(Math.min(root.current?.getBoundingClientRect().width || window.innerWidth, window.innerWidth) < 1000);
        const observer = new ResizeObserver(measure);
        measure(); if (root.current) observer.observe(root.current); window.addEventListener('resize', measure);
        return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
    }, []);
    useEffect(() => {
        if (!adapter.focusChatSignal) return;
        setChatOpen(true);
        const frame = window.requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-label="创作对话"] [contenteditable="true"]')?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [adapter.focusChatSignal]);
    const pane = (name: string, content: ReactNode) => <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" aria-label={name}>
        <div className="flex h-10 shrink-0 items-center border-b border-border px-3 text-xs font-semibold text-text-secondary">{name}</div>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{content}</div>
    </section>;
    return <div ref={root} data-creation-workbench={adapter.id} data-creation-narrow={narrow} className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface-primary text-text-primary">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0 flex-1"><p className="text-[10px] tracking-wider text-text-tertiary">创作工作台</p><h1 className="truncate text-sm font-semibold">{adapter.title}</h1><p className="text-[11px] text-text-tertiary">{adapter.subtitle}{adapter.status ? ` · ${adapter.status}` : ''}</p></div>
            <div className="flex flex-wrap items-center gap-2 text-xs">{adapter.actions}</div>
            <button type="button" className="rounded p-2 hover:bg-surface-secondary" aria-label={chatOpen ? '收起创作对话' : '展开创作对话'} aria-pressed={chatOpen} onClick={() => setChatOpen(value => !value)}><PanelLeftClose className="h-4 w-4" /></button>
            {narrow ? <button type="button" className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs" onClick={() => setTab(value => value === 'editor' ? 'preview' : 'editor')}>{tab === 'editor' ? <Eye className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}{tab === 'editor' ? '查看预览' : '返回编辑'}</button> : <button type="button" className="rounded p-2 hover:bg-surface-secondary" aria-label={previewOpen ? '收起效果预览' : '展开效果预览'} aria-pressed={previewOpen} onClick={() => setPreviewOpen(value => !value)}><PanelRightClose className="h-4 w-4" /></button>}
        </header>
        {adapter.notice}
        <PanelGroup direction="horizontal" autoSaveId="creation-workbench-panels-v1" className="min-h-0 flex-1">
            {chatOpen && <><Panel id="chat" order={1} defaultSize={30} minSize={24}>{pane('创作对话', adapter.chat)}</Panel><PanelResizeHandle className="w-1 shrink-0 bg-border/50 transition-colors hover:bg-accent-primary/50" /></>}
            <Panel id="editor" order={2} defaultSize={40} minSize={32}>
                <div className={narrow && tab === 'preview' ? 'hidden' : 'h-full'}>{pane('作品编辑', adapter.editor)}</div>
                {narrow && <div className={tab === 'preview' ? 'h-full' : 'hidden'}>{pane('效果预览', adapter.preview)}</div>}
            </Panel>
            {!narrow && previewOpen && <><PanelResizeHandle className="w-1 shrink-0 bg-border/50 transition-colors hover:bg-accent-primary/50" /><Panel id="preview" order={3} defaultSize={30} minSize={24}>{pane('效果预览', adapter.preview)}</Panel></>}
        </PanelGroup>
    </div>;
}
