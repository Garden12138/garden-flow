// pnpm --dir desktop exec node --test tests/campaignTools.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import { build } from 'esbuild';

test('existing Agent tools expose typed read/propose only; invalid scope and targets never become engineering actions', async () => {
    const bundled = await build({ stdin: { contents: "export { CampaignReadTool, CampaignProposeTool } from './electron/core/tools/campaignTools';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'isolated-tool-host', setup(plugin) {
        plugin.onResolve({ filter: /campaignsRuntime$/ }, () => ({ path: 'runtime', namespace: 'fixture-runtime' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture-runtime' }, () => ({ contents: "export const createLocalContentCampaignsService=()=>{throw new Error('test must inject a scoped service');};", loader: 'js' }));
        plugin.onResolve({ filter: /toolRegistry$/ }, () => ({ path: 'registry', namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "export class DeclarativeTool {} export const ToolKind={Read:'read',Edit:'edit'};export const ToolErrorType={INVALID_PARAMS:'INVALID_PARAMS',EXECUTION_FAILED:'EXECUTION_FAILED'};export const createErrorResult=(message,type)=>({success:false,llmContent:message,error:{message,type}});", loader: 'js' }));
    } }] });
    const module = { exports: {} as any }; vm.runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)) });
    let proposals = 0; let reads = 0; let foreign = false;
    const provider = async () => ({ list: () => [{ id: 'group', title: '合成组', status: 'active', revision: 1 }], planningContext: async (id: string) => { reads++; if (foreign || id !== 'group') throw new Error('/private/secret/database'); return { id, resources: [], supportedTargets: [{ platform: 'xiaohongshu', capability: 'note-image' }] }; },
        propose: (input: any) => { if (foreign) throw new Error('/private/secret/database'); proposals++; return { id: input.id, revision: 2, items: input.items.map((item: any, index: number) => ({ ...item, id: 'item-' + index, state: 'planned' })) }; } });
    const read = new module.exports.CampaignReadTool(provider); const propose = new module.exports.CampaignProposeTool(provider);
    const schema = propose.getFunctionSchema(); assert.equal(schema.function.parameters.properties.items.minItems, 3); assert.equal(schema.function.parameters.properties.items.maxItems, 8);
    assert.equal(read.kind, 'read'); assert.equal(propose.kind, 'edit'); assert.equal((await read.execute({})).success, true); assert.equal(reads, 0);
    assert.equal((await read.execute({ id: 'group' })).success, true); foreign = true;
    const denied = await read.execute({ id: 'group' }); assert.equal(denied.success, false); assert.ok(!denied.llmContent.includes('/private/secret'));
    foreign = false;
    const item = { role: 'awareness', title: '合成候选', why: '未验证职责', opportunity: { id: 'opp', revision: 2 }, evidenceRefs: ['evidence'], target: { platform: 'xiaohongshu', capability: 'note-image' }, assetNeeds: [], dependsOn: [] };
    const input = { id: 'group', requestId: 'call-one', expectedRevision: 1, items: ['awareness', 'education', 'objection'].map(role => ({ ...item, role })) };
    assert.equal((await propose.execute(input)).success, true); assert.equal(proposals, 1);
    assert.equal((await propose.execute({ ...input, items: input.items.map(value => ({ ...value, target: { platform: 'tiktok', capability: 'note-image' } })) })).success, false); assert.equal(proposals, 1);
    assert.equal((await propose.execute({ ...input, spaceId: 'foreign' })).success, false); assert.equal(proposals, 1);
    const source = await fs.readFile(new URL('../electron/core/tools/index.ts', import.meta.url), 'utf8'); assert.ok(source.includes('CampaignReadTool, CampaignProposeTool'));
});
