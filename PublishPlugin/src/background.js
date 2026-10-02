import {
  PUBLISH_URL,
  buildPublishModeUrl,
  buildBody,
  canResumeOwnedPreparingDraft,
  choosePublishTargetCandidate,
  classifyPageProbe,
  findFileInputsInFlattenedDom,
  findPublishButtonsInFlattenedDom,
  isUploadLandingReady,
  isPublishModeReady,
  publishCandidatesFromAxTree,
  publishCandidatesFromFlattenedDom,
  publishModeMatches,
  validatePublishRequest,
  verifyPreparedEditorSnapshot,
  editorValidationFailure,
  validateDraftRecovery,
  validateDraftAmendment,
  preparedMediaMatches,
} from './pageAdapter.js';
import { douyinPublish, douyinStatus } from './douyinPublisher.js';

const NATIVE_HOST = 'com.gardenflow.browser_control';
const INSTANCE_KEY = 'gardenflowXhsPublisherInstanceId';
const RESULT_CACHE_KEY = 'gardenflowXhsPublisherResults';
const PREPARED_JOB_KEY = 'gardenflowXhsPublisherPreparedJob';
const RECONNECT_ALARM = 'gardenflow-xhs-publisher-reconnect';
const EXTENSION_KIND = 'xhs-publisher';
const CAPABILITY = 'xiaohongshu.publish.v1';
const DOUYIN_CAPABILITY = 'douyin.publish.v1';
const DOUYIN_COVER_CAPABILITY = 'douyin.image-cover.v1';
const PROTOCOL_VERSION = 1;
const PUBLISH_TAB_PATTERN = 'https://creator.xiaohongshu.com/*';

let nativePort = null;
let requestSequence = 0;
let nativeConnected = false;
let nativeConnectionAttempt = null;
let nativeConnectionError = '';
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
  if (nativeConnectionAttempt) return nativeConnectionAttempt;
  nativeConnectionAttempt = refreshNativeConnection().finally(() => { nativeConnectionAttempt = null; });
  return nativeConnectionAttempt;
}

async function refreshNativeConnection() {
  // A Native Messaging port can survive a desktop restart. Probe and register
  // again without changing this browser's identity or its prepared draft.
  await chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  try {
    if (!nativePort) {
      const port = chrome.runtime.connectNative(NATIVE_HOST);
      nativePort = port;
      port.onMessage.addListener((message) => {
        if (nativePort !== port) return;
        if (settleResponse(message)) return;
        if (message?.method && message?.id != null) void handleDesktopRequest(message);
      });
      port.onDisconnect.addListener(() => {
        if (nativePort !== port) return;
        nativePort = null;
        nativeConnected = false;
        nativeConnectionError = '发布插件与 Native Host 的连接已断开';
        for (const item of pending.values()) {
          clearTimeout(item.timer);
          item.reject(Object.assign(new Error('Native transport disconnected'), { code: 'NATIVE_DISCONNECTED' }));
        }
        pending.clear();
      });
    }
    const handshake = await sendRequest('ping', {}, 4000);
    if (handshake?.desktopBridge?.connected !== true) {
      nativeConnected = false;
      nativeConnectionError = 'GardenFlow 桌面尚未连接，正在等待恢复';
      return;
    }
    const manifest = chrome.runtime.getManifest();
    await sendRequest('extension.register', {
      extensionId: chrome.runtime.id,
      extensionInstanceId: await instanceId(),
      extensionKind: EXTENSION_KIND,
      capabilities: [CAPABILITY, DOUYIN_CAPABILITY, DOUYIN_COVER_CAPABILITY],
      version: manifest.version_name || manifest.version,
      browser: navigator.userAgent.includes('Edg/') ? 'edge' : navigator.userAgent.includes('Brave') ? 'brave' : 'chrome',
    }, 4000);
    nativeConnected = true;
    nativeConnectionError = '';
  } catch (error) {
    nativeConnected = false;
    nativeConnectionError = messageError(error).message;
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
  const validationErrors = Array.from(document.querySelectorAll('input,textarea,[aria-invalid="true"]'))
    .filter(visible)
    .flatMap((item) => {
      if (item.validity?.valid === false && item.validationMessage) return [item.validationMessage];
      if (item.getAttribute('aria-invalid') !== 'true') return [];
      return String(item.getAttribute('aria-errormessage') || item.getAttribute('aria-describedby') || '').split(/\s+/)
        .map((id) => document.getElementById(id)).filter((node) => node && visible(node)).map((node) => node.textContent.trim()).filter(Boolean);
    });
  const bodyValue = editable.map((item) => String(item.value || item.textContent || '').trim()).sort((a, b) => b.length - a.length)[0] || '';
  const editorRoot = titleInput?.closest('main,[class*="publish"],[class*="editor"]') || document.body;
  const mediaPreview = editorReady && Boolean(editorRoot?.querySelector('[class*="upload"] img,[class*="preview"] img,[class*="upload"] video,[class*="preview"] video'));
  const successHeading = headings.some((item) => item === '发布成功') || statusLabels.some((item) => item === '发布成功');
  const returnControl = controls.some((item) => item === '立即返回' || /返回发布页/.test(item));
  const autoReturnNotice = /\d+\s*秒后将返回发布页/.test(text);
  const pageAlerts = Array.from(document.querySelectorAll('[role="alert"],[class*="toast"],[class*="message-content"]'))
    .filter(visible).map((item) => String(item.innerText || item.textContent || '').trim())
    // This parses platform error feedback, not user intent. Progress/success
    // notices must not terminate the success wait as an ambiguous failure.
    .filter((value) => value && value.length <= 500 && /失败|错误|异常|繁忙|超出|超限|不能为空|未通过|不符合|不支持|请.{0,30}(?:填写|添加|上传|声明|选择)/u.test(value));
  return {
    editorReady,
    uploadLandingEvidence,
    hasDraft: Boolean(titleValue || bodyValue || mediaPreview),
    titleValue,
    bodyValue,
    validationErrors,
    pageAlerts,
    successPage: successHeading && (returnControl || autoReturnNotice) && !editorReady,
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

function publishTargetFromState(state) {
  const target = state?.probe?.uploadLandingEvidence?.publishTarget;
  return target === 'image' || target === 'video' ? target : undefined;
}

function publishModeReady(state, noteType) {
  return state?.pageState === 'ready'
    && isPublishModeReady(state?.probe?.uploadLandingEvidence, noteType);
}

function publishModeFailure(state, fallbackCode = 'PUBLISH_MODE_NOT_READY') {
  if (state?.pageState === 'login_required') {
    return { ok: false, code: 'LOGIN_REQUIRED', message: '请先在专用浏览器登录小红书' };
  }
  if (state?.pageState === 'security_challenge') {
    return { ok: false, code: 'SECURITY_CHALLENGE', message: '请先在专用浏览器完成安全验证' };
  }
  if (state?.pageState === 'draft') {
    return { ok: false, code: 'PUBLISH_MODE_NOT_EMPTY', message: '目标发布模式不是空白上传页，未继续操作' };
  }
  return { ok: false, code: fallbackCode, message: '目标图文/视频发布页未在限定时间内就绪' };
}

async function waitForPublishMode(tabId, noteType, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    try {
      lastState = await inspectTab(tabId);
      if (publishModeReady(lastState, noteType)) return { ok: true, state: lastState };
      if (lastState.pageState === 'login_required' || lastState.pageState === 'security_challenge') {
        return publishModeFailure(lastState);
      }
      if (lastState.pageState === 'draft'
        && publishModeMatches(lastState.probe?.uploadLandingEvidence, noteType)) {
        return publishModeFailure(lastState);
      }
    } catch {}
    await sleep(500);
  }
  return publishModeFailure(lastState);
}

async function ensurePublishMode(tabId, noteType, currentState, options = {}) {
  if (publishModeReady(currentState, noteType)) return { ok: true, state: currentState };
  if (currentState?.pageState === 'draft'
    || currentState?.pageState === 'login_required'
    || currentState?.pageState === 'security_challenge') {
    return publishModeFailure(currentState);
  }
  const nextUrl = buildPublishModeUrl(noteType, currentState?.probe?.href || PUBLISH_URL, options);
  await chrome.tabs.update(tabId, { url: nextUrl });
  return await waitForPublishMode(tabId, noteType);
}

async function currentStatus() {
  const tabs = await publishTabs();
  if (tabs.length !== 1 || !tabs[0]?.id) {
    return { nativeConnected, publishTabCount: tabs.length, pageState: 'unsupported', detail: tabs.length === 0 ? '请打开一个小红书官方发布页' : '请只保留一个小红书官方发布页' };
  }
  const state = await inspectTab(tabs[0].id);
  const publishTarget = publishTargetFromState(state);
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
    ready: publishTarget === 'image'
      ? '空白图文发布页可用'
      : publishTarget === 'video'
        ? '空白视频发布页可用'
        : '发布页空白且可用',
    draft: ownership ? '发布页包含由发布插件准备的内容或其他草稿' : '发布页已有草稿，不会覆盖',
    login_required: '请先在专用浏览器登录小红书',
    security_challenge: '请先在专用浏览器完成安全验证',
    success: '检测到发布成功页面，正在等待返回发布页',
    unsupported: '当前页面不是可用的小红书发布编辑器',
  };
  return {
    nativeConnected,
    nativeConnectionError,
    publishTabCount: 1,
    pageState: state.pageState,
    publishTarget,
    detail: state.pageState === 'draft'
      ? `${details.draft}；${publishControl?.ok ? '已识别唯一可用的发布按钮' : publishControl?.message || '未检查发布按钮'}`
      : details[state.pageState] || details.unsupported,
    publishControlReady: publishControl?.ok === true,
    ownedJobId: ownership?.jobId,
    ownedJobStatus: ownership?.status,
  };
}

async function setFiles(tabId, files, kind) {
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
    const flattened = await chrome.debugger.sendCommand(
      { tabId },
      'DOM.getFlattenedDocument',
      { depth: -1, pierce: true },
    );
    for (const candidate of findFileInputsInFlattenedDom(flattened?.nodes, kind)) {
      await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', {
        backendNodeId: candidate.backendDOMNodeId,
        files,
      });
      // Xiaohongshu replaces the file input as soon as an upload starts. A successful
      // CDP assignment is therefore the last safe operation on this node; the editor
      // readiness loop below verifies the resulting upload and fields separately.
      return files.length;
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
  if (typeof payload.title === 'string') setNativeValue(title, payload.title);
  if (typeof payload.body === 'string' && body instanceof HTMLTextAreaElement) {
    setNativeValue(body, payload.body);
  } else if (typeof payload.body === 'string') {
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
  const validationErrors = Array.from(document.querySelectorAll('input,textarea,[aria-invalid="true"]'))
    .filter(visible)
    .flatMap((item) => {
      if (item.validity?.valid === false && item.validationMessage) return [item.validationMessage];
      if (item.getAttribute('aria-invalid') !== 'true') return [];
      return String(item.getAttribute('aria-errormessage') || item.getAttribute('aria-describedby') || '').split(/\s+/)
        .map((id) => document.getElementById(id)).filter((node) => node && visible(node)).map((node) => node.textContent.trim()).filter(Boolean);
    });
  const editorRoot = title?.closest('main,[class*="publish"],[class*="editor"]') || document.body;
  const mediaSources = Array.from(editorRoot.querySelectorAll('[class*="upload"] img,[class*="preview"] img,[class*="upload"] video,[class*="preview"] video'))
    .map((node) => String(node.currentSrc || node.src || '')).filter(Boolean);
  // Older publisher pages do not always wrap the video in upload/preview
  // classes. A unique visible video is a legacy anchor, not a media override.
  if (!mediaSources.length) {
    const videos = Array.from(document.querySelectorAll('video')).filter(visible);
    if (videos.length === 1) {
      const source = String(videos[0].currentSrc || videos[0].src || '');
      if (source) mediaSources.push(source);
    }
  }
  // The video upload card can show only a file name/cover, with no playable
  // <video> URL. Read exact visible file labels, excluding the copy editor;
  // never infer media identity from arbitrary prose or preview text.
  const mediaFileNames = [...new Set([
    ...Array.from(document.querySelectorAll('input[type="file"]')).flatMap((input) => Array.from(input.files || [], (file) => file.name)),
    ...Array.from(document.querySelectorAll('span,div,p,[title]'))
      .filter((node) => visible(node) && node !== title && !body?.contains(node))
      .flatMap((node) => [
        Array.from(node.childNodes || []).filter((child) => child.nodeType === 3).map((child) => child.textContent || '').join('')
          || (!node.children.length ? node.innerText || node.textContent : ''),
        node.getAttribute('title'),
      ].map((value) => String(value || '').trim())),
  ].filter((name) => /^[^/\\\r\n]+\.(?:mp4|mov|m4v|webm|avi)$/i.test(name)))].sort();
  return {
    titleValue,
    bodyValue,
    mediaBusy,
    validationErrors,
    mediaSources,
    mediaFileNames,
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
  const observationKey = `gardenflowPublishClick_${crypto.randomUUID()}`;
  let objectId;
  let mayHaveDispatched = false;
  const call = async (fn, ...args) => {
    const value = await chrome.debugger.sendCommand({ tabId }, 'Runtime.callFunctionOn', {
      objectId, functionDeclaration: fn.toString(), arguments: args.map((value) => ({ value })), returnByValue: true,
    });
    if (value?.exceptionDetails) throw new Error('无法核验发布按钮事件');
    return value?.result?.value;
  };
  try {
    const initial = choosePublishTargetCandidate(await readAccessibilityPublishCandidates(tabId));
    if (!initial.ok) return initial;
    await chrome.debugger.sendCommand({ tabId }, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: initial.backendDOMNodeId });
    // Scroll/hover may change layout or replace controls. Resolve the fresh
    // unique node, not a cached coordinate, including closed shadow buttons.
    const selected = choosePublishTargetCandidate(await readAccessibilityPublishCandidates(tabId));
    if (!selected.ok) return selected;
    const resolved = await chrome.debugger.sendCommand({ tabId }, 'DOM.resolveNode', {
      backendNodeId: selected.backendDOMNodeId, objectGroup: observationKey,
    });
    objectId = resolved?.object?.objectId;
    if (!objectId) return { ok: false, code: 'PUBLISH_BUTTON_NOT_FOUND', message: '发布按钮已变化，未点击' };
    const armed = await call(armTrustedPublishClick, observationKey);
    if (!armed?.ok) return armed || { ok: false, code: 'PUBLISH_BUTTON_UNVERIFIED', message: '无法核验发布按钮，未点击' };
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: armed.x, y: armed.y, buttons: 0,
    });
    const beforePress = await call(readTrustedPublishClick, observationKey);
    if (!beforePress?.hitTestable) return { ok: false, code: 'PUBLISH_BUTTON_OBSCURED', message: '发布按钮被遮挡或位置已变化，未点击' };
    // Mark uncertainty BEFORE dispatch: a transport error is not proof that
    // the browser did not receive the event. Never retry a click here.
    mayHaveDispatched = true;
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: armed.x, y: armed.y, button: 'left', buttons: 1, clickCount: 1,
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: armed.x, y: armed.y, button: 'left', buttons: 0, clickCount: 1,
    });
    const deadline = Date.now() + 1500;
    do {
      const observed = await call(readTrustedPublishClick, observationKey);
      if (observed?.clickObserved) return { ok: true, clickObserved: true, mayHaveDispatched: true, candidateCount: selected.candidateCount };
      await sleep(100);
    } while (Date.now() < deadline);
    return { ok: true, clickObserved: false, mayHaveDispatched: true };
  } catch (error) {
    return { ok: false, mayHaveDispatched, code: mayHaveDispatched ? 'PUBLISH_CLICK_UNVERIFIED' : 'PUBLISH_BUTTON_UNVERIFIED',
      message: mayHaveDispatched ? '点击传输中断，不能确认网页是否收到；不会自动再点' : `未点击发布：${messageError(error).message}` };
  } finally {
    if (objectId) await call(clearTrustedPublishClick, observationKey).catch(() => {});
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.releaseObjectGroup', { objectGroup: observationKey }).catch(() => {});
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

// Self-contained functions called on the selected DOM object by CDP. The
// listener lives on the actual button (including inside closed shadow DOM),
// never prevents events, and is removed with its ephemeral observation key.
function armTrustedPublishClick(key) {
  if (window !== window.top || !this.isConnected) return { ok: false, code: 'PUBLISH_BUTTON_UNVERIFIED', message: '无法核验主页面发布按钮，未点击' };
  const name = String(this.getAttribute('aria-label') || this.textContent || '').replace(/\s+/gu, ' ').trim();
  if (name !== '发布') return { ok: false, code: 'PUBLISH_BUTTON_CHANGED', message: '发布按钮内容已变化，未点击' };
  const style = getComputedStyle(this);
  const rect = this.getBoundingClientRect();
  const left = Math.max(0, rect.left), right = Math.min(window.innerWidth, rect.right);
  const top = Math.max(0, rect.top), bottom = Math.min(window.innerHeight, rect.bottom);
  if (right <= left || bottom <= top || style.display === 'none' || style.visibility === 'hidden') {
    return { ok: false, code: 'PUBLISH_BUTTON_OFFSCREEN', message: '发布按钮不在可见区域，未点击' };
  }
  const x = (left + right) / 2, y = (top + bottom) / 2;
  const monitor = { clickObserved: false, x, y };
  monitor.check = () => {
    if (!this.isConnected || this.disabled || this.getAttribute('aria-disabled') === 'true' || this.getAttribute('aria-busy') === 'true') return false;
    const current = this.getBoundingClientRect();
    const currentStyle = getComputedStyle(this);
    if (currentStyle.pointerEvents === 'none' || currentStyle.visibility === 'hidden' || currentStyle.display === 'none'
      || x < current.left || x >= current.right || y < current.top || y >= current.bottom) return false;
    const root = this.getRootNode();
    const hit = root.elementFromPoint?.(x, y);
    let outer = this;
    for (let scope = root; scope?.host; scope = outer.getRootNode()) outer = scope.host;
    const documentHit = this.ownerDocument.elementFromPoint(x, y);
    return Boolean(hit && (hit === this || this.contains(hit))
      && documentHit && (documentHit === outer || outer.contains(documentHit)));
  };
  if (!monitor.check()) return { ok: false, code: 'PUBLISH_BUTTON_OBSCURED', message: '发布按钮被遮挡或不可用，未点击' };
  monitor.listener = (event) => {
    if (event.isTrusted && event.button === 0 && Math.abs(event.clientX - x) <= 2 && Math.abs(event.clientY - y) <= 2) monitor.clickObserved = true;
  };
  Object.defineProperty(this, key, { configurable: true, value: monitor });
  this.addEventListener('click', monitor.listener, { capture: true, passive: true });
  return { ok: true, x, y };
}

function readTrustedPublishClick(key) {
  const monitor = this[key];
  return { clickObserved: monitor?.clickObserved === true, hitTestable: monitor?.check() === true };
}

function clearTrustedPublishClick(key) {
  const monitor = this[key];
  if (monitor) this.removeEventListener('click', monitor.listener, true);
  delete this[key];
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

async function restorePublishPage(tabId, jobId, noteType) {
  if (noteType !== 'image' && noteType !== 'video') {
    return result(jobId, false, 'published', 'failed', 'INVALID_REQUEST', '笔记已发布，但恢复发布页时缺少有效的笔记类型');
  }
  const anyReady = (state) => state.pageState === 'ready';
  let returned = await waitFor(tabId, anyReady, 8000);
  if (returned && publishModeReady(returned, noteType)) {
    return result(jobId, true, 'published', 'ready');
  }
  if (!returned) {
    await execute(tabId, clickImmediateReturn).catch(() => false);
    returned = await waitFor(tabId, anyReady, 8000);
    if (returned && publishModeReady(returned, noteType)) {
      return result(jobId, true, 'published', 'ready');
    }
  }
  let current = returned;
  if (!current) {
    current = await inspectTab(tabId).catch(() => null);
  }
  const restored = await ensurePublishMode(tabId, noteType, current, { published: true });
  if (restored?.ok) return result(jobId, true, 'published', 'ready');
  return result(
    jobId,
    false,
    'published',
    'failed',
    restored?.code || 'PUBLISH_PAGE_RESET_FAILED',
    `笔记已发布，但${restored?.message || '无法恢复到对应类型的空白发布页'}`,
  );
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
      const validationError = editorValidationFailure(snapshot);
      if (validationError) return { ...state, ok: false, validationError };
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
    const ownedDraft = initial.pageState === 'draft'
      && (ownership?.status === 'prepared' || ownership?.status === 'preparing')
      && ownership.jobId === payload.jobId
      && ownership.contentDigest === payload.contentDigest
      && ownership.tabId === tabId;
    if (ownedDraft) {
      if ((ownership.noteType && ownership.noteType !== payload.noteType)
        || !publishModeMatches(initial.probe?.uploadLandingEvidence, payload.noteType)) {
        return result(payload.jobId, false, 'not_submitted', 'not_started', 'PUBLISH_MODE_CHANGED', '当前任务所在页面的图文/视频模式已变化，未继续操作');
      }
      const verificationPayload = editorVerificationPayload(payload);
      let snapshot = await execute(tabId, readPreparedEditorSnapshot);
      if (canResumeOwnedPreparingDraft(snapshot, ownership.status)) {
        const filled = await execute(tabId, fillEditor, [{
          title: payload.title,
          body: verificationPayload.expectedBody,
        }]);
        if (!filled?.ok) {
          return result(payload.jobId, false, 'not_submitted', 'not_started', filled?.code || 'EDITOR_VERIFICATION_FAILED', filled?.message || '标题或正文填写失败');
        }
        snapshot = await execute(tabId, readPreparedEditorSnapshot);
      }
      let verified = verifyPreparedEditorSnapshot(snapshot, verificationPayload);
      const initialValidationError = editorValidationFailure(snapshot);
      if (initialValidationError) return result(payload.jobId, false, 'not_submitted', 'not_started', initialValidationError.code, initialValidationError.message);
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
      if (verified?.validationError) return result(payload.jobId, false, 'not_submitted', 'not_started', verified.validationError.code, verified.validationError.message);
      if (verified?.ok) {
        if (!preparedMediaMatches(verified, ownership)) return result(payload.jobId, false, 'not_submitted', 'not_started', 'PREPARED_MEDIA_CHANGED', '已准备的媒体发生变化，未提交');
        await savePreparedOwnership({ ...ownership, noteType: payload.noteType, status: 'prepared', preparedAt: ownership.preparedAt || Date.now(), mediaSources: verified.mediaSources, mediaFileNames: verified.mediaFileNames });
        return preparedResult(payload.jobId);
      }
      const failure = preparedEditorFailure(verified);
      return result(payload.jobId, false, 'not_submitted', 'not_started', failure.code, failure.message);
    }
    if (initial.pageState !== 'ready') {
      const code = initial.pageState === 'draft' ? 'EXISTING_DRAFT' : initial.pageState === 'login_required' ? 'LOGIN_REQUIRED' : initial.pageState === 'security_challenge' ? 'SECURITY_CHALLENGE' : 'UNSUPPORTED_PAGE';
      return result(payload.jobId, false, 'not_submitted', 'not_started', code, initial.pageState === 'draft' ? '发布页已有内容，且未通过当前任务归属校验，不会覆盖' : '发布页未就绪，请完成登录或安全验证');
    }
    const mode = await ensurePublishMode(tabId, payload.noteType, initial);
    if (!mode?.ok) {
      return result(payload.jobId, false, 'not_submitted', 'not_started', mode?.code || 'PUBLISH_MODE_NOT_READY', mode?.message || '目标图文/视频发布页未就绪');
    }
    await savePreparedOwnership({
      jobId: payload.jobId,
      contentDigest: payload.contentDigest,
      tabId,
      noteType: payload.noteType,
      status: 'preparing',
      preparedAt: 0,
      sessionId: payload.sessionId,
      projectPath: payload.projectPath,
      media: payload.media,
    });
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
    if (prepared?.validationError) {
      return result(payload.jobId, false, 'not_submitted', 'not_started', prepared.validationError.code, prepared.validationError.message);
    }
    if (!prepared) {
      return result(payload.jobId, false, 'not_submitted', 'not_started', 'UPLOAD_OR_VALIDATION_TIMEOUT', '媒体处理或页面校验未在限定时间内完成');
    }
    await savePreparedOwnership({
      jobId: payload.jobId,
      contentDigest: payload.contentDigest,
      tabId,
      noteType: payload.noteType,
      status: 'prepared',
      preparedAt: Date.now(),
      mediaSources: prepared.mediaSources,
      mediaFileNames: prepared.mediaFileNames,
      sessionId: payload.sessionId,
      projectPath: payload.projectPath,
      media: payload.media,
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
    if (ownership.noteType !== request.noteType) {
      return result(jobId, false, 'not_submitted', 'not_started', 'PUBLISH_MODE_CHANGED', '准备任务的图文/视频类型与提交请求不一致');
    }
    const submitState = await inspectTab(ownership.tabId);
    if (!publishModeMatches(submitState.probe?.uploadLandingEvidence, request.noteType)) {
      return result(jobId, false, 'not_submitted', 'not_started', 'PUBLISH_MODE_CHANGED', '发布页的图文/视频模式在提交前发生变化，未点击发布');
    }
    const snapshot = await execute(ownership.tabId, readPreparedEditorSnapshot);
    const validationError = editorValidationFailure(snapshot);
    if (validationError) return result(jobId, false, 'not_submitted', 'not_started', validationError.code, validationError.message);
    const verified = verifyPreparedEditorSnapshot(snapshot, editorVerificationPayload(request));
    if (!verified?.ok) return result(jobId, false, 'not_submitted', 'not_started', 'PREPARED_EDITOR_CHANGED', '发布页内容在提交前发生变化，未点击发布');
    if (!preparedMediaMatches(snapshot, ownership)) return result(jobId, false, 'not_submitted', 'not_started', 'PREPARED_MEDIA_CHANGED', '发布页媒体在提交前发生变化，未点击发布');
    await savePreparedOwnership({ ...ownership, status: 'submitting', submittedAt: Date.now() });
    const clicked = await dispatchTrustedPublishClick(ownership.tabId);
    submitted = clicked?.mayHaveDispatched === true || clicked?.ok === true;
    if (!submitted) {
      await savePreparedOwnership(ownership);
      return result(jobId, false, 'not_submitted', 'not_started', clicked?.code, clicked?.message);
    }
    const originalAlerts = new Set(submitState.probe?.pageAlerts || []);
    const success = await waitFor(ownership.tabId, (state) => state.pageState === 'success'
      || state.pageState === 'security_challenge'
      || (state.probe?.editorReady && editorValidationFailure(state.probe))
      || state.probe?.pageAlerts?.some((alert) => !originalAlerts.has(alert)), 60_000, 750);
    if (success?.pageState !== 'success' && editorValidationFailure(success?.probe)) {
      // Only explicit field validity failures are proof of rejected validation;
      // a generic server alert or unchanged page is still an unknown result.
      const rejected = editorValidationFailure(success.probe);
      await savePreparedOwnership(ownership);
      return result(jobId, false, 'not_submitted', 'not_started', rejected.code, rejected.message);
    }
    if (success?.pageState !== 'success') {
      const alert = success?.probe?.pageAlerts?.find((item) => !originalAlerts.has(item));
      const code = success?.pageState === 'security_challenge' ? 'SECURITY_CHALLENGE_AFTER_CLICK'
        : alert ? 'SUBMISSION_PAGE_ALERT' : clicked?.clickObserved === true ? 'SUBMISSION_FEEDBACK_MISSING' : 'PUBLISH_CLICK_UNVERIFIED';
      const evidence = clicked?.clickObserved === true ? '已观察到发布按钮收到点击' : '已发送点击指令，但未观察到按钮点击事件';
      const detail = success?.pageState === 'security_challenge' ? '页面要求安全验证'
        : alert ? `页面提示：${alert}` : '未识别到平台成功或明确表单拒绝反馈';
      const unknown = result(jobId, false, 'unknown', 'not_started', code, `${evidence}；${detail}。不能确认是否提交，不会自动再点，请检查笔记管理`);
      await saveResult(jobId, unknown);
      return unknown;
    }
    const published = result(jobId, true, 'published', 'returning');
    await saveResult(jobId, published);
    await clearPreparedOwnership(jobId);
    const restored = await restorePublishPage(ownership.tabId, jobId, request.noteType);
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
  const noteType = payload?.noteType || ownership.noteType;
  if (noteType !== 'image' && noteType !== 'video') {
    return { ok: false, jobId, discarded: false, code: 'INVALID_REQUEST', message: '缺少用于恢复发布页的笔记类型' };
  }
  const current = await inspectTab(ownership.tabId).catch(() => null);
  if (!current || !publishModeMatches(current.probe?.uploadLandingEvidence, noteType)) {
    return { ok: false, jobId, discarded: false, code: 'PUBLISH_MODE_CHANGED', message: '无法核验旧任务页面类型，不会清理' };
  }
  const editor = await execute(ownership.tabId, readPreparedEditorSnapshot);
  const verification = validateDraftRecovery({ ...editor, hasDraft: current.probe?.hasDraft, pageReady: publishModeReady(current, noteType) }, ownership, payload);
  if (!verification.ok) return { ...verification, jobId, discarded: false };
  await chrome.tabs.update(ownership.tabId, {
    url: buildPublishModeUrl(noteType, current?.probe?.href || PUBLISH_URL),
  });
  const ready = await waitFor(ownership.tabId, (state) => publishModeReady(state, noteType), 15_000);
  if (!ready) return { ok: false, jobId, discarded: false, code: 'PUBLISH_PAGE_RESET_FAILED', message: '当前任务已过期，但发布页未能恢复为空白状态' };
  await clearPreparedOwnership(jobId);
  return { ok: true, jobId, discarded: true };
}

async function publish(payload) {
  if (payload?.phase === 'prepare') return preparePublish(payload.request);
  if (payload?.phase === 'submit') return submitPrepared(payload);
  if (payload?.phase === 'discard') return discardPrepared(payload);
  if (payload?.phase === 'recover') return recoverOwnedDraft(payload);
  if (payload?.phase === 'amend') return amendOwnedDraft(payload);
  return result(String(payload?.jobId || ''), false, 'not_submitted', 'not_started', 'INVALID_REQUEST', '缺少明确的发布执行阶段');
}

async function amendOwnedDraft(payload) {
  const request = payload?.request;
  const validation = validatePublishRequest(request);
  const jobId = String(request?.jobId || '');
  if (!validation.ok) return result(jobId, false, 'not_submitted', 'not_started', validation.code, validation.message);
  const receipt = await cachedResult(payload.previous?.jobId);
  const latestReceipt = await cachedResult(jobId);
  if (latestReceipt && latestReceipt.publishStatus !== 'not_submitted') return latestReceipt;
  if (receipt?.publishStatus === 'published') return result(jobId, false, 'published', 'not_started', 'ALREADY_PUBLISHED', '旧任务已有平台发布成功回执，不会重发');
  if (receipt && receipt.publishStatus !== 'not_submitted' && payload.acknowledgedNotPublished !== true) {
    return result(jobId, false, 'not_submitted', 'not_started', 'SUBMISSION_REVIEW_REQUIRED', '旧任务有未核实提交回执，请先在笔记管理核实未发布');
  }
  const ownership = await preparedOwnership();
  if (ownership?.status === 'submitting' && payload.acknowledgedNotPublished !== true) {
    return result(jobId, false, 'not_submitted', 'not_started', 'SUBMISSION_REVIEW_REQUIRED', '旧任务处于已尝试提交状态，请先核实未发布');
  }
  const tabs = await publishTabs();
  if (tabs.length !== 1 || !tabs[0]?.id || (ownership && tabs[0].id !== ownership.tabId)) {
    return result(jobId, false, 'not_submitted', 'not_started', 'PUBLISH_TAB_CHANGED', '当前发布页不是唯一旧任务标签页，未覆盖');
  }
  const tabId = tabs[0].id;
  const current = await inspectTab(tabId);
  if (current.pageState === 'success') return result(jobId, false, 'published', 'not_started', 'ALREADY_PUBLISHED', '当前页面显示发布成功，不会重发');
  if (!publishModeMatches(current.probe?.uploadLandingEvidence, request.noteType)) {
    return result(jobId, false, 'not_submitted', 'not_started', 'PUBLISH_MODE_CHANGED', '发布页类型已变化，未覆盖');
  }
  if (!current.probe?.hasDraft && publishModeReady(current, request.noteType)) {
    if (ownership && (ownership.jobId !== payload.previous?.jobId || ownership.contentDigest !== payload.previous?.contentDigest)) {
      return result(jobId, false, 'not_submitted', 'not_started', 'PREPARED_JOB_NOT_FOUND', '空白页仍关联另一任务，未修改');
    }
    await clearPreparedOwnership(payload.previous?.jobId);
    return { ...result(jobId, true, 'not_submitted', 'not_started'), empty: true };
  }
  if (inFlightJobs.size) return result(jobId, false, 'not_submitted', 'not_started', 'JOB_ALREADY_RUNNING', '发布操作正在执行，未修改页面');
  const snapshot = await execute(tabId, readPreparedEditorSnapshot);
  // Same completed amendment is idempotent; it never clicks submit or uploads.
  if (ownership?.jobId === jobId && ownership.contentDigest === request.contentDigest && ownership.status === 'prepared') {
    const verified = verifyPreparedEditorSnapshot(snapshot, editorVerificationPayload(request));
    if (verified.ok && preparedMediaMatches(snapshot, ownership)) return preparedResult(jobId);
    return result(jobId, false, 'not_submitted', 'not_started', 'PREPARED_EDITOR_CHANGED', '更新后的页面再次变化，未自动覆盖');
  }
  const check = validateDraftAmendment(snapshot, ownership, payload);
  if (!check.ok) return result(jobId, false, 'not_submitted', 'not_started', check.code, check.message);
  const flightKey = `${jobId}:amend`;
  inFlightJobs.add(flightKey);
  try {
    const filled = await execute(tabId, fillEditor, [{
      ...(check.titleChanged ? { title: request.title } : {}),
      ...(check.bodyChanged ? { body: buildBody(request.body, request.hashtags) } : {}),
    }]);
    if (!filled?.ok) return result(jobId, false, 'not_submitted', 'not_started', filled?.code || 'EDITOR_FIELDS_NOT_FOUND', filled?.message);
    const after = await execute(tabId, readPreparedEditorSnapshot);
    const verified = verifyPreparedEditorSnapshot(after, editorVerificationPayload(request));
    const fieldError = editorValidationFailure(after);
    if (!verified.ok || fieldError || !preparedMediaMatches(after, snapshot)) {
      return result(jobId, false, 'not_submitted', 'not_started', fieldError?.code || 'EDITOR_VERIFICATION_FAILED', fieldError?.message || '修改后的文案或媒体回读不一致，未提交');
    }
    await savePreparedOwnership({ ...ownership, jobId, contentDigest: request.contentDigest, noteType: request.noteType,
      sessionId: request.sessionId, projectPath: request.projectPath, media: request.media,
      status: 'prepared', submittedAt: undefined, preparedAt: Date.now(), mediaSources: after.mediaSources, mediaFileNames: after.mediaFileNames });
    return preparedResult(jobId);
  } finally {
    inFlightJobs.delete(flightKey);
  }
}

async function recoverOwnedDraft(payload) {
  const jobId = String(payload?.jobId || '');
  const ownership = await preparedOwnership();
  const tabs = await publishTabs();
  if (tabs.length !== 1 || !tabs[0]?.id || (ownership && tabs[0].id !== ownership.tabId)) {
    return { ok: false, jobId, discarded: false, code: 'PUBLISH_TAB_CHANGED', message: '无法核验唯一旧任务发布页，未清理页面' };
  }
  const tabId = tabs[0].id;
  const current = await inspectTab(tabId);
  if (!publishModeMatches(current.probe?.uploadLandingEvidence, payload.noteType)) {
    return { ok: false, jobId, discarded: false, code: 'PUBLISH_MODE_CHANGED', message: '旧任务页面类型已变化，不会清理' };
  }
  const editor = await execute(tabId, readPreparedEditorSnapshot);
  const verification = validateDraftRecovery({ ...editor, hasDraft: current.probe?.hasDraft, pageReady: publishModeReady(current, payload.noteType) }, ownership, payload);
  if (!verification.ok) return { ...verification, jobId, discarded: false };
  if (!current.probe?.hasDraft && publishModeReady(current, payload.noteType)) {
    await clearPreparedOwnership(jobId);
    return { ok: true, jobId, discarded: true };
  }
  return discardPrepared(payload);
}

async function restore(payload) {
  const jobId = String(payload?.jobId || '');
  const noteType = payload?.noteType;
  if (noteType !== 'image' && noteType !== 'video') {
    return result(jobId, false, 'published', 'failed', 'INVALID_REQUEST', '恢复请求缺少有效的笔记类型');
  }
  const tabs = await publishTabs();
  if (tabs.length !== 1 || !tabs[0]?.id) return result(jobId, false, 'published', 'failed', 'PUBLISH_TAB_NOT_FOUND', '无法定位唯一发布页');
  const restored = await restorePublishPage(tabs[0].id, jobId, noteType);
  if (restored.resetStatus === 'ready') await clearPreparedOwnership(jobId);
  return restored;
}

async function handleDesktopRequest(message) {
  const id = message.id;
  try {
    let value;
    if (message.method === 'publisher.status') value = message.params?.platform === 'douyin'
      ? await douyinStatus(nativeConnected) : await currentStatus();
    else if (message.method === 'publisher.publish') value = message.params?.platform === 'douyin'
      ? await douyinPublish(message.params || {}) : await publish(message.params || {});
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
  void connectNative().then(() => message.platform === 'douyin'
    ? douyinStatus(nativeConnected)
    : currentStatus()).then(sendResponse).catch((error) => sendResponse({ nativeConnected, detail: messageError(error).message }));
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
