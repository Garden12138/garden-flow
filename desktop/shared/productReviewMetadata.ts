/** Split the displayed Taobao/Tmall purchase metadata without inferring a SKU. */
export function splitProductReviewMetadata(dateInput: unknown, skuInput?: unknown) {
    const metadata = String(dateInput || '').replace(/\s+/g, ' ').trim();
    const sku = String(skuInput || '').replace(/\s+/g, ' ').trim();
    const purchase = metadata.match(/^((?:\d{4}年\d{1,2}月\d{1,2}日|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s*已购\s*[:：]\s*(.+)$/);
    return {
        dateText: (purchase?.[1] || metadata).slice(0, 300) || undefined,
        skuText: (sku || purchase?.[2] || '').slice(0, 1_000) || undefined,
    };
}
