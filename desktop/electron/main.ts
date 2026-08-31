import { assertDataMigrationReady } from './brandStartup';
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
    try {
        assertDataMigrationReady();
        void import('./appMain');
    } catch (error) {
        void import('electron').then(({ app, dialog }) => {
            dialog.showErrorBox('GardenFlow 数据迁移', String(error));
            app.exit(1);
        });
    }
}
