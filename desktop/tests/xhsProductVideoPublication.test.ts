import assert from 'node:assert/strict';
import test from 'node:test';
import { applyXhsPublishWorkflowPolicy, isXhsPublishWorkflowTool, validateXhsPublishCompletion } from '../electron/core/ai/xhsPublishWorkflowPolicy.ts';
import { applyProductVideoWorkflowPolicy } from '../electron/core/ai/productVideoWorkflowPolicy.ts';
import { shouldUseCoordinator, shouldRunSubagentOrchestration } from '../electron/core/ai/orchestrationPolicy.ts';
import { prepareXhsPublication, selectPublishProjectId, type XhsPublishPreparationDependencies } from '../electron/core/xhsPublishPreparation.ts';
import { videoRenderFingerprint, assertCurrentVideoExport } from '../electron/core/video-editor-v2/videoPublicationPolicy.ts';
import { canExecuteXhsPublication, type XhsPublishJob } from '../shared/xhsPublisher.ts';
import { normalizeXhsNoteDocument, type XhsNoteProjectSnapshot } from '../shared/xhsNote.ts';
import type { VideoEditorV2Project } from '../shared/videoAutoEdit.ts';
import type { IntentRoute } from '../electron/core/ai/types.ts';
import { validateRuntimeCompletion } from '../electron/core/ai/runtimeCompletion.ts';

const route: IntentRoute = {
    intent: 'xhs_publishing', goal: '发布这个视频到小红书', requiredCapabilities: ['video-generation'],
    recommendedRole: 'video-director', requiresMultiAgent: true, requiresLongRunningTask: true,
    requiresHumanApproval: false, confidence: 0.9, reasoning: 'publication', source: 'llm+rule',
};

test('session_1790235694798 publication is foreground approval, not product video generation', () => {
    const context = { sessionId: 'session_1790235694798', runtimeMode: 'gardenflow' as const, userInput: route.goal, metadata: { explicitProductRefs: [{ productId: 'p1', name: '猫粮', updatedAt: '2026' }] } };
    const actual = applyXhsPublishWorkflowPolicy(applyProductVideoWorkflowPolicy(route, context), context);
    assert.equal(actual.workflowKind, 'xhs-publish');
    assert.equal(actual.requiresHumanApproval, true);
    assert.equal(actual.recommendedRole, 'copywriter');
    assert.equal(actual.requiredCapabilities.includes('video-generation'), false);
    assert.equal(shouldUseCoordinator({ runtimeMode: 'gardenflow', route: actual }), false);
    assert.equal(shouldRunSubagentOrchestration({ runtimeMode: 'gardenflow', route: actual }), false);
    assert.equal(isXhsPublishWorkflowTool('video_generate'), false);
    assert.equal(isXhsPublishWorkflowTool('bash'), false);
    assert.equal(isXhsPublishWorkflowTool('xhs_publish_prepare'), true);
    assert.equal(validateXhsPublishCompletion('not-called').complete, false);
    assert.equal(validateXhsPublishCompletion('inspected').complete, false);
    assert.equal(validateXhsPublishCompletion('awaiting-confirmation').complete, true);
    assert.equal(validateXhsPublishCompletion('blocked').complete, true);
    assert.equal(validateRuntimeCompletion({ route: actual, artifacts: [{ id: 'mp4', type: 'video', label: '独立MP4', createdAt: 1 }] }).complete, false);
});

test('manual publication does not silently enable or depend on the automatic trigger', () => {
    assert.equal(canExecuteXhsPublication({ triggerOrigin: 'explicit-request' }, false), true);
    assert.equal(canExecuteXhsPublication({ triggerOrigin: 'artifact-ready' }, false), false);
    assert.equal(canExecuteXhsPublication({}, false), false);
    assert.equal(canExecuteXhsPublication({}, true), true);
});

test('multiple videos require selection, duplicate artifact receipts do not', () => {
    assert.equal(selectPublishProjectId(['p1', 'p1']), 'p1');
    assert.throws(() => selectPublishProjectId(['p1', 'p2']), /多个/);
    assert.throws(() => selectPublishProjectId([]), /没有绑定/);
    assert.equal(selectPublishProjectId(['p1', 'p2'], 'p2'), 'p2');
});

function fixtureProject(): VideoEditorV2Project {
    return {
        version: 2, id: 'video_edit_v2_fixture', title: '猫粮视频', projectKind: 'product-video', projectDir: '/workspace/p1',
        status: 'exported', createdAt: '2026-09-24', updatedAt: '2026-09-26',
        canvas: { width: 1080, height: 1920, fps: 30, aspectRatio: '9:16' },
        assets: [], transcriptTracks: [], autoEditRuns: [], undoStack: [],
        timeline: { durationMs: 27000, tracks: [{ id: 'v1', kind: 'primary-video', name: '画面', clips: [{ id: 'clip1', trackId: 'v1', kind: 'video', text: '真实商品文字', timelineStartMs: 0, timelineEndMs: 27000, sourceStartMs: 0, sourceEndMs: 27000 }] }] },
        renderOutputs: [{ id: 'r1', path: '/workspace/video.mp4', mediaAssetId: 'media1', createdAt: '2026-09-24', durationMs: 27000 }],
    };
}

test('export fingerprint ignores save metadata but detects duration/text/audio changes', () => {
    const project = fixtureProject();
    const fingerprint = videoRenderFingerprint(project);
    project.renderOutputs[0].renderFingerprint = fingerprint;
    assert.doesNotThrow(() => assertCurrentVideoExport(project));
    project.updatedAt = '2099-01-01';
    assert.equal(videoRenderFingerprint(project), fingerprint);
    project.timeline.tracks[0].clips[0].timelineEndMs = 28000;
    assert.throws(() => assertCurrentVideoExport(project), /重新导出/);
    project.timeline.tracks[0].clips[0].timelineEndMs = 27000;
    project.timeline.tracks[0].clips[0].text = '改过的文字';
    assert.throws(() => assertCurrentVideoExport(project), /重新导出/);
    project.timeline.tracks[0].clips[0].text = '真实商品文字';
    project.timeline.tracks.push({ id: 'bgm', kind: 'music', name: 'BGM', clips: [{ id: 'music1', assetId: 'audio1', trackId: 'bgm', kind: 'music', timelineStartMs: 0, timelineEndMs: 27000, sourceStartMs: 0, sourceEndMs: 27000, volume: 0.2 }] });
    assert.throws(() => assertCurrentVideoExport(project), /重新导出/);
});

test('legacy exports are accepted only with a matching verified composition snapshot', () => {
    const project = fixtureProject();
    assert.throws(() => assertCurrentVideoExport(project), /旧成片/);
    assert.doesNotThrow(() => assertCurrentVideoExport(project, videoRenderFingerprint(project)));
    project.renderOutputs = [];
    assert.throws(() => assertCurrentVideoExport(project), /先.*导出/);
});

function preparationHarness() {
    let note: XhsNoteProjectSnapshot | undefined;
    const calls: string[] = [];
    const job = { id: 'job1', status: 'awaiting_confirmation', publishStatus: 'not_submitted', triggerOrigin: 'explicit-request' } as XhsPublishJob;
    const deps: XhsPublishPreparationDependencies = {
        readSource: async () => { calls.push('read'); return { projectId: 'video_edit_v2_fixture', assetId: 'media1', title: '猫粮', durationSeconds: 27, aspectRatio: '9:16', sourceVideoExport: { projectId: 'video_edit_v2_fixture', renderId: 'r1', mediaAssetId: 'media1', renderFingerprint: 'abc' } }; },
        getNote: async () => { if (!note) throw new Error('缺少 note.json'); return note; },
        saveNote: async (input) => {
            calls.push('save');
            note = { artifactType: 'xiaohongshu-note', noteType: 'video', projectPath: input.path, relativePath: input.path, uri: `manuscripts://${input.path}`, version: (note?.version || 0) + 1, document: normalizeXhsNoteDocument({ ...note?.document, ...(input.document as object) }, 'video') };
            return note;
        },
        bindMedia: async (input) => {
            calls.push('bind');
            assert.equal(input.slotId, 'final-video');
            assert.equal(input.assetId, 'media1');
            assert.ok(note);
            note.document = { ...note.document, generationStatus: 'generated', mediaSlots: note.document.mediaSlots.map((slot) => slot.id === 'final-video' ? { ...slot, assetId: input.assetId, status: 'ready', sourcePath: 'generated/media1.mp4' } : slot) };
            return note;
        },
        requestConsent: async () => { calls.push('consent'); return job; },
    };
    return { deps, calls };
}

test('inspect is read-only; prepare binds real export before durable consent, never uploads', async () => {
    const { deps, calls } = preparationHarness();
    const inspected = await prepareXhsPublication('s1', { operation: 'inspect' }, deps);
    assert.equal(inspected.kind, 'xhs-publish-source');
    assert.deepEqual(calls, ['read']);
    calls.length = 0;
    const result = await prepareXhsPublication('s1', { operation: 'prepare', title: '海洋鱼味猫粮', body: '规格10kg', hashtags: ['#猫粮', '猫粮'] }, deps);
    assert.equal(result.kind, 'xhs-publish-prepared');
    assert.deepEqual(calls, ['read', 'save', 'bind', 'consent']);
    if (result.kind === 'xhs-publish-prepared') {
        assert.equal(result.job.publishStatus, 'not_submitted');
        assert.equal(result.note.document.sourceVideoExport?.renderId, 'r1');
        assert.deepEqual(result.note.document.hashtags, ['猫粮']);
    }
    calls.length = 0;
    await prepareXhsPublication('s1', { operation: 'prepare', title: '海洋鱼味猫粮', body: '规格10kg', hashtags: ['#猫粮', '猫粮'] }, deps);
    assert.deepEqual(calls, ['read', 'consent']);
    calls.length = 0;
    await prepareXhsPublication('s1', { operation: 'prepare', title: '新标题', body: '规格10kg' }, deps);
    assert.deepEqual(calls, ['read', 'save', 'bind', 'consent']);
});

test('missing video or stale export stops before creating a note or a publication job', async () => {
    const { deps, calls } = preparationHarness();
    deps.readSource = async () => { throw new Error('工程已修改，请重新导出'); };
    await assert.rejects(() => prepareXhsPublication('s1', { operation: 'prepare', title: '标题', body: '正文' }, deps), /重新导出/);
    assert.deepEqual(calls, []);
});
