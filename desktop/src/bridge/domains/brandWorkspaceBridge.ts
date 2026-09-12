import type { BridgeCore } from '../types';

export function createBrandWorkspaceBridge(core: BridgeCore) {
  return {
    brandWorkspace: {
      list: <T = unknown>() => core.invokeChannel('brand-workspace:list') as Promise<T>,
      get: <T = unknown>(payload: { id: string }) => core.invokeChannel('brand-workspace:get', payload) as Promise<T>,
      upsertBrand: <T = unknown>(payload: Record<string, unknown>) => core.invokeChannel('brand-workspace:upsert-brand', payload) as Promise<T>,
      upsertProduct: <T = unknown>(payload: Record<string, unknown>) => core.invokeChannel('brand-workspace:upsert-product', payload) as Promise<T>,
      upsertSku: <T = unknown>(payload: Record<string, unknown>) => core.invokeChannel('brand-workspace:upsert-sku', payload) as Promise<T>,
      upsertProductDetailPage: <T = unknown>(payload: Record<string, unknown>) => core.invokeChannel('brand-workspace:upsert-product-detail-page', payload) as Promise<T>,
      rebuildAiIndex: <T = unknown>() => core.invokeChannel('brand-workspace:rebuild-ai-index') as Promise<T>,
    },
  };
}
