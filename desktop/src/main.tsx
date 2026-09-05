import './ipc/bootstrap';
import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import 'tippy.js/dist/tippy.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-700.css'
import '@fontsource/noto-sans-sc/chinese-simplified-400.css'
import '@fontsource/noto-sans-sc/chinese-simplified-500.css'
import '@fontsource/noto-sans-sc/chinese-simplified-600.css'
import '@fontsource/noto-sans-sc/chinese-simplified-700.css'
import '@fontsource/noto-serif-sc/chinese-simplified-500.css'
import '@fontsource/noto-serif-sc/chinese-simplified-600.css'
import '@fontsource/noto-serif-sc/chinese-simplified-700.css'
import './index.css'
import { APP_BRAND } from './config/brand'
import { applyAppTheme, readThemePreference, resolveThemeMode } from './config/theme'
import { appAlert } from './utils/appDialogs'
import { installRendererDiagnostics, reportRendererError } from './logging/client'
import { I18nProvider } from './i18n'

const initializeThemeMode = () => {
  try {
    applyAppTheme(resolveThemeMode(readThemePreference()));
  } catch {
    applyAppTheme('light');
  }
};

initializeThemeMode();
installRendererDiagnostics();
document.title = APP_BRAND.htmlTitle;

window.alert = ((message?: unknown) => {
  void appAlert(String(message ?? ''));
}) as typeof window.alert;

const disableNativeContextMenu = (event: MouseEvent) => {
  event.preventDefault();
};

document.addEventListener('contextmenu', disableNativeContextMenu);

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    void reportRendererError(error, {
      category: 'plugin.bridge',
      event: 'react.error_boundary',
      fields: {
        componentStack: errorInfo.componentStack,
      },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: 'red', fontFamily: 'monospace' }}>
          <h1>Something went wrong.</h1>
          <h3>{this.state.error?.message}</h3>
          <pre>{this.state.error?.stack}</pre>
        </div>
      );
    }

    return this.props.children;
  }
}

function RendererReadySignal() {
  useEffect(() => {
    let sent = false;
    const reportReady = () => {
      if (sent) return;
      sent = true;
      window.ipcRenderer.send('renderer:ready', {
        rootChildCount: document.getElementById('root')?.childElementCount ?? 0,
        readyState: document.readyState,
      });
    };

    const fallbackTimer = window.setTimeout(reportReady, 250);
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(reportReady);
    });

    return () => {
      window.clearTimeout(fallbackTimer);
      window.cancelAnimationFrame(firstFrame);
    };
  }, []);

  return null;
}

const appTree = (
  <>
    <RendererReadySignal />
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </>
);

const isDevRuntime = window.location.protocol !== 'file:';

ReactDOM.createRoot(document.getElementById('root')!).render(
  isDevRuntime
    ? appTree
    : appTree,
)
