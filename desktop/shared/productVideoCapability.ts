import { resolveVideoModelRoute } from './videoGenerationCapabilities.ts';

export type ProductVideoMotionCapability = {
    available: boolean;
    model?: string;
    reason?: 'not-configured' | 'reference-images-unsupported';
};

export function resolveProductVideoMotionCapability(settings: Record<string, unknown>): ProductVideoMotionCapability {
    const route = resolveVideoModelRoute(settings);
    if (!route?.provider.endpoint || !route.provider.apiKey || !route.model) {
        return { available: false, reason: 'not-configured' };
    }
    if (!route.capabilities.supportedModes.includes('reference-guided')) {
        return { available: false, model: route.model, reason: 'reference-images-unsupported' };
    }
    return { available: true, model: route.model };
}
