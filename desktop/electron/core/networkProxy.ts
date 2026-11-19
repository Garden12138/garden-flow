import { session } from 'electron';

type ProxySettingsLike = {
  proxy_enabled?: boolean | number;
  proxy_url?: string;
  proxy_bypass?: string;
};

type AppliedProxyState = {
  enabled: boolean;
  proxyUrl: string;
  proxyBypass: string;
};

const DEFAULT_NO_PROXY = ['localhost', '127.0.0.1', '::1'];

let lastAppliedSignature = '';

function normalizeProxyUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[a-z]+:\/\//i.test(raw)) {
    return raw;
  }
  return `http://${raw}`;
}

function normalizeProxyBypass(value: unknown): string {
  const parts = String(value || '')
    .split(/[,\n;]/g)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const builtin of DEFAULT_NO_PROXY) {
    if (!parts.includes(builtin)) {
      parts.push(builtin);
    }
  }
  return parts.join(',');
}

function setProxyEnv(proxyUrl: string, proxyBypass: string): void {
  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.http_proxy = proxyUrl;
  process.env.https_proxy = proxyUrl;
  process.env.NO_PROXY = proxyBypass;
  process.env.no_proxy = proxyBypass;
}

function clearProxyEnv(): void {
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.http_proxy;
  delete process.env.https_proxy;
  delete process.env.NO_PROXY;
  delete process.env.no_proxy;
}

export async function applyGlobalNetworkProxy(settings?: ProxySettingsLike | null): Promise<AppliedProxyState> {
  const enabled = Boolean(settings?.proxy_enabled) && Boolean(String(settings?.proxy_url || '').trim());
  const proxyUrl = enabled ? normalizeProxyUrl(settings?.proxy_url) : '';
  const proxyBypass = normalizeProxyBypass(settings?.proxy_bypass);
  const signature = JSON.stringify({
    enabled,
    proxyUrl,
    proxyBypass,
  });

  if (signature === lastAppliedSignature) {
    return { enabled, proxyUrl, proxyBypass };
  }

  const undici = await import('undici');
  const dispatcher = enabled
    ? new undici.EnvHttpProxyAgent({ httpProxy: proxyUrl, httpsProxy: proxyUrl, noProxy: proxyBypass })
    : new undici.Agent();
  try {
    await session.defaultSession?.setProxy(enabled
      ? { proxyRules: proxyUrl, proxyBypassRules: proxyBypass }
      : { mode: 'direct' });
  } catch (error) {
    await dispatcher.close().catch(() => undefined);
    throw error;
  }

  if (enabled) setProxyEnv(proxyUrl, proxyBypass);
  else clearProxyEnv();
  undici.setGlobalDispatcher(dispatcher);
  lastAppliedSignature = signature;
  return { enabled, proxyUrl, proxyBypass };
}
