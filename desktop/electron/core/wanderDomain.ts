export type WanderSourceMode = 'inspiration' | 'comment_insight';

export interface WanderDomainItem {
    id: string;
    type: 'note' | 'video';
    title: string;
    content: string;
    cover?: string;
    meta?: Record<string, unknown>;
}

export interface WanderSubjectRef {
    id: string;
    name: string;
    categoryId?: string;
    categoryName?: string;
    description?: string;
    tags: string[];
    attributes: Array<{ key: string; value: string }>;
    primaryPreviewUrl?: string;
}

export interface WanderEvaluation {
    heat: number;
    freshness: number;
    writability: number;
    fit: number;
    overall: number;
    rationale?: string;
}

export interface WanderDirectionFrame {
    target_reader: string;
    core_tension: string;
    angle: string;
    material_entry: string;
}

export interface WanderCommentInsight {
    questions: string[];
    pain_points: string[];
    objections: string[];
    demand_signals: string[];
    opportunity: string;
}

export interface WanderTopicOption {
    content_direction: string;
    direction_frame: WanderDirectionFrame;
    topic: {
        title: string;
        connections: number[];
    };
    evaluation?: WanderEvaluation;
}

export interface WanderStructuredResult extends WanderTopicOption {
    source_mode: WanderSourceMode;
    thinking_process: string[];
    options?: WanderTopicOption[];
    selected_index?: number;
    comment_insight?: WanderCommentInsight;
    subject_alignment?: Array<{ id: string; usage: string }>;
    validation_issues?: WanderValidationIssue[];
}

export interface WanderValidationIssue {
    path: string;
    code: string;
    message: string;
}

function text(value: unknown): string {
    return String(value || '').trim();
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function stringList(value: unknown, limit = 8): string[] {
    const values = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(/\r?\n+/)
            : [];
    return values
        .map((item) => text(item))
        .filter(Boolean)
        .slice(0, limit);
}

function boundedScore(value: unknown): number | null {
    const score = Number(value);
    if (!Number.isFinite(score)) return null;
    return Math.max(0, Math.min(100, Math.round(score)));
}

export function normalizeWanderSourceMode(value: unknown): WanderSourceMode {
    const normalized = text(value).toLowerCase();
    if (normalized === 'comments' || normalized === 'comment' || normalized === 'comment_insight') {
        return 'comment_insight';
    }
    return 'inspiration';
}

export function parseWanderJsonPayload(raw: string): Record<string, unknown> | null {
    const normalized = text(raw);
    if (!normalized) return null;
    const candidates = [
        normalized,
        normalized.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || '',
    ];
    const firstBrace = normalized.indexOf('{');
    const lastBrace = normalized.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        candidates.push(normalized.slice(firstBrace, lastBrace + 1));
    }
    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // Try the next representation of the model response.
        }
    }
    return null;
}

export function isCommentOnlyWanderItem(item: WanderDomainItem): boolean {
    const meta = record(item.meta);
    const sourceType = text(meta.sourceType || meta.captureKind || meta.type).toLowerCase();
    return sourceType === 'xhs-comments';
}

function normalizeComment(raw: unknown): {
    author: string;
    text: string;
    likes: number;
    replies: number;
    createdAt: string;
    location: string;
} | null {
    const payload = record(raw);
    const authorPayload = record(payload.author);
    const contentPayload = record(payload.content);
    const metricsPayload = record(payload.metrics);
    const timePayload = record(payload.time);
    const author = text(authorPayload.nickname || authorPayload.name || payload.author || payload.nickname);
    const content = text(contentPayload.text || payload.text || payload.comment || payload.body);
    if (!author && !content) return null;
    return {
        author,
        text: content,
        likes: Math.max(0, Number(payload.likes ?? metricsPayload.likes) || 0),
        replies: Math.max(0, Number(payload.replies ?? metricsPayload.replies) || 0),
        createdAt: text(payload.createdAt || timePayload.display || timePayload.normalizedAt),
        location: text(payload.location),
    };
}

type NormalizedComment = NonNullable<ReturnType<typeof normalizeComment>>;

function commentsFromItem(item: WanderDomainItem): NormalizedComment[] {
    const meta = record(item.meta);
    const snapshot = Array.isArray(meta.commentsSnapshot)
        ? meta.commentsSnapshot
        : Array.isArray(record(meta.xhsComments).comments)
            ? record(meta.xhsComments).comments as unknown[]
            : [];
    return snapshot.map(normalizeComment).filter((comment): comment is NonNullable<typeof comment> => Boolean(comment));
}

function formatComments(comments: NormalizedComment[]): string {
    return comments.map((comment, index) => {
        const detail = [
            comment.author,
            comment.location,
            comment.createdAt,
            comment.likes > 0 ? `赞 ${comment.likes}` : '',
            comment.replies > 0 ? `回复 ${comment.replies}` : '',
        ].filter(Boolean).join(' · ');
        return `${index + 1}. ${detail || '匿名评论'}\n${comment.text}`;
    }).join('\n\n');
}

function commentDedupeKey(item: WanderDomainItem): string {
    const meta = record(item.meta);
    const sourceUrl = text(meta.sourceUrl || meta.sourceLink).replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
    if (sourceUrl) return `url:${sourceUrl}`;
    const originId = text(meta.originItemId || meta.noteId || item.id).replace(/^comments[-_:]/i, '');
    return `id:${originId.toLowerCase()}`;
}

export function listCommentCandidatesFromItems(items: WanderDomainItem[]): WanderDomainItem[] {
    const candidates = items.flatMap((item) => {
        const meta = record(item.meta);
        const comments = commentsFromItem(item);
        const dedicated = isCommentOnlyWanderItem(item);
        if (!dedicated && comments.length === 0) return [];
        const commentCount = Math.max(
            comments.length,
            Number(meta.commentCount || record(meta.stats).comments) || 0,
        );
        const content = comments.length > 0 ? formatComments(comments) : text(item.content);
        if (!content) return [];
        const originSourceType = text(meta.originSourceType || meta.sourceType || meta.captureKind || meta.type || item.type);
        return [{
            ...item,
            content,
            meta: {
                ...meta,
                sourceType: 'xhs-comments',
                originSourceType,
                originItemId: text(meta.originItemId || item.id),
                commentCount,
                capturedCommentCount: comments.length,
                commentsSnapshot: comments,
            },
        } satisfies WanderDomainItem];
    });

    const deduped = new Map<string, WanderDomainItem>();
    for (const candidate of candidates) {
        const key = commentDedupeKey(candidate);
        const existing = deduped.get(key);
        const candidateCapturedCount = Number(record(candidate.meta).capturedCommentCount || 0);
        const existingCapturedCount = Number(record(existing?.meta).capturedCommentCount || 0);
        const candidateCount = Number(record(candidate.meta).commentCount || 0);
        const existingCount = Number(record(existing?.meta).commentCount || 0);
        if (
            !existing
            || candidateCapturedCount > existingCapturedCount
            || (
                candidateCapturedCount === existingCapturedCount
                && (candidateCount > existingCount || (candidateCount === existingCount && isCommentOnlyWanderItem(candidate)))
            )
        ) {
            deduped.set(key, candidate);
        }
    }
    return Array.from(deduped.values()).sort((left, right) => {
        const rightCount = Number(record(right.meta).commentCount || 0);
        const leftCount = Number(record(left.meta).commentCount || 0);
        return rightCount - leftCount;
    });
}

export function listInspirationCandidates(items: WanderDomainItem[]): WanderDomainItem[] {
    return items.filter((item) => !isCommentOnlyWanderItem(item));
}

export function pickRandomWanderItems(items: WanderDomainItem[], count: number): WanderDomainItem[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const target = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
    }
    return shuffled.slice(0, Math.max(1, Math.floor(count)));
}

function formatSubjectConstraints(subjects: WanderSubjectRef[]): string {
    if (subjects.length === 0) return '本次没有选择资产约束。';
    return [
        '本次已选择以下资产作为硬约束。最终选题必须明确服务或围绕这些资产，不能忽略、替换或虚构资产属性：',
        ...subjects.map((subject, index) => {
            const attributes = subject.attributes.map((item) => `${item.key}=${item.value}`).join('；');
            return [
                `${index + 1}. ${subject.name}${subject.categoryName ? `（${subject.categoryName}）` : ''}`,
                `ID：${subject.id}`,
                subject.description ? `描述：${subject.description}` : '',
                subject.tags.length > 0 ? `标签：${subject.tags.join('、')}` : '',
                attributes ? `属性：${attributes}` : '',
                subject.categoryName === '媒体'
                    ? `查询命令：app_cli media get --asset-id "${subject.id}"`
                    : `查询命令：app_cli subjects get --id "${subject.id}"`,
            ].filter(Boolean).join('\n');
        }),
    ].join('\n');
}

function formatItems(items: WanderDomainItem[], sourceMode: WanderSourceMode): string {
    const perItemLimit = sourceMode === 'comment_insight' ? 12_000 : 3_000;
    return items.map((item, index) => {
        const meta = record(item.meta);
        const folderPath = text(meta.folderPath || meta.filePath);
        const commentCount = Number(meta.commentCount || 0);
        return [
            `素材 ${index + 1}`,
            `标题：${item.title}`,
            `类型：${sourceMode === 'comment_insight' ? '评论语料' : item.type}`,
            commentCount > 0 ? `已采集评论数：${commentCount}` : '',
            folderPath ? `知识库目录：${folderPath}` : '',
            `内容：\n${text(item.content).slice(0, perItemLimit)}`,
        ].filter(Boolean).join('\n');
    }).join('\n\n');
}

export function buildWanderAgentPrompt(input: {
    sourceMode: WanderSourceMode;
    items: WanderDomainItem[];
    subjects: WanderSubjectRef[];
    longTermContext?: string;
    multiChoice: boolean;
    requireToolCall?: boolean;
}): string {
    const commonOutput = [
        '每个选题对象必须包含：content_direction、direction_frame、topic、evaluation。',
        'direction_frame 必须包含 target_reader、core_tension、angle、material_entry。',
        'thinking_process 必须是字符串数组。',
        'topic 必须包含 title 和 connections；connections 必须是由 1、2、3 组成的数字数组；title 要口语化、明确、可直接用于小红书创作。',
        'evaluation 必须包含 0-100 的 heat、freshness、writability、fit、overall，以及 rationale。',
        ...(input.subjects.length > 0
            ? ['顶层必须包含 subject_alignment，格式为 [{"id":"资产准确 ID","usage":"该资产如何进入选题"}]，逐一覆盖所选资产。']
            : []),
    ];
    const outputRequirement = input.sourceMode === 'comment_insight'
        ? [
            '仅输出 JSON，顶层必须包含 source_mode="comment_insight"、content_direction、thinking_process、direction_frame、topic、evaluation、comment_insight。',
            'comment_insight 必须包含 questions、pain_points、objections、demand_signals、opportunity。',
            ...commonOutput,
        ]
        : input.multiChoice
            ? [
                '仅输出 JSON，顶层必须包含 source_mode="inspiration"、thinking_process、options。',
                'options 必须恰好包含 3 个不同选题对象，并在顶层提供 selected_index。',
                ...commonOutput,
            ]
            : [
                '仅输出 JSON，顶层必须包含 source_mode="inspiration"、content_direction、thinking_process、direction_frame、topic、evaluation。',
                ...commonOutput,
            ];
    const modeInstructions = input.sourceMode === 'comment_insight'
        ? [
            '你现在处于 Bojin「评论区洞察」Agent 模式。',
            '只分析评论语料中的真实问题、痛点、反对意见、误解、需求信号和未被满足的内容机会。',
            '最终选题必须能独立创作，不要把“评论区”“有人评论”写进标题或内容方向。',
            '不要执行灵感漫步，也不要把多篇普通素材强行关联。',
        ]
        : [
            '你现在处于 Bojin「灵感漫步」Agent 模式。',
            '分析三条知识素材的核心主题，发现至少两条素材之间有价值的新连接，并收敛成可执行选题。',
            '不要把任务改写成评论区分析。',
        ];
    const toolInstructions = input.requireToolCall === false
        ? ['当前为无工具直出或结构修复模式，请严格依据已提供的素材和资产约束输出最终 JSON。']
        : [
            '你必须先调用至少一次工具补充上下文，再输出最终 JSON。优先用 app_cli 读取知识库或所选资产；如不可用可回退通用文件工具。',
            '当前任务已经是 wander 选题流程，严禁再次调用 app_cli 的 wander run 或 wander brainstorm，避免递归执行。',
            '未发生工具调用时，不允许直接给最终结论。',
        ];

    return [
        ...modeInstructions,
        '',
        ...toolInstructions,
        '',
        '## 输出约束',
        ...outputRequirement,
        '',
        '## 资产硬约束',
        formatSubjectConstraints(input.subjects),
        '',
        '## 输入素材',
        formatItems(input.items, input.sourceMode),
        input.longTermContext ? `\n## 用户长期上下文\n${input.longTermContext}` : '',
    ].filter(Boolean).join('\n');
}

function normalizeConnections(value: unknown): number[] {
    const values = (Array.isArray(value) ? value : [])
        .map((item) => {
            const numeric = Number(item);
            if (Number.isFinite(numeric)) return numeric;
            const description = String(item || '');
            const materialMatch = description.match(/素材\s*([1-3])/);
            const numericMatch = description.match(/^\s*([1-3])\s*$/);
            return materialMatch
                ? Number(materialMatch[1])
                : numericMatch
                    ? Number(numericMatch[1])
                    : Number.NaN;
        })
        .filter((item) => Number.isFinite(item))
        .map((item) => Math.max(1, Math.min(3, Math.floor(item))));
    return Array.from(new Set(values)).slice(0, 3);
}

function normalizeDirectionFrame(value: unknown): WanderDirectionFrame {
    const payload = record(value);
    return {
        target_reader: text(payload.target_reader || payload.targetReader),
        core_tension: text(payload.core_tension || payload.coreTension),
        angle: text(payload.angle),
        material_entry: text(payload.material_entry || payload.materialEntry),
    };
}

function normalizeEvaluation(value: unknown): WanderEvaluation | undefined {
    const payload = record(value);
    const heat = boundedScore(payload.heat);
    const freshness = boundedScore(payload.freshness);
    const writability = boundedScore(payload.writability);
    const fit = boundedScore(payload.fit);
    const overall = boundedScore(payload.overall);
    if ([heat, freshness, writability, fit, overall].some((score) => score === null)) return undefined;
    return {
        heat: heat as number,
        freshness: freshness as number,
        writability: writability as number,
        fit: fit as number,
        overall: overall as number,
        rationale: text(payload.rationale) || undefined,
    };
}

function normalizeOption(value: unknown): WanderTopicOption {
    const payload = record(value);
    const topic = record(payload.topic);
    return {
        content_direction: text(payload.content_direction || payload.contentDirection || payload.direction),
        direction_frame: normalizeDirectionFrame(payload.direction_frame || payload.directionFrame),
        topic: {
            title: text(topic.title || payload.title),
            connections: normalizeConnections(topic.connections || payload.connections),
        },
        evaluation: normalizeEvaluation(payload.evaluation),
    };
}

export function normalizeWanderStructuredResult(
    value: unknown,
    sourceMode: WanderSourceMode,
    multiChoice: boolean,
): WanderStructuredResult {
    const payload = record(value);
    const rawOptions = Array.isArray(payload.options) ? payload.options : Array.isArray(payload.choices) ? payload.choices : [];
    const options = rawOptions.map(normalizeOption).filter((option) => option.topic.title).slice(0, 3);
    const primary = normalizeOption(payload.topic || payload.content_direction || payload.direction_frame
        ? payload
        : options[0] || {});
    const commentInsightPayload = record(payload.comment_insight || payload.commentInsight);
    const result: WanderStructuredResult = {
        ...primary,
        source_mode: sourceMode,
        thinking_process: stringList(payload.thinking_process || payload.thinkingProcess, 8),
        selected_index: Number.isFinite(Number(payload.selected_index ?? payload.selectedIndex))
            ? Math.max(0, Math.min(2, Math.floor(Number(payload.selected_index ?? payload.selectedIndex))))
            : 0,
    };
    if (multiChoice && sourceMode === 'inspiration') {
        result.options = options;
        if (options.length > 0) {
            Object.assign(result, options[result.selected_index || 0] || options[0]);
        }
    }
    if (sourceMode === 'comment_insight') {
        result.comment_insight = {
            questions: stringList(commentInsightPayload.questions),
            pain_points: stringList(commentInsightPayload.pain_points || commentInsightPayload.painPoints),
            objections: stringList(commentInsightPayload.objections),
            demand_signals: stringList(commentInsightPayload.demand_signals || commentInsightPayload.demandSignals),
            opportunity: text(commentInsightPayload.opportunity),
        };
    }
    const rawSubjectAlignment = Array.isArray(payload.subject_alignment)
        ? payload.subject_alignment
        : Array.isArray(payload.subjectAlignment)
            ? payload.subjectAlignment
            : [];
    if (rawSubjectAlignment.length > 0) {
        result.subject_alignment = rawSubjectAlignment
            .map((item) => record(item))
            .map((item) => ({
                id: text(item.id || item.asset_id || item.assetId || item.subject_id || item.subjectId),
                usage: text(item.usage || item.role || item.detail || item.description),
            }))
            .filter((item) => item.id && item.usage);
    }
    return result;
}

export function validateWanderStructuredResult(
    result: WanderStructuredResult,
    multiChoice: boolean,
    requiredSubjectIds: string[] = [],
): WanderValidationIssue[] {
    const issues: WanderValidationIssue[] = [];
    const requireText = (value: string, path: string, message: string) => {
        if (!text(value)) issues.push({ path, code: 'required', message });
    };
    const validateOption = (option: WanderTopicOption, path: string) => {
        requireText(option.topic.title, `${path}.topic.title`, '选题标题不能为空。');
        requireText(option.content_direction, `${path}.content_direction`, '内容方向不能为空。');
        requireText(option.direction_frame.target_reader, `${path}.direction_frame.target_reader`, '目标读者不能为空。');
        requireText(option.direction_frame.core_tension, `${path}.direction_frame.core_tension`, '核心矛盾不能为空。');
        requireText(option.direction_frame.angle, `${path}.direction_frame.angle`, '叙事角度不能为空。');
        requireText(option.direction_frame.material_entry, `${path}.direction_frame.material_entry`, '素材切口不能为空。');
        if (!option.evaluation) {
            issues.push({ path: `${path}.evaluation`, code: 'required', message: '选题评价分缺失。' });
        }
    };
    if (multiChoice && result.source_mode === 'inspiration') {
        if (!Array.isArray(result.options) || result.options.length !== 3) {
            issues.push({ path: 'options', code: 'option_count', message: '灵感漫步需要返回 3 个候选选题。' });
        } else {
            result.options.forEach((option, index) => validateOption(option, `options.${index}`));
            const uniqueTitles = new Set(result.options.map((option) => option.topic.title.trim().toLowerCase()).filter(Boolean));
            if (uniqueTitles.size !== result.options.length) {
                issues.push({ path: 'options', code: 'duplicate_options', message: '灵感漫步的 3 个候选选题必须互不相同。' });
            }
        }
    }
    validateOption(result, 'result');
    const alignedSubjectIds = new Set((result.subject_alignment || []).map((item) => item.id));
    for (const subjectId of requiredSubjectIds) {
        if (!alignedSubjectIds.has(subjectId)) {
            issues.push({
                path: 'subject_alignment',
                code: 'missing_subject_alignment',
                message: `选题结果没有落实资产硬约束：${subjectId}`,
            });
        }
    }
    if (result.source_mode === 'comment_insight') {
        requireText(result.comment_insight?.opportunity || '', 'comment_insight.opportunity', '评论洞察机会不能为空。');
        const signalCount = [
            ...(result.comment_insight?.questions || []),
            ...(result.comment_insight?.pain_points || []),
            ...(result.comment_insight?.objections || []),
            ...(result.comment_insight?.demand_signals || []),
        ].length;
        if (signalCount === 0) {
            issues.push({ path: 'comment_insight', code: 'empty_insight', message: '没有提取到可用的评论信号。' });
        }
    }
    return issues;
}
