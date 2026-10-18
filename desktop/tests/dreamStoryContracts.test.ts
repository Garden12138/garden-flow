import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDreamStoryTarget, DreamStoryTargetSchema } from '../shared/contentCreationTarget.ts';
import { validateDreamDirector, dreamCanonical } from '../shared/dreamStory.ts';
import { reduceDreamStory } from '../shared/dreamStoryReducer.ts';
import { dreamStoryTimeline } from '../shared/dreamStoryTimeline.ts';
import { buildVideoEditorV2RemotionComposition } from '../shared/videoAutoEditRemotion.ts';
import { dreamShareDocument } from '../shared/dreamStoryExport.ts';
import { dreamDirector } from './helpers/dreamStoryFixture.ts';
import { memoryEligibleSessions } from '../shared/sessionPrivacy.ts';
import { applyDreamStoryWorkflowPolicy } from '../electron/core/ai/dreamStoryWorkflowPolicy.ts';
import { resolveModelScopeFromContextType } from '../electron/core/modelScopeSettings.ts';

test('dream target is authoritative and preserves the v1 defaults', () => {
    const target = resolveDreamStoryTarget();
    assert.equal(target.language, 'en'); assert.equal(target.market, 'International'); assert.equal(target.targetDurationMs, 72000);
    assert.equal(target.narration, true); assert.equal(target.subtitles, true);
    assert.throws(() => DreamStoryTargetSchema.parse({ ...target, spec: { ...target.spec, width: 1920 } }));
    assert.throws(() => resolveDreamStoryTarget({ targetDurationMs: 59000 }));
    assert.throws(() => resolveDreamStoryTarget({ language: 'English' }));
    assert.equal(dreamCanonical({ b: 1, a: 2 }), dreamCanonical({ a: 2, b: 1 }));
});
test('director validates stable IDs, original references, locked imagery and target language', () => {
    const director = dreamDirector('fragment'); const fragments = [{ id: 'fragment', text: '海', locked: true }];
    assert.equal(validateDreamDirector(director, fragments, resolveDreamStoryTarget()).scenes.length, 8);
    assert.throws(() => validateDreamDirector({ ...director, language: 'zh-CN' }, fragments, resolveDreamStoryTarget()), /语言/);
    assert.throws(() => validateDreamDirector({ ...director, preservedFragmentIds: [] }, fragments), /锁定/);
    assert.throws(() => validateDreamDirector({ ...director, scenes: director.scenes.map(() => director.scenes[0]) }, fragments), /重复/);
    assert.throws(() => validateDreamDirector(director, []), /引用/);
});
test('reordering preserves IDs and locked scenes require a distinct unlock', () => {
    const doc: any = { fragments: [{ id: 'fragment', text: 'sea', locked: true }], director: dreamDirector('fragment'), undo: [], versions: [], candidates: [], media: {}, revision: 'r', draftEpoch: 0 };
    doc.director.scenes[0].locked = true;
    assert.throws(() => reduceDreamStory(doc, [{ type: 'scene.update', sceneId: 'scene_0', changes: { narration: 'Changed' } }], 'v', 'now'), /解锁/);
    assert.throws(() => reduceDreamStory(doc, [{ type: 'record.save', fragments: [] }], 'v', 'now'), /解锁/);
    const ids = doc.director.scenes.map((scene: any) => scene.id).reverse();
    const next = reduceDreamStory(doc, [{ type: 'scene.order', sceneIds: ids }], 'v', 'now');
    assert.deepEqual(next.director!.scenes.map(scene => scene.id), ids);
    assert.equal(doc.director.scenes[0].id, 'scene_0');
});
test('actual audio extends a still frame, captions remain inside it and never overlap', () => {
    const director = dreamDirector('fragment'); const project: any = { assets: [], timeline: { id: 't', durationMs: 0, tracks: [] }, dreamStory: {
        director, target: resolveDreamStoryTarget(), media: { scene_0: { audio: { assetId: 'audio', durationMs: 11000 } } }, voiceVolume: 1 } };
    const timeline = dreamStoryTimeline(project);
    assert.equal(timeline.tracks[0].clips[0].timelineEndMs, 11000); assert.equal(timeline.durationMs, 74000);
    const cues = timeline.tracks.find(track => track.kind === 'subtitle')!.clips;
    assert.ok(cues.every((cue, index) => cue.timelineEndMs > cue.timelineStartMs && (!index || cue.timelineStartMs >= cues[index - 1].timelineEndMs)));
    project.dreamStory.captions = [{ sceneId: 'scene_0', text: 'Invalid', startMs: 0, endMs: 12000 }];
    assert.throws(() => dreamStoryTimeline(project), /字幕/);
});
test('long automatic captions preserve words and audio coverage while manual cues remain unchanged', () => {
    const director = dreamDirector('fragment');
    const narration = 'Every desk in the classroom is occupied, and after searching every row I finally sit down beside the quiet window.';
    director.scenes[0].narration = narration;
    const project: any = { assets: [], timeline: { id: 't', tracks: [] }, dreamStory: { director, target: resolveDreamStoryTarget(),
        media: { scene_0: { audio: { assetId: 'voice', durationMs: 6230 } } }, voiceVolume: 1 } };
    const cues = dreamStoryTimeline(project).tracks.find(track => track.kind === 'subtitle')!.clips.filter(cue => cue.sceneId === 'scene_0');
    assert.ok(cues.length > 1); assert.ok(cues.every(cue => Array.from(cue.text!).length <= 64));
    assert.equal(cues.map(cue => cue.text).join(' '), narration);
    assert.equal(cues[0].timelineStartMs, 0); assert.equal(cues.at(-1)!.timelineEndMs, 6230);
    assert.ok(cues.every((cue, index) => !index || cue.timelineStartMs === cues[index - 1].timelineEndMs));
    project.dreamStory.captions = [{ sceneId: 'scene_0', text: narration, startMs: 100, endMs: 6000 }];
    const manual = dreamStoryTimeline(project).tracks.find(track => track.kind === 'subtitle')!.clips;
    assert.equal(manual.length, 1); assert.equal(manual[0].text, narration); assert.equal(manual[0].timelineStartMs, 100);
    project.dreamStory.captions = undefined; director.scenes[0].narration = '海'.repeat(130) + '。';
    const unicode = dreamStoryTimeline(project).tracks.find(track => track.kind === 'subtitle')!.clips.filter(cue => cue.sceneId === 'scene_0');
    assert.equal(unicode.map(cue => cue.text).join(''), director.scenes[0].narration);
});
test('dream captions use compact portrait typography without changing product captions', () => {
    const project: any = { projectKind: 'dream-story', title: 'test', assets: [{ id: 'image', kind: 'image', projectPath: '/tmp/scene.png' }],
        canvas: { width: 1080, height: 1920, fps: 30 }, timeline: { durationMs: 9000, tracks: [
            { kind: 'primary-video', clips: [{ id: 'scene', assetId: 'image', timelineStartMs: 0, timelineEndMs: 9000 }] },
            { kind: 'subtitle', clips: [{ id: 'caption', text: 'A quiet classroom.', timelineStartMs: 0, timelineEndMs: 3000 }] },
        ] } };
    const dream = buildVideoEditorV2RemotionComposition(project)!.scenes[0];
    assert.equal(dream.overlays![0].fontSize, 48); assert.equal(dream.overlays![0].captionLayout, 'compact');
    assert.equal(dream.overlays![0].position, 'bottom'); assert.equal(dream.safeInsets!.bottom, 320);
    project.projectKind = 'product-video'; const product = buildVideoEditorV2RemotionComposition(project)!.scenes[0];
    assert.equal(product.overlays![0].fontSize, 84); assert.equal(product.overlays![0].captionLayout, undefined);
});
test('sharing uses an explicit projection without raw dreams, private prompts or engineering paths', () => {
    const doc: any = { fragments: [{ text: 'PRIVATE_RAW_DREAM' }], director: dreamDirector('fragment'), versions: [{ secret: 'old' }], media: {}, target: resolveDreamStoryTarget(), apiKey: 'SECRET', projectDir: '/private/person' };
    doc.director.scenes[0].imagePrompt = 'PRIVATE_IMAGE_PROMPT';
    const json = JSON.stringify(dreamShareDocument(doc));
    for (const forbidden of ['PRIVATE_RAW_DREAM', 'PRIVATE_IMAGE_PROMPT', 'SECRET', '/private/person', 'versions']) assert.ok(!json.includes(forbidden));
    assert.ok(json.includes(doc.director.story));
});
test('private dreams stay excluded when memory has no ordinary GardenFlow sessions to prefer', () => {
    const dream = { id: 'dream', metadata: JSON.stringify({ contextType: 'dream-story', privacyScope: 'project' }) };
    const ordinary = { id: 'ordinary', metadata: JSON.stringify({ contextType: 'chat' }) };
    assert.deepEqual(memoryEligibleSessions([dream, ordinary]).map(session => session.id), ['ordinary']);
    assert.deepEqual(memoryEligibleSessions([dream]), []);
});
test('explicit dream workflow overrides a default knowledge route and uses the creation model scope', () => {
    const route: any = { intent: 'knowledge_retrieval', requiredCapabilities: [], recommendedRole: 'researcher', requiresMultiAgent: true };
    const result = applyDreamStoryWorkflowPolicy(route, { metadata: { workflowKind: 'dream-story-create', dreamStoryTurn: { projectId: 'owned' } } } as any);
    assert.equal(result.workflowKind, 'dream-story-create'); assert.equal(result.intent, 'manuscript_creation'); assert.equal(result.requiresMultiAgent, false);
    assert.equal(resolveModelScopeFromContextType('dream-story'), 'gardenflow');
    assert.equal(applyDreamStoryWorkflowPolicy(route, { metadata: {} } as any), route);
});
