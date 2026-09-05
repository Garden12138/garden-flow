import type { BridgeCore, Listener } from '../types';

export type LlmReadinessSnapshot = {
  ready?: boolean;
  mode?: 'custom' | 'disabled' | string;
  reason?: string;
  sourceId?: string;
  sourceName?: string;
  baseURL?: string;
  model?: string;
  protocol?: 'openai' | 'anthropic' | 'gemini' | string;
  canUseCustom?: boolean;
  updatedAt?: string;
};

export function createLlmReadinessBridge(core: BridgeCore) {
  return {
    llmReadiness: {
      getState: () => core.invokeChannelGuarded<LlmReadinessSnapshot>(
        'llm-readiness:get-state',
        undefined,
        {
          timeoutMs: 3000,
          fallback: { ready: false, mode: 'disabled', reason: 'timeout' },
        },
      ),
      refresh: () => core.invokeChannel('llm-readiness:refresh'),
      configureCustomSource: (payload: unknown) => core.invokeChannel('llm-readiness:configure-custom-source', payload),
      onStateChanged: (listener: Listener) => core.on('llm-readiness:state-changed', listener),
      offStateChanged: (listener: Listener) => core.off('llm-readiness:state-changed', listener),
    },
  };
}
