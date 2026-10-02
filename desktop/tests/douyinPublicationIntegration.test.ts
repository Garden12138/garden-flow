import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

test('main process keeps Douyin confirmation, account, review and unknown states durable', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-douyin-publish-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const mediaRoot = path.join(root, 'media');
    await fs.mkdir(mediaRoot);
    await fs.writeFile(path.join(mediaRoot, 'current.mp4'), Buffer.from('fixture video'));
    const state = {
        root, spaceId: 'default', binding: 'extension-1', accountId: 'account-1', submitStatus: 'pending_review',
        statusFailure: false, coverSupported: false, coverDigest: 'c'.repeat(64), requests: [] as any[],
        pageState: 'ready', prepareFailure: false, disconnected: false, resetStatus: 'ready',
        ownedJobId: '', reviewFailure: false, reviews: [] as any[],
        jobs: new Map<string, any>(), versions: new Map<string, any>(), browserCalls: [] as string[],
        project: {
            id: 'project-1', projectKind: 'product-video', productVideo: { scenes: [] },
            canvas: { aspectRatio: '9:16' }, renderOutputs: [{ id: 'render-1', mediaAssetId: 'media-1' }],
        },
    };
    const version = {
        id: 'version-1', spaceId: 'default', sourceProjectId: 'source-1', projectId: 'project-1',
        sourceProductId: 'product-1', sourceProductUpdatedAt: '2026-09-29', title: '抖音版',
        description: '介绍商品', hashtags: ['猫粮'], revision: 1, createdAt: 1, updatedAt: 1,
    };
    state.versions.set(version.id, version);
    const mocks: Record<string, string> = {
        db: `const s = globalThis.fixture;
            export const getActiveSpaceId = () => s.spaceId;
            export const getWorkspacePaths = () => ({ media: s.root + '/media' });
            export const getDouyinVideoVersion = (id) => { const v=s.versions.get(id); return v?.spaceId === s.spaceId ? v : null; };
            export const getDouyinPublishJob = (id) => { const j=s.jobs.get(id); return j?.spaceId === s.spaceId ? j : null; };
            export const listDouyinPublishJobs = () => [...s.jobs.values()].filter(j => j.spaceId === s.spaceId).sort((a,b)=>b.createdAt-a.createdAt);
            export const upsertDouyinPublishJob = (j) => s.jobs.set(j.id,j);
            export const getDouyinPublisherBinding = () => s.binding;
            export const setDouyinPublisherBinding = (value) => { s.binding=value; };`,
        electron: `export const BrowserWindow = { getAllWindows: () => [] };`,
        browser: `const s=globalThis.fixture;
            export const getBrowserCaptureBridgeService = () => s.disconnected ? null : ({
                getStatus: () => ({ instances: [{ extensionKind:'xhs-publisher',extensionInstanceId:'extension-1',capabilities:['douyin.publish.v1', ...(s.coverSupported ? ['douyin.image-cover.v1'] : [])],browser:'chrome' }] }),
                invokeBrowserControl: async (method, params) => {
                    s.browserCalls.push(method + ':' + (params.phase || 'status'));
                    if (params.request) s.requests.push(params.request);
                    if (method === 'publisher.status' && s.statusFailure) throw new Error('页面暂时不可读');
                    if (method === 'publisher.status') return { pageState:s.pageState,accountId:s.accountId,accountLabel:'测试账号',ownedJobId:s.ownedJobId || undefined };
                    if (params.phase === 'review-published') {
                        s.reviews.push(params);
                        if (s.reviewFailure) return {ok:false,message:'原任务归属无法核验'};
                        s.ownedJobId='';
                        return {ok:true,jobId:params.jobId,publishStatus:'published',resetStatus:'ready'};
                    }
                    if (params.phase === 'prepare') return s.prepareFailure
                        ? { ok:false,publishStatus:'not_submitted',code:'UPLOAD_FAILED',message:'视频上传失败' }
                        : { ok:true,prepared:true,publishStatus:'not_submitted' };
                    if (params.phase === 'submit') return { ok:true,publishStatus:s.submitStatus,resetStatus:s.resetStatus };
                    throw new Error('unexpected browser call');
                },
            });`,
        media: `const s=globalThis.fixture; export const getAbsoluteMediaPath = (p) => s.root + '/media/' + p;
            export const listMediaAssets = async () => [{ id:'media-1',relativePath:'current.mp4',mimeType:'video/mp4' }];`,
        local: `export const isPathWithinRoots = (p, roots) => p.startsWith(roots[0] + '/');
            export const toAppAssetUrl = (p) => 'app-asset://' + p;`,
        project: `export const getVideoEditorV2Project = async () => globalThis.fixture.project;`,
        cover: `const s=globalThis.fixture; export const prepareDouyinImageCover=async (_,assetId)=>assetId ? ({assetId, sourceSha256:s.coverDigest, crop:'center', files:[{orientation:'portrait',path:'/fixture/portrait.jpg',sha256:s.coverDigest,width:1080,height:1440},{orientation:'landscape',path:'/fixture/landscape.jpg',sha256:s.coverDigest,width:1440,height:1080}]}) : undefined;`,
        policy: `export const assertCurrentVideoExport = (project) => { if (project.renderOutputs[0]?.mediaAssetId !== 'media-1') throw new Error('stale export'); };`,
    };
    const code = await build({
        stdin: { contents: `export * from './desktop/electron/core/douyinPublisherService.ts';`, resolveDir: path.resolve(import.meta.dirname, '../..') },
        bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
        plugins: [{ name: 'douyin-host', setup(builder) {
            builder.onResolve({ filter: /.*/ }, (args) => {
                const key = args.path === 'electron' ? 'electron'
                    : args.path.endsWith('/db') ? 'db'
                        : args.path.endsWith('/browserCaptureBridgeService') ? 'browser'
                            : args.path.endsWith('/mediaLibraryStore') ? 'media'
                                : args.path.endsWith('/localAssetManager') ? 'local'
                                    : args.path.endsWith('/videoEditorV2ProjectStore') ? 'project'
                                        : args.path.endsWith('/videoPublicationPolicy') ? 'policy' : args.path.endsWith('/douyinImageCover') ? 'cover' : '';
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
    const service = new module.exports.DouyinPublisherService();
    await t.test('image covers require capable plugin and upload for review never submits', async () => {
        const coverVersion = { ...version, id: 'version-cover', coverAssetId: 'image-cover-1' };
        state.versions.set(coverVersion.id, coverVersion);
        await assert.rejects(service.prepare(coverVersion.id, 'session-cover'), /更新发布插件/);
        assert.equal(state.jobs.size, 0);
        state.coverSupported = true;
        state.statusFailure = true;
        assert.equal((await service.getStatus()).instances[0].imageCoverSupported, true);
        state.statusFailure = false;
        const job = await service.prepare(coverVersion.id, 'session-cover');
        assert.equal(job.imageCover.sourceSha256, state.coverDigest);
        assert.equal(state.browserCalls.some(call => call.endsWith(':prepare')), false);
        const staged = await Promise.all([service.stageDraft(job.id), service.stageDraft(job.id)]);
        assert.equal(staged[0].status, 'awaiting_confirmation');
        assert.equal(state.browserCalls.filter(call => call.endsWith(':prepare')).length, 1);
        assert.equal(state.requests[0].imageCover.sourceSha256, state.coverDigest);
        assert.equal(state.browserCalls.some(call => call.endsWith(':submit')), false);
        state.coverSupported = false;
        await assert.rejects(service.confirm(job.id), /插件已变化/);
        state.coverSupported = true;
        state.coverDigest = 'd'.repeat(64);
        await assert.rejects(service.confirm(job.id), /更新/);
        assert.equal(service.getJob(job.id).status, 'superseded');
        const replacement = await service.prepare(coverVersion.id, 'session-cover');
        state.prepareFailure = true;
        const failedStage = await service.stageDraft(replacement.id);
        assert.equal(failedStage.status, 'blocked');
        assert.equal(failedStage.errorCode, 'UPLOAD_FAILED');
        state.prepareFailure = false;
        const recoveredStage = await service.stageDraft(replacement.id);
        assert.equal(recoveredStage.status, 'awaiting_confirmation');
        assert.equal(recoveredStage.errorCode, '');
        assert.equal(recoveredStage.errorMessage, '');
        assert.equal(recoveredStage.confirmedAt, undefined);
        assert.equal(recoveredStage.submittedAt, undefined);
        service.cancel(replacement.id);
        assert.equal(state.browserCalls.some(call => call.endsWith(':submit')), false);
    });
    const prepared = await service.prepare(version.id, 'session-1');
    assert.equal(prepared.status, 'awaiting_confirmation');
    assert.equal((await service.prepare(version.id, 'session-1')).id, prepared.id);
    assert.equal(state.browserCalls.filter((call) => call.endsWith(':submit')).length, 0);
    state.accountId = 'other-account';
    await assert.rejects(service.confirm(prepared.id), /账号/);
    assert.equal(state.browserCalls.filter((call) => call.endsWith(':submit')).length, 0);
    state.accountId = 'account-1';
    await service.confirm(prepared.id);
    await assert.rejects(service.confirm(prepared.id), /失效/);
    for (let index = 0; index < 30 && ['queued', 'preflighting', 'submitting'].includes(service.getJob(prepared.id)?.status || ''); index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    const completed = service.getJob(prepared.id);
    assert.equal(completed?.status, 'submitted_pending_review');
    assert.equal(completed?.publishStatus, 'pending_review');
    assert.equal(state.browserCalls.filter((call) => call.endsWith(':submit')).length, 1);
    new module.exports.DouyinPublisherService();
    assert.equal(service.getJob(prepared.id)?.status, 'submitted_pending_review');
    await assert.rejects(service.prepare(version.id, 'session-1'), /核实/);
    const second = { ...version, id: 'version-2', revision: 2 };
    state.versions.set(second.id, second);
    state.submitStatus = 'unknown';
    const uncertain = await service.prepare(second.id, 'session-2');
    await service.confirm(uncertain.id);
    for (let index = 0; index < 30 && ['queued', 'preflighting', 'submitting'].includes(service.getJob(uncertain.id)?.status || ''); index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(service.getJob(uncertain.id)?.status, 'submit_result_unknown');
    new module.exports.DouyinPublisherService();
    await assert.rejects(service.prepare(second.id, 'session-2'), /核实/);
    await assert.rejects(service.reviewPublished(uncertain.id, false), /核实/);
    state.pageState = 'unsupported';
    const reviewed = await service.reviewPublished(uncertain.id, true);
    assert.equal(reviewed.status, 'published_reset_failed');
    assert.equal(reviewed.publishStatus, 'published');
    assert.equal(reviewed.publishedReview?.kind, 'user-verified-published');
    state.pageState = 'ready';
    state.ownedJobId = uncertain.id;
    const restored = await service.reviewPublished(uncertain.id, true);
    assert.equal(restored.status, 'completed');
    assert.equal(restored.resetStatus, 'ready');
    assert.equal(state.ownedJobId, '');
    assert.equal(state.reviews[0].jobId, uncertain.id);
    assert.equal(state.browserCalls.filter((call) => call.endsWith(':submit')).length, 2);
    await t.test('durable published review reconciles a legacy plugin owner before the next upload', async () => {
        const nextVersion = { ...version, id: 'version-after-reviewed' };
        state.versions.set(nextVersion.id, nextVersion);
        state.ownedJobId = restored.id;
        const next = await service.prepare(nextVersion.id, 'session-next');
        assert.equal(state.ownedJobId, '');
        assert.equal(state.reviews.at(-1).contentDigest, restored.contentDigest);
        assert.equal(state.reviews.at(-1).acknowledgedPublished, true);
        assert.equal(service.getJob(restored.id).publishStatus, 'published');
        const uncertainOwner = { ...restored, id: 'job-unverified-owner', status: 'submit_result_unknown',
            publishStatus: 'unknown', publishedReview: undefined };
        state.jobs.set(uncertainOwner.id, uncertainOwner);
        const reviewCount = state.reviews.length;
        state.ownedJobId = uncertainOwner.id;
        await assert.rejects(service.stageDraft(next.id), /尚未核实/);
        assert.equal(state.reviews.length, reviewCount);
        const foreignOwner = { ...restored, id: 'job-other-space-owner', spaceId: 'other' };
        state.jobs.set(foreignOwner.id, foreignOwner);
        state.ownedJobId = foreignOwner.id;
        await assert.rejects(service.stageDraft(next.id), /当前空间/);
        assert.equal(state.reviews.length, reviewCount);
        state.ownedJobId = restored.id;
        state.reviewFailure = true;
        await assert.rejects(service.stageDraft(next.id), /归属无法核验/);
        assert.equal(state.ownedJobId, restored.id);
        state.reviewFailure = false;
        assert.equal((await service.stageDraft(next.id)).status, 'awaiting_confirmation');
        assert.equal(state.ownedJobId, '');
        assert.equal(state.browserCalls.filter((call) => call.endsWith(':submit')).length, 2);
    });
    await assert.rejects(service.reviewPublished(uncertain.id, true), /核实/);
    const completedWithoutReview = { ...restored, id: 'job-completed-without-review', publishedReview: undefined };
    state.jobs.set(completedWithoutReview.id, completedWithoutReview);
    assert.equal((await service.reviewPublished(completedWithoutReview.id, true)).publishedReview?.kind, 'user-verified-published');
    assert.equal(state.browserCalls.filter((call) => call.endsWith(':submit')).length, 2);
    const loginVersion = { ...version, id: 'version-login' };
    state.versions.set(loginVersion.id, loginVersion);
    state.pageState = 'login_required';
    await assert.rejects(service.prepare(loginVersion.id, 'session-login'), /未就绪/);
    state.pageState = 'ready';
    state.disconnected = true;
    await assert.rejects(service.prepare(loginVersion.id, 'session-login'), /未就绪/);
    state.disconnected = false;
    state.prepareFailure = true;
    const uploadFailure = await service.prepare(loginVersion.id, 'session-login');
    await service.confirm(uploadFailure.id);
    for (let index = 0; index < 30 && ['queued', 'preflighting'].includes(service.getJob(uploadFailure.id)?.status || ''); index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(service.getJob(uploadFailure.id)?.status, 'blocked');
    assert.equal(service.getJob(uploadFailure.id)?.errorCode, 'UPLOAD_FAILED');
    assert.equal(state.browserCalls.filter((call) => call.endsWith(':submit')).length, 2);
    state.prepareFailure = false;
    const publishedVersion = { ...version, id: 'version-published' };
    state.versions.set(publishedVersion.id, publishedVersion);
    state.submitStatus = 'published';
    const publishSuccess = await service.prepare(publishedVersion.id, 'session-published');
    await service.confirm(publishSuccess.id);
    for (let index = 0; index < 30 && ['queued', 'preflighting', 'submitting'].includes(service.getJob(publishSuccess.id)?.status || ''); index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(service.getJob(publishSuccess.id)?.status, 'completed');
    assert.equal(service.getJob(publishSuccess.id)?.resetStatus, 'ready');
    const third = { ...version, id: 'version-3', revision: 3 };
    state.versions.set(third.id, third);
    state.project.renderOutputs[0].mediaAssetId = 'stale-media';
    await assert.rejects(service.prepare(third.id, 'session-3'), /stale export/);
    state.spaceId = 'other';
    assert.equal(service.getJob(prepared.id), null);
    await assert.rejects(service.prepare(version.id, 'session-other'), /当前空间/);
});
