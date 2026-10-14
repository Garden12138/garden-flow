import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import type { ToolResult } from '../electron/core/toolRegistry.ts';
import type { XhsPublishJob } from '../shared/xhsPublisher.ts';
import type { XhsNoteProjectSnapshot } from '../shared/xhsNote.ts';
import type { VideoEditorV2Project } from '../shared/videoAutoEdit.ts';
import type { IntentRoute, RuntimeContext } from '../electron/core/ai/types.ts';

test('publisher database migration preserves legacy jobs and persists explicit origin across reopen', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-publish-db-'));
    const file = path.join(root, 'fixture.db');
    let db = new DatabaseSync(file);
    try {
        const source = await fs.readFile(new URL('../electron/db.ts', import.meta.url), 'utf8');
        const schema = source.match(/CREATE TABLE IF NOT EXISTS xhs_publish_jobs \([\s\S]*?\n    \);/)![0];
        db.exec(schema.replace("      trigger_origin TEXT NOT NULL DEFAULT 'artifact-ready',\n", '').replace('      unpublished_review_json TEXT,\n', ''));
        const sql = source.slice(source.indexOf('export const upsertXhsPublishJob')).match(/db.prepare\(`([\s\S]*?)`\)/)![1];
        const migration = source.match(/ALTER TABLE xhs_publish_jobs ADD COLUMN trigger_origin[^"\n]+/)![0];
        const values = { id: 'job1', session_id: 's1', project_path: '/fixture/note.redvideo', trigger_origin: 'artifact-ready', revision: 1, content_digest: 'digest', note_type: 'video', title: '标题', body: '正文', hashtags_json: '[]', media_json: '[]', extension_instance_id: '', status: 'awaiting_confirmation', publish_status: 'not_submitted', reset_status: 'not_started', message_id: 'm1', error_code: '', error_message: '', created_at: 1, updated_at: 1, confirmed_at: null, submitted_at: null, published_at: null, completed_at: null };
        const { trigger_origin: _origin, ...legacyValues } = values;
        const legacySql = sql.replaceAll('project_path, trigger_origin, revision', 'project_path, revision')
            .replaceAll('@project_path, @trigger_origin, @revision', '@project_path, @revision')
            .replace('      trigger_origin = excluded.trigger_origin,\n', '')
            .replaceAll(', unpublished_review_json', '').replaceAll(', @unpublished_review_json', '')
            .replace('      unpublished_review_json = excluded.unpublished_review_json,\n', '');
        db.prepare(legacySql).run(legacyValues);
        db.exec(migration);
        db.exec(source.match(/ALTER TABLE xhs_publish_jobs ADD COLUMN unpublished_review_json[^'\n]+/)![0]);
        assert.equal(db.prepare('SELECT trigger_origin FROM xhs_publish_jobs WHERE id=?').get('job1')?.trigger_origin, 'artifact-ready');
        const review = { kind: 'user-verified-not-published', sessionId: 's1', reviewedAt: 1000 };
        assert.equal(db.prepare('SELECT unpublished_review_json FROM xhs_publish_jobs WHERE id=?').get('job1')?.unpublished_review_json, null);
        db.prepare(sql).run({ ...values, trigger_origin: 'explicit-request', unpublished_review_json: JSON.stringify(review) });
        db.close();
        db = new DatabaseSync(file);
        assert.equal(db.prepare('SELECT trigger_origin FROM xhs_publish_jobs WHERE id=?').get('job1')?.trigger_origin, 'explicit-request');
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM xhs_publish_jobs').get()?.count, 1);
        assert.deepEqual(JSON.parse(String(db.prepare('SELECT unpublished_review_json FROM xhs_publish_jobs WHERE id=?').get('job1')?.unpublished_review_json)), review);
        const mapper = await build({ stdin: { contents: source.slice(source.indexOf('function parseXhsJsonArray'), source.indexOf('export const upsertXhsPublishJob')) + '\nexport { xhsPublishJobFromRow };', loader: 'ts' }, write: false, platform: 'node', format: 'cjs' });
        const mapperModule = { exports: {} };
        vm.runInNewContext(mapper.outputFiles[0].text, { module: mapperModule, exports: mapperModule.exports });
        const fromRow = (mapperModule.exports as { xhsPublishJobFromRow: (row: unknown) => XhsPublishJob }).xhsPublishJobFromRow;
        const row = db.prepare('SELECT * FROM xhs_publish_jobs WHERE id=?').get('job1')!;
        assert.equal(fromRow(row).unpublishedReview?.reviewedAt, review.reviewedAt);
        assert.equal(fromRow({...row, unpublished_review_json: JSON.stringify({...review, sessionId:'foreign'})}).unpublishedReview, undefined);
        assert.equal(fromRow({...row, unpublished_review_json:'invalid'}).unpublishedReview, undefined);
        assert.equal(fromRow({...row, publish_status:'unknown'}).publishStatus, 'unknown');
    } finally {
        db.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

// Exercise real preparation tool, note/filesystem store, media binding and
// publisher state machine. Only Electron, DB and external browser are fakes.
test('real preparation and conversation recovery requires scoped authorization and is idempotent', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-publication-test-'));
    const state = {
        paths: { base: root, media: path.join(root, 'media'), manuscripts: path.join(root, 'manuscripts') },
        jobs: new Map<string, XhsPublishJob>(), messages: new Map<string, { content: string; metadata?: string }>(),
        calls: [] as string[], metadata: {}, projects: {} as Record<string, VideoEditorV2Project>,
        tasks: [] as Array<{ artifacts: Array<{ type: string; metadata: { projectId: string } }> }>,
        pluginOutcome: 'published',
        recoverOk: false,
        existingDraftOwner: '',
        classification: { intent: 'confirm', confidence: 1, publicationRequested: false, acknowledgedNotPublished: false },
        routerIntent: 'xhs_publishing', routerFault: '', routerCalls: 0,
        connectionFailure: '', pluginDispatch: null as null | ((method: string, args: Record<string, unknown>) => Promise<unknown>),
        prompts: { system: await fs.readFile(new URL('../electron/prompts/library/runtime/ai/route_intent_system.txt', import.meta.url), 'utf8'), user: await fs.readFile(new URL('../electron/prompts/library/runtime/ai/route_intent_user.txt', import.meta.url), 'utf8') },
    };
    const mockModules: Record<string, string> = {
        execution: `export const requirePublicationAction = async () => ({}); export const validatePublicationContext = async () => ({}); export const recordPublicationUpload = () => {};`,
        completion: `export const recordCompletedPublication = async () => {};`,
        source: `export const readPublicationSource = async () => ({media:[]});`,
        editor: `export const saveManualProductImageSet = () => { throw new Error('publisher cannot edit image sets'); }; export const resolveProductNoteEditor = async () => null; export const saveManualProductVideoNote = () => { throw new Error('publisher cannot edit product notes'); };`,
        db: `export const getPublicationJobContext = () => null;
            export const assertProductEditsSettled = () => {}; export const getProductEditorPublicationRevision = () => '';
            const s = globalThis.__publicationState;
            export const getWorkspacePaths = () => s.paths;
            export const getChatSession = () => ({ metadata: s.metadata });
            export const listAgentTasks = () => s.tasks;
            export const parseAgentTaskRecord = x => x;
            export const getXhsPublisherBinding = () => 'publisher-fixture';
            export const setXhsPublisherBinding = () => {};
            export const getXhsPublishJob = id => s.jobs.get(id) || null;
            export const upsertXhsPublishJob = j => s.jobs.set(j.id, structuredClone(j));
            export const listXhsPublishJobs = statuses => [...s.jobs.values()].filter(j => !statuses || statuses.includes(j.status));
            export const findXhsPublishJobByCandidate = (p,r,d) => [...s.jobs.values()].find(j => j.projectPath===p && j.revision===r && j.contentDigest===d) || null;
            export const addChatMessage = m => s.messages.set(m.id, m);
            export const updateChatMessage = (id,m) => s.messages.set(id, { ...s.messages.get(id), ...m });
        `,
        electron: 'export const BrowserWindow = { getAllWindows: () => [] };',
        projectStore: `export const getVideoEditorV2Project = async id => globalThis.__publicationState.projects[id] || null;`,
        runner: `export const getGardenFlowBackgroundRunner = () => ({ listBuiltinTasks: async () => { throw new Error('Explicit publication must not read automatic-runner settings'); } });`,
        builtin: `export const XHS_AUTO_PUBLISH_TASK_ID = 'xhs-auto-publish';`,
        prompts: `export const loadAndRenderPrompt = (p,v) => { const s=globalThis.__publicationState; const t=p.includes('system')?s.prompts.system:s.prompts.user; return t.replace(/\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}/g, (m,k) => String(v[k] ?? m)); };`,
        browser: `
            const s = globalThis.__publicationState;
            export const getBrowserCaptureBridgeService = () => ({
                getStatus: () => ({ instances: [{ extensionInstanceId:'publisher-fixture', extensionKind:'xhs-publisher', browser:'Chrome' }] }),
                waitForExtensionInstance: async options => {
                    if(options.signal?.aborted) throw Object.assign(new Error('当前执行已停止，未更新发布页或提交'),{code:'BROWSER_WAIT_CANCELLED'});
                    if(s.connectionFailure) throw Object.assign(new Error('绑定的发布插件尚未连接，待原发布浏览器恢复连接后再重发；未更新发布页或提交'),{code:s.connectionFailure});
                    return {extensionInstanceId:options.extensionInstanceId};
                },
                invokeBrowserControl: async (name, args) => {
                    s.calls.push(args.phase || name);
                    if(s.pluginDispatch) return s.pluginDispatch(name,args);
                    if (name === 'publisher.status') return {ownedJobId:s.existingDraftOwner};
                    if (args.phase === 'recover') {
                        if(s.recoverOk) s.existingDraftOwner='';
                        return {ok:s.recoverOk, discarded:s.recoverOk, jobId:args.jobId, message:'旧任务页面已被修改，不会覆盖'};
                    }
                    if (args.phase === 'amend') {
                        if(s.recoverOk) s.existingDraftOwner=args.request.jobId;
                        return {ok:s.recoverOk, prepared:s.recoverOk, jobId:args.request.jobId, message:'旧任务媒体无法核验，未覆盖'};
                    }
                    if (args.phase === 'prepare' && s.existingDraftOwner && s.existingDraftOwner !== args.request.jobId) return {ok:false, code:'EXISTING_DRAFT', jobId:args.request.jobId, publishStatus:'not_submitted', resetStatus:'not_started'};
                    if (args.phase === 'prepare') return { ok:true, prepared:true, jobId:args.request.jobId, publishStatus:'not_submitted', resetStatus:'not_started' };
                    return { ok:true, jobId:args.jobId, publishStatus:s.pluginOutcome, resetStatus:s.pluginOutcome==='published'?'ready':'not_started' };
                }
            });
        `,
    };
    try {
        const result = await build({
            stdin: { contents: `export { routeIntent } from './electron/core/ai/intentRouter'; export { XhsPublishPrepareTool } from './electron/core/tools/xhsPublishPrepareTool'; export { XhsPublisherService, getXhsPublisherService } from './electron/core/xhsPublisherService'; export { getXhsNoteProject } from './electron/core/xhsNoteProjectStore'; export { registerRenderedVideoAsset } from './electron/core/mediaLibraryStore'; export { videoRenderFingerprint } from './electron/core/video-editor-v2/videoPublicationPolicy';`, resolveDir: path.resolve(import.meta.dirname, '..') },
            bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
            plugins: [{ name: 'isolated-publication-adapters', setup(builder) {
            builder.onResolve({ filter: /publicationExecutionPolicy$/ }, () => ({path:'execution',namespace:'mock'}));
            builder.onResolve({ filter: /publicationCompletionService$/ }, () => ({path:'completion',namespace:'mock'}));
            builder.onResolve({ filter: /publicationSource$/ }, () => ({path:'source',namespace:'mock'}));
            builder.onResolve({ filter: /productProjectEditorService$/ }, () => ({path:'editor',namespace:'mock'}));
                builder.onResolve({ filter: /(?:^electron$|(?:^|\/)db$|videoEditorV2ProjectStore$|gardenflowBackgroundRunner$|builtinAutomationTasks$|browserCaptureBridgeService$|prompts\/runtime$)/ }, (args) => {
                    const module = args.path === 'electron' ? 'electron' : args.path.endsWith('/db') ? 'db'
                        : args.path.endsWith('videoEditorV2ProjectStore') ? 'projectStore'
                            : args.path.endsWith('gardenflowBackgroundRunner') ? 'runner'
                                : args.path.endsWith('builtinAutomationTasks') ? 'builtin' : args.path.endsWith('prompts/runtime') ? 'prompts' : 'browser';
                    return { path: module, namespace: 'mock' };
                });
                builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: mockModules[args.path], loader: 'js' }));
            } }],
        });
        const module = { exports: {} };
        const context = vm.createContext({ module, exports: module.exports, require: createRequire(import.meta.url), __publicationState: state,
            console, Buffer, process, URL, AbortController, setTimeout, clearTimeout, structuredClone,
            fetch: async (_url: string, input: { body: string }) => {
                state.routerCalls += 1;
                const body = JSON.parse(input.body);
                assert.match(body.messages[0].content, /sole semantic decision/);
                if (state.routerFault === 'response-format' && body.response_format) return new Response('response_format unsupported', { status: 400 });
                if (state.routerFault === 'network') throw new TypeError('fetch failed');
                const route = { primary_intent: state.routerIntent, recommended_role: 'copywriter', confidence: 1, goal: '当前版本', xhs_publish_action: state.classification };
                if (state.routerFault === 'missing-action') delete (route as { xhs_publish_action?: unknown }).xhs_publish_action;
                return new Response(JSON.stringify({ choices: [{ message: { content: state.routerFault === 'non-json' ? 'invalid' : JSON.stringify(route) } }] }), { status: 200 });
            },
        });
        vm.runInContext(result.outputFiles[0].text, context);
        const api = module.exports as {
            XhsPublishPrepareTool: new (getSessionId: () => string) => { execute: (input: unknown, signal: AbortSignal) => Promise<ToolResult> };
            getXhsPublisherService: () => {
                confirm: (id: string) => Promise<XhsPublishJob>;
                cancel: (id: string) => XhsPublishJob;
                retry: (id: string) => Promise<XhsPublishJob>;
                recoverUnpublished: (id: string, acknowledged: boolean) => Promise<XhsPublishJob>;
                getConversationContext: (sessionId: string, projectPath?: string) => Record<string, unknown> | undefined;
                handleRoutedConversationAction: (sessionId: string, route: IntentRoute, interactive: boolean, projectPath?: string, signal?: AbortSignal) => Promise<{ handled: boolean; response?: string; failed?: boolean; runtimeMetadata?: Record<string, unknown> }>;
            };
            XhsPublisherService: new () => ReturnType<typeof api.getXhsPublisherService>;
            routeIntent: (input: { context: RuntimeContext; llm?: { apiKey: string; baseURL: string; model: string }; signal?: AbortSignal }) => Promise<IntentRoute>;
            registerRenderedVideoAsset: (input: { projectId: string; renderId: string; sourcePath: string; title: string }) => Promise<{ id: string }>;
            videoRenderFingerprint: (project: VideoEditorV2Project) => string;
            getXhsNoteProject: (p: string) => Promise<XhsNoteProjectSnapshot>;
        };
        const project: VideoEditorV2Project = {
            version: 2, id: 'video_edit_v2_fixture', projectKind: 'product-video', title: '猫粮', projectDir: path.join(state.paths.media, 'video-editor-v2', 'video_edit_v2_fixture'),
            createdAt: '2026-09-24', updatedAt: '2026-09-24', status: 'exported',
            canvas: { width: 1080, height: 1920, fps: 30, aspectRatio: '9:16' }, assets: [], transcriptTracks: [], autoEditRuns: [], undoStack: [], renderOutputs: [],
            timeline: { durationMs: 27000, tracks: [{ id: 'v1', name: '画面', kind: 'primary-video', clips: [{ id: 'c1', trackId: 'v1', kind: 'video', text: '商品', timelineStartMs: 0, timelineEndMs: 27000, sourceStartMs: 0, sourceEndMs: 27000 }] }] },
        };
        state.projects[project.id] = project;
        state.tasks.push({ artifacts: [{ type: 'product-video-project', metadata: { projectId: project.id } }] });
        const exportedFile = path.join(root, 'fixture.mp4');
        await fs.writeFile(exportedFile, Buffer.from('isolated MP4 fixture'));
        const asset = await api.registerRenderedVideoAsset({ projectId: project.id, renderId: 'render1', sourcePath: exportedFile, title: '猫粮' });
        project.renderOutputs.push({ id: 'render1', path: exportedFile, mediaAssetId: asset.id, createdAt: new Date().toISOString(), renderFingerprint: api.videoRenderFingerprint(project) });
        const tool = new api.XhsPublishPrepareTool(() => 'session_1790235694798');
        const signal = new AbortController().signal;
        assert.equal((await tool.execute({ operation: 'inspect' }, signal)).success, true);
        assert.equal(state.jobs.size, 0);
        const invalid = await tool.execute({ operation: 'prepare', title: '原料透明的成猫粮｜伟嘉海洋鱼夹心10kg大袋装', body: '正文' }, signal);
        assert.equal(invalid.success, false);
        assert.equal((invalid.data as { kind: string }).kind, 'xhs-publish-validation-error');
        assert.equal(state.jobs.size, 0);
        assert.deepEqual(state.calls, []);
        const params = { operation: 'prepare', title: '海洋鱼味猫粮', body: '10kg规格', hashtags: ['猫粮'] };
        const receipt = await tool.execute(params, signal);
        assert.equal(receipt.success, true, receipt.llmContent);
        const first = [...state.jobs.values()][0];
        assert.equal(first.triggerOrigin, 'explicit-request');
        assert.equal(first.status, 'awaiting_confirmation');
        assert.equal(first.publishStatus, 'not_submitted');
        assert.deepEqual(state.calls, []);
        assert.equal((await api.getXhsNoteProject(first.projectPath)).document.mediaSlots.find(x => x.id === 'final-video')?.assetId, asset.id);
        const metadata = JSON.parse(state.messages.get(first.messageId)!.metadata!);
        assert.equal(metadata.xhsPublishConsent.body, params.body);
        assert.match(metadata.xhsPublishConsent.videoPreviewUrl, /^gardenflow-asset:/);
        let service = api.getXhsPublisherService();
        const llm = { apiKey: 'fixture', baseURL: 'https://example.invalid', model: 'fixture' };
        // Run the actual Pi entry method, not a test reimplementation of its
        // route/action sequence. Only unrelated onboarding/history/model setup
        // and task persistence are stubs; router and publisher remain real.
        const piSource = await fs.readFile(new URL('../electron/pi/PiChatService.ts', import.meta.url), 'utf8');
        const entryMethod = piSource.slice(piSource.indexOf('  private async prepareRuntimeExecutionInput('), piSource.indexOf('  private emitLocalAssistantResponse('))
            .replace('private async prepareRuntimeExecutionInput', 'async execute');
        const entryBuild = await build({ stdin: { loader: 'ts', contents: `
            export class PiEntry {
                workspacePathsOverride = null;
                skillManager = { preactivateMentionedSkills: async () => [] };
                abortController = null;
                getSessionMetadata() { return __getFixtureMetadata(); }
                resolveRuntimeMode() { return 'gardenflow'; }
                emitDebugLog() {}
                ensureSkillsDiscovered() {}
                shouldHandleGardenFlowOnboarding() { return false; }
                createModelWithBaseUrl() { return {}; }
                getGardenFlowCompactTargetTokens() { return 0; }
                async maybeCompactContext(p) { return p.metadata; }
                getModelContextWindow() { return 100000; }
                async loadLongTermMemoryContext() { return ''; }
                async loadGardenFlowProjectContext() { return ''; }
                buildSystemPrompt() { return 'Fixture'; }
                historyToRuntimeMessages() { return []; }
                ${entryMethod}
            }
        ` }, write: false, platform: 'node', format: 'cjs' });
        const receipts: Array<{ status: string; payload?: unknown }> = [];
        const entryModule = { exports: {} };
        const entryContext = {
            module: entryModule, exports: entryModule.exports, console, process,
            __getFixtureMetadata: () => ({ contextType:'gardenflow',activeXhsNotePath:first.projectPath }),
            getSettings: () => ({}), getWorkspacePaths: () => state.paths,
            resolveModelScopeFromContextType: () => 'gardenflow',
            normalizeApiBaseUrl: (url: string) => url, Instance: { init: () => {} },
            loadGardenFlowProfilePromptBundle: async () => null,
            getXhsPublisherService: () => service,
            getAgentRuntime: () => ({
                prepareExecution: async (input: { runtimeContext: RuntimeContext; baseSystemPrompt: string; llm: typeof llm; signal?: AbortSignal }) => {
                    assert.equal(JSON.stringify(input.llm), JSON.stringify(llm));
                    assert.equal(input.signal, pi.abortController?.signal);
                    const route = await api.routeIntent({ context:input.runtimeContext,llm:input.llm,signal:input.signal });
                    return {route,task:{id:'fixture-task',metadata:input.runtimeContext.metadata},systemPrompt:'Fixture',role:{roleId:'copywriter'},thinkingBudget:'low'};
                },
                failExecution: (_id: string, error: string) => receipts.push({status:'failed',payload:error}),
                completeExecution: () => receipts.push({status:'completed'}),
            }),
            getTaskGraphRuntime: () => ({
                addTrace: () => {}, mergeMetadata: () => {},
                addArtifact: (_id: string, artifact: unknown) => receipts.push({status:'artifact',payload:artifact}),
            }),
        };
        vm.runInNewContext(entryBuild.outputFiles[0].text, entryContext);
        const pi = new (entryModule.exports as {PiEntry:new () => {abortController:{signal:AbortSignal}|null;execute:(input:unknown)=>Promise<{kind:string;localResponse?:string;preparedExecution?:{route:IntentRoute}}>}}).PiEntry();
        const reply = async (content: string, interactive = true, signal?: AbortSignal) => {
            const receiptStart = receipts.length;
            pi.abortController = signal ? {signal} : null;
            const outcome = await pi.execute({content,sessionId:first.sessionId,allowInteractiveOnboarding:interactive,emitSkillActivation:false,modelOverride:{apiKey:llm.apiKey,baseURL:llm.baseURL,modelName:llm.model}});
            const failed = receipts.slice(receiptStart).some(receipt => receipt.status === 'failed');
            if (outcome.kind === 'handled' && !failed) assert.ok(receipts.slice(receiptStart).some(receipt => receipt.status === 'completed'));
            return {handled:outcome.kind==='handled',failed,response:outcome.localResponse,
                runtimeMetadata:outcome.preparedExecution?.route.workflowKind==='xhs-publish'?{workflowKind:'xhs-publish'}:undefined};
        };
        await reply('确认');
        assert.deepEqual(state.calls, []);
        service.cancel(first.id);
        assert.deepEqual(state.calls, []);
        assert.equal((await tool.execute(params, signal)).success, true);
        assert.equal(state.jobs.size, 1);
        // Editing a timeline invalidates the already displayed confirmation.
        project.timeline.tracks[0].clips[0].text = '修改后的画面';
        await assert.rejects(() => service.confirm(first.id), /重新导出/);
        assert.deepEqual(state.calls, []);
        project.timeline.tracks[0].clips[0].text = '商品';
        for (const intent of ['confirm', 'resume', 'recover']) {
            state.classification = { intent, confidence: 1, publicationRequested: true, acknowledgedNotPublished: true };
            const callsBefore = state.routerCalls;
            const response = await reply('发布当前版本');
            assert.match(response.response!, /准备发布面板.*分别点击/);
            assert.equal(state.routerCalls - callsBefore, 1, 'the sole semantic route does not grant button authority');
            assert.deepEqual(state.calls, []);
            assert.equal(state.jobs.get(first.id)?.publishStatus, 'not_submitted');
        }
        // Local copy preparation must not amend an owned browser draft.
        state.existingDraftOwner = first.id;
        const edited = await tool.execute({ ...params, title: '商品细节' }, signal);
        assert.equal(edited.success, true);
        assert.deepEqual(state.calls, []);
        for (const [fault, message] of [['missing-action', /未能可靠识别/], ['non-json', /未返回有效/], ['network', /连接失败/]] as const) {
            state.routerFault = fault;
            const failed = await reply('发布当前版本');
            assert.equal(failed.handled, true); assert.equal(failed.failed, true); assert.match(failed.response!, message);
            assert.deepEqual(state.calls, []);
        }
        state.routerFault = '';
        state.classification = { intent: 'prepare', confidence: 1, publicationRequested: false, acknowledgedNotPublished: false };
        assert.equal(await service.considerCompletedArtifact(first.sessionId, first.projectPath), null);
        assert.deepEqual(state.calls, []);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
