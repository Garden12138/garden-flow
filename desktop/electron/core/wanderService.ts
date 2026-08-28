import path from 'node:path';
import fs from 'node:fs/promises';
import {
    addChatMessage,
    createChatSession,
    getChatMessages,
    getChatSession,
    getSettings,
    getWorkspacePaths,
    saveWanderHistory,
    updateChatSessionMetadata,
} from '../db';
import { getAllKnowledgeItems, type WanderItem } from './knowledgeLoader';
import { resolveScopedModelName } from './modelScopeSettings';
import { normalizeApiBaseUrl, safeUrlJoin } from './urlUtils';
import { PiChatService } from '../pi/PiChatService';
import { getSubject, listSubjectCategories } from './subjectsLibraryStore';
import { getAbsoluteMediaPath, listMediaAssets } from './mediaLibraryStore';
import { toAppAssetUrl } from './localAssetManager';
import {
    buildWanderAgentPrompt,
    listCommentCandidatesFromItems,
    listInspirationCandidates,
    normalizeWanderSourceMode,
    normalizeWanderStructuredResult,
    parseWanderJsonPayload,
    pickRandomWanderItems,
    validateWanderStructuredResult,
    type WanderSourceMode,
    type WanderStructuredResult,
    type WanderSubjectRef,
    type WanderValidationIssue,
} from './wanderDomain';

export type WanderRunOptions = {
    items?: WanderItem[];
    count?: number;
    multiChoice?: boolean;
    deepThink?: boolean;
    requestId?: string;
    sourceMode?: string;
    subjectIds?: string[];
    persistHistory?: boolean;
    reportProgress?: (status: string) => void;
};

export type WanderRunResult = {
    requestId: string;
    items: WanderItem[];
    result: WanderStructuredResult;
    rawResult: string;
    sourceMode: WanderSourceMode;
    subjectRefs: WanderSubjectRef[];
    validationIssues: WanderValidationIssue[];
    historyId?: string;
};

const WANDER_SUBJECT_CATEGORY_NAMES = new Set(['品牌', '角色', '物品', '商品', '场景']);

export async function getRandomWanderItems(count = 3): Promise<WanderItem[]> {
    const items = listInspirationCandidates(await getAllKnowledgeItems());
    return pickRandomWanderItems(items, count) as WanderItem[];
}

export async function listWanderCommentCandidates(): Promise<WanderItem[]> {
    return listCommentCandidatesFromItems(await getAllKnowledgeItems()) as WanderItem[];
}

async function resolveWanderSubjectRefs(subjectIds: string[] = []): Promise<WanderSubjectRef[]> {
    const normalizedIds = Array.from(new Set(subjectIds.map((id) => String(id || '').trim()).filter(Boolean)));
    if (normalizedIds.length > 3) {
        throw new Error('一次选题最多选择 3 个资产约束');
    }
    if (normalizedIds.length === 0) return [];
    const [categories, mediaAssets] = await Promise.all([
        listSubjectCategories(),
        listMediaAssets(5000),
    ]);
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
    const mediaById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
    return Promise.all(normalizedIds.map(async (id) => {
        let subject: Awaited<ReturnType<typeof getSubject>> | null = null;
        try {
            subject = await getSubject(id);
        } catch {
            subject = null;
        }
        if (subject) {
            const categoryName = subject.categoryId ? categoryNames.get(subject.categoryId) : undefined;
            if (!categoryName || !WANDER_SUBJECT_CATEGORY_NAMES.has(categoryName)) {
                throw new Error(`选题资产仅支持品牌、角色、物品、商品、场景或媒体：${subject.name}`);
            }
            return {
                id: subject.id,
                name: subject.name,
                categoryId: subject.categoryId,
                categoryName,
                description: subject.description,
                tags: Array.isArray(subject.tags) ? subject.tags : [],
                attributes: Array.isArray(subject.attributes) ? subject.attributes : [],
                primaryPreviewUrl: subject.primaryPreviewUrl,
            } satisfies WanderSubjectRef;
        }
        const media = mediaById.get(id);
        if (media) {
            const mediaName = String(media.title || media.projectId || '').trim() || `媒体素材 ${media.id.slice(-8)}`;
            const attributes = [
                { key: '来源', value: media.source },
                { key: '媒体类型', value: String(media.mimeType || '').trim() },
                { key: '模型', value: String(media.model || '').trim() },
                { key: '画幅', value: String(media.aspectRatio || '').trim() },
                { key: '关联稿件', value: String(media.boundManuscriptPath || '').trim() },
            ].filter((item) => item.value);
            return {
                id: media.id,
                name: mediaName,
                categoryName: '媒体',
                description: String(media.prompt || '').trim() || undefined,
                tags: ['媒体', media.source, String(media.mimeType || '').trim()].filter(Boolean),
                attributes,
                primaryPreviewUrl: media.relativePath ? toAppAssetUrl(getAbsoluteMediaPath(media.relativePath)) : undefined,
            } satisfies WanderSubjectRef;
        }
        throw new Error(`所选资产不存在或已失效：${id}`);
    }));
}

function buildWanderItemsText(items: WanderItem[]): string {
    return items.map((item, index) => (
        `Item ${index + 1}:
Title: ${item.title}
Type: ${item.type}
Content Summary: ${item.content?.slice(0, 500) || ''}...`
    )).join('\n\n');
}

async function readTextFileSnippet(filePath: string, maxChars = 1800): Promise<string> {
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        return String(raw || '').trim().slice(0, maxChars);
    } catch {
        return '';
    }
}

function toTwoLinePreview(raw: string): string {
    const normalized = String(raw || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
    if (!normalized) return '';
    const lines = normalized
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    if (!lines.length) return '';
    const picked = lines.slice(0, 2).map((line) => (line.length > 120 ? `${line.slice(0, 120)}…` : line));
    const hasMore = lines.length > 2 || picked.some((line) => line.endsWith('…'));
    const joined = picked.join('\n');
    return hasMore && !joined.endsWith('…') ? `${joined}…` : joined;
}

async function buildWanderLongTermContext(): Promise<string> {
    const workspacePaths = getWorkspacePaths();
    const profileRoot = path.join(workspacePaths.redclaw, 'profile');
    const memoryPath = path.join(workspacePaths.base, 'memory', 'MEMORY.md');
    const userProfilePath = path.join(profileRoot, 'user.md');
    const creatorProfilePath = path.join(profileRoot, 'CreatorProfile.md');
    const soulPath = path.join(profileRoot, 'Soul.md');

    const [memorySnippet, userProfileSnippet, creatorProfileSnippet, soulSnippet] = await Promise.all([
        readTextFileSnippet(memoryPath, 2200),
        readTextFileSnippet(userProfilePath, 1800),
        readTextFileSnippet(creatorProfilePath, 2200),
        readTextFileSnippet(soulPath, 1200),
    ]);

    const sections: string[] = [];
    if (userProfileSnippet) sections.push(`### user.md\n${userProfileSnippet}`);
    if (creatorProfileSnippet) sections.push(`### CreatorProfile.md\n${creatorProfileSnippet}`);
    if (memorySnippet) sections.push(`### MEMORY.md\n${memorySnippet}`);
    if (soulSnippet) sections.push(`### Soul.md\n${soulSnippet}`);
    return sections.join('\n\n');
}

async function runWanderDeepThinkWithAgent(params: {
    requestId: string;
    items: WanderItem[];
    longTermContextSection: string;
    multiChoice: boolean;
    sourceMode: WanderSourceMode;
    subjectRefs: WanderSubjectRef[];
    reportProgress?: (status: string) => void;
}): Promise<string> {
    const safeRequestId = params.requestId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || `${Date.now()}`;
    const sessionId = `session_wander_${safeRequestId}`;
    const contextId = `wander:${safeRequestId}`;
    const itemsText = buildWanderItemsText(params.items);
    const prompt = buildWanderAgentPrompt({
        sourceMode: params.sourceMode,
        items: params.items,
        subjects: params.subjectRefs,
        longTermContext: params.longTermContextSection,
        multiChoice: params.multiChoice,
    });

    const existingSession = getChatSession(sessionId);
    const metadata = {
        contextId,
        contextType: 'redclaw',
        contextContent: itemsText,
        isContextBound: true,
    };
    if (!existingSession) {
        createChatSession(sessionId, 'Wander Deep Think', metadata);
    } else {
        updateChatSessionMetadata(sessionId, {
            ...(existingSession.metadata ? (() => {
                try {
                    return JSON.parse(existingSession.metadata);
                } catch {
                    return {};
                }
            })() : {}),
            ...metadata,
        });
    }

    const service = new PiChatService();
    let responseBuffer = '';
    let lastPreview = '';
    let lastToolName = '';
    let upstreamError = '';
    let sawAnyToolCall = false;
    let toolCallCount = 0;
    const startedAt = Date.now();
    params.reportProgress?.(params.sourceMode === 'comment_insight'
        ? '评论区洞察 Agent 已启动...'
        : params.multiChoice
            ? '多选题 Agent 已启动...'
            : '灵感漫步 Agent 已启动...');

    addChatMessage({
        id: `msg_wander_user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        session_id: sessionId,
        role: 'user',
        content: prompt,
    });

    const emitPreview = (raw: string) => {
        const preview = toTwoLinePreview(raw);
        if (!preview || preview === lastPreview) return;
        lastPreview = preview;
        params.reportProgress?.(preview);
    };

    service.setEventSink((channel, payload) => {
        if (channel === 'chat:thought-delta') {
            const text = String((payload as { content?: unknown } | null)?.content || '').trim();
            if (text) emitPreview(text);
            return;
        }
        if (channel === 'chat:tool-start') {
            const toolName = String((payload as { name?: unknown } | null)?.name || '').trim();
            sawAnyToolCall = true;
            toolCallCount += 1;
            lastToolName = toolName;
            if (toolName) params.reportProgress?.(`调用工具：${toolName}`);
            return;
        }
        if (channel === 'chat:tool-update') {
            const partial = String((payload as { partial?: unknown } | null)?.partial || '').trim();
            if (partial) emitPreview(partial);
            return;
        }
        if (channel === 'chat:tool-end') {
            if (lastToolName) params.reportProgress?.(`工具完成：${lastToolName}`);
            return;
        }
        if (channel === 'chat:response-chunk') {
            const chunk = String((payload as { content?: unknown } | null)?.content || '');
            if (!chunk) return;
            responseBuffer += chunk;
            emitPreview(responseBuffer);
            return;
        }
        if (channel === 'chat:error') {
            const data = payload as { message?: unknown; hint?: unknown; raw?: unknown } | null;
            const message = String(data?.message || '').trim();
            const hint = String(data?.hint || '').trim();
            const raw = String(data?.raw || '').trim();
            upstreamError = [message, hint, raw].filter(Boolean).join(' | ').slice(0, 2000);
            if (upstreamError) params.reportProgress?.(upstreamError);
        }
    });

    try {
        await service.sendMessage(prompt, sessionId);
        if (!sawAnyToolCall) {
            const retryPrompt = [
                '你上一轮没有调用工具，这不符合要求。',
                '请先调用至少 1 次工具（优先 app_cli）读取素材或文档，再重新输出最终 JSON。',
                '注意：最终回复仍然只能是 JSON。',
            ].join('\n');
            params.reportProgress?.('检测到未调用工具，正在触发强制工具轮次...');
            addChatMessage({
                id: `msg_wander_user_retry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                session_id: sessionId,
                role: 'user',
                content: retryPrompt,
            });
            await service.sendMessage(retryPrompt, sessionId);
        }
    } finally {
        service.setEventSink(null);
    }

    const assistantMessages = getChatMessages(sessionId)
        .filter((msg) => msg.role === 'assistant' && Number(msg.timestamp || 0) >= startedAt)
        .map((msg) => String(msg.content || '').trim())
        .filter(Boolean);
    const finalContent = assistantMessages.length > 0
        ? assistantMessages[assistantMessages.length - 1]
        : String(responseBuffer || '').trim();
    if (!finalContent) {
        if (upstreamError) throw new Error(upstreamError);
        throw new Error('深度思考未返回有效内容');
    }
    console.log('[wander:brainstorm][agent-mode] completed', {
        requestId: params.requestId,
        toolCallCount,
        sawAnyToolCall,
        responseLength: finalContent.length,
    });
    return finalContent;
}

async function requestWanderCompletion(params: {
    baseURL: string;
    apiKey: string;
    model: string;
    temperature: number;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    requireJson?: boolean;
    allowJsonFallback?: boolean;
    enableThinking?: boolean;
    timeoutMs?: number;
    retryOnTimeout?: boolean;
    retryTimeoutMs?: number;
    streamPreview?: boolean;
    onProgress?: (previewText: string) => void;
}): Promise<string> {
    const sendRequest = async (withResponseFormat: boolean, effectiveTimeoutMs: number, useStream: boolean) => {
        const startedAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
        const lower = `${params.model} ${params.baseURL}`.toLowerCase();
        const isQwenFamily = lower.includes('qwen') || lower.includes('dashscope.aliyuncs.com');
        const payload = {
            model: params.model,
            temperature: params.temperature,
            messages: params.messages,
            response_format: withResponseFormat ? { type: 'json_object' } : undefined,
            stream: useStream ? true : undefined,
            enable_thinking: isQwenFamily && typeof params.enableThinking === 'boolean' ? params.enableThinking : undefined,
        };

        const response = await fetch(safeUrlJoin(params.baseURL, '/chat/completions'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${params.apiKey}`,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        }).catch((error) => {
            clearTimeout(timeout);
            if (controller.signal.aborted) {
                throw new Error(`OpenAI API timeout after ${effectiveTimeoutMs}ms`);
            }
            throw error;
        });
        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
        }

        if (useStream) {
            if (!response.body) {
                throw new Error('OpenAI API stream response body is empty');
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffered = '';
            let assembled = '';
            let lastEmitAt = 0;
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffered += decoder.decode(value, { stream: true });
                const lines = buffered.split('\n');
                buffered = lines.pop() || '';
                for (const lineRaw of lines) {
                    const line = lineRaw.trim();
                    if (!line.startsWith('data:')) continue;
                    const chunk = line.slice(5).trim();
                    if (!chunk || chunk === '[DONE]') continue;
                    let parsed: any = null;
                    try {
                        parsed = JSON.parse(chunk);
                    } catch {
                        continue;
                    }
                    const delta = parsed?.choices?.[0]?.delta;
                    const content = typeof delta?.content === 'string'
                        ? delta.content
                        : Array.isArray(delta?.content)
                            ? delta.content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('')
                            : '';
                    if (!content) continue;
                    assembled += content;
                    const now = Date.now();
                    if (now - lastEmitAt > 280) {
                        lastEmitAt = now;
                        const preview = toTwoLinePreview(assembled);
                        if (preview) params.onProgress?.(preview);
                    }
                }
            }
            const finalPreview = toTwoLinePreview(assembled);
            if (finalPreview) params.onProgress?.(finalPreview);
            return assembled;
        }

        const data = await response.json() as { choices?: { message?: { content?: string } }[] };
        return data.choices?.[0]?.message?.content || '';
    };

    try {
        return await sendRequest(Boolean(params.requireJson), params.timeoutMs || 90000, Boolean(params.streamPreview));
    } catch (error) {
        const errorMessage = String(error || '');
        const timeoutMs = params.timeoutMs || 90000;
        const isTimeout = /timeout after \d+ms/i.test(errorMessage);
        const isResponseFormatUnsupported = /response[_\s-]?format|json_object|unsupported|not supported|invalid parameter/i.test(errorMessage);
        if (params.retryOnTimeout !== false && isTimeout) {
            const nextTimeoutMs = Math.max(params.retryTimeoutMs || timeoutMs, timeoutMs + 45000);
            return await sendRequest(Boolean(params.requireJson), nextTimeoutMs, Boolean(params.streamPreview));
        }
        if (params.requireJson && params.allowJsonFallback !== false && isResponseFormatUnsupported) {
            return await sendRequest(false, timeoutMs, Boolean(params.streamPreview));
        }
        if (params.streamPreview && /stream|sse|event-stream|not supported|invalid parameter/i.test(errorMessage)) {
            return await sendRequest(Boolean(params.requireJson), timeoutMs, false);
        }
        throw error;
    }
}

export async function runWanderBrainstorm(options: WanderRunOptions = {}): Promise<WanderRunResult> {
    const requestId = String(options.requestId || '').trim() || `wander-${Date.now()}`;
    const reportProgress = options.reportProgress;
    const sourceMode = normalizeWanderSourceMode(options.sourceMode);
    reportProgress?.(sourceMode === 'comment_insight' ? '正在初始化评论区洞察...' : '正在初始化灵感漫步...');

    const settings = getSettings() as {
        api_key?: string;
        api_endpoint?: string;
        model_name?: string;
        model_name_wander?: string;
        wander_deep_think_enabled?: boolean;
    } | undefined;
    if (!settings?.api_key) {
        throw new Error('API Key not configured');
    }

    const subjectRefs = await resolveWanderSubjectRefs(options.subjectIds);
    const requestedItems = Array.isArray(options.items) ? options.items : [];
    let items: WanderItem[];
    if (sourceMode === 'comment_insight') {
        const candidates = requestedItems.length > 0
            ? listCommentCandidatesFromItems(requestedItems)
            : await listWanderCommentCandidates();
        if (candidates.length === 0) {
            throw new Error('知识库中没有可用评论，请先通过浏览器插件采集小红书评论');
        }
        items = (requestedItems.length > 0 ? candidates.slice(0, 1) : pickRandomWanderItems(candidates, 1)) as WanderItem[];
    } else {
        const candidates = requestedItems.length > 0
            ? listInspirationCandidates(requestedItems)
            : await getRandomWanderItems(options.count || 3);
        if (candidates.length < 3) {
            throw new Error('可用于灵感漫步的普通知识素材不足 3 条，请先采集更多内容');
        }
        items = candidates.slice(0, 3) as WanderItem[];
    }
    const baseURL = normalizeApiBaseUrl(settings.api_endpoint || 'https://api.openai.com/v1', 'https://api.openai.com/v1');
    const model = resolveScopedModelName((settings || {}) as Record<string, unknown>, 'wander', 'gpt-4o');
    const multiChoice = sourceMode === 'comment_insight'
        ? false
        : typeof options.multiChoice === 'boolean'
        ? options.multiChoice
        : typeof options.deepThink === 'boolean'
            ? options.deepThink
            : Boolean(settings.wander_deep_think_enabled);

    reportProgress?.(`已准备模型与参数（${model}）`);
    reportProgress?.(sourceMode === 'comment_insight'
        ? `已装载 1 组评论素材${subjectRefs.length > 0 ? `和 ${subjectRefs.length} 个资产约束` : ''}`
        : `已装载 ${items.length} 条知识素材${subjectRefs.length > 0 ? `和 ${subjectRefs.length} 个资产约束` : ''}`);
    reportProgress?.('正在加载用户档案与长期记忆...');

    const longTermContext = await buildWanderLongTermContext();
    const longTermContextSection = longTermContext
        ? `\n\n## 用户长期上下文（供你参考）\n${longTermContext}\n\n使用要求：\n- 与长期定位保持一致；\n- 若素材与长期定位冲突，优先选择可落地、可执行的方向。`
        : '';

    let rawResult = '';
    if (options.deepThink !== false) {
        rawResult = await runWanderDeepThinkWithAgent({
            requestId,
            items,
            longTermContextSection,
            multiChoice,
            sourceMode,
            subjectRefs,
            reportProgress,
        });
    } else {
        const directPrompt = buildWanderAgentPrompt({
            sourceMode,
            items,
            subjects: subjectRefs,
            longTermContext: longTermContextSection,
            multiChoice,
            requireToolCall: false,
        });
        rawResult = await requestWanderCompletion({
            baseURL,
            apiKey: settings.api_key,
            model,
            temperature: 0.8,
            messages: [
                { role: 'system', content: sourceMode === 'comment_insight' ? '你是评论区洞察选题 Agent。' : '你是灵感漫步选题 Agent。' },
                { role: 'user', content: directPrompt },
            ],
            requireJson: true,
            allowJsonFallback: true,
            enableThinking: false,
            streamPreview: true,
            onProgress: reportProgress,
        });
    }

    reportProgress?.('正在解析并校验选题结果...');
    const parsedPayload = parseWanderJsonPayload(rawResult);
    let result = normalizeWanderStructuredResult(parsedPayload || { content_direction: rawResult }, sourceMode, multiChoice);
    let validationIssues = validateWanderStructuredResult(result, multiChoice, subjectRefs.map((subject) => subject.id));
    if (validationIssues.length > 0) {
        reportProgress?.('结果字段不完整，正在自动修复一次...');
        const repairPrompt = buildWanderAgentPrompt({
            sourceMode,
            items,
            subjects: subjectRefs,
            longTermContext: longTermContextSection,
            multiChoice,
            requireToolCall: false,
        });
        const repairedRaw = await requestWanderCompletion({
            baseURL,
            apiKey: settings.api_key,
            model,
            temperature: 0.2,
            messages: [
                { role: 'system', content: '你负责修复选题 JSON。只能输出满足要求的完整 JSON，不要解释。' },
                {
                    role: 'user',
                    content: [
                        repairPrompt,
                        '',
                        `校验问题：${validationIssues.map((issue) => issue.message).join('；')}`,
                        '',
                        '上一版输出：',
                        rawResult,
                    ].join('\n'),
                },
            ],
            requireJson: true,
            allowJsonFallback: true,
            enableThinking: false,
            retryOnTimeout: false,
        });
        const repairedPayload = parseWanderJsonPayload(repairedRaw);
        result = normalizeWanderStructuredResult(repairedPayload || { content_direction: repairedRaw }, sourceMode, multiChoice);
        validationIssues = validateWanderStructuredResult(result, multiChoice, subjectRefs.map((subject) => subject.id));
        rawResult = repairedRaw;
    }

    let historyId: string | undefined;
    if (validationIssues.length > 0) {
        result.validation_issues = validationIssues;
    }
    if (options.persistHistory !== false) {
        historyId = `wander-${Date.now()}`;
        saveWanderHistory(historyId, items, result, {
            sourceMode,
            subjectRefs,
        });
    }
    reportProgress?.(validationIssues.length > 0
        ? '选题结果格式校验失败'
        : sourceMode === 'comment_insight'
            ? '评论区洞察完成'
            : '灵感漫步完成');

    return {
        requestId,
        items,
        result,
        rawResult,
        sourceMode,
        subjectRefs,
        validationIssues,
        historyId,
    };
}
