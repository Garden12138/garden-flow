// Run: pnpm --dir desktop exec node --test tests/xcliProxyUi.test.ts
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test, { type TestContext } from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act, type ComponentType } from 'react';

const bundle = build({
    stdin: {
        contents: "export { GenerationStudio } from './src/pages/GenerationStudio';",
        resolveDir: new URL('..', import.meta.url).pathname,
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    jsx: 'automatic',
    define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'true' },
    plugins: [{
        name: 'stub-generation-agent',
        setup(builder) {
            builder.onResolve({ filter: /^\.\/Chat$/ }, () => ({ path: 'chat', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
                contents: 'export const clearFixedSessionWarmSnapshot = () => {}; export function Chat(props) { if (props.pendingMessage) recordPending(props.pendingMessage); return null; }',
            }));
        },
    }],
});

async function studio(t: TestContext, overrides = {}) {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
    const { window } = dom;
    const { document } = window;
    const globals = { window, document, HTMLElement: window.HTMLElement, Node: window.Node, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true };
    const originals = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1386 });
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLElement.prototype.scrollTo = () => {};

    const saved = {
        ai_sources_json: JSON.stringify([
            { id: 'local-cli', presetId: 'xcli', name: 'xcli', baseURL: 'xcli', model: 'antigravity' },
            { id: 'http', presetId: 'custom', name: 'HTTP', baseURL: 'https://image.example.invalid/v1', apiKey: 'fixture', model: 'http-image', modelsMeta: [{ id: 'http-image', capabilities: ['image'] }] },
        ]),
        image_provider: 'xcli',
        image_provider_template: 'xcli',
        image_model: 'antigravity',
        proxy_enabled: false,
        proxy_url: 'http://127.0.0.1:45678',
        ...overrides,
    };
    const patches: Record<string, unknown>[] = [];
    const messages = new Set<{ displayContent?: string; taskHints?: { generationToolConstraints?: { imageGenerate?: { model: string; sourceId: string } } } }>();
    let apply = async () => {};
    const ignore = () => {};
    Object.assign(window, { ipcRenderer: {
        getSettings: async () => ({ ...saved }),
        saveSettings: async (patch: Record<string, unknown>) => {
            patches.push(patch);
            await apply();
            Object.assign(saved, patch);
        },
        onSettingsUpdated: ignore, offSettingsUpdated: ignore,
        onDataChanged: ignore, offDataChanged: ignore,
        chat: { getOrCreateContextSession: async () => ({ id: 'test-session' }), getMessages: async () => [] },
        generation: { onJobUpdated: ignore, offJobUpdated: ignore, onJobLog: ignore, offJobLog: ignore, listJobs: async () => ({ items: [] }) },
        manuscripts: { list: async () => [] },
        voice: { list: async () => ({ items: [] }) },
        subjects: { list: async () => [], categories: { list: async () => [] } },
    } });
    const module = { exports: {} as { GenerationStudio: ComponentType<{ isActive: boolean }> } };
    vm.runInNewContext((await bundle).outputFiles[0].text, {
        module, exports: module.exports, require: createRequire(import.meta.url),
        window, document, console, navigator: window.navigator, URL, HTMLElement: window.HTMLElement,
        Node: window.Node, Event: window.Event, setTimeout, clearTimeout,
        recordPending: (message: Parameters<typeof messages.add>[0]) => messages.add(message),
    });
    const { createRoot } = createRequire(import.meta.url)('react-dom/client') as typeof import('react-dom/client');
    const root = createRoot(document.getElementById('root')!);
    t.after(async () => {
        await act(async () => root.unmount());
        window.close();
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    });
    await act(async () => root.render(React.createElement(module.exports.GenerationStudio, { isActive: true })));
    const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === label);
    async function click(target?: HTMLButtonElement | null) {
        assert.ok(target, 'button is present');
        await act(async () => target.click());
    }
    async function fill(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!;
        await act(async () => { setter.call(field, text); field.dispatchEvent(new window.Event('input', { bubbles: true })); });
    }
    const editor = () => document.querySelector<HTMLTextAreaElement>('textarea')!;
    return {
        document, editor, patches, messages, fill, button, click,
        setApply: (next: () => Promise<void>) => { apply = next; },
        dialog: () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="开启网络代理？"]'),
        send: () => click(document.querySelector<HTMLButtonElement>('[aria-label="发送给 Agent"]')),
    };
}

test('xcli generation waits for consent and saves the enabled proxy before sending once', async t => {
    const ui = await studio(t);
    let finishSaving!: () => void;
    ui.setApply(() => new Promise<void>(resolve => { finishSaving = resolve; }));
    await ui.fill(ui.editor(), '一只水彩猫');
    await ui.send();
    assert.ok(ui.dialog());
    assert.match(ui.dialog()?.textContent || '', /全局/);
    assert.equal(ui.dialog()?.querySelector('input')?.value, 'http://127.0.0.1:45678');
    assert.equal(ui.messages.size, 0);
    assert.equal(ui.patches.length, 0);

    const confirm = ui.button('启用并继续');
    assert.ok(confirm);
    await act(async () => { confirm.click(); confirm.click(); });
    assert.equal(ui.messages.size, 0);
    assert.equal(ui.patches.length, 1);
    assert.equal(ui.patches[0].proxy_enabled, true);
    assert.equal(ui.patches[0].proxy_url, 'http://127.0.0.1:45678');
    await act(async () => finishSaving());
    assert.equal(ui.dialog(), null);
    assert.equal(ui.messages.size, 1);
    assert.equal([...ui.messages][0].taskHints?.generationToolConstraints?.imageGenerate?.sourceId, 'local-cli');
    assert.equal([...ui.messages][0].taskHints?.generationToolConstraints?.imageGenerate?.model, 'antigravity');
});

test('xcli consent with no address can be cancelled or continued directly without writing settings', async t => {
    const ui = await studio(t, { proxy_url: '' });
    await ui.fill(ui.editor(), '保留这段提示词');
    await ui.send();
    assert.ok(ui.dialog());
    assert.equal(ui.button('启用并继续')?.disabled, true);
    await ui.click(ui.button('取消'));
    assert.equal(ui.editor().value, '保留这段提示词');
    assert.equal(ui.messages.size, 0);
    await ui.send();
    await ui.click(ui.button('继续直连'));
    assert.equal(ui.dialog(), null);
    assert.equal(ui.patches.length, 0);
    assert.equal(ui.messages.size, 1);
});

test('xcli cover allows entering a proxy and keeps the request parked if applying fails', async t => {
    const ui = await studio(t, { proxy_url: '' });
    await ui.click(ui.button('做封面'));
    await ui.fill(ui.editor(), '水彩猫封面');
    await ui.send();
    assert.ok(ui.dialog());
    const input = ui.dialog()?.querySelector('input');
    assert.ok(input);
    await ui.fill(input, '127.0.0.1:45678');
    ui.setApply(async () => { throw new Error('应用代理失败'); });
    await ui.click(ui.button('启用并继续'));
    assert.match(ui.dialog()?.textContent || '', /应用代理失败/);
    assert.equal(ui.messages.size, 0);
    ui.setApply(async () => {});
    await ui.click(ui.button('启用并继续'));
    assert.equal(ui.messages.size, 1);
    assert.equal(ui.patches[1].proxy_url, 'http://127.0.0.1:45678');
});

test('an enabled proxy and an HTTP image provider both bypass xcli proxy consent', async t => {
    for (const overrides of [
        { proxy_enabled: true },
        { image_provider: 'openai-compatible', image_provider_template: 'openai-images', image_model: 'http-image' },
    ]) {
        await t.test(JSON.stringify(overrides), async subtest => {
            const ui = await studio(subtest, overrides);
            await ui.fill(ui.editor(), '跳过弹窗');
            await ui.send();
            assert.equal(ui.dialog(), null);
            assert.equal(ui.messages.size, 1);
            assert.equal(ui.patches.length, 0);
        });
    }
});
