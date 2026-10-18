/** Local conservative estimate, not the provider's tokenizer or a billing count. */
export function estimateImagePromptTokens(prompt: string): number {
    const parts: string[] = prompt.match(/[\x00-\x7f]+|[^\x00-\x7f]/gu) || [];
    return parts.reduce((sum, part) => sum + (/^[\x00-\x7f]+$/.test(part) ? Math.ceil(part.length / 3) : 2), 0);
}
export interface ImagePromptBudget {
    estimatedTokens: number;
    maxTokens: number;
    safeTokens: number;
    estimator: 'conservative-local-v1';
}
// https://help.aliyun.com/zh/model-studio/qwen-image-edit-api
// The service truncates excess input; reserve 20% for tokenizer differences.
export function imagePromptBudget(template: string | undefined, model: string, prompt: string): ImagePromptBudget | undefined {
    if (template !== 'dashscope-wan-native') return undefined;
    const maxTokens = /^qwen-image-2\.0(?:-|$)/i.test(model) ? 1300 : /^qwen-image-edit(?:-|$)/i.test(model) ? 800 : undefined;
    return maxTokens ? { estimatedTokens: estimateImagePromptTokens(prompt), maxTokens, safeTokens: Math.floor(maxTokens * 0.8), estimator: 'conservative-local-v1' } : undefined;
}
export function assertImagePromptBudget(template: string | undefined, model: string, prompt: string): ImagePromptBudget | undefined {
    const budget = imagePromptBudget(template, model, prompt);
    if (budget && budget.estimatedTokens > budget.safeTokens) throw new Error(`图片指令过长：本地保守估算 ${budget.estimatedTokens} Token，当前安全预算 ${budget.safeTokens}（模型上限 ${budget.maxTokens}，预留分词差异余量）。请缩短画面提示、统一画风或角色／场景说明后重新预览；不会自动截断或提交生成。`);
    return budget;
}
