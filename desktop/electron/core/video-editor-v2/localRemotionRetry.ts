// Remotion occasionally completes its first local navigation without a response
// receipt. A fresh invocation creates a fresh browser and can recover; retry only
// that exact initialization failure, once, for our locally served bundle.
export async function retryLocalRemotionNavigation<T>(operation: () => Promise<T>, onRetry?: () => void): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const match = /^Visited "http:\/\/localhost:(\d+)\/index\.html" but got no response\.$/.exec(message);
        const port = Number(match?.[1]);
        if (!match || port < 3000 || port > 3100) throw error;
        onRetry?.();
        return operation();
    }
}
