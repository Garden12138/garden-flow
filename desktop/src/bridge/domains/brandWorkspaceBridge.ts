import type { LinkProductsInput, ProductLinkCandidate } from '../../../shared/productLinks';
import type { BridgeCore } from '../types';

export function createBrandWorkspaceBridge(core: BridgeCore) {
  return {
    brandWorkspace: {
      suggestProductLinks: (payload: { productId: string }) => core.invokeChannelGuarded<{ success: boolean; error?: string; productVersion?: string; modelName?: string; candidates?: ProductLinkCandidate[] }>('brand-workspace:suggest-product-links', payload, { timeoutMs: 100_000 }),
      linkProducts: (payload: LinkProductsInput) => core.invokeChannel('brand-workspace:link-products', payload),
      unlinkProducts: (payload: { productId: string; relatedProductId: string }) => core.invokeChannel('brand-workspace:unlink-products', payload),
      list: <T = unknown>() => core.invokeChannel('brand-workspace:list') as Promise<T>,
      get: <T = unknown>(payload: { id: string }) => core.invokeChannel('brand-workspace:get', payload) as Promise<T>,
      getProductCreativeReference: <T = unknown>(payload: { id: string }) => core.invokeChannel('brand-workspace:get-product-creative-reference', payload) as Promise<T>,
      upsertBrand: <T = unknown>(payload: Record<string, unknown>) => core.invokeChannel('brand-workspace:upsert-brand', payload) as Promise<T>,
      upsertProduct: <T = unknown>(payload: Record<string, unknown>) => core.invokeChannel('brand-workspace:upsert-product', payload) as Promise<T>,
      upsertSku: <T = unknown>(payload: Record<string, unknown>) => core.invokeChannel('brand-workspace:upsert-sku', payload) as Promise<T>,
      upsertProductDetailPage: <T = unknown>(payload: Record<string, unknown>) => core.invokeChannel('brand-workspace:upsert-product-detail-page', payload) as Promise<T>,
      deleteProduct: <T = unknown>(payload: { id: string }) => core.invokeChannel('brand-workspace:delete-product', payload) as Promise<T>,
      rebuildAiIndex: <T = unknown>() => core.invokeChannel('brand-workspace:rebuild-ai-index') as Promise<T>,
    },
  };
}
