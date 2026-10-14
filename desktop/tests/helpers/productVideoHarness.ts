import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import type { ProductVideoProposal, VideoEditorV2Project } from '../../shared/videoAutoEdit.ts';

// Real approval SQL, project/catalog/media stores and job registry; only host, router,
// image/video providers and the TTS HTTP boundary are isolated from user data.
export async function productVideoHarness(options: { platformVersions?: boolean; productImageSets?: boolean; publication?: boolean } = {}) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-video-closeout-')));
    const source = await fs.readFile(new URL('../../electron/db.ts', import.meta.url), 'utf8');
    let sql = new DatabaseSync(path.join(root, 'approvals.db'));
    sql.exec('PRAGMA foreign_keys=OFF');
    sql.exec(source.match(/CREATE TABLE IF NOT EXISTS pending_tool_approvals \([\s\S]*?\n    \);/)![0]);
    for (const table of ['publication_job_contexts', 'publication_completions', 'product_project_edits', 'product_project_drafts', 'xhs_publish_jobs', 'douyin_video_versions', 'douyin_publish_jobs', 'douyin_publisher_config', 'tiktok_video_versions', 'tiktok_publish_jobs', 'tiktok_publisher_config']) {
        const schema = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\);`))?.[0];
        if (!schema) throw new Error(`Missing platform version schema: ${table}`);
        sql.exec(schema);
    }
    sql.exec("INSERT OR IGNORE INTO douyin_publisher_config VALUES (1, 'fixture-browser', 0); INSERT OR IGNORE INTO tiktok_publisher_config VALUES (1, 'fixture-browser', 0);");
    const state = {
        root, spaceId: 'default', xhsBinding: 'fixture-browser', publisherCalls: [] as any[], connected: true, accountId: 'fixture_account', publisherState: 'ready', submitStatus: 'published', publisherHook: null as null | ((method: string, params: any) => Promise<any>), settings: {} as Record<string, unknown>,
        messages: [] as Array<Record<string, any>>, tasks: new Map<string, any>(), sessions: new Map<string, any>(), videoCalls: 0, ttsCalls: 0,
        imageCalls: 0, renderCalls: 0, renderBytes: Buffer.alloc(0), imageHook: null as null | ((input: any) => Promise<any>), renderHook: null as null | ((html: string) => Promise<void>),
        transactionHook: null as null | (() => void), audio: Buffer.alloc(0), failSpeech: false, localizationCalls: 0, localizationResponse: {} as any,
    };
    const db = {
        prepare: (query: string) => sql.prepare(query),
        transaction: (fn: (...args: any[]) => any) => (...args: any[]) => {
            state.transactionHook?.();
            sql.exec('BEGIN');
            try { const result = fn(...args); sql.exec('COMMIT'); return result; }
            catch (error) { sql.exec('ROLLBACK'); throw error; }
        },
    };
    const approvalTypes = source.slice(source.indexOf('export type PendingToolApprovalStatus'), source.indexOf('export type AgentTaskStatus'));
    const approvalFunctions = source.slice(source.indexOf('const parsePendingToolApproval'), source.indexOf('/**\n * 获取会话的所有消息', source.indexOf('const parsePendingToolApproval')));
    const platformFunctions = source.slice(source.indexOf('type DouyinVersionRow ='), source.indexOf('export const findXhsPublishJobByCandidate')) + '\n' + source.slice(source.indexOf('type TikTokDocumentRow ='));
    const xhsFunctions = source.slice(source.indexOf('type XhsPublishJobRow ='), source.indexOf('type DouyinVersionRow =')) + source.slice(source.indexOf('export const listXhsPublishJobs ='), source.indexOf('export const getXhsPublisherBinding ='));
    const mocks: Record<string, string> = {
        db: `import { AsyncLocalStorage } from 'node:async_hooks';
            const workspaceContext = new AsyncLocalStorage();
            export const runInWorkspaceSpace = (spaceId, operation) => workspaceContext.run(spaceId, operation);
            const state = globalThis.__fixture; const db = globalThis.__fixtureDb;
            export const updateChatSessionMetadata = (id, metadata) => state.sessions.set(id, { ...state.sessions.get(id), id, metadata: JSON.stringify(metadata) });
            export const getChatSession = id => state.sessions.get(id) || (id.startsWith('product_editor_') ? null : { id, metadata: '{}' });
            export const createChatSession = (id, title, metadata) => { const value = {id, title, metadata: JSON.stringify(metadata)}; state.sessions.set(id, value); return value; };
            export const getChatSessionByFile = file => [...state.sessions.values()].find(value => { const meta = JSON.parse(value.metadata || '{}'); return meta.associatedFilePath === file; }) || null;
            export const getChatSessionByContext = (contextId, contextType) => [...state.sessions.values()].find(value => { const meta = JSON.parse(value.metadata || '{}'); return meta.contextId === contextId && meta.contextType === contextType; }) || null;

            export const getSettings = () => state.settings;
            export const getWorkspacePathsForSpace = (spaceId) => { const base = state.root + '/' + spaceId; return { base, gardenflow: base + '/gardenflow', media: base + '/media', subjects: base + '/subjects', manuscripts: base + '/manuscripts', activeSpaceId: spaceId }; };
            export const getWorkspacePaths = () => getWorkspacePathsForSpace(workspaceContext.getStore() || state.spaceId);
            export const getActiveSpaceId = () => workspaceContext.getStore() || state.spaceId;
            export const getXhsPublisherBinding = () => state.xhsBinding; export const setXhsPublisherBinding = id => {state.xhsBinding=id;};
            export const updateChatMessage = (id, patch) => { const message = state.messages.find(item => item.id === id); if (message) Object.assign(message, patch); };
            export const findXhsPublishJobByCandidate = (file, revision, digest) => listXhsPublishJobs().find(item => item.revision === revision && item.projectPath === file && item.contentDigest === digest) || null;
            export const addChatMessage = (message) => state.messages.push(message);
            export const listAgentTasks = () => [...state.tasks.values()]; export const parseAgentTaskRecord = value => value;
            export const getChatMessages = (session) => state.messages.filter((message) => message.session_id === session);
            const safeJsonParse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
            ${approvalTypes}\n${approvalFunctions}\n${platformFunctions}\n${xhsFunctions}`,
        ai: `const state = globalThis.__fixture;
            const runtime = { getTask: id => state.tasks.get(id), cancelTask: id => { state.tasks.get(id).status = 'cancelled'; }, resumeTask: id => { state.tasks.get(id).status = 'running'; }, addArtifact: (id, artifact) => state.tasks.get(id).artifacts.push(artifact) };
            export const getTaskGraphRuntime = () => runtime;
            export const getAgentRuntime = () => ({ failExecution: (id) => {state.tasks.get(id).status = 'failed';}, completeExecution: (id) => {state.tasks.get(id).status = 'completed';} });`,
        video: `export class VideoGenerateTool { async execute() { globalThis.__fixture.videoCalls++; throw new Error('unexpected video generation'); } }`,
        imageProvider: `export const generateImagesToMediaLibrary = async (input) => { const state = globalThis.__fixture; state.imageCalls++; if (state.imageHook) return state.imageHook(input); throw new Error('unexpected image generation'); };
            export const resolveDefaultImageModel = () => 'fixture-image';
            export const resolveDefaultImageEndpoint = () => 'https://image.invalid/v1';`,
        imageRenderer: `export const getProductImageFontCss = async () => '';
            export const productImageDataUrl = async () => 'data:image/png;base64,' + globalThis.__fixture.renderBytes.toString('base64');
            export const renderProductImagePng = async (html) => { const state = globalThis.__fixture; state.renderCalls++; if(state.renderHook) await state.renderHook(html); return state.renderBytes; };`,
        videoProvider: `export const generateVideosToMediaLibrary = async () => { throw new Error('unexpected video generation'); };`,
        completion: `export const recordCompletedPublication = async () => {};`,
        runner: `export const getGardenFlowBackgroundRunner = () => ({ listBuiltinTasks: async () => [] });`,
        browser: `const state = globalThis.__fixture; export const getBrowserCaptureBridgeService = () => ({
            waitForExtensionInstance: async () => {if (!state.connected) throw new Error('disconnected'); return {};},
            getStatus: () => ({instances: state.connected ? [{extensionInstanceId: state.xhsBinding, browser: 'fixture chrome', extensionKind: 'xhs-publisher', capabilities: ['xiaohongshu.publish.v1','xiaohongshu.account-bound.v1','publisher.upload-review.v1','douyin.publish.v1','tiktok.publish.v1']}] : []}),
            invokeBrowserControl: async (method, params) => {state.publisherCalls.push({method,params});
                if (state.publisherHook) { const result = await state.publisherHook(method, params); if (result !== undefined) return result; }
                if (method === 'publisher.status') return {accountId:state.accountId,accountLabel:'@'+state.accountId,pageState:state.publisherState};
                const request = params.request;
                if (params.phase === 'prepare') return {ok:true,prepared:true,jobId:request.jobId,contentDigest:request.contentDigest,publishStatus:'not_submitted',uploadReview:{jobId:request.jobId,contentDigest:request.contentDigest,accountId:state.accountId,pageFingerprint:'fixture page',pageSettings:{visibilityLabel:'公开可见',original:false,allowCopy:true,scheduled:false},mediaCount: request.media?.length || 1}};
                if (params.phase === 'submit') return {ok:true,jobId:request.jobId,contentDigest:request.contentDigest,publishStatus:state.submitStatus,resetStatus:'ready'};
                return {ok:true,jobId:params.jobId,contentDigest:params.contentDigest,publishStatus:'not_submitted',resetStatus:'ready'};
            }
        });`,
        electron: `export const BrowserWindow = {getAllWindows: () => []}; export const nativeImage = {createFromBuffer: bytes => ({ isEmpty: () => bytes.length < 40 })}; export const app = { isPackaged: false, getAppPath: () => ${JSON.stringify(path.resolve(import.meta.dirname, '../..'))} };`,
    };
    const exports = `export * from './electron/core/productProjectEditorService';
        export * from './electron/core/tools/productProjectEditorTools';
        export * from './electron/core/productWorkVersionService';
        export * from './electron/core/productVideoApprovalService';
        export * from './electron/core/tools/productVideoComposeTool';
        export * from './electron/core/brandWorkspaceStore';
        export * from './electron/core/video-editor-v2/videoEditorV2ProjectStore';
        export * from './electron/core/video-editor-v2/productVideoVoiceoverService';
        export * from './electron/core/video-editor-v2/renderExportService';
        export * from './electron/core/video-editor-v2/productVideoExportCache';
        export * from './electron/core/mediaGenerationJobRegistry';
        export * from './electron/db';
        ${options.publication ? `export * from './electron/core/unifiedPublisherService';
        export * from './electron/core/publicationSource'; export * from './electron/core/publicationAuthorization';
        export * from './electron/core/publicationCompletionService';
        export * from './electron/core/video-editor-v2/videoPublicationPolicy';
        export * from './electron/core/xhsPublisherService'; export * from './electron/core/douyinPublisherService'; export * from './electron/core/tiktokPublisherService';` : ''}
        ${options.productImageSets ? `export * from './electron/core/productImageSetApprovalService';
        export * from './electron/core/productImageSetService';
        export * from './electron/core/productVideoRemixSources';
        export * from './electron/core/tools/productImageSetComposeTool';
        export * from './electron/core/xhsNoteProjectStore';
        export * from './electron/core/mediaLibraryStore';
        export * from './electron/core/runtimePermissions';` : ''}
        ${options.platformVersions ? `export * from './electron/core/douyinVideoVersionService';
        export * from './electron/core/tiktokVideoVersionService';
        export * from './electron/core/tiktokLocalization';
        export * from './electron/core/xhsNoteProjectStore';` : ''}`;
    const bundled = await build({ stdin: { contents: exports, resolveDir: path.resolve(import.meta.dirname, '../..') }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', define: { 'import.meta.url': JSON.stringify(new URL('../../package.json', import.meta.url).href) },
        plugins: [{ name: 'isolated-video-host', setup(builder) {
            builder.onResolve({ filter: /(?:^electron$|(?:^|\/)db(?:\.ts)?$|(?:^|\/)ai$|mediaGenerationTools$|imageGenerationService$|videoGenerationService$|productImageRenderer$|publicationCompletionService$|gardenflowBackgroundRunner$|browserCaptureBridgeService$)/ }, (args) => {
                if (args.path.endsWith('publicationCompletionService') && options.publication) return undefined;
                const key = args.path.endsWith('publicationCompletionService') ? 'completion' : args.path.endsWith('gardenflowBackgroundRunner') ? 'runner' : args.path.endsWith('browserCaptureBridgeService') ? 'browser' : args.path === 'electron' ? 'electron' : /\/db(?:\.ts)?$/.test(args.path) ? 'db' : args.path.endsWith('/ai') ? 'ai'
                    : args.path.endsWith('mediaGenerationTools') ? 'video' : args.path.endsWith('imageGenerationService') ? 'imageProvider' : args.path.endsWith('productImageRenderer') ? 'imageRenderer' : 'videoProvider';
                return { path: key, namespace: 'fixture' };
            });
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: key }) => ({ contents: mocks[key], loader: 'ts' }));
        } }],
    });
    const loadRuntime = () => {
    const module = { exports: {} as any };
    const fixtureProcess = Object.create(process);
    fixtureProcess.resourcesPath = path.resolve(import.meta.dirname, '../..');
    vm.runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, __fixture: state, __fixtureDb: db,
        // Required dependencies run in the host realm, matching the app's Error
        // constructor so renderer exceptions exercise the normal recovery path.
        require: createRequire(new URL('../../package.json', import.meta.url)), process: fixtureProcess, console, Buffer, URL, Error, AbortController, AbortSignal,
        setTimeout, clearTimeout, setInterval, clearInterval, structuredClone, __dirname: root,
        fetch: async (url: string) => {
            if (url === 'https://text.invalid/v1/chat/completions') {
                state.localizationCalls++;
                return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(state.localizationResponse) } }] }), { headers: { 'content-type': 'application/json' } });
            }
            if (url !== 'https://tts.invalid/v1/audio/speech') throw new Error(`Unexpected network request`);
            state.ttsCalls++;
            return state.failSpeech ? new Response('fixture speech failure', { status: 400 }) : new Response(state.audio, { headers: { 'content-type': 'audio/wav' } });
        },
    });
    return module.exports;
    };
    let api = loadRuntime();
    let store = api.createBrandWorkspaceStore(() => path.join(root, state.spaceId, 'subjects/brand-workspace'));
    let unsubscribe = api.onProductChanged(options.productImageSets ? api.invalidateProductImageSetApprovals : api.invalidateProductVideoApprovals);
    return { root, state, get api() { return api; }, get store() { return store; }, get sql() { return sql; },
        restart() {
            unsubscribe(); sql.close(); sql = new DatabaseSync(path.join(root, 'approvals.db'));
            sql.exec('PRAGMA foreign_keys=OFF');
            api = loadRuntime(); unsubscribe = api.onProductChanged(options.productImageSets ? api.invalidateProductImageSetApprovals : api.invalidateProductVideoApprovals);
            store = api.createBrandWorkspaceStore(() => path.join(root, state.spaceId, 'subjects/brand-workspace'));
        },
        async close() { unsubscribe(); sql.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); },
        async approveFixture(proposal: ProductVideoProposal, callId = 'approval-1', sessionId = 'session-1') {
            const taskId = `task-${callId}`;
            state.tasks.set(taskId, { id: taskId, status: 'paused', route: { workflowKind: 'product-video-compose' }, artifacts: [], metadata: {
                creationTarget: proposal.creationTarget,
                explicitProductRefs: [{ productId: proposal.productId, name: proposal.productName, updatedAt: proposal.productUpdatedAt }],
                productAssetVisualGrounding: { status: 'verified', productId: proposal.productId, productUpdatedAt: proposal.productUpdatedAt, imageCount: 1, assets: [{ assetId: proposal.scenes[0].productAssetIds[0], visibleText: [], suitability: 'safe' }], aiMotion: { available: false } },
            } });
            return api.createOrReusePendingToolApproval({ callId, sessionId, taskId, toolName: 'product_video_compose', proposalId: proposal.proposalId, proposalDigest: JSON.stringify(proposal), params: proposal,
                details: { type: 'info', title: '分镜确认', description: '', spaceId: state.spaceId, replanRequest: { message: '给这个商品做一个视频' } } });
        },
    };
}

export function makeProposal(product: { id: string; name: string; updatedAt: string; assets: Array<{ id: string }> }, id = 'proposal-closeout-1'): ProductVideoProposal {
    return { version: 1, proposalId: id, productId: product.id, referencedProductIds: [product.id], productName: product.name, productUpdatedAt: product.updatedAt,
        title: '商品视频收尾验收', canvas: { width: 1080, height: 1920, fps: 30, aspectRatio: '9:16' }, durationMs: 15000,
        scenes: Array.from({ length: 5 }, (_, index) => ({ id: `scene-${index}`, title: `镜头 ${index + 1}`, durationMs: 3000, source: 'product-asset',
            productAssetIds: [product.assets[0].id], overlayText: `商品实拍 ${index + 1}`, fitMode: 'contain-blur', motionPreset: 'slow-zoom-in' })),
    };
}

export function sineWav(seconds: number, hz = 440): Buffer {
    const count = Math.round(seconds * 24000);
    const data = Buffer.alloc(44 + count * 2);
    data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(24000, 24); data.writeUInt32LE(48000, 28);
    data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(count * 2, 40);
    for (let i = 0; i < count; i++) data.writeInt16LE(Math.round(Math.sin(i * hz * Math.PI * 2 / 24000) * 8000), 44 + i * 2);
    return data;
}

export async function waitForVoiceovers(api: any, id: string): Promise<VideoEditorV2Project> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const project = await api.reconcileProductVideoVoiceoverProject(id) as VideoEditorV2Project;
        if (project.productVideo?.scenes.every((scene) => !['queued', 'generating', 'needs-configuration'].includes(scene.voiceoverStatus || ''))) return project;
        await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error('voiceovers did not settle');
}
