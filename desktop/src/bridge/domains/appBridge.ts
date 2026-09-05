import type { BridgeCore, Listener } from '../types';

type AppReleaseNotesResult = {
  success: boolean;
  version?: string;
  tag?: string;
  name?: string;
  htmlUrl?: string;
  publishedAt?: string;
  body?: string;
  error?: string;
};

type AppUpdateInstallResult = {
  success: boolean;
  installed?: boolean;
  hasUpdate?: boolean;
  inFlight?: boolean;
  error?: string;
};

export function createAppBridge(core: BridgeCore) {
  return {
    getAppVersion: () => core.invokeChannel('app:get-version'),
    getAppReleaseNotes: (version?: string) => core.invokeChannelGuarded<AppReleaseNotesResult>(
      'app:get-release-notes',
      { version },
      {
        timeoutMs: 12000,
        fallback: { success: false, error: 'Release notes unavailable' },
      },
    ),
    checkAppUpdate: (force = false) => core.invokeChannel('app:check-update', { force }),
    installAppUpdate: () => core.invokeChannel('app:install-update') as Promise<AppUpdateInstallResult>,
    onAppUpdateAvailable: (listener: Listener) => core.on('app:update-available', listener),
    offAppUpdateAvailable: (listener: Listener) => core.off('app:update-available', listener),
    onAppUpdateInstallProgress: (listener: Listener) => core.on('app:update-install-progress', listener),
    offAppUpdateInstallProgress: (listener: Listener) => core.off('app:update-install-progress', listener),
    openExternalUrl: (url: string) => core.invokeChannel('app:open-external-url', { url }),
    openPath: (path: string) => core.invokeChannel('app:open-path', { path }),
    clipboardReadText: () => core.invokeChannel('clipboard:read-text'),
    clipboardWriteText: (text: string) => core.invokeChannel('clipboard:write-html', { text }),
  };
}
