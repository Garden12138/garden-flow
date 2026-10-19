// Run: pnpm --dir desktop exec node --test tests/noteCards.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { productVideoHarness } from './helpers/productVideoHarness.ts';
import { CreationConfigSchema, cardContent, newCardPage, presetConfig } from '../shared/noteCards.ts';
import { normalizeXhsNoteDocument } from '../shared/xhsNote.ts';
import { cardFingerprint, renderCardHtml } from '../shared/cardRenderer.ts';
import { createProductVideoVerificationPng } from '../electron/core/productVideoVerificationImage.ts';

async function fixture(t: any) {
    const h = await productVideoHarness({ creationWorkspaces: true, productImageSets: true, noteCards: true }); t.after(() => h.close());
    h.state.renderBytes = createProductVideoVerificationPng('GF-ABC123DEF456');
    const workspace = await h.api.startCreationWorkspace({ platform: 'xiaohongshu', capability: 'note-image', presetId: 'article', requestId: 'fixture-start' });
    const turn = () => h.api.noteCardTurn(workspace.native.path);
    return { h, workspace, turn };
}
test('v1 migration preserves old page IDs, media slots and legacy representation without automatic templates', () => {
    const value = normalizeXhsNoteDocument({ schemaVersion: 1, imagePages: [{ id: 'stable', title: '原文', copy: '内容', mediaSlotId: 'old' }], mediaSlots: [{ id: 'old', role: 'image-page', assetId: 'image', status: 'ready' }] });
    assert.equal(value.schemaVersion, 2); assert.equal(value.creationConfig!.presetId, 'free'); assert.equal(value.imagePages[0].id, 'stable'); assert.equal(value.imagePages[0].blocks, undefined); assert.equal(value.mediaSlots.find(slot => slot.id === 'old')!.assetId, 'image');
    assert.throws(() => normalizeXhsNoteDocument({ schemaVersion: 999 }), /版本/);
});
test('presets combine article input and expression without removing bound sources', () => {
    const source = { id: 'source', version: 'hash', name: '原文' };
    const article = presetConfig('article', CreationConfigSchema.parse({ sourceRefs: [source] }));
    const diagram = presetConfig('diagram', article); assert.equal(diagram.inputMode, 'article'); assert.equal(diagram.expression, 'diagram'); assert.deepEqual(diagram.sourceRefs, [source]);
    assert.equal(presetConfig('tutorial', diagram).expression, 'tutorial');
});
test('six templates escape text and fingerprints ignore publication copy but track style and asset hashes', () => {
    const config = CreationConfigSchema.parse({});
    for (const layout of ['cover', 'text', 'split', 'comparison', 'steps', 'checklist'] as const) {
        const page = { ...newCardPage(layout), title: '<script>alert(1)</script>' }; const html = renderCardHtml(page, config);
        assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('1440px'));
        assert.notEqual(cardFingerprint(page, config, {}), cardFingerprint(page, { ...config, style: { ...config.style, accent: '#000000' } }, {}));
    }
    const page = { ...newCardPage('split'), blocks: [{ type: 'image' as const, assetId: 'owned', fit: 'contain' as const, x: 50, y: 50 }] };
    assert.notEqual(cardFingerprint(page, config, { owned: 'old' }), cardFingerprint(page, config, { owned: 'new' }));
    assert.throws(() => renderCardHtml(page, config, { owned: 'https://untrusted/image.png' }), /缺失|损坏/);
});
test('startup is idempotent, persists native configuration and never invokes media models', async t => {
    const { h, workspace } = await fixture(t);
    const [a, b] = await Promise.all([1, 2].map(() => h.api.startCreationWorkspace({ platform: 'xiaohongshu', capability: 'note-image', presetId: 'article', requestId: 'fixture-start' })));
    assert.equal(a.id, workspace.id); assert.equal(a.sessionId, b.sessionId);
    assert.equal((await h.api.readNoteCard(workspace.native.path)).content.creationConfig.presetId, 'article');
    assert.equal(h.state.imageCalls + h.state.videoCalls, 0);
});
test('manual blank saving, structured content, persistent undo and stale AI result recovery', async t => {
    const { h, workspace, turn } = await fixture(t); let current = await h.api.readNoteCard(workspace.native.path);
    const page = { ...newCardPage('text', 'manual'), title: '可编辑中文标题', blocks: [{ type: 'text', text: '真实正文', emphasis: ['真实'] }] };
    const firstTurn = await turn(); const next = { ...current.content, imagePages: [page] };
    current = await h.api.noteCardMutation(firstTurn, 'save', next);
    assert.equal(current.document.imagePages[0].copy, '真实正文');
    assert.equal((await h.api.noteCardMutation(firstTurn, 'save', next)).version, current.version);
    const stale = await turn(); await h.api.noteCardMutation(stale, 'mark');
    await assert.rejects(h.api.noteCardMutation({ ...stale, requestId: 'stale_ai' }, 'save', { ...next, finalTitle: '过期 AI' }, 'ai'), /未应用/);
    current = await h.api.readNoteCard(workspace.native.path); assert.equal(current.content.finalTitle, ''); assert.equal(current.runtime.unapplied.length, 1);
    h.restart(); current = await h.api.noteCardMutation(await turn(), 'undo'); assert.equal(current.content.imagePages.length, 0); assert.equal(current.content.creationConfig.presetId, 'article');
});
test('reorganization is proposed, applied atomically and reverted with configuration', async t => {
    const { h, workspace, turn } = await fixture(t); const old = await h.api.readNoteCard(workspace.native.path);
    const proposed = { ...old.content, creationConfig: presetConfig('tutorial'), imagePages: [{ ...newCardPage('steps', 'steps'), title: '新步骤' }] };
    const credentials = { ...await turn(), policy: 'propose' };
    let current = await h.api.noteCardMutation(credentials, 'save', proposed, 'ai');
    assert.equal(current.content.imagePages.length, 0); assert.equal(current.runtime.proposal.content.creationConfig.expression, 'tutorial');
    current = await h.api.noteCardMutation(await turn(), 'apply'); assert.equal(current.content.imagePages[0].id, 'steps');
    current = await h.api.noteCardMutation(await turn(), 'undo'); assert.deepEqual(current.content, old.content);
});
test('sources are durable, paginated, versioned, and isolated from arbitrary paths and other spaces', async t => {
    const { h, workspace, turn } = await fixture(t); const uploads = path.join(h.state.root, 'default/gardenflow/uploads'); await fs.mkdir(uploads, { recursive: true });
    const file = path.join(uploads, 'article.md'); await fs.writeFile(file, '第一段\n\n' + '中文内容'.repeat(4000));
    const source = await h.api.importCreationSource({ kind: 'attachment', path: file }); assert.equal(source.status, 'ready');
    const ref = { id: source.id, version: source.version, name: source.name };
    const first = await h.api.readCreationSource(ref, { limit: 1 }); assert.equal(first.segments[0].text, '第一段'); assert.equal(first.nextOffset, 1);
    const next = await h.api.readCreationSource(ref, { offset: 1, limit: 1 }); assert.ok(next.nextOffset); assert.equal(next.segments[0].text.length, 6000);
    const current = await h.api.readNoteCard(workspace.native.path); await h.api.noteCardMutation(await turn(), 'save', { ...current.content, creationConfig: { ...current.content.creationConfig, sourceRefs: [ref] } });
    await fs.writeFile(file, '已更新的原文'); assert.equal((await h.api.readCreationSource(ref)).status, 'changed');
    const reread = await h.api.readCreationSource(ref, { reread: true }); assert.notEqual(reread.id, ref.id);
    assert.equal((await h.api.readCreationSource(ref)).segments[0].text, '第一段');
    await fs.rm(file); assert.equal((await h.api.readCreationSource(ref)).segments[0].text, '第一段');
    await assert.rejects(h.api.importCreationSource({ kind: 'attachment', path: '/etc/hosts' }), /当前空间/);
    const external = path.join(h.state.root, 'private.txt'); await fs.writeFile(external, 'private'); await fs.symlink(external, path.join(uploads, 'symlink.txt'));
    await assert.rejects(h.api.importCreationSource({ kind: 'attachment', path: path.join(uploads, 'symlink.txt') }), /当前空间/);
    h.state.spaceId = 'other'; await assert.rejects(h.api.readCreationSource(ref));
});
test('parsers distinguish empty, unsupported, corrupt and genuine DOCX/PDF content', async t => {
    const { h } = await fixture(t);
    assert.equal((await h.api.parseCreationSource(Buffer.alloc(0), '.txt')).status, 'empty');
    assert.equal((await h.api.parseCreationSource(Buffer.from('text'), '.doc')).status, 'unsupported');
    assert.equal((await h.api.parseCreationSource(Buffer.from('broken'), '.docx')).status, 'failed');
});
test('local PNG and ZIP export cache per page, keep order, and preserve recoverable partial results', async t => {
    const { h, workspace, turn } = await fixture(t); const current = await h.api.readNoteCard(workspace.native.path);
    let value = await h.api.noteCardMutation(await turn(), 'save', { ...current.content, imagePages: ['a', 'b'].map((id, index) => ({ ...newCardPage('text', id), index: index + 1, title: `中文 ${id}` })) });
    const zip = path.join(h.state.root, 'cards.zip'); const exportAll = () => h.api.exportNoteCards({ path: workspace.native.path, expectedRevision: value.version, format: 'zip', outputPath: zip });
    assert.equal((await exportAll()).complete, true); assert.equal(h.state.renderCalls, 2); assert.ok((await fs.stat(zip)).size > 0);
    assert.equal((await exportAll()).complete, true); assert.equal(h.state.renderCalls, 2);
    value = await h.api.noteCardMutation(await turn(), 'save', { ...value.content, body: '只改发布文案' }); await exportAll(); assert.equal(h.state.renderCalls, 2);
    value = await h.api.noteCardMutation(await turn(), 'save', { ...value.content, imagePages: value.content.imagePages.map((page: any) => page.id === 'b' ? { ...page, title: '新标题' } : page) });
    h.state.renderHook = async () => { throw new Error('模拟排版溢出'); }; const failed = await exportAll(); assert.equal(failed.complete, false); assert.equal(failed.failures[0].pageId, 'b');
    h.state.renderHook = null; assert.equal((await exportAll()).complete, true); assert.equal(h.state.renderCalls, 4);
    assert.equal(h.state.imageCalls, 0);
});
test('bound tools reject unbound reads, unrelated sources, and media/file execution', async t => {
    const { h, turn } = await fixture(t);
    assert.equal((await new h.api.NoteCardReadTool().execute({})).success, false);
    assert.equal((await new h.api.NoteCardSourceReadTool().execute({ _noteCardTurn: await turn(), sourceId: 'unbound', offset: 0, limit: 1 })).success, false);
    for (const toolName of ['app_cli', 'bash', 'image_generate', 'video_generate', 'xhs_publish_prepare']) assert.equal(h.api.evaluateRuntimeToolPermission({ toolName, args: {}, tool: { kind: 'edit' }, context: { workflowKind: 'note-card-edit' } }).outcome, 'deny');
});

test('captured knowledge retains a durable factual snapshot and rejects a forged source version', async t => {
    const { h } = await fixture(t); const directory = path.join(h.state.root, 'default/knowledge/redbook/captured'); await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'meta.json'), JSON.stringify({ title: '真实资料', content: '来自知识库的原文事实' }));
    const source = await h.api.importCreationSource({ kind: 'knowledge', itemId: 'captured', path: 'meta.json', name: '知识资料' });
    assert.equal(source.status, 'ready'); assert.ok(source.segments.some((segment: any) => segment.text.includes('原文事实')));
    await assert.rejects(h.api.readCreationSource({ id: source.id, name: source.name, version: 'forged' }), /版本不匹配/);
});

test('image generation requires the reviewed current configuration, saves a separate asset and never resubmits a receipt', async t => {
    const { h, workspace, turn } = await fixture(t); h.state.settings = { image_provider: 'openai-compatible', image_provider_template: 'openai-images', image_model: 'fixture-image', image_api_key: 'synthetic' };
    let current = await h.api.readNoteCard(workspace.native.path);
    current = await h.api.noteCardMutation(await turn(), 'save', { ...current.content, imagePages: [{ ...newCardPage('split', 'illustration'), title: '独立配图', imagePrompt: '一张用于说明的插画，不包含文字' }] });
    const request = { path: workspace.native.path, pageId: 'illustration', expectedRevision: current.version, requestId: 'image-one', confirmed: true, reviewedConfigurationKey: 'old-config' };
    await assert.rejects(h.api.generateNoteCardImage(request), /重新确认/);
    request.reviewedConfigurationKey = h.api.getNoteCardGenerationConfig().configurationKey;
    h.state.imageHook = async (input: any) => { assert.equal(input.count, 1); assert.equal(input.generationMode, 'text-to-image'); return { success: true, assets: [await h.api.createGeneratedMediaAsset({ dataBuffer: h.state.renderBytes, prompt: input.prompt, mimeType: 'image/png', provider: 'fixture' })] }; };
    const result = await h.api.generateNoteCardImage(request);
    assert.ok(result.content.imagePages[0].blocks.some((block: any) => block.type === 'image' && block.assetId));
    assert.equal(result.content.imagePages[0].title, '独立配图');
    await h.api.generateNoteCardImage(request); assert.equal(h.state.imageCalls, 1);
});

test('generated image cannot overwrite typing during the request and interrupted requests are not automatically resumed', async t => {
    const { h, workspace, turn } = await fixture(t); h.state.settings = { image_provider: 'openai-compatible', image_provider_template: 'openai-images', image_api_key: 'synthetic' };
    const blank = await h.api.readNoteCard(workspace.native.path);
    const current = await h.api.noteCardMutation(await turn(), 'save', { ...blank.content, imagePages: [{ ...newCardPage('split', 'illustration'), title: '保留手动输入', imagePrompt: '风景' }] });
    h.state.imageHook = async (input: any) => { await h.api.noteCardMutation(await turn(), 'mark'); return { success: true, assets: [await h.api.createGeneratedMediaAsset({ dataBuffer: h.state.renderBytes, prompt: input.prompt, mimeType: 'image/png', provider: 'fixture' })] }; };
    const result = await h.api.generateNoteCardImage({ path: workspace.native.path, pageId: 'illustration', expectedRevision: current.version, requestId: 'image-stale', confirmed: true, reviewedConfigurationKey: h.api.getNoteCardGenerationConfig().configurationKey });
    assert.match(result.warning, /已修改/); assert.ok(!result.content.imagePages[0].blocks.some((block: any) => block.type === 'image'));
    assert.equal(result.runtime.generations[0].status, 'succeeded');
    const file = path.join(result.projectPath, 'note.json'); const raw = JSON.parse(await fs.readFile(file, 'utf8')); raw.cardRuntime.generations.push({ requestId: 'interrupted', pageId: 'illustration', status: 'generating' }); await fs.writeFile(file, JSON.stringify(raw));
    h.restart(); const recovered = await h.api.recoverNoteCardGeneration(workspace.native.path);
    assert.equal(recovered.runtime.generations.find((item: any) => item.requestId === 'interrupted').status, 'failed'); assert.equal(h.state.imageCalls, 1);
});
