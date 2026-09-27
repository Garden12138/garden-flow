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
        db: `
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
        state.jobs.set(first.id, {...state.jobs.get(first.id)!, triggerOrigin:'artifact-ready'});
        state.classification.publicationRequested = true;
        assert.match((await reply('发布当前版本')).response!, /加入发布队列/);
        assert.equal(state.jobs.get(first.id)?.triggerOrigin,'explicit-request');
        state.classification.publicationRequested = false;
        for (let i = 0; i < 100 && state.jobs.get(first.id)?.status !== 'completed'; i += 1) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(state.jobs.get(first.id)?.status, 'completed');
        assert.deepEqual(state.calls, ['prepare', 'submit']);
        assert.equal((await tool.execute(params, signal)).success, true);
        assert.equal(state.jobs.size, 1);
        await assert.rejects(() => service.confirm(first.id), /不能确认/);
        assert.deepEqual(state.calls, ['prepare', 'submit']);
        // The ambiguous submission state must not authorize another click.
        const existing = state.jobs.get(first.id)!;
        state.jobs.set(first.id, { ...existing, status: 'submit_result_unknown', publishStatus: 'unknown' });
        await assert.rejects(() => service.retry(first.id), /不能安全重试/);
        await tool.execute(params, signal);
        assert.equal(state.jobs.size, 1);
        assert.deepEqual(state.calls, ['prepare', 'submit']);
        // A new title creates a new revision, but cannot bypass an old unknown submission.
        const edited = { ...params, title: '原料透明的成猫粮｜伟嘉海洋鱼夹心10kg' };
        assert.equal((await tool.execute(edited, signal)).success, true);
        const latest = [...state.jobs.values()].find(j => j.id !== first.id)!;
        await assert.rejects(() => service.confirm(latest.id), /旧版本.*尚未核实/);
        await assert.rejects(() => service.recoverUnpublished(first.id, false), /核实未发布/);
        assert.deepEqual(state.calls, ['prepare', 'submit']);
        await assert.rejects(() => service.recoverUnpublished(first.id, true), /未覆盖/);
        assert.equal(state.jobs.get(first.id)?.status, 'submit_result_unknown');
        assert.equal(state.jobs.get(first.id)?.unpublishedReview?.kind, 'user-verified-not-published');
        service = new api.XhsPublisherService();
        state.recoverOk = true;
        const recovered = await service.recoverUnpublished(first.id, true);
        assert.equal(recovered.id, latest.id);
        assert.equal(recovered.status, 'awaiting_confirmation');
        assert.equal(recovered.title, edited.title);
        assert.deepEqual(state.calls, ['prepare', 'submit', 'amend', 'amend']);
        assert.equal(state.jobs.get(first.id)?.publishStatus, 'unknown');
        assert.equal(state.jobs.get(first.id)?.errorCode, 'USER_VERIFIED_NOT_PUBLISHED');
        await assert.rejects(() => service.retry(first.id), /不能安全重试/);
        await service.confirm(latest.id);
        for (let i = 0; i < 100 && state.jobs.get(latest.id)?.status !== 'completed'; i += 1) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(state.jobs.get(latest.id)?.status, 'completed');
        assert.deepEqual(state.calls, ['prepare', 'submit', 'amend', 'amend', 'prepare', 'submit']);
        // A definitively rejected, owned older draft can be replaced only after
        // the user confirms the newer copy; recovery never adds a second submit.
        state.jobs.set(latest.id, { ...state.jobs.get(latest.id)!, status: 'blocked', publishStatus: 'not_submitted', errorCode: 'EDITOR_VALIDATION_FAILED' });
        state.existingDraftOwner = latest.id;
        await tool.execute({ ...edited, title: '伟嘉成猫粮原料一览' }, signal);
        const revised = [...state.jobs.values()].find(j => j.title === '伟嘉成猫粮原料一览')!;
        const callStart = state.calls.length;
        await service.confirm(revised.id);
        for (let i = 0; i < 100 && state.jobs.get(revised.id)?.status !== 'completed'; i += 1) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(state.jobs.get(revised.id)?.status, 'completed');
        assert.deepEqual(state.calls.slice(callStart), ['prepare', 'submit']);
        // Restart window: the explicit review was persisted but the fresh
        // revision/card was not yet created. Resume without reusing the cached ID.
        const previous = state.jobs.get(revised.id)!;
        state.jobs.set(previous.id, { ...previous, status: 'superseded', publishStatus: 'unknown', errorCode: 'USER_VERIFIED_NOT_PUBLISHED' });
        const beforeRestartResume = state.calls.length;
        assert.equal((await tool.execute({ ...edited, title: revised.title }, signal)).success, true);
        const resumed = [...state.jobs.values()].find(j => j.revision > revised.revision)!;
        assert.equal(resumed.status, 'awaiting_confirmation');
        assert.notEqual(resumed.id, revised.id);
        assert.deepEqual(state.calls.slice(beforeRestartResume), ['publisher.status', 'amend']);
        // Follow-up modification stays in the publication workflow even after
        // a blocked or unknown submission; unrelated turns do not inherit it.
        state.classification.intent = 'modify';
        const continuation = await reply('把标题改得更简短');
        assert.equal(continuation.handled, false);
        assert.equal(continuation.runtimeMetadata?.workflowKind, 'xhs-publish');
        state.classification.confidence = 0.4;
        const uncertain = await reply('继续');
        assert.equal(uncertain.handled, true);
        assert.equal(uncertain.failed, true);
        assert.equal(uncertain.runtimeMetadata?.workflowKind, undefined);
        state.classification.confidence = 1;
        state.classification.intent = 'unrelated';
        state.routerIntent = 'manuscript_creation';
        assert.equal((await reply('帮我写另一篇文章')).runtimeMetadata, undefined);
        state.routerIntent = 'xhs_publishing';
        // Unknown cannot be bypassed by an explicit re-publish request alone.
        state.jobs.set(resumed.id, { ...resumed, status: 'submit_result_unknown', publishStatus: 'unknown' });
        state.classification = { intent: 'confirm', confidence: 1, publicationRequested: true, acknowledgedNotPublished: false };
        const beforeDenied = state.calls.length;
        for (const status of ['queued', 'preflighting', 'uploading', 'submitting', 'returning'] as const) {
            state.jobs.set(resumed.id, { ...resumed, status, publishStatus: status === 'submitting' ? 'submitted' : 'not_submitted' });
            const active = await reply('点击发布');
            assert.match(active.response!, /正在执行/);
            assert.doesNotMatch(active.response!, /尚未核实|已核实未发布/);
            assert.equal(state.calls.length, beforeDenied);
            assert.equal(state.jobs.get(resumed.id)?.unpublishedReview, undefined);
            state.classification = { intent: 'recover', confidence: 1, publicationRequested: false, acknowledgedNotPublished: true };
            const activeReview = await reply('已核实未发布');
            assert.match(activeReview.response!, /正在执行/);
            assert.equal(state.calls.length, beforeDenied);
            assert.equal(state.jobs.get(resumed.id)?.unpublishedReview, undefined);
            state.classification = { intent: 'confirm', confidence: 1, publicationRequested: true, acknowledgedNotPublished: false };
        }
        state.jobs.set(resumed.id, { ...resumed, status: 'submit_result_unknown', publishStatus: 'unknown' });
        const denied = await reply('重新发布当前版本');
        assert.match(denied.response!, /尚未核实/);
        assert.match(denied.response!, /当前第 .*版这次/);
        assert.equal(state.calls.length, beforeDenied);
        // Router failure/missing action used to fall through to prepare and
        // falsely finish a re-publish request. None may mutate or submit now.
        for (const [fault, message] of [['missing-action', /未能可靠识别/], ['non-json', /未返回有效/], ['network', /连接失败/]] as const) {
            state.routerFault = fault;
            const count = state.jobs.size;
            const failed = await reply('重新发布当前版本');
            assert.equal(failed.handled, true);
            assert.equal(failed.failed, true);
            assert.match(failed.response!, message);
            assert.equal(state.calls.length, beforeDenied);
            assert.equal(state.jobs.size, count);
        }
        for (const [routingFailure, message] of [['timeout', /模型响应超时.*不是你的指令不明确/], ['http-error', /HTTP 429/], ['cancelled', /已停止/]] as const) {
            const routed = await api.routeIntent({context:{sessionId:first.sessionId,runtimeMode:'gardenflow',userInput:'重新发布当前版本',metadata:{xhsPublishContext:service.getConversationContext(first.sessionId)}}});
            const failure = await service.handleRoutedConversationAction(first.sessionId, {...routed,routingFailure,
                routingDiagnostic:{model:llm.model,endpointHost:'example.invalid',elapsedMs:90000,timeoutMs:90000,attempts:1,httpStatus:429}}, true);
            assert.equal(failure.handled, true);
            assert.equal(failure.failed, true);
            assert.match(failure.response!, message);
            assert.equal(state.calls.length, beforeDenied);
        }
        state.routerFault = 'response-format';
        const routeCallsBefore = state.routerCalls;
        assert.match((await reply('重新发布当前版本')).response!, /尚未核实/);
        assert.equal(state.routerCalls - routeCallsBefore, 2);
        state.routerFault = '';
        assert.match((await reply('重新发布当前版本', false)).response!, /后台任务不会提交/);
        const stopped = new AbortController();
        stopped.abort();
        assert.match((await reply('重新发布当前版本', true, stopped.signal)).response!, /执行已停止/);
        assert.equal(state.calls.length, beforeDenied);
        const unknownReceipt = await tool.execute({ ...edited, title: resumed.title }, signal);
        assert.match(unknownReceipt.llmContent, /不代表未发布/);
        // A user assertion resolves this receipt once, amends the page and does
        // not submit until the separate explicit publication request.
        state.classification = { intent: 'recover', confidence: 1, publicationRequested: false, acknowledgedNotPublished: true };
        state.recoverOk = false;
        const review = await reply('我检查了笔记管理，已核实未发布');
        assert.equal(review.handled, true);
        assert.equal(review.failed, true);
        assert.match(review.response!, /记录已保存/);
        assert.equal(state.jobs.get(resumed.id)?.status, 'submit_result_unknown');
        assert.equal(state.jobs.get(resumed.id)?.unpublishedReview?.sessionId, first.sessionId);
        const beforeStatus = state.calls.length;
        state.classification = {intent:'status',confidence:1,publicationRequested:false,acknowledgedNotPublished:false};
        const reviewedStatus = await reply('现在发布是什么状态');
        assert.match(reviewedStatus.response!, /记录已保存.*无需重复核实/);
        assert.equal(state.calls.length, beforeStatus);
        // Reload the actual service: review survives a failed page operation,
        // and explicit publish can resume without another manual assertion.
        service = new api.XhsPublisherService();
        state.recoverOk = true;
        const newJob = [...state.jobs.values()].sort((a,b) => b.revision-a.revision)[0];
        assert.equal(newJob.status, 'blocked');
        const beforePublish = state.calls.length;
        // Recovery continuation can use the saved assertion after restart;
        // it must not amend successfully and then ask the user to verify again.
        state.classification = {intent:'recover',confidence:1,publicationRequested:false,acknowledgedNotPublished:false};
        assert.match((await reply('继续恢复发布页')).response!, /尚未再次提交/);
        state.classification = { intent: 'confirm', confidence: 1, publicationRequested: true, acknowledgedNotPublished: false };
        const callsBeforeAuthorization = state.routerCalls;
        const authorized = await reply('重新发布当前版本');
        assert.equal(state.routerCalls - callsBeforeAuthorization, 1, 'Pi must consume one semantic route, not invoke a second reply classifier');
        assert.match(authorized.response!, /加入发布队列/);
        for (let i=0; i<100 && state.jobs.get(newJob.id)?.status !== 'completed'; i+=1) await new Promise(resolve => setTimeout(resolve,5));
        assert.equal(state.jobs.get(resumed.id)?.errorCode, 'USER_VERIFIED_NOT_PUBLISHED');
        assert.equal(state.jobs.get(resumed.id)?.publishStatus, 'unknown');
        assert.deepEqual(state.calls.slice(beforePublish), ['amend','prepare','submit']);
        assert.match((await reply('重新发布当前版本')).response!, /不会重复提交/);
        state.classification.acknowledgedNotPublished = true;
        assert.match((await reply('已核实未发布，重新发布当前版本')).response!, /不会重复提交/);
        assert.equal(state.jobs.get(newJob.id)?.publishStatus,'published');
        assert.deepEqual(state.calls.slice(beforePublish), ['amend','prepare','submit']);
        state.classification.acknowledgedNotPublished = false;
        // Cross-module regression: actual Pi route + service + actual plugin
        // amendment/prepare/submit lifecycle, not a canned prepare receipt.
        const prior = state.jobs.get(newJob.id)!;
        const unknown = { ...prior, revision: prior.revision - 1, title: '原料透明的成猫粮｜伟嘉海洋鱼夹心10kg大袋装', status: 'submit_result_unknown' as const,
            publishStatus: 'unknown' as const, errorCode: 'SUBMIT_RESULT_UNKNOWN',
            unpublishedReview: { kind:'user-verified-not-published' as const,sessionId:first.sessionId,reviewedAt:Date.now() } };
        state.jobs.set(prior.id, unknown);
        const { publicationFixture } = await import('../../PublishPlugin/tests/helpers/publicationFixture.mjs');
        const plugin = await publicationFixture({published:true,request:{...unknown,jobId:unknown.id,protocolVersion:1}});
        plugin.stored[plugin.ownerKey].status = 'submitting';
        delete plugin.stored[plugin.ownerKey].mediaSources; // historical long-title owner
        // Actual publishing page: a cover/file label (no playable <video> src)
        // and a platform topic chip whose name differs from the saved footer.
        plugin.state.mediaSources = [];
        plugin.state.mediaFileNames = [path.basename(unknown.media.find(item => item.role === 'video')!.path)];
        plugin.state.body = `${unknown.body}\n#原料透明猫粮[话题]#`;
        plugin.stored.gardenflowXhsPublisherResults = {[unknown.id]:{jobId:unknown.id,publishStatus:'unknown'}};
        state.pluginDispatch = async (_method,args) => plugin.api.publish(args);
        state.connectionFailure = 'BROWSER_INSTANCE_UNAVAILABLE';
        const shortCopy = {...edited,title:'原料透明的成猫粮｜伟嘉海洋鱼夹心10kg',body:unknown.body,hashtags:unknown.hashtags};
        assert.equal((await tool.execute(shortCopy,signal)).success,true);
        const pageJob = [...state.jobs.values()].sort((a,b) => b.revision-a.revision)[0];
        const disconnected = await reply('重新发布当前版本');
        assert.match(disconnected.response!, /发布插件尚未连接/);
        assert.doesNotMatch(disconnected.response!, /可以继续.*修改文案/);
        assert.equal(plugin.state.clicks,0);
        assert.equal(plugin.state.edits.length,0);
        assert.equal(state.jobs.get(pageJob.id)?.errorCode,'BROWSER_INSTANCE_UNAVAILABLE');
        assert.equal(state.jobs.get(unknown.id)?.unpublishedReview?.sessionId,first.sessionId);
        state.connectionFailure = '';
        plugin.state.mediaBusy = true;
        const busy = await reply('重新发布当前版本');
        assert.equal(busy.failed,true);
        assert.equal(state.jobs.get(pageJob.id)?.errorCode,'MEDIA_PROCESSING');
        assert.equal(plugin.state.clicks,0);
        plugin.state.mediaBusy = false;
        plugin.state.published = false;
        const restored = await reply('重新发布当前版本');
        assert.match(restored.response!,/加入发布队列/);
        for(let i=0;i<100&&state.jobs.get(pageJob.id)?.status!=='submit_result_unknown';i+=1) await new Promise(resolve=>setTimeout(resolve,5));
        assert.equal(state.jobs.get(pageJob.id)?.publishStatus,'unknown');
        assert.equal(plugin.state.beforeSubmit.title,shortCopy.title);
        assert.equal(plugin.state.beforeSubmit.body, plugin.state.body);
        assert.equal(plugin.state.beforeSubmit.body, `${unknown.body}\n${unknown.hashtags.map(tag => `#${tag}`).join(' ')}`);
        assert.deepEqual(Array.from(plugin.state.beforeSubmit.mediaSources), []);
        assert.deepEqual(plugin.state.events,['title','body','submit']);
        assert.equal(plugin.state.uploads,0);
        assert.equal(plugin.state.clicks,1);
        // A subsequent user-reviewed attempt reads media back from Chrome's
        // reordered dictionaries. Previously this failed before any click.
        assert.deepEqual(Object.keys(plugin.stored[plugin.ownerKey].media[0]), ['mimeType','order','path','role','slotId']);
        state.classification = { intent:'recover',confidence:1,publicationRequested:false,acknowledgedNotPublished:true };
        assert.match((await reply('已核实未发布')).response!, /尚未再次提交/);
        assert.equal(plugin.state.clicks,1);
        const retryJob = [...state.jobs.values()].sort((a,b) => b.revision-a.revision)[0];
        assert.notEqual(retryJob.id,pageJob.id);
        assert.equal(state.jobs.get(pageJob.id)?.errorCode,'USER_VERIFIED_NOT_PUBLISHED');
        state.classification = { intent:'confirm',confidence:1,publicationRequested:true,acknowledgedNotPublished:false };
        plugin.state.publishAfterClicks = plugin.state.clicks + 1;
        plugin.state.published = true;
        assert.match((await reply('重新发布当前版本')).response!,/加入发布队列/);
        for(let i=0;i<100&&state.jobs.get(retryJob.id)?.status!=='completed';i+=1) await new Promise(resolve=>setTimeout(resolve,5));
        assert.equal(state.jobs.get(retryJob.id)?.publishStatus,'published');
        assert.equal(plugin.state.clicks,2);
        assert.equal(plugin.state.uploads,0);
        assert.match((await reply('重新发布当前版本')).response!,/不会重复提交/);
        assert.equal(plugin.state.clicks,2);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
