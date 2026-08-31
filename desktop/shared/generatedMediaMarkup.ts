const MEDIA_ELEMENT_RE = /<(video|audio)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
const MEDIA_SOURCE_RE = /<source\b([^>]*)\/?\s*>/i;
const FENCED_BLOCK_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

function readHtmlAttribute(attributes: string, name: string): string {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\u0060]+))`, 'i').exec(attributes);
    return String(match?.[1] || match?.[2] || match?.[3] || '').trim();
}

function decodeHtmlAttribute(value: string): string {
    return value
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
}

function normalizeMediaElements(content: string): string {
    return content.replace(MEDIA_ELEMENT_RE, (markup, rawKind: string, attributes: string, children: string) => {
        const sourceAttributes = MEDIA_SOURCE_RE.exec(children)?.[1] || '';
        const source = decodeHtmlAttribute(readHtmlAttribute(attributes, 'src') || readHtmlAttribute(sourceAttributes, 'src'));
        if (!source || /[\r\n<>]/.test(source)) return markup;
        const kind = rawKind.toLowerCase() === 'audio' ? 'audio' : 'video';
        return `\n\n![generated-${kind}](<${source}>)\n\n`;
    });
}

/**
 * Converts legacy model-authored media HTML into the Markdown media contract
 * understood by the chat renderer. Fenced examples remain literal code.
 */
export function normalizeGeneratedMediaMarkup(content: string): string {
    const text = String(content || '');
    if (!text || (!/<video\b/i.test(text) && !/<audio\b/i.test(text))) return text;

    const fencedBlocks: string[] = [];
    const protectedText = text.replace(FENCED_BLOCK_RE, (block) => {
        const token = `\u0000gardenflow-media-fence-${fencedBlocks.length}\u0000`;
        fencedBlocks.push(block);
        return token;
    });
    const normalized = normalizeMediaElements(protectedText);
    return normalized.replace(/\u0000gardenflow-media-fence-(\d+)\u0000/g, (_token, index: string) => (
        fencedBlocks[Number(index)] || ''
    ));
}
