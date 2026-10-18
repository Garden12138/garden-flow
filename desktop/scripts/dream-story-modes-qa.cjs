// Isolated backend/render integration. No DOM interaction, paid services or publishing.
// node desktop/scripts/dream-story-modes-qa.cjs /private/tmp/dream-modes [packaged Resources/app.asar] [reopen]
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { build } = require('esbuild');
const desktop = path.resolve(__dirname, '..');
const root = path.resolve(process.argv[2] || '');
const appRoot = process.argv[3] ? path.resolve(process.argv[3]) : desktop;
const reopen = process.argv[4] === 'reopen';
const finalOnly = process.argv[5] === 'final-only';
if (!root.startsWith('/private/tmp/') && !root.startsWith('/tmp/')) throw new Error('Use a new temporary directory');
async function main() {
    await fs.mkdir(path.join(root, 'user-data'), { recursive: true });
    const ffmpeg = require('ffmpeg-static');
    if (!reopen) {
        const clip = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=90x160:r=30:d=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'clip.mp4')]);
        if (clip.status !== 0) throw new Error(clip.stderr.toString());
        const image = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x344d4a:s=90x160', '-frames:v', '1', path.join(root, 'key.png')]);
        if (image.status !== 0) throw new Error(image.stderr.toString());
    }
    await build({ stdin: { contents: `export * from './electron/core/dreamStoryStore'; export * from './electron/core/dreamStoryMediaService'; export * from './electron/core/dreamStoryRenderService'; export * from './electron/core/dreamStoryTransferService'; export { saveSettings, getSettings } from './electron/db'; export { resolveDreamStoryTarget } from './shared/contentCreationTarget';`, resolveDir: desktop }, outfile: path.join(root, 'domain.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external', define: { 'import.meta.url': JSON.stringify(`file://${desktop}/package.json`) }, banner: { js: `module.paths.unshift(${JSON.stringify(path.join(desktop, 'node_modules'))});` } });
    const runner = `
const { app } = require('electron');const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');const root=${JSON.stringify(root)};const appRoot=${JSON.stringify(appRoot)};const reopen=${reopen};const finalOnly=${finalOnly};
process.env.GARDENFLOW_USER_DATA_DIR=path.join(root,'user-data');process.env.GARDENFLOW_HOLD_AUTOMATION='1';app.setPath('userData',process.env.GARDENFLOW_USER_DATA_DIR);app.setPath('sessionData',process.env.GARDENFLOW_USER_DATA_DIR);app.getAppPath=()=>appRoot;
${appRoot.endsWith('.asar') ? "Object.defineProperty(app,'isPackaged',{value:true});Object.defineProperty(process,'resourcesPath',{value:path.dirname(appRoot)});" : ''}
app.on('window-all-closed',()=>{});
const request=p=>({spaceId:p.dreamStory.spaceId,projectId:p.id,requestId:require('node:crypto').randomUUID(),expectedRevision:p.dreamStory.revision,expectedDraftEpoch:p.dreamStory.draftEpoch,targetDigest:p.dreamStory.targetDigest});
(async()=>{await app.whenReady();const api=require('./domain.cjs');api.saveSettings({workspace_dir:path.join(root,'workspace'),active_space_id:'default',proxy_enabled:0,video_generation_enabled:false});
let results=[];
if(reopen){results=JSON.parse(await fs.readFile(path.join(root,'results.json'),'utf8'));for(const item of results){const p=await api.readDreamStory(item.projectId);assert.equal(p.version,4);assert.equal(p.dreamStory.target.compositionMode,item.mode);const checked=await api.currentDreamExport(p.id);assert.equal(checked.output.outputSha256,item.finalSha256);assert.equal(p.timeline.tracks[0].clips.filter(clip=>p.assets.find(asset=>asset.id===clip.assetId)?.kind==='video').length,item.expectedVideos);await api.exportDreamStory(p.id,path.join(root,item.mode+'-share.zip'),'share',false);await api.exportDreamStory(p.id,path.join(root,item.mode+'.md'),'markdown',false);}}
else{const n=48000;const wav=Buffer.alloc(44+n*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)wav.writeInt16LE(Math.round(Math.sin(i*440*Math.PI*2/24000)*3000),44+i*2);await fs.writeFile(path.join(root,'voice.wav'),wav);
for(const mode of ['story-keyframes','story-hybrid','story-video']){
let p=await api.createDreamStory('Synthetic '+mode);p=await api.applyDreamEdit({...request(p),operations:[{type:'record.save',fragments:[{id:'synthetic',text:'合成素材：发光钥匙与海。',locked:true}]},{type:'target.confirm',target:api.resolveDreamStoryTarget({compositionMode:mode,voiceId:'fixture'})}]});
const director={schemaVersion:2,settings:[{id:'sea',description:'A quiet sea',referenceAssetIds:[],revision:1}],title:'Synthetic '+mode,language:'en',story:'A luminous key floats above a quiet sea.',emotionalArc:['quiet','wonder'],preservedFragmentIds:['synthetic'],creativeAdditions:[],visualStyle:'Synthetic blue portrait test',characters:[],scenes:Array.from({length:8},(_,i)=>({id:'scene_'+i,fragmentIds:['synthetic'],characterIds:[],settingId:'sea',continuity:i===0?'cut':'continue',mediaType:mode==='story-video'||mode==='story-hybrid'&&[2,6].includes(i)?'video':'image',videoPrompt:'Synthetic key motion',videoReason:'Synthetic motion test',visual:'A key above the sea',narration:'A synthetic tone accompanies the sea.',imagePrompt:'Synthetic blue portrait key',plannedDurationMs:9000,motion:'slow-zoom-in',locked:false})),publication:{description:'Synthetic local validation',hashtags:['Synthetic']}};
const candidate=await api.saveDreamCandidate(request(p),director);p=await api.applyDreamEdit({...request(p),operations:[{type:'candidate.adopt',candidateId:candidate.id}]});p=await api.applyDreamEdit({...request(p),operations:[{type:'story.adopt'},{type:'storyboard.adopt'}]});
for(const scene of director.scenes){await api.bindDreamMedia(p.id,scene.id,'image',path.join(root,'key.png'));p=await api.readDreamStory(p.id);await api.approveDreamImage({...request(p),sceneId:scene.id});await api.bindDreamMedia(p.id,scene.id,'audio',path.join(root,'voice.wav'));}
for(const scene of director.scenes.filter(scene=>scene.mediaType==='video')){await api.bindDreamMedia(p.id,scene.id,'video',path.join(root,'clip.mp4'));p=await api.readDreamStory(p.id);await api.approveDreamImage({...request(p),sceneId:scene.id,kind:'video'});}
p=await api.readDreamStory(p.id);const expectedVideos=mode==='story-video'?8:mode==='story-hybrid'?2:0;assert.equal(p.timeline.tracks[0].clips.filter(clip=>p.assets.find(asset=>asset.id===clip.assetId)?.kind==='video').length,expectedVideos);
const outputs={};let lastProgress='';for(const preview of (finalOnly?[false]:[true,false])){p=await api.readDreamStory(p.id);const result=await api.renderDreamStory({...request(p),preview},progress=>{const key=progress.stage+' '+progress.percent;if(progress.percent%25===0&&key!==lastProgress){lastProgress=key;console.log(mode+' '+key);}});outputs[preview?'preview':'final']=result.outputPath;}
await api.exportDreamStory(p.id,path.join(root,mode+'-share.zip'),'share',false);const checked=await api.currentDreamExport(p.id);results.push({mode,projectId:p.id,expectedVideos,...outputs,finalSha256:checked.output.outputSha256,durationMs:checked.project.timeline.durationMs,paidCalls:0,uploads:0,submissions:0});await fs.writeFile(path.join(root,'results.json'),JSON.stringify(results,null,2));
}}
await fs.writeFile(path.join(root,reopen?'reopen-result.json':'create-result.json'),JSON.stringify({ok:true,finalOnly,packagedResources:appRoot.endsWith('.asar'),reopen,results},null,2));console.log('DREAM_MODES_QA_SUCCESS');app.exit(0);
})().catch(async error=>{console.error(error);await fs.writeFile(path.join(root,'failure.txt'),String(error.stack||error));app.exit(1);});
`;
    await fs.writeFile(path.join(root, 'runner.cjs'), runner);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [path.join(root, 'runner.cjs')], { cwd: desktop, env, stdio: 'inherit' });
    child.on('exit', code => { process.exitCode = code === null ? 1 : code; });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
