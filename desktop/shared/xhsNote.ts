export const XHS_NOTE_SCHEMA_VERSION = 1 as const;

export type XhsNoteType = 'image' | 'video';
export type XhsMediaSlotRole = 'cover' | 'image-page' | 'video';
export type XhsMediaStatus = 'empty' | 'planned' | 'ready' | 'missing' | 'failed';
export type XhsGenerationStatus = 'draft' | 'ready' | 'generating' | 'generated' | 'failed';

export interface XhsMediaSlot {
    id: string;
    role: XhsMediaSlotRole;
    label: string;
    pageId?: string;
    assetId?: string;
    sourcePath?: string;
    previewUrl?: string;
    mimeType?: string;
    status: XhsMediaStatus;
    error?: string;
    updatedAt?: string;
}

export function isXhsMediaCompatible(
    role: XhsMediaSlotRole,
    mimeType?: string,
    filePath?: string,
): boolean {
    const mime = String(mimeType || '').trim().toLowerCase();
    const extension = String(filePath || '').trim().toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/)?.[1] || '';
    if (role === 'video') {
        return mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'].includes(extension);
    }
    return mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(extension);
}

export interface XhsImagePage {
    id: string;
    index: number;
    title: string;
    copy: string;
    visualBrief: string;
    imagePrompt: string;
    mediaSlotId: string;
}

export interface XhsVideoStoryboardItem {
    id: string;
    index: number;
    shot: string;
    durationSeconds: number;
    visual: string;
    generationPrompt: string;
    voiceover: string;
    onScreenText: string;
}

export interface XhsVideoGenerationSegment {
    index: number;
    durationSeconds: number;
    shots: XhsVideoStoryboardItem[];
}

export interface XhsSubtitleItem {
    id: string;
    startSeconds: number;
    endSeconds: number;
    text: string;
}

export interface XhsNoteDocument {
    schemaVersion: typeof XHS_NOTE_SCHEMA_VERSION;
    revision: number;
    noteType: XhsNoteType;
    titleCandidates: string[];
    finalTitle: string;
    body: string;
    hashtags: string[];
    coverText: string;
    imagePages: XhsImagePage[];
    mediaSlots: XhsMediaSlot[];
    voiceover: string;
    durationSeconds: number;
    aspectRatio: string;
    storyboard: XhsVideoStoryboardItem[];
    subtitles: XhsSubtitleItem[];
    generationStatus: XhsGenerationStatus;
    generationError?: string;
    createdAt: string;
    updatedAt: string;
}

export interface XhsNotePackageAsset {
    slotId: string;
    role: XhsMediaSlotRole;
    assetId?: string;
    file?: string;
    mimeType?: string;
    status: XhsMediaStatus;
}

export interface XhsNotePackageManifest {
    schema: 'redclaw-xiaohongshu-material-package';
    schemaVersion: typeof XHS_NOTE_SCHEMA_VERSION;
    noteType: XhsNoteType;
    revision: number;
    title: string;
    generationStatus: XhsGenerationStatus;
    exportedAt: string;
    assets: XhsNotePackageAsset[];
    warnings: string[];
}

export interface XhsNoteProjectSnapshot {
    artifactType: 'xiaohongshu-note';
    noteType: XhsNoteType;
    projectPath: string;
    relativePath: string;
    uri: string;
    version: number;
    document: XhsNoteDocument;
}

export function planXhsVideoGenerationSegments(
    document: Pick<XhsNoteDocument, 'durationSeconds' | 'storyboard'>,
    maxSegmentSeconds = 12,
    maxVisualBeatsPerSegment = Number.POSITIVE_INFINITY,
): XhsVideoGenerationSegment[] {
    const maxSeconds = Math.max(5, Math.floor(Number(maxSegmentSeconds) || 12));
    const maxVisualBeats = Number.isFinite(maxVisualBeatsPerSegment)
        ? Math.max(1, Math.floor(maxVisualBeatsPerSegment))
        : Number.POSITIVE_INFINITY;
    const shots = (Array.isArray(document.storyboard) ? document.storyboard : [])
        .filter((shot) => Number(shot.durationSeconds) > 0)
        .sort((left, right) => left.index - right.index);
    if (shots.length === 0) return [];

    const totalSeconds = shots.reduce((sum, shot) => sum + Number(shot.durationSeconds || 0), 0);
    const requestedSegments = Math.max(
        1,
        Math.ceil(totalSeconds / maxSeconds),
        Number.isFinite(maxVisualBeats) ? Math.ceil(shots.length / maxVisualBeats) : 1,
    );
    const groups: XhsVideoStoryboardItem[][] = [];
    let cursor = 0;
    let remainingSeconds = totalSeconds;

    for (let groupIndex = 0; groupIndex < requestedSegments && cursor < shots.length; groupIndex += 1) {
        const groupsLeft = requestedSegments - groupIndex;
        const targetSeconds = Math.min(maxSeconds, remainingSeconds / groupsLeft);
        const group: XhsVideoStoryboardItem[] = [];
        let durationSeconds = 0;

        while (cursor < shots.length) {
            const shot = shots[cursor];
            const shotDuration = Number(shot.durationSeconds || 0);
            const shotsLeftAfter = shots.length - (cursor + 1);
            const mustLeaveOnePerGroup = shotsLeftAfter < groupsLeft - 1;
            const wouldExceedMax = group.length > 0 && durationSeconds + shotDuration > maxSeconds;
            const wouldExceedVisualBeats = group.length >= maxVisualBeats;
            const currentDistance = Math.abs(targetSeconds - durationSeconds);
            const nextDistance = Math.abs(targetSeconds - (durationSeconds + shotDuration));
            const targetReached = group.length > 0 && nextDistance > currentDistance;
            if (mustLeaveOnePerGroup || wouldExceedMax || wouldExceedVisualBeats || targetReached) break;
            group.push(shot);
            durationSeconds += shotDuration;
            cursor += 1;
        }

        if (group.length === 0 && cursor < shots.length) {
            group.push(shots[cursor]);
            durationSeconds += Number(shots[cursor].durationSeconds || 0);
            cursor += 1;
        }
        groups.push(group);
        remainingSeconds -= durationSeconds;
    }

    if (cursor < shots.length) {
        groups[groups.length - 1].push(...shots.slice(cursor));
    }

    return groups.map((group, index) => ({
        index: index + 1,
        durationSeconds: group.reduce((sum, shot) => sum + Number(shot.durationSeconds || 0), 0),
        shots: group,
    }));
}

export interface XhsVideoGenerationPromptOptions {
    segmentCount: number;
    referenceImageCount?: number;
    promptPrefix?: string;
    generateAudio?: boolean;
    renderText?: boolean;
}

const compactPromptText = (value: unknown): string => String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

export function buildXhsVideoGenerationPrompt(
    segment: XhsVideoGenerationSegment,
    options: XhsVideoGenerationPromptOptions,
): string {
    const segmentCount = Math.max(1, Math.floor(Number(options.segmentCount) || 1));
    const referenceImageCount = Math.max(0, Math.floor(Number(options.referenceImageCount) || 0));
    const generateAudio = options.generateAudio === true;
    const renderText = options.renderText === true;
    let elapsedSeconds = 0;
    const timedShots = segment.shots.map((shot) => {
        const startSeconds = elapsedSeconds;
        elapsedSeconds += Number(shot.durationSeconds || 0);
        return { shot, startSeconds, endSeconds: elapsedSeconds };
    });
    const visualProgression = timedShots.map(({ shot, startSeconds, endSeconds }) => {
        const visualPrompt = compactPromptText(shot.generationPrompt)
            || compactPromptText(shot.visual)
            || compactPromptText(shot.shot);
        return `${startSeconds}-${endSeconds}秒：${visualPrompt}`;
    }).filter((item) => !item.endsWith('：'));
    const audioProgression = timedShots
        .map(({ shot, startSeconds, endSeconds }) => {
            const voiceover = compactPromptText(shot.voiceover);
            return voiceover ? `${startSeconds}-${endSeconds}秒声音要求：${voiceover}` : '';
        })
        .filter(Boolean);
    const postProductionText = segment.shots
        .map((shot) => compactPromptText(shot.onScreenText))
        .filter(Boolean);

    return [
        compactPromptText(options.promptPrefix) ? `补充创作要求：${compactPromptText(options.promptPrefix)}` : '',
        `生成第 ${segment.index}/${segmentCount} 段、时长 ${segment.durationSeconds} 秒的连续视频画面。`,
        referenceImageCount > 0
            ? `输入的 ${referenceImageCount} 张参考图是主体、空间布局、材质、配色与光线的视觉锚点；保持这些视觉特征稳定，不照搬参考图中可能存在的文字。`
            : '先建立稳定的主体与空间布局，后续动作、材质和光线变化都保持透视关系与视觉身份一致。',
        '将下面的时间进程理解为一段连贯表演，不要把每条描述机械拼成互不相关的画面：',
        ...visualProgression,
        '优先表现可见的主体、空间、材质变化、光影变化、动作和运镜；动作自然，转场克制，避免剧烈跳变、布局漂移、物体凭空增减或同一画面堆叠多个时空。',
        generateAudio && audioProgression.length > 0
            ? '同步生成与画面节奏一致的自然声音。下面的口播或对白只用于音轨；根据分镜语义保持说话者身份、语气和远近关系一致，不要把这些内容绘制成字幕、标题或任何画面文字。'
            : '',
        ...(generateAudio && audioProgression.length > 0 ? audioProgression : []),
        renderText
            ? (postProductionText.length > 0
                ? `需要模型直接呈现的屏幕文字：${postProductionText.join('；')}`
                : '')
            : '只生成干净的摄影画面。标题、字幕、数字、标签、图标、按钮、Logo 和水印全部留给后期剪辑，不要生成任何可读文字、乱码或伪文字。',
    ].filter(Boolean).join('\n');
}

export interface XhsMaterialPackageResult {
    kind: 'xiaohongshu-material-package';
    noteType: XhsNoteType;
    projectPath: string;
    relativePath: string;
    uri: string;
    version: number;
    outputPath: string;
    outputUrl: string;
    manifest: XhsNotePackageManifest;
}

export interface XhsMediaGenerationSlotDecision {
    action: 'generate' | 'reuse';
    slot: XhsMediaSlot;
}

export function assertExpectedXhsRevision(currentRevision: number, expectedRevision?: number): void {
    if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
        throw new Error(`REVISION_CONFLICT: 当前版本为 ${currentRevision}，请求基于版本 ${expectedRevision}`);
    }
}

export function applyXhsMediaSlotBinding(
    document: XhsNoteDocument,
    input: { slotId: string; assetId: string; sourcePath: string; mimeType?: string; updatedAt?: string },
): XhsNoteDocument {
    const slot = document.mediaSlots.find((item) => item.id === input.slotId);
    if (!slot) throw new Error(`媒体槽位不存在：${input.slotId}`);
    const updatedAt = input.updatedAt || new Date().toISOString();
    return {
        ...document,
        updatedAt,
        generationStatus: slot.role === 'video' ? 'generated' : document.generationStatus,
        generationError: slot.role === 'video' ? undefined : document.generationError,
        mediaSlots: document.mediaSlots.map((item) => item.id === slot.id
            ? {
                ...item,
                assetId: input.assetId,
                sourcePath: input.sourcePath,
                mimeType: input.mimeType,
                status: 'ready',
                error: undefined,
                updatedAt,
            }
            : item),
    };
}

export function resolveXhsMediaGenerationSlot(
    document: XhsNoteDocument,
    input: { slotId: string; mediaKind: 'image' | 'video'; replace?: boolean },
): XhsMediaGenerationSlotDecision {
    const slot = document.mediaSlots.find((item) => item.id === input.slotId);
    if (!slot) throw new Error(`媒体槽位不存在：${input.slotId}`);

    const acceptsMedia = input.mediaKind === 'video'
        ? slot.role === 'video'
        : slot.role === 'cover' || slot.role === 'image-page';
    if (!acceptsMedia) {
        throw new Error(`媒体槽位 ${slot.id} 不接受 ${input.mediaKind === 'video' ? '视频' : '图片'}素材`);
    }

    const reusable = !input.replace
        && slot.status === 'ready'
        && Boolean(slot.assetId)
        && Boolean(slot.sourcePath);
    return {
        action: reusable ? 'reuse' : 'generate',
        slot,
    };
}

export function createXhsNotePackageManifest(input: {
    document: XhsNoteDocument;
    assets: XhsNotePackageAsset[];
    warnings: string[];
    exportedAt?: string;
}): XhsNotePackageManifest {
    return {
        schema: 'redclaw-xiaohongshu-material-package',
        schemaVersion: XHS_NOTE_SCHEMA_VERSION,
        noteType: input.document.noteType,
        revision: input.document.revision,
        title: input.document.finalTitle,
        generationStatus: input.document.generationStatus,
        exportedAt: input.exportedAt || new Date().toISOString(),
        assets: input.assets,
        warnings: input.warnings,
    };
}

export function sanitizeXhsMaterialFileName(value: string, fallback: string): string {
    const base = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
    const sanitized = base
        .normalize('NFKC')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .replace(/^[.\s]+|[.\s]+$/g, '');
    return sanitized || fallback;
}

export function uniqueXhsMaterialFileName(fileName: string, used: Set<string>): string {
    const extensionIndex = fileName.lastIndexOf('.');
    const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : '';
    const stem = extension ? fileName.slice(0, -extension.length) : fileName;
    let candidate = fileName;
    let sequence = 2;
    while (used.has(candidate.toLowerCase())) {
        candidate = `${stem}-${sequence}${extension}`;
        sequence += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
}

const asRecord = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
);

const asString = (value: unknown): string => String(value ?? '').trim();

const asNumber = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const asStringArray = (value: unknown): string[] => (
    Array.isArray(value)
        ? value.map(asString).filter(Boolean)
        : asString(value).split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean)
);

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values));

const normalizeHashtag = (value: string): string => value.replace(/^#+/, '').trim();

const normalizeMediaStatus = (value: unknown): XhsMediaStatus => {
    const normalized = asString(value) as XhsMediaStatus;
    return ['empty', 'planned', 'ready', 'missing', 'failed'].includes(normalized) ? normalized : 'empty';
};

const normalizeGenerationStatus = (value: unknown): XhsGenerationStatus => {
    const normalized = asString(value) as XhsGenerationStatus;
    return ['draft', 'ready', 'generating', 'generated', 'failed'].includes(normalized) ? normalized : 'draft';
};

function normalizeSlot(value: unknown, fallback: Pick<XhsMediaSlot, 'id' | 'role' | 'label'>): XhsMediaSlot {
    const input = asRecord(value);
    return {
        id: asString(input.id) || fallback.id,
        role: (['cover', 'image-page', 'video'].includes(asString(input.role))
            ? asString(input.role)
            : fallback.role) as XhsMediaSlotRole,
        label: asString(input.label) || fallback.label,
        pageId: asString(input.pageId) || undefined,
        assetId: asString(input.assetId) || undefined,
        sourcePath: asString(input.sourcePath) || undefined,
        previewUrl: asString(input.previewUrl) || undefined,
        mimeType: asString(input.mimeType) || undefined,
        status: normalizeMediaStatus(input.status),
        error: asString(input.error) || undefined,
        updatedAt: asString(input.updatedAt) || undefined,
    };
}

export function normalizeXhsNoteDocument(value: unknown, forcedType?: XhsNoteType): XhsNoteDocument {
    const input = asRecord(value);
    const now = new Date().toISOString();
    const noteType: XhsNoteType = forcedType || (asString(input.noteType) === 'video' ? 'video' : 'image');
    const rawPages = Array.isArray(input.imagePages)
        ? input.imagePages
        : Array.isArray(input.pages)
            ? input.pages
            : [];
    const imagePages = rawPages.map((value, pageIndex): XhsImagePage => {
        const page = asRecord(value);
        const index = Math.max(1, Math.trunc(asNumber(page.index, pageIndex + 1)));
        const id = asString(page.id) || `page-${index}`;
        return {
            id,
            index,
            title: asString(page.title),
            copy: asString(page.copy || page.content || page.text),
            visualBrief: asString(page.visualBrief || page.visual),
            imagePrompt: asString(page.imagePrompt || page.prompt),
            mediaSlotId: asString(page.mediaSlotId) || `page-${index}-image`,
        };
    }).sort((a, b) => a.index - b.index);

    const rawSlots = Array.isArray(input.mediaSlots) ? input.mediaSlots : [];
    const slotsById = new Map<string, XhsMediaSlot>();
    for (const value of rawSlots) {
        const slotInput = asRecord(value);
        const rawId = asString(slotInput.id);
        if (!rawId) continue;
        const role = (['cover', 'image-page', 'video'].includes(asString(slotInput.role))
            ? asString(slotInput.role)
            : 'image-page') as XhsMediaSlotRole;
        slotsById.set(rawId, normalizeSlot(value, { id: rawId, role, label: rawId }));
    }

    const coverSlot = normalizeSlot(slotsById.get('cover'), { id: 'cover', role: 'cover', label: '封面' });
    slotsById.set(coverSlot.id, coverSlot);
    for (const page of imagePages) {
        const existing = slotsById.get(page.mediaSlotId);
        slotsById.set(page.mediaSlotId, {
            ...normalizeSlot(existing, {
                id: page.mediaSlotId,
                role: 'image-page',
                label: `第 ${page.index} 页`,
            }),
            role: 'image-page',
            pageId: page.id,
        });
    }
    if (noteType === 'video') {
        slotsById.set('final-video', normalizeSlot(slotsById.get('final-video'), {
            id: 'final-video',
            role: 'video',
            label: '最终成片',
        }));
    }

    const rawStoryboard = Array.isArray(input.storyboard) ? input.storyboard : [];
    const storyboard = rawStoryboard.map((value, storyboardIndex): XhsVideoStoryboardItem => {
        const item = asRecord(value);
        const index = Math.max(1, Math.trunc(asNumber(item.index, storyboardIndex + 1)));
        return {
            id: asString(item.id) || `shot-${index}`,
            index,
            shot: asString(item.shot || item.name),
            durationSeconds: Math.max(0, asNumber(item.durationSeconds || item.duration, 0)),
            visual: asString(item.visual || item.description),
            generationPrompt: asString(item.generationPrompt || item.videoPrompt),
            voiceover: asString(item.voiceover || item.narration),
            onScreenText: asString(item.onScreenText || item.text),
        };
    }).sort((a, b) => a.index - b.index);

    const rawSubtitles = Array.isArray(input.subtitles) ? input.subtitles : [];
    const subtitles = rawSubtitles.map((value, subtitleIndex): XhsSubtitleItem => {
        const item = asRecord(value);
        const startSeconds = Math.max(0, asNumber(item.startSeconds || item.start, subtitleIndex));
        return {
            id: asString(item.id) || `subtitle-${subtitleIndex + 1}`,
            startSeconds,
            endSeconds: Math.max(startSeconds, asNumber(item.endSeconds || item.end, startSeconds + 1)),
            text: asString(item.text || item.content),
        };
    });

    return {
        schemaVersion: XHS_NOTE_SCHEMA_VERSION,
        revision: Math.max(0, Math.trunc(asNumber(input.revision, 0))),
        noteType,
        titleCandidates: uniqueStrings(asStringArray(input.titleCandidates || input.titles)),
        finalTitle: asString(input.finalTitle || input.title),
        body: asString(input.body || input.content),
        hashtags: uniqueStrings(asStringArray(input.hashtags || input.tags).map(normalizeHashtag).filter(Boolean)),
        coverText: asString(input.coverText),
        imagePages,
        mediaSlots: Array.from(slotsById.values()),
        voiceover: noteType === 'video' ? asString(input.voiceover || input.script) : '',
        durationSeconds: noteType === 'video' ? Math.max(0, asNumber(input.durationSeconds || input.duration, 60)) : 0,
        aspectRatio: noteType === 'video' ? asString(input.aspectRatio) || '9:16' : '3:4',
        storyboard: noteType === 'video' ? storyboard : [],
        subtitles: noteType === 'video' ? subtitles : [],
        generationStatus: normalizeGenerationStatus(input.generationStatus),
        generationError: asString(input.generationError) || undefined,
        createdAt: asString(input.createdAt) || now,
        updatedAt: asString(input.updatedAt) || now,
    };
}

export function renderXhsNoteMarkdown(
    document: XhsNoteDocument,
    assetPaths: Record<string, string> = {},
): string {
    const lines: string[] = [];
    lines.push(`# ${document.finalTitle || '未命名小红书笔记'}`, '');
    if (document.titleCandidates.length > 0) {
        lines.push('## 标题候选', '', ...document.titleCandidates.map((title) => `- ${title}`), '');
    }
    lines.push('## 封面文案', '', document.coverText || '（待补充）', '');
    const coverAsset = assetPaths.cover;
    if (coverAsset) lines.push(`![封面](${coverAsset})`, '');
    lines.push('## 正文', '', document.body || '（待补充）', '');
    lines.push('## 标签', '', document.hashtags.length > 0
        ? document.hashtags.map((tag) => `#${tag}`).join(' ')
        : '（待补充）', '');

    if (document.imagePages.length > 0) {
        lines.push('## 逐页方案', '');
        for (const page of document.imagePages) {
            lines.push(`### 第 ${page.index} 页${page.title ? `：${page.title}` : ''}`, '');
            const assetPath = assetPaths[page.mediaSlotId];
            if (assetPath) lines.push(`![第 ${page.index} 页](${assetPath})`, '');
            if (page.copy) lines.push(page.copy, '');
            if (page.visualBrief) lines.push(`- 画面方案：${page.visualBrief}`);
            if (page.imagePrompt) lines.push(`- 生成提示词：${page.imagePrompt}`);
            lines.push('');
        }
    }

    if (document.noteType === 'video') {
        const videoAsset = assetPaths['final-video'];
        lines.push('## 视频规格', '', `- 时长：${document.durationSeconds} 秒`, `- 比例：${document.aspectRatio}`, '');
        if (videoAsset) lines.push(`[打开最终成片](${videoAsset})`, '');
        lines.push('## 口播稿', '', document.voiceover || '（待补充）', '');
        lines.push('## 分镜表', '', '| 镜头 | 时长 | 画面 | 口播 | 屏幕文字 |', '| --- | ---: | --- | --- | --- |');
        for (const item of document.storyboard) {
            const cells = [item.shot || `镜头 ${item.index}`, `${item.durationSeconds}s`, item.visual, item.voiceover, item.onScreenText]
                .map((cell) => String(cell || '').replace(/\|/g, '\\|').replace(/\n/g, '<br>'));
            lines.push(`| ${cells.join(' | ')} |`);
        }
        lines.push('', '## 字幕', '');
        for (const item of document.subtitles) {
            lines.push(`- ${formatTimestamp(item.startSeconds)} → ${formatTimestamp(item.endSeconds)} ${item.text}`);
        }
        lines.push('');
    }

    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function formatTimestamp(seconds: number): string {
    const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const minutes = Math.floor(safe / 60);
    const remainder = safe - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

export function escapeXhsHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const htmlLines = (value: string): string => escapeXhsHtml(value).replace(/\n/g, '<br>');

export function renderXhsNoteHtml(
    document: XhsNoteDocument,
    assetPaths: Record<string, string> = {},
): string {
    const section = (id: string, title: string, text: string, body: string) => `
        <section class="ops-section">
            <div class="section-head"><h2>${escapeXhsHtml(title)}</h2><button type="button" data-copy="${escapeXhsHtml(id)}">复制</button></div>
            <div id="${escapeXhsHtml(id)}" data-copy-text="${escapeXhsHtml(text)}">${body}</div>
        </section>`;
    const titleCandidates = document.titleCandidates.map((item) => `<li>${escapeXhsHtml(item)}</li>`).join('');
    const hashtags = document.hashtags.map((tag) => `#${tag}`).join(' ');
    const coverAsset = assetPaths.cover;
    const videoAsset = assetPaths['final-video'];
    const pageCards = document.imagePages.map((page) => {
        const pageAsset = assetPaths[page.mediaSlotId];
        return `<article class="page-card">
            ${pageAsset ? `<img src="${escapeXhsHtml(pageAsset)}" alt="第 ${page.index} 页">` : '<div class="placeholder">图片待生成</div>'}
            <div class="page-copy"><strong>第 ${page.index} 页${page.title ? ` · ${escapeXhsHtml(page.title)}` : ''}</strong><p>${htmlLines(page.copy)}</p><small>${htmlLines(page.visualBrief)}</small></div>
        </article>`;
    }).join('');
    const storyboardRows = document.storyboard.map((item) => `<tr><td>${escapeXhsHtml(item.shot || `镜头 ${item.index}`)}</td><td>${item.durationSeconds}s</td><td>${htmlLines(item.visual)}</td><td>${htmlLines(item.voiceover)}</td><td>${htmlLines(item.onScreenText)}</td></tr>`).join('');
    const subtitleText = document.subtitles.map((item) => `${formatTimestamp(item.startSeconds)} → ${formatTimestamp(item.endSeconds)} ${item.text}`).join('\n');
    const subtitleRows = document.subtitles.map((item) => `<li><time>${formatTimestamp(item.startSeconds)} → ${formatTimestamp(item.endSeconds)}</time>${htmlLines(item.text)}</li>`).join('');
    const fullText = [document.finalTitle, document.body, hashtags].filter(Boolean).join('\n\n');

    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeXhsHtml(document.finalTitle || '小红书笔记')}</title>
<style>
:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#27272a;background:#f6f5f3}*{box-sizing:border-box}body{margin:0}button{font:inherit}.shell{max-width:1100px;margin:auto;padding:28px 18px 64px}.hero{display:grid;grid-template-columns:minmax(280px,390px) 1fr;gap:28px;align-items:start}.phone{overflow:hidden;border:1px solid #e4e4e7;border-radius:30px;background:#fff;box-shadow:0 18px 60px #18181b18;position:sticky;top:18px}.media{aspect-ratio:3/4;background:linear-gradient(145deg,#fee2e2,#fef3c7);display:flex;align-items:center;justify-content:center;overflow:hidden}.media img,.media video{width:100%;height:100%;object-fit:cover}.placeholder{display:flex;min-height:220px;align-items:center;justify-content:center;color:#a1a1aa;background:linear-gradient(145deg,#fafafa,#f4f4f5)}.post{padding:18px}.post h1{font-size:21px;margin:0 0 12px}.post p{line-height:1.75;white-space:pre-wrap}.tags{color:#2563eb}.ops{display:grid;gap:14px}.ops-section{border:1px solid #e4e4e7;border-radius:18px;background:#fff;padding:18px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.section-head h2{font-size:16px;margin:0}.section-head button{border:0;border-radius:9px;padding:7px 11px;background:#18181b;color:#fff;cursor:pointer}.ops-section p,.ops-section li{line-height:1.75}.pages{display:grid;gap:12px}.page-card{display:grid;grid-template-columns:110px 1fr;gap:14px;border:1px solid #eee;border-radius:14px;overflow:hidden}.page-card img,.page-card>.placeholder{width:110px;height:146px;min-height:0;object-fit:cover}.page-copy{padding:12px 12px 12px 0}.page-copy p{margin:7px 0}.page-copy small{color:#71717a}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px;border:1px solid #e4e4e7;text-align:left;vertical-align:top}.subtitles{list-style:none;padding:0}.subtitles time{display:inline-block;min-width:125px;color:#71717a}@media(max-width:760px){.hero{grid-template-columns:1fr}.phone{position:static}.shell{padding:14px 12px 40px}.page-card{grid-template-columns:86px 1fr}.page-card img,.page-card>.placeholder{width:86px;height:115px}table{display:block;overflow:auto}}
</style></head><body><main class="shell"><div class="hero">
<article class="phone"><div class="media">${document.noteType === 'video'
        ? videoAsset
            ? `<video src="${escapeXhsHtml(videoAsset)}" controls playsinline poster="${escapeXhsHtml(coverAsset || '')}"></video>`
            : coverAsset
                ? `<img src="${escapeXhsHtml(coverAsset)}" alt="视频封面">`
                : '<div class="placeholder">视频待生成</div>'
        : coverAsset
            ? `<img src="${escapeXhsHtml(coverAsset)}" alt="封面">`
            : '<div class="placeholder">封面待生成</div>'}</div><div class="post"><h1>${escapeXhsHtml(document.finalTitle || '未命名笔记')}</h1><p>${htmlLines(document.body)}</p><p class="tags">${escapeXhsHtml(hashtags)}</p></div></article>
<div class="ops">
${section('full-copy', '复制全文', fullText, `<p>${htmlLines(fullText)}</p>`)}
${section('final-title', '最终标题', document.finalTitle, `<p>${escapeXhsHtml(document.finalTitle)}</p>`)}
${section('title-candidates', '标题候选', document.titleCandidates.join('\n'), `<ul>${titleCandidates}</ul>`)}
${section('cover-copy', '封面文案', document.coverText, `<p>${htmlLines(document.coverText)}</p>`)}
${section('body-copy', '正文', document.body, `<p>${htmlLines(document.body)}</p>`)}
${section('hashtags-copy', '标签', hashtags, `<p class="tags">${escapeXhsHtml(hashtags)}</p>`)}
${document.imagePages.length > 0 ? section('page-plan', '逐页图文方案', document.imagePages.map((page) => `第 ${page.index} 页 ${page.title}\n${page.copy}\n${page.visualBrief}`).join('\n\n'), `<div class="pages">${pageCards}</div>`) : ''}
${document.noteType === 'video' ? section('voiceover-copy', '口播稿', document.voiceover, `<p>${htmlLines(document.voiceover)}</p>`) : ''}
${document.noteType === 'video' ? section('storyboard-copy', '分镜表', document.storyboard.map((item) => `${item.shot}\t${item.durationSeconds}s\t${item.visual}\t${item.voiceover}\t${item.onScreenText}`).join('\n'), `<div style="overflow:auto"><table><thead><tr><th>镜头</th><th>时长</th><th>画面</th><th>口播</th><th>屏幕文字</th></tr></thead><tbody>${storyboardRows}</tbody></table></div>`) : ''}
${document.noteType === 'video' ? section('subtitles-copy', '字幕', subtitleText, `<ul class="subtitles">${subtitleRows}</ul>`) : ''}
</div></div></main><script>
(function(){function fallback(text){var area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.focus();area.select();var ok=false;try{ok=document.execCommand('copy')}catch(e){}document.body.removeChild(area);return ok}async function copy(text){if(navigator.clipboard&&window.isSecureContext){try{await navigator.clipboard.writeText(text);return true}catch(e){}}return fallback(text)}document.addEventListener('click',async function(event){var button=event.target.closest('[data-copy]');if(!button)return;var target=document.getElementById(button.getAttribute('data-copy'));var text=target&&target.getAttribute('data-copy-text')||'';var original=button.textContent;button.textContent=await copy(text)?'已复制':'复制失败';setTimeout(function(){button.textContent=original},1200)})})();
</script></body></html>`;
}
