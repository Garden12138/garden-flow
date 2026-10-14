// Stage 10 isolated application acceptance: real main/preload/renderer, PNG/MP4 exports, and a local publisher RPC fixture.
// Usage: node scripts/product-publication-electron-qa.cjs <temporary-root> <app-root> <create|reopen> [native]
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
process.env.GARDENFLOW_BROWSER_CONTROL_STATE_DIR = path.join(root,'browser-bridge');
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
  const bundle=await store.upsertProduct({name:'阶段十发布隔离商品',description:'仅用于本地模拟文本验收',images:[{dataUrl:'data:image/png;base64,'+picture.toString('base64')}]});
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
 const capture=async name=>{window.focus();await pause(700);await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await fs.writeFile(path.join(root,stage+'-'+name+'.txt'),await js('document.body.innerText'));await fs.writeFile(path.join(root,stage+'-'+name+'.png'),(await window.webContents.capturePage()).toPNG());};
 const counters={image:0,video:0,voice:0};for(const [channel,kind]of[['manuscripts:generate-product-image-page','image'],['videoEditorV2:retry-product-scene','video'],['videoEditorV2:generate-product-voiceover','voice']]){ipcMain.removeHandler(channel);ipcMain.handle(channel,()=>{counters[kind]++;throw new Error('Unexpected paid generation');});}

 const publisherRequests=[];const publisherOwners={};
 const descriptor=await poll(async()=>fs.readFile(path.join(root,'browser-bridge','desktop-bridge-v1.json'),'utf8').then(JSON.parse).catch(()=>null),'publisher bridge descriptor');
 const socket=require('node:net').createConnection(descriptor.endpoint.path||descriptor.endpoint.name);await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
 let rpcSequence=0;let rpcBuffer=Buffer.alloc(0);const pendingRpc=new Map();
 const writeRpc=value=>{const bytes=Buffer.from(JSON.stringify(value));const frame=Buffer.alloc(bytes.length+4);frame.writeUInt32LE(bytes.length);bytes.copy(frame,4);socket.write(frame);};
 const account={accountId:'stage10_fixture',accountLabel:'@stage10_fixture'};
 const simulate=async(method,params)=>{
  publisherRequests.push({method,phase:params.phase,platform:params.platform});
  const platform=params.platform||'xiaohongshu';const request=params.request;const owner=publisherOwners[platform];
  if(method==='publisher.status')return{...account,pageState:owner?.status==='prepared'?'draft':'ready',ownedJobId:owner?.jobId,ownedJobStatus:owner?.status};
  if(params.phase==='prepare'){
   assert.equal(request.confirmationVersion,2);assert.equal(request.accountId,account.accountId);assert.equal(request.accountLabel,account.accountLabel);
   if(owner?.status==='prepared'&&owner.jobId!==request.jobId)return{ok:false,jobId:request.jobId,contentDigest:request.contentDigest,publishStatus:'not_submitted',code:'EXISTING_DRAFT',message:'Local fixture protects another job draft'};
   const files=request.media?request.media.map(item=>item.path):[request.mediaPath];assert.ok(files.length&&files.length<=18);
   for(const file of files)assert.ok((await fs.stat(file)).size>0);
   if(request.media){assert.equal(request.media[0].role,request.noteType==='image'?'cover':'video');assert.deepEqual(request.media.map(item=>item.order),files.map((_,index)=>index));}
   publisherOwners[platform]={jobId:request.jobId,digest:request.contentDigest,status:'prepared',request};
   return{ok:true,prepared:true,jobId:request.jobId,contentDigest:request.contentDigest,publishStatus:'not_submitted',uploadReview:{jobId:request.jobId,contentDigest:request.contentDigest,...account,mediaCount:files.length,pageSettings:{visibilityLabel:'公开可见',original:false,allowCopy:true,scheduled:false},pageFingerprint:JSON.stringify({title:request.title,body:request.body||request.description,files,settings:request.publishSettings})}};
  }
  if(params.phase==='submit'){
   assert.equal(owner?.jobId,request.jobId);assert.equal(owner.digest,request.contentDigest);assert.equal(owner.status,'prepared');
   assert.equal(JSON.stringify(owner.request),JSON.stringify(request));delete publisherOwners[platform];
   return{ok:true,jobId:request.jobId,contentDigest:request.contentDigest,publishStatus:'published',resetStatus:'ready'};
  }
  if(params.phase==='review-published'||params.phase==='read-receipt')return{ok:true,jobId:params.jobId||request?.jobId,contentDigest:params.contentDigest||request?.contentDigest,publishStatus:'published',resetStatus:'ready'};
  throw new Error('Unexpected simulated publisher operation '+method+':'+params.phase);
 };
 socket.on('data',data=>{rpcBuffer=Buffer.concat([rpcBuffer,data]);while(rpcBuffer.length>=4){const length=rpcBuffer.readUInt32LE(0);if(rpcBuffer.length<length+4)return;const message=JSON.parse(rpcBuffer.subarray(4,length+4));rpcBuffer=rpcBuffer.subarray(length+4);
  if(message.method)void simulate(message.method,message.params||{}).then(result=>writeRpc({jsonrpc:'2.0',id:message.id,result})).catch(error=>writeRpc({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:String(error)}}));
  else{pendingRpc.get(message.id)?.(message);pendingRpc.delete(message.id);}}});
 const requestRpc=(method,params)=>new Promise(resolve=>{const id='qa-'+(++rpcSequence);pendingRpc.set(id,resolve);writeRpc({jsonrpc:'2.0',id,method,params});});
 const hello=await requestRpc('bridge.hello',{role:'native_host',bridgeProtocolVersion:1,authToken:descriptor.hostAuthToken,origin:'chrome-extension://jafdjmajegkaabbohedhmmlhogdejkpb/',hostInstanceId:'stage10-local-publisher'});assert.equal(hello.result?.ok,true);
 const registered=await requestRpc('extension.register',{extensionId:'jafdjmajegkaabbohedhmmlhogdejkpb',extensionInstanceId:'stage10-browser',extensionKind:'xhs-publisher',browser:'local fixture',version:'0.0.1',capabilities:['xiaohongshu.publish.v1','douyin.publish.v1','douyin.image-cover.v1','tiktok.publish.v1','publisher.upload-review.v1','xiaohongshu.account-bound.v1']});assert.equal(registered.result?.registered,true);
 const config=await call('publication:status',{refresh:true});assert.equal(config.success,true,config.error);for(const status of config.statuses){assert.equal(status.instances[0].supported,true);assert.equal((await call('publication:bind',{platform:status.platform,extensionInstanceId:'stage10-browser'})).success,true);}
 state.publications=state.publications||{};
 const product=state.product;const variants=nativeMode?'native':'development';
 const cases=[['xiaohongshu','video'],['douyin','video'],['tiktok','video'],['tiktok','remix'],['xiaohongshu','image-set']];
 for(const [platform,kind]of cases){
  const key=variants+'-'+platform+'-'+kind;const proposalId='proposal-'+key;const sessionId='source-'+key;const callId='approval-'+key;
  if(mode==='create'&&!state.projects[key]){
   const target=seed.resolveProductCreationTarget({platform,contentKind:kind==='image-set'?'image-set':'video',compositionMode:kind==='remix'?'existing-clips':'product-images'});
   const common={creationTarget:target,proposalId,productId:product.id,productUpdatedAt:product.updatedAt,productName:product.name};
   const params=kind==='image-set'?seed.ProductImageSetProposalSchema.parse({...common,finalTitle:'原图商品套图',body:'本地模板验收',hashtags:['product'],pages:Array.from({length:5},(_,i)=>({id:'page-'+i,role:i?'content':'cover',title:'商品原图 '+(i+1),copy:'中文文字与原图展示',layout:i?'split':'cover',productAssetIds:[product.assets[0].id]}))})
    :seed.ProductVideoComposeParamsSchema.parse({...common,version:1,referencedProductIds:[product.id],publicationCopy:{title:platform==='tiktok'?'Product details':'商品原图资料',description:platform==='tiktok'?'Original product photos':'原图文字验收',hashtags:['product']},title:'统一发布验收',canvas:{width:1080,height:1920,fps:30,aspectRatio:'9:16'},durationMs:1000,compositionMode:target.compositionMode,voiceoverEnabled:false,
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
 const jobs=async()=>{const result=await api('return window.ipcRenderer.publication.list();');assert.equal(result.success,true,result.error);return result;};
 const getJob=async job=>{const result=await api('return window.ipcRenderer.publication.getJob('+JSON.stringify({platform:job.platform,jobId:job.id})+');');assert.equal(result.success,true,result.error);return result.job;};
 const panel=async()=>poll(async()=>js('Boolean(document.querySelector("[data-publication-panel]"))'),'publication panel');
 for(const [platform,kind]of cases){
  const key=variants+'-'+platform+'-'+kind;const id=state.projects[key];const ref=kind==='image-set'?{kind:'image-set',path:id}:{kind:'video',projectId:id};
  const binding=await api('return window.ipcRenderer.videoEditorV2.getProductEditorSession('+JSON.stringify({project:ref})+');');assert.equal(binding.success,true,binding.error);if(state.sessions[key])assert.equal(binding.sessionId,state.sessions[key]);state.sessions[key]=binding.sessionId;
  await navigate(kind==='image-set'?{type:'manuscript.open',manuscriptPath:id}:{type:'video-project.open',projectId:id});await poll(async()=>js('Boolean(document.querySelector("[data-product-project-editor-chat]"))'),'project editor '+key);await poll(editable,'editor composer '+key);await pause(300);
  if(mode==='create'){
   if(platform==='tiktok'){
    const current=await api('return window.ipcRenderer.tiktokVideo.getVersion('+JSON.stringify({projectId:id})+');');assert.equal(current.success,true,current.error);const version=current.version;
    const saved=await api('return window.ipcRenderer.tiktokVideo.saveVersion('+JSON.stringify({versionId:version.id,expectedRevision:version.revision,title:version.title,description:version.description,hashtags:version.hashtags,language:version.language,market:version.market,publishSettings:{visibility:'only_me',allowComments:false,allowReuse:false,allowRemix:false,audience18Plus:false,commercialContent:'none',aiGenerated:false}})+');');assert.equal(saved.success,true,saved.error);
   }
   const toggle=await api('return window.ipcRenderer.gardenflowRunner.setBuiltinEnabled('+JSON.stringify({taskId:(platform==='xiaohongshu'?'xhs':platform)+'-auto-publish',enabled:true})+');');assert.notEqual(toggle.success,false,toggle.error);
   let before=await read(kind,id);const unsent='保留未发送发布验收消息';await setComposer(unsent);
   let exported;
   if(kind==='image-set'){pickerOutput=path.join(root,'exports',key+'.zip');exported=await api('return window.ipcRenderer.manuscripts.exportProductImageSet('+JSON.stringify({path:id,expectedRevision:before.imageSet.version,format:'zip'})+');');}
   else{pickerOutput=path.join(root,'exports',key+'.mp4');exported=await api('return window.ipcRenderer.videoEditorV2.render('+JSON.stringify({projectId:id,outputPath:pickerOutput,renderVideo:true})+');');}
   assert.equal(exported.success,true,exported.error);await poll(editable,'composer after export');await pause(300);assert.equal(await js('Array.from(document.querySelectorAll("[data-product-project-editor-chat] [contenteditable=true]")).filter(node=>node.getBoundingClientRect().width>0).at(-1)?.textContent'),unsent);
   const records=await jobs();const offer=records.offers.find(event=>event.snapshot.versionId===before.binding.workVersion.versionId&&event.state==='offered');assert.ok(offer,'completion offer '+key);assert.equal(offer.snapshot.sessionId,binding.sessionId);
   assert.equal(publisherRequests.filter(row=>row.phase==='prepare'||row.phase==='submit').length,results.length*2,'completion must not upload');
   await setComposer('');await click('准备发布');await panel();await poll(async()=>js('Array.from(document.querySelectorAll("button")).some(button=>button.textContent.trim()==="准备当前版本"&&!button.disabled)'),'prepare source button');await click('准备当前版本');
   let job=await poll(async()=>{const row=(await jobs()).jobs.find(row=>row.source?.kind===ref.kind&&(ref.kind==='video'?row.source.projectId===id:row.source.path===id)&&row.status==='awaiting_confirmation');return row;},'prepared '+key);
   assert.equal(job.phase,'awaiting-upload');await capture(key+'-awaiting-upload');
   const denied=await api('return window.ipcRenderer.publication.submit('+JSON.stringify({platform,jobId:job.id,expectedDigest:job.contentDigest})+');');assert.equal(denied.success,false);assert.ok(denied.error.includes('先点击上传'));
   await poll(async()=>js('Array.from(document.querySelectorAll("button")).some(button=>button.textContent.trim()==="上传到页面供核对（不发布）"&&!button.disabled)'),'upload button');await click('上传到页面供核对（不发布）');job=await poll(async()=>{const row=await getJob(job);return row.phase==='awaiting-submit'&&row.status==='awaiting_confirmation'&&row;},'upload review '+key);await capture(key+'-awaiting-submit');
   const repeated=await api('const source=await window.ipcRenderer.publication.readSource('+JSON.stringify({source:ref})+');return window.ipcRenderer.publication.prepare({source:source.snapshot.source,expectedRevision:source.snapshot.revision});');assert.equal(repeated.success,true,repeated.error);assert.equal(repeated.job.id,job.id);
   await poll(async()=>js('Array.from(document.querySelectorAll("button")).some(button=>button.textContent.trim()==="最终确认发布"&&!button.disabled)'),'final button');await click('最终确认发布');job=await poll(async()=>{const row=await getJob(job);return row.publishStatus==='published'&&row;},'publication result '+key);await capture(key+'-published');
   assert.equal(job.accountId,account.accountId);assert.equal(job.receiptUrl,undefined);state.publications[key]=job;
   await js('document.querySelector("[data-publication-panel] button[aria-label=关闭发布面板]").click();true');await pause(250);
   const latest=await read(kind,id);const changed=await api('return window.ipcRenderer.videoEditorV2.saveProductEditorManual('+JSON.stringify({binding:latest.binding,requestId:'post-publication-'+key,expectedRevision:latest.revision,expectedDraftEpoch:latest.draftEpoch,operations:[{type:'publication.copy',title:platform==='tiktok'?'New local copy':'发布后新文案',description:'Local revision after receipt',hashtags:['new']}]})+');');assert.equal(changed.success,true,changed.error);
   assert.equal(JSON.stringify((await getJob(job)).context),JSON.stringify(job.context),'published snapshot remains immutable');
   state.baseline[key]=await read(kind,id);
  }else{
   const job=await getJob(state.publications[key]);assert.equal(job.publishStatus,'published');assert.equal(JSON.stringify(job.context),JSON.stringify(state.publications[key].context),'cold-start publication snapshot');
   const latest=await read(kind,id);assert.equal(latest.revision,state.baseline[key].revision);assert.equal(binding.sessionId,state.sessions[key]);assert.ok((await jobs()).offers.some(event=>event.snapshot.sessionId===binding.sessionId),'durable completion history');
   assert.equal(publisherRequests.filter(row=>row.phase==='prepare'||row.phase==='submit').length,0,'restart never replays upload/submit');
  }
  results.push({key,projectId:id,sessionId:binding.sessionId,jobId:state.publications[key].id,publicationStatus:'published',mediaCount:state.publications[key].media.length});
 }
 await click('计划');await poll(async()=>js('Array.from(document.querySelectorAll("button")).some(button=>button.textContent.trim()==="发布")'),'plan publication tab');await click('发布');await poll(async()=>js('Boolean(document.querySelector("[aria-label=统一发布管理]"))'),'publication management');await pause(300);await capture('publication-management');
 assert.equal(JSON.stringify((await api('return window.ipcRenderer.videoEditorV2.listProjects();')).projects.map(project=>project.id).sort()),countBefore,'Editing created another project');assert.deepEqual(counters,{image:0,video:0,voice:0});
 await fs.writeFile(path.join(root,'state.json'),JSON.stringify(state));
 await fs.writeFile(path.join(root,stage+'-result.json'),JSON.stringify({mode,nativeExecutable:nativeMode,sourceRenderer:!nativeMode,publisherRequests,simulatedPublisher:true,textRequests,toolCounts,paidMediaRequests:counters,realModelRequests:0,results},null,2));console.log('PRODUCT_PUBLICATION_QA_SUCCESS '+stage);socket.destroy();server.close();app.exit(0);
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
