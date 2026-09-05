import './brandStartup';
import { isBrowserCaptureNativeHostInvocation } from './core/browserCaptureProtocol';

if (isBrowserCaptureNativeHostInvocation()) {
    void import('./browserNativeHostBootstrap')
        .then(async ({ handoffBrowserNativeHostToNodeRuntime }) => {
            if (handoffBrowserNativeHostToNodeRuntime()) return;
            const { runBrowserNativeHost } = await import('./browserNativeHostRuntime');
            await runBrowserNativeHost();
        })
        .catch(() => {
            process.exitCode = 1;
        });
} else {
    void import('./appMain');
}
