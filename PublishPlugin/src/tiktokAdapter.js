export const TIKTOK_TAB_PATTERN = 'https://www.tiktok.com/*';
export const TIKTOK_UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=video';

export function isTikTokUploadUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://www.tiktok.com' && url.pathname === '/tiktokstudio/upload'
      && (!url.searchParams.has('tab') || url.searchParams.get('tab') === 'video');
  } catch { return false; }
}

export function tikTokCaption(request) {
  return [request.description.trim(), request.hashtags.map(tag => '#' + tag).join(' ')].filter(Boolean).join('\n');
}

export function canonicalTikTokText(value) {
  return String(value || '').replace(/[\u200B-\u200D\uFEFF\r]/gu, '').trim();
}

export function validateTikTokRequest(request) {
  const hex = value => /^[a-f0-9]{64}$/i.test(String(value || ''));
  const settings = request?.publishSettings;
  if (!request || request.platform !== 'tiktok' || request.protocolVersion !== 1
    || !/^tiktok_publish_[a-zA-Z0-9_-]+$/.test(request.jobId || '')
    || !hex(request.contentDigest) || !hex(request.mediaSha256)
    || !Number.isSafeInteger(request.revision) || request.revision < 1
    || !Number.isSafeInteger(request.mediaSize) || request.mediaSize < 1 || request.mediaSize >= 10_000_000_000
    || (request.mediaDurationMs !== undefined && (!Number.isFinite(request.mediaDurationMs) || request.mediaDurationMs <= 0))
    || !/^(\/|[A-Za-z]:[\\/]).+\.mp4$/i.test(request.mediaPath || '')
    || !request.versionId || !request.projectId || !request.renderId || !request.mediaAssetId || !request.sessionId
    || !/^[A-Za-z0-9_.]{1,100}$/.test(request.accountId || '') || request.accountLabel !== '@' + request.accountId
    || typeof request.title !== 'string' || !request.title.trim() || request.title.length > 200
    || typeof request.description !== 'string' || !request.description.trim()
    || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(request.language || '') || typeof request.market !== 'string' || !request.market.trim()
    || !Array.isArray(request.hashtags) || request.hashtags.length > 30
    || request.hashtags.some(tag => typeof tag !== 'string' || !/^[\p{L}\p{N}_]{1,100}$/u.test(tag))
    || !settings || !['everyone', 'friends', 'only_me'].includes(settings.visibility)
    || !['none', 'own_brand', 'paid_partnership'].includes(settings.commercialContent)
    || ['allowComments', 'allowReuse', 'allowRemix', 'audience18Plus', 'aiGenerated'].some(key => typeof settings[key] !== 'boolean')
    || (settings.commercialContent === 'paid_partnership' && settings.visibility === 'only_me')) {
    return { ok: false, code: 'INVALID_TIKTOK_REQUEST', message: 'TikTok 请求缺少已确认的账号、成片、文案或发布设置' };
  }
  if (tikTokCaption(request).length > 4000) return { ok: false, code: 'TIKTOK_CAPTION_TOO_LONG', message: 'TikTok 文案与话题合计最多 4000 字符' };
  return { ok: true };
}

export function tikTokEditorMatches(state, request, baseline) {
  return tikTokEditorIssues(state, request, baseline).length === 0;
}

export function tikTokEditorIssues(state, request, baseline) {
  if (!state || !baseline) return ['page'];
  const checks = {
    page: isTikTokUploadUrl(state.href),
    account: state.accountId === request.accountId && state.accountLabel === request.accountLabel,
    media: state.uploaded && state.mediaSignature && state.mediaSignature === baseline.mediaSignature
      && state.mediaFilename === request.mediaPath.split(/[\\/]/).at(-1),
    caption: canonicalTikTokText(state.caption) === canonicalTikTokText(tikTokCaption(request)),
    postNow: state.postNow,
    location: !state.locationSelected,
    login: !state.loginRequired,
    security: !state.securityChallenge,
    resumeDraft: !state.resumeDraft,
    dialog: !state.blockingDialog,
    validation: !state.validationErrors?.length,
  };
  for (const key of Object.keys(request.publishSettings)) checks[key] = state.settings?.[key] === request.publishSettings[key];
  return Object.keys(checks).filter(key => !checks[key]);
}

// A user may explicitly review a cover-only edit on our already uploaded draft.
// Keep filename/upload status and every other editor guard fixed; the next submit
// is pinned to the newly reviewed cover URL again, never to a wildcard signature.
export function tikTokCoverReviewIssues(state, request, baseline) {
  let before; let after;
  try { before = JSON.parse(baseline?.mediaSignature); after = JSON.parse(state?.mediaSignature); } catch { return ['media']; }
  const valid = signature => Array.isArray(signature) && signature.length === 3
    && signature.every(value => typeof value === 'string' && value.length > 0)
    && signature[2].startsWith('blob:https://www.tiktok.com/');
  if (!valid(before) || !valid(after) || before[0] !== after[0] || before[1] !== after[1]) return ['media'];
  const issues = tikTokEditorIssues(state, request, { mediaSignature: state.mediaSignature });
  if (!state.publishButtonEnabled || state.publishButtonCount !== 1) issues.push('publishButton');
  return issues;
}

// Each exported page function is serialized by Chrome executeScript. No module closures.
export async function readTikTokAccount() {
  if (location.origin !== 'https://www.tiktok.com' || !['/tiktokstudio/upload', '/tiktokstudio/content'].includes(location.pathname)) return null;
  const avatar = document.querySelector('button[data-tt="Header_NewHeader_Clickable"][aria-haspopup="dialog"]');
  if (!avatar) return null;
  const opened = avatar.getAttribute('aria-expanded') !== 'true';
  const visibleLinks = () => [...document.querySelectorAll('[role="dialog"] a[href]')].filter(el => {
    const rect = el.getBoundingClientRect(); const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  });
  const identity = () => {
    const handles = visibleLinks().map(el => {
      try { const url = new URL(el.href, location.origin); return url.origin === 'https://www.tiktok.com' && /^\/@[A-Za-z0-9_.]+\/?$/.test(url.pathname) ? url.pathname.replace(/^\/@|\/$/g, '') : ''; }
      catch { return ''; }
    }).filter(Boolean);
    return handles.length === 1 ? { accountId: handles[0], accountLabel: '@' + handles[0] } : null;
  };
  let account = null;
  let restored = !opened;
  try {
    if (opened) avatar.click();
    for (let attempt = 0; attempt < 12; attempt++) {
      account = identity();
      if (account) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally {
    if (opened) {
      if (avatar.getAttribute('aria-expanded') === 'true' || visibleLinks().length > 0) avatar.click();
      // The menu stays visible during its closing animation. Finish restoring
      // our own menu before the next upload/page guard observes it.
      for (let attempt = 0; attempt < 12; attempt++) {
        restored = avatar.getAttribute('aria-expanded') !== 'true' && visibleLinks().length === 0;
        if (restored) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
  return restored ? account : null;
}

// Standalone Chrome injection. These attributes come from the accepted Studio
// Posts DOM; do not turn a generic success toast or a caption match into a Post receipt.
export function readTikTokPosts() {
  if (location.origin !== 'https://www.tiktok.com' || location.pathname !== '/tiktokstudio/content') return null;
  const visible = node => {
    if (!node) return false;
    const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  if (!document.querySelector('button[data-tt="Header_NewHeader_Clickable"]')
      || document.querySelector('iframe[src*="captcha"],[id*="captcha-verify"],[class*="captcha-verify"]')
      || [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some(visible)) return null;
  const posts = [];
  for (const link of [...document.querySelectorAll('a[data-tt="components_PostInfoCell_a"]')].filter(visible).slice(0, 100)) {
    const row = link.closest('[data-tt="components_RowLayout_FlexRow"]');
    const links = row?.querySelectorAll('a[data-tt="components_PostInfoCell_a"]');
    const stages = row?.querySelectorAll('[data-tt="components_PublishStageLabel_TUXText"]');
    const privacy = row?.querySelectorAll('button[data-tt="components_PrivacyCell_TUXButton"]');
    const duration = row?.querySelectorAll('[data-tt="VideoCover_index_TUXText"]');
    if (links?.length !== 1 || stages?.length !== 1 || privacy?.length !== 1 || duration?.length !== 1
        || !visible(stages[0]) || !visible(privacy[0]) || !visible(duration[0])) continue;
    let url;
    try { url = new URL(link.getAttribute('href'), location.origin); } catch { continue; }
    const path = url.pathname.match(/^\/@([A-Za-z0-9_.]{1,100})\/video\/(\d{10,30})$/);
    if (url.origin !== location.origin || url.search || url.hash || !path) continue;
    posts.push({ videoId: path[2], url: url.href, accountId: path[1], caption: link.textContent || '',
      visibility: { 'Only me': 'only_me', Everyone: 'everyone', Friends: 'friends' }[privacy[0].textContent.trim()],
      durationText: duration[0].textContent.trim(), publishedLabel: stages[0].textContent.trim() });
  }
  return { href: location.href, posts };
}

export function matchTikTokPostReceipt(page, request, expectedUrl = '') {
  if (!page || page.href !== 'https://www.tiktok.com/tiktokstudio/content' || !Array.isArray(page.posts)) return null;
  // Posts renders the editor's line break as a space; keep the upload editor's
  // separate exact-newline check unchanged.
  const caption = value => canonicalTikTokText(value).replace(/\s+/gu, ' ');
  const matches = page.posts.filter(post => post.accountId === request.accountId
    && caption(post.caption) === caption(tikTokCaption(request))
    && post.visibility === request.publishSettings.visibility
    && /^\d{2,3}:[0-5]\d$/.test(post.durationText)
    && (request.mediaDurationMs === undefined || Number.isFinite(request.mediaDurationMs) && request.mediaDurationMs > 0
      && Math.abs(post.durationText.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0) * 1000 - request.mediaDurationMs) <= 1000)
    // Only the actual dated, published row is supported. Pending/rejected labels
    // remain unverified until their real DOM is available.
    && /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{1,2}:\d{2}\s?[AP]M$/.test(post.publishedLabel)
    && (!expectedUrl || post.url === expectedUrl));
  return matches.length === 1 ? matches[0] : null;
}

export function probeTikTokPage() {
  const visible = node => {
    if (!node || !(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const unique = selector => { const values = [...document.querySelectorAll(selector)].filter(visible); return values.length === 1 ? values[0] : null; };
  const status = unique('[data-e2e="upload_status_container"]');
  const uploaded = Boolean(status?.querySelector('.info-status.success'));
  const mediaFilename = status?.querySelector('.info-title > span')?.textContent?.trim() || '';
  const coverSource = document.querySelector('[data-e2e="cover_container"] img.cover-image')?.getAttribute('src') || '';
  const mediaSignature = uploaded && mediaFilename && coverSource ? JSON.stringify([mediaFilename, status.querySelector('.info-status')?.textContent?.trim(), coverSource]) : '';
  const caption = unique('[data-e2e="caption_container"] [contenteditable="true"]');
  const privacyText = unique('[data-e2e="video_visibility_container"] [role="combobox"]')?.innerText?.trim();
  const visibility = { Everyone: 'everyone', Friends: 'friends', 'Only you': 'only_me' }[privacyText];
  const controls = [...document.querySelectorAll('[data-e2e="user_perm_container"] label')].filter(visible);
  const checkbox = text => { const labels = controls.filter(label => label.textContent.trim() === text); return labels.length === 1 ? labels[0].querySelector('input[type="checkbox"]')?.checked : undefined; };
  const readSwitch = selector => {
    const container = unique(selector);
    const inputs = container?.querySelectorAll('input[role="switch"]') || [];
    return inputs.length === 1 ? inputs[0].checked : undefined;
  };
  const disclosure = readSwitch('[data-e2e="disclose_content_container"]');
  const brandLine = text => [...document.querySelectorAll('[class*="title-line"]')].filter(visible).filter(el => el.textContent.trim() === text);
  const own = brandLine('Your brand'); const paid = brandLine('Branded content');
  const ownChecked = own.length === 1 && own[0].querySelector('input[type="checkbox"]')?.checked;
  const paidChecked = paid.length === 1 && paid[0].querySelector('input[type="checkbox"]')?.checked;
  const commercialContent = disclosure === false ? 'none' : disclosure === true && ownChecked !== paidChecked ? ownChecked ? 'own_brand' : 'paid_partnership' : undefined;
  const audienceLabels = [...document.querySelectorAll('label[for]')].filter(visible).filter(el => el.textContent.trim() === 'Audience control');
  const audienceInput = audienceLabels.length === 1 ? document.getElementById(audienceLabels[0].getAttribute('for')) : null;
  const settings = { visibility, allowComments: checkbox('Comment'), allowReuse: checkbox('Reuse of content'),
    allowRemix: checkbox('Remix'), audience18Plus: audienceInput?.checked, commercialContent,
    aiGenerated: readSwitch('[data-e2e="aigc_container"]') };
  const dialogs = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(visible);
  const feedback = [...document.querySelectorAll('[role="alert"],[role="status"],[data-e2e="upload_status_container"] .error')].filter(visible).map(el => el.innerText.trim()).filter(Boolean);
  const page = location.origin === 'https://www.tiktok.com' && location.pathname === '/tiktokstudio/upload';
  const gateText = dialogs.map(el => el.innerText).join('\n');
  const securityChallenge = Boolean(document.querySelector('iframe[src*="captcha"],[id*="captcha-verify"],[class*="captcha-verify"]'))
    || /verify to continue|security verification|too many attempts|try again later/i.test(gateText);
  const loginRequired = /\/login/.test(location.pathname) || !document.querySelector('button[data-tt="Header_NewHeader_Clickable"]');
  const post = unique('button[data-e2e="post_video_button"]');
  const videoInputs = [...document.querySelectorAll('input[type="file"]')].filter(el => /video|mp4/.test(el.accept || ''));
  const locationInput = document.querySelector('[data-e2e="poi_container"] input');
  const resumeDraft = [...document.querySelectorAll('[data-e2e="local_draft_container"]')].some(visible);
  return { href: location.href, uploadPage: page && !status, editorPage: page && Boolean(status),
    loginRequired, securityChallenge, mediaFilename, mediaSignature, uploaded,
    caption: caption?.innerText || '', captionEditorCount: caption ? 1 : 0,
    captionBlockCount: caption?.querySelectorAll('[data-block="true"]').length || 0, settings,
    postNow: document.querySelector('[data-e2e="schedule_container"] input[value="post_now"]')?.checked === true,
    locationSelected: Boolean(locationInput?.value), blockingDialog: dialogs.length > 0,
    hasDraft: Boolean(status || caption || resumeDraft), resumeDraft, videoInputCount: videoInputs.length,
    publishButtonCount: [...document.querySelectorAll('button[data-e2e="post_video_button"]')].filter(visible).length,
    publishButtonEnabled: Boolean(post && !post.disabled && post.getAttribute('aria-disabled') !== 'true'),
    validationErrors: feedback };
}

export function tikTokCaptionPoint() {
  if (location.origin !== 'https://www.tiktok.com' || location.pathname !== '/tiktokstudio/upload') return null;
  const inputs = [...document.querySelectorAll('[data-e2e="caption_container"] [contenteditable="true"]')].filter(input => {
    const rect = input.getBoundingClientRect(); const style = getComputedStyle(input);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
      && input.getAttribute('aria-disabled') !== 'true';
  });
  if (inputs.length !== 1) return null;
  const input = inputs[0];
  input.scrollIntoView({ block: 'center' });
  const rect = input.getBoundingClientRect();
  const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
  const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
  const hit = document.elementFromPoint(x, y);
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0
    && x < innerWidth && y < innerHeight && hit && input.contains(hit) ? { x, y } : null;
}

export function tikTokSettingsPage(operation, value) {
  if (location.origin !== 'https://www.tiktok.com' || location.pathname !== '/tiktokstudio/upload') return { ok: false };
  const visible = el => {
    if (!el) return false;
    const rect = el.getBoundingClientRect(); const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const one = selector => { const values = [...document.querySelectorAll(selector)].filter(visible); return values.length === 1 ? values[0] : null; };
  if (operation === 'dismiss-onboarding') {
    for (const dialog of [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(visible)) {
      const text = dialog.innerText;
      const label = text.includes('Turn on automatic content checks?') ? 'Cancel' : text.includes('New editing features added') ? 'Got it' : '';
      const button = [...dialog.querySelectorAll('button')].find(el => el.innerText.trim() === label);
      if (!label || !button) return { ok: false, code: 'PAGE_DIALOG_REQUIRES_REVIEW' };
      button.click();
    }
    return { ok: true };
  }
  if (operation === 'reveal') {
    const more = one('[data-e2e="advanced_settings_container"]');
    if (!more) return { ok: false, code: 'SETTINGS_NOT_FOUND' };
    if (more.innerText.trim() === 'Show more') more.querySelector('.more-btn')?.click();
    return { ok: true };
  }
  if (operation === 'privacy-open') { const trigger = one('[data-e2e="video_visibility_container"] [role="combobox"]'); if (!trigger) return { ok: false }; trigger.click(); return { ok: true }; }
  if (operation === 'privacy-select') {
    const expected = { everyone: '"0"', friends: '"2"', only_me: '"1"' }[value];
    const options = [...document.querySelectorAll('[role="option"]')].filter(visible).filter(el => el.getAttribute('data-value') === expected);
    if (options.length !== 1 || options[0].getAttribute('aria-disabled') === 'true') return { ok: false, code: 'VISIBILITY_UNAVAILABLE' };
    options[0].click(); return { ok: true };
  }
  if (operation === 'post-now') {
    const input = document.querySelector('[data-e2e="schedule_container"] input[value="post_now"]');
    // Only you disables scheduling with Now already selected. An existing
    // correct value remains usable when retrying this same draft.
    if (!input || (!input.checked && input.disabled)) return { ok: false };
    if (!input.checked) input.click(); return { ok: true };
  }
  let input;
  if (operation === 'comment' || operation === 'reuse' || operation === 'remix') {
    const name = { comment: 'Comment', reuse: 'Reuse of content', remix: 'Remix' }[operation];
    const labels = [...document.querySelectorAll('[data-e2e="user_perm_container"] label')].filter(visible).filter(el => el.textContent.trim() === name);
    if (labels.length === 1) input = labels[0].querySelector('input[type="checkbox"]');
  } else if (operation === 'disclosure' || operation === 'ai') {
    input = document.querySelector('[data-e2e="' + (operation === 'disclosure' ? 'disclose_content_container' : 'aigc_container') + '"] input[role="switch"]');
  } else if (operation === 'audience') {
    const labels = [...document.querySelectorAll('label[for]')].filter(visible).filter(el => el.textContent.trim() === 'Audience control');
    if (labels.length === 1) input = document.getElementById(labels[0].getAttribute('for'));
  } else if (operation === 'own-brand' || operation === 'paid-brand') {
    const lines = [...document.querySelectorAll('[class*="title-line"]')].filter(visible).filter(el => el.textContent.trim() === (operation === 'own-brand' ? 'Your brand' : 'Branded content'));
    if (lines.length === 1) input = lines[0].querySelector('input[type="checkbox"]');
  }
  if (!input || typeof value !== 'boolean' || (input.disabled && input.checked !== value)) return { ok: false, code: 'SETTING_UNAVAILABLE' };
  if (input.checked !== value) {
    const switchControl = input.closest('.Switch__content');
    (switchControl || input.closest('label') || input).click();
  }
  return { ok: true };
}

export function tikTokSubmitPoint() {
  if (location.origin !== 'https://www.tiktok.com' || location.pathname !== '/tiktokstudio/upload') return null;
  const buttons = [...document.querySelectorAll('button[data-e2e="post_video_button"]')].filter(el => {
    const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0;
  });
  if (buttons.length !== 1 || buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true') return null;
  const button = buttons[0]; button.scrollIntoView({ block: 'center' });
  const rect = button.getBoundingClientRect(); const x = rect.x + rect.width / 2; const y = rect.y + rect.height / 2;
  if (!button.contains(document.elementFromPoint(x, y))) return null;
  return { x, y };
}
