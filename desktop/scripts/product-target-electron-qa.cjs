// Isolated application smoke: real main/preload/renderer and native PNG export.
// Usage: node scripts/product-target-electron-qa.cjs <temporary-root> <app-root> <create|reopen> [native]
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
    await build({ stdin: { contents: `export { saveSettings, getWorkspacePaths, createChatSession, getChatSession, createAgentTask, createOrReusePendingToolApproval, addChatMessage } from './electron/db';
        export { createBrandWorkspaceStore } from './electron/core/brandWorkspaceStore';
        export { ProductVideoComposeParamsSchema } from './shared/productVideoProposal';
        export { ProductImageSetProposalSchema } from './shared/productImageSet';
        export { resolveProductCreationTarget } from './shared/productCreationTarget';
`, resolveDir: desktop },
        outfile: path.join(root, 'seed.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external',
        define: { 'import.meta.url': JSON.stringify(`file://${desktop}/package.json`) },
        banner: { js: `module.paths.unshift(${JSON.stringify(path.join(desktop, 'node_modules'))});` },
    });
    const bootstrap = `
const { app, BrowserWindow, dialog, protocol, ipcMain } = require('electron');
const fs = require('node:fs/promises'); const path = require('node:path'); const assert = require('node:assert/strict');
const root = ${JSON.stringify(root)}; const appRoot = ${JSON.stringify(appRoot)}; const mode = ${JSON.stringify(mode)}; const nativeMode = ${native};
const stage = (nativeMode ? 'native-' : 'development-') + mode;
const handlers = new Map(); const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => { handlers.set(channel, listener); return register(channel, listener); };
process.env.GARDENFLOW_USER_DATA_DIR = path.join(root, 'user-data'); process.env.GARDENFLOW_HOLD_AUTOMATION = '1';
app.on('window-all-closed', () => {}); app.setPath('userData', process.env.GARDENFLOW_USER_DATA_DIR); app.setPath('sessionData', process.env.GARDENFLOW_USER_DATA_DIR); app.getAppPath = () => appRoot;
protocol.registerSchemesAsPrivileged([{ scheme:'gardenflow-asset', privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true,bypassCSP:true} }]); protocol.registerSchemesAsPrivileged = () => {};
if (nativeMode) { Object.defineProperty(app,'isPackaged',{value:true}); Object.defineProperty(process,'resourcesPath',{value:path.dirname(appRoot)}); }
let pickerOutput; dialog.showSaveDialog = async () => ({canceled:false,filePath:pickerOutput}); dialog.showOpenDialog = async () => ({canceled:false,filePaths:[path.join(root,'exports')]});
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
async function poll(fn,label) { const until=Date.now()+90000;while(Date.now()<until){const value=await fn();if(value)return value;await pause(150);}throw new Error('Timeout: '+label); }
async function run() {
 await app.whenReady(); await fs.mkdir(path.join(root,'exports'),{recursive:true});
 const seed=require('./seed.cjs'); seed.saveSettings({workspace_dir:path.join(root,'workspace'),active_space_id:'default'});
 let state=await fs.readFile(path.join(root,'state.json'),'utf8').then(JSON.parse).catch(()=>null);
 if(!state){
  const fixture=new BrowserWindow({width:600,height:800,useContentSize:true,show:false,webPreferences:{offscreen:true}});
  await fixture.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html><body style="margin:0;background:#ecdfcc"><svg width="600" height="800"><rect x="180" y="200" width="240" height="420" rx="35" fill="#ab4934"/><rect x="220" y="320" width="160" height="180" rx="15" fill="#fff8ee"/><circle cx="300" cy="410" r="45" fill="#f8aa45"/></svg></body></html>')); await pause(200);
  const picture=(await fixture.webContents.capturePage()).toPNG(); fixture.destroy(); await fs.writeFile(path.join(root,'product.png'),picture);
  const store=seed.createBrandWorkspaceStore(()=>path.join(seed.getWorkspacePaths().subjects,'brand-workspace'));
  const bundle=await store.upsertProduct({name:'阶段八目标隔离商品',description:'仅用于本地模拟规划验收',images:[{dataUrl:'data:image/png;base64,'+picture.toString('base64')} ]});
  const product=await store.getProductCreativeReference(bundle.product.id);state={product,projects:{},baseline:{}};await fs.writeFile(path.join(root,'state.json'),JSON.stringify(state));
 }
 ${native ? "/* packaged main resumes normally */" : "require(path.join(appRoot, 'dist-electron', 'main.js'));"}
 const window=await poll(async()=>BrowserWindow.getAllWindows().find(win=>!win.isDestroyed()&&(win.webContents.getURL().includes('index.html')||win.webContents.getURL().startsWith('http://127.0.0.1:'))),'main window');
 window.webContents.setBackgroundThrottling(false);window.show();window.focus();
 await poll(async()=>window.webContents.executeJavaScript('Boolean(window.ipcRenderer&&document.getElementById("root")?.childElementCount)').catch(()=>false),'renderer mount');
 const js=code=>window.webContents.executeJavaScript(code,true);const api=code=>js('(async()=>{'+code+'})()');
 const call=async(channel,payload)=>{assert.ok(handlers.has(channel),channel);return handlers.get(channel)({sender:window.webContents},payload);};
 const click=async label=>js('(()=>{const button=Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==='+JSON.stringify(label)+');if(!button)throw new Error("Missing button");button.click();return true;})()');
 const setField=async(selector,value,tag='HTMLInputElement')=>js('(()=>{const field=document.querySelector('+JSON.stringify(selector)+');if(!field)throw new Error("Missing field");field.focus();Object.getOwnPropertyDescriptor('+tag+'.prototype,"value").set.call(field,'+JSON.stringify(value)+');field.dispatchEvent(new Event("input",{bubbles:true}));field.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
 const navigate=async detail=>{await js('window.dispatchEvent(new CustomEvent("gardenflow:navigate",{detail:'+JSON.stringify(detail)+'}));true');await pause(350);};
 const capabilities=await api('return window.ipcRenderer.videoEditorV2.getProductCapabilities();');assert.equal(capabilities.success,true);assert.equal(capabilities.capabilities.filter(c=>c.creation).length,4);assert.equal(capabilities.profiles.length,5);
 const publisherPlugin=await poll(async()=>call('plugin:xhs-publisher-status').then(status=>status.exported&&status),'bundled three-platform publisher ready');
 const counters={image:0,video:0,voice:0};for(const [channel,kind] of [['manuscripts:generate-product-image-page','image'],['videoEditorV2:retry-product-scene','video'],['videoEditorV2:generate-product-voiceover','voice']]){ipcMain.removeHandler(channel);ipcMain.handle(channel,()=>{counters[kind]++;throw new Error('Unexpected paid generation');});}
 const product=state.product;const variants=nativeMode?'native':'development';const selections=[];
 if(mode==='create'){
  const pickerSession='target-picker-'+variants;if(!seed.getChatSession(pickerSession))seed.createChatSession(pickerSession,'目标选择验收',{runtimeMode:'gardenflow',surface:'gardenflow',contextType:'gardenflow',contextId:'gardenflow-singleton:default'});
  await navigate({type:'gardenflow.open',action:'open-session',sessionId:pickerSession});
  await poll(async()=>js('Boolean(document.querySelector("[contenteditable=true]"))'),'composer');
  await js('(()=>{const editor=document.querySelector("[contenteditable=true]");editor.focus();editor.textContent="@阶段八";const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);editor.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"@阶段八"}));})()');
  await poll(async()=>js('Array.from(document.querySelectorAll("button[data-mention-option-index]")).some(b=>b.textContent.includes("阶段八目标隔离商品"))'),'product mention');await js('Array.from(document.querySelectorAll("button[data-mention-option-index]")).find(b=>b.textContent.includes("阶段八目标隔离商品")).click();true');
  await poll(async()=>js('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="商品创作")'),'product shortcut');
  const original=handlers.get('chat:send-message');ipcMain.removeHandler('chat:send-message');ipcMain.handle('chat:send-message',(_event,payload)=>{selections.push(payload.taskHints.creationTarget);return {accepted:false,sessionId:payload.sessionId,runId:'',userMessageId:'',assistantMessageId:'',error:'QA: target captured; planning fixture follows'};});
  await click('商品创作');await poll(async()=>js('Boolean(document.querySelector("[aria-label=选择商品创作目标]"))'),'target dialog');
  assert.equal(await js('document.querySelector("input[aria-label=目标时长]").value'),'15');await click('取消');assert.equal(selections.length,0);
  await click('商品创作');await poll(async()=>js('Boolean(document.querySelector("select[aria-label=目标平台]"))'),'reopen selector');
  await setField('select[aria-label=目标平台]','tiktok','HTMLSelectElement');await pause(100);assert.equal(await js('document.querySelector("input[aria-label=目标语言]").value'),'en');
  await setField('select[aria-label=内容形式]','image-set','HTMLSelectElement');await pause(100);assert.equal(await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="按此目标规划").disabled'),true);
  await fs.writeFile(path.join(root,stage+'-unsupported.png'),(await window.webContents.capturePage()).toPNG());await setField('select[aria-label=内容形式]','video','HTMLSelectElement');await setField('input[aria-label=目标时长]','1');await setField('textarea[aria-label=创作要求]','Original product details','HTMLTextAreaElement');await click('按此目标规划');await poll(async()=>selections.length===1,'structured target submission');assert.equal(selections[0].platform,'tiktok');
  ipcMain.removeHandler('chat:send-message');ipcMain.handle('chat:send-message',original);
 }
 const cases=[['xiaohongshu','9:16'],['douyin','9:16'],['tiktok','9:16'],['xiaohongshu','16:9'],['xiaohongshu','3:4']];const results=[];
 for(const [platform,ratio] of cases){
  const kind=ratio==='3:4'?'image-set':'video';const key=variants+'-'+platform+'-'+ratio.replace(':','-');const sessionId='session-'+key;const callId='approval-'+key;const proposalId='proposal-'+key;
  if(mode==='create'&&!state.projects[key]){
   const target=seed.resolveProductCreationTarget({platform,contentKind:kind,aspectRatio:ratio});
   const params=kind==='video'?seed.ProductVideoComposeParamsSchema.parse({version:1,creationTarget:target,publicationCopy:{title:platform==='tiktok'?'Product details':'商品原图资料',description:platform==='tiktok'?'Original photos and local editable text.':'商品原图与本地文字排版验收。',hashtags:['product']},proposalId,productId:product.id,referencedProductIds:[product.id],productUpdatedAt:product.updatedAt,productName:product.name,title:'目标平台验收',canvas:{width:target.spec.width,height:target.spec.height,fps:30,aspectRatio:ratio},durationMs:1000,voiceoverEnabled:false,scenes:[{id:'scene-0',title:'原图展示',durationMs:1000,source:'product-asset',productAssetIds:[product.assets[0].id],overlayText:platform==='tiktok'?'Original product':'商品原图',fitMode:'contain-blur',motionPreset:'static'}]})
    :seed.ProductImageSetProposalSchema.parse({creationTarget:target,proposalId,productId:product.id,productUpdatedAt:product.updatedAt,productName:product.name,finalTitle:'原图商品套图',body:'本地模板排版验收。',hashtags:['product'],pages:Array.from({length:5},(_,i)=>({id:'page-'+i,role:i?'content':'cover',title:'商品原图 '+(i+1),copy:'中文文字与原图展示',layout:i===0?'cover':i===4?'grid':'split',productAssetIds:[product.assets[0].id]}))});
   seed.createChatSession(sessionId,'目标作品验收 '+platform,{runtimeMode:'gardenflow',surface:'gardenflow',contextType:'gardenflow',contextId:'gardenflow-singleton:default'});
   const workflowKind=kind==='video'?'product-video-compose':'product-image-set-compose';const toolName=kind==='video'?'product_video_compose':'product_image_set_compose';
   seed.createAgentTask({id:'task-'+key,task_type:'foreground',status:'paused',runtime_mode:'gardenflow',owner_session_id:sessionId,route:{workflowKind,intent:kind==='video'?'video_creation':'manuscript_creation',recommendedRole:'video-director',requiredCapabilities:['artifact-save'],requiresHumanApproval:true},metadata:{workflowKind,creationTarget:target,explicitProductRefs:[{productId:product.id,name:product.name,updatedAt:product.updatedAt}],productAssetVisualGrounding:{status:'verified',productId:product.id,productUpdatedAt:product.updatedAt,imageCount:1,assets:[{assetId:product.assets[0].id,visibleText:[],suitability:'safe'}]}}});
   const details={type:'info',title:'确认目标作品 · '+platform,description:platform+' · '+ratio+' · '+target.language+' · '+(params.publicationCopy?.description || params.body),impact:'确认后复制原图并创建独立工程，不提交付费媒体。',requiresUserAcknowledgement:true};seed.createOrReusePendingToolApproval({callId,sessionId,taskId:'task-'+key,toolName,proposalId,proposalDigest:JSON.stringify(params),params,details:{...details,spaceId:'default'}});
   seed.addChatMessage({id:'user-'+key,session_id:sessionId,role:'user',content:'按已选平台创作商品作品'});seed.addChatMessage({id:'assistant-'+key,session_id:sessionId,role:'assistant',content:'请核对目标规格与方案。'});
   await navigate({type:'gardenflow.open',action:'open-session',sessionId});const confirmLabel=kind==='video'?'确认并创建工程':'确认并创建套图';await poll(async()=>js('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==='+JSON.stringify(confirmLabel)+')'),'approval card');
   await fs.writeFile(path.join(root,key+'-confirmation.png'),(await window.webContents.capturePage()).toPNG());await click(confirmLabel);
   const resolution=await poll(async()=>api('return window.ipcRenderer.chat.confirmTool('+JSON.stringify(callId)+',true);').then(r=>r.status==='completed'&&r),'approval completion');state.projects[key]=resolution.projectId;await fs.writeFile(path.join(root,'state.json'),JSON.stringify(state));
  }
  assert.ok(state.projects[key],key);
  if(kind==='video'){
   await navigate({type:'video-project.open',projectId:state.projects[key]});await poll(async()=>js('Boolean(document.querySelector("[data-product-platform-versions]"))'),'video workbench');
   let read=await api('return window.ipcRenderer.videoEditorV2.getProject('+JSON.stringify({projectId:state.projects[key]})+');');assert.equal(read.project.creationTarget.platform,platform);assert.equal(read.project.workVersion.publicationBinding.platform,platform);assert.equal(read.project.canvas.aspectRatio,ratio);
   if(mode==='create'){
    window.focus();await pause(300);
    await js('(()=>{const field=Array.from(document.querySelectorAll("textarea")).find(x=>x.closest("label")?.textContent.includes("屏幕文字"));field.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,'+JSON.stringify(platform==='tiktok'?'Edited local text':'已编辑本地文字')+');field.dispatchEvent(new Event("input",{bubbles:true}));field.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));return true;})()');
    await poll(async()=>api('return window.ipcRenderer.videoEditorV2.getProject('+JSON.stringify({projectId:state.projects[key]})+');').then(r=>r.project.productVideo.scenes[0].overlayText===(platform==='tiktok'?'Edited local text':'已编辑本地文字')),'saved local text');
    pickerOutput=path.join(root,'exports',key+'.mp4');const render=await api('return window.ipcRenderer.videoEditorV2.render('+JSON.stringify({projectId:state.projects[key],outputPath:pickerOutput,renderVideo:true})+');');assert.equal(render.success,true,render.error);
    read=await api('return window.ipcRenderer.videoEditorV2.getProject('+JSON.stringify({projectId:state.projects[key]})+');');state.baseline[key]={target:read.project.creationTarget,timeline:read.project.timeline,workVersion:read.project.workVersion,renderOutputs:read.project.renderOutputs};
   }else{for(const field of ['target','timeline','workVersion','renderOutputs'])assert.equal(JSON.stringify(field==='target'?read.project.creationTarget:read.project[field]),JSON.stringify(state.baseline[key][field]));}
   await pause(300);
   const layout=await poll(async()=>js('(()=>{const text='+JSON.stringify(platform==='tiktok'?'Edited local text':'已编辑本地文字')+';const overlay=Array.from(document.querySelectorAll("div")).find(node=>node.childElementCount===0&&node.textContent===text&&node.parentElement?.style.pointerEvents==="none");if(!overlay)return null;const style=getComputedStyle(overlay.parentElement);return {width:style.width,height:style.height,top:style.top,right:style.right,bottom:style.bottom,left:style.left};})()'),'preview subtitle layout');
   const spec=read.project.creationTarget.spec;assert.equal(Number.parseFloat(layout.width),spec.width-spec.safeInsets.left-spec.safeInsets.right);assert.equal(Number.parseFloat(layout.height),spec.height-spec.safeInsets.top-spec.safeInsets.bottom);assert.equal(Number.parseFloat(layout.bottom),spec.safeInsets.bottom);
   await fs.writeFile(path.join(root,key+'-workbench.png'),(await window.webContents.capturePage()).toPNG());
   results.push({platform,contentKind:kind,aspectRatio:ratio,projectId:read.project.id,output:read.project.renderOutputs[0].path,mediaAssetId:read.project.renderOutputs[0].mediaAssetId,safeInsets:read.project.creationTarget.spec.safeInsets});
  }else{
   await navigate({type:'manuscript.open',manuscriptPath:state.projects[key]});await poll(async()=>js('Boolean(document.querySelector("iframe[title=商品套图页面预览]"))'),'image workbench');await poll(async()=>js('document.querySelector("iframe[title=商品套图页面预览]")?.contentDocument?.querySelector("h1")?.innerText'),'font preview');
   let note=await api('return window.ipcRenderer.manuscripts.getXhsNote('+JSON.stringify(state.projects[key])+');');
   if(mode==='create'){
    const doc=structuredClone(note.document);doc.productImageSet.pages[0].title='已编辑的商品封面';const saved=await api('return window.ipcRenderer.manuscripts.saveXhsNote('+JSON.stringify({path:state.projects[key],expectedRevision:note.version,document:doc})+');');assert.equal(saved.success,true,saved.error);
    pickerOutput=path.join(root,'exports',key+'.zip');const exported=await api('return window.ipcRenderer.manuscripts.exportProductImageSet('+JSON.stringify({path:state.projects[key],expectedRevision:saved.version,format:'zip'})+');');assert.equal(exported.success,true,exported.error);
    note=await api('return window.ipcRenderer.manuscripts.getXhsNote('+JSON.stringify(state.projects[key])+');');state.baseline[key]=note.document;
   }else assert.equal(JSON.stringify(note.document),JSON.stringify(state.baseline[key]));
   await fs.writeFile(path.join(root,key+'-workbench.png'),(await window.webContents.capturePage()).toPNG());results.push({platform,contentKind:kind,projectId:state.projects[key],pages:note.document.productImageSet.pages.length,output:path.join(root,'exports',key+'.zip'),mediaAssetIds:note.document.mediaSlots.map(s=>s.assetId)});
  }
 }
 state.copies ||= {};
 const sourceKey=variants+'-xiaohongshu-16-9';
 if(mode==='create'){
  const sourceId=state.projects[sourceKey];await navigate({type:'video-project.open',projectId:sourceId});await poll(async()=>js('Boolean(document.querySelector("[data-product-platform-versions]"))'),'source version toolbar');
  const source=await api('return window.ipcRenderer.videoEditorV2.getProject('+JSON.stringify({projectId:sourceId})+');');const sourceBytes=await fs.readFile(path.join(source.project.projectDir,'project.json'),'utf8');
  await click('创建其他平台版本');await poll(async()=>js('Boolean(document.querySelector("select[aria-label=目标平台]"))'),'copy target selector');await setField('select[aria-label=目标平台]','tiktok','HTMLSelectElement');await click('创建平台版本');
  const copy=await poll(async()=>api('return window.ipcRenderer.videoEditorV2.listProductVariants('+JSON.stringify({projectId:sourceId})+');').then(r=>r.variants?.find(v=>v.workVersion?.sourceVersionId===sourceId&&v.target?.platform==='tiktok')),'independent target version');
  await poll(async()=>js('document.querySelector("[data-product-platform-versions]")?.textContent.includes("副本保留")'),'copy review state');
  await js('(()=>{const field=Array.from(document.querySelectorAll("textarea")).find(x=>x.closest("label")?.textContent.includes("屏幕文字"));field.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,"Independent target caption");field.dispatchEvent(new Event("input",{bubbles:true}));field.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));return true;})()');
  const edited=await poll(async()=>api('return window.ipcRenderer.videoEditorV2.getProject('+JSON.stringify({projectId:copy.projectId})+');').then(r=>r.project.productVideo.scenes[0].overlayText==='Independent target caption'&&r),'copy local edit');
  assert.equal(edited.project.renderOutputs.length,0);assert.equal(edited.project.workVersion.copyReviewRequired,true);assert.equal(edited.project.canvas.aspectRatio,'9:16');assert.equal(edited.project.productVideo.proposal.canvas.width,1080);assert.equal(edited.project.productVideo.proposal.canvas.height,1920);assert.equal(await fs.readFile(path.join(source.project.projectDir,'project.json'),'utf8'),sourceBytes);
  state.copies[variants]={projectId:copy.projectId,workVersion:edited.project.workVersion,timeline:edited.project.timeline};
  await fs.writeFile(path.join(root,stage+'-copy.png'),(await window.webContents.capturePage()).toPNG());
 }else{
  const copy=state.copies[variants];assert.ok(copy);const reopened=await api('return window.ipcRenderer.videoEditorV2.getProject('+JSON.stringify({projectId:copy.projectId})+');');assert.equal(JSON.stringify(reopened.project.timeline),JSON.stringify(copy.timeline));assert.equal(JSON.stringify(reopened.project.workVersion),JSON.stringify(copy.workVersion));
 }
 await fs.writeFile(path.join(root,'state.json'),JSON.stringify(state));assert.deepEqual(counters,{image:0,video:0,voice:0});
 await fs.writeFile(path.join(root,stage+'-result.json'),JSON.stringify({mode,nativeExecutable:nativeMode,sourceRenderer:!nativeMode,modelPlanning:'fixture',realModelRequests:0,paidMediaRequests:counters,bundledPublisherReady:Boolean(publisherPlugin.exported),...(mode==='create'?{selectorCancelMakesNoRequest:true,unsupportedImageTargetBlocked:true,selectedTargets:selections}:{}),results},null,2));console.log('PRODUCT_TARGET_QA_SUCCESS '+stage);app.exit(0);
}
run().catch(async error=>{console.error(error);await fs.writeFile(path.join(root,stage+'-error.txt'),String(error.stack||error)).catch(()=>{});const win=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed());if(win){await fs.writeFile(path.join(root,stage+'-failure.png'),(await win.webContents.capturePage()).toPNG()).catch(()=>{});await fs.writeFile(path.join(root,stage+'-dom.txt'),await win.webContents.executeJavaScript('document.body.innerText').catch(()=>''));}app.exit(1);});
setTimeout(()=>{console.error('QA deadline');app.exit(1);},420000).unref();
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
