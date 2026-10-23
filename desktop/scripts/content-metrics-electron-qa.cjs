// Run from desktop after `pnpm exec vite build`:
// node scripts/content-metrics-electron-qa.cjs /private/tmp/gardenflow-metrics-qa
// Explicitly synthetic observations in isolated Electron/SQLite/IPC/React. No provider or publishing calls.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { build } = require('esbuild');
const desktop = path.resolve(__dirname, '..');
const root = path.resolve(process.argv[2] || '/private/tmp/gardenflow-metrics-qa');
if (!root.startsWith('/private/tmp/') && !root.startsWith('/tmp/')) throw new Error('QA requires an isolated temporary directory');
async function main() {
    await fs.mkdir(root, { recursive: true });
    await fs.symlink(path.join(desktop, 'node_modules'), path.join(root, 'node_modules')).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await build({ stdin: { resolveDir: desktop, contents: `export {saveSettings,getContentMetricsRepository} from './electron/db'; export {startCreationWorkspace} from './electron/core/creationWorkspaceStore';` }, outfile: path.join(root, 'seed.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external',
        define: { 'import.meta.url': JSON.stringify(`file://${desktop}/package.json`) }, banner: { js: `module.paths.unshift(${JSON.stringify(path.join(desktop, 'node_modules'))});` } });
    const runner = String.raw`
const {app,BrowserWindow,protocol,session}=require('electron');const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const root=__ROOT__,desktop=__DESKTOP__;require('node:os').homedir=()=>root;
process.env.GARDENFLOW_USER_DATA_DIR=path.join(root,'user-data');process.env.GARDENFLOW_HOLD_AUTOMATION='1';app.setPath('userData',process.env.GARDENFLOW_USER_DATA_DIR);app.setPath('sessionData',process.env.GARDENFLOW_USER_DATA_DIR);app.setPath('home',root);app.getAppPath=()=>desktop;app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'gardenflow-asset',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true,bypassCSP:true}}]);protocol.registerSchemesAsPrivileged=()=>{};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let window,js,externalRequests=0;
async function poll(operation,label){const until=Date.now()+45000;while(Date.now()<until){if(await operation())return;await pause(100);}throw new Error('Timeout: '+label);}
async function run(){
 await app.whenReady();const originalFetch=global.fetch;global.fetch=(url,...args)=>{if(!String(url).startsWith('http://127.0.0.1:')){externalRequests++;throw new Error('External request forbidden');}return originalFetch(url,...args);};
 session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{const external=/^https?:/.test(details.url)&&!details.url.startsWith('http://127.0.0.1:');if(external)externalRequests++;callback({cancel:external});});
 const seed=require('./seed.cjs');seed.saveSettings({workspace_dir:path.join(root,'workspace'),active_space_id:'default',proxy_enabled:0});
 assert.equal(seed.getContentMetricsRepository().observations().length,0,'Use a fresh QA directory');
 const works=await Promise.all(['control','variant'].map(role=>seed.startCreationWorkspace({platform:'xiaohongshu',capability:'note-image',requestId:'synthetic-metrics-'+role,brief:'明确标注的合成测试工程，无真实业绩'})));
 require(path.join(desktop,'dist-electron/main.js'));
 await poll(async()=>{window=BrowserWindow.getAllWindows().find(value=>!value.isDestroyed());return Boolean(window);},'application window');window.webContents.setBackgroundThrottling(false);window.setSize(1440,940);
 js=code=>window.webContents.executeJavaScript(code,true);await poll(()=>js('Boolean(window.ipcRenderer?.contentIntelligence&&document.getElementById("root")?.childElementCount)').catch(()=>false),'typed bridge');
 const api=code=>js('(async()=>{'+code+'})()');const invoke=async(method,input)=>{const result=await api('return window.ipcRenderer.contentIntelligence.'+method+'('+(input===undefined?'':JSON.stringify(input))+')');assert.equal(result.success,true,result.error);return result.data;};
 const click=label=>js('Array.from(document.querySelectorAll("button")).find(button=>button.textContent.trim()==='+JSON.stringify(label)+')?.click();true');
 const field=async(label,value,tag='input')=>{const selector=JSON.stringify(tag+'[aria-label="'+label+'"]');await poll(()=>js('Boolean(document.querySelector('+selector+')&&!document.querySelector('+selector+').disabled)'),'editable field '+label);return js('var node=document.querySelector('+selector+');Object.getOwnPropertyDescriptor('+(tag==='textarea'?'HTMLTextAreaElement':tag==='select'?'HTMLSelectElement':'HTMLInputElement')+'.prototype,"value").set.call(node,'+JSON.stringify(value)+');node.dispatchEvent(new Event('+(tag==='select'?'"change"':'"input"')+',{bubbles:true}));true');};
 await js('window.dispatchEvent(new CustomEvent("gardenflow:navigate",{detail:{type:"view.open",view:"automation"}}));true');await poll(()=>js('Array.from(document.querySelectorAll("button")).some(button=>button.textContent.trim()==="观测与实验")'),'Plans tab');await click('观测与实验');
 await poll(()=>js('document.querySelector("select[aria-label=观测工程]")?.options.length===3'),'actual work summaries');assert.equal((await invoke('metrics')).length,0);
 await js('Array.from(document.querySelectorAll("summary")).find(value=>value.textContent.startsWith("手工补充已发布作品")).click();true');
 for(let index=0;index<works.length;index++){
  await field('观测工程',works[index].id,'select');await field('观测账号别名','合成验收账号');await field('平台作品ID',String(111+index));await field('发布关联来源说明','合成发布声明，仅协议测试；不是真实业绩');await click('保存人工发布关联');await poll(async()=>(await invoke('publications')).length===index+1,'manual labelled publication link');
 }
 const links=await invoke('publications');const control=links.find(value=>value.workspaceId===works[0].id),variant=links.find(value=>value.workspaceId===works[1].id);assert.ok(control&&variant);assert.ok(links.every(value=>value.origin==='manual'&&value.status==='declared-published'));
 const headers='publicationLinkId,metric,definition,unit,value,start,end,timeZone,alignment,ageStartHours,ageEndHours,confounders,sourceNote';
 const csv=value=>headers+'\n'+[[control.id,value],[variant.id,150]].map(([id,count])=>[id,'likes','合成窗口新增点赞计数','count',count,'2026-10-01T00:00:00Z','2026-10-02T00:00:00Z','Asia/Shanghai','calendar','','','合成测试，无因果结论','合成观测，仅协议测试'].join(',')).join('\n');
 await field('指标CSV内容',csv(100),'textarea');await click('预览观测导入');await poll(()=>js('Boolean(document.querySelector("[aria-label=观测导入预览]"))'),'import preview');assert.equal((await invoke('metrics')).length,0);
 assert.equal(await js('Array.from(document.querySelectorAll("button")).find(button=>button.textContent.trim()==="确认导入观测").disabled'),true);
 await js('document.querySelector("[aria-label=观测导入预览]").scrollIntoView({block:"center"});true');await pause(400);await fs.writeFile(path.join(root,'import-preview-private.png'),(await window.webContents.capturePage()).toPNG());
 await js('document.querySelector("input[aria-label=确认导入观测]").click();true');await click('确认导入观测');await click('确认导入观测');await poll(async()=>(await invoke('metrics')).length===2,'confirmed two observations');
 let observations=await invoke('metrics');let baseline=observations.find(value=>value.input.publicationLinkId===control.id);const treatment=observations.find(value=>value.input.publicationLinkId===variant.id);
 await field('对照观测',baseline.id,'select');await field('变体观测',treatment.id,'select');await click('计算观察差异');await poll(()=>js('Boolean(document.querySelector("[aria-label=观测比较结果]"))'),'deterministic comparison');
 const comparison=await api('return window.ipcRenderer.contentIntelligence.compareMetrics('+JSON.stringify(baseline.id)+','+JSON.stringify(treatment.id)+',1,1)');assert.equal(comparison.success,true);assert.equal(comparison.data.relativeChange,.5);
 await field('指标CSV内容',csv(120),'textarea');await click('预览观测导入');await poll(()=>js('Boolean(document.querySelector("input[aria-label=确认修订观测冲突]"))'),'conflict preview');await js('document.querySelector("input[aria-label=确认导入观测]").click();true');assert.equal(await js('Array.from(document.querySelectorAll("button")).find(button=>button.textContent.trim()==="确认导入观测").disabled'),true);
 await js('document.querySelector("input[aria-label=确认修订观测冲突]").click();true');await click('确认导入观测');await poll(async()=>{const values=await invoke('metricHistory',baseline.id);return values.length===2;},'audited revision');
 const history=await invoke('metricHistory',baseline.id);assert.equal(history[0].input.value,120);assert.equal(history[1].input.value,100);assert.equal((await invoke('metrics')).length,2);
 await poll(()=>js('document.body.innerText.includes("已写入 1 条观测版本")&&!Array.from(document.querySelectorAll("button")).find(button=>button.textContent.trim()==="计算观察差异").disabled'),'revision UI load completed');
 await click('计算观察差异');await poll(()=>js('document.querySelector("[aria-label=观测比较结果]")?.textContent.includes("25.00%")'),'revised comparison');await click('查看对照审计版本');await poll(()=>js('Boolean(document.querySelector("[aria-label=观测审计历史]"))'),'history in UI');
 for(const width of [960,1440]){window.setSize(width,940);if(width===960)await js('document.querySelector(".app-titlebar-sidebar-toggle[data-sidebar-state=expanded]")?.click();true');await js('document.querySelector("[aria-label=观测比较结果]").scrollIntoView({block:"center"});true');await pause(500);await fs.writeFile(path.join(root,'comparison-'+width+'-private.png'),(await window.webContents.capturePage()).toPNG());}
 const other=await api('return window.ipcRenderer.spaces.create("指标隔离验收")');assert.equal(other.success,true);await api('return window.ipcRenderer.spaces.switch('+JSON.stringify(other.space.id)+')');await poll(()=>js('!document.body.innerText.includes("合成验收账号")'),'space clears private observation state');assert.equal((await invoke('metrics')).length,0);
 const foreign=await api('return window.ipcRenderer.contentIntelligence.metricHistory('+JSON.stringify(baseline.id)+')');assert.equal(foreign.success,false);await api('return window.ipcRenderer.spaces.switch("default")');
 assert.equal(externalRequests,0);await fs.writeFile(path.join(root,'result.json'),JSON.stringify({data:'explicitly synthetic; not real performance acceptance',works:works.map(value=>value.id),publicationLinks:2,observations:2,auditRevisions:2,initialRelativeChange:.5,revisedRelativeChange:.25,crossSpaceRejected:true,externalRequests,modelCalls:0,paidOrPublicationActions:0},null,2));console.log('CONTENT_METRICS_ELECTRON_QA_SUCCESS');app.exit(0);
}
run().catch(async error=>{console.error(error);if(window&&!window.isDestroyed()){await fs.writeFile(path.join(root,'failure-private.png'),(await window.webContents.capturePage()).toPNG()).catch(()=>{});await fs.writeFile(path.join(root,'failure-dom-private.txt'),await js('document.body.innerText').catch(()=>''));}await fs.writeFile(path.join(root,'error.txt'),error.stack||String(error));app.exit(1);});setTimeout(()=>app.exit(2),180000).unref();
`.replace('__ROOT__', JSON.stringify(root)).replace('__DESKTOP__', JSON.stringify(desktop));
    await fs.mkdir(path.join(root, 'user-data'), { recursive: true }); await fs.writeFile(path.join(root, 'runner.cjs'), runner);
    const { createServer, loadConfigFromFile } = require('vite');
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, path.join(desktop, 'vite.config.ts'));
    const flatten = async plugins => (await Promise.all(plugins.map(async plugin => { const value = await plugin; return Array.isArray(value) ? flatten(value) : value; }))).flat(Infinity).filter(Boolean);
    const plugins = (await flatten(loaded.config.plugins)).filter(plugin => plugin.name !== 'vite-plugin-electron');
    const server = await createServer({ ...loaded.config, configFile: false, root: desktop, plugins, cacheDir: path.join(root, 'vite-cache'), server: { host: '127.0.0.1', port: 0, hmr: false } }); await server.listen();
    const environment = { ...process.env, VITE_DEV_SERVER_URL: server.resolvedUrls.local[0], GARDENFLOW_HOLD_AUTOMATION: '1' }; delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [path.join(root, 'runner.cjs')], { cwd: desktop, stdio: 'inherit', env: environment });
    child.on('exit', code => { process.exitCode = code ?? 1; void server.close(); }); child.on('error', error => { console.error(error); process.exitCode = 1; void server.close(); });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
