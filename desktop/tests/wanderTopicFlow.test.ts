import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildWanderAgentPrompt,
    isCommentOnlyWanderItem,
    listCommentCandidatesFromItems,
    listInspirationCandidates,
    normalizeWanderSourceMode,
    normalizeWanderStructuredResult,
    parseWanderJsonPayload,
    pickRandomWanderItems,
    validateWanderStructuredResult,
    type WanderDomainItem,
} from '../electron/core/wanderDomain.ts';
import {
    normalizeWanderHistorySubjectRefs,
    resolveWanderHistorySourceMode,
} from '../src/utils/wanderHistory.ts';

const embeddedCommentNote: WanderDomainItem = {
    id: 'note-1',
    type: 'note',
    title: '减脂早餐',
    content: '正文内容',
    meta: {
        type: 'xhs-note',
        sourceUrl: 'https://www.xiaohongshu.com/explore/note-1?xsec_token=abc',
        commentsSnapshot: [
            { author: '小王', text: '不吃主食不会反弹吗？', likes: 12 },
            { author: '小李', text: '上班族早上根本没时间做', likes: 8 },
        ],
    },
};

const dedicatedCommentNote: WanderDomainItem = {
    id: 'comments-note-1',
    type: 'note',
    title: '减脂早餐 - 评论快照',
    content: '评论正文',
    meta: {
        type: 'xhs-comments',
        sourceUrl: 'https://www.xiaohongshu.com/explore/note-1',
        commentsSnapshot: [
            { author: '小王', text: '不吃主食不会反弹吗？', likes: 12 },
            { author: '小李', text: '上班族早上根本没时间做', likes: 8 },
            { author: '小张', text: '有没有五分钟版本？', likes: 20 },
        ],
    },
};

test('comment candidates include embedded and dedicated comments and deduplicate by source note', () => {
    const candidates = listCommentCandidatesFromItems([
        embeddedCommentNote,
        dedicatedCommentNote,
        { id: 'plain', type: 'note', title: '普通笔记', content: '没有评论', meta: { type: 'xhs-note' } },
    ]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.id, 'comments-note-1');
    assert.equal(candidates[0]?.meta?.sourceType, 'xhs-comments');
    assert.equal(candidates[0]?.meta?.commentCount, 3);
    assert.match(candidates[0]?.content || '', /有没有五分钟版本/);
});

test('comment deduplication prefers captured comment text over an inflated total count', () => {
    const emptyDedicated = {
        ...dedicatedCommentNote,
        content: '当前页面未采集到评论。',
        meta: {
            ...dedicatedCommentNote.meta,
            commentsSnapshot: [],
            stats: { comments: 99 },
        },
    };
    const candidates = listCommentCandidatesFromItems([emptyDedicated, embeddedCommentNote]);
    assert.equal(candidates[0]?.id, 'note-1');
    assert.match(candidates[0]?.content || '', /不吃主食不会反弹吗/);
});

test('inspiration candidates exclude pure comment snapshots but keep ordinary notes with embedded comments', () => {
    const candidates = listInspirationCandidates([embeddedCommentNote, dedicatedCommentNote]);
    assert.deepEqual(candidates.map((item) => item.id), ['note-1']);
    assert.equal(isCommentOnlyWanderItem(dedicatedCommentNote), true);
});

test('source mode uses explicit structured aliases', () => {
    assert.equal(normalizeWanderSourceMode('comments'), 'comment_insight');
    assert.equal(normalizeWanderSourceMode('comment_insight'), 'comment_insight');
    assert.equal(normalizeWanderSourceMode('random'), 'inspiration');
});

test('random comment mode selects exactly one normalized comment source', () => {
    const candidates = listCommentCandidatesFromItems([
        embeddedCommentNote,
        dedicatedCommentNote,
        {
            ...embeddedCommentNote,
            id: 'note-2',
            meta: { ...embeddedCommentNote.meta, sourceUrl: 'https://www.xiaohongshu.com/explore/note-2' },
        },
    ]);
    const selected = pickRandomWanderItems(candidates, 1);
    assert.equal(selected.length, 1);
    assert.equal(selected[0]?.meta?.sourceType, 'xhs-comments');
});

test('mode prompts remain distinct and selected subjects are hard constraints', () => {
    const subjects = [{
        id: 'subject-1',
        name: '晨光燕麦',
        categoryId: 'subject_cat_brand',
        categoryName: '品牌',
        description: '低糖即食燕麦',
        tags: ['早餐'],
        attributes: [{ key: '卖点', value: '五分钟完成' }],
    }];
    const commentPrompt = buildWanderAgentPrompt({
        sourceMode: 'comment_insight',
        items: listCommentCandidatesFromItems([dedicatedCommentNote]),
        subjects,
        multiChoice: false,
    });
    assert.match(commentPrompt, /评论区洞察/);
    assert.match(commentPrompt, /真实问题、痛点、反对意见/);
    assert.match(commentPrompt, /晨光燕麦/);
    assert.match(commentPrompt, /subject-1/);
    assert.match(commentPrompt, /硬约束/);
    assert.doesNotMatch(commentPrompt, /发现至少两条素材之间/);

    const inspirationPrompt = buildWanderAgentPrompt({
        sourceMode: 'inspiration',
        items: [embeddedCommentNote, { ...embeddedCommentNote, id: 'note-2' }, { ...embeddedCommentNote, id: 'note-3' }],
        subjects: [],
        multiChoice: true,
    });
    assert.match(inspirationPrompt, /灵感漫步/);
    assert.match(inspirationPrompt, /options 必须恰好包含 3 个/);
    assert.doesNotMatch(inspirationPrompt, /只分析评论语料/);
});

test('media constraints expose a resolvable media lookup command', () => {
    const prompt = buildWanderAgentPrompt({
        sourceMode: 'inspiration',
        items: [embeddedCommentNote, { ...embeddedCommentNote, id: 'note-2' }, { ...embeddedCommentNote, id: 'note-3' }],
        subjects: [{
            id: 'media_123',
            name: '猫粮封面',
            categoryName: '媒体',
            description: '橘猫和猫粮袋的封面图',
            tags: ['媒体', 'image/png'],
            attributes: [{ key: '画幅', value: '3:4' }],
        }],
        multiChoice: false,
    });
    assert.match(prompt, /ID：media_123/);
    assert.match(prompt, /media get --asset-id "media_123"/);
});

test('comment insight result normalization validates mode-specific fields and real scores', () => {
    const result = normalizeWanderStructuredResult({
        source_mode: 'comment_insight',
        content_direction: '回答上班族五分钟早餐的真实执行难题',
        thinking_process: ['时间成本是主要阻力'],
        direction_frame: {
            target_reader: '工作日早晨很赶的上班族',
            core_tension: '想健康饮食但没有准备时间',
            angle: '五分钟实测',
            material_entry: '高赞评论里的时间质疑',
        },
        topic: { title: '五分钟早餐真能吃好吗', connections: [1] },
        evaluation: { heat: 82, freshness: 74, writability: 91, fit: 88, overall: 85, rationale: '需求具体' },
        comment_insight: {
            questions: ['会不会反弹？'],
            pain_points: ['早上没有时间'],
            objections: ['健康早餐太麻烦'],
            demand_signals: ['需要五分钟版本'],
            opportunity: '用实测解决时间成本质疑',
        },
        subject_alignment: [{ id: 'subject-1', usage: '作为五分钟早餐方案中的指定产品' }],
    }, 'comment_insight', false);
    assert.equal(result.source_mode, 'comment_insight');
    assert.equal(result.evaluation?.overall, 85);
    assert.deepEqual(validateWanderStructuredResult(result, false, ['subject-1']), []);
    assert.equal(validateWanderStructuredResult(result, false, ['missing-subject'])[0]?.code, 'missing_subject_alignment');

    const invalid = normalizeWanderStructuredResult({ content_direction: '只有方向' }, 'comment_insight', false);
    assert.ok(validateWanderStructuredResult(invalid, false).length >= 4);
});

test('model JSON parsing accepts fenced responses', () => {
    assert.deepEqual(parseWanderJsonPayload('```json\n{"source_mode":"inspiration"}\n```'), {
        source_mode: 'inspiration',
    });
});

test('model result normalization accepts documented asset and material aliases', () => {
    const result = normalizeWanderStructuredResult({
        content_direction: '把宠物反差人设和养宠好物连接起来',
        thinking_process: '1) 从人设反差切入\n2) 用好物内容承接收藏价值',
        direction_frame: {
            target_reader: '养宠用户',
            core_tension: '可爱日常与养宠成本的冲突',
            angle: '宠物拟人叙事',
            material_entry: '三条素材的共同场景',
        },
        topic: {
            title: '我家一猫一狗到底谁说了算',
            connections: ['素材1提供情绪钩子', '素材3提供实用内容'],
        },
        evaluation: { heat: 80, freshness: 75, writability: 90, fit: 88, overall: 83 },
        subject_alignment: [{
            asset_id: 'media-1',
            role: '封面主视觉',
        }],
    }, 'inspiration', false);

    assert.deepEqual(result.topic.connections, [1, 3]);
    assert.deepEqual(result.thinking_process, ['1) 从人设反差切入', '2) 用好物内容承接收藏价值']);
    assert.deepEqual(result.subject_alignment, [{ id: 'media-1', usage: '封面主视觉' }]);
    assert.deepEqual(validateWanderStructuredResult(result, false, ['media-1']), []);
});

test('multi-choice inspiration validates every candidate instead of only the selected one', () => {
    const completeOption = {
        content_direction: '连接早餐效率与健康管理',
        direction_frame: {
            target_reader: '上班族',
            core_tension: '时间与健康冲突',
            angle: '实测',
            material_entry: '三条素材的共同场景',
        },
        topic: { title: '五分钟早餐怎么兼顾健康', connections: [1, 2, 3] },
        evaluation: { heat: 80, freshness: 80, writability: 80, fit: 80, overall: 80 },
    };
    const result = normalizeWanderStructuredResult({
        options: [
            completeOption,
            { ...completeOption, topic: { ...completeOption.topic, title: '早餐效率的真实成本' }, evaluation: undefined },
            { ...completeOption, topic: { ...completeOption.topic, title: '健康早餐能否成为习惯' } },
        ],
        selected_index: 0,
    }, 'inspiration', true);
    assert.ok(validateWanderStructuredResult(result, true).some((issue) => issue.path === 'options.1.evaluation'));
});

test('history records preserve source labels and subject snapshots', () => {
    assert.equal(resolveWanderHistorySourceMode({ sourceMode: 'comment_insight', items: [] }), 'comment_insight');
    assert.equal(resolveWanderHistorySourceMode({
        items: [{ meta: { sourceType: 'xhs-comments' } }],
    }), 'comment_insight');
    assert.equal(resolveWanderHistorySourceMode({
        resultSourceMode: 'inspiration',
        items: [{ meta: { sourceType: 'xhs-comments' } }],
    }), 'comment_insight');

    const refs = normalizeWanderHistorySubjectRefs(JSON.stringify([{
        id: 'subject-1',
        name: '晨光燕麦',
        categoryName: '商品',
        tags: ['早餐'],
        attributes: [{ key: '卖点', value: '五分钟完成' }],
    }]));
    assert.equal(refs[0]?.name, '晨光燕麦');
    assert.deepEqual(refs[0]?.attributes, [{ key: '卖点', value: '五分钟完成' }]);
    assert.deepEqual(normalizeWanderHistorySubjectRefs(null), []);
});
