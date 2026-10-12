// Isolated application smoke: real main/preload/renderer and native PNG export.
// Usage: node scripts/product-image-set-electron-qa.cjs <temporary-root> <app-root> <create|reopen|ui-regression> [native]
// app-root is desktop/ or an unpacked GardenFlow.app/Contents/Resources/app.asar.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { build } = require('esbuild');
const WebSocket = require('ws');
const desktop = path.resolve(__dirname, '..');
const root = path.resolve(process.argv[2]);
const appRoot = path.resolve(process.argv[3] || desktop);
const mode = process.argv[4] || 'create';
const native = process.argv[5] === 'native';
if (!root.startsWith('/private/tmp/') && !root.startsWith('/tmp/')) throw new Error('QA root must be a temporary directory');

async function startDevelopmentRenderer() {
    const { createServer, loadConfigFromFile } = require('vite');
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, path.join(desktop, 'vite.config.ts'));
    const flatten = async (plugins) => (await Promise.all(plugins.map(async (plugin) => {
        const resolved = await plugin;
        return Array.isArray(resolved) ? flatten(resolved) : resolved;
    }))).flat(Infinity).filter(Boolean);
    const plugins = (await flatten(loaded.config.plugins)).filter(plugin => plugin.name !== 'vite-plugin-electron');
    // Serve the source renderer using the application config; Electron is driven only by this isolated harness.
    const server = await createServer({ ...loaded.config, configFile: false, root: desktop, plugins,
        cacheDir: path.join(root, 'vite-cache'), server: { ...loaded.config.server, host: '127.0.0.1', port: 0 },
    });
    await server.listen();
    return server;
}

async function prepare() {
    await fs.mkdir(root, { recursive: true });
    await build({ stdin: { contents: `export { saveSettings, getWorkspacePaths, createChatSession, createAgentTask, createOrReusePendingToolApproval, getChatMessages, addChatMessage, updateChatSessionMetadata, getPendingToolApproval, getAgentTask } from './electron/db';
        export { createBrandWorkspaceStore } from './electron/core/brandWorkspaceStore';
        export { ProductImageSetProposalSchema } from './shared/productImageSet';
        export { ProductImageSetComposeTool } from './electron/core/tools/productImageSetComposeTool';`, resolveDir: desktop },
        outfile: path.join(root, 'seed.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external',
        define: { 'import.meta.url': JSON.stringify(`file://${desktop}/package.json`) },
        banner: { js: `module.paths.unshift(${JSON.stringify(path.join(desktop, 'node_modules'))});` },
    });
    const bootstrap = `
const { app, BrowserWindow, dialog, nativeImage, protocol, ipcMain } = require('electron');
const fs = require('node:fs/promises'); const path = require('node:path'); const assert = require('node:assert/strict');
const root = ${JSON.stringify(root)}; const appRoot = ${JSON.stringify(appRoot)}; const mode = ${JSON.stringify(mode)};
const nativeMode = ${native}; const approvalId = nativeMode ? 'image-set-qa-approval-native' : 'image-set-qa-approval';
const stage = (nativeMode ? 'native-' : 'development-') + mode;
const ipcHandlers = new Map(); const registerHandler = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => { ipcHandlers.set(channel, listener); return registerHandler(channel, listener); };
process.env.GARDENFLOW_USER_DATA_DIR = path.join(root, 'user-data'); process.env.GARDENFLOW_HOLD_AUTOMATION = '1';
app.on('window-all-closed', () => {});
app.setPath('userData', process.env.GARDENFLOW_USER_DATA_DIR); app.setPath('sessionData', process.env.GARDENFLOW_USER_DATA_DIR);
app.getAppPath = () => appRoot;
protocol.registerSchemesAsPrivileged([{ scheme:'gardenflow-asset', privileges:{ standard:true, secure:true, supportFetchAPI:true, stream:true, corsEnabled:true, bypassCSP:true } }]);
// The fixture is seeded after ready; keep the application's already-registered scheme intact.
protocol.registerSchemesAsPrivileged = () => {};
if (appRoot.endsWith('.asar')) { Object.defineProperty(app, 'isPackaged', { value: true }); Object.defineProperty(process, 'resourcesPath', { value: path.dirname(appRoot) }); }
let pickerOutput;
dialog.showSaveDialog = async () => ({ canceled: false, filePath: pickerOutput });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(root, 'exports')] });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(operation, description) { const until = Date.now() + 45000; while (Date.now() < until) { const value = await operation(); if (value) return value; await pause(150); } throw new Error('Timeout: ' + description); }
async function run() {
 await app.whenReady(); await fs.mkdir(process.env.GARDENFLOW_USER_DATA_DIR, { recursive: true }); await fs.mkdir(path.join(root, 'exports'), { recursive: true });
 const seed = require('./seed.cjs'); seed.saveSettings({ workspace_dir: path.join(root, 'workspace'), active_space_id: 'default' });
 let state = await fs.readFile(path.join(root, 'state.json'), 'utf8').then(JSON.parse).catch(() => null);
 if (!state) {
  const fixture = new BrowserWindow({ width: 600, height: 800, useContentSize: true, show: false, webPreferences: { offscreen: true } });
  await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html><body style="margin:0;background:#ecdfcc"><svg width="600" height="800" xmlns="http://www.w3.org/2000/svg"><rect x="180" y="250" width="240" height="380" rx="35" fill="#ab4934"/><rect x="210" y="210" width="180" height="70" rx="10" fill="#303b33"/><rect x="202" y="340" width="196" height="165" rx="15" fill="#fff8ee"/><circle cx="300" cy="413" r="49" fill="#f8aa45"/><path d="M300 366Q338 310 369 350Q338 389 300 366" fill="#607d4e"/></svg></body></html>'));
  await pause(100); const picture = (await fixture.webContents.capturePage()).toPNG(); fixture.destroy();
  await fs.writeFile(path.join(root, 'product.png'), picture);
  const store = seed.createBrandWorkspaceStore(() => path.join(seed.getWorkspacePaths().subjects, 'brand-workspace'));
  const bundle = await store.upsertProduct({ name: '橙香洗护 · 隔离验收商品', description: '仅用于本地排版验收的示意商品', images: [{ dataUrl: 'data:image/png;base64,' + picture.toString('base64') }, { dataUrl: 'data:image/png;base64,' + picture.toString('base64') }] });
  await store.upsertSku({ productId: bundle.product.id, name: '300 ml' });
  const product = await store.getProductCreativeReference(bundle.product.id);
  const proposal = seed.ProductImageSetProposalSchema.parse({ proposalId: 'electron-image-set-qa', productId: product.id, productUpdatedAt: product.updatedAt, productName: product.name,
    finalTitle: '橙香洗护｜商品图文套图', body: '商品原图与本地文字排版验收。', hashtags: ['商品图文', '排版验收'],
    pages: Array.from({ length: 5 }, (_, index) => ({ id: 'qa-page-' + index, role: index === 0 ? 'cover' : 'content', layout: index === 0 ? 'cover' : index === 4 ? 'grid' : 'split',
      title: ['橙香洗护\\n日常的明亮时刻', '一瓶好看\\n自在摆放', '包装细节\\n近距离看清', '原图呈现\\n文字自由调整', '多图细节\\n统一配色'][index],
      copy: index === 0 ? '300 ml · 商品原图排版' : '文字、配色与裁切均可编辑。\\n根据已录入资料展示商品，保留真实外观。',
      productAssetIds: index === 4 ? product.assets.map(asset => asset.id) : [product.assets[index % 2].id], fit: index === 3 ? 'cover' : 'contain', cropX: 65, cropY: 40 })),
  });
  seed.createChatSession('image-set-electron-qa', '商品套图本地验收', { runtimeMode: 'gardenflow' });
  seed.createAgentTask({ id: 'image-set-qa-task', task_type: 'foreground', status: 'paused', runtime_mode: 'gardenflow', owner_session_id: 'image-set-electron-qa',
    route: { workflowKind: 'product-image-set-compose', intent: 'manuscript_creation', recommendedRole: 'image-director', requiredCapabilities: ['artifact-save'], requiresHumanApproval: true },
    metadata: { workflowKind: 'product-image-set-compose', explicitProductRefs: [{ productId: product.id, name: product.name, updatedAt: product.updatedAt }],
      productAssetVisualGrounding: { status: 'verified', productId: product.id, productUpdatedAt: product.updatedAt, imageCount: product.assets.length,
        assets: product.assets.map(asset => ({ assetId: asset.id, visibleText: [], suitability: 'safe' })) } } });
  seed.createOrReusePendingToolApproval({ callId: 'image-set-qa-approval', sessionId: 'image-set-electron-qa', taskId: 'image-set-qa-task', toolName: 'product_image_set_compose', proposalId: proposal.proposalId,
    proposalDigest: JSON.stringify(proposal), params: proposal, details: { ...new seed.ProductImageSetComposeTool().getConfirmationDetails(proposal), spaceId: 'default' } });
  state = { productId: product.id }; await fs.writeFile(path.join(root, 'state.json'), JSON.stringify(state));
 }
 if (nativeMode && mode === 'create' && !state.nativeProjectPath) {
  const previous = seed.getPendingToolApproval('image-set-qa-approval'); const params = { ...previous.params, proposalId:'electron-image-set-qa-native' };
  const previousTask = seed.getAgentTask('image-set-qa-task');
  if (!seed.getAgentTask('image-set-qa-task-native')) seed.createAgentTask({ id:'image-set-qa-task-native', task_type:'foreground', status:'paused', runtime_mode:'gardenflow', owner_session_id:'image-set-electron-qa', route:JSON.parse(previousTask.route_json), metadata:JSON.parse(previousTask.metadata_json) });
  seed.createOrReusePendingToolApproval({ callId:approvalId, sessionId:'image-set-electron-qa', taskId:'image-set-qa-task-native', toolName:'product_image_set_compose', proposalId:params.proposalId, proposalDigest:JSON.stringify(params), params,
   details:{ ...new seed.ProductImageSetComposeTool().getConfirmationDetails(params), spaceId:'default' } });
  state.developmentProjectPath = state.projectPath; delete state.projectPath;
 }
 if (nativeMode && state.nativeProjectPath) state.projectPath = state.nativeProjectPath;
 if (!nativeMode && state.developmentProjectPath) state.projectPath = state.developmentProjectPath;
 seed.updateChatSessionMetadata('image-set-electron-qa', { runtimeMode:'gardenflow', surface:'gardenflow', runtimeSurface:'gardenflow', contextType:'gardenflow', contextId:'gardenflow-singleton:default', gardenflowContext:{ spaceId:'default', surface:'gardenflow', contextId:'gardenflow-singleton:default' } });
 if (!seed.getChatMessages('image-set-electron-qa').length) {
  seed.addChatMessage({ id:'qa-user', session_id:'image-set-electron-qa', role:'user', content:'给这个商品做五张图文套图' });
  seed.addChatMessage({ id:'qa-assistant', session_id:'image-set-electron-qa', role:'assistant', content:'已规划五张商品套图，请核对页面文字与原图后确认创建。' });
 }
 ${native ? '/* The packaged executable loads its own main entry after the inspector resumes. */' : "require(path.join(appRoot, 'dist-electron', 'main.js'));"}
 const window = await poll(async () => BrowserWindow.getAllWindows().find(window => !window.isDestroyed()), 'main window');
 window.webContents.setBackgroundThrottling(false); window.setOpacity(1); window.show(); window.focus();
 await poll(async () => window.webContents.executeJavaScript('Boolean(window.ipcRenderer && document.getElementById("root")?.childElementCount)').catch(() => false), 'renderer mounted');
 const js = code => window.webContents.executeJavaScript(code, true);
 const api = code => js('(async () => { ' + code + ' })()');
 const skills = await api('return window.ipcRenderer.listSkills();');
 assert.ok(skills.some(skill => skill.name === 'product-image-set-director' && !skill.disabled), 'director skill is discoverable by the actual application');
 await pause(1000);
 if (!state.projectPath) {
  const card = await api('return window.ipcRenderer.chat.getPendingToolConfirmation("image-set-electron-qa");'); assert.equal(card.params.pages.length, 5);
  await js('window.dispatchEvent(new CustomEvent("gardenflow:navigate", { detail: { type: "gardenflow.open", action: "open-session", sessionId: "image-set-electron-qa" } })); true');
  await poll(async () => js('document.body.innerText.includes("确认并创建套图")'), 'confirmation card');
  await fs.writeFile(path.join(root, stage + '-confirmation.png'), (await window.webContents.capturePage()).toPNG());
  await js('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "确认并创建套图").click(); true');
  const resolution = await poll(async () => api('return window.ipcRenderer.chat.confirmTool(' + JSON.stringify(approvalId) + ', true);').then(result => result.status === 'completed' && result), 'durable confirmation');
  const note = await api('return window.ipcRenderer.manuscripts.getXhsNote(' + JSON.stringify(resolution.projectId) + ');');
  state.projectPath = note.projectPath; if (nativeMode) state.nativeProjectPath = note.projectPath; await fs.writeFile(path.join(root, 'state.json'), JSON.stringify(state));
 }
 await js('window.dispatchEvent(new CustomEvent("gardenflow:navigate", { detail: { type: "manuscript.open", manuscriptPath: ' + JSON.stringify(path.relative(seed.getWorkspacePaths().manuscripts, state.projectPath)) + ' } })); true');
 await poll(async () => js('Boolean(Array.from(document.querySelectorAll("iframe")).find(frame => frame.title === "商品套图页面预览"))'), 'image-set workbench');
 await poll(async () => js('Array.from(document.querySelectorAll("iframe")).find(frame => frame.title === "商品套图页面预览")?.contentDocument?.querySelector("h1")?.innerText'), 'page preview');
 await pause(500); await fs.writeFile(path.join(root, stage + '-workbench.png'), (await window.webContents.capturePage()).toPNG());
 let note = await api('return window.ipcRenderer.manuscripts.getXhsNote(' + JSON.stringify(state.projectPath) + ');');
 if (mode === 'ui-regression') {
  const readChannel = 'manuscripts:get-xhs-note'; const configChannel = 'manuscripts:product-image-generation-config'; const generateChannel = 'manuscripts:generate-product-image-page'; const previewChannel = 'manuscripts:preview-product-image-page';
  const originalRead = ipcHandlers.get(readChannel); const originalConfig = ipcHandlers.get(configChannel); const originalGenerate = ipcHandlers.get(generateChannel);
  const originalPreview = ipcHandlers.get(previewChannel);
  const replace = (channel, listener) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, listener); };
  let virtualNote = structuredClone(note); let release; let entered; let holdNextRead = false;
  virtualNote.document.productImageSet.pages[0].aiPrompt = 'fixture only; no real image submission';
  let readEntered = new Promise(resolve => { entered = resolve; }); const requests = [];
  replace(readChannel, async () => {
   const result = structuredClone(virtualNote);
   if (holdNextRead) { holdNextRead = false; entered(); await new Promise(resolve => { release = resolve; }); }
   return result;
  });
  replace(configChannel, () => ({ success:true, configured:true, model:'fixture-ui-image', configurationKey:'fixture-ui-reviewed' }));
  replace(previewChannel, (event, input) => originalPreview(event, { ...input, expectedRevision:note.version }));
  replace(generateChannel, (_event, input) => {
   requests.push(input); assert.equal(input.expectedRevision, virtualNote.version, 'retry uses the newest revision');
   assert.equal(input.confirmed, true); assert.equal(input.reviewedConfigurationKey, 'fixture-ui-reviewed');
   virtualNote.version++; virtualNote.document.revision = virtualNote.version;
   const page = virtualNote.document.productImageSet.pages.find(page => page.id === input.pageId);
   page.generation = { requestId:input.requestId, inputKey:'fixture-ui', status:requests.length === 1 ? 'failed' : 'succeeded', startedAt:new Date().toISOString(), ...(requests.length === 1 ? { error:'fixture-ui-provider-failure' } : {}) };
   virtualNote.xhsNote = virtualNote.document;
   return requests.length === 1 ? { success:false, error:'fixture-ui-provider-failure' } : structuredClone(virtualNote);
  });
  const readTitle = () => js('Array.from(document.querySelectorAll("label")).find(label => label.textContent.startsWith("页面标题"))?.querySelector("input")?.value');
  const clickButton = text => js('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === ' + JSON.stringify(text) + ').click(); true');
  const originalTitle = await readTitle(); const unsavedTitle = '刷新返回前刚输入的标题';
  holdNextRead = true; await clickButton('刷新'); await readEntered;
  await js('(() => { const field = Array.from(document.querySelectorAll("label")).find(label => label.textContent.startsWith("页面标题"))?.querySelector("input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ' + JSON.stringify(unsavedTitle) + '); field.dispatchEvent(new Event("input", { bubbles:true })); })(); true');
  await pause(100); release(); await pause(500);
  const dirtyRefreshPreserved = await readTitle() === unsavedTitle;
  await fs.writeFile(path.join(root, stage + '-dirty-refresh.png'), (await window.webContents.capturePage()).toPNG());
  await clickButton('刷新'); await pause(100);
  await js('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "丢弃修改并刷新")?.click(); true');
  await poll(async () => await readTitle() === originalTitle, 'discard fixture edits');
  await poll(async () => js('Boolean(Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("生成本页画面") && !button.disabled))'), 'configuration refresh without revision change');
  const sameRevisionConfigRefreshed = await js('document.body.innerText.includes(' + JSON.stringify('版本 ' + note.version) + ')');
  readEntered = new Promise(resolve => { entered = resolve; }); holdNextRead = true;
  await clickButton('刷新'); await readEntered;
  virtualNote.version++; virtualNote.document.revision = virtualNote.version;
  virtualNote.document.productImageSet.pages[0].title = '后发请求读取的最新标题';
  await clickButton('刷新');
  await poll(async () => await readTitle() === '后发请求读取的最新标题', 'newer refresh result');
  release(); await pause(500);
  const outOfOrderRefreshProtected = await readTitle() === '后发请求读取的最新标题';
  virtualNote.version++; virtualNote.document.revision = virtualNote.version;
  virtualNote.document.productImageSet.pages[0].title = note.document.productImageSet.pages[0].title;
  await clickButton('刷新'); await poll(async () => await readTitle() === originalTitle, 'reset virtual title');
  await poll(async () => js('Boolean(Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("生成本页画面") && !button.disabled))'), 'mock image configuration');
  await clickButton('生成本页画面（计费）'); await pause(100); await clickButton('确认生成 1 张');
  await poll(async () => js('document.body.innerText.includes("fixture-ui-provider-failure") && !document.body.innerText.includes("正在生成本页画面，可在任务完成后继续编辑")'), 'mock generation failure');
  const failedStatusVisible = await js('document.body.innerText.includes("AI 画面：失败")');
  const failedRevisionVisible = await js('document.body.innerText.includes(' + JSON.stringify('版本 ' + virtualNote.version) + ')');
  await fs.writeFile(path.join(root, stage + '-failed-retry.png'), (await window.webContents.capturePage()).toPNG());
  let retryUsesLatestRevision = false;
  if (failedRevisionVisible) {
   await clickButton('生成本页画面（计费）'); await pause(100); await clickButton('确认生成 1 张');
   await poll(async () => js('document.body.innerText.includes("本页 AI 画面已保存")'), 'mock generation retry');
   retryUsesLatestRevision = requests.length === 2 && requests[1].expectedRevision === requests[0].expectedRevision + 1 && requests[1].requestId !== requests[0].requestId;
  }
  replace(readChannel, originalRead); replace(configChannel, originalConfig); replace(generateChannel, originalGenerate); replace(previewChannel, originalPreview);
  const unchanged = await api('return window.ipcRenderer.manuscripts.getXhsNote(' + JSON.stringify(state.projectPath) + ');');
  assert.equal(unchanged.version, note.version); assert.equal(unchanged.document.productImageSet.generationHistory.length, 0);
  const result = { mode, nativeExecutable:nativeMode, sourceRenderer:!nativeMode, dirtyRefreshPreserved, outOfOrderRefreshProtected, sameRevisionConfigRefreshed, failedStatusVisible, failedRevisionVisible, retryUsesLatestRevision, simulatedRequests:requests.length, realPaidRequests:0, persistedProjectUnchanged:true, boundary:'Real workbench with controlled IPC responses; image model submission is simulated and project data is unchanged.' };
  await fs.writeFile(path.join(root, stage + '-result.json'), JSON.stringify(result, null, 2));
  assert.ok(dirtyRefreshPreserved, 'background refresh must preserve newer unsaved text');
  assert.ok(outOfOrderRefreshProtected, 'late refresh must not overwrite a newer response');
  assert.ok(sameRevisionConfigRefreshed, 'manual refresh reloads model configuration even when project revision is unchanged');
  assert.ok(failedStatusVisible && failedRevisionVisible, 'failed generation must load persisted status and revision');
  assert.ok(retryUsesLatestRevision, 'failed page can submit a new reviewed request immediately');
  console.log('IMAGE_SET_QA_SUCCESS ui-regression'); app.exit(0); return;
 }
 if (mode === 'create') {
  const title = '橙香洗护 · 可编辑的明亮时刻';
  await js('(() => { const field = Array.from(document.querySelectorAll("label")).find(label => label.textContent.startsWith("页面标题"))?.querySelector("input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ' + JSON.stringify(title) + '); field.dispatchEvent(new Event("input", { bubbles:true })); Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "保存").click(); })(); true');
  await poll(async () => api('return window.ipcRenderer.manuscripts.getXhsNote(' + JSON.stringify(state.projectPath) + ');').then(result => result.document.productImageSet.pages[0].title === title), 'UI title save');
  note = await api('return window.ipcRenderer.manuscripts.getXhsNote(' + JSON.stringify(state.projectPath) + ');');
 }
 const input = { path: state.projectPath, expectedRevision: note.version, format: 'zip' }; const zipPath = path.join(root, stage + '-images.zip'); pickerOutput = zipPath;
 const exported = await api('return window.ipcRenderer.manuscripts.exportProductImageSet(' + JSON.stringify(input) + ');');
 assert.equal(exported.success, true, exported.error); assert.equal(exported.document.generationStatus, 'generated');
 assert.equal(exported.document.productImageSet.generationHistory.length, 0, 'default workflow made no AI image request');
 if (mode === 'reopen') {
  const previous = JSON.parse(await fs.readFile(path.join(root, (nativeMode ? 'native-' : 'development-') + 'create-snapshot.json'), 'utf8'));
  assert.deepEqual(exported.document.mediaSlots.map(slot => slot.assetId), previous.mediaSlots.map(slot => slot.assetId), 'cold reopen reuses all rendered media');
  assert.deepEqual(exported.document.productImageSet.pages.map(page => page.title), previous.productImageSet.pages.map(page => page.title), 'cold reopen preserves edited text');
 }
 await fs.writeFile(path.join(root, stage + '-snapshot.json'), JSON.stringify(exported.document, null, 2));
 const assets = await api('return window.ipcRenderer.media.list();');
 const mediaRoot = seed.getWorkspacePaths().media;
 const items = Array.isArray(assets) ? assets : assets.items || assets.assets || [];
 for (const [index, slot] of exported.document.mediaSlots.entries()) {
  const asset = items.find(asset => asset.id === slot.assetId); assert.ok(asset, 'bound media exists');
  const bytes = await fs.readFile(path.join(mediaRoot, asset.relativePath)); const size = nativeImage.createFromBuffer(bytes).getSize();
  assert.deepEqual(size, { width:1440, height:1920 }); await fs.writeFile(path.join(root, String(index + 1).padStart(2, '0') + '.png'), bytes);
  const page = exported.document.productImageSet.pages[index];
  await js('Array.from(document.querySelectorAll("nav")).find(nav => nav.getAttribute("aria-label") === "套图页面").querySelectorAll("button")[' + index + '].click(); true');
  await poll(async () => js('Array.from(document.querySelectorAll("iframe")).find(frame => frame.title === "商品套图页面预览")?.contentDocument?.querySelector("h1")?.textContent === ' + JSON.stringify(page.title)), 'page ' + (index + 1) + ' preview');
  const paragraph = await api('const document = Array.from(window.document.querySelectorAll("iframe")).find(frame => frame.title === "商品套图页面预览").contentDocument; await document.fonts.ready; const text = document.querySelector("p"); const rect = text.getBoundingClientRect(); return { x:Math.floor(rect.x), y:Math.floor(rect.y), width:Math.floor(rect.width), height:Math.floor(rect.height) };');
  const pixels = nativeImage.createFromBuffer(bytes).crop(paragraph).toBitmap();
  let darkPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] < 270 && pixels[offset + 3] > 200) darkPixels++;
  assert.ok(darkPixels > 20, 'page ' + (index + 1) + ' paragraph is painted in exported PNG');
 }
 await js('Array.from(document.querySelectorAll("nav")).find(nav => nav.getAttribute("aria-label") === "套图页面").querySelectorAll("button")[0].click(); true');
 pickerOutput = path.join(root, stage + '-single.png');
 const single = await api('return window.ipcRenderer.manuscripts.exportProductImageSet(' + JSON.stringify({ path:state.projectPath, expectedRevision:exported.version, format:'png', pageId:'qa-page-0' }) + ');'); assert.equal(single.success, true, single.error);
 const directory = await api('return window.ipcRenderer.manuscripts.exportProductImageSet(' + JSON.stringify({ path:state.projectPath, expectedRevision:single.version, format:'directory' }) + ');'); assert.equal(directory.success, true, directory.error);
 assert.equal((await fs.readdir(directory.outputPath)).length, 5);
 if (mode === 'create') {
  const overflow = structuredClone(exported.document); overflow.productImageSet.pages[0].copy = '长文测试'.repeat(220);
  let saved = await api('return window.ipcRenderer.manuscripts.saveXhsNote(' + JSON.stringify({ path:state.projectPath, expectedRevision:exported.version, document:overflow }) + ');'); assert.equal(saved.success, true, saved.error);
  const failed = await api('return window.ipcRenderer.manuscripts.renderProductImagePage(' + JSON.stringify({ path:state.projectPath, pageId:'qa-page-0', expectedRevision:saved.version }) + ');');
  assert.equal(failed.success, false); assert.match(failed.error, /封面.*文字超出/);
  saved = await api('return window.ipcRenderer.manuscripts.saveXhsNote(' + JSON.stringify({ path:state.projectPath, expectedRevision:saved.version, document:exported.document }) + ');'); assert.equal(saved.success, true, saved.error);
 }
 await pause(750); await fs.writeFile(path.join(root, stage + '-workbench.png'), (await window.webContents.capturePage()).toPNG());
 await fs.writeFile(path.join(root, stage + '-result.json'), JSON.stringify({ mode, nativeExecutable:nativeMode, sourceRenderer:!nativeMode, directorSkillAvailable:true, productId:state.productId, projectPath:state.projectPath, pageCount:exported.document.productImageSet.pages.length, revision:exported.version, pngSize:'1440x1920', paidMediaRequests:0, reusedMediaBindings:mode === 'reopen', longTextOverflowBlocked:mode === 'create', source:'fixture approval with real application IPC and workbench; file pickers are isolated', zip:zipPath, png:pickerOutput, directory:directory.outputPath }, null, 2));
 console.log('IMAGE_SET_QA_SUCCESS ' + mode); app.exit(0);
}
run().catch(async error => { console.error(error); await fs.writeFile(path.join(root, stage + '-error.txt'), String(error.stack || error)).catch(() => {});
 const window = BrowserWindow.getAllWindows()[0]; if (window) { await fs.writeFile(path.join(root, stage + '-failure.png'), (await window.webContents.capturePage()).toPNG()).catch(() => {}); await fs.writeFile(path.join(root, stage + '-dom.txt'), await window.webContents.executeJavaScript('document.body.innerText').catch(() => '')).catch(() => {}); } app.exit(1); });
setTimeout(() => { console.error('QA process deadline'); app.exit(1); }, 150000).unref();
`;
    await fs.mkdir(path.join(root, 'user-data'), { recursive: true });
    await fs.writeFile(path.join(root, 'runner.cjs'), bootstrap);
    const environment = { ...process.env, GARDENFLOW_USER_DATA_DIR: path.join(root, 'user-data'), GARDENFLOW_HOLD_AUTOMATION: '1' };
    delete environment.ELECTRON_RUN_AS_NODE;
    const developmentServer = native ? null : await startDevelopmentRenderer();
    if (developmentServer) environment.VITE_DEV_SERVER_URL = developmentServer.resolvedUrls.local[0];
    else delete environment.VITE_DEV_SERVER_URL;
    const executable = native ? path.join(path.dirname(path.dirname(appRoot)), 'MacOS', 'GardenFlow') : require('electron');
    const child = spawn(executable, native ? ['--inspect-brk=127.0.0.1:0'] : [path.join(root, 'runner.cjs')], { cwd: native ? root : desktop, stdio: native ? ['ignore', 'inherit', 'pipe'] : 'inherit', env: environment });
    if (native) {
        let connected = false;
        child.stderr.on('data', (data) => {
            process.stderr.write(data);
            const url = String(data).match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/)?.[0];
            if (!url || connected) return;
            connected = true;
            void injectNativeDriver(url, bootstrap).catch((error) => { console.error(error); child.kill(); process.exitCode = 1; });
        });
    }
    child.on('error', (error) => { console.error(error); process.exitCode = 1; void developmentServer?.close(); });
    child.on('exit', (code, signal) => { if (signal) console.error(`Electron QA terminated: ${signal}`); process.exitCode = code === null ? 1 : code; void developmentServer?.close(); });
}
async function injectNativeDriver(url, source) {
    const socket = new WebSocket(url); let sequence = 0; const pending = new Map(); let paused;
    const pauseEvent = new Promise((resolve) => { paused = resolve; });
    socket.on('message', (bytes) => {
        const message = JSON.parse(String(bytes));
        if (message.id) { const callback = pending.get(message.id); pending.delete(message.id); if (message.error) callback.reject(new Error(JSON.stringify(message.error))); else callback.resolve(message.result); }
        else if (message.method === 'Debugger.paused') paused(message.params.callFrames[0].callFrameId);
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await call('Debugger.enable');
    await call('Runtime.runIfWaitingForDebugger');
    const callFrameId = await pauseEvent;
    const evaluated = await call('Debugger.evaluateOnCallFrame', { callFrameId, expression: `(function(require) { ${source} })(require('node:module').createRequire(${JSON.stringify(path.join(root, 'runner.cjs'))}))`, silent: false });
    if (evaluated.exceptionDetails) throw new Error(JSON.stringify(evaluated.exceptionDetails));
    await call('Debugger.resume'); await call('Debugger.disable'); socket.close();
}
prepare().catch((error) => { console.error(error); process.exitCode = 1; });
