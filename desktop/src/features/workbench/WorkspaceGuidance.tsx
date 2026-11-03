import { useEffect, useRef, type ReactNode } from 'react';
import { BookOpen, ChevronRight, MoreHorizontal } from 'lucide-react';

export function WorkspaceGuide({ title, description, steps, children }: {
    title: string; description: string; steps: readonly { title: string; description: string }[]; children?: ReactNode;
}) {
    return <section className="workspace-guide" aria-label={title}>
        <div><h2>{title}</h2><p>{description}</p>{children && <div className="workspace-guide-actions">{children}</div>}</div>
        <ol>{steps.map((step, index) => <li key={step.title}><span>{index + 1}</span><div><strong>{step.title}</strong><p>{step.description}</p></div></li>)}</ol>
    </section>;
}

export function WorkspaceHelp({ children, title = '第一次使用？查看操作指南' }: { children: ReactNode; title?: string }) {
    return <details className="workspace-help"><summary><BookOpen size={16} /><span>{title}</span><ChevronRight size={16} /></summary>{children}</details>;
}

export function WorkspaceMore({ children, label = '更多操作' }: { children: ReactNode; label?: string }) {
    const ref = useRef<HTMLDetailsElement>(null);
    useEffect(() => {
        const close = (event: MouseEvent) => { if (ref.current && !event.composedPath().includes(ref.current)) ref.current.removeAttribute('open'); };
        const owner = ref.current?.ownerDocument;
        owner?.addEventListener('click', close);
        return () => owner?.removeEventListener('click', close);
    }, []);
    return <details ref={ref} className="workspace-more" onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); ref.current?.removeAttribute('open'); ref.current?.querySelector('summary')?.focus(); }
    }}><summary className="workspace-secondary-button" aria-label={label}><MoreHorizontal size={16} />更多</summary><div onClick={event => {
        if ((event.target as HTMLElement).closest('button:not(:disabled)')) { ref.current?.removeAttribute('open'); ref.current?.querySelector('summary')?.focus(); }
    }}>{children}</div></details>;
}

export function openWorkspaceForm(ref: { current: HTMLDetailsElement | null }) {
    if (!ref.current) return;
    ref.current.open = true;
    ref.current.scrollIntoView?.({ block: 'nearest' });
    ref.current.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled])')?.focus();
}
