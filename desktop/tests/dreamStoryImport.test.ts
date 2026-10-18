import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseLegacyDreamStory } from '../shared/dreamStoryImport.ts';
import { productVideoHarness } from './helpers/productVideoHarness.ts';
const legacy = { schema_version: '1.0', title: '旧梦境', story: '电梯、钥匙和海。', emotional_arc: ['平静'], visual_style: '水墨', characters: [],
    scenes: Array.from({ length: 8 }, (_, i) => ({ scene_id: i + 1, duration_seconds: 9, visual_zh: '海上的发光钥匙', voiceover_zh: '钥匙一直发光。', image_prompt_en: 'A key above the sea.' })) };
test('legacy import maps stable IDs and never infers missing original dreams', () => {
    const result = parseLegacyDreamStory(legacy); assert.equal(result.fragments.length, 0); assert.equal(result.director.language, 'zh-CN'); assert.equal(result.director.scenes[7].id, 'legacy_scene_8');
    assert.throws(() => parseLegacyDreamStory({ ...legacy, schema_version: '2.0' }));
    assert.equal(parseLegacyDreamStory({ package: legacy, dream: { fragments: '海', dream_date: '2026-10-15' }, apiKey: 'DO_NOT_COPY' }).fragments[0].text, '海');
});
test('import preview is read only, confirmation deduplicates and target remains unbound', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close());
    const file = path.join(h.root, 'legacy.json'); const original = JSON.stringify({ package: legacy, apiKey: 'DO_NOT_COPY', jobs: [{ pending: true }] }); await fs.writeFile(file, original);
    const preview = await h.api.previewDreamImport(file); assert.equal((await h.api.listVideoEditorV2Projects()).length, 0);
    const [first, second] = await Promise.all([h.api.confirmDreamImport(preview.id), h.api.confirmDreamImport(preview.id)]);
    assert.equal(first.id, second.id); assert.equal(first.dreamStory.target, undefined); assert.equal(first.dreamStory.storyboardAdopted, false);
    const stored = await fs.readFile(path.join(first.projectDir, 'project.json'), 'utf8'); assert.ok(!stored.includes('DO_NOT_COPY')); assert.ok(!stored.includes('pending'));
    assert.equal(await fs.readFile(file, 'utf8'), original); assert.equal(h.state.imageCalls + h.state.ttsCalls, 0);
});
