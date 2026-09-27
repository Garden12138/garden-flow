import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as adapter from '../src/pageAdapter.js';

// Run the real CDP dispatch and submit lifecycle, including the actual
// function declarations called on the selected closed-shadow button. Only
// browser transport/DOM/platform feedback are isolated, no real posting.
const source = (await readFile(new URL('../src/background.js', import.meta.url), 'utf8'))
  .replace(/^import \{[\s\S]*?\} from '\.\/pageAdapter\.js';/, '');

function fixture(options = {}) {
  const request = { protocolVersion: 1, jobId: 'job1', sessionId: 's1', projectPath: '/fixture/note', revision: 1,
    contentDigest: 'a'.repeat(64), noteType: 'video', title: '短标题', body: '正文', hashtags: [],
    media: [{ slotId: 'final-video', role: 'video', path: '/fixture/video.mp4', mimeType: 'video/mp4', order: 0 }] };
  const ownerKey = 'gardenflowXhsPublisherPreparedJob';
  const stored = { [ownerKey]: { ...request, tabId: 1, status: 'prepared', mediaSources: [], mediaFileNames: ['video.mp4'] } };
  const state = { calls: [], pressed: 0, released: 0, scrolled: false, empty: false, covered: options.covered === true,
    listeners: new Set(), rect: { left: 500, right: 620, top: 3500, bottom: 3540, width: 120, height: 40 } };
  const label = {};
  const document = { elementFromPoint: () => state.covered || options.coverOutsideShadow ? {} : host };
  const host = { getRootNode: () => document, contains: () => false };
  const root = { host, elementFromPoint: () => state.covered ? {} : label };
  const button = { isConnected: true, disabled: false, textContent: '发布',
    getAttribute: () => null, getBoundingClientRect: () => state.rect,
    contains: item => item === label,
    getRootNode: () => root,
    addEventListener: (_type, fn) => state.listeners.add(fn), removeEventListener: (_type, fn) => state.listeners.delete(fn) };
  button.ownerDocument = document;
  const window = { innerWidth: 1000, innerHeight: 800 };
  window.top = window;
  let time = 0;
  class Clock extends Date { static now() { time += 500; return time; } }
  const domContext = vm.createContext({ window, getComputedStyle: () => ({ display: 'block', visibility: 'visible', pointerEvents: 'auto' }) });
  const noop = { addListener() {} };
  const chrome = {
    runtime: { onMessage: noop, onInstalled: noop, onStartup: noop, connectNative() { throw new Error('isolated'); } },
    alarms: { create: async () => {}, onAlarm: noop },
    storage: { local: { get: async key => ({ [key]: stored[key] }), set: async values => Object.assign(stored, values), remove: async key => { delete stored[key]; } } },
    tabs: { query: async () => [{ id: 1, url: adapter.buildPublishModeUrl('video') }], update: async () => { state.empty = true; } },
    scripting: { executeScript: async ({ func }) => {
      if (func.name === 'probePage') {
        const attempted = state.released > 0;
        const success = attempted && options.feedback === 'published' && !state.empty;
        return [{ result: { editorReady: !state.empty && !success, hasDraft: !state.empty, successPage: success,
          securityChallenge: attempted && options.feedback === 'captcha',
          validationErrors: attempted && options.feedback === 'invalid' ? ['标题校验失败'] : [],
          pageAlerts: attempted && options.feedback === 'alert' ? ['网络错误，请稍后再试'] : [],
          uploadLandingEvidence: { publishPath: '/publish/publish', publishTarget: 'video', hasTitleInput: !state.empty,
            editableCount: state.empty ? 0 : 1, videoUploadAction: true, videoUploadPrompt: true } } }];
      }
      if (func.name === 'readPreparedEditorSnapshot') return [{ result: { titleValue: request.title, bodyValue: request.body,
        validationErrors: [], mediaBusy: false, mediaSources: [], mediaFileNames: ['video.mp4'] } }];
      throw new Error(`Unexpected injected function ${func.name}`);
    } },
    debugger: { attach: async () => {}, detach: async () => {}, sendCommand: async (_target, method, params = {}) => {
      state.calls.push({ method, params });
      if (method === 'DOM.getFlattenedDocument') return { nodes: [{ nodeId: 1, backendNodeId: 102, nodeType: 1, nodeName: 'BUTTON',
        attributes: ['aria-label', '发布'], children: [] }] };
      if (method === 'Accessibility.getFullAXTree') return { nodes: [{ backendDOMNodeId: 102, role: { value: 'button' }, name: { value: '发布' }, properties: [] }] };
      if (method === 'DOM.getBoxModel') return { model: { border: [500, state.rect.top, 620, state.rect.top, 620, state.rect.bottom, 500, state.rect.bottom] } };
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientHeight: 800 } };
      if (method === 'DOM.scrollIntoViewIfNeeded') { state.scrolled = true; if (!options.offscreen) Object.assign(state.rect, { top: 480, bottom: 520 }); }
      if (method === 'DOM.resolveNode') return { object: { objectId: 'button-object' } };
      if (method === 'Runtime.callFunctionOn') {
        const fn = vm.runInContext(`(${params.functionDeclaration})`, domContext);
        return { result: { value: fn.apply(button, params.arguments.map(arg => arg.value)) } };
      }
      if (method === 'Input.dispatchMouseEvent') {
        if (params.type === 'mouseMoved' && options.coverAfterHover) state.covered = true;
        if (params.type === 'mousePressed') {
          state.pressed += 1;
          if (options.pressError) throw new Error('Transport lost during press');
        }
        if (params.type === 'mouseReleased') {
          state.released += 1;
          if (options.emitClick !== false) for (const fn of state.listeners) fn({ isTrusted: options.trusted !== false,
            button: 0, clientX: params.x, clientY: params.y });
        }
      }
      return {};
    } },
  };
  const context = vm.createContext({ ...adapter, chrome, crypto, Date: Clock, URL, console,
    setTimeout: fn => { fn(); return 1; }, clearTimeout() {} });
  vm.runInContext(`${source}\nglobalThis.api={dispatchTrustedPublishClick,submitPrepared};`, context);
  const submit = () => context.api.submitPrepared({ phase: 'submit', jobId: request.jobId, contentDigest: request.contentDigest, request });
  return { state, stored, ownerKey, button, api: context.api, submit };
}

test('actual dispatcher scrolls and verifies the closed-shadow button, observes a trusted click and cleans up', async () => {
  const f = fixture();
  const result = await f.api.dispatchTrustedPublishClick(1);
  assert.equal(result.clickObserved, true);
  assert.equal(f.state.scrolled, true);
  assert.equal(f.state.pressed, 1);
  assert.equal(f.state.released, 1);
  const press = f.state.calls.find(item => item.params.type === 'mousePressed');
  assert.equal(press.params.x, 560);
  assert.equal(press.params.y, 500); // not the old offscreen box center 3520
  assert.equal(press.params.buttons, 1);
  assert.equal(f.state.listeners.size, 0);
  assert.equal(Object.keys(f.button).some(key => key.startsWith('gardenflowPublishClick_')), false);
});

test('covered/offscreen/hover-shifted targets issue no press and remain safe to retry', async () => {
  for (const options of [{ covered: true }, { coverOutsideShadow: true }, { offscreen: true }, { coverAfterHover: true }]) {
    const f = fixture(options);
    const result = await f.submit();
    assert.equal(result.publishStatus, 'not_submitted');
    assert.equal(f.state.pressed, 0);
    assert.equal(f.stored[f.ownerKey].status, 'prepared');
    assert.equal(f.state.listeners.size, 0);
  }
});

test('synthetic or missing click event is not claimed observed and never automatically re-clicked', async () => {
  for (const options of [{ trusted: false }, { emitClick: false }, { pressError: true }]) {
    const f = fixture(options);
    const result = await f.submit();
    assert.equal(result.code, 'PUBLISH_CLICK_UNVERIFIED');
    assert.equal(result.publishStatus, 'unknown');
    assert.doesNotMatch(result.message, /已点击发布/);
    assert.equal(f.state.pressed, 1);
    assert.equal((await f.submit()).publishStatus, 'unknown');
    assert.equal(f.state.pressed, 1);
    assert.equal(f.state.listeners.size, 0);
  }
});

test('observed click without platform feedback is unknown; field rejection alone is not submitted', async () => {
  const silent = fixture();
  const unknown = await silent.submit();
  assert.equal(unknown.code, 'SUBMISSION_FEEDBACK_MISSING');
  assert.match(unknown.message, /已观察到.*收到点击/);
  assert.equal((await silent.submit()).publishStatus, 'unknown');
  assert.equal(silent.state.pressed, 1);
  const invalid = fixture({ feedback: 'invalid' });
  assert.equal((await invalid.submit()).publishStatus, 'not_submitted');
  assert.equal(invalid.stored[invalid.ownerKey].status, 'prepared');
});

test('generic server alerts and captcha remain unknown, platform success completes without another click', async () => {
  for (const [feedback, code] of [['alert', 'SUBMISSION_PAGE_ALERT'], ['captcha', 'SECURITY_CHALLENGE_AFTER_CLICK']]) {
    const f = fixture({ feedback });
    const result = await f.submit();
    assert.equal(result.code, code);
    assert.equal(result.publishStatus, 'unknown');
    assert.equal(f.state.pressed, 1);
  }
  const success = fixture({ feedback: 'published' });
  assert.equal((await success.submit()).publishStatus, 'published');
  assert.equal((await success.submit()).publishStatus, 'published');
  assert.equal(success.state.pressed, 1);
});
