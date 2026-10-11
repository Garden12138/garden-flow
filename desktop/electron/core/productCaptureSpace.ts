// Resolve once at request start. A capture must never follow later UI space changes.
export function resolveProductCaptureSpaceId(requested: unknown, activeSpaceId: string, knownSpaceIds: string[]): string {
    if (requested !== undefined && (typeof requested !== 'string' || !requested.trim())) {
        throw new Error('商品采集空间参数无效');
    }
    const id = requested === undefined ? activeSpaceId : (requested as string).trim();
    if (!knownSpaceIds.includes(id)) throw new Error('商品采集空间不存在，已停止保存');
    return id;
}
