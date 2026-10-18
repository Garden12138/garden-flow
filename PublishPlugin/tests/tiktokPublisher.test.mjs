import test from 'node:test';
import assert from 'node:assert/strict';
import { tiktokPublish, tiktokStatus } from '../src/tiktokPublisher.js';
import { validateTikTokRequest, isTikTokUploadUrl, tikTokCaption, tikTokEditorIssues, matchTikTokPostReceipt } from '../src/tiktokAdapter.js';

const request = {
  platform: 'tiktok', protocolVersion: 1, jobId: 'tiktok_publish_fixture', sessionId: 'session',
  versionId: 'version', revision: 1, projectId: 'project', renderId: 'render', mediaAssetId: 'media',
  mediaPath: '/tmp/tiktok_publish_fixture_deadbeef.mp4', mediaSha256: 'b'.repeat(64), mediaSize: 32,
  contentDigest: 'a'.repeat(64), accountId: 'fixture_handle', accountLabel: '@fixture_handle',
  title: 'Internal title', description: 'Product details', hashtags: ['Product'], language: 'en', market: 'International',
  publishSettings: { visibility: 'everyone', allowComments: true, allowReuse: true, allowRemix: true,
    audience18Plus: false, commercialContent: 'none', aiGenerated: false },
};
function fixture() {
  const storage = {};
  const state = { uploaded: false, accountId: request.accountId, caption: '', settings: {}, mediaSignature: 'media-1',
    mediaFilename: request.mediaPath.split('/').at(-1), assignments: [], presses: 0, attaches: 0, failOnClick: false,
    postNow: true, locationSelected: false, loginRequired: false, securityChallenge: false, blockingDialog: false, resumeDraft: false,
    validationErrors: [], publishButtonEnabled: true, publishButtonCount: 1, duplicateInputs: false, changeOnAttach: false,
    settingCalls: [], captionEditorCount: 1, captionBlockCount: 1, captionFocused: false, captionSelected: false,
    captionPresses: 0, captionObscured: false, inputCommands: [], captionCommitDelay: 0, pendingCaption: null };
  const chrome = {
    tabs: { query: async () => [{ id: 90, url: state.postsPage ? 'https://www.tiktok.com/tiktokstudio/content' : 'https://www.tiktok.com/tiktokstudio/upload?tab=video' }] },
    storage: { local: { get: async key => ({ [key]: storage[key] }), set: async value => Object.assign(storage, value), remove: async key => { delete storage[key]; } } },
    scripting: { executeScript: async ({ func, args = [] }) => {
      // Chrome requires JSON-serializable injection arguments; undefined array
      // entries are rejected before the injected function can execute.
      assert.deepEqual(JSON.parse(JSON.stringify(args)), args, 'Chrome script arguments must be JSON-serializable');
      let result;
      if (func.name === 'probeTikTokPage') {
        if (state.pendingPublishReads && --state.pendingPublishReads === 0) state.publishButtonEnabled = true;
        if (state.pendingCaption && --state.pendingCaption.reads <= 0) {
          state.caption = state.pendingCaption.caption;
          state.captionBlockCount = state.pendingCaption.blocks;
          state.pendingCaption = null;
        }
        result = { ...state, href: 'https://www.tiktok.com/tiktokstudio/upload?tab=video',
        uploadPage: !state.uploaded, editorPage: state.uploaded, hasDraft: state.uploaded || state.resumeDraft,
        mediaSignature: state.uploaded ? state.mediaSignature : '', videoInputCount: state.uploaded ? 0 : 1,
        captionEditorCount: state.uploaded ? state.captionEditorCount : 0 };
      }
      else if (func.name === 'readTikTokAccount') {
        if (state.captionOnAccountRead) state.caption = state.captionOnAccountRead;
        result = { accountId: state.accountId, accountLabel: '@' + state.accountId };
      }
      else if (func.name === 'tikTokCaptionPoint') result = state.captionEditorCount === 1 && !state.captionObscured ? { x: 120, y: 80 } : null;
      else if (func.name === 'tikTokSettingsPage') {
        state.settingCalls.push([...args]);
        const [operation, value] = args;
        const flags = { comment: 'allowComments', reuse: 'allowReuse', remix: 'allowRemix', ai: 'aiGenerated', audience: 'audience18Plus' };
        if (operation === 'privacy-select') state.settings.visibility = value;
        else if (flags[operation]) state.settings[flags[operation]] = value;
        else if (operation === 'disclosure' && value === false) {
          state.settings.commercialContent = 'none';
          if (state.publishCommitDelay) { state.publishButtonEnabled = false; state.pendingPublishReads = state.publishCommitDelay; }
        }
        else if (operation === 'own-brand' && value === true) state.settings.commercialContent = 'own_brand';
        else if (operation === 'paid-brand' && value === true) state.settings.commercialContent = 'paid_partnership';
        result = { ok: true };
      }
      else if (func.name === 'tikTokSubmitPoint') result = state.publishButtonEnabled && state.publishButtonCount === 1 && !state.blockingDialog ? { x: 30, y: 30 } : null;
      else if (func.name === 'readTikTokPosts') result = { href: 'https://www.tiktok.com/tiktokstudio/content', posts: state.receipts || [] };
      else throw new Error('unexpected script ' + func.name);
      return [{ result }];
    } },
    debugger: {
      attach: async () => { state.attaches++; if (state.changeOnAttach || state.attaches === state.switchAtAttach) state.accountId = 'switched_account'; if (state.resumeOnAttach) state.resumeDraft = true; }, detach: async () => {},
      sendCommand: async (_target, command, args) => {
        if (command === 'DOM.getFlattenedDocument') return { nodes: Array.from({ length: state.duplicateInputs ? 2 : 1 }, (_, i) => ({ nodeName: 'INPUT', backendNodeId: i + 1, attributes: ['type', 'file', 'accept', 'video/*'] })) };
        if (command === 'DOM.setFileInputFiles') { state.assignments.push(args.files[0]); state.uploaded = true; }
        if (command === 'Input.dispatchKeyEvent' || command === 'Input.insertText') {
          assert.equal(state.captionFocused, true);
          if (command === 'Input.insertText' || args.type !== 'keyUp') {
            assert.equal(state.pendingCaption, null, 'wait for the React commit before the next input');
          }
          state.inputCommands.push({ command, args });
          if (args.commands?.includes('selectAll')) state.captionSelected = true;
          else if (command === 'Input.insertText' || (args.type === 'keyDown' && args.key === 'Enter' && args.text === '\r')) {
            let caption = state.captionSelected ? '' : state.caption;
            let blocks = state.captionSelected ? 1 : state.captionBlockCount;
            state.captionSelected = false;
            caption += command === 'Input.insertText' ? args.text : '\n';
            if (command !== 'Input.insertText') blocks++;
            if (!state.ignoreCaptionInput) {
              if (state.captionCommitDelay) state.pendingCaption = { caption, blocks, reads: state.captionCommitDelay };
              else { state.caption = caption; state.captionBlockCount = blocks; }
            }
          }
        }
        if (command === 'Input.dispatchMouseEvent' && args.x === 120 && args.y === 80) {
          if (args.type === 'mousePressed') state.captionPresses++;
          if (args.type === 'mouseReleased') state.captionFocused = true;
        } else if (command === 'Input.dispatchMouseEvent' && args.type === 'mousePressed') {
          state.presses++; if (state.failOnClick) throw new Error('worker lost during click');
        }
        return {};
      },
    },
  };
  return { chrome, state, storage };
}
const command = (phase, value = request) => ({ platform: 'tiktok', phase, request: value });
async function withFixture(fn) {
  const previous = globalThis.chrome; const value = fixture(); globalThis.chrome = value.chrome;
  try { await fn(value); } finally { globalThis.chrome = previous; }
}

test('explicit cover-only review refreshes one owned draft without uploading, typing or submitting', async () => {
  await withFixture(async ({ state, storage }) => {
    const signature = cover => JSON.stringify([state.mediaFilename, 'Uploaded（0.00MB）', 'blob:https://www.tiktok.com/' + cover]);
    state.mediaSignature = signature('original');
    await tiktokPublish(command('prepare'));
    const inputs = state.inputCommands.length; const uploads = state.assignments.length;
    state.mediaSignature = signature('chosen-cover');
    assert.equal((await tiktokPublish(command('submit'))).code, 'EDITOR_CHANGED');
    assert.equal(state.presses, 0);
    assert.equal((await tiktokPublish(command('review-cover'))).code, 'COVER_REVIEW_REQUIRES_ACK');
    const result = await tiktokPublish({ ...command('review-cover'), acknowledgedCoverOnly: true });
    assert.equal(result.prepared, true); assert.equal(result.publishStatus, 'not_submitted');
    assert.ok(result.uploadReview.pageFingerprint.includes('chosen-cover'));
    assert.equal(state.assignments.length, uploads); assert.equal(state.inputCommands.length, inputs); assert.equal(state.presses, 0);
    assert.equal((await tiktokPublish(command('submit'))).publishStatus, 'unknown'); assert.equal(state.presses, 1);
    const before = JSON.stringify(storage);
    assert.equal((await tiktokPublish({ ...command('review-cover'), acknowledgedCoverOnly: true })).publishStatus, 'unknown');
    assert.equal(JSON.stringify(storage), before); assert.equal(state.presses, 1);
  });
});

test('cover review cannot adopt changed media identity, account, copy, settings or access gates', async () => {
  const changes = [
    s => { s.mediaFilename = 'other.mp4'; },
    s => { s.mediaSignature = JSON.stringify([s.mediaFilename, 'Uploaded（9.00MB）', 'blob:https://www.tiktok.com/new']); },
    s => { s.mediaSignature = JSON.stringify([s.mediaFilename, 'Uploaded（0.00MB）', 'https://other.invalid/cover']); },
    s => { s.mediaSignature = 'invalid'; },
    s => { s.caption = 'Changed caption'; }, s => { s.accountId = 'other_account'; },
    s => { s.settings.visibility = 'only_me'; }, s => { s.settings.aiGenerated = true; },
    s => { s.locationSelected = true; }, s => { s.postNow = false; },
    s => { s.securityChallenge = true; }, s => { s.blockingDialog = true; },
    s => { s.resumeDraft = true; }, s => { s.publishButtonEnabled = false; },
    s => { s.publishButtonCount = 2; }, s => { s.validationErrors = ['rejected']; },
  ];
  for (const change of changes) await withFixture(async ({ state, storage }) => {
    state.mediaSignature = JSON.stringify([state.mediaFilename, 'Uploaded（0.00MB）', 'blob:https://www.tiktok.com/original']);
    await tiktokPublish(command('prepare'));
    const baseline = JSON.stringify(storage.gardenflowTikTokPublisherPreparedJob.baseline);
    state.mediaSignature = JSON.stringify([state.mediaFilename, 'Uploaded（0.00MB）', 'blob:https://www.tiktok.com/chosen-cover']);
    change(state);
    const result = await tiktokPublish({ ...command('review-cover'), acknowledgedCoverOnly: true });
    assert.equal(result.prepared, undefined); assert.equal(state.presses, 0); assert.equal(state.assignments.length, 1);
    assert.equal(JSON.stringify(storage.gardenflowTikTokPublisherPreparedJob.baseline), baseline);
  });
});

test('another cover change after explicit review invalidates submission again', async () => {
  await withFixture(async ({ state }) => {
    const signature = cover => JSON.stringify([state.mediaFilename, 'Uploaded（0.00MB）', 'blob:https://www.tiktok.com/' + cover]);
    state.mediaSignature = signature('original'); await tiktokPublish(command('prepare'));
    state.mediaSignature = signature('selected');
    assert.equal((await tiktokPublish({ ...command('review-cover'), acknowledgedCoverOnly: true })).prepared, true);
    state.mediaSignature = signature('changed-again');
    assert.equal((await tiktokPublish(command('submit'))).code, 'EDITOR_CHANGED'); assert.equal(state.presses, 0);
  });
});

test('receipt enrichment reads only an already verified publication and never uploads or presses Post', async () => {
  await withFixture(async ({ state, storage }) => {
    state.postsPage = true;
    state.receipts = [{ videoId: '7000000000000000001', url: 'https://www.tiktok.com/@fixture_handle/video/7000000000000000001',
      accountId: request.accountId, caption: 'Product details #Product', visibility: 'everyone', durationText: '00:15', publishedLabel: 'Oct 11, 12:25 PM' }];
    assert.equal((await tiktokPublish(command('read-receipt'))).code, 'RECEIPT_NOT_VERIFIED');
    storage.gardenflowTikTokPublisherResults = { [request.jobId]: { jobId: request.jobId, contentDigest: request.contentDigest,
      accountId: request.accountId, accountLabel: request.accountLabel, publishStatus: 'published', resetStatus: 'ready' } };
    const result = await tiktokPublish(command('read-receipt'));
    assert.equal(result.receipt.videoId, '7000000000000000001');
    assert.equal(result.resetStatus, 'ready');
    assert.equal(storage.gardenflowTikTokPublisherResults[request.jobId].receipt.url, result.receipt.url);
    state.receipts.push({ ...state.receipts[0], videoId: '7000000000000000002', url: 'https://www.tiktok.com/@fixture_handle/video/7000000000000000002' });
    assert.equal((await tiktokPublish(command('read-receipt'))).receipt.videoId, '7000000000000000001');
    delete storage.gardenflowTikTokPublisherResults[request.jobId].receipt;
    assert.equal((await tiktokPublish(command('read-receipt'))).code, 'RECEIPT_NOT_UNIQUE');
    state.accountId = 'wrong_account';
    assert.equal((await tiktokPublish(command('read-receipt'))).code, 'ACCOUNT_CHANGED');
    assert.equal(state.presses, 0);
    assert.equal(state.assignments.length, 0);
  });
});

test('verified receipt matching distinguishes different durations with the same caption without guessing duplicate posts', () => {
  const post = { videoId: '7000000000000000001', url: 'https://www.tiktok.com/@fixture_handle/video/7000000000000000001',
    accountId: request.accountId, caption: 'Product details #Product', visibility: 'everyone', durationText: '00:15', publishedLabel: 'Oct 13, 11:47 PM' };
  const remix = { ...post, videoId: '7000000000000000002', url: 'https://www.tiktok.com/@fixture_handle/video/7000000000000000002', durationText: '00:06' };
  const page = { href: 'https://www.tiktok.com/tiktokstudio/content', posts: [post, remix] };
  assert.equal(matchTikTokPostReceipt(page, { ...request, mediaDurationMs: 15_061 }).videoId, post.videoId);
  assert.equal(matchTikTokPostReceipt(page, { ...request, mediaDurationMs: 6_058 }).videoId, remix.videoId);
  assert.equal(matchTikTokPostReceipt(page, request), null, 'legacy requests without a duration remain ambiguous');
  assert.equal(matchTikTokPostReceipt({ ...page, posts: [remix, { ...remix, videoId: '7000000000000000003' }] }, { ...request, mediaDurationMs: 6_000 }), null);
  assert.equal(matchTikTokPostReceipt(page, { ...request, mediaDurationMs: 6_000 }, post.url), null, 'an existing receipt cannot be rebound');
  for (const value of [0, -1, Infinity, NaN, '6000', null]) assert.equal(validateTikTokRequest({ ...request, mediaDurationMs: value }).ok, false);
});

test('TikTok requests require explicit account, current file, caption and all publish settings', () => {
  assert.equal(validateTikTokRequest(request).ok, true);
  for (const invalid of [
    { ...request, platform: 'douyin' }, { ...request, revision: 0 }, { ...request, accountLabel: 'Unknown' },
    { ...request, mediaPath: '../escape.mp4' }, { ...request, mediaSha256: '' },
    { ...request, publishSettings: { ...request.publishSettings, allowComments: undefined } },
    { ...request, publishSettings: { ...request.publishSettings, visibility: 'only_me', commercialContent: 'paid_partnership' } },
    { ...request, description: 'x'.repeat(4000) },
  ]) assert.equal(validateTikTokRequest(invalid).ok, false);
  assert.equal(isTikTokUploadUrl('https://www.tiktok.com/tiktokstudio/upload?tab=video'), true);
  assert.equal(isTikTokUploadUrl('https://www.tiktok.com/tiktokstudio/upload?tab=photo'), false);
  assert.equal(isTikTokUploadUrl('https://evil.invalid/tiktokstudio/upload'), false);
  assert.equal(tikTokCaption(request), 'Product details\n#Product');
});

test('upload-only never clicks Post; one confirmed submission survives worker restart without a duplicate click', async () => {
  await withFixture(async ({ state, storage }) => {
    assert.equal((await tiktokPublish(command('prepare'))).prepared, true);
    assert.equal((await tiktokPublish(command('prepare'))).prepared, true);
    assert.equal(state.assignments.length, 1);
    assert.equal(state.presses, 0);
    assert.equal((await tiktokStatus(true)).draftReadback.mediaMatches, true);
    assert.equal((await tiktokPublish(command('submit'))).publishStatus, 'unknown');
    assert.equal(storage.gardenflowTikTokPublisherResults[request.jobId].publishStatus, 'unknown');
    const reopened = await import('../src/tiktokPublisher.js?restart');
    assert.equal((await reopened.tiktokPublish(command('submit'))).publishStatus, 'unknown');
    assert.equal((await reopened.tiktokPublish(command('prepare'))).publishStatus, 'unknown');
    assert.equal(state.presses, 1);
  });
});

test('upload preparation omits optional script arguments and preserves explicit false settings', async () => {
  await withFixture(async ({ state }) => {
    const privateRequest = { ...request, publishSettings: { visibility: 'only_me', allowComments: false,
      allowReuse: false, allowRemix: false, audience18Plus: false, commercialContent: 'none', aiGenerated: false } };
    const result = await tiktokPublish(command('prepare', privateRequest));
    assert.equal(result.prepared, true, result.message);
    assert.deepEqual(state.settingCalls, [
      ['dismiss-onboarding'], ['reveal'], ['post-now'], ['privacy-open'], ['privacy-select', 'only_me'],
      ['comment', false], ['reuse', false], ['remix', false], ['ai', false], ['audience', false], ['disclosure', false],
    ]);
    assert.deepEqual(state.settings, privateRequest.publishSettings);
    assert.equal(state.assignments.length, 1);
    assert.equal(state.presses, 0);
  });
});

test('a visible page dialog is not reported as a ready TikTok upload page', async () => {
  await withFixture(async ({ state }) => {
    state.blockingDialog = true;
    const status = await tiktokStatus(true);
    assert.equal(status.pageState, 'unsupported');
    assert.match(status.detail, /弹窗/);
    assert.equal(state.assignments.length, 0);
    assert.equal(state.presses, 0);
  });
});

test('page probe rereads caption committed while the account menu is restored', async () => {
  await withFixture(async ({ state }) => {
    state.uploaded = true;
    state.caption = 'Earlier DOM';
    state.captionOnAccountRead = 'Current DOM';
    const status = await tiktokStatus(true);
    assert.equal(status.draftReadback.caption, 'Current DOM');
    assert.equal(state.presses, 0);
  });
});

test('preparation waits for delayed publish availability while preserving every editor check', async () => {
  await withFixture(async ({ state }) => {
    state.publishCommitDelay = 6;
    const result = await tiktokPublish(command('prepare'));
    assert.equal(result.prepared, true, result.message);
    assert.equal(state.publishButtonEnabled, true);
    assert.equal(state.presses, 0);
  });
});

test('editor mismatch names the changed field without exposing caption or media data', async () => {
  await withFixture(async ({ state, chrome }) => {
    const original = chrome.scripting.executeScript;
    chrome.scripting.executeScript = async value => {
      const result = await original(value);
      if (value.func.name === 'tikTokSettingsPage' && value.args[0] === 'disclosure') state.mediaSignature = 'replaced-video';
      return result;
    };
    const result = await tiktokPublish(command('prepare'));
    assert.deepEqual(result.mismatches, ['media']);
    assert.match(result.message, /视频/);
    assert.equal(result.message.includes(request.description), false);
    assert.equal(state.presses, 0);
    assert.deepEqual(tikTokEditorIssues(null, request, {}), ['page']);
  });
});

test('native caption input replaces old text and preserves multiline Unicode without clicking Post', async () => {
  await withFixture(async ({ state }) => {
    state.caption = 'Old caption';
    const value = { ...request, description: 'Selected pack: 12 × 300g.\nOcean fish — adult cats.' };
    const result = await tiktokPublish(command('prepare', value));
    assert.equal(result.prepared, true, result.message);
    assert.equal(state.caption, tikTokCaption(value));
    assert.deepEqual(state.inputCommands.filter(item => item.command === 'Input.insertText').map(item => item.args.text), [
      'Selected pack: 12 × 300g.', 'Ocean fish — adult cats.', '#Product',
    ]);
    assert.equal(state.inputCommands.filter(item => item.args.key === 'Enter' && item.args.type === 'keyDown' && item.args.text === '\r').length, 2);
    assert.equal(state.captionPresses, 1);
    assert.equal(state.presses, 0);
  });
});

test('caption input waits for asynchronous React commits before newline and hashtag input', async () => {
  await withFixture(async ({ state }) => {
    state.captionCommitDelay = 3;
    const value = { ...request, description: 'Selected pack: 12 × 300g.\n\nOcean fish — adult cats.' };
    const result = await tiktokPublish(command('prepare', value));
    assert.equal(result.prepared, true, result.message);
    assert.equal(state.caption, tikTokCaption(value));
    assert.equal(state.captionBlockCount, 4);
    assert.equal(state.presses, 0);
  });
});

test('an obscured caption editor stops before input or changing settings', async () => {
  await withFixture(async ({ state }) => {
    state.captionObscured = true;
    const result = await tiktokPublish(command('prepare'));
    assert.equal(result.code, 'CAPTION_EDITOR_UNAVAILABLE');
    assert.equal(state.inputCommands.length, 0);
    assert.deepEqual(state.settingCalls, [['dismiss-onboarding']]);
    assert.equal(state.presses, 0);
  });
});

test('ignored caption input reports a caption mismatch without changing settings or posting', async () => {
  await withFixture(async ({ state }) => {
    state.ignoreCaptionInput = true;
    const result = await tiktokPublish(command('prepare'));
    assert.equal(result.code, 'CAPTION_READBACK_MISMATCH');
    assert.deepEqual(state.settingCalls, [['dismiss-onboarding']]);
    assert.equal(state.presses, 0);
  });
});

test('caption input rechecks the account and unique editor after attaching, before sending text', async () => {
  for (const change of ['account', 'editor']) {
    await withFixture(async ({ state }) => {
      if (change === 'account') state.switchAtAttach = 2;
      else state.captionEditorCount = 2;
      const result = await tiktokPublish(command('prepare'));
      assert.equal(result.code, change === 'account' ? 'ACCOUNT_CHANGED' : 'CAPTION_EDITOR_UNAVAILABLE');
      assert.equal(state.inputCommands.length, 0);
      assert.equal(state.presses, 0);
    });
  }
});

for (const change of ['caption', 'mediaSignature', 'accountId', 'settings', 'locationSelected', 'postNow', 'securityChallenge', 'blockingDialog', 'resumeDraft', 'publishButtonEnabled', 'publishButtonCount', 'validationErrors']) {
  test('changed ' + change + ' stops the confirmed TikTok submission', async () => {
    await withFixture(async ({ state }) => {
      assert.equal((await tiktokPublish(command('prepare'))).prepared, true);
      if (change === 'settings') state.settings.allowComments = false;
      else if (change === 'validationErrors') state.validationErrors = ['Upload rejected'];
      else if (change === 'publishButtonCount') state.publishButtonCount = 2;
      else state[change] = typeof state[change] === 'boolean' ? !state[change] : 'changed';
      assert.equal((await tiktokPublish(command('submit'))).publishStatus, 'not_submitted');
      assert.equal(state.presses, 0);
    });
  });
}

test('existing unknown drafts and ambiguous upload inputs are preserved without upload or Post', async () => {
  await withFixture(async ({ state }) => {
    state.uploaded = true;
    assert.equal((await tiktokPublish(command('prepare'))).code, 'UNOWNED_DRAFT');
    state.uploaded = false; state.duplicateInputs = true;
    assert.equal((await tiktokPublish(command('prepare'))).code, 'UPLOAD_INPUT_NOT_UNIQUE');
    assert.equal(state.assignments.length, 0); assert.equal(state.presses, 0);
  });
});

test('unsaved draft resume prompt blocks new uploads, owned retries and result reconciliation', async () => {
  await withFixture(async ({ state, storage }) => {
    state.resumeDraft = true;
    assert.equal((await tiktokStatus(true)).pageState, 'draft');
    assert.equal((await tiktokPublish(command('prepare'))).code, 'UNSAVED_DRAFT_REQUIRES_REVIEW');
    assert.equal(state.assignments.length, 0);
    assert.equal(storage.gardenflowTikTokPublisherPreparedJob, undefined);
    state.resumeDraft = false;
    assert.equal((await tiktokPublish(command('prepare'))).prepared, true);
    const originalOwner = structuredClone(storage.gardenflowTikTokPublisherPreparedJob);
    state.uploaded = false; state.resumeDraft = true;
    assert.equal((await tiktokPublish(command('prepare'))).code, 'UNSAVED_DRAFT_REQUIRES_REVIEW');
    assert.equal((await tiktokPublish({ platform: 'tiktok', phase: 'recover', jobId: request.jobId,
      contentDigest: request.contentDigest, accountId: request.accountId, accountLabel: request.accountLabel,
      acknowledgedNotPublished: true })).code, 'UNSAVED_DRAFT_REQUIRES_REVIEW');
    assert.deepEqual(storage.gardenflowTikTokPublisherPreparedJob, originalOwner);
    assert.equal(state.assignments.length, 1);
    assert.equal(state.presses, 0);
  });
});

test('account changes or a restored draft at the upload boundary stop before assigning a file', async () => {
  for (const change of ['changeOnAttach', 'resumeOnAttach']) {
    await withFixture(async ({ state }) => {
      state[change] = true;
      const result = await tiktokPublish(command('prepare'));
      assert.equal(result.code, change === 'changeOnAttach' ? 'ACCOUNT_CHANGED' : 'UNSAVED_DRAFT_REQUIRES_REVIEW');
      assert.equal(state.assignments.length, 0);
      assert.equal(state.presses, 0);
    });
  }
});

test('account changes at the last check abort before click; failure during click stays unknown', async () => {
  await withFixture(async ({ state }) => {
    await tiktokPublish(command('prepare'));
    state.changeOnAttach = true;
    assert.equal((await tiktokPublish(command('submit'))).code, 'POST_NOT_CLICKED');
    assert.equal(state.presses, 0);
    state.changeOnAttach = false; state.accountId = request.accountId; state.failOnClick = true;
    assert.equal((await tiktokPublish(command('submit'))).publishStatus, 'unknown');
    assert.equal((await tiktokPublish(command('submit'))).publishStatus, 'unknown');
    assert.equal(state.presses, 1);
  });
});

test('human review only releases the exact original task on an empty page for its original account', async () => {
  await withFixture(async ({ state, storage }) => {
    await tiktokPublish(command('prepare')); await tiktokPublish(command('submit'));
    const review = { platform: 'tiktok', phase: 'review-published', jobId: request.jobId, contentDigest: request.contentDigest,
      accountId: request.accountId, accountLabel: request.accountLabel, acknowledgedPublished: true };
    assert.equal((await tiktokPublish({ ...review, acknowledgedPublished: false })).code, 'REVIEW_MISMATCH');
    assert.equal((await tiktokPublish(review)).code, 'PAGE_NOT_BLANK');
    state.uploaded = false;
    state.accountId = 'other_account';
    assert.equal((await tiktokPublish(review)).code, 'ACCOUNT_CHANGED');
    state.accountId = request.accountId;
    assert.equal((await tiktokPublish({ ...review, contentDigest: 'c'.repeat(64) })).code, 'REVIEW_MISMATCH');
    assert.equal((await tiktokPublish(review)).publishStatus, 'published');
    assert.equal(storage.gardenflowTikTokPublisherPreparedJob, undefined);
    assert.equal((await tiktokPublish({ ...review, phase: 'recover', acknowledgedNotPublished: true })).code, 'ALREADY_RECORDED_PUBLISHED');
    assert.equal(storage.gardenflowTikTokPublisherResults[request.jobId].publishStatus, 'published');
    assert.equal((await tiktokPublish(command('prepare'))).publishStatus, 'published');
    assert.equal((await tiktokPublish(command('submit'))).publishStatus, 'published');
    assert.equal(state.presses, 1);
  });
});


test('TikTok upload rejects the exclusive 10GB boundary before any browser work', () => {
  assert.equal(validateTikTokRequest({ ...request, mediaSize: 9_999_999_999 }).ok, true);
  assert.equal(validateTikTokRequest({ ...request, mediaSize: 10_000_000_000 }).ok, false);
  assert.equal(validateTikTokRequest({ ...request, mediaSize: 30 * 1024 ** 3 }).ok, false);
});

test('concurrent status probes serialize account-menu reads and leave a restored upload page', async () => {
  await withFixture(async ({chrome}) => {
    const execute=chrome.scripting.executeScript;let active=0,max=0,reads=0;
    chrome.scripting.executeScript=async options=>{
      if(options.func.name!=='readTikTokAccount')return execute(options);
      active++;max=Math.max(max,active);reads++;
      await new Promise(resolve=>setTimeout(resolve,30));
      const result=await execute(options);active--;return result;
    };
    const results=await Promise.all([tiktokStatus(true),tiktokStatus(true),tiktokStatus(true)]);
    assert.equal(max,1);assert.equal(reads,3);assert.ok(results.every(r=>r.pageState==='ready'&&r.accountId===request.accountId));
  });
});
test('dashboard status during caption entry does not read the account menu or steal focus',async()=>{
  await withFixture(async({chrome})=>{
    const execute=chrome.scripting.executeScript;let reads=0;chrome.scripting.executeScript=options=>{if(options.func.name==='readTikTokAccount')reads++;return execute(options);};
    const send=chrome.debugger.sendCommand;let checked=false;
    chrome.debugger.sendCommand=async(...args)=>{
      if(args[1]==='Input.insertText'&&!checked){checked=true;const before=reads;const status=await tiktokStatus(true);assert.equal(status.pageState,'unsupported');assert.equal(status.accountId,undefined);assert.equal(reads,before);}
      return send(...args);
    };
    assert.equal((await tiktokPublish(command('prepare'))).prepared,true);assert.equal(checked,true);
  });
});
