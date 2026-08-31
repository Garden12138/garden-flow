import type { BridgeCore, Listener } from '../types';

type LlmReadinessSnapshot = {
  ready?: boolean;
  mode?: 'official' | 'custom' | 'local' | 'none' | string;
  reason?: string;
  sourceId?: string;
  sourceName?: string;
  baseURL?: string;
  model?: string;
  protocol?: 'openai' | 'anthropic' | 'gemini' | string;
  officialLoggedIn?: boolean;
  canUseOfficial?: boolean;
  canUseCustom?: boolean;
  updatedAt?: string;
};

type AuthStateSnapshot = {
  status?: string;
  loggedIn?: boolean;
  session?: unknown;
  points?: unknown;
  models?: unknown[];
  callRecords?: unknown[];
  degradedReason?: string | null;
  lastError?: string | null;
  lastErrorKind?: string | null;
  lastRefreshAt?: string | null;
  nextRefreshAtMs?: number | null;
  [key: string]: unknown;
};

export function createAuthBridge(core: BridgeCore) {
  return {
    officialAuth: {
      bootstrap: (payload?: { reason?: string }) => core.invokeChannelGuarded(
        'gardenflow-auth:bootstrap',
        payload || {},
        {
          timeoutMs: 20000,
          fallback: { success: false, error: '官方账号恢复超时' },
        },
      ),
      refresh: () => core.invokeChannel('gardenflow-auth:refresh'),
      getConfig: () => core.invokeChannel('gardenflow-auth:get-config'),
      setRealm: (payload: { realm: 'cn' | 'global' }) => core.invokeChannel('gardenflow-auth:set-realm', payload),
      getMe: () => core.invokeChannel('gardenflow-auth:me'),
      getPoints: () => core.invokeChannel('gardenflow-auth:points'),
      getProducts: () => core.invokeChannel('gardenflow-auth:products'),
      getProduct: (payload: { productId: string }) => core.invokeChannel('gardenflow-auth:product', payload),
      getCallRecords: () => core.invokeChannel('gardenflow-auth:call-records'),
      getWechatStatus: (payload: { sessionId: string }) => core.invokeChannel('gardenflow-auth:wechat-status', payload),
      getWechatUrl: (payload?: { state?: string }) => core.invokeChannel('gardenflow-auth:wechat-url', payload || {}),
      sendSmsCode: (payload: { phone: string }) => core.invokeChannel('gardenflow-auth:send-sms-code', payload),
      loginSms: (payload: { phone: string; code: string; inviteCode?: string }) =>
        core.invokeChannel('gardenflow-auth:login-sms', payload),
      registerSms: (payload: { phone: string; code: string; inviteCode?: string }) =>
        core.invokeChannel('gardenflow-auth:register-sms', payload),
      logout: () => core.invokeChannel('gardenflow-auth:logout'),
      createPagePayOrder: (payload: Record<string, unknown>) =>
        core.invokeChannel('gardenflow-auth:create-page-pay-order', payload),
      getOrderStatus: (payload: { outTradeNo: string }) => core.invokeChannel('gardenflow-auth:order-status', payload),
      openPaymentForm: (payload: { paymentForm: string }) =>
        core.invokeChannel('gardenflow-auth:open-payment-form', payload),
      getPricing: () => core.invokeChannel('gardenflow-auth:pricing'),
      refreshPricing: () => core.invokeChannel('gardenflow-auth:pricing-refresh'),
    },
    llmReadiness: {
      getState: () => core.invokeChannelGuarded<LlmReadinessSnapshot>(
        'llm-readiness:get-state',
        undefined,
        {
          timeoutMs: 3000,
          fallback: { ready: false, reason: 'timeout' },
        },
      ),
      refresh: () => core.invokeChannel('llm-readiness:refresh'),
      configureCustomSource: (payload: unknown) => core.invokeChannel('llm-readiness:configure-custom-source', payload),
      onStateChanged: (listener: Listener) => core.on('llm-readiness:state-changed', listener),
      offStateChanged: (listener: Listener) => core.off('llm-readiness:state-changed', listener),
    },
    auth: {
      getState: () => core.invokeChannelGuarded<AuthStateSnapshot>(
        'auth:get-state',
        undefined,
        {
          timeoutMs: 3000,
          fallback: {
            status: 'anonymous',
            loggedIn: false,
            session: null,
            points: null,
            models: [],
            callRecords: [],
            degradedReason: null,
            lastError: null,
            lastErrorKind: null,
            lastRefreshAt: null,
            nextRefreshAtMs: null,
          },
        },
      ),
      loginSms: (payload: { phone: string; code: string; inviteCode?: string }) =>
        core.invokeChannel('auth:login-sms', payload),
      loginWechatStart: (payload?: { state?: string }) => core.invokeChannel('auth:login-wechat-start', payload || {}),
      loginWechatPoll: (payload: { sessionId: string }) => core.invokeChannel('auth:login-wechat-poll', payload),
      logout: () => core.invokeChannel('auth:logout'),
      refreshNow: () => core.invokeChannel('auth:refresh-now'),
      onStateChanged: (listener: Listener) => core.on('auth:state-changed', listener),
      offStateChanged: (listener: Listener) => core.off('auth:state-changed', listener),
      onDataChanged: (listener: Listener) => core.on('auth:data-changed', listener),
      offDataChanged: (listener: Listener) => core.off('auth:data-changed', listener),
    },
  };
}
