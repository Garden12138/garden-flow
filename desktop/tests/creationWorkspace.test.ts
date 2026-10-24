import { resolveModelScopeFromContextType } from '../electron/core/modelScopeSettings.ts';
import { directDreamEditOperations } from '../shared/dreamStoryReducer.ts';
import { mergeCreationDraft } from '../shared/mergeCreationDraft.ts';
import { dreamDirector, dreamRequest } from './helpers/dreamStoryFixture.ts';
// Run: pnpm --dir desktop exec node --test tests/creationWorkspace.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { productVideoHarness } from './helpers/productVideoHarness.ts';
import { createProductVideoVerificationPng } from '../electron/core/productVideoVerificationImage.ts';
import { CreationStartSchema, supportsCreation } from '../shared/creationWorkspace.ts';
import { previewProductEdits } from '../shared/creationPreview.ts';
const turn = (value: any) => ({ workspaceId: value.id, spaceId: value.spaceId, requestId: crypto.randomUUID(), expectedRevision: value.revision, expectedDraftEpoch: value.draftEpoch });
async function fixture(t: any) {
    const h = await productVideoHarness({ platformVersions: true, productImageSets: true, dreamStory: true, creationWorkspaces: true });
    t.after(() => h.close());
    const png = createProductVideoVerificationPng('GF-ABC123DEF456'); h.state.renderBytes = png;
    const bundle = await h.store.upsertProduct({ name: '三栏创作测试商品', images: [{ dataUrl: `data:image/png;base64,${png.toString('base64')}` }] });
    const product = await h.store.getProductCreativeReference(bundle.product.id);
    return { h, product };
}
test('every supported capability starts with a saved blank work and a single bound conversation without generation', async t => {
    const { h } = await fixture(t);
    assert.equal(resolveModelScopeFromContextType('creation-workspace'), 'gardenflow');
    for (const platform of ['xiaohongshu', 'douyin', 'tiktok']) for (const capability of ['note-image', 'note-video', 'product-video', 'product-remix', 'product-image-set', 'dream-story'] as const) {
        if (!supportsCreation(platform, capability)) { assert.equal(CreationStartSchema.safeParse({ platform, capability }).success, false); continue; }
        const value = await h.api.startCreationWorkspace({ platform, capability });
        const restored = await h.api.readCreationWorkspace(value.id);
        assert.equal(restored.sessionId, value.sessionId); assert.equal(restored.capability, capability);
        assert.equal(JSON.parse(h.state.sessions.get(value.sessionId).metadata).creationWorkspaceId, value.id);
        if (capability.startsWith('note-') || capability === 'dream-story') assert.ok(value.native);
    }
    assert.equal(h.state.imageCalls + h.state.ttsCalls + h.state.localizationCalls, 0);
});
test('work summaries exclude malformed, symbolic and foreign-space records and expose no native paths', async t => {
    const { h } = await fixture(t);
    assert.equal((await h.api.listCreationWorkspaceSummaries()).length, 0);
    const work = await h.api.startCreationWorkspace({ platform: 'xiaohongshu', capability: 'note-image' });
    const directory = path.join(h.root, 'default/gardenflow/creation-workspaces');
    await fs.writeFile(path.join(directory, 'bad.json'), '{');
    await fs.writeFile(path.join(directory, 'foreign.json'), JSON.stringify({ ...work, id: 'foreign', spaceId: 'other' }));
    await fs.writeFile(path.join(directory, 'malformed.json'), JSON.stringify({ ...work, id: 'malformed', updatedAt: 123 }));
    await fs.symlink(path.join(directory, work.id + '.json'), path.join(directory, 'symlink.json'));
    const list = await h.api.listCreationWorkspaceSummaries(); assert.equal(list.length, 1); assert.equal(list[0].id, work.id);
    assert.equal(list[0].native, undefined); assert.equal(list[0].spaceId, undefined);
    h.state.spaceId = 'other'; assert.equal((await h.api.listCreationWorkspaceSummaries()).length, 0);
});
test('incomplete manual drafts persist, undo and restart; stale model credentials cannot overwrite a new input', async t => {
    const { h } = await fixture(t);
    let value = await h.api.startCreationWorkspace({ platform: 'douyin', capability: 'product-video' });
    value = await h.api.saveCreationWorkspace({ ...turn(value), draft: { ...value.draft, title: '手动初稿', body: '还没有选择商品或素材' } });
    const stale = turn(value);
    value = await h.api.markCreationDraft(value.id);
    await assert.rejects(h.api.saveCreationWorkspace({ ...stale, draft: { ...value.draft, body: '旧模型内容' } }), /变化/);
    assert.equal((await h.api.readCreationWorkspace(value.id)).draft.body, '还没有选择商品或素材');
    h.restart(); value = await h.api.readCreationWorkspace(value.id);
    assert.equal(value.draft.title, '手动初稿');
    value = await h.api.undoCreationWorkspace(turn(value)); assert.equal(value.draft.title, '');
    await assert.rejects(h.api.readCreationWorkspace('../escape'));
    h.state.spaceId = 'another'; await assert.rejects(h.api.readCreationWorkspace(value.id));
});

test('existing Chinese space IDs can start, save, reopen and undo a workspace without accepting path IDs', async t => {
    const { h } = await fixture(t); h.state.spaceId = '中文品牌空间';
    let value = await h.api.startCreationWorkspace({ platform: 'douyin', capability: 'product-video', requestId: 'chinese_space' });
    value = await h.api.saveCreationWorkspace({ ...turn(value), draft: { ...value.draft, title: '中文空间中的创作' } });
    h.restart(); value = await h.api.readCreationWorkspace(value.id); assert.equal(value.draft.title, '中文空间中的创作');
    value = await h.api.undoCreationWorkspace(turn(value)); assert.equal(value.draft.title, '');
    await assert.rejects(h.api.saveCreationWorkspace({ ...turn(value), spaceId: '../中文品牌空间', draft: value.draft }));
});
test('manual product video and image-set plans compile locally and reuse the original chat', async t => {
    const { h, product } = await fixture(t);
    for (const capability of ['product-video', 'product-image-set']) {
        let value = await h.api.startCreationWorkspace({ platform: 'xiaohongshu', capability }); const sessionId = value.sessionId;
        value = await h.api.saveCreationWorkspace({ ...turn(value), draft: { ...value.draft, productId: product.id, title: '可编辑商品细节', body: '只保存方案',
            scenes: [{ id: 'scene_one', title: '细节', durationMs: 5000, assetId: product.assets[0].id }], pages: [{ id: 'cover', title: '商品细节', assetIds: [product.assets[0].id] }] } });
        value = await h.api.materializeCreationWorkspace(turn(value));
        assert.equal(value.sessionId, sessionId); assert.ok(value.native);
        const ref = value.native.kind === 'video' ? value.native : { kind: 'image-set', path: value.native.path };
        const session = await h.api.getProductProjectEditorSession(ref); assert.equal(session.sessionId, sessionId);
        assert.equal(JSON.parse(h.state.sessions.get(sessionId).metadata).editorBindingKind, 'product-project');
        if (value.native.kind === 'video') {
            const native = await h.api.getVideoEditorV2Project(value.native.projectId);
            const preview = previewProductEdits(native, [{ type: 'scene.text', sceneId: 'scene_one', text: '实时预览文字' }]);
            assert.equal(preview.productVideo!.scenes[0].overlayText, '实时预览文字');
            assert.notEqual(native.productVideo.scenes[0].overlayText, '实时预览文字');
            const snapshot = await h.api.readProductProjectEditor(ref);
            const changed = await h.api.applyProductProjectEdit({ binding: snapshot.binding, expectedRevision: snapshot.revision, expectedDraftEpoch: snapshot.draftEpoch, requestId: 'duplicate_fixture', operations: [{ type: 'scene.duplicate', sceneId: 'scene_one', newSceneId: 'scene_two' }] });
            assert.equal(changed.video.productVideo.scenes.length, 2);
        }
    }
    assert.equal(h.state.imageCalls + h.state.ttsCalls + h.state.localizationCalls, 0);
});
test('draft AI tools save structured data and cannot operate without a verified binding', async t => {
    const { h } = await fixture(t); let value = await h.api.startCreationWorkspace({ platform: 'tiktok', capability: 'product-video' });
    const tool = new h.api.CreationEditTool(); assert.equal((await tool.execute({ draft: value.draft })).success, false);
    const result = await tool.execute({ _creationTurn: turn(value), draft: { ...value.draft, title: 'AI draft', body: 'A saved draft' } });
    assert.equal(result.success, true); value = await h.api.readCreationWorkspace(value.id); assert.equal(value.draft.body, 'A saved draft');
    assert.equal((await new h.api.CreationReadTool().execute({ _creationTurn: turn(value) })).success, true);
    for (const name of ['video_generate', 'audio_generate', 'image_generate', 'app_cli', 'bash', 'xhs_publish_prepare']) {
        assert.equal(h.api.evaluateRuntimeToolPermission({ toolName: name, args: {}, tool: { name, kind: 'edit' }, context: { workflowKind: 'creation-workspace', runtimeMode: 'gardenflow', sessionId: value.sessionId, toolPack: 'gardenflow' } }).outcome, 'deny');
    }
});

test('dream director results apply directly with an explicit policy, remain reversible and never generate media', async t => {
    const { h } = await fixture(t); const workspace = await h.api.startCreationWorkspace({ platform: 'tiktok', capability: 'dream-story' });
    let project = await h.api.readDreamStory(workspace.native.projectId);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'record.save', fragments: [{ id: 'remembered', text: '电梯落在海边', locked: true }] }] });
    const result = await new h.api.DreamStoryProposeTool().execute({ _dreamTurn: { ...dreamRequest(project), editPolicy: 'direct' }, director: { ...dreamDirector('remembered'), scenes: dreamDirector('remembered').scenes.map((scene, index) => ({ ...scene, mediaType: index < 2 ? 'video' : 'image', videoReason: 'A turning point' })) } });
    assert.equal(result.success, true, result.llmContent);
    project = await h.api.readDreamStory(project.id); assert.equal(project.dreamStory.director.scenes.length, 8);
    assert.equal(project.dreamStory.storyAdopted, true); assert.equal(project.dreamStory.storyboardAdopted, true);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: directDreamEditOperations(project.dreamStory, [{ type: 'scene.update', sceneId: project.dreamStory.director.scenes[0].id, changes: { narration: '手动修改旁白' } }]) });
    assert.equal(project.dreamStory.storyboardAdopted, true);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'undo' }] });
    const reverted = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'undo' }] }); assert.equal(reverted.dreamStory.director, undefined);
    assert.equal(h.state.imageCalls + h.state.ttsCalls + h.state.localizationCalls, 0);
});
test('unfinished manual dream story and eight scene inputs survive reload without weakening the production schema', async t => {
    const { h } = await fixture(t); const workspace = await h.api.startCreationWorkspace({ platform: 'tiktok', capability: 'dream-story' });
    let project = await h.api.readDreamStory(workspace.native.projectId);
    const draft = { title: '手动故事', story: '', visualStyle: '', setting: '', scenes: Array.from({ length: 8 }, (_, index) => ({ id: 'manual_' + index, visual: '', imagePrompt: '', narration: '', plannedDurationMs: 9000 })) };
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'director.draft', draft }] });
    h.restart(); project = await h.api.readDreamStory(project.id); assert.equal(project.dreamStory.manualDraft.title, '手动故事');
    assert.equal(project.dreamStory.director, undefined);
});

test('a conflicted manual note rebase preserves both local fields and unrelated AI scene edits', () => {
    const base = { title: '原标题', body: '原正文', scenes: [{ id: 'one', text: '旧镜头一' }, { id: 'two', text: '旧镜头二' }] };
    const local = { ...base, title: '手动标题', scenes: [{ id: 'one', text: '手动镜头一' }, base.scenes[1]] };
    const latest = { ...base, body: 'AI 更新正文', scenes: [base.scenes[0], { id: 'two', text: 'AI 更新镜头二' }] };
    assert.deepEqual(mergeCreationDraft(base, local, latest), { title: '手动标题', body: 'AI 更新正文', scenes: [{ id: 'one', text: '手动镜头一' }, { id: 'two', text: 'AI 更新镜头二' }] });
});
test('draft saves are idempotent and stale AI drafts are retained without replacing manual input', async t => {
    const { h } = await fixture(t); let value = await h.api.startCreationWorkspace({ platform: 'douyin', capability: 'product-video' });
    const request = { ...turn(value), draft: { ...value.draft, title: '手动稿' } };
    value = await h.api.saveCreationWorkspace(request); const revision = value.revision;
    assert.equal((await h.api.saveCreationWorkspace(request)).revision, revision);
    assert.equal((await h.api.readCreationWorkspace(value.id)).undo.length, 1);
    await assert.rejects(h.api.saveCreationWorkspace({ ...request, draft: { ...value.draft, title: '重复请求的不同内容' } }), /不同修改/);
    await assert.rejects(h.api.saveCreationWorkspace({ ...turn(value), expectedRevision: 'older_revision', origin: 'ai', draft: { ...value.draft, title: '过期模型稿' } }), /变化/);
    value = await h.api.readCreationWorkspace(value.id); assert.equal(value.draft.title, '手动稿'); assert.equal(value.unapplied[0].draft.title, '过期模型稿');
});

test('switching a completed video to another platform creates a separate version and chat without altering the source', async t => {
    const { h, product } = await fixture(t);
    let value = await h.api.startCreationWorkspace({ platform: 'douyin', capability: 'product-video' });
    value = await h.api.saveCreationWorkspace({ ...turn(value), draft: { ...value.draft, productId: product.id, title: '来源作品', body: '保留来源文案', scenes: [{ id: 'scene_one', title: '原图', durationMs: 5000, assetId: product.assets[0].id }] } });
    value = await h.api.materializeCreationWorkspace(turn(value));
    const original = await h.api.getVideoEditorV2Project(value.native.projectId);
    const copy = await h.api.forkCreationWorkspace(value.id, { platform: 'tiktok', capability: 'product-video' });
    assert.notEqual(copy.sessionId, value.sessionId); assert.notEqual(copy.native.projectId, value.native.projectId);
    assert.equal(copy.sourceId, value.id); assert.equal(copy.draft.body, '保留来源文案');
    const copied = await h.api.getVideoEditorV2Project(copy.native.projectId); assert.equal(copied.creationTarget.platform, 'tiktok');
    assert.equal((await h.api.getVideoEditorV2Project(original.id)).creationTarget.platform, 'douyin');
    assert.equal(h.state.imageCalls + h.state.ttsCalls + h.state.localizationCalls, 0);
});
test('guarded copies are concurrent/restart idempotent and preserve later edits even when the source changes', async t => {
    const { h } = await fixture(t);
    const source = await h.api.startCreationWorkspace({ platform: 'xiaohongshu', capability: 'note-image' });
    const initialNote = await h.api.getXhsNoteProject(source.native.path);
    await h.api.saveXhsNoteProject({ path: initialNote.relativePath, noteType: initialNote.document.noteType, document: { ...initialNote.document, finalTitle: '原始对照', body: '需要保留的内容' }, expectedRevision: initialNote.version });
    const snapshot = await h.api.inspectCreationWorkspace(source.id);
    const guard = { expectedRevision: source.revision, expectedDraftEpoch: source.draftEpoch, contentVersion: snapshot.contentVersion };
    const selection = { platform: source.platform, capability: source.capability, requestId: 'guarded-copy' };
    const copies = await Promise.all([h.api.forkCreationWorkspace(source.id, selection, guard), h.api.forkCreationWorkspace(source.id, selection, guard)]);
    assert.equal(copies[0].id, copies[1].id); assert.equal((await h.api.listCreationWorkspaceSummaries()).length, 2);
    const copy = copies[0]; assert.equal(copy.sourceContentVersion, guard.contentVersion); assert.equal(copy.sourceRevision, source.revision);
    const copiedNote = await h.api.getXhsNoteProject(copy.native.path);
    await h.api.saveXhsNoteProject({ path: copiedNote.relativePath, noteType: copiedNote.document.noteType, document: { ...copiedNote.document, finalTitle: '用户后续修改的变体' }, expectedRevision: copiedNote.version });
    const originalNote = await h.api.getXhsNoteProject(source.native.path);
    await h.api.saveXhsNoteProject({ path: originalNote.relativePath, noteType: originalNote.document.noteType, document: { ...originalNote.document, finalTitle: '对照后来也改过' }, expectedRevision: originalNote.version }); h.restart();
    const retry = await h.api.forkCreationWorkspace(source.id, selection, guard); assert.equal((await h.api.getXhsNoteProject(retry.native.path)).document.finalTitle, '用户后续修改的变体'); assert.equal(retry.revision, copy.revision);
    await assert.rejects(h.api.forkCreationWorkspace(source.id, { ...selection, requestId: 'stale-copy' }, guard), /版本已变化/);
    await assert.rejects(h.api.forkCreationWorkspace(source.id, selection, { ...guard, spaceId: 'other' }));
    assert.equal(h.state.imageCalls + h.state.ttsCalls + h.state.localizationCalls, 0);
});
test('guarded copy detects native edits outside workspace revision and refuses to replay a partial target', async t => {
    const { h } = await fixture(t); const source = await h.api.startCreationWorkspace({ platform: 'xiaohongshu', capability: 'note-image' });
    const original = await h.api.inspectCreationWorkspace(source.id); const guard = { expectedRevision: source.revision, expectedDraftEpoch: source.draftEpoch, contentVersion: original.contentVersion };
    assert.ok(original.nativeRevision);
    const note = await h.api.getXhsNoteProject(source.native.path);
    await h.api.saveXhsNoteProject({ path: note.relativePath, noteType: note.document.noteType, document: { ...note.document, body: '原生编辑器的新内容' }, expectedRevision: note.version });
    assert.equal((await h.api.readCreationWorkspace(source.id)).revision, source.revision);
    await assert.rejects(h.api.forkCreationWorkspace(source.id, { platform: source.platform, capability: source.capability, requestId: 'native-stale' }, guard), /版本已变化/);
    const updated = await h.api.inspectCreationWorkspace(source.id); const nextGuard = { ...guard, contentVersion: updated.contentVersion };
    assert.notEqual(updated.nativeRevision, original.nativeRevision);
    const selection = { platform: source.platform, capability: source.capability, requestId: 'partial-copy' };
    const partial = await h.api.startCreationWorkspace(selection); const before = await h.api.getXhsNoteProject(partial.native.path);
    await assert.rejects(h.api.forkCreationWorkspace(source.id, selection, nextGuard), /人工复核/);
    assert.equal((await h.api.getXhsNoteProject(partial.native.path)).version, before.version);
    assert.equal((await h.api.listCreationWorkspaceSummaries()).length, 2); assert.equal(h.state.imageCalls + h.state.ttsCalls, 0);
});
test('guarded native video copy keeps its target and can recover the same native project without another clone', async t => {
    const { h, product } = await fixture(t);
    let source = await h.api.startCreationWorkspace({ platform: 'douyin', capability: 'product-video' });
    source = await h.api.saveCreationWorkspace({ ...turn(source), draft: { ...source.draft, productId: product.id, title: '对照商品视频', body: '原始正文', scenes: [{ id: 'scene_one', title: '商品原图', durationMs: 5000, assetId: product.assets[0].id }] } });
    source = await h.api.materializeCreationWorkspace(turn(source)); const snapshot = await h.api.inspectCreationWorkspace(source.id);
    const guard = { expectedRevision: source.revision, expectedDraftEpoch: source.draftEpoch, contentVersion: snapshot.contentVersion };
    const selection = { platform: source.platform, capability: source.capability, requestId: 'guarded-video-copy' };
    const copy = await h.api.forkCreationWorkspace(source.id, selection, guard); const count = (await h.api.listVideoEditorV2Projects()).length; h.restart();
    assert.equal((await h.api.forkCreationWorkspace(source.id, selection, guard)).native.projectId, copy.native.projectId);
    assert.equal((await h.api.listVideoEditorV2Projects()).length, count); assert.equal((await h.api.getVideoEditorV2Project(copy.native.projectId)).creationTarget.platform, 'douyin');
    assert.equal(h.state.imageCalls + h.state.ttsCalls + h.state.localizationCalls, 0);
});
