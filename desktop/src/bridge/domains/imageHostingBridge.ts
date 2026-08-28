import type { BridgeCore } from '../types';

export function createImageHostingBridge(core: BridgeCore) {
  return {
    imageHosting: {
      testUpload: (payload?: { image_hosting_json?: string }) =>
        core.invokeChannel('image-hosting:test-upload', payload || {}),
    },
  };
}
