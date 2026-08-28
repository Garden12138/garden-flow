export type BrowserKnowledgeEntryPayload = {
    kind?: string;
    source?: {
        sourceLink?: string;
        sourceUrl?: string;
        sourceDomain?: string;
        externalId?: string;
    };
    content?: {
        title?: string;
        text?: string;
        excerpt?: string;
        description?: string;
        html?: string;
        indexText?: string;
        author?: string;
        authorProfileUrl?: string;
        siteName?: string;
        tags?: string[];
        publishedAt?: string;
        commentsSnapshot?: Array<{
            author?: string;
            text?: string;
            likes?: number;
            replies?: number;
            createdAt?: string;
            location?: string;
        }>;
        stats?: {
            likes?: number;
            collects?: number;
            comments?: number;
            shares?: number;
        };
    };
    assets?: {
        coverUrl?: string;
        imageUrls?: string[];
        videoUrl?: string;
        thumbnailUrl?: string;
    };
    options?: {
        allowUpdate?: boolean;
        transcribe?: boolean;
    };
};

function record(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : {};
}

function text(value: unknown, maxLength = 200_000): string {
    return String(value || '').trim().slice(0, maxLength);
}

function numeric(value: unknown): number {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function scalarText(value: unknown, maxLength = 200_000): string {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return '';
    }
    const normalized = text(value, maxLength);
    return normalized === '[object Object]' ? '' : normalized;
}

function commentAuthor(source: Record<string, any>): string {
    const author = record(source.author);
    const user = record(source.user);
    return scalarText(
        author.nickname
        || author.name
        || scalarText(source.author, 500)
        || user.nickname
        || user.name,
        500,
    );
}

function commentText(source: Record<string, any>): string {
    const content = record(source.content);
    return scalarText(
        source.text
        || content.text
        || scalarText(source.content, 20_000),
        20_000,
    );
}

function comments(value: unknown) {
    return (Array.isArray(value) ? value : [])
        .slice(0, 10_000)
        .map((item) => {
            const source = record(item);
            const metrics = record(source.metrics);
            const time = record(source.time);
            return {
                author: commentAuthor(source),
                text: commentText(source),
                likes: numeric(source.likes ?? metrics.likes ?? source.likeCount ?? source.like_count),
                replies: numeric(source.replies ?? metrics.replies ?? source.replyCount ?? source.sub_comment_count),
                createdAt: scalarText(source.createdAt || time.display || source.createTime || source.create_time, 200),
                location: text(source.location || source.ipLocation || source.ip_location, 500),
            };
        })
        .filter((item) => item.author || item.text);
}

export function buildXhsCommentsSnapshotView(
    value: unknown,
    options: {
        noteId?: string;
        sourceLink?: string;
        total?: number;
    } = {},
) {
    const items = (Array.isArray(value) ? value : [])
        .slice(0, 10_000)
        .map((item, index) => {
            const source = record(item);
            const author = record(source.author);
            const content = record(source.content);
            const metrics = record(source.metrics);
            const time = record(source.time);
            const body = commentText(source);
            const nickname = commentAuthor(source);
            return {
                id: scalarText(source.id || source.platformCommentId, 500) || `comment-${index + 1}`,
                platformCommentId: scalarText(source.platformCommentId || source.id, 500) || undefined,
                parentCommentId: scalarText(source.parentCommentId, 500) || undefined,
                rootCommentId: scalarText(source.rootCommentId, 500) || undefined,
                level: numeric(source.level),
                author: {
                    userId: scalarText(author.userId || source.userId, 500) || undefined,
                    nickname: nickname || undefined,
                    profileUrl: scalarText(author.profileUrl || source.profileUrl, 8_000) || undefined,
                    avatarUrl: scalarText(author.avatarUrl || source.avatarUrl, 8_000) || undefined,
                    isNoteAuthor: Boolean(author.isNoteAuthor || source.isNoteAuthor),
                },
                content: {
                    text: body,
                    segments: Array.isArray(content.segments) ? content.segments.slice(0, 2_000) : [],
                    emojiUrls: Array.isArray(content.emojiUrls)
                        ? content.emojiUrls.map((url: unknown) => scalarText(url, 8_000)).filter(Boolean).slice(0, 500)
                        : [],
                },
                metrics: {
                    likes: numeric(source.likes ?? metrics.likes ?? source.likeCount ?? source.like_count),
                    replies: numeric(source.replies ?? metrics.replies ?? source.replyCount ?? source.sub_comment_count),
                },
                time: {
                    display: scalarText(source.createdAt || time.display || source.createTime || source.create_time, 200) || undefined,
                    normalizedAt: scalarText(time.normalizedAt, 200) || undefined,
                },
                location: scalarText(source.location || source.ipLocation || source.ip_location, 500) || undefined,
            };
        })
        .filter((item) => item.author.nickname || item.content.text);
    const requestedTotal = Number(options.total || 0);
    const total = Number.isFinite(requestedTotal) ? Math.max(items.length, requestedTotal) : items.length;
    return {
        schemaVersion: 2,
        platform: 'xiaohongshu',
        noteId: scalarText(options.noteId, 500),
        entryId: scalarText(options.noteId, 500),
        sourceLink: scalarText(options.sourceLink, 8_000),
        total,
        visibleCount: items.length,
        hasMore: items.length < total,
        comments: items,
    };
}

export function normalizeXhsV2Entry(payloadInput: unknown): {
    entry: BrowserKnowledgeEntryPayload;
    capturedComments: number;
} {
    const payload = record(payloadInput);
    const source = record(payload.source);
    const note = record(payload.note);
    const author = record(note.author);
    const assets = record(note.assets);
    const stats = record(note.stats);
    const options = record(payload.options);
    const commentsPayload = record(payload.comments);
    const capturedComments = comments(commentsPayload.items || commentsPayload.comments);
    const noteId = text(note.noteId || source.externalId, 500);
    const noteType = text(note.noteType, 50) === 'video' ? 'video' : 'image';
    if (!noteId || (!text(note.title) && !text(note.text) && !assets.coverUrl && !assets.videoUrl)) {
        throw bridgePayloadError('CONTENT_NOT_ACCESSIBLE', '当前页面没有可保存的小红书内容');
    }
    return {
        entry: {
            kind: noteType === 'video' ? 'xhs-video' : 'xhs-note',
            source: {
                sourceLink: text(source.sourceLink || source.sourceUrl, 8_000),
                sourceUrl: text(source.sourceUrl || source.sourceLink, 8_000),
                sourceDomain: text(source.sourceDomain || 'www.xiaohongshu.com', 500),
                externalId: noteId,
            },
            content: {
                title: text(note.title, 2_000) || '小红书内容',
                text: text(note.text),
                indexText: text(note.text),
                excerpt: text(note.text, 180),
                description: text(note.text, 500),
                author: text(author.nickname || author.name, 1_000),
                authorProfileUrl: text(author.profileUrl || author.url, 8_000),
                siteName: '小红书',
                tags: ['小红书'],
                commentsSnapshot: capturedComments,
                stats: {
                    likes: numeric(stats.likes),
                    collects: numeric(stats.collects),
                    comments: numeric(stats.comments || commentsPayload.total || capturedComments.length),
                },
            },
            assets: {
                coverUrl: text(assets.coverUrl, 10_000_000),
                imageUrls: (Array.isArray(assets.imageUrls) ? assets.imageUrls : []).slice(0, 100).map((item) => text(item, 10_000_000)).filter(Boolean),
                videoUrl: text(assets.videoUrl, 10_000_000),
            },
            options: {
                allowUpdate: options.allowUpdate !== false,
                transcribe: options.transcribe === true || noteType === 'video',
            },
        },
        capturedComments: capturedComments.length,
    };
}

export function normalizeZhihuAnswerEntry(payloadInput: unknown): BrowserKnowledgeEntryPayload {
    const payload = record(payloadInput);
    const source = record(payload.source);
    const question = record(payload.question);
    const answer = record(payload.answer);
    const author = record(answer.author);
    const stats = record(answer.stats);
    const answerId = text(answer.id || source.externalId, 500);
    if (!answerId || (!text(answer.text) && !text(answer.html))) {
        throw bridgePayloadError('CONTENT_NOT_ACCESSIBLE', '当前知乎回答正文不可访问');
    }
    return {
        kind: 'zhihu-answer',
        source: {
            sourceLink: text(source.sourceLink || answer.url, 8_000),
            sourceUrl: text(source.sourceUrl || source.sourceLink || answer.url, 8_000),
            sourceDomain: 'www.zhihu.com',
            externalId: answerId,
        },
        content: {
            title: text(question.title, 2_000) || '知乎回答',
            text: text(answer.text),
            indexText: [text(question.title), text(question.detail), text(answer.text)].filter(Boolean).join('\n\n'),
            excerpt: text(answer.excerpt || answer.text, 180),
            html: text(answer.html, 500_000),
            author: text(author.name, 1_000) || '知乎用户',
            authorProfileUrl: text(author.url, 8_000),
            siteName: '知乎',
            tags: ['知乎', '回答', ...(Array.isArray(question.topics) ? question.topics.map((item: unknown) => text(item, 100)) : [])],
            publishedAt: text(answer.publishedAt, 200),
            stats: {
                likes: numeric(stats.likes || stats.upvotes),
                collects: numeric(stats.collects),
                comments: numeric(stats.comments),
            },
        },
        assets: {},
        options: { allowUpdate: true, transcribe: false },
    };
}

export function normalizeZhihuArticleEntry(payloadInput: unknown): BrowserKnowledgeEntryPayload {
    const payload = record(payloadInput);
    const source = record(payload.source);
    const article = record(payload.article);
    const author = record(article.author);
    const stats = record(article.stats);
    const articleId = text(article.id || source.externalId, 500);
    if (!articleId || (!text(article.text) && !text(article.html))) {
        throw bridgePayloadError('CONTENT_NOT_ACCESSIBLE', '当前知乎文章正文不可访问');
    }
    return {
        kind: 'zhihu-article',
        source: {
            sourceLink: text(source.sourceLink || article.url, 8_000),
            sourceUrl: text(source.sourceUrl || source.sourceLink || article.url, 8_000),
            sourceDomain: 'zhuanlan.zhihu.com',
            externalId: articleId,
        },
        content: {
            title: text(article.title, 2_000) || '知乎文章',
            text: text(article.text),
            indexText: text(article.text),
            excerpt: text(article.excerpt || article.text, 180),
            html: text(article.html, 500_000),
            author: text(author.name, 1_000) || '知乎用户',
            authorProfileUrl: text(author.url, 8_000),
            siteName: '知乎',
            tags: ['知乎', '文章'],
            publishedAt: text(article.publishedAt, 200),
            stats: {
                likes: numeric(stats.likes || stats.upvotes),
                collects: numeric(stats.collects),
                comments: numeric(stats.comments),
            },
        },
        assets: {
            coverUrl: text(article.coverUrl, 10_000_000),
            imageUrls: (Array.isArray(article.imageUrls) ? article.imageUrls : []).slice(0, 100).map((item: unknown) => text(item, 10_000_000)).filter(Boolean),
        },
        options: { allowUpdate: true, transcribe: false },
    };
}

export function validateRemoteMediaSource(value: unknown): string {
    const source = text(value, 10_000_000);
    if (/^https?:\/\//i.test(source)) return source;
    if (/^data:(?:image|video|audio)\/[a-z0-9.+-]+;base64,/i.test(source) && source.length <= 8 * 1024 * 1024) {
        return source;
    }
    throw bridgePayloadError('INVALID_MEDIA_SOURCE', '媒体仅支持 HTTP(S) 或受限的内联资源');
}

export function bridgePayloadError(code: string, message: string): Error & { code: string; phase: string; retryable: boolean; recovery: string } {
    return Object.assign(new Error(message), {
        code,
        phase: 'capture',
        retryable: false,
        recovery: code === 'BROWSER_LOGIN_REQUIRED' || code === 'BROWSER_SECURITY_CHALLENGE'
            ? '回到当前浏览器页面自行完成登录或验证，然后重新采集'
            : code === 'CONTENT_NOT_ACCESSIBLE'
                ? '确认正文已在当前页面中展开后重试'
                : '',
    });
}
