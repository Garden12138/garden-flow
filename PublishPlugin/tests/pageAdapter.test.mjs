import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBody,
  choosePublishTargetCandidate,
  classifyPageProbe,
  findPublishButtonsInFlattenedDom,
  isUploadLandingReady,
  normalizeEditorText,
  normalizeHashtags,
  publishCandidatesFromAxTree,
  publishCandidatesFromFlattenedDom,
  validatePublishRequest,
  verifyPreparedEditorSnapshot,
} from '../src/pageAdapter.js';

function request(overrides = {}) {
  return {
    protocolVersion: 1,
    jobId: 'job-1',
    sessionId: 'session-1',
    projectPath: '/workspace/note-1',
    revision: 3,
    contentDigest: 'a'.repeat(64),
    noteType: 'image',
    title: '标题',
    body: '正文',
    hashtags: ['猫'],
    media: [{ slotId: 'cover', role: 'cover', path: '/workspace/media/cover.png', mimeType: 'image/png', order: 0 }],
    ...overrides,
  };
}

test('normalizes and deduplicates hashtags', () => {
  assert.deepEqual(normalizeHashtags(['#布偶猫', ' 布偶猫 ', '猫粮']), ['布偶猫', '猫粮']);
});

test('does not append hashtags already present in the body', () => {
  assert.equal(buildBody('正文 #布偶猫', ['布偶猫', '猫粮']), '正文 #布偶猫\n#猫粮');
});

test('normalizes rich-editor whitespace without changing visible characters', () => {
  assert.equal(normalizeEditorText('正文\r\n\u200b\n#布偶猫\u00a0 #猫咪'), '正文 #布偶猫 #猫咪');
  assert.notEqual(normalizeEditorText('正文 A'), normalizeEditorText('正文 B'));
});

test('verifies a prepared rich-editor snapshot after DOM whitespace normalization', () => {
  const payload = {
    title: '它一撒娇，我就什么都答应了',
    expectedBody: '第一段\n\n第二段\n#布偶猫 #猫咪撒娇',
    noteType: 'image',
    media: [{}, {}],
  };
  const verified = verifyPreparedEditorSnapshot({
    titleValue: payload.title,
    bodyValue: '第一段\n\u200b\n第二段\r\n#布偶猫\u00a0 #猫咪撒娇',
    publishButtonFound: true,
    publishButtonDisabled: false,
    mediaBusy: false,
    mediaCount: 2,
  }, payload);
  assert.equal(verified.ok, true);
  assert.equal(verified.titleMatches, true);
  assert.equal(verified.bodyMatches, true);
});

test('does not depend on Xiaohongshu thumbnail markup after file assignment succeeds', () => {
  const payload = {
    title: '标题',
    expectedBody: '正文 #布偶猫',
    noteType: 'image',
    media: [{}, {}, {}, {}, {}, {}, {}],
  };
  const verified = verifyPreparedEditorSnapshot({
    titleValue: payload.title,
    bodyValue: payload.expectedBody,
    publishButtonFound: true,
    publishButtonDisabled: false,
    mediaBusy: false,
  }, payload);
  assert.equal(verified.ok, true);
});

test('does not require Xiaohongshu publish-button markup during prepared-content verification', () => {
  const verified = verifyPreparedEditorSnapshot({
    titleValue: '标题',
    bodyValue: '正文',
    mediaBusy: false,
  }, {
    title: '标题',
    expectedBody: '正文',
    noteType: 'image',
    media: [{}],
  });
  assert.equal(verified.ok, true);
});

test('selects one enabled native publish control over wrapper candidates', () => {
  const selected = choosePublishTargetCandidate([
    { x: 20, y: 20, width: 80, height: 30, tagName: 'SPAN', role: '', interactive: false, nearDraftControl: false, bottomHalf: false, hitTestable: true, disabled: false },
    { x: 900, y: 700, width: 120, height: 40, tagName: 'BUTTON', role: '', interactive: true, nearDraftControl: true, bottomHalf: true, hitTestable: true, disabled: false },
  ]);
  assert.equal(selected.ok, true);
  assert.equal(selected.x, 900);
  assert.equal(selected.y, 700);
});

test('fails closed when publish controls are ambiguous or disabled', () => {
  const candidate = { width: 100, height: 40, tagName: 'BUTTON', role: '', interactive: true, nearDraftControl: true, bottomHalf: true, hitTestable: true, disabled: false };
  assert.equal(choosePublishTargetCandidate([
    { ...candidate, x: 800, y: 700 },
    { ...candidate, x: 950, y: 700 },
  ]).code, 'PUBLISH_BUTTON_AMBIGUOUS');
  assert.equal(choosePublishTargetCandidate([
    { ...candidate, x: 800, y: 700, disabled: true },
  ]).code, 'PUBLISH_BUTTON_DISABLED');
});

test('maps the exact enabled publish button from the accessibility tree', () => {
  const candidates = publishCandidatesFromAxTree([
    {
      ignored: false,
      backendDOMNodeId: 101,
      role: { value: 'button' },
      name: { value: '暂存离开' },
      properties: [],
    },
    {
      ignored: false,
      backendDOMNodeId: 102,
      role: { value: 'button' },
      name: { value: '发布' },
      properties: [{ name: 'disabled', value: { value: false } }],
    },
  ], {
    102: { model: { content: [760, 680, 880, 680, 880, 724, 760, 724] } },
  }, 800);
  assert.equal(candidates.length, 1);
  assert.deepEqual(
    { x: candidates[0].x, y: candidates[0].y, role: candidates[0].role, disabled: candidates[0].disabled, bottomHalf: candidates[0].bottomHalf },
    { x: 820, y: 702, role: 'button', disabled: false, bottomHalf: true },
  );
  assert.equal(choosePublishTargetCandidate(candidates).ok, true);
});

test('ignores accessibility labels that are not the exact publish action', () => {
  assert.deepEqual(publishCandidatesFromAxTree([
    { ignored: false, backendDOMNodeId: 1, role: { value: 'button' }, name: { value: '发布笔记' }, properties: [] },
    { ignored: false, backendDOMNodeId: 2, role: { value: 'text' }, name: { value: '发布' }, properties: [] },
  ], {
    1: { content: [0, 0, 10, 0, 10, 10, 0, 10] },
    2: { content: [0, 0, 10, 0, 10, 10, 0, 10] },
  }, 800), []);
});

test('pierces the current xhs closed-shadow publish control from a flattened DOM tree', () => {
  const nodes = [{
    nodeId: 1,
    backendNodeId: 100,
    nodeType: 1,
    nodeName: 'XHS-PUBLISH-BTN',
    shadowRoots: [{
      nodeId: 2,
      backendNodeId: 101,
      nodeType: 11,
      nodeName: '#document-fragment',
      children: [{
        nodeId: 3,
        backendNodeId: 102,
        nodeType: 1,
        nodeName: 'BUTTON',
        attributes: ['type', 'button', 'class', 'ce-btn bg-red', 'aria-busy', 'false', 'aria-disabled', 'false'],
        children: [{ nodeId: 4, backendNodeId: 103, nodeType: 3, nodeName: '#text', nodeValue: '发布' }],
      }],
    }],
  }];
  assert.deepEqual(findPublishButtonsInFlattenedDom(nodes), [{
    backendDOMNodeId: 102,
    disabled: false,
    tagName: 'BUTTON',
    inputType: 'button',
    role: 'button',
  }]);
  const candidates = publishCandidatesFromFlattenedDom(nodes, {
    102: { model: { content: [760, 680, 880, 680, 880, 720, 760, 720] } },
  }, 800);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].x, 820);
  assert.equal(candidates[0].y, 700);
  assert.equal(choosePublishTargetCandidate(candidates).ok, true);
});

test('treats disabled closed-shadow publish buttons as unavailable', () => {
  const nodes = [
    { nodeId: 1, backendNodeId: 1, parentId: 0, nodeType: 1, nodeName: 'BUTTON', attributes: ['aria-disabled', 'true'] },
    { nodeId: 2, backendNodeId: 2, parentId: 1, nodeType: 3, nodeName: '#text', nodeValue: '发布' },
  ];
  const candidates = publishCandidatesFromFlattenedDom(nodes, {
    1: { border: [0, 0, 120, 0, 120, 40, 0, 40] },
  }, 800);
  assert.equal(choosePublishTargetCandidate(candidates).code, 'PUBLISH_BUTTON_DISABLED');
});

test('blocks submit while media is still processing', () => {
  const verified = verifyPreparedEditorSnapshot({
    titleValue: '标题',
    bodyValue: '正文',
    publishButtonFound: true,
    publishButtonDisabled: false,
    mediaBusy: true,
  }, {
    title: '标题',
    expectedBody: '正文',
    noteType: 'image',
    media: [{}, {}, {}, {}, {}, {}, {}],
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.mediaBusy, true);
});

test('blocks submit when visible rich-editor text differs', () => {
  const verified = verifyPreparedEditorSnapshot({
    titleValue: '标题',
    bodyValue: '被改过的正文',
    publishButtonFound: true,
    publishButtonDisabled: false,
    mediaBusy: false,
    mediaCount: 1,
  }, {
    title: '标题',
    expectedBody: '原始正文',
    noteType: 'image',
    media: [{}],
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.bodyMatches, false);
});

test('classifies success only from structural success probe', () => {
  assert.equal(classifyPageProbe({ successPage: true, editorReady: false }), 'success');
  assert.equal(classifyPageProbe({ editorReady: true, hasDraft: true }), 'draft');
  assert.equal(classifyPageProbe({ editorReady: true, hasDraft: false }), 'draft');
});

test('treats the empty media-upload landing page as a ready publish page', () => {
  assert.equal(classifyPageProbe({
    editorReady: false,
    uploadLandingReady: true,
    hasDraft: false,
  }), 'ready');
  assert.equal(classifyPageProbe({
    editorReady: false,
    uploadLandingReady: false,
    hasDraft: false,
  }), 'unsupported');
});

test('recognizes the current image upload landing page from structural evidence', () => {
  assert.equal(isUploadLandingReady({
    publishPath: '/publish/publish',
    publishTarget: 'image',
    hasTitleInput: false,
    editableCount: 0,
    fileInputCount: 0,
    uploadModeControl: false,
    genericUploadPrompt: false,
    imageUploadAction: true,
    imageUploadPrompt: true,
    videoUploadAction: false,
    videoUploadPrompt: false,
  }), true);
});

test('does not trust the image target parameter without matching empty-page controls', () => {
  assert.equal(isUploadLandingReady({
    publishPath: '/publish/publish',
    publishTarget: 'image',
    hasTitleInput: false,
    editableCount: 0,
    fileInputCount: 0,
    uploadModeControl: false,
    genericUploadPrompt: false,
    imageUploadAction: false,
    imageUploadPrompt: false,
  }), false);
});

test('accepts image and video requests with explicit media roles', () => {
  assert.deepEqual(validatePublishRequest(request()), { ok: true });
  assert.deepEqual(validatePublishRequest(request({
    noteType: 'video',
    media: [
      { slotId: 'video', role: 'video', path: '/workspace/media/final.mp4', mimeType: 'video/mp4', order: 0 },
      { slotId: 'cover', role: 'cover', path: '/workspace/media/cover.png', mimeType: 'image/png', order: 1 },
    ],
  })), { ok: true });
});

test('rejects duplicate media and mismatched note types', () => {
  const duplicated = request({
    media: [
      { slotId: 'cover', role: 'cover', path: '/workspace/media/same.png', mimeType: 'image/png', order: 0 },
      { slotId: 'page-1', role: 'image-page', path: '/workspace/media/same.png', mimeType: 'image/png', order: 1 },
    ],
  });
  assert.equal(validatePublishRequest(duplicated).code, 'INVALID_MEDIA');
  assert.equal(validatePublishRequest(request({
    noteType: 'image',
    media: [{ slotId: 'video', role: 'video', path: '/workspace/media/final.mp4', mimeType: 'video/mp4', order: 0 }],
  })).code, 'INVALID_MEDIA');
});
