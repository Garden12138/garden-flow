import { CARD_WIDTH, CARD_HEIGHT, CARD_TEMPLATE_VERSION, CARD_FONT_VERSION, CreationConfigSchema, type CardBlock, type CreationConfig } from './noteCards.ts';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
export interface RenderCardPage { id?: string; title?: string; copy?: string; layout?: string; blocks?: CardBlock[]; }
export function cardAssetIds(page: RenderCardPage): string[] {
    return [...new Set((page.blocks || []).flatMap(block => block.type === 'image' ? [block.assetId] : block.type === 'steps' ? block.items.flatMap(item => item.assetId ? [item.assetId] : []) : []).filter(Boolean))];
}
export function cardFingerprint(page: RenderCardPage, config: CreationConfig, hashes: Record<string, string>): string {
    return JSON.stringify({ page: { title: page.title, layout: page.layout || 'text', blocks: page.blocks ?? [{ type: 'text', text: page.copy || '', emphasis: [] }] }, style: config.style, template: CARD_TEMPLATE_VERSION, font: CARD_FONT_VERSION, width: CARD_WIDTH, height: CARD_HEIGHT, assets: cardAssetIds(page).map(id => [id, hashes[id]]) });
}
export function renderCardHtml(page: RenderCardPage, config: CreationConfig, sources: Record<string, string> = {}, fontCss = ''): string {
    const style = CreationConfigSchema.parse(config).style;
    const image = (id: string, fit = 'contain', x = 50, y = 50) => { if (!id) return ''; const source = sources[id]; if (!source || !/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(source)) throw new Error(`图片 ${id} 缺失或损坏`); return `<img src="${source}" style="object-fit:${fit === 'cover' ? 'cover' : 'contain'};object-position:${x}% ${y}%">`; };
    const blocks = (page.blocks || [{ type: 'text' as const, text: page.copy || '', emphasis: [] }]).map(block => {
        if (block.type === 'image') return `<figure data-card-box>${image(block.assetId, block.fit, block.x, block.y)}</figure>`;
        if (block.type === 'text') {
            const terms = [...block.emphasis].filter(Boolean).sort((a, b) => b.length - a.length);
            let remaining = block.text; let result = '';
            while (remaining) { const matches = terms.map(term => ({ term, index: remaining.indexOf(term) })).filter(value => value.index >= 0).sort((a, b) => a.index - b.index); const next = matches[0]; if (!next) { result += escape(remaining); break; } result += escape(remaining.slice(0, next.index)) + `<strong>${escape(next.term)}</strong>`; remaining = remaining.slice(next.index + next.term.length); }
            return `<p data-card-box>${result}</p>`;
        }
        if (block.type === 'comparison') return `<table data-card-box><thead><tr><th></th>${block.columns.map(column => `<th>${escape(column)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row => `<tr><th>${escape(row.label)}</th><td>${escape(row.left)}</td><td>${escape(row.right)}</td></tr>`).join('')}</tbody></table>`;
        if (block.type === 'steps') return `<ol class="steps" data-card-box>${block.items.map(item => `<li><div><h2>${escape(item.title)}</h2><p>${escape(item.text)}</p>${item.assetId ? image(item.assetId) : ''}</div></li>`).join('')}</ol>`;
        return `<div data-card-box><ul class="checklist">${block.items.map(item => `<li>${escape(item)}</li>`).join('')}</ul><p>${escape(block.closing)}</p></div>`;
    }).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'"><style>${fontCss}
*{box-sizing:border-box}html,body{margin:0;width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px;overflow:hidden}body{font-family:'Noto Sans SC',sans-serif;background:${style.background};color:${style.foreground};font-size:${Math.round(44 * style.fontScale)}px;line-height:1.6}.card{height:100%;padding:110px 100px;display:flex;flex-direction:column;gap:48px}h1{font-size:${Math.round(90 * style.fontScale)}px;line-height:1.25;margin:0;color:${style.accent};white-space:pre-wrap;overflow-wrap:anywhere}h2{font-size:1.1em;margin:0;color:${style.accent}}p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}strong{color:${style.accent};font-weight:700}.blocks{display:flex;flex-direction:column;gap:40px;min-height:0;flex:1}.mixed{gap:36px}.mixed h1{border-bottom:4px solid currentColor;padding-bottom:32px}.mixed figure{border-radius:24px;overflow:hidden}.cover{justify-content:center}.cover .blocks{flex:0}.legacy{padding:0;gap:0}.legacy h1{display:none}.legacy .blocks>figure{height:100%}.legacy img{max-height:none;border-radius:0}.split .blocks{display:grid;grid-template-columns:1fr 1fr;align-items:start}.blocks>figure{height:650px}figure{margin:0;min-width:0}img{width:100%;height:100%;max-height:650px;object-fit:contain;border-radius:20px}table{border-collapse:collapse;table-layout:fixed;width:100%;font-size:.85em}th,td{border:2px solid ${style.accent};padding:20px;white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:top}ol,ul{margin:0;padding-left:1.5em}li{padding-left:10px;margin-bottom:30px;white-space:pre-wrap;overflow-wrap:anywhere}.steps img{height:260px;width:auto;max-width:100%}.steps li::marker{color:${style.accent};font-weight:700}.checklist{list-style:'✓  '}.checklist li::marker{color:${style.accent}}
</style></head><body><main class="card ${escape(page.layout || 'text')} ${style.mode}" data-card-root><h1 data-card-box>${escape(page.title || '')}</h1><div class="blocks">${blocks}</div></main></body></html>`;
}
