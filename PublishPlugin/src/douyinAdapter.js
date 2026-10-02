export const DOUYIN_UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload';
export const DOUYIN_HOME_URL = 'https://creator.douyin.com/creator-micro/home';
export const DOUYIN_TAB_PATTERN = 'https://creator.douyin.com/*';

export function isDouyinEditorUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://creator.douyin.com'
      && url.pathname === '/creator-micro/content/post/video';
  } catch { return false; }
}

export function isDouyinUploadUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://creator.douyin.com'
      && url.pathname === '/creator-micro/content/upload';
  } catch { return false; }
}

export function isDouyinPublishUrl(value) {
  return isDouyinUploadUrl(value) || isDouyinEditorUrl(value);
}

export function canonicalDouyinText(value) {
  return String(value || '').replace(/[\s\u200B-\u200D\uFEFF]/gu, '');
}

// The upload page currently shows only an avatar. Read the account number from
// the creator home page in the same browser window instead of guessing from it.
export function probeDouyinHomeAccount() {
  if (location.origin !== 'https://creator.douyin.com' || location.pathname !== '/creator-micro/home') return null;
  const matches = [...String(document.body?.innerText || '').matchAll(/抖音号\s*[:：]\s*([0-9A-Za-z_-]+)/g)]
    .map((match) => match[1]);
  const ids = [...new Set(matches)];
  if (ids.length !== 1) return null;
  return { accountId: ids[0], accountLabel: `抖音号 ${ids[0]}` };
}

export function validateDouyinRequest(value) {
  const request = value && typeof value === 'object' ? value : {};
  if (request.platform !== 'douyin' || request.protocolVersion !== 1
    || !String(request.jobId || '').startsWith('douyin_publish_')
    || !/^[a-f0-9]{64}$/i.test(String(request.contentDigest || ''))
    || !request.versionId || !request.projectId || !request.renderId
    || !request.mediaAssetId || !request.mediaPath
    || !request.accountId || !request.accountLabel
    || !String(request.title || '').trim()
    || !String(request.description || '').trim()
    || !Array.isArray(request.hashtags)) {
    return { ok: false, code: 'INVALID_DOUYIN_REQUEST', message: '抖音发布请求缺少版本、账号、媒体或文案' };
  }
  if (request.hashtags.some((tag) => typeof tag !== 'string' || !tag.trim())) {
    return { ok: false, code: 'INVALID_DOUYIN_REQUEST', message: '抖音话题格式不合法' };
  }
  if (request.coverAssetId != null && typeof request.coverAssetId !== 'string') {
    return { ok: false, code: 'INVALID_DOUYIN_REQUEST', message: '抖音封面素材标识不合法' };
  }
  if (String(request.coverAssetId || '').trim()) {
    const cover = request.imageCover;
    const hex = (value) => /^[a-f0-9]{64}$/i.test(String(value || ''));
    const files = cover?.files;
    if (cover?.assetId !== request.coverAssetId || !hex(cover.sourceSha256) || cover.crop !== 'center'
      || !Array.isArray(files) || files.length !== 2 || files.some((file) => !file || typeof file !== 'object' || Array.isArray(file))
      || new Set(files.map((file) => file.orientation)).size !== 2
      || files.some((file) => !['portrait', 'landscape'].includes(file.orientation)
        || !hex(file.sha256) || !/^(\/|[A-Za-z]:[\\/])/.test(String(file.path || ''))
        || (file.orientation === 'portrait' ? file.width !== 1080 || file.height !== 1440 : file.width !== 1440 || file.height !== 1080))) {
      return { ok: false, code: 'INVALID_DOUYIN_COVER', message: '自选封面缺少两张已确认的横、竖图片，未执行上传或提交' };
    }
  } else if (request.imageCover != null) {
    return { ok: false, code: 'INVALID_DOUYIN_COVER', message: '封面素材与图片快照不一致' };
  }
  return { ok: true };
}

export function douyinCoverSnapshotsMatch(actual, expected) {
    // executeScript and extension storage may reorder object keys. Compare the
    // exact signatures for each orientation, independent of serialization order.
    return Boolean(actual && expected) && ['portrait', 'landscape'].every((orientation) =>
        typeof expected[orientation] === 'string' && actual[orientation] === expected[orientation]);
}

export function douyinImageCoversMatch(actual, expected) {
    if (!actual || !expected) return actual === expected;
    return ['assetId', 'sourceSha256', 'crop'].every((field) => actual[field] === expected[field])
        && Array.isArray(actual.files) && Array.isArray(expected.files)
        && actual.files.length === 2 && expected.files.length === 2
        && expected.files.every((file, index) => file && actual.files[index]
            && ['orientation', 'path', 'sha256', 'width', 'height'].every((field) => actual.files[index][field] === file[field]));
}

export function douyinEditorMatches(probe, request, baseline) {
  if (!probe || !request || !baseline || !isDouyinEditorUrl(probe.href)) return false;
  if (probe.accountId !== request.accountId || probe.accountLabel !== request.accountLabel) return false;
  if (canonicalDouyinText(probe.description) !== canonicalDouyinText(baseline.description)
    || probe.title !== baseline.title || probe.mediaSignature !== baseline.mediaSignature) return false;
  if (!probe.mediaSignature || probe.uploadBusy || probe.validationErrors?.length) return false;
  if (probe.coverEditing) return false;
  if (baseline.coverSnapshot && !douyinCoverSnapshotsMatch(probe.coverSnapshot, baseline.coverSnapshot)) return false;
  if (request.imageCover && (!baseline.coverSnapshot?.portrait || !baseline.coverSnapshot?.landscape)) return false;
  return true;
}

// Injected into creator.douyin.com; keep this function self-contained.
export function probeDouyinPage() {
  const visible = (node) => {
    if (!node || !(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const text = String(document.body?.innerText || '');
  const links = Array.from(document.querySelectorAll('a[href]')).filter(visible);
  const profileLinks = links.filter((node) => /\/user\/|\/profile\//.test(node.getAttribute('href') || ''));
  const accountNode = profileLinks.length === 1 ? profileLinks[0] : null;
  const accountUrl = accountNode ? new URL(accountNode.getAttribute('href'), location.origin) : null;
  const profileSegments = accountUrl?.pathname.split('/').filter(Boolean) || [];
  const profileId = profileSegments.length >= 2 && ['user', 'profile'].includes(profileSegments.at(-2))
    ? profileSegments.at(-1) : '';
  const accountId = accountUrl ? (accountUrl.searchParams.get('sec_uid') || profileId || '') : '';
  const accountLabel = accountNode ? String(accountNode.textContent || accountNode.getAttribute('aria-label') || '').trim() : '';
  const outsideDialog = (node) => !node.closest?.('[role="dialog"][aria-modal="true"]');
  const editors = Array.from(document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')).filter(visible).filter(outsideDialog);
  const descriptionEditor = editors.find((node) => /描述|标题|作品|说点什么/.test([
    node.getAttribute('placeholder'), node.getAttribute('data-placeholder'), node.getAttribute('aria-label'),
    node.parentElement?.textContent?.slice(0, 50),
  ].join(' '))) || (editors.length === 1 ? editors[0] : null);
  const description = descriptionEditor ? String(descriptionEditor.value ?? descriptionEditor.textContent ?? '').trim() : '';
  const titleEditors = Array.from(document.querySelectorAll('input[type="text"],input:not([type])'))
    .filter(visible).filter(outsideDialog).filter((node) => /作品标题/.test([
      node.getAttribute('placeholder'), node.getAttribute('aria-label'),
    ].join(' ')));
  const title = titleEditors.length === 1 ? String(titleEditors[0].value || '').trim() : '';
  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
  const videoInputCount = fileInputs.filter((node) => /video|mp4|webm|mov/i.test(node.accept || '')).length;
  // Cover/title mode may hide or unmount the video. A missing source is not a
  // media identity; the owned preparation flow must reveal the video first.
  const videoNodes = Array.from(document.querySelectorAll('video')).filter(outsideDialog);
  const fileNames = [...new Set(Array.from(document.querySelectorAll('span,p,div'))
    .filter(visible).map((node) => String(node.textContent || '').trim())
    .filter((value) => value.length <= 180 && /(?:^|[\\/\s])[^\\/\s]+\.(?:mp4|mov|webm)$/i.test(value)))];
  const mediaSignature = videoNodes.length === 1
    ? String(videoNodes[0].currentSrc || videoNodes[0].src || videoNodes[0].poster || '').trim()
    : fileNames.length === 1 ? `filename:${fileNames[0]}` : '';
  const buttons = Array.from(document.querySelectorAll('button,[role="button"]')).filter(visible);
  const publishButtons = buttons.filter((node) => /^(发布|发布作品)$/.test(String(node.textContent || '').trim()));
  const validationErrors = Array.from(document.querySelectorAll('[aria-invalid="true"],input,textarea'))
    .filter(visible).flatMap((node) => node.validity?.valid === false && node.validationMessage ? [node.validationMessage] : []);
  const statusText = Array.from(document.querySelectorAll('[role="alert"],[class*="toast"],[aria-live="assertive"]'))
    .filter(visible).map((node) => String(node.textContent || '').trim()).filter(Boolean).slice(0, 20);
  const pathname = location.pathname;
  const uploadPage = location.origin === 'https://creator.douyin.com' && pathname === '/creator-micro/content/upload';
  const editorPage = location.origin === 'https://creator.douyin.com' && pathname === '/creator-micro/content/post/video';
  // The upload landing can retain an unpublished video without rendering a
  // media preview or description. Do not overwrite a draft with unknown owner.
  const restorableDraft = uploadPage && /你还有上次未发布的视频，是否继续编辑[？?]/.test(text);
  const loginRequired = /\/login/.test(pathname) || (/登录|扫码登录/.test(text) && !videoInputCount && !descriptionEditor);
  const securityChallenge = /安全验证|滑块验证|身份验证/.test(text);
  // The editor permanently displays “如作品还在上传中，请勿关闭页面”; it is guidance,
  // not evidence that this video is still uploading.
  const uploadBusy = /正在上传|视频上传中|转码中|处理中/.test(text);
  const feedbackText = statusText.join('\n');
  const successText = /发布成功|作品发布成功/.test(feedbackText);
  const pendingReviewText = /审核中|等待审核|已提交审核|审核通过后/.test(feedbackText);
  // An "已发布" sidebar or filter is not a receipt for this video.
  const publishedText = /作品已发布|发布完成/.test(feedbackText);
  return {
    href: location.href, uploadPage, editorPage, loginRequired, securityChallenge,
    accountId, accountLabel, title, titleEditorCount: titleEditors.length,
    description, descriptionEditorCount: descriptionEditor ? 1 : 0,
    videoInputCount, mediaSignature, videoCount: videoNodes.length,
    hasDraft: Boolean(description || mediaSignature || restorableDraft), restorableDraft, uploadBusy,
    publishButtonCount: publishButtons.length,
    publishButtonEnabled: publishButtons.length === 1 && !publishButtons[0].disabled,
    validationErrors, statusText, successText, pendingReviewText, publishedText,
  };
}

// Injected into the owned editor only; keep this function self-contained.
export function showDouyinVideoPreview() {
  if (location.origin !== 'https://creator.douyin.com' || location.pathname !== '/creator-micro/content/post/video') {
    return { ok: false, code: 'VIDEO_PREVIEW_PAGE_MISMATCH' };
  }
  const visible = (node) => {
    if (!node || !(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  if (Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(visible)) {
    return { ok: false, code: 'COVER_EDITOR_STILL_OPEN' };
  }
  // Actual creator editor tabs, observed in the page's previewTab container.
  // Never search arbitrary page text or click publication controls.
  const tabs = Array.from(document.querySelectorAll('[class*="previewTab-"] [class*="tabItem-"]'))
    .filter(visible).filter((node) => String(node.textContent || '').replace(/\s/gu, '') === '预览视频');
  if (tabs.length !== 1) return { ok: false, code: 'VIDEO_PREVIEW_NOT_UNIQUE' };
  tabs[0].click();
  return { ok: true };
}

// Injected into creator.douyin.com; keep this function self-contained.
export function fillDouyinDescription(value) {
  const visible = (node) => {
    if (!node || !(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const editors = Array.from(document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')).filter(visible);
  const matches = editors.filter((node) => /描述|标题|作品|说点什么/.test([
    node.getAttribute('placeholder'), node.getAttribute('data-placeholder'), node.getAttribute('aria-label'),
    node.parentElement?.textContent?.slice(0, 50),
  ].join(' ')));
  const editor = matches.length === 1 ? matches[0] : editors.length === 1 ? editors[0] : null;
  if (!editor) return { ok: false, code: 'DESCRIPTION_EDITOR_AMBIGUOUS' };
  editor.focus();
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    const descriptor = Object.getOwnPropertyDescriptor(editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(editor, value);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand('insertText', false, value);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  }
  return { ok: String(editor.value ?? editor.textContent ?? '').trim() === String(value).trim()
    || String(editor.value ?? editor.textContent ?? '').replace(/[\s\u200B-\u200D\uFEFF]/gu, '')
      === String(value).replace(/[\s\u200B-\u200D\uFEFF]/gu, '') };
}

// Injected into creator.douyin.com; keep this function self-contained.
export function fillDouyinTitle(value) {
  const editors = Array.from(document.querySelectorAll('input[type="text"],input:not([type])'))
    .filter((node) => node instanceof HTMLInputElement && node.getBoundingClientRect().width > 0
      && node.getBoundingClientRect().height > 0 && /作品标题/.test([
        node.getAttribute('placeholder'), node.getAttribute('aria-label'),
      ].join(' ')));
  if (editors.length !== 1) return { ok: false, code: 'TITLE_EDITOR_AMBIGUOUS' };
  const editor = editors[0];
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(editor, value);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: String(editor.value || '').trim() === String(value).trim() };
}
