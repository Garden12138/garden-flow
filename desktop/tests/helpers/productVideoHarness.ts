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
export async function productVideoHarness() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-video-closeout-'));
    const source = await fs.readFile(new URL('../../electron/db.ts', import.meta.url), 'utf8');
    let sql = new DatabaseSync(path.join(root, 'approvals.db'));
    sql.exec('PRAGMA foreign_keys=OFF');
    sql.exec(source.match(/CREATE TABLE IF NOT EXISTS pending_tool_approvals \([\s\S]*?\n    \);/)![0]);
    const state = {
        root, spaceId: 'default', settings: {} as Record<string, unknown>,
        messages: [] as Array<Record<string, any>>, tasks: new Map<string, any>(), videoCalls: 0, ttsCalls: 0,
        audio: Buffer.alloc(0), failSpeech: false,
    };
    const db = {
        prepare: (query: string) => sql.prepare(query),
        transaction: (fn: (...args: any[]) => any) => (...args: any[]) => {
            sql.exec('BEGIN');
            try { const result = fn(...args); sql.exec('COMMIT'); return result; }
            catch (error) { sql.exec('ROLLBACK'); throw error; }
        },
    };
    const approvalTypes = source.slice(source.indexOf('export type PendingToolApprovalStatus'), source.indexOf('export type AgentTaskStatus'));
    const approvalFunctions = source.slice(source.indexOf('const parsePendingToolApproval'), source.indexOf('/**\n * 获取会话的所有消息', source.indexOf('const parsePendingToolApproval')));
    const mocks: Record<string, string> = {
        db: `const state = globalThis.__fixture; const db = globalThis.__fixtureDb;
            export const getSettings = () => state.settings;
            export const getWorkspacePathsForSpace = (spaceId) => { const base = state.root + '/' + spaceId; return { base, media: base + '/media', subjects: base + '/subjects', activeSpaceId: spaceId }; };
            export const getWorkspacePaths = () => getWorkspacePathsForSpace(state.spaceId);
            export const addChatMessage = (message) => state.messages.push(message);
            export const getChatMessages = (session) => state.messages.filter((message) => message.session_id === session);
            ${approvalTypes}\n${approvalFunctions}`,
        ai: `const state = globalThis.__fixture;
            const runtime = { getTask: id => state.tasks.get(id), cancelTask: id => { state.tasks.get(id).status = 'cancelled'; }, resumeTask: id => { state.tasks.get(id).status = 'running'; }, addArtifact: (id, artifact) => state.tasks.get(id).artifacts.push(artifact) };
            export const getTaskGraphRuntime = () => runtime;
            export const getAgentRuntime = () => ({ failExecution: (id) => {state.tasks.get(id).status = 'failed';}, completeExecution: (id) => {state.tasks.get(id).status = 'completed';} });`,
        video: `export class VideoGenerateTool { async execute() { globalThis.__fixture.videoCalls++; throw new Error('unexpected video generation'); } }`,
        imageProvider: `export const generateImagesToMediaLibrary = async () => { throw new Error('unexpected image generation'); };`,
        videoProvider: `export const generateVideosToMediaLibrary = async () => { throw new Error('unexpected video generation'); };`,
        electron: `export const app = { isPackaged: false, getAppPath: () => ${JSON.stringify(path.resolve(import.meta.dirname, '../..'))} };`,
    };
    const exports = `export * from './electron/core/productVideoApprovalService';
        export * from './electron/core/tools/productVideoComposeTool';
        export * from './electron/core/brandWorkspaceStore';
        export * from './electron/core/video-editor-v2/videoEditorV2ProjectStore';
        export * from './electron/core/video-editor-v2/productVideoVoiceoverService';
        export * from './electron/core/video-editor-v2/renderExportService';
        export * from './electron/core/mediaGenerationJobRegistry';
        export * from './electron/db';`;
    const bundled = await build({ stdin: { contents: exports, resolveDir: path.resolve(import.meta.dirname, '../..') }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', define: { 'import.meta.url': JSON.stringify(new URL('../../package.json', import.meta.url).href) },
        plugins: [{ name: 'isolated-video-host', setup(builder) {
            builder.onResolve({ filter: /(?:^electron$|(?:^|\/)db(?:\.ts)?$|(?:^|\/)ai$|mediaGenerationTools$|imageGenerationService$|videoGenerationService$)/ }, (args) => {
                const key = args.path === 'electron' ? 'electron' : /\/db(?:\.ts)?$/.test(args.path) ? 'db' : args.path.endsWith('/ai') ? 'ai'
                    : args.path.endsWith('mediaGenerationTools') ? 'video' : args.path.endsWith('imageGenerationService') ? 'imageProvider' : 'videoProvider';
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
        require: createRequire(new URL('../../package.json', import.meta.url)), process: fixtureProcess, console, Buffer, URL, AbortController, AbortSignal,
        setTimeout, clearTimeout, setInterval, clearInterval, structuredClone, __dirname: root,
        fetch: async (url: string) => {
            if (url !== 'https://tts.invalid/v1/audio/speech') throw new Error(`Unexpected network request`);
            state.ttsCalls++;
            return state.failSpeech ? new Response('fixture speech failure', { status: 400 }) : new Response(state.audio, { headers: { 'content-type': 'audio/wav' } });
        },
    });
    return module.exports;
    };
    let api = loadRuntime();
    let store = api.createBrandWorkspaceStore(() => path.join(root, state.spaceId, 'subjects/brand-workspace'));
    let unsubscribe = api.onProductChanged(api.invalidateProductVideoApprovals);
    return { root, state, get api() { return api; }, get store() { return store; }, get sql() { return sql; },
        restart() {
            unsubscribe(); sql.close(); sql = new DatabaseSync(path.join(root, 'approvals.db'));
            sql.exec('PRAGMA foreign_keys=OFF');
            api = loadRuntime(); unsubscribe = api.onProductChanged(api.invalidateProductVideoApprovals);
            store = api.createBrandWorkspaceStore(() => path.join(root, state.spaceId, 'subjects/brand-workspace'));
        },
        async close() { unsubscribe(); sql.close(); await fs.rm(root, { recursive: true, force: true }); },
        async approveFixture(proposal: ProductVideoProposal, callId = 'approval-1', sessionId = 'session-1') {
            const taskId = `task-${callId}`;
            state.tasks.set(taskId, { id: taskId, status: 'paused', route: { workflowKind: 'product-video-compose' }, artifacts: [], metadata: {
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
