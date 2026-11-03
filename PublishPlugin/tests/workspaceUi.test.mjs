// Run: pnpm --dir PublishPlugin test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('publisher popup reads status and opens the desktop only after the explicit navigation click', async () => {
    const elements = new Map(); const messages = [];
    const element = id => {
        if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false, dataset: {}, listeners: {}, addEventListener(name, listener) { this.listeners[name] = listener; } });
        return elements.get(id);
    };
    const source = await fs.readFile(new URL('../src/popup.js', import.meta.url), 'utf8');
    vm.runInNewContext(source, { document: { getElementById: element }, chrome: { runtime: { sendMessage: async message => { messages.push(message); return message.type === 'publisher.status' ? { nativeConnected: true, publishTabCount: 1, accountLabel: '<演示账号>', pageState: 'ready' } : { success: true }; } } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.length, 3); assert.ok(messages.every(message => message.type === 'publisher.status'));
    assert.ok(element('status').textContent.includes('<演示账号>'));
    await element('open-desktop').listeners.click();
    assert.equal(messages.at(-1).type, 'desktop:open');
    assert.equal(element('open-result').textContent, '已打开桌面发布任务。');
    assert.equal(messages.some(message => message.type.includes('submit') || message.type.includes('publish:')), false);
});
