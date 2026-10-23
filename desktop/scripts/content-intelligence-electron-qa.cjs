// Run from desktop after `pnpm exec vite build`:
// node scripts/content-intelligence-electron-qa.cjs /private/tmp/gardenflow-ci-qa [private-captured-product.json]
// Uses actual Electron, SQLite, IPC, React and existing workspaces. No model/media/publication requests.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { build } = require('esbuild');
const desktop = path.resolve(__dirname, '..');
const root = path.resolve(process.argv[2] || '/private/tmp/gardenflow-ci-qa');
const inputPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
if (!root.startsWith('/private/tmp/') && !root.startsWith('/tmp/')) throw new Error('QA requires an isolated temporary directory');

async function main() {
    await fs.mkdir(root, { recursive: true });
    await fs.symlink(path.join(desktop, 'node_modules'), path.join(root, 'node_modules')).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await build({ stdin: { resolveDir: desktop, contents: `export { saveSettings, getWorkspacePaths, getContentIntelligenceRepository, createSpace } from './electron/db';
        export { createBrandWorkspaceStore } from './electron/core/brandWorkspaceStore';
        export * from './electron/core/creationWorkspaceStore';` }, outfile: path.join(root, 'seed.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external',
        define: { 'import.meta.url': JSON.stringify(`file://${desktop}/package.json`) },
        banner: { js: `module.paths.unshift(${JSON.stringify(path.join(desktop, 'node_modules'))});` } });
    const runner = String.raw`
const { app, BrowserWindow, protocol, session } = require('electron');
const fs = require('node:fs/promises'); const path = require('node:path'); const assert = require('node:assert/strict');
const root = __ROOT__; const desktop = __DESKTOP__; const inputPath = __INPUT__;
// Isolate both app data and browser native-host warmup from the user's directories.
require('node:os').homedir = () => root;
process.env.GARDENFLOW_USER_DATA_DIR = path.join(root, 'user-data'); process.env.GARDENFLOW_HOLD_AUTOMATION = '1';
app.setPath('userData', process.env.GARDENFLOW_USER_DATA_DIR); app.setPath('sessionData', process.env.GARDENFLOW_USER_DATA_DIR); app.setPath('home', root); app.getAppPath = () => desktop;
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'gardenflow-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } }]); protocol.registerSchemesAsPrivileged = () => {};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(operation, label) { const until = Date.now() + 45000; while (Date.now() < until) { if (await operation()) return; await pause(120); } throw new Error('Timeout: ' + label); }
let window, api, js;
async function run() {
 await app.whenReady();
 let blockedRequests = 0;
 const originalFetch = global.fetch; global.fetch = (url, ...args) => { if (!String(url).startsWith('http://127.0.0.1:')) { blockedRequests++; throw new Error('External request forbidden in CI QA'); } return originalFetch(url, ...args); };
 session.defaultSession.webRequest.onBeforeRequest((details, callback) => { const external = /^https?:/.test(details.url) && !details.url.startsWith('http://127.0.0.1:'); if(external) blockedRequests++; callback({ cancel: external }); });
 const seed = require('./seed.cjs'); seed.saveSettings({ workspace_dir: path.join(root, 'workspace'), active_space_id: 'default', proxy_enabled: 0 });
 const store = seed.createBrandWorkspaceStore(() => path.join(seed.getWorkspacePaths().subjects, 'brand-workspace'));
 const statePath = path.join(root, 'state.json'); let state = await fs.readFile(statePath, 'utf8').then(JSON.parse).catch(() => null);
 if (!state) {
  const captured = inputPath ? JSON.parse(await fs.readFile(inputPath, 'utf8')) : { platform: 'taobao', externalId: '123', sourceUrl: 'https://item.taobao.com/item.htm?id=123', capturedAt: '2026-10-01T00:00:00Z', title: '明确标记的合成测试商品', parameters: [], missingFields: [], reviewCapture: { modalDetected: true, status: 'partial', availableFilters: [], selectedFilters: [], results: [{filterId:'all',label:'全部',requested:10,captured:1,status:'partial'}], warnings:['合成测试样本'], reviews:[{id:'one',text:'合成评论：固定后会滑动',matchedFilterIds:[],images:[]}] } };
  await store.ingestProduct(captured);
  const oldWork = await seed.startCreationWorkspace({ platform: 'xiaohongshu', capability: 'note-image', requestId: 'legacy-unlinked' });
  state = { mode: inputPath ? 'existing-local-capture' : 'synthetic-explicitly-labelled', oldWorkId: oldWork.id, oldWorkRevision: oldWork.revision };
  await fs.writeFile(statePath, JSON.stringify(state));
 }
 require(path.join(desktop, 'dist-electron/main.js'));
 await poll(async () => { window = BrowserWindow.getAllWindows().find(value => !value.isDestroyed()); return Boolean(window); }, 'application window'); window.webContents.setBackgroundThrottling(false);
 js = code => window.webContents.executeJavaScript(code, true).catch(error => { throw new Error('Renderer script failed: ' + code.slice(0,100), {cause:error}); }); api = code => js('(async()=>{' + code + '})()');
 await poll(async () => js('Boolean(window.ipcRenderer?.contentIntelligence && document.getElementById("root")?.childElementCount)').catch(() => false), 'actual typed bridge');
 const invoke = async (method, input) => { const result = await api('return window.ipcRenderer.contentIntelligence.' + method + '(' + (input === undefined ? '' : JSON.stringify(input)) + ')'); assert.equal(result.success, true, result.error); return result.data; };
 const click = label => js('Array.from(document.querySelectorAll("button")).find(button=>button.textContent.trim()===' + JSON.stringify(label) + ')?.click();true');
 const select = (label, value) => js('var field=document.querySelector(' + JSON.stringify('select[aria-label="' + label + '"]') + ');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(field,' + JSON.stringify(value) + ');field.dispatchEvent(new Event("change",{bubbles:true}));true');
 const navigate = intent => js('window.dispatchEvent(new CustomEvent("gardenflow:navigate",{detail:' + JSON.stringify(intent) + '}));true');
 if (!state.workspaceId) {
  await navigate({ type: 'view.open', view: 'wander' });
  await poll(() => js('Array.from(document.querySelectorAll("button")).some(button=>button.textContent.trim()==="消费者机会")'), 'Wander opportunity tab'); await click('消费者机会');
  await click('手动新建机会'); await poll(() => js('document.querySelector("select[aria-label=证据来源]")?.options.length > 1'), 'real captured source option');
  const source = (await invoke('sources'))[0]; const segment = source.segments.find(segment => segment.kind === 'comment'); assert.ok(segment?.text);
  const fields = ['评论依据验收机会', '复核本次评论中实际提及的使用问题', '仅本次已采集评论样本', '以原始评论为研究线索，制作说明稿；商品主张需另行核实'];
  for (let index=0; index<fields.length; index++) await js('var field=document.querySelectorAll("form input")[' + index + '];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,' + JSON.stringify(fields[index]) + ');field.dispatchEvent(new Event("input",{bubbles:true}));true');
  await select('证据来源', '0'); await select('原文片段', segment.key);
  const quote = segment.text.slice(0, 500);
  await js('var field=document.querySelector("textarea[aria-label=引用原文]");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,' + JSON.stringify(quote) + ');field.dispatchEvent(new Event("input",{bubbles:true}));true');
  await click('绑定这条原文'); await poll(() => js('document.body.innerText.includes("已绑定 1 条证据")'), 'server-verified quote');
  await click('保存机会'); await poll(async () => (await invoke('list')).items.length === 1, 'persisted opportunity');
  await click('采纳'); await poll(async () => (await invoke('list')).items[0].status === 'accepted', 'explicit adoption');
  await click('打开原始来源与定位'); await poll(() => js('Boolean(document.querySelector("[aria-label=原始来源快照]"))'), 'original local quote locator');
  window.setSize(1440, 940); await pause(300); await fs.writeFile(path.join(root,'opportunity-private.png'),(await window.webContents.capturePage()).toPNG());
  const opportunity = (await invoke('list')).items[0];
  await click('确认目标并基于此创作'); await poll(() => js('Boolean(document.querySelector("[data-creation-workbench]"))'), 'existing real authoring workbench');
  // Locate the persisted link through the server-created work files, never through a fake UI ID.
  const creationRoot = path.join(seed.getWorkspacePaths().gardenflow,'creation-workspaces');
  const records = await Promise.all((await fs.readdir(creationRoot)).filter(name=>name.endsWith('.json')).map(async name=>JSON.parse(await fs.readFile(path.join(creationRoot,name),'utf8'))));
  const work = records.find(value=>value.id!==state.oldWorkId); assert.ok(work);
  const link = seed.getContentIntelligenceRepository().linksForWork(work.id)[0]; assert.ok(link);
  state = { ...state, workspaceId:work.id, sessionId:work.sessionId, opportunityId:opportunity.id, opportunityRevision:opportunity.revision, workRequestId:link.requestId, quote, evidenceId:opportunity.evidence[0].id, sourceVersion:source.version };
  await fs.writeFile(statePath,JSON.stringify(state));
 }
 await navigate({type:'creation.open',workspaceId:state.workspaceId}); await poll(() => js('Boolean(document.querySelector("[data-creation-workbench]"))'), 'reopened real work');
 await click('创作依据 ▾'); await poll(() => js('document.body.innerText.includes(' + JSON.stringify(state.quote) + ')'), 'reverse evidence after reopen');
 const sourceView = await invoke('evidenceSource',state.evidenceId); assert.equal(sourceView.evidence.excerpt,state.quote); assert.equal(sourceView.evidence.validity,'verified');
 for(const width of [960,1440]) { window.setSize(width,940); await pause(250); await fs.writeFile(path.join(root,'work-evidence-'+width+'-private.png'),(await window.webContents.capturePage()).toPNG()); }
 const restored = await seed.readCreationWorkspace(state.workspaceId); assert.equal(restored.sessionId,state.sessionId);
 if(state.workRequestId) { const retry = await invoke('createWork',{opportunityId:state.opportunityId,expectedRevision:state.opportunityRevision,requestId:state.workRequestId,selection:{platform:'xiaohongshu',capability:'note-image'}}); assert.equal(retry.workspace.id,state.workspaceId); assert.equal(seed.getContentIntelligenceRepository().linksForWork(state.workspaceId).length,1); }
 const old = await invoke('workEvidence',state.oldWorkId); assert.deepEqual(old,[]);
 await navigate({type:'creation.open',workspaceId:state.oldWorkId}); await poll(() => js('Boolean(document.querySelector("[data-creation-workbench]"))'), 'legacy work unchanged');
 assert.equal((await seed.readCreationWorkspace(state.oldWorkId)).revision,state.oldWorkRevision);
 await navigate({type:'creation.open',workspaceId:state.workspaceId}); await poll(() => js('Boolean(document.querySelector("[data-creation-workbench]"))'), 'evidence work before switch');
 await click('创作依据 ▾'); await poll(() => js('document.body.innerText.includes(' + JSON.stringify(state.quote) + ')'), 'evidence visible before switch');
 const other = await api('return window.ipcRenderer.spaces.create("内容证据隔离验收")'); assert.ok(other.success);
 await api('return window.ipcRenderer.spaces.switch(' + JSON.stringify(other.space.id) + ')');
 await poll(() => js('!document.body.innerText.includes(' + JSON.stringify(state.quote) + ')'), 'private evidence cleared on switch');
 const crossDetail = await api('return window.ipcRenderer.contentIntelligence.detail(' + JSON.stringify(state.opportunityId) + ')'); assert.equal(crossDetail.success,false);
 const crossWork = await api('return window.ipcRenderer.contentIntelligence.workEvidence(' + JSON.stringify(state.workspaceId) + ')'); assert.equal(crossWork.success,false);
 assert.equal((await invoke('list')).items.length,0);
 await api('return window.ipcRenderer.spaces.switch("default")');
 await fs.writeFile(path.join(root,'result.json'),JSON.stringify({mode:state.mode,workspaceId:state.workspaceId,evidenceId:state.evidenceId,sourceVersion:state.sourceVersion,originalQuoteVerified:true,legacyUnlinkedWorkReadable:true,requestRetryVerified:Boolean(state.workRequestId),crossSpaceRejected:true,blockedExternalRequests:blockedRequests,paidOrPublishActions:0},null,2));
 console.log('CONTENT_INTELLIGENCE_ELECTRON_QA_SUCCESS'); app.exit(0);
}
run().catch(async error => { console.error(error); if(window&&!window.isDestroyed()) { await fs.writeFile(path.join(root,'failure-private.png'),(await window.webContents.capturePage()).toPNG()).catch(()=>{}); await fs.writeFile(path.join(root,'failure-dom-private.txt'),await js('document.body.innerText').catch(()=>'')); } await fs.writeFile(path.join(root,'error.txt'),error.stack||String(error));app.exit(1); });
setTimeout(()=>{console.error('QA deadline');app.exit(1);},180000).unref();
`.replace('__ROOT__', JSON.stringify(root)).replace('__DESKTOP__', JSON.stringify(desktop)).replace('__INPUT__', JSON.stringify(inputPath));
    await fs.mkdir(path.join(root, 'user-data'), { recursive: true }); await fs.writeFile(path.join(root, 'runner.cjs'), runner);
    const { createServer, loadConfigFromFile } = require('vite');
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, path.join(desktop, 'vite.config.ts'));
    const flatten = async plugins => (await Promise.all(plugins.map(async plugin => { const value = await plugin; return Array.isArray(value) ? flatten(value) : value; }))).flat(Infinity).filter(Boolean);
    const plugins = (await flatten(loaded.config.plugins)).filter(plugin => plugin.name !== 'vite-plugin-electron');
    const server = await createServer({ ...loaded.config, configFile: false, root: desktop, plugins, cacheDir: path.join(root, 'vite-cache'), server: { host: '127.0.0.1', port: 0 } }); await server.listen();
    const environment = { ...process.env, VITE_DEV_SERVER_URL: server.resolvedUrls.local[0], GARDENFLOW_HOLD_AUTOMATION: '1' }; delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [path.join(root, 'runner.cjs')], { cwd: desktop, stdio: 'inherit', env: environment });
    child.on('exit', code => { process.exitCode = code ?? 1; void server.close(); }); child.on('error', error => { console.error(error); process.exitCode = 1; void server.close(); });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
