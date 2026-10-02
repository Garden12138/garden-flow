import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as adapter from '../../src/pageAdapter.js';

// Chrome's persisted dictionaries return keys in a different order from the
// request object. Also detach values so tests do not bypass serialization.
export function storageRoundTrip(value) {
  if (Array.isArray(value)) return value.map(storageRoundTrip);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, storageRoundTrip(value[key])]));
  return value;
}

// Real plugin lifecycle; only Chrome transport, DOM and trusted click are fakes.
export async function publicationFixture({ rejected = false, published = false, request: supplied } = {}) {
  const request = supplied || { protocolVersion: 1, jobId: 'old-job', sessionId: 's1', projectPath: '/fixture/note', revision: 2, contentDigest: 'a'.repeat(64), noteType: 'video', title: '海洋鱼味猫粮', body: '正文', hashtags: [], media: [{ slotId: 'final-video', role: 'video', path: '/fixture/video.mp4', mimeType: 'video/mp4', order: 0 }] };
  const ownerKey = 'gardenflowXhsPublisherPreparedJob';
  const stored = { [ownerKey]: { ...request, tabId: 1, status: 'prepared', mediaSources: ['blob:fixture'] } };
  const state = { request, clicks: 0, publishAfterClicks: 1, navigations: 0, queries: 0, uploads: 0, empty: false, rejected, published,
    title: request.title, body: adapter.buildBody(request.body, request.hashtags), mediaSources: ['blob:fixture'], mediaFileNames: [], mediaBusy: false, edits: [], events: [], beforeSubmit: null };
  const noopEvent = { addListener() {} };
  let time = 0;
  class Clock extends Date { static now() { time += 10000; return time; } }
  const chrome = {
    runtime: { onMessage: noopEvent, onInstalled: noopEvent, onStartup: noopEvent, connectNative() { throw new Error('isolated'); } },
    alarms: { onAlarm: noopEvent, create: async () => {} },
    storage: { local: { get: async key => ({ [key]: storageRoundTrip(stored[key]) }), set: async values => Object.assign(stored, storageRoundTrip(values)), remove: async key => { delete stored[key]; } } },
    tabs: { query: async () => { state.queries += 1; return [{ id: 1, url: adapter.buildPublishModeUrl('video') }]; }, update: async () => { state.navigations += 1; state.empty = true; } },
    scripting: { executeScript: async ({ func, args }) => {
      if (func.name === 'probePage') return [{ result: { successPage: state.published && state.clicks >= state.publishAfterClicks && !state.empty,
        editorReady: !state.empty && !(state.published && state.clicks >= state.publishAfterClicks), hasDraft: !state.empty,
        titleValue: state.empty ? '' : state.title, bodyValue: state.empty ? '' : state.body,
        validationErrors: state.clicks && state.rejected ? ['标题字段未通过校验'] : [], href: adapter.buildPublishModeUrl('video'),
        uploadLandingEvidence: { publishPath: '/publish/publish', publishTarget: 'video', hasTitleInput: !state.empty, editableCount: state.empty ? 0 : 1, fileInputCount: 1, videoUploadAction: true, videoUploadPrompt: true } } }];
      if (func.name === 'readPreparedEditorSnapshot') return [{ result: { titleValue: state.title, bodyValue: state.body, mediaBusy: state.mediaBusy, mediaSources: state.mediaSources, mediaFileNames: state.mediaFileNames, validationErrors: [] } }];
      if (func.name === 'fillEditor') {
        state.edits.push(args[0]);
        state.events.push(...Object.keys(args[0]));
        if (typeof args[0].title === 'string') state.title = args[0].title;
        if (typeof args[0].body === 'string') state.body = args[0].body;
        return [{ result: { ok: true } }];
      }
      throw new Error(`Unexpected page function: ${func.name}`);
    } },
  };
  const context = vm.createContext({ ...adapter, chrome, testState: state, Date: Clock, URL, console, setTimeout: callback => { callback(); return 1; }, clearTimeout() {} });
  const source = (await readFile(new URL('../../src/background.js', import.meta.url), 'utf8'))
    .replace(/^import \{[\s\S]*?\} from '\.\/pageAdapter\.js';/, '')
    .replace(/^import \{[^\n]+\} from '\.\/douyinPublisher\.js';/m, '');
  vm.runInContext(`${source}\ndispatchTrustedPublishClick = async () => { testState.beforeSubmit={title:testState.title,body:testState.body,mediaSources:[...testState.mediaSources]}; testState.events.push('submit'); testState.clicks += 1; return {ok:true,clickObserved:true,mayHaveDispatched:true}; }; globalThis.testApi = {publish, submitPrepared};`, context);
  return { state, stored, ownerKey, api: context.testApi };
}
