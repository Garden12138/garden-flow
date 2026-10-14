export function publicationUploadReview(request, state, mediaCount = 1) {
  return { jobId: request.jobId, contentDigest: request.contentDigest, accountId: request.accountId,
    checkedAt: Date.now(), mediaCount,
    pageSettings: typeof state.settings?.visibilityLabel === 'string' ? state.settings : undefined,
    pageFingerprint: JSON.stringify({ accountId: state.accountId, accountLabel: state.accountLabel,
      mediaSignature: state.mediaSignature, mediaSources: state.mediaSources, mediaFileNames: state.mediaFileNames,
      title: state.titleValue ?? state.title, body: state.bodyValue ?? state.description ?? state.caption,
      settings: state.settings, cover: state.coverSnapshot }) };
}

/** Standalone Chrome injection for recovering only our own interrupted PNG prefix. */
export async function verifyXhsImagePrefix(expectedHashes) {
  if (location.origin !== 'https://creator.xiaohongshu.com' || !Array.isArray(expectedHashes)) return { ok: false };
  const images = Array.from(document.querySelectorAll('main .img-container')).filter(card => {
    const rect = card.getBoundingClientRect(); const style = getComputedStyle(card);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && card.querySelector('.img-idx');
  }).map(card => card.querySelector('.format-img > img.img.preview'));
  if (images.length > expectedHashes.length || images.some(image => !image)) return { ok: false };
  const sources = images.map(image => String(image.currentSrc || image.src || ''));
  try {
    for (let index = 0; index < sources.length; index++) {
      if (!sources[index].startsWith(`blob:${location.origin}/`) || !/^[a-f0-9]{64}$/.test(expectedHashes[index] || '')) return { ok: false };
      const response = await fetch(sources[index]);
      if (!response.ok) return { ok: false };
      const bytes = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== expectedHashes[index]) return { ok: false };
    }
    return { ok: true, mediaSources: sources };
  } catch { return { ok: false }; }
}
/** Read only the logged-in account container; never infer identity from the copy editor or arbitrary page prose. */
export async function readXhsPublisherAccount() {
  const scopes = Array.from(document.querySelectorAll('header,nav,aside,[data-account],[class*="user-info"],[class*="account-info"]'));
  const identities = scopes.flatMap(scope => Array.from(scope.querySelectorAll('a[href*="/user/profile/"]')).flatMap(link => {
    try { const url = new URL(link.href, location.href);
      if (!['www.xiaohongshu.com', 'creator.xiaohongshu.com'].includes(url.hostname)) return [];
      const id = url.pathname.match(/^\/user\/profile\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
      return id ? [id] : [];
    } catch { return []; }
  }));
  const explicit = scopes.flatMap(scope => Array.from(scope.querySelectorAll('[data-user-id]')).map(node => node.getAttribute('data-user-id')).filter(id => /^[a-zA-Z0-9_-]+$/.test(id || '')));
  const ids = [...new Set([...identities, ...explicit])];
  const labels = [...new Set(scopes.flatMap(scope => Array.from(scope.querySelectorAll('.name-box')).map(node => node.textContent.trim()).filter(Boolean)))];
  if (ids.length > 1 || labels.length > 1) return null;
  if (ids.length === 1) return { accountId: ids[0], accountLabel: labels[0] || '小红书账号 ' + ids[0] };
  // The current creator top bar exposes a nickname, without a profile link or user ID.
  // Read the same first-party endpoint used by the creator app, on every verification.
  // Never use cached localStorage identity: it can outlive a login/account change.
  if (location.origin !== 'https://creator.xiaohongshu.com' || typeof fetch !== 'function' || labels.length !== 1) return null;
  try {
    const response = await fetch('/api/galaxy/user/info', {
      credentials: 'include', cache: 'no-store', headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (result.success !== true || (result.code !== undefined && result.code !== 0)) return null;
    const user = result.data;
    if (!user || typeof user.userId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(user.userId)
      || typeof user.userName !== 'string' || user.userName.trim() !== labels[0]) return null;
    return { accountId: user.userId, accountLabel: user.userName.trim() };
  } catch { return null; }
}
