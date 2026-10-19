import { useRef } from 'react';
import { Check, ChevronDown, Clapperboard, Image as ImageIcon, Moon, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';

export interface ChatComposerModeParameter {
    id: string;
    label: string;
    taskHintKey: string;
    valueType?: 'string' | 'number';
    defaultValue: string;
    options: Array<{ value: string; label: string }>;
}

export interface ChatComposerModeOption {
    id: string;
    label: string;
    description?: string;
    placeholder?: string;
    icon?: 'image' | 'video' | 'moon';
    platformId?: string;
    parameters?: ChatComposerModeParameter[];
    taskHints: Record<string, unknown>;
    onSelect?: () => void;
}

export interface ChatComposerModeGroup {
    label: string;
    platforms?: Array<{ id: string; label: string }>;
    options: ChatComposerModeOption[];
}

export function ChatCreationModePicker({ group, platformId, activeModeId, dark = false, disabled = false, onPlatformChange, onSelect, onClear }: {
    group: ChatComposerModeGroup;
    platformId: string | null;
    activeModeId: string | null;
    dark?: boolean;
    disabled?: boolean;
    onPlatformChange: (id: string) => void;
    onSelect: (option: ChatComposerModeOption) => void;
    onClear: () => void;
}) {
    const detailsRef = useRef<HTMLDetailsElement>(null);
    const platform = group.platforms?.find(item => item.id === platformId);
    const activeMode = group.options.find(option => option.id === activeModeId);
    const options = group.options.filter(option => !group.platforms?.length || option.platformId === platformId);
    const close = () => detailsRef.current?.removeAttribute('open');
    return <details ref={detailsRef} className="group relative shrink-0 text-left" data-creation-mode-picker="">
        <summary
            className={clsx('inline-flex h-8 cursor-pointer list-none select-none items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors [&::-webkit-details-marker]:hidden', activeMode
                ? dark ? 'border-rose-300/35 bg-rose-300/10 text-rose-100' : 'border-accent-primary/35 bg-accent-primary/10 text-accent-primary'
                : dark ? 'border-white/10 bg-white/[0.03] text-white/62' : 'border-border bg-surface-primary text-text-secondary hover:text-accent-primary')}
            aria-label="选择创作平台与方式"
            title={activeMode ? `${platform?.label || group.label} · ${activeMode.label}` : '先选择平台，再选择创作方式'}
        >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
            <span>{platform?.label || group.label}</span>
            {activeMode && <span className="opacity-75">· {activeMode.label}</span>}
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" strokeWidth={1.8} />
        </summary>
        <div className={clsx('absolute bottom-full left-0 z-50 mb-2 max-h-[min(70vh,560px)] w-[340px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border p-2 shadow-[0_18px_55px_-18px_rgba(0,0,0,0.35)] backdrop-blur-xl', dark ? 'border-white/10 bg-[#171b20]/95' : 'border-border bg-surface-primary/95')}>
            {group.platforms?.length ? <div className="px-2.5 pb-3 pt-1">
                <p className="mb-2 text-xs font-semibold">1. 选择平台</p>
                <div className="flex gap-2">{group.platforms.map(item => <button key={item.id} type="button" disabled={disabled} aria-pressed={platformId === item.id}
                    className={clsx('flex-1 rounded-lg border px-2 py-2 text-xs transition-colors disabled:opacity-40', platformId === item.id ? 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary' : 'border-border text-text-secondary hover:bg-surface-secondary')}
                    onClick={() => onPlatformChange(item.id)}>{item.label}</button>)}</div>
            </div> : null}
            <div className="px-2.5 pb-2 pt-1">
                <p className="text-xs font-semibold">{group.platforms?.length ? '2. 选择创作方式' : '选择创作方式'}</p>
                <p className="mt-1 text-[11px] leading-4 text-text-tertiary">{platform ? `${platform.label}当前支持以下创作方式。` : group.platforms?.length ? '先选择目标平台，查看可用的创作方式。' : '输入创作想法，继续完善内容。'}</p>
            </div>
            <div className="space-y-1">{options.map(option => {
                const selected = option.id === activeModeId;
                const Icon = option.icon === 'moon' ? Moon : option.icon === 'video' ? Clapperboard : ImageIcon;
                return <button key={option.id} type="button" disabled={disabled} aria-pressed={selected}
                    onClick={() => { if (option.onSelect) option.onSelect(); else onSelect(option); close(); }}
                    className={clsx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors disabled:opacity-40', selected ? 'bg-accent-primary/10 text-accent-primary' : 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary')}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-secondary"><Icon className="h-4 w-4" strokeWidth={1.8} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{option.label}</span>{option.description && <span className="mt-0.5 block text-[11px] leading-4 text-text-tertiary">{option.description}</span>}</span>
                    {selected && <Check className="h-4 w-4 shrink-0" strokeWidth={2} />}
                </button>;
            })}</div>
            {(activeMode || platform) && <button type="button" disabled={disabled} onClick={() => { onClear(); close(); }} className="mt-1 w-full rounded-lg px-3 py-2 text-left text-[11px] text-text-tertiary hover:bg-surface-secondary">退出创作模式</button>}
        </div>
    </details>;
}
