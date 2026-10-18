import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { resolveProductCreationTarget } from '../shared/productCreationTarget.ts';

test('main process keeps TikTok confirmation, account, review and unknown states durable', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-tiktok-publish-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const mediaRoot = path.join(root, 'media');
    await fs.mkdir(mediaRoot);
    await fs.writeFile(path.join(mediaRoot, 'current.mp4'), Buffer.from('fixture video'));
    const state = {
        root, spaceId: 'default', binding: 'extension-1', accountId: 'account_1', submitStatus: 'pending_review',
        statusFailure: false, coverSupported: false, coverDigest: 'c'.repeat(64), requests: [] as any[],
        pageState: 'ready', prepareFailure: false, disconnected: false, resetStatus: 'ready',
        receiptMismatch: false, postReceipt: null as any, onPrepare: null as null | ((request: any) => Promise<void>), ownedJobId: '', reviewFailure: false, reviews: [] as any[],
        jobs: new Map<string, any>(), versions: new Map<string, any>(), browserCalls: [] as string[],
        project: {
            id: 'project-1', projectKind: 'product-video', productVideo: { scenes: [] },
            canvas: { aspectRatio: '9:16', width: 1080, height: 1920, fps: 30 }, renderOutputs: [{ id: 'render-1', mediaAssetId: 'media-1' }],
        },
    };
    const version = {
        id: 'version-1', spaceId: 'default', sourceProjectId: 'source-1', projectId: 'project-1',
        sourceProductId: 'product-1', sourceProductUpdatedAt: '2026-09-29', title: 'TikTok版',
        description: '介绍商品', hashtags: ['猫粮'], language: 'en', market: 'International', publishSettings: { visibility: 'everyone', allowComments: true, allowReuse: true, allowRemix: true, audience18Plus: false, commercialContent: 'none', aiGenerated: false }, revision: 1, createdAt: 1, updatedAt: 1,
    };
    state.versions.set(version.id, version);
    const mocks: Record<string, string> = {
        dreamRender: `export const currentDreamExport = async () => { throw new Error('unexpected dream source'); };`,
        execution: `export const requirePublicationAction = async () => ({}); export const validatePublicationContext = async () => ({}); export const recordPublicationUpload = () => {};`,
        completion: `export const recordCompletedPublication = async () => {};`,
        source: `export const readPublicationSource = async () => ({media:[]});`,

        editor: `export const saveManualProductPublication = () => { throw new Error('publisher cannot edit projects'); }; export const saveManualProductImageSet = () => { throw new Error('publisher cannot edit image sets'); }; export const resolveProductNoteEditor = async () => null; export const saveManualProductVideoNote = () => { throw new Error('publisher cannot edit product notes'); };`,
        db: `export const assertProductEditsSettled = () => {}; export const getProductEditorPublicationRevision = () => ''; const s = globalThis.fixture;
            export const getActiveSpaceId = () => s.spaceId;
            export const getWorkspacePaths = () => ({ media: s.root + '/media', manuscripts: s.root + '/manuscripts', activeSpaceId: s.spaceId });
            export const runInWorkspaceSpace = (_space, operation) => operation();
            export const getDouyinVideoVersionByProject = (id) => null;
            export const getTikTokVideoVersionByProject = (id) => [...s.versions.values()].find(v => v.projectId === id && v.spaceId === s.spaceId) || null;
            export const insertDouyinVideoVersion = () => { throw new Error('unexpected version creation'); };
            export const insertTikTokVideoVersion = () => { throw new Error('unexpected version creation'); };
            export const getTikTokVideoVersion = (id) => { const v=s.versions.get(id); return v?.spaceId === s.spaceId ? v : null; };
            export const getTikTokPublishJob = (id) => { const j=s.jobs.get(id); return j?.spaceId === s.spaceId ? j : null; };
            export const listTikTokPublishJobs = () => [...s.jobs.values()].filter(j => j.spaceId === s.spaceId).sort((a,b)=>b.createdAt-a.createdAt);
            export const upsertTikTokPublishJob = (j) => s.jobs.set(j.id,j);
            export const getTikTokPublisherBinding = () => s.binding;
            export const setTikTokPublisherBinding = (value) => { s.binding=value; };`,
        electron: `export const BrowserWindow = { getAllWindows: () => [] };`,
        browser: `const s=globalThis.fixture;
            export const getBrowserCaptureBridgeService = () => s.disconnected ? null : ({
                getStatus: () => ({ instances: [{ extensionKind:'xhs-publisher',extensionInstanceId:'extension-1',capabilities:['tiktok.publish.v1', ...(s.coverSupported ? ['tiktok.image-cover.v1'] : [])],browser:'chrome' }] }),
                invokeBrowserControl: async (method, params) => {
                    s.browserCalls.push(method + ':' + (params.phase || 'status'));
                    if (params.request) s.requests.push(params.request);
                    if (method === 'publisher.status' && s.statusFailure) throw new Error('页面暂时不可读');
                    if (method === 'publisher.status') return { pageState:s.pageState,accountId:s.accountId,accountLabel:'@' + s.accountId,ownedJobId:s.ownedJobId || undefined };
                    if (params.phase === 'review-published') {
                        s.reviews.push(params);
                        if (s.reviewFailure) return {ok:false,message:'原任务归属无法核验'};
                        s.ownedJobId='';
                        return {ok:true,jobId:params.jobId,contentDigest:params.contentDigest,publishStatus:'published',resetStatus:'ready'};
                    }
                    if (params.phase === 'read-receipt') return { ok:true,jobId:params.request.jobId,contentDigest:params.request.contentDigest,publishStatus:'published',receipt:s.postReceipt };
                    if (params.phase === 'prepare') { await s.onPrepare?.(params.request); return s.prepareFailure
                        ? { ok:false,publishStatus:'not_submitted',code:'UPLOAD_FAILED',message:'视频上传失败' }
                        : { ok:true,jobId:params.request.jobId,contentDigest:params.request.contentDigest,prepared:true,publishStatus:'not_submitted' }; }
                    if (params.phase === 'submit') return { ok:true,jobId:s.receiptMismatch ? 'wrong-job' : params.request.jobId,contentDigest:params.request.contentDigest,publishStatus:s.submitStatus,resetStatus:s.resetStatus };
                    if (params.phase === 'recover') { s.ownedJobId=''; return { ok:true,jobId:params.jobId,contentDigest:params.contentDigest,resetStatus:'ready' }; }
                    throw new Error('unexpected browser call');
                },
            });`,
        media: `export const bindMediaAssetToManuscript = async () => { throw new Error('publisher cannot bind media'); };const s=globalThis.fixture; export const getAbsoluteMediaPath = (p) => s.root + '/media/' + p;
            export const listMediaAssets = async () => [{ id:'media-1',relativePath:'current.mp4',mimeType:'video/mp4' }];`,
        local: `export const isPathWithinRoots = (p, roots) => p.startsWith(roots[0] + '/');
            export const toAppAssetUrl = (p) => 'app-asset://' + p;`,
        project: `export const getVideoEditorV2Project = async () => globalThis.fixture.project;
            export const listVideoEditorV2Projects = async () => [globalThis.fixture.project];
            export const enqueueProductProjectMutation = (_, operation) => operation();
            export const updateProductWorkMetadata = async () => { throw new Error('publisher cannot mutate metadata'); };
            export const saveVideoEditorV2Project = async () => { throw new Error('publisher cannot mutate project'); };
            export const cloneProductVideoProject = async () => { throw new Error('publisher cannot create project'); };`,
        cover: `const s=globalThis.fixture; export const prepareTikTokImageCover=async (_,assetId)=>assetId ? ({assetId, sourceSha256:s.coverDigest, crop:'center', files:[{orientation:'portrait',path:'/fixture/portrait.jpg',sha256:s.coverDigest,width:1080,height:1440},{orientation:'landscape',path:'/fixture/landscape.jpg',sha256:s.coverDigest,width:1440,height:1080}]}) : undefined;`,
        policy: `export const videoRenderFingerprint = () => 'fixture-fingerprint'; export const assertCurrentVideoExport = (project) => { if (project.renderOutputs[0]?.mediaAssetId !== 'media-1') throw new Error('stale export'); };`,
    };
    const code = await build({
        stdin: { contents: `export * from './desktop/electron/core/tiktokPublisherService.ts';`, resolveDir: path.resolve(import.meta.dirname, '../..') },
        bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
        plugins: [{ name: 'tiktok-host', setup(builder) {
            builder.onResolve({ filter: /.*/ }, (args) => {
                const key = args.path.endsWith('/publicationExecutionPolicy') ? 'execution' : args.path.endsWith('/publicationCompletionService') ? 'completion' : args.path.endsWith('/publicationSource') ? 'source' : args.path.endsWith('/productProjectEditorService') ? 'editor' : args.path === 'electron' ? 'electron'
                    : args.path.endsWith('/db') ? 'db'
                        : args.path.endsWith('/browserCaptureBridgeService') ? 'browser'
                            : args.path.endsWith('/mediaLibraryStore') ? 'media'
                                : args.path.endsWith('/localAssetManager') ? 'local'
                                    : args.path.endsWith('/videoEditorV2ProjectStore') ? 'project'
                                        : args.path.endsWith('/dreamStoryRenderService') ? 'dreamRender' : args.path.endsWith('/videoPublicationPolicy') ? 'policy' : args.path.endsWith('/tiktokImageCover') ? 'cover' : '';
                return key ? { path: key, namespace: 'fixture' } : undefined;
            });
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path], loader: 'ts' }));
        } }],
    });
    const module = { exports: {} as any };
    vm.runInNewContext(code.outputFiles[0].text, {
        module, exports: module.exports, fixture: state, require: createRequire(new URL('../package.json', import.meta.url)),
        process, console, Buffer, URL, setTimeout, clearTimeout,
    });
    const service = new module.exports.TikTokPublisherService();

    await t.test('new target/spec binds confirmation digest and wrong platform preserves submitted history', async () => {
        const legacy = await service.prepare(version.id, 'session-target');
        (state.project as any).creationTarget = resolveProductCreationTarget({ platform: 'tiktok' });
        const targeted = await service.prepare(version.id, 'session-target');
        assert.notEqual(targeted.contentDigest, legacy.contentDigest);
        const unknown = { ...targeted, id: 'history-unknown', status: 'submit_result_unknown', publishStatus: 'unknown' };
        const published = { ...targeted, id: 'history-published', status: 'completed', publishStatus: 'published' };
        state.jobs.set(unknown.id, unknown); state.jobs.set(published.id, published);
        const before = JSON.stringify([state.jobs.get(unknown.id), state.jobs.get(published.id)]);
        (state.project as any).creationTarget = resolveProductCreationTarget({ platform: 'douyin' });
        await assert.rejects(service.prepare(version.id, 'session-target'), /目标/);
        assert.equal(JSON.stringify([state.jobs.get(unknown.id), state.jobs.get(published.id)]), before);
        state.jobs.delete(unknown.id); state.jobs.delete(published.id);
        delete (state.project as any).creationTarget;
        service.cancel(targeted.id);
    });
    const prepared = await service.prepare(version.id, 'session-1');
    assert.equal(prepared.status, 'awaiting_confirmation');
    assert.equal((await service.prepare(version.id, 'session-1')).id, prepared.id);
    assert.notEqual(prepared.mediaPath, path.join(mediaRoot, 'current.mp4'));
    assert.ok(path.basename(prepared.mediaPath).includes(prepared.id));
    assert.equal(state.browserCalls.some(call => call.endsWith(':prepare') || call.endsWith(':submit')), false);
    state.accountId = 'other_account';
    await assert.rejects(service.confirm(prepared.id), /账号/);
    state.accountId = 'account_1';
    await fs.writeFile(prepared.mediaPath, 'changed copy');
    await assert.rejects(service.stageDraft(prepared.id), /成片/);
    await fs.copyFile(path.join(mediaRoot, 'current.mp4'), prepared.mediaPath);
    const stages = await Promise.all([service.stageDraft(prepared.id), service.stageDraft(prepared.id)]);
    assert.equal(stages[0].id, stages[1].id);
    assert.equal(state.browserCalls.filter(call => call.endsWith(':prepare')).length, 1);
    assert.equal(state.browserCalls.filter(call => call.endsWith(':submit')).length, 0);
    const confirmations = await Promise.allSettled([service.confirm(prepared.id), service.confirm(prepared.id)]);
    assert.equal(confirmations.filter(result => result.status === 'fulfilled').length, 1);
    await (service as any).queue;
    assert.equal(service.getJob(prepared.id).status, 'submitted_pending_review');
    assert.equal(state.browserCalls.filter(call => call.endsWith(':submit')).length, 1);
    await assert.rejects(service.confirm(prepared.id), /失效/);
    await assert.rejects(service.prepare(version.id, 'session-1'), /核实/);
    state.ownedJobId = prepared.id;
    const reviewed = await service.reviewPublished(prepared.id, true);
    assert.equal(reviewed.status, 'completed');
    assert.equal(reviewed.publishedReview.kind, 'user-verified-published');
    assert.equal(state.ownedJobId, '');
    const receipt = { source: 'tiktok-studio-posts', videoId: '7000000000000000001',
        url: 'https://www.tiktok.com/@account_1/video/7000000000000000001', accountId: 'account_1',
        caption: '介绍商品 #猫粮', visibility: 'everyone', durationText: '00:15', publishedLabel: 'Oct 11, 12:25 PM', observedAt: Date.now() };
    const validateReceipt = module.exports.validateTikTokPostReceipt;
    for (const changed of [
        { url: 'https://evil.invalid/@account_1/video/7000000000000000001' },
        { url: receipt.url + '?other=1' }, { videoId: '7000000000000000002' }, { accountId: 'other' },
        { caption: 'other caption' }, { visibility: 'only_me' }, { source: 'success-toast' },
        { publishedLabel: 'Pending review' }, { observedAt: Date.now() - 120_000 }, { durationText: '00:99' },
    ]) assert.throws(() => validateReceipt({ ...receipt, ...changed }, reviewed));
    assert.throws(() => validateReceipt(receipt, { ...reviewed, mediaDurationMs: 30_000 }), /时长/);
    state.postReceipt = receipt;
    const beforeReceipt = JSON.stringify({ project: state.project, version: state.versions.get(version.id) });
    const withReceipt = await service.readReceipt(reviewed.id);
    assert.equal(withReceipt.receipt.url, receipt.url);
    assert.equal(withReceipt.status, 'completed');
    assert.equal(withReceipt.publishedReview.kind, 'user-verified-published');
    assert.equal(JSON.stringify({ project: state.project, version: state.versions.get(version.id) }), beforeReceipt);
    state.postReceipt = { ...receipt, videoId: '7000000000000000002', url: 'https://www.tiktok.com/@account_1/video/7000000000000000002' };
    await assert.rejects(service.readReceipt(reviewed.id), /不一致/);
    assert.equal(service.getJob(reviewed.id).receipt.url, receipt.url);
    const nextVersion = { ...version, revision: 2, description: 'Changed caption' };
    state.versions.set(version.id, nextVersion);
    const next = await service.prepare(version.id, 'session-2');
    state.versions.set(version.id, { ...nextVersion, revision: 3 });
    await assert.rejects(service.confirm(next.id), /更新/);
    assert.equal(service.getJob(next.id).status, 'superseded');
    const unknown = await service.prepare(version.id, 'session-3');
    state.submitStatus = 'unknown';
    await service.confirm(unknown.id);
    await (service as any).queue;
    assert.equal(service.getJob(unknown.id).status, 'submit_result_unknown');
    await assert.rejects(service.readReceipt(unknown.id), /先核实/);
    const reopened = new module.exports.TikTokPublisherService();
    await assert.rejects(reopened.confirm(unknown.id), /失效/);
    await assert.rejects(reopened.prepare(version.id, 'session-3'), /核实/);
    await assert.rejects(reopened.recoverUnpublished(unknown.id, false), /核实/);
    const recovered = await reopened.recoverUnpublished(unknown.id, true);
    assert.equal(recovered.status, 'superseded');
    const retry = await reopened.prepare(version.id, 'session-4');
    assert.notEqual(retry.id, unknown.id);
    assert.equal(state.jobs.get(unknown.id).errorCode, 'USER_VERIFIED_NOT_PUBLISHED');
    reopened.cancel(retry.id);
    const cancelledRetry = await reopened.prepare(version.id, 'session-4');
    assert.notEqual(cancelledRetry.id, retry.id);
    assert.equal(state.jobs.get(retry.id).status, 'cancelled');
    state.onPrepare = async request => { await fs.writeFile(request.mediaPath, 'tampered during upload'); };
    await reopened.stageDraft(cancelledRetry.id);
    await (reopened as any).queue;
    assert.equal(reopened.getJob(cancelledRetry.id).status, 'blocked');
    assert.ok(reopened.getJob(cancelledRetry.id).errorMessage.includes('成片'));
    state.onPrepare = null;
    await fs.copyFile(path.join(mediaRoot, 'current.mp4'), cancelledRetry.mediaPath);
    state.receiptMismatch = true;
    await reopened.confirm(cancelledRetry.id);
    await (reopened as any).queue;
    assert.equal(reopened.getJob(cancelledRetry.id).errorCode, 'RECEIPT_MISMATCH');
    state.receiptMismatch = false;
    state.jobs.set(cancelledRetry.id, { ...cancelledRetry, status: 'submitting', publishStatus: 'submitted' });
    const interrupted = new module.exports.TikTokPublisherService();
    assert.equal(interrupted.getJob(cancelledRetry.id).status, 'submit_result_unknown');
    const count = state.browserCalls.filter(call => call.endsWith(':submit')).length;
    await assert.rejects(interrupted.confirm(cancelledRetry.id), /失效/);
    assert.equal(state.browserCalls.filter(call => call.endsWith(':submit')).length, count);
    state.spaceId = 'other';
    assert.equal(interrupted.getJob(prepared.id), null);
    await assert.rejects(interrupted.confirm(prepared.id), /失效/);
});
