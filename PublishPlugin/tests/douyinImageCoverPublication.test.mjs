import test from 'node:test';
import assert from 'node:assert/strict';
import { douyinPublish, douyinStatus } from '../src/douyinPublisher.js';
import { validateDouyinRequest } from '../src/douyinAdapter.js';

const request = {
  platform: 'douyin', protocolVersion: 1, jobId: 'douyin_publish_cover_flow', contentDigest: 'a'.repeat(64),
  versionId: 'version', projectId: 'project', renderId: 'render', mediaAssetId: 'video', mediaPath: '/tmp/video.mp4',
  accountId: 'cover-account', accountLabel: '封面验收账号', title: '封面验收', description: '商品介绍', hashtags: [],
  coverAssetId: 'image', imageCover: { assetId: 'image', sourceSha256: 'b'.repeat(64), crop: 'center', files: [
    { orientation: 'portrait', path: '/tmp/portrait.jpg', sha256: 'c'.repeat(64), width: 1080, height: 1440 },
    { orientation: 'landscape', path: '/tmp/landscape.jpg', sha256: 'd'.repeat(64), width: 1440, height: 1080 },
  ] },
};

function fixture(failure = '') {
  const storage = {};
  const state = { uploaded: false, title: '', description: '', orientation: '', token: '', assignments: [],
    snapshot: { portrait: '', landscape: '' }, previewReads: { portrait: 0, landscape: 0 }, presses: 0,
    videoPreview: true, previewSwitches: 0, finishOperations: [], editorReads: { portrait: 0, landscape: 0 },
    uploadBusy: false, publishButtonEnabled: true, validationErrors: [], changedAfterRead: false, mediaSignature: 'media-1' };
  const pixels = Array(3072).fill(110);
  const chrome = {
    tabs: {
      query: async () => [{ id: 90, url: `https://creator.douyin.com/creator-micro/content/${state.uploaded ? 'post/video' : 'upload'}` }],
      update: async () => { state.uploaded = false; state.description = ''; state.title = ''; },
    },
    storage: { local: {
      get: async key => ({ [key]: storage[key] }), set: async values => Object.assign(storage, values),
      remove: async key => { delete storage[key]; },
    } },
    scripting: { executeScript: async ({ func, args = [] }) => {
      let result;
      if (func.name === 'probeDouyinPage') result = {
        href: `https://creator.douyin.com/creator-micro/content/${state.uploaded ? 'post/video' : 'upload'}`,
        uploadPage: !state.uploaded, editorPage: state.uploaded, hasDraft: state.uploaded,
        accountId: request.accountId, accountLabel: request.accountLabel, videoInputCount: 1,
        title: state.title, description: state.description, titleEditorCount: 1, descriptionEditorCount: 1,
        mediaSignature: state.uploaded && state.videoPreview ? state.mediaSignature : '', uploadBusy: state.uploadBusy,
        publishButtonCount: 1, publishButtonEnabled: state.publishButtonEnabled,
        validationErrors: state.validationErrors, pendingReviewText: state.presses > 0,
      };
      else if (func.name === 'fillDouyinTitle') { state.title = args[0]; result = { ok: true }; }
      else if (func.name === 'fillDouyinDescription') { state.description = args[0]; result = { ok: true }; }
      else if (func.name === 'publishButtonRect') result = { x: 100, y: 100 };
      else if (func.name === 'showDouyinVideoPreview') {
        state.previewSwitches += 1;
        result = failure === 'missing-preview-tab' ? { ok: false, code: 'VIDEO_PREVIEW_NOT_UNIQUE' }
          : (state.videoPreview = true, { ok: true });
      }
      else if (func.name === 'douyinCoverPage') {
        const [operation = 'probe', options = {}] = args;
        const file = request.imageCover.files.find(item => item.orientation === options.orientation);
        if (operation === 'probe') {
          if (failure === 'media-changed-after-read' && state.previewReads.portrait && state.previewReads.landscape) {
            state.mediaSignature = 'media-2';
          }
          if (['changed-after-read', 'reencoded-after-read'].includes(failure)
            && state.previewReads.portrait && state.previewReads.landscape) {
            state.snapshot.landscape = 'altered-before-prepared';
            state.changedAfterRead = true;
          }
          result = { ok: true, orientation: state.orientation,
            editorMode: failure === 'single-editor' ? 'single' : 'combined',
            coverEditing: Boolean(state.orientation), coverSnapshot: failure === 'reordered-snapshot'
              ? { landscape: state.snapshot.landscape, portrait: state.snapshot.portrait } : { ...state.snapshot } };
        }
        if (operation === 'open') { state.orientation = options.orientation; result = { ok: true }; }
        if (operation === 'arm-input') { state.token = options.token; result = { ok: true }; }
        if (operation === 'read-upload') result = { ok: true, sha256: failure === 'wrong-hash' ? 'f'.repeat(64) : file.sha256,
          width: file.width, height: file.height, pixels };
        if (operation === 'read-editor-ready') {
          const reads = ++state.editorReads[options.orientation];
          result = { ok: failure !== 'stale-editor' && (failure !== 'delayed-editor' || reads >= 3), signature: `painted-${options.orientation}` };
        }
        if (operation === 'switch' || operation === 'save') {
          state.finishOperations.push(operation);
          state.snapshot[options.orientation] = `saved-${options.orientation}`;
          state.orientation = operation === 'switch' ? 'landscape' : '';
          if (operation === 'save') state.videoPreview = false;
          result = { ok: true };
        }
        if (operation === 'read-preview') {
          const reads = ++state.previewReads[options.orientation];
          result = failure === 'cors' || (failure === 'delayed-preview' && reads < 3) ? { ok: false, code: 'COVER_PIXELS_UNREADABLE' }
            : { ok: true, signature: state.snapshot[options.orientation],
              pixels: failure === 'wrong-picture' || failure === 'center-rounding'
                || (failure === 'delayed-picture' && reads < 3)
                || (failure === 'changed-after-read' && state.changedAfterRead && options.orientation === 'landscape') ? Array(3072).fill(210) : pixels,
              roundedExpectedPixels: failure === 'center-rounding' ? Array(3072).fill(210) : undefined };
        }
      }
      return [{ result }];
    } },
    debugger: {
      attach: async () => {}, detach: async () => {},
      sendCommand: async (_target, command, args) => {
        if (command === 'DOM.getFlattenedDocument') return { nodes: [
          { nodeName: 'INPUT', backendNodeId: 1, attributes: ['type', 'file', 'accept', 'video/mp4'] },
          { nodeName: 'INPUT', backendNodeId: 2, attributes: ['type', 'file', 'accept', 'image/jpeg', 'data-gardenflow-cover-input', state.token] },
          { nodeName: 'INPUT', backendNodeId: 3, attributes: ['type', 'file', 'accept', 'image/jpeg'] },
        ] };
        if (command === 'DOM.setFileInputFiles') {
          state.assignments.push(args.files[0]);
          if (args.backendNodeId === 1) state.uploaded = true;
          else assert.equal(args.backendNodeId, 2, 'unmarked replacement input must not receive a file');
        }
        if (command === 'Input.dispatchMouseEvent' && args.type === 'mousePressed') state.presses += 1;
        return {};
      },
    },
  };
  return { chrome, state, storage };
}

test('cover protocol requires two correctly oriented files and matching source identifier', () => {
  assert.equal(validateDouyinRequest(request).ok, true);
  for (const imageCover of [
    { ...request.imageCover, assetId: 'other' },
    { ...request.imageCover, crop: 'stretch' },
    { ...request.imageCover, files: request.imageCover.files.slice(0, 1) },
    { ...request.imageCover, files: [null, null] },
    { ...request.imageCover, files: [request.imageCover.files[0], request.imageCover.files[0]] },
    { ...request.imageCover, files: request.imageCover.files.map(file => ({ ...file, path: '../escape.jpg' })) },
  ]) assert.equal(validateDouyinRequest({ ...request, imageCover }).code, 'INVALID_DOUYIN_COVER');
});

test('both covers upload and read back before confirmation; edits stop submission and duplicates submit once', async () => {
  const previous = globalThis.chrome;
  const { chrome, state, storage } = fixture();
  globalThis.chrome = chrome;
  try {
    assert.equal((await douyinPublish({ phase: 'prepare', request })).prepared, true);
    assert.deepEqual(state.assignments, ['/tmp/video.mp4', '/tmp/portrait.jpg', '/tmp/landscape.jpg']);
    assert.equal(state.presses, 0);
    assert.equal(state.previewSwitches, 1, 'saving covers unmounts the video until its preview is restored');
    assert.ok(storage.gardenflowDouyinPublisherPreparedJob.coverSnapshot.portrait);
    assert.equal((await douyinPublish({ phase: 'prepare', request })).prepared, true);
    assert.equal(state.assignments.length, 3);
    state.snapshot.landscape = 'manually-changed';
    assert.equal((await douyinPublish({ phase: 'submit', request })).code, 'EDITOR_CHANGED');
    assert.equal(state.presses, 0);
    state.snapshot.landscape = 'saved-landscape';
    state.videoPreview = false;
    assert.equal((await douyinPublish({ phase: 'submit', request })).publishStatus, 'pending_review');
    assert.equal(state.previewSwitches, 2, 'submission restores preview and still verifies the original media identity');
    assert.equal((await douyinPublish({ phase: 'submit', request })).publishStatus, 'pending_review');
    assert.equal(state.presses, 1);
  } finally { globalThis.chrome = previous; }
});

test('reopened single-cover editors save each orientation without waiting for a nonexistent switch button', async () => {
  const previous = globalThis.chrome;
  const { chrome, state, storage } = fixture('single-editor');
  globalThis.chrome = chrome;
  try {
    assert.equal((await douyinPublish({ phase: 'prepare', request })).prepared, true);
    assert.deepEqual(state.finishOperations, ['save', 'save']);
    assert.deepEqual(state.assignments, ['/tmp/video.mp4', '/tmp/portrait.jpg', '/tmp/landscape.jpg']);
    assert.ok(storage.gardenflowDouyinPublisherPreparedJob.coverSnapshot.portrait);
    assert.ok(storage.gardenflowDouyinPublisherPreparedJob.coverSnapshot.landscape);
    assert.equal(state.presses, 0);
  } finally { globalThis.chrome = previous; }
});

test('editor diagnostics identify failed gates without exposing validation text or permitting submission', async () => {
  const previous = globalThis.chrome;
  const { chrome, state } = fixture();
  globalThis.chrome = chrome;
  try {
    assert.equal((await douyinPublish({ phase: 'prepare', request })).prepared, true);
    state.uploadBusy = true;
    state.publishButtonEnabled = false;
    state.validationErrors = ['private validation text https://example.test/secret'];
    state.snapshot.landscape = 'changed-picture';
    const { draftReadback } = await douyinStatus(true);
    assert.equal(draftReadback.coverMatches, false);
    assert.equal(draftReadback.coverEditing, false);
    assert.equal(draftReadback.uploadBusy, true);
    assert.equal(draftReadback.publishButtonCount, 1);
    assert.equal(draftReadback.publishButtonEnabled, false);
    assert.equal(draftReadback.validationErrorCount, 1);
    assert.deepEqual(draftReadback.coverChanges, { landscape: ['signature'] });
    for (const privateValue of ['private validation', 'https://', 'media-1', 'changed-picture', '/tmp/']) {
      assert.equal(JSON.stringify(draftReadback).includes(privateValue), false);
    }
    assert.equal((await douyinPublish({ phase: 'submit', request })).code, 'EDITOR_CHANGED');
    assert.equal(state.presses, 0);
  } finally { globalThis.chrome = previous; }
});

test('a later platform cover identity is bound only after both saved pictures pass the original file checks again', async (t) => {
  t.mock.method(globalThis, 'setTimeout', (callback) => { queueMicrotask(callback); return 0; });
  const previous = globalThis.chrome;
  const { chrome, state, storage } = fixture('reencoded-after-read');
  globalThis.chrome = chrome;
  try {
    assert.equal((await douyinPublish({ phase: 'prepare', request })).prepared, true);
    assert.deepEqual(state.previewReads, { portrait: 2, landscape: 2 });
    assert.deepEqual(state.assignments, ['/tmp/video.mp4', '/tmp/portrait.jpg', '/tmp/landscape.jpg']);
    assert.equal(storage.gardenflowDouyinPublisherPreparedJob.coverSnapshot.landscape, 'altered-before-prepared');
    assert.equal(storage.gardenflowDouyinPublisherPreparedJob.status, 'prepared');
    assert.equal(state.presses, 0);
  } finally { globalThis.chrome = previous; }
});

test('browser serialization can reorder cover fields without repeating verification or blocking preparation', async (t) => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => (now += 10_000));
    t.mock.method(globalThis, 'setTimeout', (callback) => { queueMicrotask(callback); return 0; });
    const previous = globalThis.chrome;
    const { chrome, state, storage } = fixture('reordered-snapshot');
    globalThis.chrome = chrome;
    try {
        assert.equal((await douyinPublish({ phase: 'prepare', request })).prepared, true);
        assert.deepEqual(state.previewReads, { portrait: 1, landscape: 1 });
        assert.equal(storage.gardenflowDouyinPublisherPreparedJob.status, 'prepared');
        const saved = storage.gardenflowDouyinPublisherPreparedJob.coverSnapshot;
        storage.gardenflowDouyinPublisherPreparedJob.coverSnapshot = { portrait: saved.portrait, landscape: saved.landscape };
        assert.equal((await douyinStatus(true)).draftReadback.coverMatches, true);
        assert.equal((await douyinPublish({ phase: 'prepare', request })).prepared, true);
        assert.equal(state.assignments.length, 3);
        assert.equal(state.presses, 0);
    } finally { globalThis.chrome = previous; }
});

test('reordered stored file metadata survives restart without duplicate uploads and still blocks changed files', async () => {
    const previous = globalThis.chrome;
    const { chrome, state, storage } = fixture();
    globalThis.chrome = chrome;
    try {
        assert.equal((await douyinPublish({ phase: 'prepare', request })).prepared, true);
        const saved = storage.gardenflowDouyinPublisherPreparedJob;
        const cover = saved.imageCover;
        saved.imageCover = { files: cover.files.map(file => ({ height: file.height, width: file.width,
            sha256: file.sha256, path: file.path, orientation: file.orientation })), crop: cover.crop,
            sourceSha256: cover.sourceSha256, assetId: cover.assetId };
        assert.equal((await douyinPublish({ phase: 'prepare', request })).prepared, true);
        assert.equal(state.assignments.length, 3);
        saved.imageCover.files[0].sha256 = 'e'.repeat(64);
        assert.equal((await douyinPublish({ phase: 'submit', request })).code, 'PREPARED_JOB_NOT_FOUND');
        assert.equal(state.presses, 0);
        saved.imageCover.files[0].sha256 = cover.files[0].sha256;
        assert.equal((await douyinPublish({ phase: 'submit', request })).publishStatus, 'pending_review');
        assert.equal(state.presses, 1);
    } finally { globalThis.chrome = previous; }
});

for (const failure of ['delayed-preview', 'delayed-picture', 'center-rounding', 'delayed-editor']) {
  test(`saved cover ${failure} is awaited without assigning files again or weakening pixel checks`, async (t) => {
    t.mock.method(globalThis, 'setTimeout', (callback) => { queueMicrotask(callback); return 0; });
    const previous = globalThis.chrome;
    const { chrome, state } = fixture(failure);
    globalThis.chrome = chrome;
    try {
      assert.equal((await douyinPublish({ phase: 'prepare', request })).prepared, true);
      if (failure === 'delayed-editor') assert.deepEqual(state.editorReads, { portrait: 4, landscape: 4 });
      else if (failure === 'center-rounding') assert.deepEqual(state.previewReads, { portrait: 1, landscape: 1 });
      else assert.deepEqual(state.previewReads, { portrait: 3, landscape: 3 });
      assert.equal(state.assignments.length, 3);
      assert.equal(state.presses, 0);
    } finally { globalThis.chrome = previous; }
  });
}

for (const failure of ['wrong-hash', 'wrong-picture', 'cors', 'changed-after-read', 'media-changed-after-read', 'missing-preview-tab', 'stale-editor']) {
  test(`cover ${failure} blocks preparation and never submits`, async (t) => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => (now += 10_000));
    t.mock.method(globalThis, 'setTimeout', (callback) => { queueMicrotask(callback); return 0; });
    const previous = globalThis.chrome;
    const { chrome, state, storage } = fixture(failure);
    globalThis.chrome = chrome;
    try {
      const prepared = await douyinPublish({ phase: 'prepare', request });
      assert.equal(prepared.ok, false);
      assert.equal(prepared.publishStatus, 'not_submitted');
      if (failure === 'changed-after-read') {
        assert.equal(storage.gardenflowDouyinPublisherPreparedJob.status, 'preparing');
        assert.equal(storage.gardenflowDouyinPublisherPreparedJob.coverSnapshot.landscape, 'saved-landscape');
        assert.equal((await douyinStatus(true)).draftReadback.coverMatches, false);
      }
      if (failure === 'media-changed-after-read') {
        assert.equal(storage.gardenflowDouyinPublisherPreparedJob.mediaSignature, 'media-1');
        assert.equal(storage.gardenflowDouyinPublisherPreparedJob.status, 'preparing');
        assert.equal((await douyinStatus(true)).draftReadback.mediaMatches, false);
      }
      if (failure === 'wrong-picture') {
        const diagnostic = storage.gardenflowDouyinPublisherPreparedJob.coverReadbackDiagnostic;
        assert.equal(diagnostic.orientation, 'portrait');
        assert.equal(diagnostic.meanAbsoluteError, 100);
        assert.equal(diagnostic.largeDeltaFraction, 1);
        assert.equal(JSON.stringify(diagnostic).includes('pixels'), false);
        assert.equal(JSON.stringify(diagnostic).includes('/tmp/'), false);
      }
      assert.equal((await douyinPublish({ phase: 'submit', request })).code, 'PREPARED_JOB_NOT_FOUND');
      assert.equal(state.presses, 0);
      if (failure === 'stale-editor') assert.deepEqual(state.finishOperations, []);
    } finally { globalThis.chrome = previous; }
  });
}
