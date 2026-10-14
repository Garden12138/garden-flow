import { AsyncLocalStorage } from 'node:async_hooks';

const authorization = new AsyncLocalStorage<{ action: 'upload' | 'submit'; jobId: string }>();
/** Only renderer button IPC handlers enter this scope; never expose it through tools or CLI. */
export function withPublicationButton<T>(action: 'upload' | 'submit', jobId: string, operation: () => T): T {
    return authorization.run({ action, jobId }, operation);
}
export function assertPublicationButton(action: 'upload' | 'submit', jobId: string): void {
    const current = authorization.getStore();
    if (current?.action !== action || current.jobId !== jobId) throw new Error('上传与最终发布必须分别点击当前任务的确认按钮');
}
