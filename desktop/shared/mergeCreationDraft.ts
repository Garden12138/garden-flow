/** Rebase only manually changed fields; unchanged fields keep the newest saved value. */
export function mergeCreationDraft<T>(base: T, local: T, latest: T): T {
    const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
    const merge = (before: any, input: any, saved: any): any => {
        if (same(before, input)) return saved;
        if (saved === undefined || input === null || typeof input !== 'object') return input;
        if (Array.isArray(input)) {
            if (!Array.isArray(before) || !Array.isArray(saved)) return input;
            const keyed = [...before, ...input, ...saved].every(value => value && typeof value === 'object' && typeof value.id === 'string');
            if (!keyed) return input;
            const old = new Map(before.map(value => [value.id, value])); const edited = new Map(input.map(value => [value.id, value])); const current = new Map(saved.map(value => [value.id, value]));
            const reordered = !same(before.map(value => value.id), input.map(value => value.id));
            const order = [...new Set([...(reordered ? input : saved).map(value => value.id), ...input.map(value => value.id), ...saved.map(value => value.id)])];
            return order.flatMap(id => {
                if (old.has(id) && !edited.has(id)) return [];
                if (!edited.has(id)) return current.has(id) ? [current.get(id)] : [];
                if (!current.has(id) && same(old.get(id), edited.get(id))) return [];
                return [merge(old.get(id), edited.get(id), current.get(id))];
            });
        }
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return input;
        return Object.fromEntries([...new Set([...Object.keys(before || {}), ...Object.keys(input), ...Object.keys(saved)])].map(key => [key, merge(before?.[key], input[key], saved[key])]).filter(([, value]) => value !== undefined));
    };
    return merge(base, local, latest);
}
