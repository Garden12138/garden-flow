// Usage: node scripts/note-card-electron-qa.cjs /private/tmp/gardenflow-note-card-qa [create|reopen]
// Real application, preload, renderer and PNG capture. Only the text provider is synthetic.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { build } = require('esbuild');
const desktop = path.resolve(__dirname, '..');
process.chdir(desktop);
const root = path.resolve(process.argv[2] || '/private/tmp/gardenflow-note-card-qa');
const mode = process.argv[3] || 'create';
if (!root.startsWith('/private/tmp/') && !root.startsWith('/tmp/')) throw new Error('QA requires a temporary directory');

async function main() {
    await fs.mkdir(root, { recursive: true });
    await fs.symlink(path.join(desktop, 'node_modules'), path.join(root, 'node_modules')).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await build({ stdin: { resolveDir: desktop, contents: `export { saveSettings, getWorkspacePaths, getChatSession, getChatMessages } from './electron/db';
        export * from './electron/core/creationWorkspaceStore'; export * from './electron/core/noteCardEditor';
        export * from './electron/core/creationSources'; export * from './electron/core/noteCardRenderService';
        export * from './electron/core/xhsMaterialZip'; export * from './shared/noteCards';` },
        outfile: path.join(root, 'seed.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external',
        define: { 'import.meta.url': JSON.stringify(`file://${desktop}/package.json`) },
        banner: { js: `module.paths.unshift(${JSON.stringify(path.join(desktop, 'node_modules'))});` },
    });
    const bootstrap = String.raw`
const { app, BrowserWindow, dialog, protocol } = require('electron');
const fs = require('node:fs/promises'); const path = require('node:path'); const assert = require('node:assert/strict');
const root = __ROOT__; const desktop = __DESKTOP__; const mode = __MODE__;
process.env.GARDENFLOW_USER_DATA_DIR = path.join(root, 'user-data'); process.env.GARDENFLOW_HOLD_AUTOMATION = '1';
app.setPath('userData', process.env.GARDENFLOW_USER_DATA_DIR); app.setPath('sessionData', process.env.GARDENFLOW_USER_DATA_DIR); app.getAppPath = () => desktop;
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'gardenflow-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } }]); protocol.registerSchemesAsPrivileged = () => {};
let outputPath = path.join(root, 'cards.zip'); dialog.showSaveDialog = async () => ({ canceled: false, filePath: outputPath }); dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(operation, label) { const until = Date.now() + 45000; while (Date.now() < until) { const result = await operation(); if (result) return result; await pause(160); } throw new Error('Timeout: ' + label); }
let seed, work, phase = 0, modelRequests = 0;
const server = require('node:http').createServer(async (req, res) => {
 try {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw || '{}'); modelRequests++;
  const names = (input.tools || []).map(tool => tool.function.name);
  assert.deepEqual(names.sort(), ['note_card_read', 'note_card_edit', 'note_card_undo', 'note_card_source_read'].sort());
  let message;
  if (phase++ === 0) message = { content: '', tool_calls: [{ id: 'read-qa', type: 'function', function: { name: 'note_card_read', arguments: JSON.stringify({ _noteCardTurn: { path: '/unbound' } }) } }] };
  else if (phase === 2) message = { content: '', tool_calls: [{ id: 'source-qa', type: 'function', function: { name: 'note_card_source_read', arguments: JSON.stringify({ sourceId: work.sourceId, offset: 0, limit: 5 }) } }] };
  else if (phase === 3) {
   const current = await seed.readNoteCard(work.native.path);
   const page = { ...seed.newCardPage('text', 'ai-page'), title: 'AI 已保存的中文卡片', blocks: [{ type: 'text', text: '从真实文章来源提炼，保留可编辑文字。', emphasis: ['可编辑'] }], sourceRefs: [{ ...current.content.creationConfig.sourceRefs[0], location: '段落 1' }] };
   const content = { ...current.content, finalTitle: '文章转卡片验证', imagePages: [page] };
   message = { content: '', tool_calls: [{ id: 'edit-qa', type: 'function', function: { name: 'note_card_edit', arguments: JSON.stringify({ content, _noteCardTurn: { path: '/unbound' } }) } }] };
  } else message = { content: '卡片已保存，文字和来源可继续编辑。' };
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } }));
 } catch(error) { console.error(error); res.writeHead(500); res.end(String(error)); }
});
async function run() {
 await app.whenReady(); await fs.mkdir(path.join(root, 'user-data'), { recursive: true });
 seed = require('./seed.cjs'); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const endpoint = 'http://127.0.0.1:' + server.address().port + '/v1';
 seed.saveSettings({ workspace_dir: path.join(root, 'workspace'), active_space_id: 'default', api_endpoint: endpoint, api_key: 'synthetic-local-only', model_name: 'fixture-text', model_name_gardenflow: 'fixture-text', proxy_enabled: 0 });
 const originalFetch = global.fetch; global.fetch = (url, ...args) => { if (!String(url).startsWith('http://127.0.0.1:')) throw new Error('External network forbidden in QA'); return originalFetch(url, ...args); };
 work = await fs.readFile(path.join(root, 'state.json'), 'utf8').then(JSON.parse).catch(() => null);
 if (!work) {
  const uploads = path.join(seed.getWorkspacePaths().gardenflow, 'uploads'); await fs.mkdir(uploads, { recursive: true }); const articlePath = path.join(uploads, '真实文章.md'); await fs.writeFile(articlePath, '真实文章来源：每次修改后都应保存，并保留依据。\n\n第二段：文字可以直接编辑。');
  const source = await seed.importCreationSource({ kind: 'attachment', path: articlePath });
  work = await seed.startCreationWorkspace({ platform: 'xiaohongshu', capability: 'note-image', presetId: 'article', sourceRefs: [{ id: source.id, version: source.version, name: source.name }], requestId: 'electron-qa-work' });
  work.sourceId = source.id; await fs.writeFile(path.join(root, 'state.json'), JSON.stringify(work));
 }
 // Genuine DOCX and PDF extraction exercise the packaged parser boundary.
 const docx = path.join(seed.getWorkspacePaths().gardenflow, 'uploads', 'source.docx'); await fs.mkdir(path.dirname(docx), { recursive: true });
 await seed.writeXhsMaterialZip(docx, [{ name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' }, { name: '_rels/.rels', content: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' }, { name: 'word/document.xml', content: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>真实中文 Word 原文</w:t></w:r></w:p></w:body></w:document>' }], []);
 const parsedDocx = await seed.importCreationSource({ kind: 'attachment', path: docx }); assert.equal(parsedDocx.status, 'ready', parsedDocx.error); assert.ok(parsedDocx.segments[0].text.includes('真实中文'));
 const pdfWindow = new BrowserWindow({ show: false }); await pdfWindow.loadURL('data:text/html,<h1>Actual PDF source</h1><p>Verified source text</p>'); const pdf = await pdfWindow.webContents.printToPDF({}); pdfWindow.destroy();
 const pdfPath = path.join(seed.getWorkspacePaths().gardenflow, 'uploads', 'source.pdf'); await fs.writeFile(pdfPath, pdf);
 const parsedPdf = await seed.parseCreationSource(pdf, '.pdf'); assert.equal(parsedPdf.status, 'ready', parsedPdf.error); assert.ok(parsedPdf.segments.some(segment => segment.text.includes('Verified')));
 require(path.join(desktop, 'dist-electron/main.js'));
 const window = await poll(async () => BrowserWindow.getAllWindows().find(window => !window.isDestroyed()), 'application window'); window.webContents.setBackgroundThrottling(false);
 const js = code => window.webContents.executeJavaScript(code, true); const api = code => js('(async()=>{' + code + '})()');
 await poll(async () => js('Boolean(window.ipcRenderer && document.getElementById("root")?.childElementCount)').catch(() => false), 'renderer');
 const mainPdf = await api('return window.ipcRenderer.noteCard.importSource(' + JSON.stringify({ kind: 'attachment', path: pdfPath }) + ')'); assert.equal(mainPdf.result?.status, 'ready', JSON.stringify(mainPdf));
 const mainDocx = await api('return window.ipcRenderer.noteCard.importSource(' + JSON.stringify({ kind: 'attachment', path: docx }) + ')'); assert.equal(mainDocx.result?.status, 'ready', JSON.stringify(mainDocx));
 await js('window.dispatchEvent(new CustomEvent("gardenflow:navigate",{ detail:{type:"creation.open",workspaceId:' + JSON.stringify(work.id) + '} }));true');
 await poll(async () => js('Boolean(document.querySelector("[data-creation-workbench]"))'), 'card workbench');
 const click = label => js('Array.from(document.querySelectorAll("button")).find(button=>button.textContent.trim()===' + JSON.stringify(label) + ')?.click();true');
 if (mode === 'create') {
  await click('生成初稿 · 文本模型');
  await poll(async () => (await seed.readNoteCard(work.native.path)).content.imagePages.some(page => page.id === 'ai-page'), 'saved AI draft');
  await poll(async () => js('Boolean(document.querySelector("input[aria-label=页面标题]"))'), 'page field');
  await js('const field=document.querySelector("input[aria-label=页面标题]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,"手动修改中文标题");field.dispatchEvent(new Event("input",{bubbles:true}));true');
  await poll(async () => (await seed.readNoteCard(work.native.path)).content.imagePages[0].title === '手动修改中文标题', 'manual autosave');
 } else assert.equal((await seed.readNoteCard(work.native.path)).content.imagePages[0].title, '手动修改中文标题');
 for (const width of [960, 1200, 1440]) for (const dark of [false, true]) {
  window.setSize(width, 940); await api('const theme = await import("/src/config/theme.ts"); theme.applyAppTheme(' + JSON.stringify(dark ? 'dark' : 'light') + '); return true;'); await pause(350);
  assert.equal(await js('document.querySelector("[data-creation-workbench]").getAttribute("data-creation-narrow")'), String(width < 1000));
  assert.equal(await js('getComputedStyle(document.querySelector("[data-creation-workbench]")).display'), 'flex', 'Tailwind styles must load');
  if (width >= 1000) { await poll(async () => js('document.querySelector("iframe[title=卡片排版预览]")?.getBoundingClientRect().width > 200 && document.querySelector("iframe[title=卡片排版预览]")?.contentDocument?.querySelector("h1")?.textContent.includes("中文")'), 'visible card preview after resizing'); }
  if (width < 1000 && dark) { await click('查看预览'); await pause(350); await poll(async () => js('document.querySelector("iframe[title=卡片排版预览]")?.getBoundingClientRect().width > 200'), 'narrow preview switch'); }
  if (width >= 1000 || dark) { await poll(async () => js('document.querySelector("iframe[title=卡片排版预览]")?.contentDocument?.querySelector("h1")?.textContent.includes("中文")'), 'preview text loaded'); await api('const frame=document.querySelector("iframe[title=卡片排版预览]");await frame.contentDocument.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;'); await pause(300); }
  await fs.writeFile(path.join(root, mode + '-' + width + '-' + (dark ? 'dark' : 'light') + '.png'), (await window.webContents.capturePage()).toPNG());
 }
 seed.saveSettings({ api_key: '', image_api_key: '', api_endpoint: '' }); const requestsBeforeLocal = modelRequests;
 const current = await seed.readNoteCard(work.native.path);
 const pageId = current.content.imagePages[0].id;
 outputPath = path.join(root, mode + '.png');
 const pngResult = await api('return window.ipcRenderer.noteCard.export(' + JSON.stringify({ path: current.relativePath, expectedRevision: current.version, format: 'png', pageId }) + ')'); assert.ok(pngResult.result?.complete, JSON.stringify(pngResult));
 const png = require('electron').nativeImage.createFromPath(outputPath); assert.deepEqual(png.getSize(), { width: 1440, height: 1920 });
 outputPath = path.join(root, mode + '.zip'); const zipResult = await api('return window.ipcRenderer.noteCard.export(' + JSON.stringify({ path: current.relativePath, expectedRevision: current.version, format: 'zip' }) + ')'); assert.ok(zipResult.result?.complete, JSON.stringify(zipResult));
 assert.ok((await fs.stat(outputPath)).size > 0);
 // All six templates and overflow validation use the actual shared offscreen renderer.
 for (const layout of ['cover', 'text', 'split', 'comparison', 'steps', 'checklist']) {
  const page = seed.newCardPage(layout, layout); page.title = '中文排版 · ' + layout;
  if (layout === 'steps') page.blocks = [{ type: 'steps', items: [{ id: 'one', title: '准备', text: '确认资料' }, { id: 'two', title: '完成', text: '保存作品' }] }];
  if (layout === 'comparison') page.blocks = [{ type: 'comparison', columns: ['之前', '之后'], rows: [{ label: '文字', left: '不可修改', right: '可以编辑' }] }];
  if (layout === 'checklist') page.blocks = [{ type: 'checklist', items: ['保留来源', '检查排版'], closing: '完成后导出' }];
  const testWork = await seed.startCreationWorkspace({ platform: 'xiaohongshu', capability: 'note-image', requestId: 'template-' + mode + '-' + layout }); const blank = await seed.readNoteCard(testWork.native.path);
  const saved = await seed.noteCardMutation(await seed.noteCardTurn(testWork.native.path), 'save', { ...blank.content, imagePages: [page] });
  const result = await seed.exportNoteCards({ path: saved.relativePath, expectedRevision: saved.version, format: 'png', pageId: page.id, outputPath: path.join(root, mode + '-template-' + layout + '.png') }); assert.ok(result.complete, JSON.stringify(result));
 }
 const overflowWork = await seed.startCreationWorkspace({ platform: 'xiaohongshu', capability: 'note-image', requestId: 'overflow-' + mode });
 const overflowBlank = await seed.readNoteCard(overflowWork.native.path); const overflowPage = { ...seed.newCardPage('text', 'overflow'), title: '长文溢出检查', blocks: [{ type: 'text', text: '中文长文'.repeat(1000), emphasis: [] }] };
 const overflowSaved = await seed.noteCardMutation(await seed.noteCardTurn(overflowWork.native.path), 'save', { ...overflowBlank.content, imagePages: [overflowPage] });
 const overflowResult = await seed.exportNoteCards({ path: overflowSaved.relativePath, expectedRevision: overflowSaved.version, format: 'png', pageId: 'overflow', outputPath: path.join(root, 'overflow.png') }); assert.equal(overflowResult.complete, false); assert.ok(overflowResult.failures[0].error.includes('文字超出排版区域'));
 assert.equal(modelRequests, requestsBeforeLocal, 'local editing and export must not call a model');
 await fs.writeFile(path.join(root, mode + '-result.json'), JSON.stringify({ modelRequests, genuineDocx: parsedDocx.status, genuinePdf: parsedPdf.status, pngSize: png.getSize(), sessionId: work.sessionId, workspaceId: work.id }, null, 2));
 console.log('NOTE_CARD_ELECTRON_QA_SUCCESS ' + mode); server.close(); app.exit(0);
}
run().catch(async error => { console.error(error); await fs.writeFile(path.join(root, mode + '-error.txt'), error.stack || String(error)).catch(()=>{}); const window=BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()); if(window) { await fs.writeFile(path.join(root,mode+'-failure.png'),(await window.webContents.capturePage()).toPNG()).catch(()=>{}); await fs.writeFile(path.join(root,mode+'-dom.txt'),await window.webContents.executeJavaScript('document.body.innerText').catch(()=>'')); } app.exit(1); });
setTimeout(()=>{ console.error('QA deadline'); app.exit(1); }, 240000).unref();
`.replace('__ROOT__', JSON.stringify(root)).replace('__DESKTOP__', JSON.stringify(desktop)).replace('__MODE__', JSON.stringify(mode));
    await fs.mkdir(path.join(root, 'user-data'), { recursive: true }); await fs.writeFile(path.join(root, 'runner.cjs'), bootstrap);
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
