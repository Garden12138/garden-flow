import { useEffect, useRef } from 'react';

export function useDialogFocus(onClose: () => void, active = true) {
    const ref = useRef<HTMLElement>(null);
    const close = useRef(onClose); close.current = onClose;
    useEffect(() => {
        if (!active) return;
        const document = ref.current?.ownerDocument;
        if (!document) return;
        const previous = document.activeElement as HTMLElement | null;
        const controls = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],summary,[tabindex="0"]') || []).filter(item => {
            if (item.closest('[hidden]')) return false;
            for (let parent = item.parentElement; parent && parent !== ref.current; parent = parent.parentElement) {
                if (parent.tagName === 'DETAILS' && !parent.hasAttribute('open')) {
                    const summary = parent.querySelector(':scope > summary');
                    if (item !== summary && !summary?.contains(item)) return false;
                }
            }
            return true;
        });
        controls()[0]?.focus();
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
            if (event.key !== 'Tab') return;
            const items = controls(); const first = items[0]; const last = items.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        const node = ref.current; node?.addEventListener('keydown', keydown);
        return () => { node?.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus?.(); };
    }, [active]);
    return ref;
}
