import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

for (const [file, factory] of [
    ['productStructuredCapture.ts', 'createProductStructuredCaptureIo'],
    ['xhsStructuredCapture.ts', 'createXhsStructuredCaptureIo'],
]) {
    const source = await fs.readFile(new URL(`../electron/core/${file}`, import.meta.url), 'utf8');
    const code = (await transform(source.slice(source.indexOf(`export function ${factory}(`)), { loader: 'ts', format: 'cjs' })).code;
    const create = (bridge: any) => {
        const context: any = { module: { exports: {} }, getBrowserCaptureBridgeService: () => bridge };
        vm.runInNewContext(code, context);
        return context.module.exports[factory]();
    };

    test(`${factory} pins a capture instance across search, save and cleanup despite activity changes`, async () => {
        const publisher = { extensionKind: 'xhs-publisher', extensionInstanceId: 'publisher' };
        const first = { extensionKind: 'capture', extensionInstanceId: 'first' };
        const second = { extensionKind: 'capture', extensionInstanceId: 'second' };
        let instances = [publisher, first, second];
        const forwarded: any[] = [];
        const io = create({
            getStatus: () => ({ instances }),
            invokeBrowserControl: async (method: string, params: any, options: any) => {
                forwarded.push({ method, params, options });
                if (!instances.some((instance) => instance.extensionInstanceId === options.extensionInstanceId)) {
                    throw Object.assign(new Error('实例已断开'), { code: 'BROWSER_INSTANCE_UNAVAILABLE' });
                }
                return { ok: true };
            },
        });
        assert.equal(io.checkPluginInstance().ok, true);
        await io.invokeBrowserControl('tools/call', { name: 'research.run' }, { timeoutMs: 90000 });
        instances = [second, publisher, first];
        await io.invokeBrowserControl('tools/call', { name: 'capture.save' }, { timeoutMs: 180000 });
        await io.invokeBrowserControl('tools/call', { name: 'tabs.close' }, { timeoutMs: 30000 });
        assert.ok(forwarded.every((call) => call.options.extensionKind === 'capture' && call.options.extensionInstanceId === 'first'));
        assert.deepEqual(forwarded.map((call) => call.options.timeoutMs), [90000, 180000, 30000]);
        instances = [publisher, second];
        assert.equal(io.checkPluginInstance().ok, false);
        await assert.rejects(io.invokeBrowserControl('tools/call', { name: 'tabs.close' }), { code: 'BROWSER_INSTANCE_UNAVAILABLE' });
        assert.equal(forwarded.at(-1).options.extensionInstanceId, 'first');
    });

    test(`${factory} rejects publisher-only connections and pins direct invocations without a readiness call`, async () => {
        let instances = [{ extensionKind: 'xhs-publisher', extensionInstanceId: 'publisher' }];
        const forwarded: any[] = [];
        const io = create({ getStatus: () => ({ instances }), invokeBrowserControl: async (_: string, _params: any, options: any) => forwarded.push(options) });
        assert.equal(io.checkPluginInstance().ok, false);
        await assert.rejects(io.invokeBrowserControl('tools/call', {}), /采集插件/);
        assert.equal(forwarded.length, 0);
        instances.push({ extensionKind: 'capture', extensionInstanceId: 'first' });
        await io.invokeBrowserControl('tools/call', {});
        instances = [{ extensionKind: 'capture', extensionInstanceId: 'second' }, ...instances];
        await io.invokeBrowserControl('tools/call', {});
        assert.ok(forwarded.every((options) => options.extensionKind === 'capture' && options.extensionInstanceId === 'first'));
    });
}
