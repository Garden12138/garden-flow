// Isolated dream-story smoke. Synthetic text server and local media only.
// Usage: node scripts/dream-story-electron-qa.cjs <temporary-root> <app-root> <create|reopen> [native]
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { build } = require('esbuild');
const WebSocket = require('ws');
const desktop = path.resolve(__dirname, '..');
const root = path.resolve(process.argv[2]);
const appRoot = path.resolve(process.argv[3] || desktop);
const mode = process.argv[4] || 'create';
const native = process.argv[5] === 'native';
const compositionMode = process.argv[6] || 'story-hybrid';
if (!['story-keyframes', 'story-video', 'story-hybrid'].includes(compositionMode)) throw new Error('Invalid QA composition mode');
if (!root.startsWith('/private/tmp/') && !root.startsWith('/tmp/')) throw new Error('QA root must be temporary');
async function prepare() {
    await fs.mkdir(root, { recursive: true });
    if (mode === 'create') { const clip = spawnSync(require('ffmpeg-static'), ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=90x160:r=30:d=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'fixture-video.mp4')]); if (clip.status !== 0) throw new Error(clip.stderr.toString()); }
    await build({ stdin: { contents: `export { saveSettings, getChatMessages } from './electron/db';
        export { readDreamStory } from './electron/core/dreamStoryStore';`, resolveDir: desktop },
        outfile: path.join(root, 'seed.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external',
        define: { 'import.meta.url': JSON.stringify(`file://${desktop}/package.json`) },
        banner: { js: `module.paths.unshift(${JSON.stringify(path.join(desktop, 'node_modules'))});` } });
    const bootstrap = `
const { app, BrowserWindow, dialog, protocol } = require('electron');
const fs = require('node:fs/promises'); const path = require('node:path'); const assert = require('node:assert/strict');
const root = ${JSON.stringify(root)}; const appRoot = ${JSON.stringify(appRoot)}; const mode = ${JSON.stringify(mode)}; const nativeMode = ${native}; const compositionMode = ${JSON.stringify(compositionMode)};
const stage = (nativeMode ? 'native-' : 'development-') + mode;
process.env.GARDENFLOW_USER_DATA_DIR = path.join(root,'user-data'); process.env.GARDENFLOW_HOLD_AUTOMATION = '1';
app.on('window-all-closed',()=>{}); app.setPath('userData', process.env.GARDENFLOW_USER_DATA_DIR); app.setPath('sessionData', process.env.GARDENFLOW_USER_DATA_DIR); app.getAppPath = () => appRoot;
protocol.registerSchemesAsPrivileged([{scheme:'gardenflow-asset',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true,bypassCSP:true}}]); protocol.registerSchemesAsPrivileged=()=>{};
if(nativeMode){Object.defineProperty(app,'isPackaged',{value:true});Object.defineProperty(process,'resourcesPath',{value:path.dirname(appRoot)});}
let pickInput, pickOutput; dialog.showOpenDialog=async()=>({canceled:false,filePaths:[pickInput]});dialog.showSaveDialog=async()=>({canceled:false,filePath:pickOutput});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function poll(fn,label){const deadline=Date.now()+120000;while(Date.now()<deadline){const value=await fn();if(value)return value;await pause(150);}throw new Error('Timeout: '+label);}
function request(project){return {spaceId:project.dreamStory.spaceId,projectId:project.id,requestId:require('node:crypto').randomUUID(),expectedRevision:project.dreamStory.revision,expectedDraftEpoch:project.dreamStory.draftEpoch,targetDigest:project.dreamStory.targetDigest};}
async function run(){
 await app.whenReady();await fs.mkdir(path.join(root,'exports'),{recursive:true});const seed=require('./seed.cjs');
 let state=await fs.readFile(path.join(root,'state.json'),'utf8').then(JSON.parse).catch(()=>null);let modelCalls=0;let phase=0;
 const server=require('node:http').createServer(async(req,res)=>{try{
  let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);modelCalls++;
  assert.deepEqual(input.tools.map(tool=>tool.function.name).sort(),['dream_story_edit','dream_story_propose','dream_story_read']);
  let message;
  if(phase++===0)message={content:'',tool_calls:[{id:'dream-read',type:'function',function:{name:'dream_story_read',arguments:JSON.stringify({_dreamTurn:{projectId:'spoofed'}})}}]};
  else {const project=await seed.readDreamStory(state.projectId);const fragment=project.dreamStory.fragments[0].id;
   const director={schemaVersion:2,settings:[{id:'sea',description:'A quiet sea beyond the elevator',referenceAssetIds:[],revision:1}],title:'The Quiet Sea',language:'en',story:'The elevator descended. A luminous key opened the door onto a quiet sea.',emotionalArc:['quiet','wonder'],preservedFragmentIds:[fragment],creativeAdditions:['A door opens slowly.'],visualStyle:'Moss green and iris ink, portrait illustration.',characters:[],
    scenes:Array.from({length:8},(_,i)=>({id:'scene_'+i,settingId:'sea',continuity:i===0?'cut':'continue',mediaType:compositionMode==='story-video'||compositionMode==='story-hybrid'&&[2,6].includes(i)?'video':'image',videoPrompt:'The key floats slowly above the sea. A gentle forward camera move.',videoReason:'A visual turning point in the dream',fragmentIds:[fragment],characterIds:[],visual:'A luminous key above a quiet sea.',narration:'The sea is waiting.',imagePrompt:'A luminous key above a quiet sea, portrait composition.',plannedDurationMs:9000,motion:'static',locked:false})),publication:{description:'A synthetic dream story about a quiet sea.',hashtags:['DreamStory']}};
   message={content:'',tool_calls:[{id:'dream-propose',type:'function',function:{name:'dream_story_propose',arguments:JSON.stringify({director,_dreamTurn:{projectId:'spoofed'}})}}]};}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message}]}));
 }catch(error){res.writeHead(500);res.end(JSON.stringify({error:String(error)}));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 seed.saveSettings({workspace_dir:path.join(root,'workspace'),active_space_id:'default',api_endpoint:'http://127.0.0.1:'+server.address().port+'/v1',api_key:'synthetic-local-only',model_name:'fixture-text',model_name_gardenflow:'fixture-text',proxy_enabled:0});
 if(!state){const fixture=new BrowserWindow({width:540,height:960,useContentSize:true,show:false,webPreferences:{offscreen:true}});
  await fixture.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html><body style="margin:0;width:540px;height:960px;background:linear-gradient(#9390bc,#344d4a);display:grid;place-items:center;color:#eee;font:40px serif">A quiet sea</body></html>'));await pause(300);
  await fs.writeFile(path.join(root,'key.png'),(await fixture.webContents.capturePage()).toPNG());fixture.destroy();
  const n=24000*2;const wav=Buffer.alloc(44+n*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)wav.writeInt16LE(Math.round(Math.sin(i*440*Math.PI*2/24000)*3000),44+i*2);await fs.writeFile(path.join(root,'voice.wav'),wav);
 }
 ${native ? '/* packaged application resumes normally */' : "require(path.join(appRoot,'dist-electron','main.js'));"}
 const win=await poll(async()=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&/index.html|localhost|127.0.0.1/.test(w.webContents.getURL())),'application window');win.webContents.setBackgroundThrottling(false);win.setSize(1600,1000);win.show();win.focus();
 const js=code=>win.webContents.executeJavaScript(code,true);await poll(async()=>js('Boolean(window.ipcRenderer&&document.getElementById("root")?.childElementCount)').catch(()=>false),'renderer mount');
 win.webContents.on('console-message',(_event,_level,message)=>{if(String(message).startsWith('DREAM_RENDER '))console.log(message);});
 await js('window.ipcRenderer.dreamStory.onRenderProgress((_event,value)=>{const p=value||_event;if(p.percent%10===0)console.log("DREAM_RENDER "+p.stage+" "+p.percent);});true');
 const api=async(method,payload)=>{const result=await js('window.ipcRenderer.dreamStory['+JSON.stringify(method)+']('+JSON.stringify(payload||{})+')');assert.ok(result.success,result.error);return result;};
 const click=async label=>{await poll(async()=>js('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==='+JSON.stringify(label)+'&&!b.disabled)'),'button '+label);return js('(()=>{const button=Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==='+JSON.stringify(label)+');button.click();return true;})()');};
 const navigate=projectId=>js('window.dispatchEvent(new CustomEvent("gardenflow:navigate",{detail:{type:"video-project.open",projectId:'+JSON.stringify(projectId)+'}}));true');
 if(mode==='create'){
  await js('window.dispatchEvent(new CustomEvent("gardenflow:navigate",{detail:{type:"dream-story.new"}}));true');
  await poll(async()=>js('Boolean(document.querySelector("[data-dream-story-workbench]"))'),'dream workbench');
  assert.equal(await js('document.querySelector("input[aria-label=目标语言]").value'),'en');
  await js('(()=>{const field=document.querySelector("textarea[aria-label=记下一个梦]");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,"合成梦境：电梯向下，钥匙发光，门后是海。");field.dispatchEvent(new Event("input",{bubbles:true}));return true;})()');
  const project=await poll(async()=>{const list=await api('list');return list.projects.find(p=>p.dreamStory.fragments[0]?.text.includes('钥匙'));},'record autosave');state={projectId:project.id};assert.equal(modelCalls,0);
  await js('(()=>{const field=document.querySelector(\"select[aria-label=梦境制作模式]\");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,\"value\").set.call(field,'+JSON.stringify(compositionMode)+');field.dispatchEvent(new Event(\"change\",{bubbles:true}));return true;})()');
  await click('确认目标并开始创作');await poll(async()=>api('read',{projectId:project.id}).then(r=>r.project.dreamStory.target&&r.project),'confirmed target');
  await poll(async()=>js('Boolean(document.querySelector("[data-dream-story-editor-chat] [contenteditable=true]"))'),'bound director chat');
  await js('(()=>{const editor=document.querySelector("[data-dream-story-editor-chat] [contenteditable=true]");editor.focus();editor.textContent="请保留意象，创作故事与八幕分镜。";const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);editor.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"请保留意象，创作故事与八幕分镜。"}));return true;})()');
  await pause(150);await js('document.querySelector("[data-dream-story-editor-chat] [contenteditable=true]").closest("form").requestSubmit();true');
  await poll(async()=>api('read',{projectId:project.id}).then(r=>r.project.dreamStory.director?.scenes.length===8&&r.project.dreamStory.storyboardAdopted),'director synchronized');assert.equal(modelCalls,2);
  await pause(500);await click('八幕分镜');
  for(let i=0;i<8;i++){let current=(await api('read',{projectId:project.id})).project;pickInput=path.join(root,'key.png');await api('importMedia',{...request(current),kind:'image',sceneId:'scene_'+i});current=(await api('read',{projectId:project.id})).project;await api('approveImage',{...request(current),sceneId:'scene_'+i});current=(await api('read',{projectId:project.id})).project;pickInput=path.join(root,'voice.wav');await api('importMedia',{...request(current),kind:'audio',sceneId:'scene_'+i});}
  for(const scene of (await api('read',{projectId:project.id})).project.dreamStory.director.scenes.filter(scene=>scene.mediaType==='video')) { let current=(await api('read',{projectId:project.id})).project;pickInput=path.join(root,'fixture-video.mp4');await api('importMedia',{...request(current),kind:'video',sceneId:scene.id});current=(await api('read',{projectId:project.id})).project;await api('approveImage',{...request(current),sceneId:scene.id,kind:'video'}); }
  await pause(2200);await click('预览与发布');await fs.writeFile(path.join(root,stage+'-workbench.png'),(await win.webContents.capturePage()).toPNG());
  for(const preview of [true,false]){const current=(await api('read',{projectId:project.id})).project;const result=await api('render',{...request(current),preview});assert.ok((await fs.stat(result.outputPath)).size>1000);state[preview?'preview':'final']=result.outputPath;}
  const current=(await api('read',{projectId:project.id})).project;pickOutput=path.join(root,'exports/story.zip');await api('export',{...request(current),format:'share',includePrivate:false});
  const version=await js('window.ipcRenderer.tiktokVideo.getVersion('+JSON.stringify({projectId:project.id})+')');assert.equal(version.version.source.kind,'dream-story');assert.equal(version.version.sourceProductId,undefined);
  const saved=await js('window.ipcRenderer.tiktokVideo.saveVersion('+JSON.stringify({versionId:version.version.id,expectedRevision:version.version.revision,title:version.version.title,description:version.version.description,hashtags:version.version.hashtags,language:'en',market:'International',publishSettings:{visibility:'only_me',allowComments:false,allowReuse:false,allowRemix:false,audience18Plus:false,commercialContent:'none',aiGenerated:true}})+')');assert.ok(saved.success,saved.error);
  const source=await js('window.ipcRenderer.publication.readSource('+JSON.stringify({source:{kind:'dream-story',projectId:project.id}})+')');assert.ok(source.success,source.error);assert.ok(!JSON.stringify(source.snapshot).includes('合成梦境：'));
  const prepared=await js('window.ipcRenderer.publication.prepare('+JSON.stringify({source:{kind:'dream-story',projectId:project.id},expectedRevision:source.snapshot.revision})+')');assert.equal(prepared.success,false);state.offlinePrepareError=prepared.error;
 }else{
  assert.ok(state?.projectId);await navigate(state.projectId);await poll(async()=>js('Boolean(document.querySelector("[data-dream-story-workbench]"))'),'reopen dream');
  const current=(await api('read',{projectId:state.projectId})).project;assert.equal(current.version,4);assert.equal(current.dreamStory.target.compositionMode,compositionMode);assert.equal(current.dreamStory.director.scenes.length,8);assert.ok(current.renderOutputs.some(output=>output.mediaAssetId));assert.equal(modelCalls,0);
  const source=await js('window.ipcRenderer.publication.readSource('+JSON.stringify({source:{kind:'dream-story',projectId:state.projectId}})+')');assert.ok(source.success,source.error);assert.equal(source.snapshot.coverCandidates.length,8);
  await click('预览与发布');await click('准备发布到 TikTok Studio');await poll(async()=>js('document.querySelector("[data-publication-panel]")?.textContent.includes("封面候选帧")'),'cover candidate panel');
  await click('第 8 幕 · 67.5 秒');await poll(async()=>js('Array.from(document.querySelectorAll("[data-publication-panel] video")).some(video=>video.readyState>=2&&!video.seeking&&Math.abs(video.currentTime-67.5)<0.1)'),'decoded final cover candidate');
 }
 await fs.writeFile(path.join(root,'state.json'),JSON.stringify(state));await fs.writeFile(path.join(root,stage+'-result.json'),JSON.stringify({mode,native,compositionMode,syntheticTextCalls:modelCalls,paidMediaCalls:0,platformUploads:0,platformSubmissions:0,...state},null,2));
 await fs.writeFile(path.join(root,stage+'-final.png'),(await win.webContents.capturePage()).toPNG());console.log('DREAM_STORY_QA_SUCCESS '+stage);server.close();app.exit(0);
}
run().catch(async error=>{console.error(error);await fs.writeFile(path.join(root,stage+'-error.txt'),String(error.stack||error)).catch(()=>{});const win=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed());if(win){await fs.writeFile(path.join(root,stage+'-failure.png'),(await win.webContents.capturePage()).toPNG()).catch(()=>{});await fs.writeFile(path.join(root,stage+'-dom.txt'),await win.webContents.executeJavaScript('document.body.innerText').catch(()=>''));}app.exit(1);});setTimeout(()=>app.exit(1),1800000).unref();
`;
    // Values in the driver are task-local paths and synthetic fixtures.
    await fs.mkdir(path.join(root, 'user-data'), { recursive: true });
    await fs.writeFile(path.join(root, 'runner.cjs'), bootstrap.replace('JSON.stringify({mode,native,', 'JSON.stringify({mode,native:nativeMode,'));
    const environment = { ...process.env, GARDENFLOW_USER_DATA_DIR: path.join(root, 'user-data'), GARDENFLOW_HOLD_AUTOMATION: '1' };
    delete environment.ELECTRON_RUN_AS_NODE;
    const renderer = native ? null : await startDevelopmentRenderer();
    if (renderer) environment.VITE_DEV_SERVER_URL = renderer.resolvedUrls.local[0]; else delete environment.VITE_DEV_SERVER_URL;
    const executable = native ? path.join(path.dirname(path.dirname(appRoot)), 'MacOS', 'GardenFlow') : require('electron');
    const child = spawn(executable, native ? ['--inspect-brk=127.0.0.1:0'] : [path.join(root, 'runner.cjs')], { cwd: native ? root : desktop, stdio: native ? ['ignore', 'inherit', 'pipe'] : 'inherit', env: environment });
    if (native) { let connected = false; child.stderr.on('data', bytes => { process.stderr.write(bytes); const url = String(bytes).match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/)?.[0]; if (!url || connected) return; connected = true; void injectNativeDriver(url, bootstrap.replace('JSON.stringify({mode,native,', 'JSON.stringify({mode,native:nativeMode,')).catch(error => { console.error(error); child.kill(); }); }); }
    child.on('error', error => { console.error(error); process.exitCode = 1; void renderer?.close(); });
    child.on('exit', code => { process.exitCode = code === null ? 1 : code; void renderer?.close(); });
}
async function startDevelopmentRenderer() {
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
prepare().catch(error => { console.error(error); process.exitCode = 1; });
