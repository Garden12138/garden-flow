import type { LlmConnection } from './aiModelRouteResolver.ts';

// Structured suggestion services need the JSON answer rather than a separate
// thinking transcript. Only documented DashScope hybrid models accept this flag.
export function structuredTextProviderOptions(llm: LlmConnection): Record<string, boolean> {
    let hostname: string;
    try { hostname = new URL(llm.baseURL).hostname; } catch { return {}; }
    const dashscope = /^(?:dashscope(?:-intl|-us)?\.aliyuncs\.com)$/.test(hostname);
    const hybridModel = /^qwen3\.8-(?:max(?:-0902|-2026-09-02)?|flash)$/.test(llm.modelName);
    return dashscope && hybridModel ? { enable_thinking: false } : {};
}
