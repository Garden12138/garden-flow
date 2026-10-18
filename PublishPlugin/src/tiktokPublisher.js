import { publicationUploadReview } from './publicationReview.js';
import { TIKTOK_TAB_PATTERN, isTikTokUploadUrl, validateTikTokRequest, tikTokCaption,
  tikTokEditorMatches, tikTokEditorIssues, tikTokCoverReviewIssues, readTikTokAccount, probeTikTokPage, tikTokCaptionPoint,
  tikTokSettingsPage, tikTokSubmitPoint, readTikTokPosts, matchTikTokPostReceipt } from './tiktokAdapter.js';

const OWNER_KEY = 'gardenflowTikTokPublisherPreparedJob';
const RESULTS_KEY = 'gardenflowTikTokPublisherResults';
let running = false;
const probes = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const outcome = (request, ok, publishStatus = 'not_submitted', code = '', message = '', extra = {}) => ({
  ok, jobId: request?.jobId || '', contentDigest: request?.contentDigest || '', publishStatus,
  resetStatus: 'not_started', code, message, ...extra,
});
const execute = async (tabId, func, args = []) => (await chrome.scripting.executeScript({ target: { tabId }, func, args }))?.[0]?.result;
const tabs = async () => (await chrome.tabs.query({ url: TIKTOK_TAB_PATTERN })).filter(tab => tab.id != null && isTikTokUploadUrl(tab.url));
const owner = async () => (await chrome.storage.local.get(OWNER_KEY))?.[OWNER_KEY] || null;
const setOwner = async value => chrome.storage.local.set({ [OWNER_KEY]: value });
const clearOwner = async jobId => { if ((await owner())?.request?.jobId === jobId) await chrome.storage.local.remove(OWNER_KEY); };
const cached = async jobId => ((await chrome.storage.local.get(RESULTS_KEY))?.[RESULTS_KEY] || {})[jobId] || null;
async function cache(request, result) {
  const results = (await chrome.storage.local.get(RESULTS_KEY))?.[RESULTS_KEY] || {};
  results[request.jobId] = { ...result, contentDigest: request.contentDigest, accountId: request.accountId,
    accountLabel: request.accountLabel, updatedAt: Date.now() };
  await chrome.storage.local.set({ [RESULTS_KEY]: results });
  return result;
}
const sameRequest = (left, right) => left && right
  && ['jobId', 'contentDigest', 'revision', 'versionId', 'projectId', 'renderId', 'mediaAssetId', 'mediaPath', 'mediaSha256',
    'mediaSize', 'accountId', 'accountLabel', 'title', 'description', 'language', 'market'].every(key => left[key] === right[key])
  && JSON.stringify(left.hashtags) === JSON.stringify(right.hashtags)
  && Object.keys(right.publishSettings).every(key => left.publishSettings?.[key] === right.publishSettings[key]);

async function probe(tabId) {
  const previous = probes.get(tabId) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => probeUnlocked(tabId));
  probes.set(tabId, operation);
  try { return await operation; }
  finally { if (probes.get(tabId) === operation) probes.delete(tabId); }
}
async function probeUnlocked(tabId) {
  const page = await execute(tabId, probeTikTokPage);
  if (!page || page.loginRequired || page.securityChallenge || (!page.uploadPage && !page.editorPage)) return page;
  const account = await execute(tabId, readTikTokAccount);
  // Account lookup changes focus and closes a menu. Read the restored editor
  // rather than combining its earlier DOM with a later account identity.
  const current = await execute(tabId, probeTikTokPage);
  return { ...current, accountId: account?.accountId || '', accountLabel: account?.accountLabel || '' };
}
function assertPage(state, request) {
  if (!state || !isTikTokUploadUrl(state.href)) throw Object.assign(new Error('TikTok 视频上传页已变化'), { code: 'PAGE_CHANGED' });
  if (state.loginRequired || state.securityChallenge) throw Object.assign(new Error('遇到登录、验证或限流，请在浏览器处理后重新核对'), { code: 'ACCESS_RESTRICTED' });
  if (state.resumeDraft) throw Object.assign(new Error('页面有未保存的视频草稿，请先在浏览器人工处理；未上传或提交'), { code: 'UNSAVED_DRAFT_REQUIRES_REVIEW' });
  if (state.accountId !== request.accountId || state.accountLabel !== request.accountLabel) throw Object.assign(new Error('TikTok 账号已变化'), { code: 'ACCOUNT_CHANGED' });
}
async function waitForMedia(tabId, request) {
  for (let attempt = 0; attempt < 160; attempt++) {
    const state = await probe(tabId);
    assertPage(state, request);
    if (state.validationErrors?.length) throw Object.assign(new Error(state.validationErrors.join('；')), { code: 'UPLOAD_REJECTED' });
    if (state.uploaded && state.mediaSignature) return state;
    await sleep(750);
  }
  throw Object.assign(new Error('视频上传或处理超时，未提交'), { code: 'UPLOAD_TIMEOUT' });
}
async function setFile(tabId, request) {
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
    const { nodes } = await chrome.debugger.sendCommand({ tabId }, 'DOM.getFlattenedDocument', { depth: -1, pierce: true });
    const inputs = (nodes || []).filter(node => node.nodeName === 'INPUT').filter(node => {
      const attributes = {};
      for (let index = 0; index + 1 < (node.attributes || []).length; index += 2) attributes[node.attributes[index]] = node.attributes[index + 1];
      return attributes.type === 'file' && /video|mp4/.test(attributes.accept || '');
    });
    if (inputs.length !== 1 || !inputs[0].backendNodeId) throw Object.assign(new Error('未找到唯一的视频上传输入框'), { code: 'UPLOAD_INPUT_NOT_UNIQUE' });
    const state = await probe(tabId);
    assertPage(state, request);
    if (state.hasDraft || !state.uploadPage || state.blockingDialog || state.videoInputCount !== 1 || state.validationErrors?.length) {
      throw Object.assign(new Error('上传前页面已变化或出现草稿，未上传或提交'), { code: 'UPLOAD_NOT_READY' });
    }
    await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', { backendNodeId: inputs[0].backendNodeId, files: [request.mediaPath] });
  } finally { await chrome.debugger.detach({ tabId }).catch(() => {}); }
}
async function settingsAction(tabId, operation, value) {
  const args = value === undefined ? [operation] : [operation, value];
  const result = await execute(tabId, tikTokSettingsPage, args);
  if (result?.ok !== true) throw Object.assign(new Error('TikTok 设置控件不可用或需要人工核对：' + operation), { code: result?.code || 'SETTING_UNAVAILABLE' });
}
async function fillCaption(tabId, request, baseline) {
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    const state = await probe(tabId);
    assertPage(state, request);
    if (!state.editorPage || !state.uploaded || state.mediaSignature !== baseline.mediaSignature
      || state.mediaFilename !== request.mediaPath.split(/[\\/]/).at(-1)
      || state.captionEditorCount !== 1 || state.blockingDialog || state.validationErrors?.length) {
      throw Object.assign(new Error('账号、视频或文案编辑器已变化，请在页面核对；未提交'), { code: 'CAPTION_EDITOR_UNAVAILABLE' });
    }
    const point = await execute(tabId, tikTokCaptionPoint);
    if (!point) throw Object.assign(new Error('文案编辑器被遮挡或不可用；未提交'), { code: 'CAPTION_EDITOR_UNAVAILABLE' });
    // Draft.js needs a real pointer selection, not just DOM focus. Native
    // editing events preserve its React-owned DOM and selection state.
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, commands: ['selectAll'],
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    const lines = tikTokCaption(request).split(/\r?\n/);
    let expected = '';
    const waitForCaption = async (text, blocks, trailingBreak = false) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        // Reading the account opens its menu and steals the caret. Keep this
        // bounded readback on the editor; the account is checked before/after.
        const current = await execute(tabId, probeTikTokPage);
        if (!current?.editorPage || !current.uploaded || current.mediaSignature !== baseline.mediaSignature
          || current.captionEditorCount !== 1 || current.blockingDialog || current.loginRequired
          || current.securityChallenge || current.validationErrors?.length) break;
        const actual = current.caption.replace(/\r\n/g, '\n');
        // A trailing empty Draft.js block may render one or two newlines.
        const matches = trailingBreak ? actual.replace(/\n+$/, '') === text.replace(/\n+$/, '') : actual === text;
        if (matches && current.captionBlockCount === blocks) return;
        await sleep(100);
      }
      throw Object.assign(new Error('TikTok 文案或话题未完整写入，请重新核对；未提交'), { code: 'CAPTION_READBACK_MISMATCH' });
    };
    for (let index = 0; index < lines.length; index++) {
      if (index > 0) {
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        expected += '\n';
        await waitForCaption(expected, index + 1, true);
      }
      if (lines[index]) await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: lines[index] });
      expected += lines[index];
      await waitForCaption(expected, index + 1);
    }
  } finally { await chrome.debugger.detach({ tabId }).catch(() => {}); }
}
async function fillSettings(tabId, settings) {
  await settingsAction(tabId, 'reveal');
  await settingsAction(tabId, 'post-now');
  await settingsAction(tabId, 'privacy-open');
  await settingsAction(tabId, 'privacy-select', settings.visibility);
  await settingsAction(tabId, 'comment', settings.allowComments);
  await settingsAction(tabId, 'reuse', settings.allowReuse);
  await settingsAction(tabId, 'remix', settings.allowRemix);
  await settingsAction(tabId, 'ai', settings.aiGenerated);
  await settingsAction(tabId, 'audience', settings.audience18Plus);
  await settingsAction(tabId, 'disclosure', settings.commercialContent !== 'none');
  if (settings.commercialContent !== 'none') {
    await settingsAction(tabId, 'own-brand', settings.commercialContent === 'own_brand');
    await settingsAction(tabId, 'paid-brand', settings.commercialContent === 'paid_partnership');
  }
}

export async function tiktokStatus(nativeConnected = false) {
  const pages = await tabs();
  if (pages.length !== 1) return { nativeConnected, publishTabCount: pages.length, pageState: 'unsupported', detail: '请保留一个 TikTok Studio 视频上传页' };
  // A dashboard refresh must not open the account menu and steal the caret
  // while the publisher is entering the caption. Do not report cached identity.
  if (running) return { nativeConnected, publishTabCount: 1, pageState: 'unsupported', detail: '当前任务正在上传核对，请等待完成后刷新' };
  const state = await probe(pages[0].id);
  const ownership = await owner();
  const pageState = !state ? 'unsupported' : state.loginRequired ? 'login_required' : state.securityChallenge ? 'security_challenge'
    : state.hasDraft ? 'draft' : state.blockingDialog ? 'unsupported'
      : state.uploadPage && state.videoInputCount === 1 && state.accountId ? 'ready' : 'unsupported';
  return { nativeConnected, publishTabCount: 1, pageState, accountId: state?.accountId || '', accountLabel: state?.accountLabel || '',
    ownedJobId: ownership?.request?.jobId || '', detail: pageState === 'ready' ? 'TikTok 视频上传页已就绪'
      : state?.resumeDraft ? '页面有未保存的视频草稿，请先在浏览器人工处理'
        : pageState === 'draft' ? '页面存在草稿；仅可继续原任务，其他草稿请人工处理'
          : state?.blockingDialog ? '页面有弹窗，请先在浏览器处理后重新核对' : '账号或视频上传页未就绪',
    draftReadback: state?.editorPage ? { uploaded: state.uploaded, caption: state.caption, settings: state.settings,
      mediaMatches: ownership?.baseline ? state.mediaSignature === ownership.baseline.mediaSignature : null } : undefined };
}

async function prepare(request) {
  const pages = await tabs();
  if (pages.length !== 1) return outcome(request, false, 'not_submitted', 'PUBLISH_TAB_NOT_UNIQUE', '请保留一个 TikTok 视频上传页');
  const tabId = pages[0].id;
  let ownership = await owner();
  const previous = await cached(request.jobId);
  if (previous && previous.contentDigest !== request.contentDigest) return outcome(request, false, 'not_submitted', 'REQUEST_CHANGED', '任务内容已变化');
  if (previous && ['unknown', 'submitted', 'pending_review', 'published'].includes(previous.publishStatus)) return previous;
  let state = await probe(tabId);
  assertPage(state, request);
  if (ownership && !sameRequest(ownership.request, request)) {
    // Only release a blank never-submitted draft; unknown submissions remain locked.
    if (!state.hasDraft && ownership.status !== 'submitting' && ownership.request?.accountId === request.accountId) await clearOwner(ownership.request.jobId);
    else return outcome(request, false, 'not_submitted', 'PAGE_OWNED_BY_OTHER_JOB', '页面绑定其他任务，请先核对原任务');
    ownership = null;
  }
  if (!ownership && state.hasDraft) return outcome(request, false, 'not_submitted', 'UNOWNED_DRAFT', '页面已有未绑定草稿，已停止，避免覆盖');
  if (ownership && ownership.tabId !== tabId) return outcome(request, false, 'not_submitted', 'OWNED_TAB_CHANGED', '原任务标签页已变化，请人工核对');
  if (!ownership) {
    ownership = { request, tabId, status: 'preparing', startedAt: Date.now() };
    await setOwner(ownership);
  }
  if (state.hasDraft) {
    if (state.mediaFilename !== request.mediaPath.split(/[\\/]/).at(-1)
      || (ownership.baseline && state.mediaSignature !== ownership.baseline.mediaSignature)) {
      return outcome(request, false, 'not_submitted', 'MEDIA_CHANGED', '原任务的视频已变化，未执行上传或提交');
    }
  } else {
    if (ownership.baseline) return outcome(request, false, 'not_submitted', 'OWNED_MEDIA_MISSING', '原任务视频已被移除，请关闭旧任务并重新准备');
    if (state.videoInputCount !== 1) return outcome(request, false, 'not_submitted', 'UPLOAD_NOT_READY', '上传入口未就绪');
    await setFile(tabId, request);
  }
  state = await waitForMedia(tabId, request);
  ownership = { ...ownership, baseline: { mediaSignature: state.mediaSignature }, status: 'preparing' };
  await setOwner(ownership);
  await settingsAction(tabId, 'dismiss-onboarding');
  await fillCaption(tabId, request, ownership.baseline);
  await fillSettings(tabId, request.publishSettings);
  let issues = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    state = await probe(tabId);
    assertPage(state, request);
    issues = tikTokEditorIssues(state, request, ownership.baseline);
    if (!state.publishButtonEnabled || state.publishButtonCount !== 1) issues.push('publishButton');
    if (!issues.length) break;
    // Only wait for the current editor's pending UI updates. A changed video,
    // page or access gate is not a transient preparation condition.
    if (issues.some(key => ['page', 'account', 'media', 'login', 'security', 'resumeDraft', 'validation'].includes(key))) break;
    await sleep(100);
  }
  if (issues.length) {
    const labels = { page: '上传页', account: '账号', media: '视频', caption: '文案或话题', postNow: '发布时间',
      location: '位置', login: '登录状态', security: '访问验证', resumeDraft: '其他草稿', dialog: '页面弹窗',
      validation: '页面错误', visibility: '可见范围', allowComments: '评论', allowReuse: '内容复用',
      allowRemix: 'Remix', audience18Plus: '年龄限制', commercialContent: '商业披露', aiGenerated: 'AI 标记', publishButton: '发布按钮' };
    return outcome(request, false, 'not_submitted', 'EDITOR_READBACK_MISMATCH',
      '核对未通过：' + issues.map(key => labels[key] || key).join('、') + '。请在页面检查；未提交', { mismatches: issues });
  }
  await setOwner({ ...ownership, status: 'prepared' });
  return outcome(request, true, 'not_submitted', '', '', { prepared: true, uploadReview: publicationUploadReview(request, state) });
}

async function reviewCover(request, acknowledgedCoverOnly) {
  if (acknowledgedCoverOnly !== true) return outcome(request, false, 'not_submitted', 'COVER_REVIEW_REQUIRES_ACK', '请明确核对只修改了封面，未替换视频');
  const previous = await cached(request.jobId);
  if (previous && previous.publishStatus !== 'not_submitted') return previous;
  const ownership = await owner();
  if (!ownership || ownership.status !== 'prepared' || !sameRequest(ownership.request, request)) return outcome(request, false, 'not_submitted', 'NO_PREPARED_OWNER', '未找到原任务的已上传草稿');
  const pages = await tabs();
  if (pages.length !== 1 || pages[0].id !== ownership.tabId) return outcome(request, false, 'not_submitted', 'OWNED_TAB_CHANGED', '原标签页已变化');
  const state = await probe(ownership.tabId);
  const issues = tikTokCoverReviewIssues(state, request, ownership.baseline);
  if (issues.length) return outcome(request, false, 'not_submitted', 'COVER_REVIEW_MISMATCH', '封面复核失败：视频、账号、文案、设置或页面状态不一致，未提交', { mismatches: issues });
  const current = await probe(ownership.tabId);
  if (current?.mediaSignature !== state.mediaSignature || tikTokCoverReviewIssues(current, request, ownership.baseline).length) return outcome(request, false, 'not_submitted', 'COVER_CHANGED_DURING_REVIEW', '封面核对期间页面已变化');
  await setOwner({ ...ownership, baseline: { ...ownership.baseline, mediaSignature: current.mediaSignature }, coverReviewedAt: Date.now() });
  return outcome(request, true, 'not_submitted', '', '', { prepared: true, uploadReview: publicationUploadReview(request, current) });
}

async function submit(request) {
  const previous = await cached(request.jobId);
  if (previous) {
    if (previous.contentDigest !== request.contentDigest) return outcome(request, false, 'not_submitted', 'REQUEST_CHANGED', '任务内容已变化');
    if (previous.publishStatus !== 'not_submitted') return previous;
  }
  const ownership = await owner();
  if (!ownership || ownership.status !== 'prepared' || !sameRequest(ownership.request, request)) return outcome(request, false, 'not_submitted', 'NO_PREPARED_OWNER', '未找到原任务的已核对草稿');
  const pages = await tabs();
  if (pages.length !== 1 || pages[0].id !== ownership.tabId) return outcome(request, false, 'not_submitted', 'OWNED_TAB_CHANGED', '原标签页已变化');
  const state = await probe(ownership.tabId);
  if (!tikTokEditorMatches(state, request, ownership.baseline)) return outcome(request, false, 'not_submitted', 'EDITOR_CHANGED', '账号、视频、文案或设置已变化，请重新确认');
  const point = await execute(ownership.tabId, tikTokSubmitPoint);
  if (!point) return outcome(request, false, 'not_submitted', 'POST_CONTROL_UNAVAILABLE', '发布按钮不可用或被弹窗遮挡');
  // Persist an unknown result before dispatching the one trusted click. A lost
  // service worker or missing receipt must never trigger a second submission.
  const unknown = outcome(request, false, 'unknown', 'SUBMISSION_REQUIRES_REVIEW', '已点击 Post；请到 TikTok Posts 核对发布或审核结果，不会自动重发');
  await setOwner({ ...ownership, status: 'submitting' });
  await cache(request, unknown);
  let dispatched = false;
  try {
    await chrome.debugger.attach({ tabId: ownership.tabId }, '1.3');
    const fresh = await probe(ownership.tabId);
    if (!tikTokEditorMatches(fresh, request, ownership.baseline)) throw new Error('点击前稿件已变化');
    const currentPoint = await execute(ownership.tabId, tikTokSubmitPoint);
    if (!currentPoint) throw new Error('点击前发布控件已变化');
    await chrome.debugger.sendCommand({ tabId: ownership.tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...currentPoint });
    dispatched = true;
    await chrome.debugger.sendCommand({ tabId: ownership.tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...currentPoint });
    await chrome.debugger.sendCommand({ tabId: ownership.tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...currentPoint });
    // Receipt DOM is deliberately not guessed from generic page text. Until a
    // real receipt is verified, record user review separately from platform proof.
    return unknown;
  } catch (error) {
    if (dispatched) return unknown;
    await setOwner({ ...ownership, status: 'prepared' });
    return await cache(request, outcome(request, false, 'not_submitted', 'POST_NOT_CLICKED', error.message));
  } finally { await chrome.debugger.detach({ tabId: ownership.tabId }).catch(() => {}); }
}

async function review(payload) {
  const ownership = await owner(); const previous = await cached(payload.jobId);
  const request = ownership?.request || previous;
  const allowed = payload.phase === 'review-published' ? payload.acknowledgedPublished === true : payload.phase === 'recover' && payload.acknowledgedNotPublished === true;
  if (!allowed || !request || request.jobId !== payload.jobId || request.contentDigest !== payload.contentDigest
    || request.accountId !== payload.accountId || request.accountLabel !== payload.accountLabel
    || (ownership && ownership.request.jobId !== payload.jobId)) return outcome(payload, false, 'unknown', 'REVIEW_MISMATCH', '人工核验与原任务不一致');
  if (payload.phase === 'recover' && previous?.publishStatus === 'published') return outcome(payload, false, 'published', 'ALREADY_RECORDED_PUBLISHED', '该任务已记录发布成功，不能改为未发布或重新提交');
  const pages = await tabs();
  if (pages.length !== 1) return outcome(payload, false, 'unknown', 'PUBLISH_TAB_NOT_UNIQUE', '请返回一个原账号的空白视频上传页');
  const state = await probe(pages[0].id);
  assertPage(state, request);
  if (state.hasDraft || !state.uploadPage || state.videoInputCount !== 1 || state.blockingDialog) return outcome(payload, false, 'unknown', 'PAGE_NOT_BLANK', '请在 Posts 核实结果后，人工返回空白视频上传页；插件不会丢弃其他草稿');
  const result = outcome(request, true, payload.phase === 'review-published' ? 'published' : 'not_submitted',
    payload.phase === 'recover' ? 'USER_VERIFIED_NOT_PUBLISHED' : 'USER_VERIFIED_PUBLISHED', '', { resetStatus: 'ready', reviewedAt: Date.now() });
  await cache(request, result); await clearOwner(payload.jobId);
  return result;
}

async function readReceipt(request) {
  const previous = await cached(request.jobId);
  // Enrich an already verified publication. Caption alone cannot prove that an
  // unknown submission created this row, so it must never authorize a retry or
  // promote an unverified submission to published.
  if (previous?.publishStatus !== 'published' || previous.contentDigest !== request.contentDigest
      || previous.accountId !== request.accountId || previous.accountLabel !== request.accountLabel) {
    return outcome(request, false, 'unknown', 'RECEIPT_NOT_VERIFIED', '请先核实原任务已经发布，再读取作品回执');
  }
  const pages = (await chrome.tabs.query({ url: TIKTOK_TAB_PATTERN })).filter(tab => tab.id != null
    && tab.url === 'https://www.tiktok.com/tiktokstudio/content');
  if (pages.length !== 1) return outcome(request, false, 'published', 'POSTS_TAB_NOT_UNIQUE', '请保留一个当前账号的 TikTok Studio Posts 页面');
  const account = await execute(pages[0].id, readTikTokAccount);
  if (account?.accountId !== request.accountId || account?.accountLabel !== request.accountLabel) return outcome(request, false, 'published', 'ACCOUNT_CHANGED', 'TikTok 账号未能核对或已变化');
  const receipt = matchTikTokPostReceipt(await execute(pages[0].id, readTikTokPosts), request, previous.receipt?.url || '');
  if (!receipt) return outcome(request, false, 'published', 'RECEIPT_NOT_UNIQUE', '未找到唯一且文案、账号、可见范围一致的已发布作品，请在 Posts 核对');
  const result = { ...previous, ok: true, code: '', message: '', receipt: { ...receipt, observedAt: Date.now(), source: 'tiktok-studio-posts' } };
  return cache(request, result);
}

export async function tiktokPublish(payload) {
  if (running) return outcome(payload.request || payload, false, 'not_submitted', 'TIKTOK_TASK_BUSY', '另一个 TikTok 操作正在处理');
  if (['recover', 'review-published'].includes(payload.phase)) {
    running = true;
    try { return await review(payload); }
    catch (error) { return outcome(payload, false, 'unknown', error.code || 'REVIEW_FAILED', error.message); }
    finally { running = false; }
  }
  const request = payload.request;
  const validation = validateTikTokRequest(request);
  if (payload.platform !== 'tiktok' || !['prepare', 'review-cover', 'submit', 'read-receipt'].includes(payload.phase) || !validation.ok) return outcome(request, false, 'not_submitted', validation.code || 'INVALID_PHASE', validation.message || 'TikTok 操作无效');
  running = true;
  try { return payload.phase === 'read-receipt' ? await readReceipt(request) : payload.phase === 'review-cover' ? await reviewCover(request, payload.acknowledgedCoverOnly) : payload.phase === 'prepare' ? await prepare(request) : await submit(request); }
  catch (error) { return outcome(request, false, 'not_submitted', error.code || 'TIKTOK_PREPARATION_FAILED', error.message); }
  finally { running = false; }
}
