import { QWEN_IMAGE_STUDIO } from './qwenImageStudio.ts';

export function imageRoutingForPreset(presetId: string): { provider: string; providerTemplate: string } {
    const preset = presetId.trim().toLowerCase();
    if (preset === 'xcli') return { provider: 'xcli', providerTemplate: 'openai-images' };
    if (preset === QWEN_IMAGE_STUDIO) return { provider: QWEN_IMAGE_STUDIO, providerTemplate: QWEN_IMAGE_STUDIO };
    if (preset.includes('dashscope') || preset.includes('qwen') || preset === 'buts') {
        return { provider: 'dashscope', providerTemplate: 'dashscope-wan-native' };
    }
    if (preset.includes('jimeng')) return { provider: 'jimeng', providerTemplate: 'jimeng-openai-wrapper' };
    if (preset.includes('ark')) return { provider: 'ark-seedream', providerTemplate: 'ark-seedream-native' };
    if (preset.includes('gemini')) return { provider: 'gemini', providerTemplate: 'gemini-openai-images' };
    return { provider: 'openai-compatible', providerTemplate: 'openai-images' };
}
