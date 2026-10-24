// pnpm --dir desktop exec node --test tests/dreamContinuityReport.test.ts tests/dreamStoryContinuity.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewDreamContinuity } from '../shared/dreamStoryContinuity.ts';
import { dreamReferenceAssets } from '../shared/dreamStory.ts';
import { dreamDirector } from './helpers/dreamStoryFixture.ts';

function fixture(schemaVersion = 2): any {
    const director = dreamDirector('fragment'); director.schemaVersion = schemaVersion as 1 | 2;
    director.characters = [{ id: 'person', description: '合成人物设定', referenceAssetIds: [], revision: 1 }];
    director.scenes[0].characterIds = ['person']; director.scenes[1].characterIds = ['person']; director.scenes[1].continuity = 'continue';
    return { id: 'synthetic-project', assets: [], dreamStory: { schemaVersion, spaceId: '中文空间', revision: 'r1', director, media: {}, fragments: [{ id: 'fragment', text: '合成梦境', locked: false }] } };
}
test('readonly dream review preserves eight shots and all old data; legacy projects do not acquire mandatory continuity semantics', () => {
    const project = fixture(1); const before = JSON.stringify(project); const report = reviewDreamContinuity(project)!;
    assert.equal(report.shots.length, 8); assert.equal(report.findings.length, 0); assert.ok(report.shots.every(shot => shot.transition === 'legacy-unrecorded'));
    assert.equal(report.fileIntegrity, 'not-checked'); assert.equal(report.visualConsistency, 'not-checked'); assert.equal(report.spaceId, '中文空间'); assert.equal(JSON.stringify(project), before);
    delete project.dreamStory.director; assert.equal(reviewDreamContinuity(project)!.state, 'not-planned'); assert.equal(reviewDreamContinuity({ id: 'product', assets: [] } as any), null);
});
test('review follows actual ordered predecessor confirmation and selected references without preauthorizing missing or stale output', () => {
    const project = fixture(); let report = reviewDreamContinuity(project)!;
    assert.ok(report.findings.some(value => value.code === 'previous-not-confirmed' && value.sceneId === 'scene_1'));
    assert.ok(report.findings.some(value => value.code === 'character-baseline-missing' && value.sceneId === 'scene_1'));
    assert.ok(report.findings.some(value => value.code === 'setting-baseline-missing' && value.sceneId === 'scene_1'));
    project.dreamStory.media.scene_0 = { image: { assetId: 'frame', status: 'ready', approvedDigest: 'synthetic-approved' } };
    project.assets.push({ id: 'frame', kind: 'image' }); project.dreamStory.director.characters[0].referenceAssetIds = ['frame']; project.dreamStory.director.settings[0].referenceAssetIds = ['frame'];
    report = reviewDreamContinuity(project)!; assert.equal(report.state, 'no-structural-finding'); assert.equal(report.shots[1].predecessor!.confirmation, 'registered-confirmed');
    assert.deepEqual(report.shots[1].references, dreamReferenceAssets(project.dreamStory, project.dreamStory.director.scenes[1]));
    project.dreamStory.media.scene_0.image.status = 'stale'; assert.equal(reviewDreamContinuity(project)!.shots[1].predecessor!.confirmation, 'not-confirmed');
    project.dreamStory.media.scene_0.image.status = 'ready'; delete project.dreamStory.media.scene_0.image.approvedDigest; assert.equal(reviewDreamContinuity(project)!.shots[1].predecessor!.confirmation, 'not-confirmed');
});
test('previous-only mode and cuts preserve existing reference semantics; missing registered assets remain visible', () => {
    const project = fixture(); project.dreamStory.director.scenes[1].imageReferenceMode = 'previous';
    project.dreamStory.media.scene_0 = { image: { assetId: 'frame', status: 'ready', approvedDigest: 'synthetic-approved' } };
    const report = reviewDreamContinuity(project)!; const one = report.findings.filter(value => value.sceneId === 'scene_1');
    assert.ok(!one.some(value => value.code.endsWith('baseline-missing'))); assert.ok(one.some(value => value.code === 'reference-not-registered'));
    assert.deepEqual(report.shots[1].references, [{ assetId: 'frame', role: 'previous:scene_0' }]); assert.equal(report.shots[2].predecessor, undefined); assert.ok(!report.shots[2].references.some(value => value.role.startsWith('previous:')));
});
test('spatial declaration changes compare exact stable IDs and do not guess intent or claim image errors', () => {
    const project = fixture(); const scenes = project.dreamStory.director.scenes;
    scenes[0].spatialAnchors = [{ id: 'chair', object: '椅子', count: 1, location: '桌后', state: '空置' }, { id: 'key', object: '钥匙', count: 1, location: '桌上', state: '静止' }];
    scenes[1].spatialAnchors = [{ id: 'chair', object: '椅子', count: 2, location: '桌前', state: '人物坐下' }, { id: 'light', object: '灯', count: 1, location: '墙上', state: '亮起' }];
    const before = JSON.stringify(project); const report = reviewDreamContinuity(project)!; const changes = report.shots[1].spatialChanges;
    assert.deepEqual(changes.map(value => value.id), ['chair', 'key', 'light']); assert.equal(changes[0].previous!.count, 1); assert.equal(changes[0].current!.count, 2); assert.equal(changes[1].current, null); assert.equal(changes[2].previous, null);
    assert.ok(report.findings.find(value => value.code === 'spatial-declaration-changed')!.message.includes('不表示画面存在错误')); assert.equal(report.shots[2].spatialChanges.length, 0); assert.equal(JSON.stringify(project), before);
});
