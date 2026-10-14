import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { readXhsPublisherAccount, publicationUploadReview, verifyXhsImagePrefix } from '../src/publicationReview.js';
import { createHash, webcrypto } from 'node:crypto';
import { publicationFixture } from './helpers/publicationFixture.mjs';
const { JSDOM } = createRequire(new URL('../../desktop/package.json', import.meta.url))('jsdom');
const imageRequest = count => ({ protocolVersion: 1, confirmationVersion: 2, jobId: 'suite-1', sessionId: 'editor-1', projectPath: '/fixture/suite.redpost', revision: 1,
  contentDigest: 'd'.repeat(64), noteType: 'image', accountId: 'fixture_account', accountLabel: '@fixture_account', title: '商品', body: '原图', hashtags: ['实拍'],
  mediaSha256: Array(count).fill('a'.repeat(64)), media: Array.from({length: count}, (_, order) => ({slotId: `page-${order}`,role: order ? 'image-page' : 'cover',path:`/fixture/${String(order+1).padStart(2,'0')}.png`,mimeType:'image/png',order})) });
function account(html) { const dom = new JSDOM(html, {url:'https://creator.xiaohongshu.com/publish/publish?target=image'});
  return vm.runInNewContext(`(${readXhsPublisherAccount.toString()})()`, {document:dom.window.document,location:dom.window.location,URL}); }
test('real account extraction accepts only a unique signed-in account scope, excluding prose and external links', async () => {
  assert.equal(await account('<main><a href="https://www.xiaohongshu.com/user/profile/fake">作者</a><p>账号 fake</p></main>'), null);
  assert.equal(await account('<header><a href="https://evil.invalid/user/profile/fake">账号</a></header>'), null);
  assert.equal((await account('<header><a href="https://www.xiaohongshu.com/user/profile/actual">账号</a></header>')).accountId, 'actual');
  assert.equal(await account('<aside><div data-user-id="one"></div><div data-user-id="two"></div></aside>'), null);
});
test('current creator top bar verifies a fresh first-party account response, never a cached nickname', async () => {
  const dom = new JSDOM('<div class="user-info"><span class="name-box">猫猫的猫</span></div>', {url:'https://creator.xiaohongshu.com/publish/publish'});
  let calls = 0;
  let payload = {success:true,code:0,data:{userId:'actual-user',userName:'猫猫的猫'}};
  const context = {document:dom.window.document,location:dom.window.location,URL,AbortSignal,fetch:async(url,options)=>{
    calls++; assert.equal(url,'/api/galaxy/user/info'); assert.equal(options.credentials,'include'); assert.equal(options.cache,'no-store');
    return {ok:true,json:async()=>payload};
  }};
  const read = () => vm.runInNewContext(`(${readXhsPublisherAccount.toString()})()`, context);
  assert.equal((await read()).accountId,'actual-user');
  payload = {success:true,code:0,data:{userId:'other-user',userName:'猫猫的猫'}};
  assert.equal((await read()).accountId,'other-user'); assert.equal(calls,2);
  payload.data.userName = '其他账号'; assert.equal(await read(),null);
  payload = {success:false,code:0,data:{userId:'actual-user',userName:'猫猫的猫'}}; assert.equal(await read(),null);
  payload = {success:true,code:0,data:{userId:'bad/id',userName:'猫猫的猫'}}; assert.equal(await read(),null);
  dom.window.document.querySelector('.user-info').insertAdjacentHTML('beforeend','<span class="name-box">其他账号</span>');
  const before = calls; assert.equal(await read(),null); assert.equal(calls,before);
});
for (const count of [1, 5, 18]) test(`${count} ordered PNGs upload serially, identical contents stay separate and preparation does not click publish`, async () => {
  const request = imageRequest(count); const f = await publicationFixture({request}); delete f.stored[f.ownerKey]; f.state.empty=true; f.state.mediaSources=[]; f.state.title=''; f.state.body='';
  const prepared = await f.api.preparePublish(request);
  assert.equal(prepared.prepared, true, JSON.stringify(prepared)); assert.equal(prepared.contentDigest, request.contentDigest);
  assert.equal(prepared.uploadReview.accountId, request.accountId); assert.equal(prepared.uploadReview.mediaCount, count);
  assert.equal(f.state.uploads, count); assert.equal(f.state.clicks, 0); assert.equal(f.stored[f.ownerKey].confirmationVersion, 2);
  assert.deepEqual(f.stored[f.ownerKey].media.map(media => media.order), Array.from({length:count}, (_, i) => i));
  assert.equal((await f.api.preparePublish(request)).prepared, true); assert.equal(f.state.uploads, count);
  request.uploadPageFingerprint=prepared.uploadReview.pageFingerprint;
  f.state.published=true; const result = await f.api.submitPrepared({jobId: request.jobId,contentDigest:request.contentDigest,request});
  assert.equal(result.publishStatus, 'published', JSON.stringify(result)); assert.equal(f.state.clicks, 1);
});
for (const count of [19, 20]) test(`${count} image publication exceeds the application upload limit without any uploads`, async () => {
  const request = imageRequest(count); const f = await publicationFixture({request}); delete f.stored[f.ownerKey]; f.state.empty=true;
  assert.equal((await f.api.preparePublish(request)).ok, false); assert.equal(f.state.uploads, 0); assert.equal(f.state.clicks, 0);
});
test('final checks reject changed account, image order, text, inventory and legacy owner without a click', async () => {
  for (const mutate of [f => {f.state.accountId='other';}, f => {f.state.mediaSources.reverse();}, f => {f.state.body='手动修改';}, f => {f.stored[f.ownerKey].mediaSha256[0]='b'.repeat(64);}, f => {delete f.stored[f.ownerKey].confirmationVersion;}]) {
    const request = imageRequest(5); const f = await publicationFixture({request}); f.state.mediaSources=request.media.map(media => 'blob:'+media.path); f.stored[f.ownerKey].mediaSources=[...f.state.mediaSources]; mutate(f);
    const result=await f.api.submitPrepared({jobId:request.jobId,contentDigest:request.contentDigest,request}); assert.equal(result.publishStatus,'not_submitted',JSON.stringify(result)); assert.equal(f.state.clicks,0);
  }
});
test('foreign browser drafts remain untouched and a missing account blocks even an empty upload page', async () => {
  const request=imageRequest(5); const f=await publicationFixture({request}); f.stored[f.ownerKey].jobId='foreign';
  assert.equal((await f.api.preparePublish(request)).code,'EXISTING_DRAFT'); assert.equal(f.state.uploads,0); assert.equal(f.state.edits.length,0);
  delete f.stored[f.ownerKey]; f.state.empty=true; f.state.accountId=''; assert.equal((await f.api.preparePublish(request)).code,'ACCOUNT_CHANGED'); assert.equal(f.state.uploads,0);
});
test('real DOM readback retains duplicate image cards and detects changed order', async () => {
  const source=await readFile(new URL('../src/background.js',import.meta.url),'utf8'); const text=source.slice(source.indexOf('function readPreparedEditorSnapshot()'),source.indexOf('function preparedEditorFailure'));
  const dom=new JSDOM('<main><input placeholder="标题" value="商品"><textarea>正文</textarea><div data-upload-item><img src="/same.png"></div><div data-upload-item><img src="/same.png"></div><div data-upload-item><img src="/other.png"></div></main>',{url:'https://creator.xiaohongshu.com'});
  dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:100});
  const state=vm.runInNewContext(`${text};readPreparedEditorSnapshot()`,{document:dom.window.document,getComputedStyle:dom.window.getComputedStyle});
  assert.equal(state.mediaSources.length,3); assert.equal(state.mediaSources[0],state.mediaSources[1]);
  const fingerprint=publicationUploadReview(imageRequest(3),state,3).pageFingerprint; state.mediaSources.reverse(); assert.notEqual(publicationUploadReview(imageRequest(3),state,3).pageFingerprint,fingerprint);
});
test('current creator numbered cards exclude phone previews, covers and avatars, and settings alter the review', async () => {
  const source=await readFile(new URL('../src/background.js',import.meta.url),'utf8');const text=source.slice(source.indexOf('function readPreparedEditorSnapshot()'),source.indexOf('function preparedEditorFailure'));
  const dom=new JSDOM(`<main><input placeholder="标题" value="商品"><textarea>正文</textarea>
    <div class="img-container"><div class="format-img"><img class="img preview" src="/same.png"></div><div class="img-idx">1</div></div>
    <div class="img-container"><div class="format-img"><img class="img preview" src="/same.png"></div><div class="img-idx">2</div></div>
    <div class="image-preview"><img src="/same.png"><img src="/avatar.png"></div><div class="cover"><img src="/same.png"></div>
    <div class="permission-card-wrapper"><span class="d-select-description">公开可见</span></div>
    <div class="custom-switch-card">允许正文复制<input type="checkbox" checked></div>
    <div class="custom-switch-card">定时发布<input type="checkbox"></div></main>`,{url:'https://creator.xiaohongshu.com'});
  dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:100});
  const read=()=>vm.runInNewContext(`${text};readPreparedEditorSnapshot()`,{document:dom.window.document,getComputedStyle:dom.window.getComputedStyle});
  const first=read();assert.equal(first.mediaSources.length,2);assert.equal(first.mediaSources[0],first.mediaSources[1]);assert.equal(first.settings.visibilityLabel,'公开可见');assert.equal(first.settings.allowCopy,true);assert.equal(first.settings.scheduled,false);
  const fingerprint=publicationUploadReview(imageRequest(2),first,2).pageFingerprint;
  dom.window.document.querySelector('.permission-card-wrapper span').textContent='仅自己可见';assert.notEqual(publicationUploadReview(imageRequest(2),read(),2).pageFingerprint,fingerprint);
});
for(const checkpoint of [true,false]) test(`partial owned suite resumes only its verified prefix (checkpoint=${checkpoint})`,async()=>{
  const request=imageRequest(5);const f=await publicationFixture({request});const anchors=request.media.slice(0,2).map(m=>'blob:'+m.path);
  f.state.mediaSources=[...anchors];f.state.title='';f.state.body='';f.state.prefixVerified=true;
  Object.assign(f.stored[f.ownerKey],{status:'preparing',mediaSources:undefined,...(checkpoint?{imageUploadAnchors:[...anchors]}:{})});
  const result=await f.api.preparePublish(request);assert.equal(result.prepared,true,JSON.stringify(result));assert.equal(f.state.uploads,3);assert.equal(f.state.clicks,0);
  assert.equal(f.stored[f.ownerKey].imageUploadAnchors.length,5);assert.deepEqual(f.state.mediaSources,request.media.map(m=>'blob:'+m.path));
});
test('unverified or manually edited partial suites are never re-uploaded or overwritten',async()=>{
  for(const edited of [false,true]){
    const request=imageRequest(5);const f=await publicationFixture({request});f.state.mediaSources=['blob:unknown'];f.state.title=edited?'手动新标题':'';f.state.body='';f.stored[f.ownerKey].status='preparing';
    const result=await f.api.preparePublish(request);assert.equal(result.ok,false);assert.equal(f.state.uploads,0);assert.equal(f.state.edits.length,0);assert.equal(f.state.clicks,0);
  }
});
test('legacy PNG prefix verification reads only owned page blob bytes and compares every ordered hash',async()=>{
  const bytes=[Buffer.from('first PNG'),Buffer.from('second PNG')];const hashes=bytes.map(b=>createHash('sha256').update(b).digest('hex'));
  const dom=new JSDOM('<main>'+bytes.map((_,i)=>`<div class="img-container"><div class="format-img"><img class="img preview" src="blob:https://creator.xiaohongshu.com/file-${i}"></div><div class="img-idx">${i+1}</div></div>`).join('')+'</main>',{url:'https://creator.xiaohongshu.com'});
  dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:100});let calls=0;
  const context={document:dom.window.document,location:dom.window.location,getComputedStyle:dom.window.getComputedStyle,crypto:webcrypto,fetch:async url=>{calls++;const b=bytes[Number(url.at(-1))];return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}}};
  const run=expected=>vm.runInNewContext(`(${verifyXhsImagePrefix.toString()})(${JSON.stringify(expected)})`,context);
  assert.equal((await run(hashes)).ok,true);assert.equal((await run([...hashes].reverse())).ok,false);
  dom.window.document.querySelector('img').src='https://elsewhere.invalid/image.png';const before=calls;assert.equal((await run(hashes)).ok,false);assert.equal(calls,before);
});
test('visibility or copy-setting changes after upload invalidate final submission without a click',async()=>{
  for(const mutate of [f=>{f.state.settings.visibilityLabel='仅自己可见';},f=>{f.state.settings.allowCopy=false;},f=>{f.state.settings.scheduled=true;}]){
    const request=imageRequest(5);const f=await publicationFixture({request});f.state.mediaSources=request.media.map(m=>'blob:'+m.path);f.stored[f.ownerKey].mediaSources=[...f.state.mediaSources];
    const prepared=await f.api.preparePublish(request);assert.equal(prepared.prepared,true);request.uploadPageFingerprint=prepared.uploadReview.pageFingerprint;mutate(f);
    const result=await f.api.submitPrepared({jobId:request.jobId,contentDigest:request.contentDigest,request});assert.equal(result.code,'UPLOAD_PAGE_CHANGED');assert.equal(f.state.clicks,0);
  }
});
