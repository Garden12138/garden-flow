import type { BridgeCore, Listener } from '../types';
import type { XhsPublishRecoveryInput } from '../../../shared/xhsPublisher';

export function createXhsPublisherBridge(core: BridgeCore) {
    return {
        xhsPublisher: {
            getStatus: () => core.invokeChannel('plugin:xhs-publisher-status'),
            prepare: () => core.invokeChannel('plugin:prepare-xhs-publisher'),
            openDir: () => core.invokeChannel('plugin:open-xhs-publisher-dir'),
            bindInstance: (payload: { extensionInstanceId: string }) => core.invokeChannel('xhs-publisher:bind-instance', payload),
            getJob: (payload: { jobId: string }) => core.invokeChannel('xhs-publisher:get-job', payload),
            confirm: (payload: { jobId: string }) => core.invokeChannel('xhs-publisher:confirm', payload),
            cancel: (payload: { jobId: string }) => core.invokeChannel('xhs-publisher:cancel', payload),
            retry: (payload: { jobId: string }) => core.invokeChannel('xhs-publisher:retry', payload),
            recoverUnpublished: (payload: XhsPublishRecoveryInput) => core.invokeChannel('xhs-publisher:recover-unpublished', payload),
            onJobChanged: (listener: Listener) => core.on('xhs-publisher:job-changed', listener),
            offJobChanged: (listener: Listener) => core.off('xhs-publisher:job-changed', listener),
        },
    };
}
