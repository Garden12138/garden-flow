import type { ReactNode } from 'react';
import { AlertCircle, Inbox, Loader2, RotateCcw, X } from 'lucide-react';
import { clsx } from 'clsx';

export function WorkbenchPageHeader({
    eyebrow,
    title,
    description,
    actions,
}: {
    eyebrow: string;
    title: string;
    description?: string;
    actions?: ReactNode;
}) {
    return (
        <header className="workbench-page-header">
            <div className="min-w-0">
                <div className="workbench-page-header__eyebrow">{eyebrow}</div>
                <h1>{title}</h1>
                {description && <p>{description}</p>}
            </div>
            {actions && <div className="workbench-page-header__actions">{actions}</div>}
        </header>
    );
}

export function WorkbenchFilterBar({ children }: { children: ReactNode }) {
    return <div className="workbench-filter-bar">{children}</div>;
}

export function WorkbenchBulkActionBar({
    selectionCount,
    children,
}: {
    selectionCount: number;
    children: ReactNode;
}) {
    if (selectionCount <= 0) return null;
    return (
        <div className="workbench-bulk-action-bar" role="region" aria-label={`已选择 ${selectionCount} 项`}>
            <span>{selectionCount} 项已选择</span>
            <div>{children}</div>
        </div>
    );
}

export function WorkbenchInspector({
    open,
    title,
    onClose,
    children,
}: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
}) {
    return (
        <aside className={clsx('workbench-inspector', open && 'is-open')} aria-hidden={!open}>
            <div className="workbench-inspector__header">
                <h2>{title}</h2>
                <button type="button" onClick={onClose} title="关闭检查器" aria-label="关闭检查器">
                    <X className="h-4 w-4" strokeWidth={1.8} />
                </button>
            </div>
            <div className="workbench-inspector__body">{children}</div>
        </aside>
    );
}

export function WorkbenchStatePanel({
    state,
    title,
    description,
    onRetry,
}: {
    state: 'loading' | 'empty' | 'error';
    title: string;
    description?: string;
    onRetry?: () => void;
}) {
    const Icon = state === 'loading' ? Loader2 : state === 'error' ? AlertCircle : Inbox;
    return (
        <div className="workbench-state-panel" data-state={state} role={state === 'error' ? 'alert' : 'status'}>
            <Icon className={clsx('h-5 w-5', state === 'loading' && 'animate-spin')} strokeWidth={1.7} />
            <div>
                <h3>{title}</h3>
                {description && <p>{description}</p>}
            </div>
            {state === 'error' && onRetry && (
                <button type="button" onClick={onRetry}>
                    <RotateCcw className="h-4 w-4" strokeWidth={1.8} />
                    重试
                </button>
            )}
        </div>
    );
}

export function WorkbenchResourceBrowser({
    sources,
    children,
    inspector,
    inspectorOpen = true,
}: {
    sources: ReactNode;
    children: ReactNode;
    inspector?: ReactNode;
    inspectorOpen?: boolean;
}) {
    return (
        <div className="workbench-resource-browser" data-inspector-open={inspector && inspectorOpen ? 'true' : 'false'}>
            <aside className="workbench-resource-browser__sources">{sources}</aside>
            <section className="workbench-resource-browser__canvas">{children}</section>
            {inspector && <aside className="workbench-resource-browser__inspector">{inspector}</aside>}
        </div>
    );
}
