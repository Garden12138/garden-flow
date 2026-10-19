import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { productVideoHarness } from './helpers/productVideoHarness.ts';
import { dreamRequest, dreamDirector, readyDream } from './helpers/dreamStoryFixture.ts';
import { resolveDreamStoryTarget } from '../shared/contentCreationTarget.ts';

test('records save without providers; real SQL deduplication, revisions and workspace isolation survive restart', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close());
    let project = await h.api.createDreamStory(); assert.equal(project.version, 4); assert.equal(project.productVideo, null);
    const req = { ...dreamRequest(project), operations: [{ type: 'record.save', fragments: [{ id: 'tiny', text: '海', locked: false }] }] };
    project = await h.api.applyDreamEdit(req); const revision = project.dreamStory.revision;
    assert.equal((await h.api.applyDreamEdit(req)).dreamStory.revision, revision);
    await assert.rejects(h.api.applyDreamEdit({ ...req, operations: [{ type: 'record.save', fragments: [{ id: 'tiny', text: '另一片海', locked: false }] }] }), /不同输入/);
    await assert.rejects(h.api.applyDreamEdit({ ...req, requestId: 'stale-request' }), /变化/);
    const pending = dreamRequest(project); await h.api.markDreamDraft(project.id, true);
    await assert.rejects(h.api.applyDreamEdit({ ...pending, operations: [{ type: 'target.confirm', target: resolveDreamStoryTarget() }] }), /变化/);
    h.restart(); project = await h.api.readDreamStory(project.id); assert.equal(project.dreamStory.fragments[0].text, '海');
    assert.equal(h.state.ttsCalls + h.state.imageCalls + h.state.localizationCalls, 0);
    h.state.spaceId = 'other'; await assert.rejects(h.api.readDreamStory(project.id), /不存在/); h.state.spaceId = 'default';
    const stored = JSON.parse(await fs.readFile(path.join(project.projectDir, 'project.json'), 'utf8')); assert.equal(stored.version, 4);
});
test('stale model candidates cannot overwrite edits; adopted versions restore through a new revision', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close());
    let project = await readyDream(h); const original = project.dreamStory.director.story;
    const turn = dreamRequest(project);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'story.update', story: 'A new hand-edited story.' }] });
    const candidate = await h.api.saveDreamCandidate(turn, dreamDirector('remembered'));
    await assert.rejects(h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'candidate.adopt', candidateId: candidate.id }] }), /变化/);
    assert.equal((await h.api.readDreamStory(project.id)).dreamStory.director.story, 'A new hand-edited story.');
    const revision = project.dreamStory.revision;
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'version.restore', versionId: project.dreamStory.versions[0].id }] });
    assert.equal(project.dreamStory.director.story, original); assert.notEqual(project.dreamStory.revision, revision); assert.equal(project.dreamStory.storyboardAdopted, false);
    const session = await h.api.getDreamSession(project.id); const metadata = JSON.parse(h.state.sessions.get(session.sessionId).metadata);
    assert.equal(metadata.contextType, 'dream-story'); assert.equal(metadata.privacyScope, 'project');
});
test('prepared operations reconcile a completed atomic write without invoking a model', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close());
    const project = await readyDream(h);
    h.api.prepareStoryProjectOperation({ space_id: 'default', project_id: project.id, request_id: 'crash-checkpoint', request_digest: 'digest', expected_revision: 'old', next_revision: project.dreamStory.revision, state: 'prepared', result_json: null, created_at: 1 });
    h.restart(); await h.api.recoverDreamOperations();
    assert.equal(h.api.getStoryProjectOperation('default', project.id, 'crash-checkpoint').state, 'committed');
    assert.equal(h.state.imageCalls + h.state.ttsCalls, 0);
    const version = h.api.getTikTokVideoVersionByProject(project.id); assert.equal(version.source.kind, 'dream-story'); assert.equal(version.sourceProductId, undefined);
});
test('publication copy updates the native version once and recovery preserves its revision', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close());
    let project = await readyDream(h);
    const copy = { title: 'A quiet shore', description: 'A door opens onto the sea.', hashtags: ['DreamStory'] };
    const req = { ...dreamRequest(project), operations: [{ type: 'publication.copy', ...copy }] };
    project = await h.api.applyDreamEdit(req);
    const version = h.api.getTikTokVideoVersionByProject(project.id);
    assert.equal(version.title, copy.title); assert.equal(JSON.stringify(version.hashtags), JSON.stringify(copy.hashtags));
    await h.api.applyDreamEdit(req);
    assert.equal(h.api.getTikTokVideoVersionByProject(project.id).revision, version.revision);
    h.api.prepareStoryProjectOperation({ space_id: 'default', project_id: project.id, request_id: 'copy-crash', request_digest: 'copy-digest', expected_revision: 'old', next_revision: project.dreamStory.revision, state: 'prepared', result_json: JSON.stringify({ publicationCopy: copy }), created_at: 1 });
    h.restart(); await h.api.recoverDreamOperations();
    assert.equal(h.api.getTikTokVideoVersionByProject(project.id).revision, version.revision);
    assert.equal(h.api.getStoryProjectOperation('default', project.id, 'copy-crash').state, 'committed');
});


test('reopening a dream reuses its conversation and preserves history preferences and messages', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close());
    const project = await h.api.createDreamStory();
    const first = await h.api.getDreamSession(project.id);
    const session = h.state.sessions.get(first.sessionId);
    session.metadata = JSON.stringify({ ...JSON.parse(session.metadata), starred: true, archived: true, unread: true });
    h.state.messages.push({ id: 'dream-history-message', session_id: first.sessionId, role: 'user', content: '记住海边的灯。' });
    const reopened = await h.api.getDreamSession(project.id);
    assert.equal(reopened.sessionId, first.sessionId);
    assert.equal(h.state.sessions.size, 1);
    const metadata = JSON.parse(h.state.sessions.get(first.sessionId).metadata);
    assert.equal(metadata.starred, true); assert.equal(metadata.archived, true); assert.equal(metadata.unread, true);
    assert.equal(metadata.privacyScope, 'project'); assert.equal(metadata.dreamStoryProjectId, project.id);
    assert.equal(h.state.messages[0].content, '记住海边的灯。');
});
