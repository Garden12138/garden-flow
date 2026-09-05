import type { BridgeCore } from '../types';

export function createSystemBridge(core: BridgeCore) {
  return {
    debug: {
      getStatus: () => core.invokeChannel('debug:get-status'),
      getRecent: (limit?: number) => core.invokeChannel('debug:get-recent', { limit }),
      getRuntimeSummary: () => core.invokeChannel('debug:get-runtime-summary'),
      openLogDir: () => core.invokeChannel('debug:open-log-dir'),
    },
    logs: {
      getStatus: () => core.invokeChannel('logs:get-status'),
      getRecent: (limit?: number) => core.invokeChannel('logs:get-recent', { limit }),
      openDir: () => core.invokeChannel('logs:open-dir'),
      listReports: () => core.invokeChannel('logs:list-reports'),
      exportBundle: (reportId?: string, payload?: { includeAdvancedContext?: boolean }) =>
        core.invokeChannel('logs:export-bundle', { reportId, ...(payload || {}) }),
      createFeedbackReport: (payload: {
        title?: string;
        content: string;
        category?: string;
        priority?: 'low' | 'medium' | 'high' | 'urgent';
        source?: string;
        contact?: string;
        includeAdvancedContext?: boolean;
        context?: Record<string, unknown>;
      }) => core.invokeChannel('logs:create-feedback-report', payload),
      dismissReport: (reportId: string) => core.invokeChannel('logs:dismiss-report', { reportId }),
      appendRenderer: (payload: {
        level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
        category?: string;
        event?: string;
        message?: string;
        fields?: unknown;
      }) => core.invokeChannel('logs:append-renderer', payload),
      createAutoReport: (payload: {
        level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
        category?: string;
        event?: string;
        message?: string;
        fields?: unknown;
        trigger?: string;
      }) => core.invokeChannel('logs:create-auto-report', payload),
    },
    browserPlugin: {
      getStatus: () => core.invokeChannel('plugin:browser-extension-status'),
      prepare: () => core.invokeChannel('plugin:prepare-browser-extension'),
      openDir: () => core.invokeChannel('plugin:open-browser-extension-dir'),
    },
    checkYtdlp: () => core.invokeChannel('youtube:check-ytdlp'),
    installYtdlp: () => core.invokeChannel('youtube:install'),
    updateYtdlp: () => core.invokeChannel('youtube:update'),
    saveYoutubeNote: <T = unknown>(payload: Record<string, unknown>) =>
      core.invokeChannel('youtube:save-note', payload) as Promise<T>,
  };
}
