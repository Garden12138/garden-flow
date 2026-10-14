import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { resolveProductCreationTarget } from '../shared/productCreationTarget.ts';

// Exercise the real runtime entry and permission gate, isolating persistence and HTTP only.
async function runtimeFixture(proposalTarget?: unknown) {
    const state = { executions: 0, calls: 0, checkpoints: [] as any[], events: [] as any[] };
    const stubs: Record<string, string> = {
        sessionRuntimeStore: 'export const getSessionRuntimeStore = () => ({ appendTranscript() {}, addCheckpoint(value) { globalThis.__state.checkpoints.push(value); }, listCheckpoints() { return []; }, listToolResults() { return []; } });',
        toolResultStore: 'export const getToolResultStore = () => ({ add() { return {id:"result"}; }, list() { return []; }, applyBudget(input) { return input; } });',
        compactManager: 'export class CompactManager { async maybeCompact() { return null; } }',
        memoryMaintenanceService: 'export const getMemoryMaintenanceService = () => ({ notifyQueryLifecycleEvent() {} });',
        runtimeHooks: 'export const executeRuntimeHooks = async () => {};',
        taskGraphRuntime: 'export const getTaskGraphRuntime = () => ({});',
        db: 'export const getChatMessages = () => [];',
        xhsAutoCaptureCompletion: 'export const applyXhsAutoCaptureCompletionGate = () => ({}); export const validateXhsAutoCaptureCompletion = () => ({complete:true});',
    };
    const bundled = await build({
        stdin: { contents: "export { QueryRuntime } from './electron/core/queryRuntime';", resolveDir: new URL('..', import.meta.url).pathname },
        bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
        plugins: [{ name: 'isolated-runtime-host', setup(builder) {
            builder.onResolve({ filter: /(?:sessionRuntimeStore|toolResultStore|compactManager|memoryMaintenanceService|runtimeHooks|taskGraphRuntime|xhsAutoCaptureCompletion|\/db)$/ }, args => {
                const key = args.path.split('/').pop()!;
                return { path: key, namespace: 'runtime-fixture' };
            });
            builder.onLoad({ filter: /.*/, namespace: 'runtime-fixture' }, args => ({ contents: stubs[args.path], loader: 'ts' }));
        } }],
    });
    const proposal = { proposalId: 'remix-runtime', productId: 'product', productUpdatedAt: 'v1', productName: '商品', referencedProductIds: ['product'], compositionMode: 'existing-clips', voiceoverEnabled: false,
        ...(proposalTarget ? { creationTarget: proposalTarget, publicationCopy: { title: 'Product cut', description: 'Original footage', hashtags: [] } } : {}), title: '已有片段', canvas: { width:1080, height:1920, fps:30, aspectRatio:'9:16' }, durationMs:1000,
        scenes: [{ id:'cut', title:'片段', source:'media-clip', productAssetIds:[], mediaAssetId:'video', mediaContentHash:'a'.repeat(64), sourceStartMs:0, sourceEndMs:1000, durationMs:1000, sourceVolume:1, motionPreset:'static', fitMode:'contain-blur' }] };
    const module = { exports: {} as any };
    vm.runInNewContext(bundled.outputFiles[0].text, { module, exports:module.exports, require:createRequire(new URL('../package.json', import.meta.url)), __state:state,
        console, Buffer, URL, Error, AbortController, setTimeout, clearTimeout,
        fetch: async () => { state.calls++; return new Response(JSON.stringify({ choices:[{message:{content:'',tool_calls:[{id:'call',function:{name:'product_video_compose',arguments:JSON.stringify(proposal)}}]}}] })); },
    });
    const tool = { name:'product_video_compose', kind:'edit', getDescription:()=>'混剪', shouldConfirmExecute:()=>true, getConfirmationDetails:()=>({type:'info',title:'确认混剪',description:'',requiresUserAcknowledgement:true}) };
    const registry = { getTool:()=>tool, getToolSchemas:()=>[], getAllTools:()=>[tool] };
    const executor = { execute:async (request:any) => { state.executions++; assert.equal(request.forceConfirmation,true); return {callId:request.callId,name:request.name,durationMs:0,result:{success:true,llmContent:'Waiting',data:{kind:'tool-confirmation-pending',callId:request.callId,toolName:request.name,proposalId:proposal.proposalId}}}; } };
    const config = { sessionId:'session',apiKey:'fixture',baseURL:'https://fixture.invalid/v1',model:'fixture',systemPrompt:'规划混剪',messages:[],toolPack:'gardenflow',runtimeMode:'gardenflow',workflowKind:'product-video-compose',
        productVideoCompositionMode:'existing-clips',explicitProductRefs:[{productId:'product',name:'商品',updatedAt:'v1'}],explicitVideoClipRefs:[{assetId:'video',title:'片段',contentHash:'a'.repeat(64),durationMs:15000,width:1080,height:1920,fps:30,hasAudio:true,previewUrl:'gardenflow-asset://asset/fixture.mp4'}],maxTurns:1 };
    return { state, run: (overrides:any={}) => new module.exports.QueryRuntime(registry,executor,{onEvent:(event:any)=>state.events.push(event)},{...config,...overrides}).run('使用已选视频规划混剪') };
}

test('existing clips reach a human approval through the real runtime without product image evidence', async () => {
    const h = await runtimeFixture();
    const result = await h.run();
    assert.equal(result.error, undefined, JSON.stringify(h.state.events));
    assert.equal(result.awaitingApproval?.toolName, 'product_video_compose');
    assert.equal(h.state.calls, 1, 'only the mocked planning model is called');
    assert.ok(h.state.checkpoints.some(checkpoint => checkpoint.checkpointType === 'tool.awaiting_approval'));
    assert.ok(!h.state.checkpoints.some(checkpoint => checkpoint.checkpointType === 'product-video.visual-input.rejected'));
});

test('ordinary product videos and image sets still reject missing visual input before any model request', async () => {
    for (const overrides of [{productVideoCompositionMode:'product-images'}, {workflowKind:'product-image-set-compose'}, {explicitProductRefs:[]}]) {
        const h = await runtimeFixture();
        const result = await h.run(overrides);
        assert.match(result.error, /视觉输入未通过/);
        assert.equal(h.state.calls, 0);
    }
});


test('the real runtime preserves the chosen platform and blocks a model target override before approval', async () => {
    const target = resolveProductCreationTarget({ platform: 'tiktok', compositionMode: 'existing-clips' });
    const matched = await runtimeFixture(target);
    assert.equal((await matched.run({ creationTarget: target })).awaitingApproval?.toolName, 'product_video_compose');
    assert.equal(matched.state.executions, 1);
    const mismatched = await runtimeFixture(resolveProductCreationTarget({ platform: 'xiaohongshu', compositionMode: 'existing-clips' }));
    assert.equal((await mismatched.run({ creationTarget: target })).awaitingApproval, undefined);
    assert.equal(mismatched.state.executions, 0);
});
