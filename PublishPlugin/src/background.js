import {
  PUBLISH_URL,
  buildBody,
  choosePublishTargetCandidate,
  classifyPageProbe,
  findPublishButtonsInFlattenedDom,
  isUploadLandingReady,
  publishCandidatesFromAxTree,
  publishCandidatesFromFlattenedDom,
  validatePublishRequest,
  verifyPreparedEditorSnapshot,
} from './pageAdapter.js';

const NATIVE_HOST = 'com.gardenflow.browser_control';
const INSTANCE_KEY = 'gardenflowXhsPublisherInstanceId';
const RESULT_CACHE_KEY = 'gardenflowXhsPublisherResults';
const PREPARED_JOB_KEY = 'gardenflowXhsPublisherPreparedJob';
const RECONNECT_ALARM = 'gardenflow-xhs-publisher-reconnect';
const EXTENSION_KIND = 'xhs-publisher';
const CAPABILITY = 'xiaohongshu.publish.v1';
const PROTOCOL_VERSION = 1;
const PUBLISH_TAB_PATTERN = 'https://creator.xiaohongshu.com/*';

let nativePort = null;
let requestSequence = 0;
let nativeConnected = false;
const pending = new Map();
const inFlightJobs = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageError(error, fallbackCode = 'PUBLISHER_FAILED') {
  return {
    code: String(error?.code || fallbackCode),
    message: error instanceof Error ? error.message : String(error?.message || error || '发布插件执行失败'),
  };
}

async function instanceId() {
  const stored = await chrome.storage.local.get(INSTANCE_KEY);
  let value = String(stored?.[INSTANCE_KEY] || '').trim();
  if (!value) {
    value = `xhs-publisher-${crypto.randomUUID()}`;
    await chrome.storage.local.set({ [INSTANCE_KEY]: value });
  }
  return value;
}

function sendRequest(method, params = {}, timeoutMs = 5000) {
  if (!nativePort) return Promise.reject(Object.assign(new Error('Native transport is disconnected'), { code: 'NATIVE_DISCONNECTED' }));
  requestSequence += 1;
  const id = `publisher:${requestSequence}:${crypto.randomUUID()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error(`Native request timed out: ${method}`), { code: 'NATIVE_TIMEOUT' }));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    nativePort.postMessage({ jsonrpc: '2.0', id, method, params });
  });
}

function settleResponse(message) {
  const id = String(message?.id || '');
  const item = pending.get(id);
  if (!item || message?.method) return false;
  pending.delete(id);
  clearTimeout(item.timer);
  if (message.error) item.reject(Object.assign(new Error(message.error.message || 'Native request failed'), { code: message.error?.data?.code }));
  else item.resolve(message.result);
  return true;
}

async function connectNative() {
  if (nativePort) return;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    nativePort = port;
    port.onMessage.addListener((message) => {
      if (settleResponse(message)) return;
      if (message?.method && message?.id != null) void handleDesktopRequest(message);
    });
    port.onDisconnect.addListener(() => {
      if (nativePort === port) nativePort = null;
      nativeConnected = false;
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(Object.assign(new Error('Native transport disconnected'), { code: 'NATIVE_DISCONNECTED' }));
      }
      pending.clear();
      void chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: 0.08 });
    });
    await sendRequest('ping', {}, 4000);
    await sendRequest('extension.register', {
      extensionId: chrome.runtime.id,
      extensionInstanceId: await instanceId(),
      extensionKind: EXTENSION_KIND,
      capabilities: [CAPABILITY],
      version: chrome.runtime.getManifest().version,
      browser: navigator.userAgent.includes('Edg/') ? 'edge' : navigator.userAgent.includes('Brave') ? 'brave' : 'chrome',
    }, 4000);
    nativeConnected = true;
  } catch (error) {
    nativeConnected = false;
    if (nativePort) {
      try { nativePort.disconnect(); } catch {}
      nativePort = null;
    }
    void chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: 0.08 });
    throw error;
  }
}

async function publishTabs() {
  const tabs = await chrome.tabs.query({ url: PUBLISH_TAB_PATTERN });
  const publishPages = tabs.filter((tab) => {
    try {
      const url = new URL(tab.url || '');
      return url.pathname.startsWith('/publish');
    } catch {
      return false;
    }
  });
  if (publishPages.length > 0) return publishPages;
  return tabs.filter((tab) => {
    try {
      return new URL(tab.url || '').pathname.includes('/login');
    } catch {
      return false;
    }
  });
}

async function execute(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return results?.[0]?.result;
}

function probePage() {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const text = document.body?.innerText || '';
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]')).filter(visible).map((item) => item.textContent?.trim() || '');
  const controls = Array.from(document.querySelectorAll('button,a,[role="button"]')).filter(visible).map((item) => item.textContent?.trim() || '');
  const statusLabels = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"],div,span,p'))
    .filter(visible)
    .map((item) => item.textContent?.trim() || '')
    .filter((value) => value.length <= 20);
  const titleInput = Array.from(document.querySelectorAll('input,textarea')).find((item) => visible(item) && /标题/.test(item.getAttribute('placeholder') || ''));
  const editable = Array.from(document.querySelectorAll('[contenteditable="true"],textarea')).filter(visible);
  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
  const editorReady = Boolean(titleInput && editable.length > 0 && (fileInputs.length > 0 || /图片编辑|内容设置|上传视频/.test(text)));
  const uploadModeControl = controls.some((item) => item === '上传视频' || item === '上传图文');
  const uploadPrompt = /拖拽(?:视频|图片|图文)到此(?:或|，)?点击上传|点击上传(?:视频|图片)/.test(text);
  const publishTarget = new URL(location.href).searchParams.get('target');
  const uploadLandingEvidence = {
    publishPath: location.pathname,
    publishTarget,
    hasTitleInput: Boolean(titleInput),
    editableCount: editable.length,
    fileInputCount: fileInputs.length,
    uploadModeControl,
    genericUploadPrompt: uploadPrompt,
    imageUploadAction: controls.some((item) => item === '上传图片'),
    imageUploadPrompt: /上传图片\s*[，,]?\s*或写文字生成图片/.test(text),
    videoUploadAction: controls.some((item) => item === '上传视频'),
    videoUploadPrompt: /拖拽视频到此(?:或|，)?点击上传|点击上传视频/.test(text),
  };
  const titleValue = titleInput ? String(titleInput.value || '').trim() : '';
  const bodyValue = editable.map((item) => String(item.value || item.textContent || '').trim()).sort((a, b) => b.length - a.length)[0] || '';
  const editorRoot = titleInput?.closest('main,[class*="publish"],[class*="editor"]') || document.body;
  const mediaPreview = editorReady && Boolean(editorRoot?.querySelector('[class*="upload"] img,[class*="preview"] img,[class*="upload"] video,[class*="preview"] video'));
  const successHeading = headings.some((item) => item === '发布成功') || statusLabels.some((item) => item === '发布成功');
  const returnControl = controls.some((item) => item === '立即返回' || /返回发布页/.test(item));
  const autoReturnNotice = /\d+\s*秒后将返回发布页/.test(text);
  return {
    editorReady,
    uploadLandingEvidence,
    hasDraft: Boolean(titleValue || bodyValue || mediaPreview),
    titleValue,
    bodyValue,
    successPage: successHeading && returnControl && autoReturnNotice && !editorReady,
    loginRequired: location.pathname.includes('/login') || (/登录/.test(text) && !editorReady && !successHeading),
    securityChallenge: /安全验证|验证身份|滑块验证|请完成验证/.test(text),
    href: location.href,
  };
}

async function inspectTab(tabId) {
  const probe = await execute(tabId, probePage);
  const normalizedProbe = {
    ...probe,
    uploadLandingReady: isUploadLandingReady(probe?.uploadLandingEvidence),
  };
  return { probe: normalizedProbe, pageState: classifyPageProbe(normalizedProbe) };
}

async function currentStatus() {
  const tabs = await publishTabs();
  if (tabs.length !== 1 || !tabs[0]?.id) {
    return { nativeConnected, publishTabCount: tabs.length, pageState: 'unsupported', detail: tabs.length === 0 ? '请打开一个小红书官方发布页' : '请只保留一个小红书官方发布页' };
  }
  const state = await inspectTab(tabs[0].id);
  const ownership = await preparedOwnership();
  let publishControl = null;
  if (state.pageState === 'draft') {
    try {
      publishControl = await inspectTrustedPublishTarget(tabs[0].id);
    } catch (error) {
      publishControl = {
        ok: false,
        message: error instanceof Error ? error.message : String(error || '发布控件检查失败'),
      };
    }
  }
  const details = {
    ready: '发布页空白且可用',
    draft: ownership ? '发布页包含由发布插件准备的内容或其他草稿' : '发布页已有草稿，不会覆盖',
    login_required: '请先在专用浏览器登录小红书',
    security_challenge: '请先在专用浏览器完成安全验证',
    success: '检测到发布成功页面，正在等待返回发布页',
    unsupported: '当前页面不是可用的小红书发布编辑器',
  };
  return {
    nativeConnected,
    publishTabCount: 1,
    pageState: state.pageState,
    detail: state.pageState === 'draft'
      ? `${details.draft}；${publishControl?.ok ? '已识别唯一可用的发布按钮' : publishControl?.message || '未检查发布按钮'}`
      : details[state.pageState] || details.unsupported,
    publishControlReady: publishControl?.ok === true,
    ownedJobId: ownership?.jobId,
    ownedJobStatus: ownership?.status,
  };
}

function prepareMode(noteType) {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const expectedInputExists = Array.from(document.querySelectorAll('input[type="file"]')).some((item) => {
    const accept = String(item.getAttribute('accept') || '').toLowerCase();
    return noteType === 'video'
      ? accept.includes('video') || /\.(mp4|mov|m4v|webm)/.test(accept)
      : accept.includes('image') || /\.(png|jpe?g|webp)/.test(accept);
  });
  if (expectedInputExists) return { ok: true, changed: false };
  const publishTarget = new URL(location.href).searchParams.get('target');
  if ((noteType === 'image' && publishTarget === 'image')
    || (noteType === 'video' && publishTarget === 'video')) {
    return { ok: true, changed: false };
  }
  const targetTexts = noteType === 'video' ? ['上传视频', '视频'] : ['上传图文', '图文', '图片'];
  const controls = Array.from(document.querySelectorAll('button,[role="button"],[role="tab"],a,div,span'))
    .filter((item) => visible(item) && targetTexts.includes(item.textContent?.trim() || ''))
    .filter((item) => !Array.from(item.children).some((child) => targetTexts.includes(child.textContent?.trim() || '')));
  const target = controls.length === 1 ? controls[0] : null;
  if (!(target instanceof HTMLElement)) {
    return { ok: false, code: 'PUBLISH_MODE_NOT_FOUND', message: '无法唯一定位图文/视频发布模式，未继续操作' };
  }
  target.click();
  return { ok: true, changed: true };
}

async function setFiles(tabId, files, kind) {
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
    const root = await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument', { depth: -1, pierce: true });
    const nodes = await chrome.debugger.sendCommand({ tabId }, 'DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: 'input[type="file"]' });
    for (const nodeId of nodes.nodeIds || []) {
      const attrsResult = await chrome.debugger.sendCommand({ tabId }, 'DOM.getAttributes', { nodeId });
      const attrs = attrsResult.attributes || [];
      const attributes = Object.fromEntries(Array.from({ length: Math.floor(attrs.length / 2) }, (_, index) => [attrs[index * 2], attrs[index * 2 + 1]]));
      const accept = String(attributes.accept || '').toLowerCase();
      const matches = kind === 'video'
        ? accept.includes('video') || /\.(mp4|mov|m4v|webm)/.test(accept)
        : accept.includes('image') || /\.(png|jpe?g|webp)/.test(accept);
      if (!matches) continue;
      await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', { nodeId, files });
      const resolved = await chrome.debugger.sendCommand({ tabId }, 'DOM.resolveNode', { nodeId });
      const counted = await chrome.debugger.sendCommand({ tabId }, 'Runtime.callFunctionOn', {
        objectId: resolved.object.objectId,
        functionDeclaration: 'function () { return this.files ? this.files.length : 0; }',
        returnByValue: true,
      });
      return Number(counted?.result?.value || 0);
    }
    return 0;
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

function fillEditor(payload) {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const title = Array.from(document.querySelectorAll('input,textarea')).find((item) => visible(item) && /标题/.test(item.getAttribute('placeholder') || ''));
  const editables = Array.from(document.querySelectorAll('[contenteditable="true"],textarea')).filter((item) => visible(item) && item !== title);
  const body = editables.sort((left, right) => right.getBoundingClientRect().height - left.getBoundingClientRect().height)[0];
  if (!title || !body) return { ok: false, code: 'EDITOR_FIELDS_NOT_FOUND', message: '未找到标题或正文编辑器' };
  const setNativeValue = (element, value) => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setNativeValue(title, payload.title);
  if (body instanceof HTMLTextAreaElement) {
    setNativeValue(body, payload.body);
  } else {
    body.focus();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, payload.body);
    body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: payload.body }));
  }
  return {
    ok: true,
    title: String(title.value || '').trim(),
    body: String(body.value || body.innerText || body.textContent || '').trim(),
  };
}

function readPreparedEditorSnapshot() {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const title = Array.from(document.querySelectorAll('input,textarea'))
    .find((item) => visible(item) && /标题/.test(item.getAttribute('placeholder') || ''));
  const editables = Array.from(document.querySelectorAll('[contenteditable="true"],textarea'))
    .filter((item) => visible(item) && item !== title);
  const body = editables.sort((left, right) => right.getBoundingClientRect().height - left.getBoundingClientRect().height)[0];
  const titleValue = String(title?.value || '').trim();
  const bodyValue = String(body?.value || body?.innerText || body?.textContent || '').trim();
  const pageText = document.body?.innerText || '';
  const mediaBusy = /上传中|处理中|转码中|正在生成/.test(pageText);
  return {
    titleValue,
    bodyValue,
    mediaBusy,
  };
}

function preparedEditorFailure(verified) {
  if (!verified?.titleMatches || !verified?.bodyMatches) {
    return { code: 'EDITOR_VERIFICATION_FAILED', message: '标题或正文回读校验失败' };
  }
  if (verified.mediaBusy) {
    return { code: 'MEDIA_PROCESSING', message: '媒体仍在上传或处理中，请稍后安全重试' };
  }
  return { code: 'PREPARED_EDITOR_CHANGED', message: '已填充页面未通过提交前校验' };
}

function editorVerificationPayload(payload) {
  return {
    title: payload.title,
    expectedBody: buildBody(payload.body, payload.hashtags),
    noteType: payload.noteType,
    media: payload.media,
  };
}

async function readAccessibilityPublishCandidates(tabId) {
  await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
  await chrome.debugger.sendCommand({ tabId }, 'Accessibility.enable');
  const flattened = await chrome.debugger.sendCommand(
    { tabId },
    'DOM.getFlattenedDocument',
    { depth: -1, pierce: true },
  ).catch(() => ({ nodes: [] }));
  const tree = await chrome.debugger.sendCommand({ tabId }, 'Accessibility.getFullAXTree');
  const axPublishNodes = Array.from(tree?.nodes || []).filter((node) => {
    const name = String(node?.name?.value || '').replace(/\u00a0/g, ' ').replace(/\s+/gu, ' ').trim();
    const role = String(node?.role?.value || '').toLowerCase();
    return node?.ignored !== true && name === '发布' && role === 'button' && Number.isInteger(Number(node?.backendDOMNodeId));
  });
  const domPublishNodes = findPublishButtonsInFlattenedDom(flattened?.nodes);
  const backendNodeIds = new Set([
    ...axPublishNodes.map((node) => Number(node.backendDOMNodeId)),
    ...domPublishNodes.map((node) => Number(node.backendDOMNodeId)),
  ]);
  const boxModels = {};
  for (const backendDOMNodeId of backendNodeIds) {
    try {
      boxModels[backendDOMNodeId] = await chrome.debugger.sendCommand(
        { tabId },
        'DOM.getBoxModel',
        { backendNodeId: backendDOMNodeId },
      );
    } catch {}
  }
  const metrics = await chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics').catch(() => ({}));
  const viewportHeight = Number(
    metrics?.cssVisualViewport?.clientHeight
      || metrics?.visualViewport?.clientHeight
      || metrics?.cssLayoutViewport?.clientHeight
      || 0,
  );
  const combined = [
    ...publishCandidatesFromFlattenedDom(flattened?.nodes, boxModels, viewportHeight),
    ...publishCandidatesFromAxTree(tree?.nodes, boxModels, viewportHeight),
  ];
  return Array.from(new Map(combined.map((item) => [item.backendDOMNodeId, item])).values());
}

async function inspectTrustedPublishTarget(tabId) {
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    return choosePublishTargetCandidate(await readAccessibilityPublishCandidates(tabId));
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

async function dispatchTrustedPublishClick(tabId) {
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    const selected = choosePublishTargetCandidate(await readAccessibilityPublishCandidates(tabId));
    if (!selected.ok) return selected;
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: selected.x,
      y: selected.y,
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: selected.x,
      y: selected.y,
      button: 'left',
      clickCount: 1,
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: selected.x,
      y: selected.y,
      button: 'left',
      clickCount: 1,
    });
    return { ok: true, candidateCount: selected.candidateCount };
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

function clickImmediateReturn() {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const controls = Array.from(document.querySelectorAll('button,a,[role="button"]')).filter(visible);
  const target = controls.find((item) => item.textContent?.trim() === '立即返回');
  if (!(target instanceof HTMLElement)) return false;
  target.click();
  return true;
}

async function waitFor(tabId, predicate, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = await inspectTab(tabId);
      if (predicate(state)) return state;
    } catch {}
    await sleep(intervalMs);
  }
  return null;
}

async function restorePublishPage(tabId, jobId) {
  const ready = (state) => state.pageState === 'ready';
  if (await waitFor(tabId, ready, 8000)) return result(jobId, true, 'published', 'ready');
  await execute(tabId, clickImmediateReturn).catch(() => false);
  if (await waitFor(tabId, ready, 8000)) return result(jobId, true, 'published', 'ready');
  await chrome.tabs.update(tabId, { url: PUBLISH_URL });
  if (await waitFor(tabId, ready, 15000)) return result(jobId, true, 'published', 'ready');
  return result(jobId, false, 'published', 'failed', 'PUBLISH_PAGE_RESET_FAILED', '笔记已发布，但无法恢复为空白发布页');
}

function result(jobId, ok, publishStatus, resetStatus, code, message) {
  return { ok, jobId, publishStatus, resetStatus, code, message, publishedAt: publishStatus === 'published' ? Date.now() : undefined };
}

async function cachedResult(jobId) {
  const stored = await chrome.storage.local.get(RESULT_CACHE_KEY);
  return stored?.[RESULT_CACHE_KEY]?.[jobId] || null;
}

async function saveResult(jobId, value) {
  const stored = await chrome.storage.local.get(RESULT_CACHE_KEY);
  const current = stored?.[RESULT_CACHE_KEY] && typeof stored[RESULT_CACHE_KEY] === 'object' ? stored[RESULT_CACHE_KEY] : {};
  const next = { ...current, [jobId]: value };
  const entries = Object.entries(next).slice(-50);
  await chrome.storage.local.set({ [RESULT_CACHE_KEY]: Object.fromEntries(entries) });
}

async function preparedOwnership() {
  const stored = await chrome.storage.local.get(PREPARED_JOB_KEY);
  const value = stored?.[PREPARED_JOB_KEY];
  return value && typeof value === 'object' ? value : null;
}

async function savePreparedOwnership(value) {
  await chrome.storage.local.set({ [PREPARED_JOB_KEY]: value });
}

async function clearPreparedOwnership(jobId) {
  const current = await preparedOwnership();
  if (!current || !jobId || current.jobId === jobId) await chrome.storage.local.remove(PREPARED_JOB_KEY);
}

function preparedResult(jobId) {
  return { ...result(jobId, true, 'not_submitted', 'not_started'), prepared: true };
}

async function waitForPreparedEditor(tabId, payload, timeoutMs) {
  const verificationPayload = editorVerificationPayload(payload);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const snapshot = await execute(tabId, readPreparedEditorSnapshot);
      const state = verifyPreparedEditorSnapshot(snapshot, verificationPayload);
      if (state?.ok) return state;
    } catch {}
    await sleep(750);
  }
  return null;
}

async function preparePublish(payload) {
  const validation = validatePublishRequest(payload);
  if (!validation.ok) return result(String(payload?.jobId || ''), false, 'not_submitted', 'not_started', validation.code, validation.message);
  const previous = await cachedResult(payload.jobId);
  if (previous) return previous;
  const flightKey = `${payload.jobId}:prepare`;
  if (inFlightJobs.has(flightKey)) return result(payload.jobId, false, 'not_submitted', 'not_started', 'JOB_ALREADY_RUNNING', '该发布任务正在准备');
  inFlightJobs.add(flightKey);
  try {
    const tabs = await publishTabs();
    if (tabs.length !== 1 || !tabs[0]?.id) return result(payload.jobId, false, 'not_submitted', 'not_started', tabs.length ? 'MULTIPLE_PUBLISH_TABS' : 'PUBLISH_TAB_NOT_FOUND', tabs.length ? '请只保留一个小红书发布页' : '请打开小红书官方发布页');
    const tabId = tabs[0].id;
    const initial = await inspectTab(tabId);
    const ownership = await preparedOwnership();
    if (initial.pageState === 'draft'
      && (ownership?.status === 'prepared' || ownership?.status === 'preparing')
      && ownership.jobId === payload.jobId
      && ownership.contentDigest === payload.contentDigest
      && ownership.tabId === tabId) {
      const verificationPayload = editorVerificationPayload(payload);
      const snapshot = await execute(tabId, readPreparedEditorSnapshot);
      let verified = verifyPreparedEditorSnapshot(snapshot, verificationPayload);
      if (!verified?.ok && verified?.titleMatches && verified?.bodyMatches && verified?.mediaBusy) {
        const prepared = await waitForPreparedEditor(
          tabId,
          payload,
          payload.noteType === 'video' ? 8 * 60_000 : 2 * 60_000,
        );
        if (prepared) {
          verified = prepared;
        } else {
          const latestSnapshot = await execute(tabId, readPreparedEditorSnapshot);
          verified = verifyPreparedEditorSnapshot(latestSnapshot, verificationPayload);
        }
      }
      if (verified?.ok) {
        await savePreparedOwnership({ ...ownership, status: 'prepared', preparedAt: ownership.preparedAt || Date.now() });
        return preparedResult(payload.jobId);
      }
      const failure = preparedEditorFailure(verified);
      return result(payload.jobId, false, 'not_submitted', 'not_started', failure.code, failure.message);
    }
    if (initial.pageState !== 'ready') {
      const code = initial.pageState === 'draft' ? 'EXISTING_DRAFT' : initial.pageState === 'login_required' ? 'LOGIN_REQUIRED' : initial.pageState === 'security_challenge' ? 'SECURITY_CHALLENGE' : 'UNSUPPORTED_PAGE';
      return result(payload.jobId, false, 'not_submitted', 'not_started', code, initial.pageState === 'draft' ? '发布页已有内容，且未通过当前任务归属校验，不会覆盖' : '发布页未就绪，请完成登录或安全验证');
    }
    await savePreparedOwnership({
      jobId: payload.jobId,
      contentDigest: payload.contentDigest,
      tabId,
      status: 'preparing',
      preparedAt: 0,
    });
    const mode = await execute(tabId, prepareMode, [payload.noteType]);
    if (!mode?.ok) return result(payload.jobId, false, 'not_submitted', 'not_started', mode?.code || 'PUBLISH_MODE_NOT_FOUND', mode?.message || '未找到发布模式切换控件');
    await sleep(500);
    const images = payload.media.filter((item) => item.role !== 'video').sort((a, b) => a.order - b.order).map((item) => item.path);
    const videos = payload.media.filter((item) => item.role === 'video').sort((a, b) => a.order - b.order).map((item) => item.path);
    if (payload.noteType === 'video') {
      if (videos.length !== 1 || await setFiles(tabId, videos, 'video') !== videos.length) return result(payload.jobId, false, 'not_submitted', 'not_started', 'VIDEO_INPUT_NOT_FOUND', '未找到可用的视频上传控件或文件选择数量不一致');
    } else if (await setFiles(tabId, images, 'image') !== images.length) {
      return result(payload.jobId, false, 'not_submitted', 'not_started', 'IMAGE_INPUT_NOT_FOUND', '未找到可用的图片上传控件');
    }
    await sleep(payload.noteType === 'video' ? 2500 : 1200);
    if (payload.noteType === 'video' && images.length) {
      const coverCount = await setFiles(tabId, [images[0]], 'image').catch(() => 0);
      if (coverCount !== 1) return result(payload.jobId, false, 'not_submitted', 'not_started', 'COVER_INPUT_NOT_FOUND', '视频已上传，但未找到可用的自定义封面控件');
    }
    const finalBody = buildBody(payload.body, payload.hashtags);
    const filled = await execute(tabId, fillEditor, [{ title: payload.title, body: finalBody }]);
    if (!filled?.ok) {
      return result(payload.jobId, false, 'not_submitted', 'not_started', filled?.code || 'EDITOR_VERIFICATION_FAILED', filled?.message || '标题或正文回读校验失败');
    }
    const prepared = await waitForPreparedEditor(tabId, payload, payload.noteType === 'video' ? 8 * 60_000 : 2 * 60_000);
    if (!prepared) {
      return result(payload.jobId, false, 'not_submitted', 'not_started', 'UPLOAD_OR_VALIDATION_TIMEOUT', '媒体处理或页面校验未在限定时间内完成');
    }
    await savePreparedOwnership({
      jobId: payload.jobId,
      contentDigest: payload.contentDigest,
      tabId,
      status: 'prepared',
      preparedAt: Date.now(),
    });
    return preparedResult(payload.jobId);
  } catch (error) {
    const failure = messageError(error);
    return result(payload.jobId, false, 'not_submitted', 'not_started', failure.code, failure.message);
  } finally {
    inFlightJobs.delete(flightKey);
  }
}

async function submitPrepared(payload) {
  const jobId = String(payload?.jobId || '');
  const contentDigest = String(payload?.contentDigest || '');
  if (!jobId || !/^[a-f0-9]{64}$/i.test(contentDigest)) return result(jobId, false, 'not_submitted', 'not_started', 'INVALID_REQUEST', '提交请求无效');
  const previous = await cachedResult(jobId);
  if (previous) return previous;
  const flightKey = `${jobId}:submit`;
  if (inFlightJobs.has(flightKey)) return result(jobId, false, 'submitted', 'not_started', 'JOB_ALREADY_RUNNING', '该发布任务正在提交');
  inFlightJobs.add(flightKey);
  let submitted = false;
  try {
    const ownership = await preparedOwnership();
    if (ownership?.jobId !== jobId || ownership?.contentDigest !== contentDigest || ownership?.status !== 'prepared') {
      return result(jobId, false, 'not_submitted', 'not_started', 'PREPARED_JOB_NOT_FOUND', '未找到通过校验的待提交任务');
    }
    const tabs = await publishTabs();
    if (tabs.length !== 1 || !tabs[0]?.id || tabs[0].id !== ownership.tabId) {
      return result(jobId, false, 'not_submitted', 'not_started', 'PUBLISH_TAB_CHANGED', '准备完成后的发布页已变化，未点击发布');
    }
    const request = payload.request;
    const validation = validatePublishRequest(request);
    if (!validation.ok || request.jobId !== jobId || request.contentDigest !== contentDigest) {
      return result(jobId, false, 'not_submitted', 'not_started', validation.code || 'INVALID_REQUEST', validation.message || '提交内容与已准备任务不一致');
    }
    const snapshot = await execute(ownership.tabId, readPreparedEditorSnapshot);
    const verified = verifyPreparedEditorSnapshot(snapshot, editorVerificationPayload(request));
    if (!verified?.ok) return result(jobId, false, 'not_submitted', 'not_started', 'PREPARED_EDITOR_CHANGED', '发布页内容在提交前发生变化，未点击发布');
    await savePreparedOwnership({ ...ownership, status: 'submitting', submittedAt: Date.now() });
    const clicked = await dispatchTrustedPublishClick(ownership.tabId);
    if (!clicked?.ok) {
      await savePreparedOwnership(ownership);
      return result(jobId, false, 'not_submitted', 'not_started', clicked?.code, clicked?.message);
    }
    submitted = true;
    const success = await waitFor(ownership.tabId, (state) => state.pageState === 'success', 60_000, 750);
    if (!success) {
      const unknown = result(jobId, false, 'unknown', 'not_started', 'SUBMIT_RESULT_UNKNOWN', '已点击发布，但未能确认成功页面，请人工检查笔记管理页');
      await saveResult(jobId, unknown);
      return unknown;
    }
    const published = result(jobId, true, 'published', 'returning');
    await saveResult(jobId, published);
    await clearPreparedOwnership(jobId);
    const restored = await restorePublishPage(ownership.tabId, jobId);
    await saveResult(jobId, restored);
    return restored;
  } catch (error) {
    const failure = messageError(error);
    const value = result(jobId, false, submitted ? 'unknown' : 'not_submitted', 'not_started', failure.code, submitted ? '提交后连接中断，请人工检查发布结果' : failure.message);
    if (submitted) await saveResult(jobId, value);
    return value;
  } finally {
    inFlightJobs.delete(flightKey);
  }
}

async function discardPrepared(payload) {
  const jobId = String(payload?.jobId || '');
  const contentDigest = String(payload?.contentDigest || '');
  const ownership = await preparedOwnership();
  if (!jobId || ownership?.jobId !== jobId || ownership?.contentDigest !== contentDigest) {
    return { ok: false, jobId, discarded: false, code: 'PREPARED_JOB_NOT_FOUND', message: '没有可清理的当前任务内容' };
  }
  const tabs = await publishTabs();
  if (tabs.length !== 1 || !tabs[0]?.id || tabs[0].id !== ownership.tabId) {
    return { ok: false, jobId, discarded: false, code: 'PUBLISH_TAB_CHANGED', message: '发布页已变化，未自动清理页面' };
  }
  await chrome.tabs.update(ownership.tabId, { url: PUBLISH_URL });
  const ready = await waitFor(ownership.tabId, (state) => state.pageState === 'ready', 15_000);
  if (!ready) return { ok: false, jobId, discarded: false, code: 'PUBLISH_PAGE_RESET_FAILED', message: '当前任务已过期，但发布页未能恢复为空白状态' };
  await clearPreparedOwnership(jobId);
  return { ok: true, jobId, discarded: true };
}

async function publish(payload) {
  if (payload?.phase === 'prepare') return preparePublish(payload.request);
  if (payload?.phase === 'submit') return submitPrepared(payload);
  if (payload?.phase === 'discard') return discardPrepared(payload);
  return result(String(payload?.jobId || ''), false, 'not_submitted', 'not_started', 'INVALID_REQUEST', '缺少明确的发布执行阶段');
}

async function restore(payload) {
  const jobId = String(payload?.jobId || '');
  const tabs = await publishTabs();
  if (tabs.length !== 1 || !tabs[0]?.id) return result(jobId, false, 'published', 'failed', 'PUBLISH_TAB_NOT_FOUND', '无法定位唯一发布页');
  const restored = await restorePublishPage(tabs[0].id, jobId);
  if (restored.resetStatus === 'ready') await clearPreparedOwnership(jobId);
  return restored;
}

async function handleDesktopRequest(message) {
  const id = message.id;
  try {
    let value;
    if (message.method === 'publisher.status') value = await currentStatus();
    else if (message.method === 'publisher.publish') value = await publish(message.params || {});
    else if (message.method === 'publisher.restore') value = await restore(message.params || {});
    else throw Object.assign(new Error(`Unsupported publisher method: ${message.method}`), { code: 'METHOD_NOT_ALLOWED' });
    nativePort?.postMessage({ jsonrpc: '2.0', id, result: value });
  } catch (error) {
    const failure = messageError(error);
    nativePort?.postMessage({ jsonrpc: '2.0', id, error: { code: -32000, message: failure.message, data: { code: failure.code } } });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'publisher.status') return undefined;
  void currentStatus().then(sendResponse).catch((error) => sendResponse({ nativeConnected, detail: messageError(error).message }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void connectNative().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  void connectNative().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  void connectNative().catch(() => {});
});

void connectNative().catch(() => {});
