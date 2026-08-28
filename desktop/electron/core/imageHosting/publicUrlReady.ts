export async function waitForPublicUrlReady(
    url: string,
    options?: {
        fetchImpl?: typeof fetch;
        timeoutMs?: number;
        intervalMs?: number;
        sleep?: (ms: number) => Promise<void>;
    },
): Promise<void> {
    const publicUrl = String(url || '').trim();
    if (!publicUrl) {
        throw new Error('图床公开地址为空。');
    }

    const fetchImpl = options?.fetchImpl || globalThis.fetch;
    const timeoutMs = Math.max(1, Number(options?.timeoutMs) || 20000);
    const intervalMs = Math.max(1, Number(options?.intervalMs) || 800);
    const sleep = options?.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const startedAt = Date.now();
    let lastError = '';

    while (Date.now() - startedAt <= timeoutMs) {
        try {
            const response = await fetchImpl(publicUrl, { method: 'HEAD' });
            if (response.ok) return;
            lastError = `HTTP ${response.status}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error || 'fetch failed');
        }
        if (Date.now() - startedAt + intervalMs > timeoutMs) break;
        await sleep(intervalMs);
    }

    throw new Error(`图床已上传，但公开地址尚未可访问（${lastError || 'timeout'}）：${publicUrl}`);
}
