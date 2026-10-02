import {
  DOUYIN_HOME_URL, DOUYIN_TAB_PATTERN, DOUYIN_UPLOAD_URL, douyinEditorMatches, douyinCoverSnapshotsMatch, douyinImageCoversMatch,
  canonicalDouyinText, fillDouyinDescription, fillDouyinTitle, isDouyinPublishUrl, probeDouyinHomeAccount,
  probeDouyinPage, showDouyinVideoPreview, validateDouyinRequest,
} from './douyinAdapter.js';
import { douyinCoverPage, douyinCoverPixelsMatch, douyinCoverPixelComparison } from './douyinCoverAdapter.js';

const OWNER_KEY = 'gardenflowDouyinPublisherPreparedJob';
const RESULTS_KEY = 'gardenflowDouyinPublisherResults';
const running = new Set();
const accountCache = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const outcome = (request, ok, publishStatus, resetStatus = 'not_started', code = '', message = '') => ({
  ok, jobId: String(request?.jobId || ''), publishStatus, resetStatus, code, message,
});

async function tabs() {
  return (await chrome.tabs.query({ url: DOUYIN_TAB_PATTERN }))
    .filter((tab) => tab.id != null && isDouyinPublishUrl(tab.url));
}

async function execute(tabId, func, args = []) {
  const result = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result?.[0]?.result;
}

async function accountFor(tabId, force = false) {
  const cachedAccount = accountCache.get(tabId);
  if (!force && cachedAccount && Date.now() - cachedAccount.checkedAt < 30_000) return cachedAccount;
  const target = typeof chrome.tabs.get === 'function' ? await chrome.tabs.get(tabId) : null;
  if (typeof chrome.tabs.create !== 'function' || typeof chrome.tabs.remove !== 'function') return null;
  const home = await chrome.tabs.create({
    url: DOUYIN_HOME_URL, active: false,
    ...(Number.isInteger(target?.windowId) ? { windowId: target.windowId } : {}),
  });
  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const identity = await execute(home.id, probeDouyinHomeAccount).catch(() => null);
      if (identity?.accountId && identity?.accountLabel) {
        const verified = { ...identity, checkedAt: Date.now() };
        accountCache.set(tabId, verified);
        return verified;
      }
      await sleep(500);
    }
    accountCache.delete(tabId);
    return null;
  } finally {
    await chrome.tabs.remove(home.id).catch(() => {});
  }
}

async function probe(tabId, forceAccount = false) {
  let state = await execute(tabId, probeDouyinPage);
  if (!state || state.loginRequired || state.securityChallenge || (!state.uploadPage && !state.editorPage)) {
    accountCache.delete(tabId);
    return state;
  }
  if (state.editorPage) {
    const covers = await execute(tabId, douyinCoverPage).catch(() => null);
    if (covers?.ok) state = { ...state, coverSnapshot: covers.coverSnapshot, coverEditing: covers.coverEditing };
  }
  // A visible profile link is sufficient when the page provides one. On the
  // current upload page, independently verify the account on creator home.
  if (state.accountId && state.accountLabel) return state;
  const identity = await accountFor(tabId, forceAccount);
  return { ...state, accountId: identity?.accountId || '', accountLabel: identity?.accountLabel || '' };
}

async function owner() {
  return (await chrome.storage.local.get(OWNER_KEY))?.[OWNER_KEY] || null;
}
async function setOwner(value) { await chrome.storage.local.set({ [OWNER_KEY]: value }); }
async function clearOwner(jobId) {
  if ((await owner())?.jobId === jobId) await chrome.storage.local.remove(OWNER_KEY);
}
async function cached(jobId) {
  return ((await chrome.storage.local.get(RESULTS_KEY))?.[RESULTS_KEY] || {})[jobId] || null;
}
async function cache(jobId, result) {
  const values = (await chrome.storage.local.get(RESULTS_KEY))?.[RESULTS_KEY] || {};
  values[jobId] = result;
  const keys = Object.keys(values);
  for (const old of keys.slice(0, Math.max(0, keys.length - 30))) delete values[old];
  await chrome.storage.local.set({ [RESULTS_KEY]: values });
}

function finalDescription(request) {
  const tags = [...new Set(request.hashtags.map((tag) => String(tag).trim().replace(/^#+/, '')).filter(Boolean))];
  return [String(request.description).trim(), tags.map((tag) => `#${tag}`).join(' ')].filter(Boolean).join('\n');
}

async function waitForProbe(tabId, predicate, timeoutMs, revealVideo = false) {
  const deadline = Date.now() + timeoutMs;
  let previewRevealed = false;
  while (Date.now() < deadline) {
    const state = await probe(tabId).catch(() => null);
    if (state && await predicate(state)) return state;
    if (revealVideo && !previewRevealed && state?.editorPage && !state.mediaSignature && !state.coverEditing) {
      const revealed = await execute(tabId, showDouyinVideoPreview);
      if (!revealed?.ok) throw Object.assign(new Error('无法打开原任务的视频预览，未提交；请在抖音页面核对'),
        { code: revealed?.code || 'VIDEO_PREVIEW_UNAVAILABLE' });
      previewRevealed = true;
    }
    await sleep(750);
  }
  return null;
}

async function revealOwnedVideo(tabId, state) {
  if (!state?.editorPage || state.mediaSignature || state.coverEditing) return state;
  const revealed = await execute(tabId, showDouyinVideoPreview);
  if (!revealed?.ok) throw Object.assign(new Error('无法打开原任务的视频预览，未提交；请在抖音页面核对'),
    { code: revealed?.code || 'VIDEO_PREVIEW_UNAVAILABLE' });
  return await waitForProbe(tabId, (value) => value.editorPage && Boolean(value.mediaSignature), 15_000) || state;
}

async function setMediaFile(tabId, filePath, coverToken) {
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
    const { nodes } = await chrome.debugger.sendCommand({ tabId }, 'DOM.getFlattenedDocument', { depth: -1, pierce: true });
    const inputs = (nodes || []).filter((node) => String(node.nodeName).toUpperCase() === 'INPUT')
      .map((node) => {
        const values = Array.from(node.attributes || []);
        const attrs = {};
        for (let i = 0; i + 1 < values.length; i += 2) attrs[String(values[i]).toLowerCase()] = String(values[i + 1]);
        return { backendDOMNodeId: node.backendNodeId, attrs };
      })
      .filter((node) => node.attrs.type === 'file' && (coverToken
        ? node.attrs['data-gardenflow-cover-input'] === coverToken && /image\//i.test(node.attrs.accept || '')
        : /video|mp4|webm|mov/i.test(node.attrs.accept || '')));
    if (inputs.length !== 1) return false;
    await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', {
      backendNodeId: inputs[0].backendDOMNodeId, files: [filePath],
    });
    return true;
  } finally { await chrome.debugger.detach({ tabId }).catch(() => {}); }
}

async function waitForCover(tabId, operation, options, predicate, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    const value = await execute(tabId, douyinCoverPage, [operation, options]);
    lastValue = value;
    if (predicate(value)) return value;
    await sleep(500);
  }
  throw Object.assign(new Error('封面上传、保存或回读未完成，未提交；请在抖音页面核对后重试'),
    { code: lastValue?.code || 'COVER_STEP_TIMEOUT' });
}

async function applyImageCover(tabId, request) {
  if (!request.imageCover) return;
  const decoded = {};
  for (const orientation of ['portrait', 'landscape']) {
    const file = request.imageCover.files.find((item) => item.orientation === orientation);
    const opened = await execute(tabId, douyinCoverPage, ['open', { orientation }]);
    if (!opened?.ok) throw new Error(`无法打开${orientation === 'portrait' ? '竖' : '横'}封面编辑器，未提交`);
    const editor = await waitForCover(tabId, 'probe', {}, (value) => value?.ok && value.orientation === orientation);
    const token = `${request.jobId}:${orientation}`;
    const armed = await execute(tabId, douyinCoverPage, ['arm-input', { orientation, token }]);
    if (!armed?.ok) throw Object.assign(new Error('当前封面编辑器没有唯一可用的上传控件，未提交'), { code: armed?.code || 'COVER_INPUT_NOT_FOUND' });
    if (!await setMediaFile(tabId, file.path, token)) throw Object.assign(new Error('封面上传控件已变化，未提交；请复核后重试'), { code: 'COVER_INPUT_CHANGED' });
    const upload = await waitForCover(tabId, 'read-upload', { orientation, token }, (value) => value?.ok
      || value?.code === 'COVER_FILE_DECODE_FAILED', 15_000);
    if (!upload.ok || upload.sha256 !== file.sha256 || upload.width !== file.width || upload.height !== file.height) {
      throw new Error('实际上传封面与确认卡不一致，未提交；请重新准备封面');
    }
    decoded[orientation] = upload.pixels;
    // File capture precedes the platform's asynchronous image painting. Wait
    // for the visible editor to change and settle before saving, then still
    // verify the actual saved cover against the confirmed file.
    let previousEditorSignature = '';
    await waitForCover(tabId, 'read-editor-ready', { orientation, token }, (value) => {
      const stable = value?.ok && value.signature === previousEditorSignature;
      previousEditorSignature = value?.ok ? value.signature : '';
      return stable;
    });
    // Saved covers reopen in a single-cover editor with only “完成”. The
    // first combined editor instead switches from portrait to landscape.
    const finish = editor.editorMode === 'single' || orientation === 'landscape' ? 'save' : 'switch';
    await waitForCover(tabId, finish, { orientation }, (value) => value?.ok);
    if (editor.editorMode === 'single' && orientation === 'portrait') {
      await waitForCover(tabId, 'probe', {}, (value) => value?.ok && !value.coverEditing);
    }
  }
  await waitForCover(tabId, 'probe', {}, (value) => value?.ok && !value.coverEditing
    && value.coverSnapshot?.portrait && value.coverSnapshot?.landscape);
  return { decoded, snapshot: await verifySavedImageCovers(tabId, request, decoded) };
}

async function verifySavedImageCovers(tabId, request, decoded) {
  const verifiedSnapshot = {};
  for (const orientation of ['portrait', 'landscape']) {
    let lastReadback;
    try {
      const readback = await waitForCover(tabId, 'read-preview', { orientation, token: `${request.jobId}:${orientation}` }, (value) => {
        lastReadback = value;
        return value?.ok && Boolean(value.signature) && (douyinCoverPixelsMatch(decoded[orientation], value.pixels)
          || douyinCoverPixelsMatch(value.roundedExpectedPixels, value.pixels));
      });
      verifiedSnapshot[orientation] = readback.signature;
    } catch {
      const comparison = douyinCoverPixelComparison(decoded[orientation], lastReadback?.pixels);
      const roundedComparison = douyinCoverPixelComparison(lastReadback?.roundedExpectedPixels, lastReadback?.pixels);
      const file = request.imageCover.files.find((item) => item.orientation === orientation);
      throw Object.assign(new Error(`已保存${orientation === 'portrait' ? '竖' : '横'}封面画面未通过回读验证，未提交；请在抖音页面核对封面`),
        { code: lastReadback?.code || 'COVER_PREVIEW_MISMATCH', coverReadbackDiagnostic: {
          orientation, expectedWidth: file.width, expectedHeight: file.height,
          actualWidth: lastReadback?.width || null, actualHeight: lastReadback?.height || null,
          meanAbsoluteError: comparison.meanAbsoluteError ?? null,
          largeDeltaFraction: comparison.largeDeltaFraction ?? null,
          roundedMeanAbsoluteError: roundedComparison.meanAbsoluteError ?? null,
          roundedLargeDeltaFraction: roundedComparison.largeDeltaFraction ?? null,
        } });
    }
  }
  return verifiedSnapshot;
}

function coverSnapshotChanges(expected, actual) {
  const fields = ['sourceDigest', 'pixelDigest', 'width', 'height', 'fit', 'position', 'transform'];
  return Object.fromEntries(['portrait', 'landscape'].flatMap((orientation) => {
    if (expected?.[orientation] === actual?.[orientation]) return [];
    let changed = ['signature'];
    try {
      const before = JSON.parse(expected?.[orientation]);
      const after = JSON.parse(actual?.[orientation]);
      if (before && after && typeof before === 'object' && typeof after === 'object') {
        const differences = fields.filter((field) => before[field] !== after[field]);
        if (differences.length) changed = differences;
      }
    } catch { /* Old or unavailable signatures are reported without their values. */ }
    return [[orientation, changed]];
  }));
}

export async function douyinStatus(nativeConnected) {
  const available = await tabs();
  if (available.length !== 1) return { nativeConnected, publishTabCount: available.length, pageState: 'unsupported', detail: '请只打开一个抖音创作者中心标签页' };
  const state = await probe(available[0].id);
  const ownership = await owner();
  let coverReadback;
  if (state?.coverSnapshot?.portrait && state.coverSnapshot.landscape && !state.coverEditing) {
    const readable = await Promise.all(['portrait', 'landscape'].map(async (orientation) => {
      const value = await execute(available[0].id, douyinCoverPage, ['read-preview', { orientation }]).catch(() => null);
      return value?.ok === true && value.pixels?.length === 3072;
    }));
    coverReadback = { portrait: readable[0], landscape: readable[1] };
  }
  const pageState = state.loginRequired ? 'login_required' : state.securityChallenge ? 'security_challenge'
    : !state.uploadPage && !state.editorPage ? 'unsupported' : state.editorPage || state.hasDraft ? 'draft'
      : state.accountId && state.accountLabel && state.videoInputCount === 1 ? 'ready' : 'unsupported';
  const draftReadback = ownership?.tabId === available[0].id && state.editorPage ? {
    hasMedia: Boolean(state.mediaSignature), videoCount: state.videoCount,
    mediaMatches: ownership.mediaSignature ? state.mediaSignature === ownership.mediaSignature : null,
    titleMatches: ownership.title ? state.title === ownership.title : null,
    descriptionMatches: ownership.description ? canonicalDouyinText(state.description) === canonicalDouyinText(ownership.description) : null,
    coverMatches: ownership.coverSnapshot ? douyinCoverSnapshotsMatch(state.coverSnapshot, ownership.coverSnapshot) : null,
    coverChanges: ownership.coverSnapshot ? coverSnapshotChanges(ownership.coverSnapshot, state.coverSnapshot) : undefined,
    coverEditing: Boolean(state.coverEditing), uploadBusy: Boolean(state.uploadBusy),
    publishButtonCount: state.publishButtonCount, publishButtonEnabled: Boolean(state.publishButtonEnabled),
    validationErrorCount: state.validationErrors?.length || 0,
  } : undefined;
  return {
    nativeConnected, publishTabCount: 1, pageState, accountId: state.accountId,
    accountLabel: state.accountLabel, ownedJobId: ownership?.tabId === available[0].id ? ownership.jobId : undefined,
    detail: pageState === 'ready' ? '抖音空白视频发布页可用'
      : pageState === 'draft' ? '发布页已有草稿，不会覆盖'
        : pageState === 'login_required' ? '请先登录抖音创作者中心'
          : pageState === 'security_challenge' ? '请在页面完成安全验证'
            : '无法确认抖音上传页面、唯一视频输入或账号身份',
    coverReadback, draftReadback,
    coverReadbackDiagnostic: ownership?.tabId === available[0].id ? ownership.coverReadbackDiagnostic : undefined,
  };
}

async function prepare(request) {
  const valid = validateDouyinRequest(request);
  if (!valid.ok) return outcome(request, false, 'not_submitted', 'not_started', valid.code, valid.message);
  if (running.has(request.jobId)) return outcome(request, false, 'not_submitted', 'not_started', 'JOB_ALREADY_RUNNING', '任务正在执行');
  running.add(request.jobId);
  try {
    const existingResult = await cached(request.jobId);
    if (existingResult && existingResult.publishStatus !== 'not_submitted') return existingResult;
    const available = await tabs();
    if (available.length !== 1) return outcome(request, false, 'not_submitted', 'not_started', 'PUBLISH_TAB_NOT_UNIQUE', '请只保留一个抖音创作者中心页面');
    const tabId = available[0].id;
    let before = await probe(tabId, true);
    let stored = await owner();
    if (stored && (stored.jobId !== request.jobId || stored.contentDigest !== request.contentDigest)) {
      const previousResult = await cached(stored.jobId);
      const safeToRelease = ['preparing', 'prepared'].includes(stored.status)
        && (!previousResult || previousResult.publishStatus === 'not_submitted')
        && before.uploadPage && !before.hasDraft
        && before.accountId === stored.accountId && before.accountLabel === stored.accountLabel;
      if (!safeToRelease) {
        return outcome(request, false, 'not_submitted', 'not_started', 'EXISTING_DRAFT', '页面属于其他任务，未覆盖草稿');
      }
      await clearOwner(stored.jobId);
      stored = null;
    }
    if (before.accountId !== request.accountId || before.accountLabel !== request.accountLabel) {
      return outcome(request, false, 'not_submitted', 'not_started', 'ACCOUNT_CHANGED', '当前抖音账号与确认卡不一致');
    }
    if (stored?.jobId === request.jobId && stored.contentDigest === request.contentDigest && stored.tabId === tabId
      && stored.accountId === request.accountId && stored.accountLabel === request.accountLabel
      && (!stored.mediaPath || stored.mediaPath === request.mediaPath)
      && ['preparing', 'prepared'].includes(stored.status)) before = await revealOwnedVideo(tabId, before);
    if (stored?.status === 'prepared' && stored.tabId === tabId
      && douyinImageCoversMatch(stored.imageCover, request.imageCover)
      && douyinEditorMatches(before, request, stored)) {
      return { ...outcome(request, true, 'not_submitted'), prepared: true };
    }
    if (stored?.status === 'preparing' && stored.tabId === tabId && stored.jobId === request.jobId
      && stored.contentDigest === request.contentDigest && before.coverEditing) {
      return outcome(request, false, 'not_submitted', 'not_started', 'COVER_EDITOR_STILL_OPEN', '请先关闭抖音封面编辑器，再复核后重试上传；原视频已保留');
    }
    const resumeOwnUpload = stored?.status === 'preparing' && stored.tabId === tabId
      && stored.jobId === request.jobId && stored.contentDigest === request.contentDigest
      && (!stored.mediaPath || stored.mediaPath === request.mediaPath)
      && before.editorPage && Boolean(before.mediaSignature)
      && (!stored.mediaSignature || before.mediaSignature === stored.mediaSignature)
      && (!before.title || before.title === request.title)
      && canonicalDouyinText(before.description) === canonicalDouyinText(finalDescription(request));
    if (stored?.status === 'preparing' && stored.jobId === request.jobId && before.editorPage && !resumeOwnUpload) {
      return outcome(request, false, 'not_submitted', 'not_started', 'OWNED_DRAFT_CHANGED', '原任务的视频、标题或文案无法核验，请在抖音页面复核后重试');
    }
    if (!resumeOwnUpload && (!before.uploadPage || before.hasDraft || before.videoInputCount !== 1 || before.securityChallenge)) {
      return outcome(request, false, 'not_submitted', 'not_started', 'PUBLISH_PAGE_NOT_EMPTY', '抖音视频上传页不是空白可用状态');
    }
    if (!resumeOwnUpload) {
      await setOwner({ jobId: request.jobId, contentDigest: request.contentDigest, accountId: request.accountId,
        accountLabel: request.accountLabel, tabId, status: 'preparing', mediaPath: request.mediaPath });
      if (!await setMediaFile(tabId, request.mediaPath)) {
        return outcome(request, false, 'not_submitted', 'not_started', 'VIDEO_INPUT_NOT_FOUND', '未找到唯一的视频上传控件');
      }
    }
    const uploaded = await waitForProbe(tabId, (state) => state.editorPage && Boolean(state.mediaSignature)
      && state.descriptionEditorCount === 1 && state.titleEditorCount === 1, 8 * 60_000);
    if (!uploaded) return outcome(request, false, 'not_submitted', 'not_started', 'UPLOAD_TIMEOUT', '未能核验视频上传和描述输入框');
    const titled = await execute(tabId, fillDouyinTitle, [request.title]);
    if (!titled?.ok) return outcome(request, false, 'not_submitted', 'not_started', 'TITLE_FILL_FAILED', '作品标题未能回读');
    const description = finalDescription(request);
    const filled = await execute(tabId, fillDouyinDescription, [description]);
    if (!filled?.ok) return outcome(request, false, 'not_submitted', 'not_started', 'DESCRIPTION_FILL_FAILED', '发布描述未能回读');
    await setOwner({ jobId: request.jobId, contentDigest: request.contentDigest, accountId: request.accountId,
      accountLabel: request.accountLabel, tabId, status: 'preparing', mediaPath: request.mediaPath,
      mediaSignature: uploaded.mediaSignature, title: request.title, description });
    const uploadedCover = await applyImageCover(tabId, request);
    let verifiedCover = uploadedCover?.snapshot;
    const retainVerifiedCover = async () => {
      // Retain the strictly verified pictures while the remaining editor
      // checks run. This is still a preparing owner and cannot be submitted.
      const coverOwner = await owner();
      if (coverOwner?.jobId !== request.jobId || coverOwner.contentDigest !== request.contentDigest || coverOwner.tabId !== tabId) {
        throw Object.assign(new Error('封面校验期间任务归属变化，未提交'), { code: 'COVER_OWNER_CHANGED' });
      }
      await setOwner({ ...coverOwner, coverSnapshot: verifiedCover });
    };
    if (verifiedCover) await retainVerifiedCover();
    const ready = await waitForProbe(tabId, async (state) => {
      if (state.title !== request.title || canonicalDouyinText(state.description) !== canonicalDouyinText(description)
        || !state.mediaSignature || state.mediaSignature !== uploaded.mediaSignature || state.uploadBusy || state.publishButtonCount !== 1
        || !state.publishButtonEnabled || state.validationErrors?.length || state.coverEditing) return false;
      if (verifiedCover && !douyinCoverSnapshotsMatch(state.coverSnapshot, verifiedCover)) {
        // The page can replace a saved cover after its first readback. Re-read
        // both pictures against the exact uploaded files; never accept the new
        // identity merely because it is readable or looks similar in the UI.
        verifiedCover = await verifySavedImageCovers(tabId, request, uploadedCover.decoded);
        await retainVerifiedCover();
        return false; // A fresh probe must match this newly verified snapshot.
      }
      return true;
    }, 8 * 60_000, true);
    if (!ready) return outcome(request, false, 'not_submitted', 'not_started', 'EDITOR_NOT_READY', '视频处理、文案回读或页面校验尚未完成');
    await setOwner({ jobId: request.jobId, contentDigest: request.contentDigest, accountId: request.accountId,
      accountLabel: request.accountLabel, tabId, status: 'prepared', title: request.title, description,
      mediaSignature: ready.mediaSignature, mediaPath: request.mediaPath,
      coverSnapshot: ready.coverSnapshot, imageCover: request.imageCover });
    return { ...outcome(request, true, 'not_submitted'), prepared: true };
  } catch (error) {
    const stored = await owner();
    if (error?.coverReadbackDiagnostic && stored?.jobId === request.jobId && stored.contentDigest === request.contentDigest) {
      await setOwner({ ...stored, coverReadbackDiagnostic: error.coverReadbackDiagnostic });
    }
    return outcome(request, false, 'not_submitted', 'not_started', String(error?.code || 'PREPARE_FAILED'), String(error?.message || error));
  } finally { running.delete(request.jobId); }
}

function publishButtonRect() {
  const visible = (node) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden';
  };
  const buttons = Array.from(document.querySelectorAll('button,[role="button"]')).filter((node) => visible(node)
    && /^(发布|发布作品)$/.test(String(node.textContent || '').trim()) && !node.disabled);
  if (buttons.length !== 1) return null;
  buttons[0].scrollIntoView({ block: 'center', inline: 'center' });
  const rect = buttons[0].getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
  const hit = document.elementFromPoint(x, y);
  if (hit !== buttons[0] && !buttons[0].contains(hit)) return null;
  return { x, y };
}

async function trustedClick(tabId) {
  const rect = await execute(tabId, publishButtonRect);
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return false;
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    const target = { tabId };
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    return true;
  } finally { await chrome.debugger.detach({ tabId }).catch(() => {}); }
}

async function resetPage(tabId, request, receipt) {
  await chrome.tabs.update(tabId, { url: DOUYIN_UPLOAD_URL });
  const ready = await waitForProbe(tabId, (state) => state.uploadPage && !state.hasDraft
    && state.accountId === request.accountId && state.accountLabel === request.accountLabel, 30_000);
  const verified = ready ? await probe(tabId, true).catch(() => null) : null;
  const resetReady = verified?.uploadPage && !verified.hasDraft
    && verified.accountId === request.accountId && verified.accountLabel === request.accountLabel;
  const result = { ...receipt, resetStatus: resetReady ? 'ready' : 'failed' };
  await cache(request.jobId, result);
  if (resetReady) await clearOwner(request.jobId);
  return result;
}

async function submit(request) {
  const valid = validateDouyinRequest(request);
  if (!valid.ok) return outcome(request, false, 'not_submitted', 'not_started', valid.code, valid.message);
  const previous = await cached(request.jobId);
  if (previous) return previous;
  if (running.has(request.jobId)) return outcome(request, false, 'unknown', 'not_started', 'JOB_ALREADY_RUNNING', '提交正在进行');
  running.add(request.jobId);
  let clicked = false;
  let clickAttempted = false;
  try {
    const stored = await owner();
    const available = await tabs();
    if (!stored || stored.jobId !== request.jobId || stored.contentDigest !== request.contentDigest
      || stored.status !== 'prepared' || available.length !== 1 || available[0].id !== stored.tabId
      || stored.mediaPath !== request.mediaPath || !douyinImageCoversMatch(stored.imageCover, request.imageCover)) {
      return outcome(request, false, 'not_submitted', 'not_started', 'PREPARED_JOB_NOT_FOUND', '待提交草稿归属或媒体不匹配');
    }
    const tabId = stored.tabId;
    let before = await probe(tabId, true);
    if (before?.accountId === request.accountId && before.accountLabel === request.accountLabel) {
      before = await revealOwnedVideo(tabId, before);
    }
    if (!douyinEditorMatches(before, request, stored) || before.publishButtonCount !== 1 || !before.publishButtonEnabled
      || before.successText || before.pendingReviewText || before.publishedText) {
      return outcome(request, false, 'not_submitted', 'not_started', 'EDITOR_CHANGED', '发布页内容、账号或媒体已改变');
    }
    await setOwner({ ...stored, status: 'submitting' });
    clickAttempted = true;
    clicked = await trustedClick(tabId);
    if (!clicked) {
      await setOwner(stored);
      return outcome(request, false, 'not_submitted', 'not_started', 'PUBLISH_BUTTON_NOT_UNIQUE', '未找到唯一可用的发布按钮');
    }
    const feedback = await waitForProbe(tabId, (state) => state.publishedText || state.pendingReviewText || state.successText
      || state.securityChallenge || state.validationErrors?.length, 60_000);
    if (feedback?.validationErrors?.length) {
      await setOwner(stored);
      return outcome(request, false, 'not_submitted', 'not_started', 'EDITOR_VALIDATION_FAILED', feedback.validationErrors.join('；'));
    }
    const receipt = feedback?.publishedText ? outcome(request, true, 'published', 'returning')
      : feedback?.pendingReviewText || feedback?.successText ? outcome(request, true, 'pending_review', 'returning')
        : outcome(request, false, 'unknown', 'not_started', 'SUBMISSION_RESULT_UNKNOWN', '未核验到平台结果，请检查作品管理');
    await cache(request.jobId, receipt);
    return receipt.publishStatus === 'unknown' ? receipt : await resetPage(tabId, request, receipt);
  } catch (error) {
    const receipt = outcome(request, false, clickAttempted ? 'unknown' : 'not_submitted', 'not_started', String(error?.code || 'SUBMIT_FAILED'), String(error?.message || error));
    if (clickAttempted) await cache(request.jobId, receipt);
    return receipt;
  } finally { running.delete(request.jobId); }
}

async function recoverUnpublished(payload) {
  const jobId = String(payload?.jobId || '');
  const digest = String(payload?.contentDigest || '');
  if (!jobId || !/^[a-f0-9]{64}$/i.test(digest) || payload?.acknowledgedNotPublished !== true) {
    return outcome({ jobId }, false, 'unknown', 'not_started', 'REVIEW_REQUIRED', '请先人工核实本次未发布');
  }
  const stored = await owner();
  const previous = await cached(jobId);
  const available = await tabs();
  if (!stored || stored.jobId !== jobId || stored.contentDigest !== digest
    || stored.accountId !== payload.accountId || stored.accountLabel !== payload.accountLabel
    || previous?.publishStatus !== 'unknown' || available.length !== 1 || available[0].id !== stored.tabId) {
    return outcome({ jobId }, false, 'unknown', 'not_started', 'OWNERSHIP_NOT_VERIFIED', '旧任务归属或未知结果无法核验，未清理草稿');
  }
  const current = await probe(stored.tabId, true);
  if (current.accountId !== stored.accountId || current.accountLabel !== stored.accountLabel
    || current.successText || current.pendingReviewText || current.publishedText) {
    return outcome({ jobId }, false, 'unknown', 'not_started', 'RESULT_OR_ACCOUNT_CHANGED', '页面显示提交结果或账号已变化，未清理草稿');
  }
  if (current.hasDraft && (!current.editorPage || !douyinEditorMatches(current,
    { accountId: stored.accountId, accountLabel: stored.accountLabel }, stored))) {
    return outcome({ jobId }, false, 'unknown', 'not_started', 'DRAFT_CHANGED', '草稿媒体或文案已变化，未覆盖');
  }
  const reset = await resetPage(stored.tabId, stored, previous);
  return { ...reset, ok: reset.resetStatus === 'ready' };
}

async function reviewPublished(payload) {
  const jobId = String(payload?.jobId || '');
  const digest = String(payload?.contentDigest || '');
  if (!jobId || !/^[a-f0-9]{64}$/i.test(digest) || payload?.acknowledgedPublished !== true) {
    return outcome({ jobId }, false, 'unknown', 'not_started', 'REVIEW_REQUIRED', '请先人工核实本次已发布');
  }
  if (running.has(jobId)) return outcome({ jobId }, false, 'unknown', 'not_started', 'JOB_ALREADY_RUNNING', '原任务正在执行');
  running.add(jobId);
  try {
    const stored = await owner();
    const previous = await cached(jobId);
    const available = await tabs();
    if (!stored || stored.jobId !== jobId || stored.contentDigest !== digest
      || stored.accountId !== payload.accountId || stored.accountLabel !== payload.accountLabel
      || !['unknown', 'pending_review', 'published'].includes(previous?.publishStatus)
      || available.length !== 1 || available[0].id !== stored.tabId) {
      return outcome({ jobId }, false, 'unknown', 'not_started', 'OWNERSHIP_NOT_VERIFIED', '已发布记录与原浏览器任务归属无法核验');
    }
    const current = await probe(stored.tabId, true);
    if (!current?.uploadPage || current.editorPage || current.hasDraft || current.videoInputCount !== 1
      || current.loginRequired || current.securityChallenge
      || current.accountId !== stored.accountId || current.accountLabel !== stored.accountLabel) {
      return outcome({ jobId }, false, 'published', 'failed', 'PUBLISHED_PAGE_NOT_EMPTY', '已核实发布；原账号的空白上传页尚未恢复');
    }
    const reviewed = outcome({ jobId }, true, 'published', 'ready');
    await cache(jobId, reviewed);
    await clearOwner(jobId);
    return reviewed;
  } finally { running.delete(jobId); }
}

export async function douyinPublish(payload) {
  const request = payload?.request;
  if (payload?.phase === 'prepare') return await prepare(request);
  if (payload?.phase === 'submit') return await submit(request);
  if (payload?.phase === 'recover') return await recoverUnpublished(payload);
  if (payload?.phase === 'review-published') return await reviewPublished(payload);
  return outcome(request, false, 'not_submitted', 'not_started', 'INVALID_PHASE', '不支持的抖音发布阶段');
}
