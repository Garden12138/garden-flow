import { SourceSnapshotSchema, type SourceSnapshot } from '../../../shared/contentIntelligence.ts';
import { SourceFieldChangeSchema, type MaintenanceWorkReference } from '../../../shared/sourceMaintenance.ts';
import type { z } from 'zod';
import { sourceKey } from './repository.ts';

export function sourceFieldChanges(previousInput: SourceSnapshot, currentInput: SourceSnapshot | null): Array<z.infer<typeof SourceFieldChangeSchema>> {
    const previous = SourceSnapshotSchema.parse(previousInput); const current = currentInput && SourceSnapshotSchema.parse(currentInput);
    // Unavailability is not proof that fields were removed. The report records missing-source status separately.
    if (!current) return [];
    if (sourceKey(previous.source) !== sourceKey(current.source)) throw new Error('不能比较不同身份、平台或类型的来源');
    const changes: Array<z.infer<typeof SourceFieldChangeSchema>> = [];
    const before = new Map(previous.segments.map(segment => [segment.key, segment])); const after = new Map(current.segments.map(segment => [segment.key, segment]));
    for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
        const a = before.get(key); const b = after.get(key);
        if (a?.text === b?.text && a?.kind === b?.kind) continue;
        changes.push(SourceFieldChangeSchema.parse({ kind: 'segment', key, change: !a ? 'added' : !b ? 'removed' : 'changed', previous: a?.text ?? null, current: b?.text ?? null,
            ...(a ? { previousKind: a.kind } : {}), ...(b ? { currentKind: b.kind } : {}) }));
    }
    for (const key of ['title', 'capturedAt', 'sourceUrl', 'coverage'] as const) {
        const a = JSON.stringify(previous[key]) ?? null; const b = JSON.stringify(current[key]) ?? null;
        if (a !== b) changes.push(SourceFieldChangeSchema.parse({ kind: 'metadata', key, change: a === null ? 'added' : b === null ? 'removed' : 'changed', previous: a, current: b }));
    }
    return changes;
}
// Returns only proven descendants of explicit CI work links. A shared product ID alone is not version proof.
export function affectedWorkspaceLineage(roots: string[], works: MaintenanceWorkReference[]): Map<string, string | undefined> {
    const affected = new Map<string, string | undefined>([...new Set(roots)].sort().map(id => [id, undefined]));
    const byId = new Map(works.map(work => [work.id, work])); const children = new Map<string, string[]>();
    if (byId.size !== works.length) throw new Error('工程身份重复，无法核对来源链');
    for (const work of works) if (work.sourceId) children.set(work.sourceId, [...(children.get(work.sourceId) || []), work.id]);
    const queue = [...affected.keys()];
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const parent = queue[cursor];
        for (const id of (children.get(parent) || []).sort()) {
            if (!affected.has(id)) { affected.set(id, parent); queue.push(id); }
        }
    }
    for (const id of affected.keys()) {
        let current: string | undefined = id; const seen = new Set<string>();
        while (current) {
            if (seen.has(current) || seen.size >= 32) throw new Error('受影响工程的来源链循环或超限，请人工复核');
            seen.add(current); current = byId.get(current)?.sourceId;
        }
    }
    return affected;
}
