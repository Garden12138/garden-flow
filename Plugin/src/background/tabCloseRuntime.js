export async function removeTabWithRetry(removeTab, tabId, options = {}) {
  if (typeof removeTab !== 'function') throw new Error('removeTabWithRetry requires removeTab');
  const id = Number(tabId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('removeTabWithRetry requires tabId');
  const maxAttempts = Math.max(1, Math.min(10, Math.trunc(Number(options.maxAttempts) || 5)));
  const wait = typeof options.wait === 'function'
    ? options.wait
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await removeTab(id);
      return { closed: true, attempts: attempt + 1, alreadyClosed: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/No tab with id/i.test(message)) {
        return { closed: true, attempts: attempt + 1, alreadyClosed: true };
      }
      if (!/Tabs cannot be edited right now/i.test(message) || attempt === maxAttempts - 1) throw error;
      await wait(200 * (attempt + 1));
    }
  }
  throw new Error(`Could not close tab ${id}`);
}
