// Run: pnpm --dir desktop exec node --test tests/creationEntryUi.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

test('new chat selects a platform before showing its supported creation workflows', async t => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    const bundle = await build({
        stdin: { contents: "export { ChatCreationModePicker } from './src/components/ChatCreationModePicker'; export { GARDENFLOW_CREATION_MODE_GROUP } from './src/pages/gardenflow/config';", resolveDir: new URL('..', import.meta.url).pathname },
        bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
    });
    const module = { exports: {} as any };
    vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)), window: dom.window, CustomEvent: dom.window.CustomEvent });
    const { ChatCreationModePicker, GARDENFLOW_CREATION_MODE_GROUP: group } = module.exports;
    let chosen: any;
    let intent: any;
    dom.window.addEventListener('gardenflow:navigate', (event: any) => { intent = event.detail; });
    function Entry() {
        const [platform, setPlatform] = useState<string | null>(null);
        const [mode, setMode] = useState<string | null>(null);
        return React.createElement(ChatCreationModePicker, {
            group, platformId: platform, activeModeId: mode,
            onPlatformChange: (id: string) => { setPlatform(id); setMode(null); },
            onSelect: (option: any) => { chosen = option; setMode(option.id); },
            onClear: () => { setPlatform(null); setMode(null); },
        });
    }
    const root = createRoot(dom.window.document.getElementById('root')!);
    t.after(async () => {
        await act(async () => root.unmount());
        dom.window.close();
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
        Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    });
    await act(async () => root.render(React.createElement(Entry)));
    const buttons = () => [...dom.window.document.querySelectorAll('button')];
    const click = async (label: string) => {
        const button = buttons().find(item => item.textContent === label || item.querySelector('span span')?.textContent === label);
        assert.ok(button, `Missing ${label}`);
        await act(async () => button.click());
    };
    assert.deepEqual(buttons().map(item => item.textContent), ['小红书', '抖音', 'TikTok']);
    await click('抖音');
    assert.ok(!dom.window.document.body.textContent?.includes('图文笔记'));
    assert.ok(!dom.window.document.body.textContent?.includes('商品套图'));
    await click('商品视频');
    assert.equal(intent.type, 'creation.start');
    assert.equal(intent.platform, 'douyin'); assert.equal(intent.capability, 'product-video');
    const productMode = group.options.find((option: any) => option.id === 'douyin-product-video');
    assert.equal(productMode.taskHints.artifactType, undefined);
    await click('小红书'); await click('视频笔记');
    assert.equal(intent.platform, 'xiaohongshu'); assert.equal(intent.capability, 'note-video');
    await click('TikTok'); await click('已有视频混剪');
    assert.equal(intent.platform, 'tiktok'); assert.equal(intent.capability, 'product-remix');
    await click('梦境故事');
    assert.equal(intent.type, 'creation.start'); assert.equal(intent.capability, 'dream-story');
    await click('退出创作模式');
    assert.equal(dom.window.document.querySelector('summary')?.textContent, '选择平台');
});
