import test from 'node:test';
import assert from 'node:assert/strict';
import { productVideoHarness } from './helpers/productVideoHarness.ts';

test('language suggestions validate scenes, preserve empty narration and support all configured text protocols without paid calls', async (t) => {
    const h = await productVideoHarness({ platformVersions: true });
    t.after(() => h.close());
    const scenes = [{ id: 'one', narrationText: '商品介绍', durationMs: 3000 }, { id: 'two', narrationText: '', durationMs: 3000 }];
    const result = { title: 'Product', description: 'Product introduction', hashtags: ['Product'], scenes: [
        { sceneId: 'one', overlayText: 'Product', narrationText: 'Introduction' }, { sceneId: 'two', overlayText: 'Details', narrationText: '' },
    ] };
    assert.equal(h.api.parseTikTokLocalization(JSON.stringify(result), scenes).scenes.length, 2);
    for (const invalid of [
        { ...result, scenes: result.scenes.slice(0, 1) },
        { ...result, scenes: [result.scenes[0], result.scenes[0]] },
        { ...result, scenes: [result.scenes[0], { ...result.scenes[1], sceneId: 'unknown' }] },
        { ...result, scenes: [result.scenes[0], { ...result.scenes[1], narrationText: 'invented' }] },
        { ...result, title: '' }, { ...result, hashtags: ['bad tag'] }, { ...result, description: 'x'.repeat(4000) },
        { ...result, scenes: [{ ...result.scenes[0], overlayText: 'x'.repeat(2001) }, result.scenes[1]] },
    ]) assert.throws(() => h.api.parseTikTokLocalization(JSON.stringify(invalid), scenes));
    assert.throws(() => h.api.parseTikTokLocalization('not JSON', scenes));
    const version = { id: 'version', revision: 7, title: '商品', description: '资料', hashtags: [] };
    const project = { updatedAt: '2026-10-10', productVideo: { scenes, productSnapshot: { name: '商品', facts: { model: 'ABC' }, skus: [] } } };
    for (const protocol of ['openai', 'anthropic', 'gemini']) {
        const proposal = await h.api.requestTikTokLocalization({ version, project, language: 'en', market: 'International', protocol,
            llm: { apiKey: 'fixture', baseURL: 'https://fixture.invalid/v1', modelName: 'fixture' },
            fetchImpl: async (url: string, options: any) => {
                const body = JSON.parse(options.body);
                assert.equal(options.method, 'POST');
                assert.ok(JSON.stringify(body).includes('ABC'));
                let response;
                if (protocol === 'openai') { assert.ok(url.endsWith('/chat/completions')); response = { choices: [{ message: { content: JSON.stringify(result) } }] }; }
                else if (protocol === 'anthropic') { assert.ok(url.endsWith('/messages')); response = { content: [{ type: 'text', text: JSON.stringify(result) }] }; }
                else { assert.ok(url.endsWith('/models/fixture:generateContent')); response = { candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }; }
                return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } });
            },
        });
        assert.equal(proposal.expectedRevision, 7);
        assert.equal(proposal.scenes[1].narrationText, '');
    }
    await assert.rejects(h.api.requestTikTokLocalization({ version, project, language: 'en', market: 'US', llm: { apiKey: 'fixture', baseURL: 'https://fixture.invalid/v1', modelName: 'fixture' }, fetchImpl: async () => new Response('failed', { status: 400 }) }), /HTTP 400/);
    assert.equal(h.state.videoCalls + h.state.ttsCalls + h.state.localizationCalls, 0);
});

test('localization disables only documented DashScope hybrid thinking and reports request/body timeouts without changing projects', async (t) => {
    const h = await productVideoHarness({ platformVersions: true });
    t.after(() => h.close());
    const input = { version: { id: 'version', revision: 4, title: '商品', description: '资料', hashtags: [] },
        project: { updatedAt: 'unchanged', productVideo: { scenes: [{ id: 'one', narrationText: '' }], productSnapshot: { name: '商品' } } },
        language: 'en', market: 'International' };
    const result = { title: 'Product', description: 'Details', hashtags: [], scenes: [{ sceneId: 'one', overlayText: 'Product', narrationText: '' }] };
    for (const [baseURL, modelName, disabled] of [
        ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.8-max', true],
        ['https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'qwen3.8-max-0902', true],
        ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.8-2.4t-a95b', false],
        ['https://dashscope.aliyuncs.com.fixture.invalid/v1', 'qwen3.8-max', false],
        ['https://other.invalid/v1', 'qwen3.8-max', false],
    ] as const) {
        await h.api.requestTikTokLocalization({ ...input, llm: { baseURL, modelName, apiKey: 'fixture' }, fetchImpl: async (_url: string, options: any) => {
            const body = JSON.parse(options.body);
            assert.equal(body.enable_thinking, disabled ? false : undefined);
            return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
        } });
    }
    const timeout = () => { const error = new Error('provider timeout'); error.name = 'TimeoutError'; throw error; };
    for (const fetchImpl of [async () => timeout(), async () => ({ ok: true, json: async () => timeout() })]) {
        await assert.rejects(h.api.requestTikTokLocalization({ ...input, llm: { baseURL: 'https://fixture.invalid/v1', modelName: 'fixture', apiKey: 'fixture' }, fetchImpl }), /超过 3 分钟，未修改稿件/);
    }
    assert.equal(input.project.updatedAt, 'unchanged');
    assert.equal(input.version.revision, 4);
    assert.equal(h.state.videoCalls + h.state.ttsCalls, 0);
});
