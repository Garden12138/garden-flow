import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { resolveProductCaptureSpaceId } from '../electron/core/productCaptureSpace.ts';
import { createBrandWorkspaceStore } from '../electron/core/brandWorkspaceStore.ts';
import { validateCapturedProduct } from '../electron/core/productCaptureValidation.ts';

const source = await fs.readFile(new URL('../electron/appMain.ts', import.meta.url), 'utf8');
const scope = source.slice(source.indexOf("  const captureSpaceId = method === 'assets.ingestProduct'"), source.indexOf('  return browserCaptureOperationResults.run(operationKey'));
const branchStart = source.indexOf("    } else if (method === 'assets.ingestProduct') {") + "    } else if (method === 'assets.ingestProduct') {".length;
const body = source.slice(branchStart, source.indexOf("    } else {\n      throw bridgePayloadError('METHOD_NOT_ALLOWED'", branchStart));
const code = (await transform(`globalThis.ingest = async (params, payload) => { const method = 'assets.ingestProduct'; const operationId = params.operationId; ${scope} let result; ${body} return { ...result, operationKey }; };`, { loader: 'ts' })).code;

test('capture space resolver accepts only existing space IDs and defaults to the request-start active space', () => {
    assert.equal(resolveProductCaptureSpaceId(undefined, 'default', ['default', 'other']), 'default');
    assert.equal(resolveProductCaptureSpaceId('default', 'other', ['default', 'other']), 'default');
    for (const id of ['', 1, {}, '../other', 'removed']) assert.throws(() => resolveProductCaptureSpaceId(id, 'default', ['default', 'other']), /空间/);
});

test('actual product ingest branch pins assets, snapshots and index even when the UI switches during media download', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-capture-space-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let active = 'default'; const events: any[] = [];
    const context: any = {
        path, resolveProductCaptureSpaceId, createBrandWorkspaceStore, validateCapturedProduct,
        getActiveSpaceId: () => active, listSpaces: () => [{ id: 'default' }, { id: 'other' }],
        getWorkspacePathsForSpace: (id: string) => ({ subjects: path.join(root, id, 'subjects') }),
        XHS_ASSET_REQUEST_HEADERS: { 'User-Agent': 'fixture', 'Accept-Language': 'zh-CN' },
        localizeCapturedProductMedia: async () => { active = 'other'; return { images: [{ sourceUrl: 'https://img.alicdn.com/space.png', role: 'gallery', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1WQAAAABJRU5ErkJggg==' }], reviewCapture: undefined, failedImages: 0, failureReasons: [] }; },
        emitRendererDataChanged: (...args: any[]) => events.push(args),
    };
    vm.runInNewContext(code, context);
    const product = { platform: 'taobao', externalId: '1', sourceUrl: 'https://item.taobao.com/item.htm?id=1', title: '空间隔离商品', images: [{ sourceUrl: 'https://img.alicdn.com/space.png', role: 'gallery' }] };
    const first = await context.ingest({ operationId: 'same' }, product);
    assert.equal(first.operationKey, 'assets.ingestProduct:default:same'); assert.ok(first.productId); assert.ok(first.snapshotId);
    const defaultStore = createBrandWorkspaceStore(() => path.join(root, 'default/subjects/brand-workspace'));
    assert.equal((await defaultStore.list()).flatMap((brand) => brand.products).length, 1);
    assert.equal(events.length, 0);
    const bundle = (await defaultStore.get(first.productId)).product!;
    assert.equal(bundle.assets.length, 1);
    await fs.access(bundle.assets[0].absolutePath);
    assert.ok(bundle.assets[0].absolutePath.startsWith(path.join(root, 'default')));
    const second = await context.ingest({ operationId: 'recapture', spaceId: 'default' }, product);
    assert.equal(second.productId, first.productId); assert.equal(second.duplicate, true);
    assert.equal((await defaultStore.get(first.productId)).product!.sourceSnapshots.length, 2);
    await assert.rejects(fs.access(path.join(root, 'other/subjects/brand-workspace/catalog.json')));
    await fs.access(path.join(root, 'default/subjects/brand-workspace/ai-index.json'));
    await assert.rejects(context.ingest({ operationId: 'bad', spaceId: 'removed' }, product), /空间不存在/);
});
