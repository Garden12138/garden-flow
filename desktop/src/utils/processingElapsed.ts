export function formatProcessingElapsed(totalMs: number): string {
    const safeMs = Number.isFinite(totalMs) ? Math.max(0, totalMs) : 0;
    const totalSeconds = Math.floor(safeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

export function resolveProcessingEndAt(input: {
    startedAt: number;
    finishedAt?: number;
    isRunning: boolean;
    now: number;
}): number {
    if (Number.isFinite(input.finishedAt)) {
        return Math.max(input.startedAt, Number(input.finishedAt));
    }
    if (input.isRunning) {
        return Math.max(input.startedAt, input.now);
    }
    return input.startedAt;
}
