// Run: pnpm --dir desktop exec node --test tests/networkProxy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

test('proxy application commits the Node dispatcher and child environment only after Electron accepts it', async () => {
    const bundle = await build({
        entryPoints: [new URL('../electron/core/networkProxy.ts', import.meta.url).pathname],
        bundle: true,
        external: ['electron', 'undici'],
        format: 'cjs',
        platform: 'node',
        supported: { 'dynamic-import': false },
        write: false,
    });
    const env: Record<string, string> = {};
    const installed: object[] = [];
    let rejectProxy = true;
    const localProxy = 'http://127.0.0.1:45678';
    const session = { defaultSession: { setProxy: async () => {
        assert.equal(env.HTTPS_PROXY, undefined);
        assert.equal(installed.length, 0);
        if (rejectProxy) throw new Error('Electron rejected the proxy');
    } } };
    class Dispatcher {
        readonly options?: Record<string, string>;
        constructor(options?: Record<string, string>) { this.options = options; }
        async close() {}
    }
    const module = { exports: {} as typeof import('../electron/core/networkProxy.ts') };
    vm.runInNewContext(bundle.outputFiles[0].text, {
        module, exports: module.exports, process: { env }, require: (id: string) => {
            if (id === 'electron') return { session };
            assert.equal(id, 'undici');
            return { Agent: Dispatcher, EnvHttpProxyAgent: Dispatcher, setGlobalDispatcher: (value: object) => installed.push(value) };
        },
    });
    const { applyGlobalNetworkProxy } = module.exports;
    const settings = { proxy_enabled: true, proxy_url: localProxy };
    await assert.rejects(applyGlobalNetworkProxy(settings), /Electron rejected the proxy/);
    assert.deepEqual(env, {});
    assert.equal(installed.length, 0);
    rejectProxy = false;
    await applyGlobalNetworkProxy(settings);
    assert.equal(env.HTTPS_PROXY, localProxy);
    assert.equal((installed[0] as Dispatcher).options?.httpsProxy, localProxy);
});
