export class BrowserCaptureOperationCache {
    private readonly results = new Map<string, unknown>();
    private readonly inFlight = new Map<string, Promise<unknown>>();
    private readonly limit: number;

    constructor(limit = 256) {
        this.limit = limit;
    }

    has(key: string): boolean {
        return this.results.has(key);
    }

    get(key: string): unknown {
        return this.results.get(key);
    }

    set(key: string, value: unknown): void {
        this.results.set(key, value);
        while (this.results.size > this.limit) {
            const oldest = this.results.keys().next().value;
            if (typeof oldest !== 'string') break;
            this.results.delete(oldest);
        }
    }

    async run<T>(key: string, task: () => Promise<T>): Promise<T> {
        if (this.results.has(key)) return this.results.get(key) as T;
        const pending = this.inFlight.get(key);
        if (pending) return pending as Promise<T>;
        const next = task().then((value) => {
            this.set(key, value);
            return value;
        }).finally(() => {
            this.inFlight.delete(key);
        });
        this.inFlight.set(key, next);
        return next;
    }
}
