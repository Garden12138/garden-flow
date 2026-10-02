import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  isDouyinUploadUrl, isDouyinEditorUrl, isDouyinPublishUrl, canonicalDouyinText,
  validateDouyinRequest, douyinEditorMatches,
  probeDouyinHomeAccount, probeDouyinPage, showDouyinVideoPreview,
} from '../src/douyinAdapter.js';
import { douyinStatus, douyinPublish } from '../src/douyinPublisher.js';

const request = {
  platform: 'douyin', protocolVersion: 1, jobId: 'douyin_publish_example',
  contentDigest: 'a'.repeat(64), versionId: 'dyver_1', projectId: 'video_edit_v2_1',
  renderId: 'render_1', mediaAssetId: 'asset_1', mediaPath: '/tmp/video.mp4',
  accountId: 'account-1', accountLabel: '测试账号', title: '内部标题', description: '视频描述', hashtags: ['猫粮'],
};

test('published human review clears only the matching owner on a verified empty page and prevents resubmission', async () => {
  const previousChrome = globalThis.chrome;
  const storage = {
    gardenflowDouyinPublisherPreparedJob: { ...request, tabId: 901, status: 'submitting' },
    gardenflowDouyinPublisherResults: { [request.jobId]: {
      ok: false, jobId: request.jobId, publishStatus: 'unknown', resetStatus: 'not_started',
    } },
  };
  const state = { accountId: request.accountId, hasDraft: false, videoInputCount: 1, securityChallenge: false };
  let mutations = 0;
  globalThis.chrome = {
    tabs: {
      query: async () => [{ id: 901, url: 'https://creator.douyin.com/creator-micro/content/upload' }],
      update: async () => { mutations += 1; },
    },
    scripting: { executeScript: async ({ func }) => {
      assert.equal(func.name, 'probeDouyinPage');
      return [{ result: { uploadPage: true, editorPage: false, accountLabel: request.accountLabel, ...state } }];
    } },
    debugger: { attach: async () => { mutations += 1; } },
    storage: { local: {
      get: async (key) => ({ [key]: storage[key] }),
      set: async (values) => Object.assign(storage, values),
      remove: async (key) => { delete storage[key]; },
    } },
  };
  const review = {
    platform: 'douyin', phase: 'review-published', jobId: request.jobId,
    contentDigest: request.contentDigest, accountId: request.accountId,
    accountLabel: request.accountLabel, acknowledgedPublished: true,
  };
  try {
    const nextRequest = { ...request, jobId: 'douyin_publish_after_review', contentDigest: 'b'.repeat(64) };
    assert.equal((await douyinPublish({ platform: 'douyin', phase: 'prepare', request: nextRequest })).code, 'EXISTING_DRAFT');
    assert.equal((await douyinPublish({ ...review, acknowledgedPublished: false })).code, 'REVIEW_REQUIRED');
    assert.equal((await douyinPublish({ ...review, contentDigest: 'c'.repeat(64) })).code, 'OWNERSHIP_NOT_VERIFIED');
    state.hasDraft = true;
    assert.equal((await douyinPublish(review)).code, 'PUBLISHED_PAGE_NOT_EMPTY');
    state.hasDraft = false;
    state.accountId = 'different-account';
    assert.equal((await douyinPublish(review)).code, 'PUBLISHED_PAGE_NOT_EMPTY');
    state.accountId = request.accountId;
    state.videoInputCount = 2;
    assert.equal((await douyinPublish(review)).code, 'PUBLISHED_PAGE_NOT_EMPTY');
    state.videoInputCount = 1;
    state.securityChallenge = true;
    assert.equal((await douyinPublish(review)).code, 'PUBLISHED_PAGE_NOT_EMPTY');
    state.securityChallenge = false;
    assert.equal(storage.gardenflowDouyinPublisherResults[request.jobId].publishStatus, 'unknown');
    assert.equal(storage.gardenflowDouyinPublisherPreparedJob.jobId, request.jobId);
    const result = await douyinPublish(review);
    assert.equal(result.ok, true);
    assert.equal(result.publishStatus, 'published');
    assert.equal(result.resetStatus, 'ready');
    assert.equal(storage.gardenflowDouyinPublisherPreparedJob, undefined);
    assert.equal((await douyinPublish({ platform: 'douyin', phase: 'submit', request })).publishStatus, 'published');
    assert.equal((await douyinStatus(true)).ownedJobId, undefined);
    assert.equal(mutations, 0);
  } finally { globalThis.chrome = previousChrome; }
});

test('Douyin protocol is platform and version bound', () => {
  assert.equal(validateDouyinRequest(request).ok, true);
  assert.equal(validateDouyinRequest({ ...request, platform: 'xiaohongshu' }).ok, false);
  assert.equal(validateDouyinRequest({ ...request, accountId: '' }).ok, false);
  assert.equal(validateDouyinRequest({ ...request, contentDigest: 'bad' }).ok, false);
  assert.equal(isDouyinUploadUrl('https://creator.douyin.com/creator-micro/content/upload'), true);
  assert.equal(isDouyinEditorUrl('https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page'), true);
  assert.equal(isDouyinPublishUrl('https://creator.douyin.com/creator-micro/content/post/video'), true);
  assert.equal(isDouyinUploadUrl('https://evil.example/creator-micro/content/upload'), false);
  assert.equal(canonicalDouyinText('视频描述\n#猫粮\u200b'), '视频描述#猫粮');
});

test('selected image covers without verified files are rejected before browser access', async () => {
  const previous = globalThis.chrome;
  let browserAccesses = 0;
  globalThis.chrome = new Proxy({}, { get() { browserAccesses += 1; throw new Error('Browser must not be used'); } });
  try {
    for (const phase of ['prepare', 'submit']) {
      const result = await douyinPublish({ platform: 'douyin', phase, request: { ...request, coverAssetId: 'cover-1' } });
      assert.equal(result.code, 'INVALID_DOUYIN_COVER');
      assert.equal(result.publishStatus, 'not_submitted');
    }
    assert.equal(browserAccesses, 0);
    assert.equal(validateDouyinRequest({ ...request, coverAssetId: 12 }).code, 'INVALID_DOUYIN_REQUEST');
    assert.equal(validateDouyinRequest({ ...request, coverAssetId: '' }).ok, true);
    assert.equal(validateDouyinRequest(request).ok, true);
  } finally { globalThis.chrome = previous; }
});

test('prepared editor must retain exact account, description and media', () => {
  const baseline = { title: '内部标题', description: '视频描述\n#猫粮', mediaSignature: 'blob:video-1' };
  const probe = { href: 'https://creator.douyin.com/creator-micro/content/post/video', accountId: 'account-1', accountLabel: '测试账号',
    title: baseline.title, description: '视频描述#猫粮\u200b', mediaSignature: baseline.mediaSignature, uploadBusy: false, validationErrors: [] };
  assert.equal(douyinEditorMatches(probe, request, baseline), true);
  assert.equal(douyinEditorMatches({ ...probe, accountId: 'other' }, request, baseline), false);
  assert.equal(douyinEditorMatches({ ...probe, description: 'other' }, request, baseline), false);
  assert.equal(douyinEditorMatches({ ...probe, title: 'other' }, request, baseline), false);
  assert.equal(douyinEditorMatches({ ...probe, mediaSignature: 'blob:other' }, request, baseline), false);
  assert.equal(douyinEditorMatches({ ...probe, uploadBusy: true }, request, baseline), false);
});

test('editor probe retains the underlying video and text while the cover modal has its own preview and fields', () => {
  class Element {
    constructor(value, modal = false, attrs = {}) { this.textContent = value; this.value = value; this.modal = modal; this.attrs = attrs; }
    getBoundingClientRect() { return { width: this.hidden ? 0 : 100, height: 100 }; }
    getAttribute(key) { return this.attrs[key] || ''; }
    closest() { return this.modal ? dialog : null; }
  }
  const dialog = new Element('封面预览');
  const videos = [Object.assign(new Element(''), { src: 'blob:confirmed-video' }),
    Object.assign(new Element('', true), { src: 'blob:cover-modal-preview' })];
  const description = new Element('视频描述#猫粮', false, { placeholder: '作品描述' });
  const title = new Element('内部标题', false, { placeholder: '填写作品标题' });
  const context = vm.createContext({
    HTMLElement: Element, URL, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    location: { origin: 'https://creator.douyin.com', pathname: '/creator-micro/content/post/video', href: 'https://creator.douyin.com/creator-micro/content/post/video' },
    document: { body: { innerText: '设置封面' }, querySelectorAll(selector) {
      if (selector === 'video') return videos;
      if (selector.startsWith('textarea,[contenteditable')) return [new Element('AI 封面提示词', true, { placeholder: '作品描述' }), description];
      if (selector.startsWith('input[type="text"]')) return [new Element('封面标题', true, { placeholder: '作品标题' }), title];
      if (selector === 'input[type="file"]') return [{ accept: 'video/mp4' }];
      return [];
    } },
  });
  const probe = () => vm.runInContext(`(${probeDouyinPage.toString()})()`, context);
  assert.equal(probe().mediaSignature, 'blob:confirmed-video');
  assert.equal(probe().videoCount, 1);
  assert.equal(probe().description, '视频描述#猫粮');
  assert.equal(probe().title, '内部标题');
  videos[0].hidden = true;
  assert.equal(probe().mediaSignature, 'blob:confirmed-video', 'cover/title preview may hide the confirmed editor video');
  videos.push(Object.assign(new Element(''), { src: 'blob:another-real-video' }));
  assert.equal(probe().mediaSignature, '', 'two underlying videos remain ambiguous');
});

test('creator home account probe requires one unambiguous Douyin number', () => {
  const oldLocation = globalThis.location;
  const oldDocument = globalThis.document;
  globalThis.location = { origin: 'https://creator.douyin.com', pathname: '/creator-micro/home' };
  globalThis.document = { body: { innerText: '吴迪\n抖音号： 27605448237\n创作中心' } };
  try {
    assert.deepEqual(probeDouyinHomeAccount(), {
      accountId: '27605448237', accountLabel: '抖音号 27605448237',
    });
    globalThis.document.body.innerText += '\n抖音号： different';
    assert.equal(probeDouyinHomeAccount(), null);
  } finally {
    globalThis.location = oldLocation;
    globalThis.document = oldDocument;
  }
});

test('video preview switch requires the unique observed editor tab and rejects dialogs and other sites', () => {
  let clicks = 0;
  class Element {
    constructor(text, hidden = false) { this.textContent = text; this.hidden = hidden; }
    getBoundingClientRect() { return { width: this.hidden ? 0 : 100, height: 30 }; }
    click() { clicks += 1; }
  }
  const tabs = [new Element('预览封面/标题'), new Element('预览视频'), new Element('预览视频', true)];
  const dialogs = [];
  const location = { origin: 'https://creator.douyin.com', pathname: '/creator-micro/content/post/video' };
  const context = vm.createContext({ HTMLElement: Element, location,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    document: { querySelectorAll: selector => {
      if (selector === '[class*="previewTab-"] [class*="tabItem-"]') return tabs;
      if (selector === '[role="dialog"][aria-modal="true"]') return dialogs;
      throw new Error(`Unexpected selector: ${selector}`);
    } },
  });
  const switchPreview = () => vm.runInContext(`(${showDouyinVideoPreview.toString()})()`, context);
  assert.equal(switchPreview().ok, true);
  assert.equal(clicks, 1);
  tabs.push(new Element('预览视频'));
  assert.equal(switchPreview().code, 'VIDEO_PREVIEW_NOT_UNIQUE');
  tabs.pop();
  dialogs.push(new Element('封面编辑器'));
  assert.equal(switchPreview().code, 'COVER_EDITOR_STILL_OPEN');
  dialogs.pop();
  location.origin = 'https://evil.example';
  assert.equal(switchPreview().code, 'VIDEO_PREVIEW_PAGE_MISMATCH');
  location.origin = 'https://creator.douyin.com';
  location.pathname = '/creator-micro/content/upload';
  assert.equal(switchPreview().code, 'VIDEO_PREVIEW_PAGE_MISMATCH');
  assert.equal(clicks, 1);
});

test('upload page account is verified through a temporary same-window home tab', async () => {
  const oldChrome = globalThis.chrome;
  let accountId = '27605448237';
  let created = 0;
  let removed = 0;
  globalThis.chrome = {
    tabs: {
      query: async () => [
        { id: 20, windowId: 3, url: 'https://creator.douyin.com/creator-micro/content/upload' },
        { id: 21, windowId: 3, url: 'https://creator.douyin.com/creator-micro/home' },
      ],
      get: async () => ({ id: 20, windowId: 3 }),
      create: async (options) => {
        assert.equal(options.windowId, 3);
        assert.equal(options.active, false);
        created += 1;
        return { id: 30 };
      },
      remove: async (id) => { assert.equal(id, 30); removed += 1; },
    },
    scripting: { executeScript: async ({ func }) => [{ result: func.name === 'probeDouyinHomeAccount'
      ? { accountId, accountLabel: `抖音号 ${accountId}` }
      : {
        href: 'https://creator.douyin.com/creator-micro/content/upload', uploadPage: true,
        accountId: '', accountLabel: '', videoInputCount: 1, hasDraft: false,
      } }] },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  };
  try {
    const status = await douyinStatus(true);
    assert.equal(status.pageState, 'ready');
    assert.equal(status.publishTabCount, 1);
    assert.equal(status.accountId, '27605448237');
    accountId = 'changed-account';
    const prepared = await douyinPublish({ platform: 'douyin', phase: 'prepare', request: {
      ...request, accountId: '27605448237', accountLabel: '抖音号 27605448237',
    } });
    assert.equal(prepared.code, 'ACCOUNT_CHANGED');
    assert.equal(created, 2);
    assert.equal(removed, 2);
  } finally { globalThis.chrome = oldChrome; }
});

test('status and preparation fail closed when account cannot be identified', async () => {
  const previous = globalThis.chrome;
  globalThis.chrome = {
    tabs: { query: async () => [{ id: 10, url: 'https://creator.douyin.com/creator-micro/content/upload' }] },
    scripting: { executeScript: async () => [{ result: {
      href: 'https://creator.douyin.com/creator-micro/content/upload', uploadPage: true,
      accountId: '', accountLabel: '', videoInputCount: 1, hasDraft: false,
    } }] },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  };
  try {
    const status = await douyinStatus(true);
    assert.equal(status.pageState, 'unsupported');
    const prepared = await douyinPublish({ platform: 'douyin', phase: 'prepare', request });
    assert.equal(prepared.publishStatus, 'not_submitted');
    assert.equal(prepared.code, 'ACCOUNT_CHANGED');
  } finally { globalThis.chrome = previous; }
});

test('an upload landing with a retained unpublished video is a draft and prevents a new upload', async () => {
  class Element {
    constructor(attributes = {}) { this.attributes = attributes; this.accept = attributes.accept || ''; }
    getAttribute(name) { return this.attributes[name] || null; }
    getBoundingClientRect() { return { width: 100, height: 30 }; }
  }
  const document = {
    body: { innerText: '发布视频\n你还有上次未发布的视频，是否继续编辑？\n继续编辑\n放弃\n上传视频' },
    querySelectorAll: (selector) => selector === 'input[type="file"]'
      ? [new Element({ type: 'file', accept: 'video/mp4' })] : [],
  };
  const location = { origin: 'https://creator.douyin.com', pathname: '/creator-micro/content/upload',
    href: 'https://creator.douyin.com/creator-micro/content/upload' };
  const context = vm.createContext({ document, location, HTMLElement: Element,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), URL });
  const retained = vm.runInContext(`(${probeDouyinPage.toString()})()`, context);
  assert.equal(retained.videoInputCount, 1);
  assert.equal(retained.mediaSignature, '');
  assert.equal(retained.description, '');
  assert.equal(retained.restorableDraft, true);
  assert.equal(retained.hasDraft, true);
  document.body.innerText = '发布视频\n上传视频';
  assert.equal(vm.runInContext(`(${probeDouyinPage.toString()})()`, context).hasDraft, false);

  const previous = globalThis.chrome;
  let mutations = 0;
  globalThis.chrome = {
    tabs: { query: async () => [{ id: 40, url: location.href }] },
    scripting: { executeScript: async () => [{ result: { ...retained,
      accountId: request.accountId, accountLabel: request.accountLabel } }] },
    storage: { local: { get: async () => ({}),
      set: async () => { mutations += 1; }, remove: async () => { mutations += 1; } } },
    debugger: { attach: async () => { mutations += 1; } },
  };
  try {
    assert.equal((await douyinStatus(true)).pageState, 'draft');
    const prepared = await douyinPublish({ platform: 'douyin', phase: 'prepare', request });
    assert.equal(prepared.code, 'PUBLISH_PAGE_NOT_EMPTY');
    assert.equal(prepared.publishStatus, 'not_submitted');
    assert.equal(mutations, 0);
  } finally { globalThis.chrome = previous; }
});

test('one prepared Douyin draft submits once, keeps unknown results protected and recovers only its unchanged editor', async () => {
  const previous = globalThis.chrome;
  const stored = { gardenflowDouyinPublisherPreparedJob: {
    jobId: 'douyin_publish_cancelled', contentDigest: 'b'.repeat(64),
    accountId: 'account-1', accountLabel: '测试账号', status: 'prepared', tabId: 11,
  } };
  const state = { uploaded: false, title: '', description: '', clicked: 0, pressed: 0, throwAfterPress: false, accountId: 'account-1' };
  globalThis.chrome = {
    tabs: {
      query: async () => [{ id: 11, url: `https://creator.douyin.com/creator-micro/content/${state.uploaded ? 'post/video' : 'upload'}` }],
      update: async () => { state.uploaded = false; state.title = ''; state.description = ''; state.clicked = 0; },
    },
    scripting: { executeScript: async ({ func, args }) => {
      if (func.name === 'probeDouyinPage') return [{ result: {
        href: `https://creator.douyin.com/creator-micro/content/${state.uploaded ? 'post/video' : 'upload'}`,
        uploadPage: !state.uploaded, editorPage: state.uploaded,
        accountId: state.accountId, accountLabel: '测试账号', videoInputCount: 1,
        titleEditorCount: 1, title: state.title, descriptionEditorCount: 1, description: state.description,
        mediaSignature: state.uploaded ? 'blob:video-1' : '',
        hasDraft: state.uploaded || Boolean(state.description), uploadBusy: false,
        validationErrors: [], publishButtonCount: 1, publishButtonEnabled: true,
        successText: state.clicked > 0, pendingReviewText: state.clicked > 0,
      } }];
      if (func.name === 'fillDouyinTitle') { state.title = args[0]; return [{ result: { ok: true } }]; }
      if (func.name === 'fillDouyinDescription') { state.description = args[0]; return [{ result: { ok: true } }]; }
      if (func.name === 'publishButtonRect') return [{ result: { x: 100, y: 100 } }];
      throw new Error(`Unexpected ${func.name}`);
    } },
    debugger: {
      attach: async () => {}, detach: async () => {},
      sendCommand: async (_tab, command, args) => {
        if (command === 'DOM.getFlattenedDocument') return { nodes: [{ nodeName: 'INPUT', backendNodeId: 10, attributes: ['type', 'file', 'accept', 'video/mp4'] }] };
        if (command === 'DOM.setFileInputFiles') { state.uploaded = true; return {}; }
        if (command === 'Input.dispatchMouseEvent' && args.type === 'mousePressed') state.pressed += 1;
        if (command === 'Input.dispatchMouseEvent' && args.type === 'mouseReleased') {
          if (state.throwAfterPress) throw new Error('debugger disconnected after press');
          state.clicked += 1;
        }
        return {};
      },
    },
    storage: { local: {
      get: async (key) => ({ [key]: stored[key] }),
      set: async (values) => Object.assign(stored, values),
      remove: async (key) => { delete stored[key]; },
    } },
  };
  try {
    const prepared = await douyinPublish({ platform: 'douyin', phase: 'prepare', request });
    assert.equal(prepared.prepared, true);
    assert.equal(stored.gardenflowDouyinPublisherPreparedJob.jobId, request.jobId);
    assert.equal(state.clicked, 0);
    const repeated = await douyinPublish({ platform: 'douyin', phase: 'prepare', request });
    assert.equal(repeated.prepared, true);
    const changedAccount = await douyinPublish({ platform: 'douyin', phase: 'submit', request: { ...request, accountId: 'other' } });
    assert.equal(changedAccount.publishStatus, 'not_submitted');
    assert.equal(state.clicked, 0);
    const submitted = await douyinPublish({ platform: 'douyin', phase: 'submit', request });
    assert.equal(submitted.publishStatus, 'pending_review');
    assert.equal(submitted.resetStatus, 'ready');
    assert.equal(state.pressed, 1);
    const duplicate = await douyinPublish({ platform: 'douyin', phase: 'submit', request });
    assert.equal(duplicate.publishStatus, 'pending_review');
    assert.equal(state.pressed, 1);
    const interrupted = { ...request, jobId: 'douyin_publish_interrupted', contentDigest: 'b'.repeat(64) };
    assert.equal((await douyinPublish({ platform: 'douyin', phase: 'prepare', request: interrupted })).prepared, true);
    state.throwAfterPress = true;
    assert.equal((await douyinPublish({ platform: 'douyin', phase: 'submit', request: interrupted })).publishStatus, 'unknown');
    assert.equal((await douyinPublish({ platform: 'douyin', phase: 'submit', request: interrupted })).publishStatus, 'unknown');
    assert.equal(state.pressed, 2);
    state.uploaded = false;
    state.description = '';
    const later = { ...request, jobId: 'douyin_publish_later', contentDigest: 'c'.repeat(64) };
    assert.equal((await douyinPublish({ platform: 'douyin', phase: 'prepare', request: later })).code, 'EXISTING_DRAFT');
    state.uploaded = true;
    state.title = interrupted.title;
    state.description = `${interrupted.description}\n#猫粮`;
    const recovery = {
      platform: 'douyin', phase: 'recover', jobId: interrupted.jobId,
      contentDigest: interrupted.contentDigest, accountId: interrupted.accountId,
      accountLabel: interrupted.accountLabel, acknowledgedNotPublished: true,
    };
    assert.equal((await douyinPublish({ ...recovery, acknowledgedNotPublished: false })).code, 'REVIEW_REQUIRED');
    state.accountId = 'another-account';
    assert.equal((await douyinPublish(recovery)).code, 'RESULT_OR_ACCOUNT_CHANGED');
    state.accountId = interrupted.accountId;
    state.description = '用户另外修改的草稿';
    assert.equal((await douyinPublish(recovery)).code, 'DRAFT_CHANGED');
    state.description = `${interrupted.description}\n#猫粮`;
    const recovered = await douyinPublish(recovery);
    assert.equal(recovered.resetStatus, 'ready');
    assert.equal(recovered.ok, true);
    assert.equal(stored.gardenflowDouyinPublisherPreparedJob, undefined);
    assert.equal(state.pressed, 2);
  } finally { globalThis.chrome = previous; }
});

test('owned upload resumes on Douyin editor page without assigning the video again', async () => {
  const previous = globalThis.chrome;
  const storage = { gardenflowDouyinPublisherPreparedJob: {
    jobId: request.jobId, contentDigest: request.contentDigest, accountId: request.accountId,
    accountLabel: request.accountLabel, tabId: 14, status: 'preparing',
  } };
  let title = '';
  let description = '视频描述#猫粮\u200b';
  let coverEditing = true;
  let mediaSignature = 'blob:video-1';
  let videoAssignments = 0;
  globalThis.chrome = {
    tabs: { query: async () => [{ id: 14, url: 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page' }] },
    scripting: { executeScript: async ({ func, args }) => [{ result: func.name === 'probeDouyinPage' ? {
      href: 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page',
      editorPage: true, uploadPage: false, accountId: request.accountId, accountLabel: request.accountLabel,
      title, titleEditorCount: 1, description, descriptionEditorCount: 1,
      mediaSignature, hasDraft: true, uploadBusy: false, validationErrors: [],
      publishButtonCount: 1, publishButtonEnabled: true,
    } : func.name === 'fillDouyinTitle' ? (title = args[0], { ok: true })
      : func.name === 'fillDouyinDescription' ? (description = args[0], { ok: true })
        : func.name === 'douyinCoverPage' ? { ok: true, coverEditing, coverSnapshot: {} } : null }] },
    debugger: { attach: async () => {}, detach: async () => {}, sendCommand: async () => { videoAssignments += 1; } },
    storage: { local: {
      get: async (key) => ({ [key]: storage[key] }),
      set: async (values) => Object.assign(storage, values),
      remove: async (key) => { delete storage[key]; },
    } },
  };
  try {
    const status = await douyinStatus(true);
    assert.equal(status.pageState, 'draft');
    assert.equal(status.ownedJobId, request.jobId);
    assert.equal((await douyinPublish({ platform: 'douyin', phase: 'prepare', request })).code, 'COVER_EDITOR_STILL_OPEN');
    assert.equal(videoAssignments, 0);
    coverEditing = false;
    const prepared = await douyinPublish({ platform: 'douyin', phase: 'prepare', request });
    assert.equal(prepared.prepared, true);
    assert.equal(storage.gardenflowDouyinPublisherPreparedJob.status, 'prepared');
    assert.equal(storage.gardenflowDouyinPublisherPreparedJob.title, request.title);
    assert.equal(videoAssignments, 0);
    storage.gardenflowDouyinPublisherPreparedJob.status = 'preparing';
    title = '用户改过的标题';
    assert.equal((await douyinPublish({ platform: 'douyin', phase: 'prepare', request })).code, 'OWNED_DRAFT_CHANGED');
    title = request.title;
    mediaSignature = 'blob:other-video';
    assert.equal((await douyinPublish({ platform: 'douyin', phase: 'prepare', request })).code, 'OWNED_DRAFT_CHANGED');
    const changedStatus = await douyinStatus(true);
    assert.equal(changedStatus.draftReadback.mediaMatches, false);
    assert.equal(changedStatus.draftReadback.titleMatches, true);
    assert.equal(changedStatus.draftReadback.descriptionMatches, true);
    assert.equal(JSON.stringify(changedStatus.draftReadback).includes('blob:'), false);
    assert.equal(videoAssignments, 0);
  } finally { globalThis.chrome = previous; }
});
