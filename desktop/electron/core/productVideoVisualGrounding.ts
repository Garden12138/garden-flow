import { randomBytes } from 'node:crypto';
import { fetchLlmWithRetry } from './llmFetchRetry.ts';
import { normalizeApiBaseUrl, safeUrlJoin } from './urlUtils.ts';
import type { RuntimeMessageContentPart } from './runtimeTypes.ts';

export type ProductVideoVisualSuitability = 'safe' | 'exclude';

export interface ProductVideoVisualAssetPayload {
    assetId: string;
    role: string;
    origin: string;
    dataUrl: string;
}

export interface ProductVideoVisualAssetInspection {
    assetId: string;
    role: string;
    origin: string;
    description: string;
    visibleText: string[];
    hasPrice: boolean;
    hasPromotion: boolean;
    hasActivityDate: boolean;
    suitability: ProductVideoVisualSuitability;
    reasons: string[];
}

export interface ProductVideoVisualGroundingEvidence {
    status: 'verified';
    verificationId: string;
    modelName: string;
    productId: string;
    productUpdatedAt: string;
    imageCount: number;
    assets: ProductVideoVisualAssetInspection[];
    verifiedAt: string;
}

export interface ProductVideoVisualGroundingRequest {
    apiKey: string;
    baseURL: string;
    modelName: string;
    productId: string;
    productUpdatedAt: string;
    productName: string;
    assets: ProductVideoVisualAssetPayload[];
    verificationToken: string;
    verificationImageDataUrl: string;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    onRetry?: (message: string) => void;
}

type VisualGroundingResponse = {
    verificationToken?: unknown;
    assets?: unknown;
};

const text = (value: unknown): string => String(value || '').trim();

const responseText = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (!Array.isArray(value)) return text(value);
    return value.map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
        return text((item as Record<string, unknown>).text);
    }).join('').trim();
};

const booleanValue = (value: unknown): boolean => (
    value === true || String(value || '').trim().toLowerCase() === 'true'
);

const stringArray = (value: unknown): string[] => (
    Array.isArray(value)
        ? value.map((item) => text(item)).filter(Boolean).slice(0, 20)
        : []
);

const extractJsonObject = (raw: unknown): VisualGroundingResponse | null => {
    const value = responseText(raw);
    if (!value) return null;
    const candidates = [
        value,
        value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || '',
        (() => {
            const first = value.indexOf('{');
            const last = value.lastIndexOf('}');
            return first >= 0 && last > first ? value.slice(first, last + 1) : '';
        })(),
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as VisualGroundingResponse;
            }
        } catch {
            // Try the next representation.
        }
    }
    return null;
};

export const createProductVideoVisualVerificationToken = (): string => (
    `GF-${randomBytes(6).toString('hex').toUpperCase()}`
);

export function buildProductVideoVisualGroundingMessages(input: {
    productName: string;
    assets: ProductVideoVisualAssetPayload[];
    verificationImageDataUrl: string;
}): Array<{ role: 'system' | 'user'; content: string | RuntimeMessageContentPart[] }> {
    const content: RuntimeMessageContentPart[] = [{
        type: 'text',
        text: [
            '<product_asset_visuals>',
            `商品：${input.productName}`,
            `图片数量：${input.assets.length}`,
            '你必须逐张查看图片，不能根据文件名、商品 JSON 或常识猜测。',
            '识别每张图的实际画面、可见文字，以及是否包含价格、优惠券/补贴/赠品等促销信息或活动日期。',
            '任何包含价格、促销或活动日期的图片，suitability 必须是 exclude。',
            '最后一张是视觉通道校验图。只从该图片中读取 verificationToken；该值没有出现在文字提示中。',
            '</product_asset_visuals>',
        ].join('\n'),
    }];
    for (const [index, asset] of input.assets.entries()) {
        content.push({
            type: 'text',
            text: `待分析商品素材 ${index + 1}/${input.assets.length}: assetId=${asset.assetId} role=${asset.role} origin=${asset.origin}`,
        });
        content.push({ type: 'image_url', image_url: { url: asset.dataUrl } });
    }
    content.push({
        type: 'text',
        text: '视觉通道校验图如下。请读取图中完整的 verificationToken。',
    });
    content.push({ type: 'image_url', image_url: { url: input.verificationImageDataUrl } });

    return [
        {
            role: 'system',
            content: [
                '你是商品图片视觉检查器。只报告图片中实际可见的内容。',
                '只输出严格 JSON，不要输出 Markdown 或解释。',
                'JSON 格式：',
                '{"verificationToken":"从校验图读取的字符串","assets":[{"assetId":"...","description":"实际画面描述","visibleText":["实际可见文字"],"hasPrice":false,"hasPromotion":false,"hasActivityDate":false,"suitability":"safe|exclude","reasons":[]}]}',
                'assets 必须覆盖输入中的每个 assetId，且每个只出现一次。',
            ].join('\n'),
        },
        { role: 'user', content },
    ];
}

export function parseProductVideoVisualGroundingResponse(input: {
    rawContent: unknown;
    expectedAssets: Array<{ assetId: string; role: string; origin: string }>;
    expectedVerificationToken: string;
    modelName: string;
    productId?: string;
    productUpdatedAt?: string;
    now?: string;
}): ProductVideoVisualGroundingEvidence {
    const parsed = extractJsonObject(input.rawContent);
    if (!parsed) {
        throw new Error('视觉模型没有返回可解析的结构化图片分析。');
    }
    if (text(parsed.verificationToken) !== input.expectedVerificationToken) {
        throw new Error('视觉通道校验失败：模型未正确读取校验图片。');
    }
    if (!Array.isArray(parsed.assets)) {
        throw new Error('视觉模型返回结果缺少 assets。');
    }

    const expectedById = new Map(input.expectedAssets.map((asset) => [asset.assetId, asset]));
    const seen = new Set<string>();
    const inspections: ProductVideoVisualAssetInspection[] = [];
    for (const item of parsed.assets) {
        const record = item && typeof item === 'object' && !Array.isArray(item)
            ? item as Record<string, unknown>
            : {};
        const assetId = text(record.assetId);
        const expected = expectedById.get(assetId);
        if (!expected || seen.has(assetId)) continue;
        const description = text(record.description);
        if (description.length < 4) {
            throw new Error(`视觉模型没有描述商品素材：${assetId}`);
        }
        const visibleText = stringArray(record.visibleText).map((value) => value.slice(0, 240));
        const searchableVisualText = [description, ...visibleText].join(' ');
        const hasPrice = booleanValue(record.hasPrice)
            || /(?:[¥￥]\s*\d|\d+(?:\.\d+)?\s*元|到手价|券后价|售价|价格)/i.test(searchableVisualText);
        const hasPromotion = booleanValue(record.hasPromotion)
            || /(?:优惠券|补贴|满减|赠品|赠完|秒杀|限时|活动|促销|e\s*卡|到手价|券后)/i.test(searchableVisualText);
        const hasActivityDate = booleanValue(record.hasActivityDate)
            || /(?:\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}[./-]\d{1,2}\s*(?:-|至|到)\s*\d{1,2}[./-]\d{1,2})/i.test(searchableVisualText);
        const forcedExclude = hasPrice || hasPromotion || hasActivityDate;
        inspections.push({
            assetId,
            role: expected.role,
            origin: expected.origin,
            description: description.slice(0, 1200),
            visibleText,
            hasPrice,
            hasPromotion,
            hasActivityDate,
            suitability: forcedExclude || text(record.suitability).toLowerCase() === 'exclude'
                ? 'exclude'
                : 'safe',
            reasons: [
                ...stringArray(record.reasons).map((value) => value.slice(0, 240)),
                ...(hasPrice ? ['识别到价格信息'] : []),
                ...(hasPromotion ? ['识别到促销信息'] : []),
                ...(hasActivityDate ? ['识别到活动日期'] : []),
            ].filter((value, index, values) => values.indexOf(value) === index),
        });
        seen.add(assetId);
    }

    const missing = input.expectedAssets.map((asset) => asset.assetId).filter((assetId) => !seen.has(assetId));
    if (missing.length > 0) {
        throw new Error(`视觉模型未完成全部商品素材分析：${missing.join(', ')}`);
    }

    return {
        status: 'verified',
        verificationId: `visual-${input.expectedVerificationToken.slice(3).toLowerCase()}`,
        modelName: input.modelName,
        productId: text(input.productId),
        productUpdatedAt: text(input.productUpdatedAt),
        imageCount: input.expectedAssets.length,
        assets: inspections,
        verifiedAt: input.now || new Date().toISOString(),
    };
}

export function buildVerifiedProductAssetAnalysisText(evidence: ProductVideoVisualGroundingEvidence): string {
    const lines = evidence.assets.map((asset, index) => [
        `${index + 1}. assetId=${asset.assetId} role=${asset.role} origin=${asset.origin}`,
        `   画面：${asset.description}`,
        asset.visibleText.length > 0 ? `   可见文字：${asset.visibleText.join(' / ')}` : '   可见文字：未识别到',
        `   素材结论：${asset.suitability}${asset.reasons.length > 0 ? `（${asset.reasons.join('；')}）` : ''}`,
    ].join('\n'));
    return [
        '<verified_product_asset_analysis>',
        `视觉校验：verified；模型：${evidence.modelName}；素材数：${evidence.imageCount}`,
        '优先选择 suitability=safe 的素材。exclude 表示视觉模型发现了价格、促销或活动日期风险，但可能误判；如画面确实适合分镜，可以使用，提交确认卡时必须提示用户结合真实缩略图核对。',
        '图片可见文字/OCR 可以辅助拟稿，但不自动等同于结构化商品事实；据此拟定的屏幕文案必须作为非阻断风险交给用户核对，不要因为存在风险而停止提交确认卡。',
        ...lines,
        '</verified_product_asset_analysis>',
    ].join('\n');
}

export function summarizeProductVideoRuntimeVisualInput(input: {
    content?: string | RuntimeMessageContentPart[];
    evidence?: ProductVideoVisualGroundingEvidence | null;
}): {
    contentKind: 'text' | 'multimodal';
    imagePartCount: number;
    hasVisualMarker: boolean;
    groundingStatus: 'missing' | 'verified';
    verificationId?: string;
    assetIds: string[];
} {
    const parts = Array.isArray(input.content) ? input.content : [];
    const combinedText = parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
    return {
        contentKind: Array.isArray(input.content) ? 'multimodal' : 'text',
        imagePartCount: parts.filter((part) => part.type === 'image_url').length,
        hasVisualMarker: combinedText.includes('<product_asset_visuals>')
            && combinedText.includes('<verified_product_asset_analysis>'),
        groundingStatus: input.evidence?.status === 'verified' ? 'verified' : 'missing',
        verificationId: input.evidence?.verificationId,
        assetIds: input.evidence?.assets.map((asset) => asset.assetId) || [],
    };
}

export function assertProductVideoRuntimeVisualInput(input: {
    content?: string | RuntimeMessageContentPart[];
    evidence?: ProductVideoVisualGroundingEvidence | null;
}): ReturnType<typeof summarizeProductVideoRuntimeVisualInput> {
    const summary = summarizeProductVideoRuntimeVisualInput(input);
    const combinedText = Array.isArray(input.content)
        ? input.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
        : '';
    const missingAssetMarkers = summary.assetIds.filter((assetId) => !combinedText.includes(`assetId=${assetId}`));
    if (
        summary.contentKind !== 'multimodal'
        || !summary.hasVisualMarker
        || summary.groundingStatus !== 'verified'
        || summary.imagePartCount < Math.max(1, input.evidence?.imageCount || 0)
        || summary.assetIds.length < 1
        || missingAssetMarkers.length > 0
    ) {
        throw new Error('商品视频视觉输入未通过运行时校验，已阻止在看不到商品图片时生成分镜。');
    }
    return summary;
}

export async function requestProductVideoVisualGrounding(
    input: ProductVideoVisualGroundingRequest,
): Promise<ProductVideoVisualGroundingEvidence> {
    const messages = buildProductVideoVisualGroundingMessages(input);
    const response = await fetchLlmWithRetry(
        safeUrlJoin(normalizeApiBaseUrl(input.baseURL), '/chat/completions'),
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${input.apiKey}`,
            },
            signal: input.signal,
            body: JSON.stringify({
                model: input.modelName,
                temperature: 0,
                messages,
            }),
        },
        {
            maxAttempts: 2,
            baseDelayMs: 600,
            maxDelayMs: 3000,
            fetchImpl: input.fetchImpl,
            onRetry: ({ attempt, maxAttempts, reason }) => {
                input.onRetry?.(`商品图片理解连接失败，正在重试（${attempt + 1}/${maxAttempts}）：${reason}`);
            },
        },
    );
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`商品图片理解请求失败（${response.status}）：${errorText || response.statusText}`);
    }
    const payload = await response.json().catch(() => ({})) as {
        choices?: Array<{ message?: { content?: unknown } }>;
    };
    return parseProductVideoVisualGroundingResponse({
        rawContent: payload.choices?.[0]?.message?.content,
        expectedAssets: input.assets,
        expectedVerificationToken: input.verificationToken,
        modelName: input.modelName,
        productId: input.productId,
        productUpdatedAt: input.productUpdatedAt,
    });
}
