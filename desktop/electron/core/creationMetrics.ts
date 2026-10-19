import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getWorkspacePaths } from '../db';

const queues = new Map<string, Promise<void>>();
/** Local aggregate counters only. Never record content, identifiers or source paths. */
export async function recordCreationMetric(event: string, durationMs = 0): Promise<void> {
    if (!/^(entry|draft|source|export)\.[a-z-]+(?:\.[a-z-]+)?$/.test(event)) return;
    const target = path.join(getWorkspacePaths().gardenflow, 'creation-metrics.json');
    const operation = (queues.get(target) || Promise.resolve()).then(async () => {
        let values: Record<string, { count: number; totalDurationMs: number }> = {};
        try { values = JSON.parse(await fs.readFile(target, 'utf8')); } catch { /* First local event. */ }
        const previous = values[event] || { count: 0, totalDurationMs: 0 };
        values[event] = { count: previous.count + 1, totalDurationMs: previous.totalDurationMs + Math.max(0, Math.round(durationMs)) };
        await fs.mkdir(path.dirname(target), { recursive: true }); const temp = target + '.' + randomUUID() + '.tmp';
        try { await fs.writeFile(temp, JSON.stringify(values), { mode: 0o600 }); await fs.rename(temp, target); } finally { await fs.rm(temp, { force: true }); }
    }).catch(() => undefined);
    queues.set(target, operation); await operation; if (queues.get(target) === operation) queues.delete(target);
}
