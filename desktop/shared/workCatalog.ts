export type WorkOpenTarget = { kind: 'workspace'; id: string } | { kind: 'manuscript'; path: string } | { kind: 'video'; id: string };
export interface WorkCatalogItem {
    id: string;
    title: string;
    kind: string;
    platform?: string;
    updatedAt: string;
    previewUrl?: string;
    availability: 'ready' | 'missing' | 'unreadable';
    issue?: string;
    target: WorkOpenTarget;
    nativeKey?: string;
}
export interface WorkCatalogResult { success: boolean; items: WorkCatalogItem[]; partial: boolean; error?: string; }

/** Registered workspaces own their native documents; independent legacy works remain accessible. */
export function mergeWorkCatalog(registered: WorkCatalogItem[], legacy: WorkCatalogItem[]): WorkCatalogItem[] {
    const nativeKeys = new Set(registered.filter(item => item.availability !== 'unreadable').map(item => item.nativeKey).filter(Boolean));
    const ids = new Set<string>();
    return [...registered, ...legacy.filter(item => !item.nativeKey || !nativeKeys.has(item.nativeKey))]
        .filter(item => { if (ids.has(item.id)) return false; ids.add(item.id); return true; })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
