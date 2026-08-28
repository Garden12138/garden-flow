import { isBrowserCaptureNativeHostInvocation } from './core/browserCaptureProtocol';

if (isBrowserCaptureNativeHostInvocation()) {
    void import('./browserNativeHostRuntime')
        .then(({ runBrowserNativeHost }) => runBrowserNativeHost())
        .catch(() => {
            process.exitCode = 1;
        });
} else {
    void import('./appMain');
}
