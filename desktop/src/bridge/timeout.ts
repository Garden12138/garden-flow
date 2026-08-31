export function normalizeOptionalTimeoutMs(value: unknown): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }
  return Math.max(1, numericValue);
}
