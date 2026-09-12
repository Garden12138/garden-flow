import type { Note } from './knowledgeModel';

export function jdProductNoteSource(note: Pick<Note, 'sourceUrl'>): { url: string; skuId: string } | null {
    try {
        const url = new URL(note.sourceUrl || '');
        const skuId = url.pathname.match(/\/(\d+)\.html$/i)?.[1];
        if (!/^https?:$/.test(url.protocol) || !/(^|\.)jd\.(com|hk)$/.test(url.hostname) || !skuId) return null;
        return { url: url.href, skuId };
    } catch {
        return null;
    }
}

export function cleanJdProductTitle(title: string): string {
    return title.replace(/\s*【行情\s*报价\s*价格\s*评测】\s*/g, '').replace(/\s*[-_]\s*京东.*$/i, '').trim();
}
