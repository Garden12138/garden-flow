import { useEffect, useRef, useState } from 'react';

/** Keep the most recent callback, and never clear a newer draft when a save finishes. */
export function useCreationAutosave(dirty: boolean, epoch: unknown, save: () => Promise<unknown>, delay = 600) {
    const latest = useRef(save);
    latest.current = save;
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        if (!dirty) return;
        let active = true;
        const timer = window.setTimeout(() => {
            setSaving(true);
            void latest.current().then(() => { if (active) setError(''); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (active) setSaving(false); });
        }, delay);
        return () => { active = false; window.clearTimeout(timer); };
    }, [dirty, epoch, delay]);
    return { error, saving };
}
