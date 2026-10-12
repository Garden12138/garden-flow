// Isolated application smoke: real main/preload/renderer and native MP4 export.
// Usage: node scripts/product-video-remix-electron-qa.cjs <temporary-root> <app-root> <create|reopen|picker> [native]
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
    // Match pnpm --dir desktop dev so Tailwind resolves its source globs correctly.
    process.chdir(desktop);
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
    if (mode === 'create') {
        const run = require('node:util').promisify(require('node:child_process').execFile);
        const ffmpeg = require('ffmpeg-static');
        for (const [index, colors] of [['red','green'],['blue','yellow']].entries()) {
            await run(ffmpeg, ['-y','-f','lavfi','-i',`color=c=${colors[0]}:s=320x240:r=${index ? 25 : 30}:d=1`,'-f','lavfi','-i',`color=c=${colors[1]}:s=320x240:r=${index ? 25 : 30}:d=3`,'-f','lavfi','-i',`sine=frequency=${index ? 880 : 440}:sample_rate=48000:duration=4`,'-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-shortest',path.join(root,`source-${index}.mp4`)]);
        }
    }
    await build({ stdin: { contents: `export { saveSettings, getWorkspacePaths, createChatSession, createAgentTask, createOrReusePendingToolApproval, getChatMessages, addChatMessage, updateChatSessionMetadata } from './electron/db';
        export { createBrandWorkspaceStore } from './electron/core/brandWorkspaceStore';
        export { ProductVideoComposeParamsSchema } from './shared/productVideoProposal';
        export { probeMediaMetadata } from './electron/core/video-auto-edit/mediaProbeService';`, resolveDir: desktop },
        outfile: path.join(root, 'seed.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external',
        define: { 'import.meta.url': JSON.stringify(`file://${desktop}/package.json`) },
        banner: { js: `module.paths.unshift(${JSON.stringify(path.join(desktop, 'node_modules'))});` },
    });
    const bootstrap = `
const { app, BrowserWindow, dialog, protocol, ipcMain } = require('electron');
const fs = require('node:fs/promises'); const path = require('node:path'); const assert = require('node:assert/strict');
const root = ${JSON.stringify(root)}; const appRoot = ${JSON.stringify(appRoot)}; const mode = ${JSON.stringify(mode)};
const nativeMode = ${native}; const stage = (nativeMode ? 'native-' : 'development-') + mode;
const sessionId = 'remix-electron-qa'; const approvalId = nativeMode ? 'remix-qa-native' : 'remix-qa-development';
const ffmpeg = ${JSON.stringify(require('ffmpeg-static'))};
const execFile = require('node:util').promisify(require('node:child_process').execFile);
process.env.GARDENFLOW_USER_DATA_DIR = path.join(root, 'user-data'); process.env.GARDENFLOW_HOLD_AUTOMATION = '1';
app.on('window-all-closed', () => {});
app.setPath('userData', process.env.GARDENFLOW_USER_DATA_DIR); app.setPath('sessionData', process.env.GARDENFLOW_USER_DATA_DIR);
app.getAppPath = () => appRoot;
protocol.registerSchemesAsPrivileged([{ scheme:'gardenflow-asset', privileges:{ standard:true, secure:true, supportFetchAPI:true, stream:true, corsEnabled:true, bypassCSP:true } }]);
protocol.registerSchemesAsPrivileged = () => {};
if (nativeMode) { Object.defineProperty(app, 'isPackaged', { value:true }); Object.defineProperty(process, 'resourcesPath', { value:path.dirname(appRoot) }); }
dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[path.join(root,'source-0.mp4'), path.join(root,'source-1.mp4')] });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(operation, description) { const until = Date.now() + 60000; while (Date.now() < until) { const value = await operation(); if (value) return value; await pause(150); } throw new Error('Timeout: ' + description); }
async function run() {
 await app.whenReady(); await fs.mkdir(process.env.GARDENFLOW_USER_DATA_DIR, { recursive:true });
 const seed = require('./seed.cjs'); seed.saveSettings({ workspace_dir:path.join(root,'workspace'), active_space_id:'default' });
 const store = seed.createBrandWorkspaceStore(() => path.join(seed.getWorkspacePaths().subjects,'brand-workspace'));
 let state = await fs.readFile(path.join(root,'state.json'),'utf8').then(JSON.parse).catch(() => null);
 if (!state) {
  const bundle = await store.upsertProduct({ name:'自有片段 · 混剪隔离验收商品', description:'合成测试片段，供来源截取与原音验证' });
  state = { productId:bundle.product.id, projects:{} };
  seed.createChatSession(sessionId, '视频混剪隔离验收', { runtimeMode:'gardenflow' });
  seed.addChatMessage({ id:'qa-user',session_id:sessionId,role:'user',content:'使用自有视频片段制作商品混剪' });
  seed.addChatMessage({ id:'qa-assistant',session_id:sessionId,role:'assistant',content:'请核对真实来源视频、截取区间和声音，再确认工程。' });
 }
 seed.updateChatSessionMetadata(sessionId,{ runtimeMode:'gardenflow',surface:'gardenflow',runtimeSurface:'gardenflow',contextType:'gardenflow',contextId:'gardenflow-singleton:default',gardenflowContext:{spaceId:'default',surface:'gardenflow',contextId:'gardenflow-singleton:default'} });
 ${native ? '/* Packaged entry continues after debugger resumes. */' : "require(path.join(appRoot,'dist-electron','main.js'));"}
 const window = await poll(async () => BrowserWindow.getAllWindows().find(window => !window.isDestroyed()), 'main window');
 window.webContents.setBackgroundThrottling(false); window.setOpacity(1); window.show(); window.focus();
 await poll(async () => window.webContents.executeJavaScript('Boolean(window.ipcRenderer && document.getElementById("root")?.childElementCount)').catch(() => false),'renderer mounted');
 const js = code => window.webContents.executeJavaScript(code,true);
 const api = code => js('(async () => { '+code+' })()');
 const click = async text => js('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === '+JSON.stringify(text)+').click(); true');
 const getProject = async () => { const result = await api('return window.ipcRenderer.videoEditorV2.getProject('+JSON.stringify({projectId:state.projects[nativeMode?'native':'development']})+');'); assert.equal(result.success,true,result.error); return result.project; };
 const skills = await api('return window.ipcRenderer.listSkills();'); assert.ok(skills.some(skill => skill.name === 'video-director' && !skill.disabled));
 if (mode === 'picker') {
  await js('window.dispatchEvent(new CustomEvent("gardenflow:navigate",{detail:{type:"gardenflow.open",action:"open-session",sessionId:'+JSON.stringify(sessionId)+'}}));true');
  await pause(800);
  await js('(()=>{const header=Array.from(document.querySelectorAll("header")).find(header=>header.textContent.includes("保存 MP4 到资产库"));if(header)header.querySelectorAll("button")[header.querySelectorAll("button").length-1].click();})()');
  await poll(async()=>js('Boolean(document.querySelector("[contenteditable=true]"))'),'chat composer');
  await js('(()=>{const editor=document.querySelector("[contenteditable=true]");editor.focus();editor.textContent="@自有片段";const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);editor.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"@自有片段"}));})()');
  await poll(async()=>js('Array.from(document.querySelectorAll("button[data-mention-option-index]")).some(button=>button.textContent.includes("混剪隔离验收商品"))'),'real product mention');
  await js('Array.from(document.querySelectorAll("button[data-mention-option-index]")).find(button=>button.textContent.includes("混剪隔离验收商品")).click();true');
  await poll(async()=>js('Array.from(document.querySelectorAll("button")).some(button=>button.textContent.trim()==="视频混剪")'),'structured remix shortcut');
  await click('视频混剪');
  await poll(async()=>js('Boolean(document.querySelector("[aria-label=选择混剪视频]"))'),'remix source picker');
  await poll(async()=>js('document.querySelector("[aria-label=选择混剪视频]").querySelectorAll("input[type=checkbox]").length>=2'),'current-space media list');
  const mediaCount=await js('document.querySelector("[aria-label=选择混剪视频]").querySelectorAll("input[type=checkbox]").length');
  await js('document.querySelector("[aria-label=选择混剪视频]").querySelector("input[type=checkbox]").click();true');
  await poll(async()=>js('Array.from(document.querySelectorAll("button")).some(button=>button.textContent.trim()==="使用所选视频"&&!button.disabled)'),'selection button enabled');
  await fs.writeFile(path.join(root,stage+'-source-picker.png'),(await window.webContents.capturePage()).toPNG());
  await click('取消'); await poll(async()=>js('!document.querySelector("[aria-label=选择混剪视频]")'),'cancel picker');
  const after=await api('return window.ipcRenderer.chat.getPendingToolConfirmation('+JSON.stringify(sessionId)+');'); assert.equal(after,null);
  await fs.writeFile(path.join(root,stage+'-result.json'),JSON.stringify({mode,nativeExecutable:nativeMode,sourceRenderer:!nativeMode,productId:state.productId,structuredShortcutVisible:true,mediaCount,selectionEnabled:true,canceledWithoutProposal:true,paidMediaRequests:0},null,2));
  console.log('VIDEO_REMIX_QA_SUCCESS '+stage); app.exit(0); return;
 }
 const projectKey = nativeMode ? 'native' : 'development';
 if (!state.projects[projectKey]) {
  assert.equal(mode,'create');
  const selection = await api('return window.ipcRenderer.videoEditorV2.selectRemixSources();'); assert.equal(selection.success,true,selection.error);
  const refs = selection.clips; assert.equal(refs.length,2); assert.equal(refs[0].fps,30); assert.equal(refs[1].fps,25); assert.ok(refs.every(ref => ref.hasAudio));
  const fromLibrary = await api('return window.ipcRenderer.videoEditorV2.selectRemixSources('+JSON.stringify({assetIds:refs.map(ref=>ref.assetId)})+');');
  assert.deepEqual(fromLibrary.clips,refs);
  const product = await store.getProductCreativeReference(state.productId);
  const proposal = seed.ProductVideoComposeParamsSchema.parse({ proposalId:approvalId,productId:product.id,productUpdatedAt:product.updatedAt,referencedProductIds:[product.id],productName:product.name,
   title:'已有视频混剪 · '+projectKey,compositionMode:'existing-clips',voiceoverEnabled:false,canvas:{width:1080,height:1920,fps:30,aspectRatio:'9:16'},durationMs:2000,
   scenes:refs.map((ref,index)=>({id:'cut-'+index,title:'片段 '+(index+1),source:'media-clip',productAssetIds:[],mediaAssetId:ref.assetId,mediaContentHash:ref.contentHash,
    sourceStartMs:index?1000:0,sourceEndMs:index?2000:1000,durationMs:1000,sourceVolume:index?0.7:0.5,fitMode:'contain-blur',motionPreset:'static',overlayText:index?'片段二 · 原音保留':'片段一 · 待调整截取'})) });
  seed.createAgentTask({id:approvalId+'-task',task_type:'foreground',status:'paused',runtime_mode:'gardenflow',owner_session_id:sessionId,
   route:{workflowKind:'product-video-compose',intent:'manuscript_creation',recommendedRole:'video-director',requiredCapabilities:['artifact-save'],requiresHumanApproval:true},
   metadata:{workflowKind:'product-video-compose',productVideoCompositionMode:'existing-clips',explicitVideoClipRefs:refs,explicitProductRefs:[{productId:product.id,name:product.name,updatedAt:product.updatedAt}]} });
  seed.createOrReusePendingToolApproval({callId:approvalId,sessionId,taskId:approvalId+'-task',toolName:'product_video_compose',proposalId:proposal.proposalId,proposalDigest:JSON.stringify(proposal),params:proposal,
   details:{type:'info',title:'确认视频混剪',description:'合成测试片段与持久方案夹具',spaceId:'default',remixSourceReferences:refs}});
  const card = await api('return window.ipcRenderer.chat.getPendingToolConfirmation('+JSON.stringify(sessionId)+');'); assert.equal(card.details.remixSourceReferences.length,2);
  await js('window.dispatchEvent(new CustomEvent("gardenflow:navigate",{detail:{type:"gardenflow.open",action:"open-session",sessionId:'+JSON.stringify(sessionId)+'}}));true');
  await poll(async()=>js('document.body.innerText.includes("确认并创建工程")'),'confirmation card');
  await poll(async()=>js('Array.from(document.querySelectorAll("video")).filter(video=>video.readyState>=2).length>=2'),'real source previews');
  await fs.writeFile(path.join(root,stage+'-confirmation.png'),(await window.webContents.capturePage()).toPNG());
  await click('确认并创建工程');
  const resolution = await poll(async()=>api('return window.ipcRenderer.chat.confirmTool('+JSON.stringify(approvalId)+',true);').then(result=>result.status==='completed'&&result),'persistent approval completion');
  assert.equal((await api('return window.ipcRenderer.chat.confirmTool('+JSON.stringify(approvalId)+',true);')).projectId,resolution.projectId);
  state.projects[projectKey] = resolution.projectId; await fs.writeFile(path.join(root,'state.json'),JSON.stringify(state,null,2));
 }
 await js('window.dispatchEvent(new CustomEvent("gardenflow:navigate",{detail:{type:"video-project.open",projectId:'+JSON.stringify(state.projects[projectKey])+'}}));true');
 await poll(async()=>js('Boolean(document.querySelector("input[aria-label=截取开始秒]"))'),'clip workbench');
 let project = await getProject();
 if (mode==='create') {
  const setInput = async (selector,value) => js('(()=>{const field=document.querySelector('+JSON.stringify(selector)+');field.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,'+JSON.stringify(value)+');field.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await setInput('input[aria-label="截取开始秒"]','1'); await setInput('input[aria-label="截取结束秒"]','2');
  await click('保存截取区间'); await poll(async()=>getProject().then(p=>p.productVideo.scenes[0].sourceStartMs===1000),'UI trim'); await pause(400);
  await setInput('input[aria-label="来源视频音量"]','0'); await js('document.querySelector("input[aria-label=来源视频音量]").dispatchEvent(new FocusEvent("focusout",{bubbles:true}));true');
  await poll(async()=>getProject().then(p=>p.productVideo.scenes[0].sourceVolume===0),'UI source volume');
  await js('(()=>{const field=Array.from(document.querySelectorAll("label")).find(label=>label.textContent.startsWith("屏幕文字")).querySelector("textarea");field.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,"已编辑中文 · 原音关闭");field.dispatchEvent(new Event("input",{bubbles:true}));field.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));})()');
  await poll(async()=>getProject().then(p=>p.productVideo.scenes[0].overlayText==='已编辑中文 · 原音关闭'),'UI text');
  const reordered = await api('return window.ipcRenderer.videoEditorV2.applyProductCommand('+JSON.stringify({projectId:project.id,command:{type:'scene.reorder',sceneId:'cut-1',targetSceneId:'cut-0',position:'before'}})+');'); assert.equal(reordered.success,true,reordered.error);
  const rendered = await api('return window.ipcRenderer.videoEditorV2.render('+JSON.stringify({projectId:project.id})+');'); assert.equal(rendered.success,true,rendered.error);
  project = rendered.project;
  state.outputs ||= {}; state.outputs[projectKey] = {outputPath:rendered.outputPath,mediaAssetId:rendered.mediaAssetId}; await fs.writeFile(path.join(root,'state.json'),JSON.stringify(state,null,2));
  assert.ok(rendered.mediaAssetId); assert.equal(project.status,'exported');
 } else {
  const previous = JSON.parse(await fs.readFile(path.join(root,(nativeMode?'native-':'development-')+'create-snapshot.json'),'utf8'));
  assert.deepEqual(project.productVideo.scenes,previous.productVideo.scenes);
  assert.deepEqual(project.timeline,previous.timeline);
  assert.deepEqual(project.renderOutputs,previous.renderOutputs);
  for (const asset of project.assets) assert.ok((await fs.stat(asset.projectPath)).size>0);
 }
 assert.equal(project.productVideo.proposal.compositionMode,'existing-clips'); assert.equal(project.productVideo.voiceoverAutoApprovedAt,undefined);
 assert.equal(project.timeline.durationMs,2000); assert.equal(project.productVideo.scenes[0].id,'cut-1');
 assert.equal(project.productVideo.scenes[1].sourceStartMs,1000); assert.equal(project.productVideo.scenes[1].sourceVolume,0);
 const output = state.outputs[projectKey];
 const probe = await seed.probeMediaMetadata(output.outputPath); assert.equal(probe.width,1080); assert.equal(probe.height,1920); assert.equal(probe.fps,30); assert.ok(Math.abs(probe.durationMs-2000)<=80); assert.equal(probe.hasAudio,true);
 const decoded = await execFile(ffmpeg,['-v','error','-i',output.outputPath,'-an','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer'}); const videoFrames=decoded.stdout.length/3; assert.equal(videoFrames,60);
 const colors=[]; for (const at of ['0.3','1.3']) { const result = await execFile(ffmpeg,['-v','error','-ss',at,'-i',output.outputPath,'-vf','crop=80:80:500:900,scale=1:1','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer'}); colors.push(Array.from(result.stdout)); }
 assert.ok(colors[0][0]>190&&colors[0][1]>190&&colors[0][2]<50,'first frame is second source yellow cut, not blue head');
 assert.ok(colors[1][0]<50&&colors[1][1]>70&&colors[1][2]<50,'second frame is first source green cut, not red head');
 const energies=[]; for (const at of ['0.2','1.2']) { const result=await execFile(ffmpeg,['-v','error','-ss',at,'-t','0.5','-i',output.outputPath,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer'}); let sum=0; for(let i=0;i<result.stdout.length;i+=4)sum+=result.stdout.readFloatLE(i)**2; energies.push(Math.sqrt(sum/(result.stdout.length/4))); }
 assert.ok(energies[0]>0.025&&energies[1]<0.0005,'unmuted original audio followed by silent edited cut');
 const media = await api('return window.ipcRenderer.media.list();'); assert.ok(media.assets.some(asset=>asset.id===output.mediaAssetId));
 await js('window.dispatchEvent(new CustomEvent("gardenflow:navigate",{detail:{type:"video-project.open",projectId:'+JSON.stringify(project.id)+'}}));true');
 await pause(1500); await fs.writeFile(path.join(root,stage+'-workbench.png'),(await window.webContents.capturePage()).toPNG());
 await fs.writeFile(path.join(root,stage+'-snapshot.json'),JSON.stringify(project,null,2));
 await fs.writeFile(path.join(root,stage+'-result.json'),JSON.stringify({mode,nativeExecutable:nativeMode,sourceRenderer:!nativeMode,productId:state.productId,projectId:project.id,
  sourceFps:[30,25],exportProbe:probe,videoFrames,sampleRgb:colors,audioRms:energies,outputPath:output.outputPath,mediaAssetId:output.mediaAssetId,directorSkillAvailable:true,
  duplicateConfirmationReused:true,reopenPreserved:mode==='reopen',paidMediaRequests:0,boundary:'Synthetic product and local color/sine sources; proposal seeded as a durable approval. Real app IPC, source previews, confirmation click, workbench trim/volume/text and MP4 render; native file picker isolated. No live planning or vision model.'},null,2));
 console.log('VIDEO_REMIX_QA_SUCCESS '+stage); app.exit(0);
}
run().catch(async error=>{ console.error(error); await fs.writeFile(path.join(root,stage+'-error.txt'),String(error.stack||error)).catch(()=>{});const window=BrowserWindow.getAllWindows()[0];if(window){await fs.writeFile(path.join(root,stage+'-failure.png'),(await window.webContents.capturePage()).toPNG()).catch(()=>{});await fs.writeFile(path.join(root,stage+'-dom.txt'),await window.webContents.executeJavaScript('document.body.innerText').catch(()=>'')).catch(()=>{});}app.exit(1);});
setTimeout(()=>{console.error('QA process deadline');app.exit(1);},240000).unref();
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
