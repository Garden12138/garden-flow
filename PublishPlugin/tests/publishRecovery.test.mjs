import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as adapter from '../src/pageAdapter.js';
import { publicationFixture } from './helpers/publicationFixture.mjs';

// Run the real background lifecycle against isolated Chrome storage/page
// adapters. No real browser, native transport, upload or publication is used.
async function fixture({ rejected = false } = {}) {
  const request = { protocolVersion: 1, jobId: 'old-job', sessionId: 's1', projectPath: '/fixture/note', revision: 2, contentDigest: 'a'.repeat(64), noteType: 'video', title: '海洋鱼味猫粮', body: '正文', hashtags: [], media: [{ slotId: 'final-video', role: 'video', path: '/fixture/video.mp4', mimeType: 'video/mp4', order: 0 }] };
  const ownerKey = 'gardenflowXhsPublisherPreparedJob';
  const stored = { [ownerKey]: { jobId: request.jobId, contentDigest: request.contentDigest, tabId: 1, noteType: 'video', status: 'prepared', mediaSources: ['blob:fixture'] } };
  const state = { request, clicks: 0, navigations: 0, queries: 0, empty: false, rejected, title: request.title,
    body: request.body, mediaSources: ['blob:fixture'], mediaBusy: false, edits: [] };
  const noopEvent = { addListener() {} };
  let time = 0;
  class Clock extends Date { static now() { time += 10000; return time; } }
  const chrome = {
    runtime: { onMessage: noopEvent, onInstalled: noopEvent, onStartup: noopEvent, connectNative() { throw new Error('isolated'); } },
    alarms: { onAlarm: noopEvent, create: async () => {} },
    storage: { local: { get: async key => ({ [key]: stored[key] }), set: async values => Object.assign(stored, values), remove: async key => { delete stored[key]; } } },
    tabs: { query: async () => { state.queries += 1; return [{ id: 1, url: adapter.buildPublishModeUrl('video') }]; }, update: async () => { state.navigations += 1; state.empty = true; } },
    scripting: { executeScript: async ({ func, args }) => {
      if (func.name === 'probePage') return [{ result: { editorReady: !state.empty, hasDraft: !state.empty, titleValue: state.empty ? '' : state.title, bodyValue: state.empty ? '' : '正文',
        validationErrors: state.clicks && state.rejected ? ['标题字段未通过校验'] : [], href: adapter.buildPublishModeUrl('video'),
        uploadLandingEvidence: { publishPath: '/publish/publish', publishTarget: 'video', hasTitleInput: !state.empty, editableCount: state.empty ? 0 : 1, fileInputCount: 1, videoUploadAction: true, videoUploadPrompt: true } } }];
      if (func.name === 'readPreparedEditorSnapshot') return [{ result: { titleValue: state.title, bodyValue: state.body, mediaBusy: state.mediaBusy, mediaSources: state.mediaSources, validationErrors: [] } }];
      if (func.name === 'fillEditor') {
        state.edits.push(args[0]);
        if (typeof args[0].title === 'string') state.title = args[0].title;
        if (typeof args[0].body === 'string') state.body = args[0].body;
        return [{ result: { ok: true } }];
      }
      throw new Error(`Unexpected page function: ${func.name}`);
    } },
  };
  const context = vm.createContext({ ...adapter, chrome, testState: state, Date: Clock, URL, console, setTimeout: callback => { callback(); return 1; }, clearTimeout() {} });
  const source = (await readFile(new URL('../src/background.js', import.meta.url), 'utf8'))
    .replace(/^import \{[\s\S]*?\} from '\.\/pageAdapter\.js';/, '')
    .replace(/^import \{[^\n]+\} from '\.\/douyinPublisher\.js';/m, '');
  vm.runInContext(`${source}\ndispatchTrustedPublishClick = async () => { testState.clicks += 1; return {ok:true,clickObserved:true,mayHaveDispatched:true}; }; globalThis.testApi = {publish, submitPrepared};`, context);
  return { state, stored, ownerKey, api: context.testApi };
}

test('real plugin prepare blocks a long title without inspecting or uploading to a tab', async () => {
  const f = await fixture();
  const result = await f.api.publish({ phase: 'prepare', request: { ...f.state.request, title: '原料透明的成猫粮｜伟嘉海洋鱼夹心10kg大袋装' } });
  assert.equal(result.code, 'TITLE_TOO_LONG');
  assert.equal(f.state.queries, 0);
  assert.equal(f.state.clicks, 0);
});

const amendment = f => ({ phase: 'amend', previous: f.state.request, acknowledgedNotPublished: true,
  request: { ...f.state.request, jobId: 'new-job', revision: 4, contentDigest: 'b'.repeat(64), title: '伟嘉海洋鱼味猫粮10kg' } });

test('a reviewed retry survives persisted media key reordering through amendment, prepare and one submit', async () => {
  const f = await publicationFixture();
  const first = amendment(f);
  const prepare = request => f.api.publish({ phase: 'prepare', request });
  const submit = request => f.api.publish({ phase: 'submit', jobId: request.jobId, contentDigest: request.contentDigest, request });
  assert.equal((await f.api.publish(first)).prepared, true);
  assert.equal((await prepare(first.request)).prepared, true);
  assert.equal((await submit(first.request)).publishStatus, 'unknown');
  assert.equal(f.state.clicks, 1);
  assert.deepEqual(Object.keys(f.stored[f.ownerKey].media[0]), ['mimeType', 'order', 'path', 'role', 'slotId']);
  const retry = { ...first, previous: first.request, request: { ...first.request, jobId: 'retry-job', revision: 5, contentDigest: 'c'.repeat(64) } };
  assert.equal((await f.api.publish({ ...retry, acknowledgedNotPublished: false })).code, 'SUBMISSION_REVIEW_REQUIRED');
  assert.equal((await f.api.publish(retry)).prepared, true);
  assert.equal(f.state.clicks, 1, 'recovery alone must not submit');
  assert.equal((await prepare(retry.request)).prepared, true);
  f.state.publishAfterClicks = f.state.clicks + 1;
  f.state.published = true;
  assert.equal((await submit(retry.request)).publishStatus, 'published');
  assert.equal((await submit(retry.request)).publishStatus, 'published');
  assert.equal(f.state.clicks, 2, 'one click per authorized attempt');
  assert.equal(f.state.uploads, 0);
});

test('conversation amendment overwrites an intentional title edit, preserves media/body and never submits', async () => {
  const f = await fixture();
  f.stored[f.ownerKey].status = 'submitting';
  f.state.title = '标题已人工改过';
  const payload = amendment(f);
  assert.equal((await f.api.publish({...payload,acknowledgedNotPublished:false})).code,'SUBMISSION_REVIEW_REQUIRED');
  assert.equal(f.state.edits.length,0);
  const result = await f.api.publish(payload);
  assert.equal(result.prepared,true);
  assert.equal(f.state.title,payload.request.title);
  assert.equal(f.state.body,f.state.request.body);
  assert.deepEqual(f.state.mediaSources,['blob:fixture']);
  assert.deepEqual(Object.keys(f.state.edits[0]),['title']);
  assert.equal(f.state.navigations,0);
  assert.equal(f.state.clicks,0);
  assert.equal(f.stored[f.ownerKey].jobId,'new-job');
  assert.equal((await f.api.publish(payload)).prepared,true);
  assert.equal(f.state.edits.length,1);
});

test('legacy task can amend title after review using original body and media anchor', async () => {
  const f = await fixture();
  delete f.stored[f.ownerKey].mediaSources;
  f.state.request.title = '原料透明的成猫粮｜伟嘉海洋鱼夹心10kg大袋装';
  f.state.title = '不必恢复原来的长标题';
  assert.equal((await f.api.publish(amendment(f))).prepared,true);
  assert.equal(f.state.navigations,0);
});

test('published plugin receipt cannot be overridden by an unpublished user assertion', async () => {
  const f = await fixture();
  f.stored.gardenflowXhsPublisherResults = { 'old-job': {ok:true,jobId:'old-job',publishStatus:'published',resetStatus:'ready'} };
  assert.equal((await f.api.publish(amendment(f))).code,'ALREADY_PUBLISHED');
  assert.equal(f.state.edits.length,0);
  assert.equal(f.state.clicks,0);
});

test('amendment blocks busy/replaced media, unrelated ownership and unrequested copy changes', async () => {
  for (const code of ['MEDIA_PROCESSING','PREPARED_MEDIA_CHANGED','PREPARED_JOB_NOT_FOUND','UNREQUESTED_COPY_CHANGED','LEGACY_BODY_CHANGED']) {
    const f = await fixture();
    if(code === 'MEDIA_PROCESSING') f.state.mediaBusy = true;
    if(code === 'PREPARED_MEDIA_CHANGED') f.state.mediaSources = ['blob:other'];
    if(code === 'PREPARED_JOB_NOT_FOUND') f.stored[f.ownerKey].jobId = 'foreign';
    if(code === 'UNREQUESTED_COPY_CHANGED') f.state.body = '网页手改正文';
    if(code === 'LEGACY_BODY_CHANGED') { delete f.stored[f.ownerKey].mediaSources; f.state.body = '其他草稿'; }
    assert.equal((await f.api.publish(amendment(f))).code,code);
    assert.equal(f.state.edits.length,0);
    assert.equal(f.state.navigations,0);
    assert.equal(f.state.clicks,0);
  }
});

test('reviewed legacy video restores confirmed copy despite platform topic footer and no video src', async () => {
  const f = await publicationFixture({ published: true });
  delete f.stored[f.ownerKey].mediaSources;
  f.stored[f.ownerKey].status = 'submitting';
  f.state.mediaSources = [];
  f.state.mediaFileNames = ['video.mp4'];
  f.state.body = '正文\n#原料透明猫粮[话题]#';
  f.state.request.hashtags = ['原料透明'];
  const payload = { ...amendment(f), copyPolicy: 'replace-confirmed-copy' };
  assert.equal((await f.api.publish(payload)).prepared, true);
  assert.deepEqual(f.state.events, ['title', 'body']);
  assert.equal(f.state.body, '正文\n#原料透明');
  assert.deepEqual(Array.from(f.stored[f.ownerKey].mediaFileNames), ['video.mp4']);
  assert.equal(f.state.clicks, 0);
  assert.equal(f.state.uploads, 0);
  assert.equal((await f.api.publish({ phase: 'prepare', request: payload.request })).prepared, true);
  assert.equal((await f.api.publish({ phase: 'submit', jobId: payload.request.jobId,
    contentDigest: payload.request.contentDigest, request: payload.request })).publishStatus, 'published');
  assert.equal(f.state.clicks, 1);
});

test('legacy topic recovery requires explicit copy policy, review, identical prose and exact single video label', async () => {
  for (const scenario of ['policy', 'review', 'prose', 'file', 'missing', 'multiple']) {
    const f = await publicationFixture();
    delete f.stored[f.ownerKey].mediaSources;
    f.stored[f.ownerKey].status = 'submitting';
    f.state.body = '正文\n#原料透明猫粮[话题]#';
    f.state.mediaSources = [];
    f.state.mediaFileNames = ['video.mp4'];
    const payload = { ...amendment(f), copyPolicy: 'replace-confirmed-copy' };
    if (scenario === 'policy') delete payload.copyPolicy;
    if (scenario === 'review') payload.acknowledgedNotPublished = false;
    if (scenario === 'prose') f.state.body = '正文事实已改\n#原料透明猫粮[话题]#';
    if (scenario === 'file') f.state.mediaFileNames = ['other.mp4'];
    if (scenario === 'missing') f.state.mediaFileNames = [];
    if (scenario === 'multiple') f.state.mediaFileNames.push('other.mp4');
    assert.equal((await f.api.publish(payload)).ok, false, scenario);
    assert.equal(f.state.clicks, 0, scenario);
    assert.equal(f.state.edits.length, 0, scenario);
    assert.equal(f.state.navigations, 0, scenario);
  }
});

test('video filename is rechecked before submit even when the page has no video src', async () => {
  const f = await publicationFixture();
  delete f.stored[f.ownerKey].mediaSources;
  f.state.mediaSources = [];
  f.state.mediaFileNames = ['video.mp4'];
  const payload = amendment(f);
  assert.equal((await f.api.publish(payload)).prepared, true);
  f.state.mediaFileNames = ['other.mp4'];
  const result = await f.api.publish({ phase: 'submit', jobId: payload.request.jobId,
    contentDigest: payload.request.contentDigest, request: payload.request });
  assert.equal(result.code, 'PREPARED_MEDIA_CHANGED');
  assert.equal(f.state.clicks, 0);
});

test('missing legacy video evidence is reported separately from changed body', async () => {
  const f = await publicationFixture();
  delete f.stored[f.ownerKey].mediaSources;
  f.state.mediaSources = [];
  assert.equal((await f.api.publish(amendment(f))).code, 'LEGACY_MEDIA_UNVERIFIED');
  assert.equal(f.state.edits.length, 0);
});

test('real plugin recovery requires acknowledgement, verifies legacy copy and never clicks publish', async () => {
  const f = await fixture();
  f.stored[f.ownerKey].status = 'submitting';
  f.state.title = '原料透明的成猫粮｜伟嘉海洋鱼夹心10kg大袋装';
  f.state.request.title = f.state.title;
  const payload = { phase: 'recover', jobId: f.state.request.jobId, contentDigest: f.state.request.contentDigest, noteType: 'video', request: f.state.request };
  assert.equal((await f.api.publish(payload)).code, 'SUBMISSION_REVIEW_REQUIRED');
  assert.equal(f.state.navigations, 0);
  const result = await f.api.publish({ ...payload, acknowledgedNotPublished: true });
  assert.equal(result.discarded, true);
  assert.equal(f.state.navigations, 1);
  assert.equal(f.state.clicks, 0);
  assert.equal(f.stored[f.ownerKey], undefined);
});

test('real plugin recovery preserves a manually edited or unrelated draft', async () => {
  const f = await fixture();
  f.state.title = '人工改过的标题';
  const payload = { phase: 'recover', jobId: f.state.request.jobId, contentDigest: f.state.request.contentDigest, noteType: 'video', request: f.state.request, acknowledgedNotPublished: true };
  assert.equal((await f.api.publish(payload)).code, 'PREPARED_EDITOR_CHANGED');
  f.stored[f.ownerKey].jobId = 'another-job';
  assert.equal((await f.api.publish(payload)).code, 'PREPARED_JOB_NOT_FOUND');
  assert.equal(f.state.navigations, 0);
});

test('explicit post-click field rejection is blocked, while an unchanged page remains unknown', async () => {
  const rejected = await fixture({ rejected: true });
  const payload = f => ({ phase: 'submit', jobId: f.state.request.jobId, contentDigest: f.state.request.contentDigest, request: f.state.request });
  const result = await rejected.api.submitPrepared(payload(rejected));
  assert.equal(result.code, 'EDITOR_VALIDATION_FAILED');
  assert.equal(result.publishStatus, 'not_submitted');
  assert.equal(rejected.stored[rejected.ownerKey].status, 'prepared');
  const ambiguous = await fixture();
  const unknown = await ambiguous.api.submitPrepared(payload(ambiguous));
  assert.equal(unknown.code, 'SUBMISSION_FEEDBACK_MISSING');
  assert.equal(unknown.publishStatus, 'unknown');
  assert.equal(ambiguous.state.clicks, 1);
  assert.equal((await ambiguous.api.submitPrepared(payload(ambiguous))).publishStatus, 'unknown');
  assert.equal(ambiguous.state.clicks, 1);
});
