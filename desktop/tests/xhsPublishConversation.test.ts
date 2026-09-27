import assert from 'node:assert/strict';
import test from 'node:test';
import { canAmendXhsDraft, parseXhsPublishReply, selectXhsConversationJob } from '../electron/core/xhsPublishConversation.ts';
import { applyXhsPublishWorkflowPolicy } from '../electron/core/ai/xhsPublishWorkflowPolicy.ts';
import { validateRuntimeCompletion } from '../electron/core/ai/runtimeCompletion.ts';
import { hasXhsUnpublishedReview, sameXhsPublishMedia } from '../shared/xhsPublisher.ts';
import type { XhsPublishJob } from '../shared/xhsPublisher.ts';
import type { IntentRoute } from '../electron/core/ai/types.ts';

const old = { id: 'old', sessionId: 's', projectPath: '/n', revision: 2, createdAt: 2, noteType: 'video',
    extensionInstanceId: 'browser', status: 'blocked', publishStatus: 'not_submitted',
    media: [{ path: '/immutable/video.mp4', role: 'video' }] } as XhsPublishJob;
const next = { ...old, id: 'next', revision: 4, createdAt: 4, status: 'awaiting_confirmation' as const };

test('failed/unknown publication context selects latest revision, never first of several projects', () => {
    assert.equal(selectXhsConversationJob([old,next], 's')?.id, 'next');
    assert.equal(selectXhsConversationJob([old,{...next,projectPath:'/other'}], 's'), null);
    assert.equal(selectXhsConversationJob([old,{...next,projectPath:'/other'}], 's','/n')?.id, 'old');
    assert.equal(selectXhsConversationJob([old], 'other'), null);
});

test('classification requires literal scoped authorization and manual assertion, not truthy values', () => {
    assert.equal(parseXhsPublishReply({intent:'confirm',confidence:1}).publicationRequested, false);
    assert.equal(parseXhsPublishReply({intent:'recover',confidence:1,acknowledgedNotPublished:'true'}).acknowledgedNotPublished, false);
    assert.equal(parseXhsPublishReply({intent:'recover',confidence:1,acknowledgedNotPublished:true}).acknowledgedNotPublished, true);
    assert.equal(parseXhsPublishReply(null).confidence, 0);
    assert.equal(parseXhsPublishReply({intent:'confirm',confidence:'Infinity',publicationRequested:true}).confidence, 0);
    assert.equal(parseXhsPublishReply({intent:'modify',confidence:1,publicationRequested:true}).publicationRequested, false);
    assert.equal(parseXhsPublishReply({intent:'resume',confidence:1,publicationRequested:true}).publicationRequested, false);
});

test('publish action cannot complete with a prepare receipt or independent MP4', () => {
    const route = { intent:'xhs_publishing', workflowKind:'xhs-publish', requiredCapabilities:[], goal:'重发',
        xhsPublishAction:parseXhsPublishReply({intent:'confirm',confidence:1,publicationRequested:true}) } as IntentRoute;
    for (const state of ['not-called','inspected','awaiting-confirmation','blocked'] as const) {
        const result = validateRuntimeCompletion({route,xhsPublishState:state});
        assert.equal(result.complete,false);
        assert.equal(result.maxRecoveryAttempts,0);
        assert.match(result.feedback!,/准备稿件不能/);
    }
});

test('persisted unpublished review is scoped to its job session and never changes the platform receipt', () => {
    const job = {...old,publishStatus:'unknown',unpublishedReview:{kind:'user-verified-not-published',sessionId:'s',reviewedAt:100}} as XhsPublishJob;
    assert.equal(hasXhsUnpublishedReview(job),true);
    assert.equal(job.publishStatus,'unknown');
    assert.equal(hasXhsUnpublishedReview({...job,sessionId:'foreign'}),false);
    assert.equal(hasXhsUnpublishedReview({...job,unpublishedReview:undefined}),false);
    assert.equal(hasXhsUnpublishedReview({...job,unpublishedReview:{...job.unpublishedReview!,reviewedAt:NaN}}),false);
});

test('in-place amendment requires same session/project/browser/media and safe previous state', () => {
    assert.equal(canAmendXhsDraft(old,next,'browser'), true);
    for (const changed of [{sessionId:'foreign'}, {projectPath:'/other'}, {extensionInstanceId:'other'}, {media:[]}, {publishStatus:'unknown'}]) {
        assert.equal(canAmendXhsDraft({...old,...changed} as XhsPublishJob,next,'browser'), false);
    }
    assert.equal(canAmendXhsDraft({...old,status:'superseded',publishStatus:'unknown',errorCode:'USER_VERIFIED_NOT_PUBLISHED'}, next,'browser'), true);
});

test('desktop and publisher media identity ignore record key order but preserve every field and media order', async () => {
    const { samePublishMedia } = await import('../../PublishPlugin/src/pageAdapter.js');
    const media = [
        { slotId: 'final-video', role: 'video', path: '/video.mp4', mimeType: 'video/mp4', order: 0 },
        { slotId: 'cover', role: 'cover', path: '/cover.png', mimeType: 'image/png', order: 1 },
    ];
    const stored = media.map(item => Object.fromEntries(Object.entries(item).reverse()));
    for (const compare of [sameXhsPublishMedia, samePublishMedia]) {
        assert.equal(compare(media, stored), true);
        assert.equal(compare(media, [...stored].reverse()), false);
        for (const [field, value] of Object.entries({ slotId: 'other', role: 'cover', path: '/other.mp4', mimeType: 'video/webm', order: 1 })) {
            assert.equal(compare(media, [{ ...stored[0], [field]: value }, stored[1]]), false, field);
        }
        assert.equal(compare(media, [{ ...stored[0], order: '0' }, stored[1]]), false);
        assert.equal(compare(media, [{ ...stored[0], checksum: 'unexpected' }, stored[1]]), false);
        const { mimeType: _mime, ...missing } = stored[0];
        assert.equal(compare(media, [missing, stored[1]]), false);
        assert.equal(compare(media, null), false);
    }
    assert.equal(canAmendXhsDraft({ ...old, media } as XhsPublishJob, { ...next, media: stored } as XhsPublishJob, 'browser'), true);
});

test('semantic modification metadata forces publication routing, not ordinary writing/search', () => {
    const route = { intent:'manuscript_creation', goal:'改标题', requiredCapabilities:['writing'], recommendedRole:'copywriter',
        confidence:1, reasoning:'fallback', source:'rule' } as IntentRoute;
    const result = applyXhsPublishWorkflowPolicy(route, {sessionId:'s',runtimeMode:'gardenflow',userInput:route.goal,
        metadata:{workflowKind:'xhs-publish',xhsPublishContext:{jobId:'old',status:'blocked'}}});
    assert.equal(result.workflowKind,'xhs-publish');
    assert.equal(result.requiresHumanApproval,true);
    assert.equal(result.requiresMultiAgent,false);
    assert.equal(applyXhsPublishWorkflowPolicy(route,{sessionId:'s',runtimeMode:'gardenflow',userInput:'写另一篇稿件'}).workflowKind,undefined);
});
