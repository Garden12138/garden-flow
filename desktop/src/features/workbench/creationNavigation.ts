const flushers = new Map<symbol, () => Promise<unknown>>();
export function registerCreationFlush(flush: () => Promise<unknown>): () => void {
    const token = Symbol('creation-flush'); flushers.set(token, flush);
    return () => { flushers.delete(token); };
}
export async function flushCreationBeforeNavigate(): Promise<void> {
    for (const flush of [...flushers.values()]) await flush();
}
export function hasCreationFlush(): boolean { return flushers.size > 0; }
