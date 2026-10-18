import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { imagePromptBudget, assertImagePromptBudget } from '../shared/imagePromptBudget.ts';
import { productVideoHarness } from './helpers/productVideoHarness.ts';
import { readyDream, dreamRequest, dreamPng } from './helpers/dreamStoryFixture.ts';
import { dreamShareDocument } from '../shared/dreamStoryExport.ts';

test('known Qwen prompt limits use an explicit conservative local estimate with headroom', () => {
    const budget = imagePromptBudget('dashscope-wan-native', 'qwen-image-2.0-pro-2026-06-22', 'A student sits in the original chair.')!;
    assert.equal(budget.maxTokens, 1300); assert.equal(budget.safeTokens, 1040); assert.equal(budget.estimator, 'conservative-local-v1');
    assert.equal(imagePromptBudget('dashscope-wan-native', 'qwen-image-edit-max', '学生坐下')!.maxTokens, 800);
    assert.equal(imagePromptBudget('openai-images', 'qwen-image-2.0-pro', 'short'), undefined);
    assert.equal(imagePromptBudget('dashscope-wan-native', 'qwen-image-2.1-pro', 'short'), undefined);
    assert.throws(() => assertImagePromptBudget('dashscope-wan-native', 'qwen-image-2.0-pro', 'A'.repeat(7189)), /不会自动截断/);
});

function configure(h: any) {
    h.state.settings = { image_endpoint: 'https://image.invalid/v1', image_api_key: 'fixture', image_model: 'qwen-image-2.0-pro-2026-06-22', image_provider: 'dashscope', image_provider_template: 'dashscope-wan-native' };
}
test('overlong assembled prompts remain reviewable but cannot be submitted, including after restart', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); configure(h);
    let project = await readyDream(h);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [
        { type: 'director.update', visualStyle: 'PRIVATE_STYLE '.repeat(500) }, { type: 'storyboard.adopt' },
    ] });
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0'] });
    const check = batch.imagePromptChecks.scene_0; assert.ok(check.estimatedTokens > check.safeTokens);
    assert.ok(batch.imagePromptsByScene.scene_0.includes(project.dreamStory.director.visualStyle)); // no silent truncation
    assert.equal(batch.imagePromptExtend, false); assert.equal(h.state.imageCalls, 0);
    await assert.rejects(h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id }), /安全预算/);
    h.restart(); project = await h.api.readDreamStory(project.id);
    await assert.rejects(h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id }), /安全预算/);
    const saved = JSON.parse(await fs.readFile(path.join(project.projectDir, 'private/batches.json'), 'utf8')).find((b: any) => b.id === batch.id);
    assert.equal(saved.state, 'preview'); assert.deepEqual(saved.jobs, {}); assert.equal(h.state.imageCalls, 0);
});

test('confirmed image execution uses the exact reviewed prompt and disables supplier rewriting', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); configure(h);
    const project = await readyDream(h);
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0'] });
    assert.ok(batch.imagePromptChecks.scene_0.estimatedTokens <= batch.imagePromptChecks.scene_0.safeTokens);
    h.state.imageHook = async input => {
        assert.equal(input.prompt, batch.imagePromptsByScene.scene_0); assert.equal(input.promptExtend, false);
        return { assets: [await h.api.createGeneratedMediaAsset({ dataBuffer: dreamPng, mimeType: 'image/png', projectId: input.projectId, privacyScope: 'project' })] };
    };
    await h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id });
    for (let i = 0; i < 150; i++) { const status = await h.api.reconcileDreamMedia(project.id); if (status.batches.find((b: any) => b.id === batch.id)?.state === 'completed') break; await new Promise(resolve => setTimeout(resolve, 40)); }
    assert.equal(h.state.imageCalls, 1); assert.equal((await h.api.readDreamStory(project.id)).dreamStory.media.scene_0.image.status, 'ready');
});

test('changed reviewed prompt or rewriting policy invalidates authorization before calling a supplier', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); configure(h); const project = await readyDream(h);
    for (const mutation of ['text', 'rewrite', 'mode']) {
        const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0'] });
        const file = path.join(project.projectDir, 'private/batches.json'); const batches = JSON.parse(await fs.readFile(file, 'utf8')); const stored = batches.find((b: any) => b.id === batch.id);
        if (mutation === 'text') stored.imagePromptsByScene.scene_0 += 'changed'; else if (mutation === 'mode') stored.imagePromptModesByScene.scene_0 = 'scene'; else stored.imagePromptExtend = true;
        await fs.writeFile(file, JSON.stringify(batches));
        await assert.rejects(h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id }), /实际图片指令或改写设置/);
    }
    assert.equal(h.state.imageCalls, 0);
});

test('scene-only mode is explicit, reversible and scoped; stale cards cannot invoke a supplier', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); configure(h);
    let project = await readyDream(h);
    const audioBefore = project.dreamStory.media.scene_0?.audio;
    const otherScene = JSON.stringify(project.dreamStory.director.scenes[1]);
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0'] });
    assert.equal(batch.imagePromptModesByScene.scene_0, 'context');
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_0', changes: { imagePromptMode: 'scene', imagePrompt: 'PRIVATE_SCENE_INSTRUCTION: blue uniform, gouache, student seated.' } }, { type: 'storyboard.adopt' }] });
    assert.deepEqual(project.dreamStory.media.scene_0?.audio, audioBefore);
    assert.equal(JSON.stringify(project.dreamStory.director.scenes[1]), otherScene);
    await assert.rejects(h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id }), /变化/);
    const preview = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0'] });
    assert.equal(preview.imagePromptModesByScene.scene_0, 'scene');
    assert.ok(preview.imagePromptsByScene.scene_0.includes('PRIVATE_SCENE_INSTRUCTION'));
    assert.ok(!JSON.stringify(dreamShareDocument(project.dreamStory)).includes('PRIVATE_SCENE_INSTRUCTION'));
    h.restart(); project = await h.api.readDreamStory(project.id);
    assert.equal(project.dreamStory.director.scenes[0].imagePromptMode, 'scene');
    assert.equal(h.state.imageCalls, 0);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_0', changes: { locked: true } }] });
    await assert.rejects(h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_0', changes: { imagePromptMode: 'context' } }] }), /解锁/);
});

test('private image service rejects an overlong request at the provider boundary even without the workbench', async () => {
    const calls = { provider: 0 };
    const compiled = await build({ entryPoints: [new URL('../electron/core/imageGenerationService.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs',
        plugins: [{ name: 'image-budget-boundary', setup(builder) {
            builder.onResolve({ filter: /(?:^|\/)(db|mediaLibraryStore|imageProviderAdapters)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: file }) => ({ loader: 'js', contents: file.endsWith('/db') ? 'export const getSettings=()=>({});'
                : file.endsWith('/mediaLibraryStore') ? 'export const createGeneratedMediaAsset=async()=>({});'
                    : 'export const normalizeImageProviderTemplate=t=>t; export const normalizeImageAspectRatio=a=>a; export const normalizeImageSize=s=>s; export const getImageProviderCapabilities=()=>({supportsReferenceImages:true,maxReferenceImages:3,supportedModes:["text-to-image","reference-guided"]}); export const getImageProviderAdapter=()=>({supportsMultiCount:true,generate:async()=>{globalThis.calls.provider++;return [];}});' }));
        } }],
    });
    const module = { exports: {} as any };
    vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), calls, Buffer, URL, console });
    await assert.rejects(module.exports.generateImagesToMediaLibrary({ projectId: 'private-project', privacyScope: 'project', model: 'qwen-image-2.0-pro', providerTemplate: 'dashscope-wan-native', apiKey: 'fixture', endpoint: 'https://never-call.invalid', prompt: 'PRIVATE_LONG_INPUT '.repeat(500) }), /安全预算/);
    assert.equal(calls.provider, 0);
});
