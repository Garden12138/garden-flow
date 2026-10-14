// Isolated application smoke: real main/preload/renderer and native PNG export.
// Usage: node scripts/product-project-editor-electron-qa.cjs <temporary-root> <app-root> <create|reopen> [native]
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
process.chdir(desktop);
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
    await build({ stdin: { contents: `export { getChatMessages, saveSettings, getWorkspacePaths, createChatSession, getChatSession, createAgentTask, createOrReusePendingToolApproval, addChatMessage } from './electron/db';
        export { createBrandWorkspaceStore } from './electron/core/brandWorkspaceStore';
        export { ProductVideoComposeParamsSchema } from './shared/productVideoProposal';
        export { ProductImageSetProposalSchema } from './shared/productImageSet';
        export { importMediaFiles } from './electron/core/mediaLibraryStore';
        export { readProductVideoRemixSources } from './electron/core/productVideoRemixSources';
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
 const seed=require('./seed.cjs');
 let textJob=null;let textRequests=0;const toolCounts={read:0,edit:0,undo:0};const network=[];
 const server=require('node:http').createServer(async(req,res)=>{
  try { let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);textRequests++;
  assert.ok(textJob,'Unexpected model request');
  assert.deepEqual(input.tools.map(tool=>tool.function.name).sort(),['product_project_edit','product_project_read','product_project_undo']);
  let message;
  if(textJob.phase===0){toolCounts.read++;message={content:'',tool_calls:[{id:'read-'+textJob.id,type:'function',function:{name:'product_project_read',arguments:'{}'}}]};}
  else if(textJob.phase===1){const name=textJob.undo?'product_project_undo':'product_project_edit';toolCounts[textJob.undo?'undo':'edit']++;
   const args=textJob.undo?{}:{operations:textJob.operations};args._editorTurn={binding:{project:{kind:'video',projectId:'model-cannot-retarget'}},expectedRevision:'spoofed',requestId:'spoofed'};
   message={content:'',tool_calls:[{id:'edit-'+textJob.id,type:'function',function:{name,arguments:JSON.stringify(args)}}]};}
  else{const last=input.messages.filter(item=>item.content?.startsWith('Tool result from product_project_')).at(-1);assert.ok(last,'Missing controlled result');
   const data=JSON.parse(last.content.slice(last.content.indexOf('\\n')+1));assert.ok(data.revision,'Edit did not save: '+last.content);textJob.result=data;textJob.done=true;message={content:'本轮修改已保存。'+data.summary.join('；')};}
  textJob.phase++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:20,completion_tokens:20,total_tokens:40}})); } catch(error) { console.error('MOCK_TEXT_FAILURE', error); res.writeHead(500); res.end(String(error)); }
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint='http://127.0.0.1:'+server.address().port+'/v1';
 const originalFetch=global.fetch;global.fetch=(url,...args)=>{const value=String(url);network.push(value);if(!value.startsWith('http://127.0.0.1:'))throw new Error('External network blocked in isolated QA: '+value);return originalFetch(url,...args);};
 seed.saveSettings({workspace_dir:path.join(root,'workspace'),active_space_id:'default',api_endpoint:endpoint,api_key:'isolated-fixture',model_name:'fixture-text',model_name_gardenflow:'fixture-text',proxy_enabled:0});
 let state=await fs.readFile(path.join(root,'state.json'),'utf8').then(JSON.parse).catch(()=>null);
 if(!state){
  const fixture=new BrowserWindow({width:600,height:800,useContentSize:true,show:false,webPreferences:{offscreen:true}});
  await fixture.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html><body style="margin:0;background:#ecdfcc"><svg width="600" height="800"><rect x="180" y="200" width="240" height="420" rx="35" fill="#ab4934"/><rect x="220" y="320" width="160" height="180" rx="15" fill="#fff8ee"/><circle cx="300" cy="410" r="45" fill="#f8aa45"/></svg></body></html>'));await pause(200);
  const picture=(await fixture.webContents.capturePage()).toPNG();fixture.destroy();await fs.writeFile(path.join(root,'product.png'),picture);
  const store=seed.createBrandWorkspaceStore(()=>path.join(seed.getWorkspacePaths().subjects,'brand-workspace'));
  const bundle=await store.upsertProduct({name:'阶段九持续编辑隔离商品',description:'仅用于本地模拟文本验收',images:[{dataUrl:'data:image/png;base64,'+picture.toString('base64')}]});
  const product=await store.getProductCreativeReference(bundle.product.id);
  const ffmpeg=${JSON.stringify(require('ffmpeg-static'))};
  const clipFiles=[];for(let i=0;i<2;i++){const file=path.join(root,'clip-'+i+'.mp4');require('node:child_process').execFileSync(ffmpeg,['-y','-f','lavfi','-i','color=c='+(i?'green':'blue')+':s=320x480:r=30','-t','1','-an','-c:v','libx264','-pix_fmt','yuv420p',file],{stdio:'ignore'});clipFiles.push(file);}
  const clips=await seed.importMediaFiles(clipFiles);const refs=await seed.readProductVideoRemixSources(clips.map(item=>item.id));
  state={product,refs,projects:{},baseline:{},sessions:{}};await fs.writeFile(path.join(root,'state.json'),JSON.stringify(state));
 }
 ${native ? "/* packaged main resumes normally */" : "require(path.join(appRoot, 'dist-electron', 'main.js'));"}
 const window=await poll(async()=>BrowserWindow.getAllWindows().find(win=>!win.isDestroyed()&&(win.webContents.getURL().includes('index.html')||win.webContents.getURL().includes('localhost')||win.webContents.getURL().includes('127.0.0.1'))),'application window');
 window.setSize(1920,1080);window.show();
 await poll(async()=>window.webContents.executeJavaScript('Boolean(window.ipcRenderer&&document.getElementById("root")?.childElementCount)').catch(()=>false),'renderer mount');
 const js=code=>window.webContents.executeJavaScript(code,true);const api=code=>js('(async()=>{'+code+'})()');
 const call=async(channel,payload)=>{assert.ok(handlers.has(channel),channel);return handlers.get(channel)({sender:window.webContents},payload);};
 const click=async label=>js('(()=>{const button=Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==='+JSON.stringify(label)+');if(!button)throw new Error("Missing button "+'+JSON.stringify(label)+');button.click();return true;})()');
 const navigate=async detail=>{await js('window.dispatchEvent(new CustomEvent("gardenflow:navigate",{detail:'+JSON.stringify(detail)+'}));true');await pause(350);};
 const capture=async name=>fs.writeFile(path.join(root,stage+'-'+name+'.png'),(await window.webContents.capturePage()).toPNG());
 const counters={image:0,video:0,voice:0};for(const [channel,kind]of[['manuscripts:generate-product-image-page','image'],['videoEditorV2:retry-product-scene','video'],['videoEditorV2:generate-product-voiceover','voice']]){ipcMain.removeHandler(channel);ipcMain.handle(channel,()=>{counters[kind]++;throw new Error('Unexpected paid generation');});}
 const product=state.product;const variants=nativeMode?'native':'development';
 const cases=[['xiaohongshu','video'],['douyin','video'],['tiktok','video'],['tiktok','remix'],['xiaohongshu','image-set']];
 for(const [platform,kind]of cases){
  const key=variants+'-'+platform+'-'+kind;const proposalId='proposal-'+key;const sessionId='source-'+key;const callId='approval-'+key;
  if(mode==='create'&&!state.projects[key]){
   const target=seed.resolveProductCreationTarget({platform,contentKind:kind==='image-set'?'image-set':'video',compositionMode:kind==='remix'?'existing-clips':'product-images'});
   const common={creationTarget:target,proposalId,productId:product.id,productUpdatedAt:product.updatedAt,productName:product.name};
   const params=kind==='image-set'?seed.ProductImageSetProposalSchema.parse({...common,finalTitle:'原图商品套图',body:'本地模板验收',hashtags:['product'],pages:Array.from({length:5},(_,i)=>({id:'page-'+i,role:i?'content':'cover',title:'商品原图 '+(i+1),copy:'中文文字与原图展示',layout:i?'split':'cover',productAssetIds:[product.assets[0].id]}))})
    :seed.ProductVideoComposeParamsSchema.parse({...common,version:1,referencedProductIds:[product.id],publicationCopy:{title:platform==='tiktok'?'Product details':'商品原图资料',description:platform==='tiktok'?'Original product photos':'原图文字验收',hashtags:['product']},title:'持续编辑验收',canvas:{width:1080,height:1920,fps:30,aspectRatio:'9:16'},durationMs:1000,compositionMode:target.compositionMode,voiceoverEnabled:false,
     scenes:Array.from({length:2},(_,i)=>({id:'scene-'+i,title:'素材 '+(i+1),durationMs:500,source:kind==='remix'?'media-clip':'product-asset',productAssetIds:kind==='remix'?[]:[product.assets[0].id],overlayText:platform==='tiktok'?'Product detail':'商品原图',fitMode:'contain-blur',motionPreset:'static',...(kind==='remix'?{mediaAssetId:state.refs[i].assetId,mediaContentHash:state.refs[i].contentHash,sourceStartMs:0,sourceEndMs:500,sourceVolume:0}:{})}))});
   const workflowKind=kind==='image-set'?'product-image-set-compose':'product-video-compose';const toolName=kind==='image-set'?'product_image_set_compose':'product_video_compose';
   seed.createChatSession(sessionId,'模拟创作 '+platform,{runtimeMode:'gardenflow',surface:'gardenflow',contextType:'gardenflow',contextId:'gardenflow-singleton:default'});
   seed.createAgentTask({id:'task-'+key,task_type:'foreground',status:'paused',runtime_mode:'gardenflow',owner_session_id:sessionId,route:{workflowKind,intent:kind==='image-set'?'manuscript_creation':'video_creation',recommendedRole:'video-director',requiredCapabilities:['artifact-save'],requiresHumanApproval:true},metadata:{workflowKind,creationTarget:target,productVideoCompositionMode:target.compositionMode,explicitVideoClipRefs:kind==='remix'?state.refs:[],explicitProductRefs:[{productId:product.id,name:product.name,updatedAt:product.updatedAt}],productAssetVisualGrounding:{status:'verified',productId:product.id,productUpdatedAt:product.updatedAt,imageCount:1,assets:[{assetId:product.assets[0].id,visibleText:[],suitability:'safe'}]}}});
   seed.createOrReusePendingToolApproval({callId,sessionId,taskId:'task-'+key,toolName,proposalId,proposalDigest:JSON.stringify(params),params,details:{type:'info',title:'确认目标作品 · '+platform,description:platform+' · '+target.language+' · '+target.spec.width+'×'+target.spec.height,requiresUserAcknowledgement:true,spaceId:'default'}});
   seed.addChatMessage({id:'user-'+key,session_id:sessionId,role:'user',content:'按所选目标创作商品作品'});seed.addChatMessage({id:'assistant-'+key,session_id:sessionId,role:'assistant',content:'请核对目标与方案。'});
   await navigate({type:'gardenflow.open',action:'open-session',sessionId});const label=kind==='image-set'?'确认并创建套图':'确认并创建工程';await poll(async()=>js('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==='+JSON.stringify(label)+')'),'approval card '+key);await capture(key+'-approval');await click(label);
   const resolved=await poll(async()=>api('return window.ipcRenderer.chat.confirmTool('+JSON.stringify(callId)+',true);').then(result=>result.status==='completed'&&result),'confirmed '+key);state.projects[key]=resolved.projectId;
   await fs.writeFile(path.join(root,'state.json'),JSON.stringify(state));
  }
 }
 const countBefore=JSON.stringify((await api('return window.ipcRenderer.videoEditorV2.listProjects();')).projects.map(project=>project.id).sort());
 const read=async(kind,id)=>{const result=await api('return window.ipcRenderer.videoEditorV2.readProductEditor('+JSON.stringify({project:kind==='image-set'?{kind:'image-set',path:id}:{kind:'video',projectId:id}})+');');assert.equal(result.success,true,result.error);return result.snapshot;};
 const editable=async()=>js('(()=>{const fields=Array.from(document.querySelectorAll("[data-product-project-editor-chat] [contenteditable=true]")).filter(node=>node.getBoundingClientRect().width>0);return fields.length;})()');
 const setComposer=async(message)=>{
  await poll(editable,'visible editor composer');await js('(()=>{const fields=Array.from(document.querySelectorAll("[data-product-project-editor-chat] [contenteditable=true]")).filter(node=>node.getBoundingClientRect().width>0);const field=fields.at(-1);field.focus();field.textContent='+JSON.stringify(message)+';const range=document.createRange();range.selectNodeContents(field);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);field.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:'+JSON.stringify(message)+'}));return true;})()');await pause(150);
 };
 const compose=async(message)=>{
  await setComposer(message);
  await js('(()=>{const fields=Array.from(document.querySelectorAll("[data-product-project-editor-chat] [contenteditable=true]")).filter(node=>node.getBoundingClientRect().width>0);fields.at(-1).closest("form").requestSubmit();return true;})()');
 };
 const results=[];
 for(const [platform,kind]of cases){
  const key=variants+'-'+platform+'-'+kind;const id=state.projects[key];const ref=kind==='image-set'?{kind:'image-set',path:id}:{kind:'video',projectId:id};
  const binding=await api('return window.ipcRenderer.videoEditorV2.getProductEditorSession('+JSON.stringify({project:ref})+');');assert.equal(binding.success,true,binding.error);
  if(state.sessions[key])assert.equal(binding.sessionId,state.sessions[key]);state.sessions[key]=binding.sessionId;
  await navigate(kind==='image-set'?{type:'manuscript.open',manuscriptPath:id}:{type:'video-project.open',projectId:id});await poll(async()=>js('Boolean(document.querySelector("[data-product-project-editor-chat]"))'),'project editor '+key);await poll(editable,'bound chat '+key);await pause(500);
  if(mode==='create'){
   for(let round=1;round<=6;round++){
    const peers={};for(const [otherPlatform,otherKind]of cases){const otherKey=variants+'-'+otherPlatform+'-'+otherKind;if(otherKey!==key)peers[otherKey]=await read(otherKind,state.projects[otherKey]);}
    if(round===2){
     if(kind==='image-set')await js('(()=>{const field=Array.from(document.querySelectorAll("textarea")).find(node=>node.closest("label")?.textContent.includes("文案"));if(!field)throw new Error("Page copy field");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,"手动输入在发送前保存");field.dispatchEvent(new Event("input",{bubbles:true}));return true;})()');
     else await js('(()=>{const field=Array.from(document.querySelectorAll("textarea")).find(node=>node.closest("label")?.textContent.includes("屏幕文字"));Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,"Manual input before chat");field.dispatchEvent(new Event("input",{bubbles:true}));return true;})()');
    }
    const before=await read(kind,id);let operations;const undo=round===6;
    if(kind==='image-set')operations=round===1?[{type:'page.update',pageId:'page-0',changes:{title:'中文封面编辑'}}]:round===2?[{type:'page.update',pageId:'page-1',changes:{layout:'grid',cropX:30,fit:'cover'}}]:round===3?[{type:'publication.copy',title:'已编辑发布文案',description:'正文与话题可对话编辑',hashtags:['detail']}]:round===4?[{type:'page.add',page:{id:'new-content',role:'content',title:'新增页',copy:'新增中文内容',layout:'split',productAssetIds:[before.imageSet.document.productImageSet.assets[0].id],fit:'contain',cropX:50,cropY:50,fontScale:1,aiPrompt:''}}]:[{type:'page.order',pageIds:['page-0','new-content','page-1','page-2','page-3','page-4']}];
    else operations=round===1?[{type:'scene.text',sceneId:'scene-0',text:platform==='tiktok'?'Edited detail':'对话编辑字幕'}]:round===2?[{type:'scene.fit',sceneId:'scene-0',fitMode:'cover'}]:round===3?[{type:'publication.copy',title:platform==='tiktok'?'Updated product':'新发布文案',description:platform==='tiktok'?'Updated publication copy':'通过对话保存发布文案',hashtags:['detail']}]:round===4?[{type:'scene.narration-text',sceneId:'scene-0',text:platform==='tiktok'?'Voice text without audio':'未配音朗读文字'}]:[{type:'scene.reorder',sceneId:'scene-1',targetSceneId:'scene-0',position:'before'}];
    textJob={id:key+'-'+round,phase:0,operations,undo,done:false};await compose('验收编辑第 '+round+' 轮：'+(undo?'撤销上一次修改':JSON.stringify(operations)));
    await poll(async()=>textJob.done,'mock text edit '+key+' '+round);await poll(async()=>js('!document.querySelector("button[title=停止生成]")'),'chat complete');
    const after=await read(kind,id);assert.notEqual(after.revision,before.revision);assert.equal(after.binding.productId,product.id);assert.equal(after.binding.target.platform,platform);
    if(round===2){if(kind==='image-set')assert.equal(after.imageSet.document.productImageSet.pages[0].copy,'手动输入在发送前保存');else assert.equal(after.video.productVideo.scenes.find(scene=>scene.id==='scene-0').overlayText,'Manual input before chat');}
    for(const [otherPlatform,otherKind]of cases){const otherKey=variants+'-'+otherPlatform+'-'+otherKind;if(otherKey!==key)assert.equal(JSON.stringify(await read(otherKind,state.projects[otherKey])),JSON.stringify(peers[otherKey]),'Sibling version changed '+otherKey);}
    if(round===3||round===6){
     const unsent='保留未发送的编辑消息 '+round;await setComposer(unsent);
     if(kind==='image-set'){pickerOutput=path.join(root,'exports',key+'-'+round+'.zip');const exported=await api('return window.ipcRenderer.manuscripts.exportProductImageSet('+JSON.stringify({path:id,expectedRevision:after.imageSet.version,format:'zip'})+');');assert.equal(exported.success,true,exported.error);}
     else{pickerOutput=path.join(root,'exports',key+'-'+round+'.mp4');const exported=await api('return window.ipcRenderer.videoEditorV2.render('+JSON.stringify({projectId:id,outputPath:pickerOutput,renderVideo:true})+');');assert.equal(exported.success,true,exported.error);}
     await poll(editable,'composer after export');await pause(700);const retained=await js('Array.from(document.querySelectorAll("[data-product-project-editor-chat] [contenteditable=true]")).filter(node=>node.getBoundingClientRect().width>0).at(-1)?.textContent');assert.equal(retained,unsent,'Export or background refresh erased unsent chat input');await setComposer('');
    }
    if(round===4){const fresh=await read(kind,id);const undone=await api('return window.ipcRenderer.videoEditorV2.undoProductEditor('+JSON.stringify({binding:fresh.binding,requestId:'manual-undo-'+key,expectedRevision:fresh.revision,expectedDraftEpoch:fresh.draftEpoch})+');');assert.equal(undone.success,true,undone.error);
     if(kind==='image-set'){const next=await read(kind,id);const add={type:'page.add',page:{id:'new-content',role:'content',title:'新增页',copy:'新增中文内容',layout:'split',productAssetIds:[next.imageSet.document.productImageSet.assets[0].id],fit:'contain',cropX:50,cropY:50,fontScale:1,aiPrompt:''}};const added=await api('return window.ipcRenderer.videoEditorV2.saveProductEditorManual('+JSON.stringify({binding:next.binding,requestId:'manual-add-'+key,expectedRevision:next.revision,expectedDraftEpoch:next.draftEpoch,operations:[add]})+');');assert.equal(added.success,true,added.error);}}
    await capture(key+'-round-'+round);
   }
   const messages=seed.getChatMessages(binding.sessionId);assert.ok(messages.filter(message=>message.role==='user').length>=6,'Six persisted edit messages');
   state.baseline[key]=await read(kind,id);
  }else{const {draftEpoch:oldEpoch,...saved}=state.baseline[key];const {draftEpoch:newEpoch,...loaded}=await read(kind,id);assert.ok(newEpoch>=oldEpoch,'Draft credentials must advance on reopening');assert.equal(JSON.stringify(loaded),JSON.stringify(saved),'Cold-start content or binding changed');const messages=seed.getChatMessages(binding.sessionId);assert.ok(messages.filter(message=>message.role==='user').length>=6);}
  await capture(key+'-final');results.push({key,projectId:id,sessionId:binding.sessionId,rounds:6,revision:(await read(kind,id)).revision});
 }
 assert.equal(JSON.stringify((await api('return window.ipcRenderer.videoEditorV2.listProjects();')).projects.map(project=>project.id).sort()),countBefore,'Editing created another project');assert.deepEqual(counters,{image:0,video:0,voice:0});
 await fs.writeFile(path.join(root,'state.json'),JSON.stringify(state));
 await fs.writeFile(path.join(root,stage+'-result.json'),JSON.stringify({mode,nativeExecutable:nativeMode,sourceRenderer:!nativeMode,textRequests,toolCounts,paidMediaRequests:counters,realModelRequests:0,results},null,2));console.log('PRODUCT_PROJECT_EDITOR_QA_SUCCESS '+stage);server.close();app.exit(0);
}
run().catch(async error=>{console.error(error);await fs.writeFile(path.join(root,stage+'-error.txt'),String(error.stack||error)).catch(()=>{});const win=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed());if(win){await fs.writeFile(path.join(root,stage+'-failure.png'),(await win.webContents.capturePage()).toPNG()).catch(()=>{});await fs.writeFile(path.join(root,stage+'-dom.txt'),await win.webContents.executeJavaScript('document.body.innerText').catch(()=>''));}app.exit(1);});
setTimeout(()=>{console.error('QA deadline');app.exit(1);},900000).unref();
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
