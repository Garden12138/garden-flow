// This function is injected into MAIN. Keep its helpers inside the function.
export async function extractSocialPost(platform, options = {}) {
  try {
    const clean = (value) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    const count = (value) => {
      const match = clean(value).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kmb万亿])?/i);
      return match ? Math.round(Number(match[1]) * ({ k: 1e3, m: 1e6, b: 1e9, 万: 1e4, 亿: 1e8 }[String(match[2] || '').toLowerCase()] || 1)) : 0;
    };
    const http = (value) => {
      if (typeof value !== 'string') return '';
      try { const url = new URL(value, location.href); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; }
    };
    const urls = (value) => {
      if (typeof value === 'string') return [http(value)].filter(Boolean);
      if (Array.isArray(value)) return value.flatMap(urls);
      if (!value || typeof value !== 'object') return [];
      return urls(value.urlList || value.url_list || value.UrlList || value.url || value.src || value.imageURL || value.display_image || []);
    };
    const identity = () => {
      const url = new URL(location.href);
      const path = url.pathname.match(platform === 'douyin' ? /\/(?:video|note|share\/video)\/(\d+)/ : /\/@[^/]+\/(?:video|photo)\/(\d+)/);
      return clean(url.searchParams.get('modal_id') || url.searchParams.get('aweme_id') || path?.[1]);
    };
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const first = (selectors, root = document) => {
      for (const selector of selectors) {
        const nodes = Array.from(root.querySelectorAll(selector));
        const node = nodes.find(visible);
        if (node) return node;
      }
      return null;
    };
    const read = (selectors, root = document) => clean(first(selectors, root)?.textContent);
    const fail = (code, message) => ({ platform, sourceUrl: location.href, accessErrorCode: code, message });
    const host = location.hostname.toLowerCase();
    if (!['douyin', 'tiktok'].includes(platform) || !(host === `${platform}.com` || host.endsWith(`.${platform}.com`) || platform === 'douyin' && (host === 'iesdouyin.com' || host.endsWith('.iesdouyin.com')))) {
      return fail('CONTENT_IDENTITY_MISMATCH', '作品链接与目标平台不一致');
    }
    const id = identity();
    if (options.expectedContent && (options.expectedContent.platform !== platform || options.expectedContent.externalId !== id)) {
      return fail('CONTENT_IDENTITY_MISMATCH', '页面作品已变化，请重新打开目标作品');
    }
    const challenge = first(['[id*="captcha"]', '[class*="captcha-verify"]', '[data-e2e="captcha"]']);
    if (challenge) return fail('BROWSER_SECURITY_CHALLENGE', '请在浏览器完成安全验证');
    const pageText = clean(document.body?.innerText || document.body?.textContent).slice(0, 3000);
    if (/too many requests|访问过于频繁|操作频繁|请求过于频繁/i.test(pageText)) return fail('BROWSER_RATE_LIMITED', '平台暂时限流，请稍后重试');
    if (!id) return fail('CONTENT_NOT_ACCESSIBLE', '请打开视频或图集作品详情');

    // A completed navigation can still contain only the SSR shell. Give the
    // current detail controls time to hydrate before reading media or comments.
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (first(['[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]', '[data-e2e="detail-video-info"]', '[data-e2e="note-detail"]', '[data-aweme-id]'])) break;
      if (identity() !== id) return fail('CONTENT_IDENTITY_MISMATCH', '页面作品已变化');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const identityNode = first([`[data-e2e-aweme-id="${id}"]`, `[data-aweme-id="${id}"]`, `[data-item-id="${id}"]`]);
    const modalRoot = platform === 'douyin' && new URL(location.href).searchParams.has('modal_id')
      ? Array.from(document.querySelectorAll(`[class~="video_${id}"]`)).find((node) => !node.closest('.search-result-card') && visible(node)) : null;
    let detail = modalRoot || identityNode?.closest('[role="dialog"], article, [data-e2e="detail-video"], [data-e2e="video-detail"], [data-e2e="note-detail"], [data-e2e="browse-video"]') || identityNode
      || first(['[data-e2e="browse-video"]', '#main-content-video_detail', '[data-e2e="note-detail"]', '[data-e2e="video-detail"]', '[data-e2e="detail-video"]', '[role="dialog"]']);
    const descriptionNode = first(platform === 'tiktok' ? ['[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]'] : ['[data-e2e="video-desc"]', '[data-e2e="detail-video-info"]'], modalRoot || document);
    if (detail && descriptionNode) {
      for (let ancestor = detail, depth = 0; ancestor && ancestor !== document.body && depth < 8; ancestor = ancestor.parentElement, depth += 1) {
        if (ancestor.contains(descriptionNode)) { detail = ancestor; break; }
      }
    }
    if (!detail && descriptionNode) detail = descriptionNode.closest('article') || descriptionNode.parentElement;
    if (platform === 'tiktok' && detail?.id === 'main-content-video_detail' && descriptionNode) {
      detail = descriptionNode.closest('article, [id^="one-column-item-"]') || detail;
    }
    const root = detail || document;
    const states = [];
    // SPA overlays often retain the original SSR script. Inspect only React props
    // attached to the active detail; the exact post ID is still mandatory below.
    const propsNodes = detail ? [detail, ...Array.from(detail.querySelectorAll('[data-e2e="browse-video"], [data-e2e="browse-video-desc"], video'))] : [];
    for (const node of propsNodes) {
      for (const key of Object.keys(node).filter((key) => key.startsWith('__reactProps$') || key.startsWith('__reactFiber$'))) {
        try {
          const value = node[key];
          if (key.startsWith('__reactProps$')) states.push(value);
          else for (let fiber = value, depth = 0; fiber && depth < 10; fiber = fiber.return, depth += 1) {
            if (fiber.memoizedProps) states.push(fiber.memoizedProps);
          }
        } catch { /* Optional platform implementation detail; DOM remains available. */ }
      }
    }
    for (const key of ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE', '__INITIAL_STATE__', '__NEXT_DATA__', '_ROUTER_DATA', '__SSR_DATA__']) {
      try { if (window[key]) states.push(window[key]); } catch { /* Site getters may be unavailable. */ }
    }
    for (const node of document.querySelectorAll('script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script#SIGI_STATE, script#RENDER_DATA, script#__NEXT_DATA__, script[type="application/json"]')) {
      const raw = node.textContent || '';
      if (raw.length > 8_000_000) continue;
      try { states.push(JSON.parse(raw)); } catch { try { states.push(JSON.parse(decodeURIComponent(raw))); } catch { /* Not a state script. */ } }
    }
    let item = null;
    let itemScore = -1;
    let mediaItem = null;
    const videoStates = [];
    let stateTimestamp = 0;
    const visited = new Set();
    const stack = states.map((value) => ({ value, depth: 0 })).reverse();
    while (stack.length && visited.size < 30000) {
      const { value, depth } = stack.pop();
      if (!value || typeof value !== 'object' || visited.has(value) || depth > 16) continue;
      visited.add(value);
      if (clean(value.aweme_id || value.awemeId || value.id || value.itemId) === id && (value.video || value.imagePost || value.images || value.image_post_info || value.desc || value.author || value.authorInfo)) {
        const candidateAuthor = value.author || value.authorInfo || {};
        const timestamp = Number(value.create_time || value.createTime || 0);
        if (!stateTimestamp && timestamp > 0 && timestamp < 1e12) stateTimestamp = timestamp;
        if (!mediaItem && (value.video || value.images || value.imagePost || value.image_post_info)) mediaItem = value;
        if (value.video && typeof value.video === 'object') videoStates.push(value.video);
        const score = (clean(candidateAuthor.nickname || candidateAuthor.uniqueId) ? 8 : 0) + (timestamp > 0 && timestamp < 1e12 ? 4 : 0) + (value.statistics || value.stats ? 2 : 0) + (value.desc ? 1 : 0);
        if (score > itemScore) { item = value; itemScore = score; }
      }
      for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
    }
    const noteTag = platform === 'douyin' && root.matches?.('[data-e2e="note-detail"]') ? root.querySelector('a[href*="/hashtag/"]') : null;
    const noteCaption = noteTag?.parentElement?.parentElement;
    let body = clean(item?.desc || item?.description) || read(['[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]', '[data-e2e="detail-video-info"] h1', 'h1'], root) || clean(noteCaption?.textContent);
    if (platform === 'tiktok' && /\/photo\//.test(location.pathname)) {
      const photoTitle = clean(item?.imagePost?.title || item?.title);
      if (photoTitle && !body.startsWith(photoTitle)) body = [photoTitle, body].filter(Boolean).join('\n');
      // TikTok sometimes renders only the hashtags while its own slide alt keeps
      // the full caption. Require the same caption suffix before using that text.
      const normalized = (value) => clean(value).replace(/\s+/g, ' ');
      const fullCaption = Array.from(root.querySelectorAll('img[alt]')).map((image) => clean(image.getAttribute('alt')).match(/[:：]\s*[“"]([\s\S]+)[”"]\s*$/)?.[1]).find((text) => text && body && normalized(text).endsWith(normalized(body)));
      if (fullCaption) body = clean(fullCaption);
    }
    if (!body && !item) {
      if (/log in to|login required|请先登录|登录后查看/i.test(pageText)) return fail('BROWSER_LOGIN_REQUIRED', '请先在浏览器登录');
      return fail('CONTENT_NOT_ACCESSIBLE', '当前作品不可访问或页面尚未加载');
    }
    const author = item?.author || item?.authorInfo || {};
    const authorLink = first(['[data-e2e="browse-username"]', '[data-e2e="video-author-uniqueid"]'], root)
      || Array.from(root.querySelectorAll('[data-e2e="user-info"] a[href*="/user/"]')).find((node) => visible(node) && clean(node.textContent))
      || Array.from(root.querySelectorAll('a[href*="/user/"], a[href^="/@"]')).find((node) => visible(node) && clean(node.textContent));
    const authorName = clean(author.nickname || author.uniqueId) || read(['[data-e2e="feed-video-nickname"]'], root).replace(/^@/, '') || clean(authorLink?.textContent);
    const profileLink = authorLink || first(['[data-e2e="video-avatar"][href*="/user/"]'], root);
    const video = item?.video || mediaItem?.video || {};
    const imagePost = item?.imagePost || item?.image_post_info || mediaItem?.imagePost || mediaItem?.image_post_info || {};
    const rawImages = Array.isArray(item?.images) ? item.images : Array.isArray(mediaItem?.images) ? mediaItem.images : Array.isArray(imagePost.images) ? imagePost.images : [];
    const imageUrls = rawImages.map((image) => urls(image)[0] || '').slice(0, 100);
    const pathIsImage = /\/(?:photo|note)\//.test(location.pathname);
    const contentType = imageUrls.length || pathIsImage || [68, 150].includes(Number(item?.aweme_type)) ? 'image_text' : 'video';
    if (contentType === 'image_text' && !imageUrls.length) {
      const douyinSlides = platform === 'douyin' ? Array.from(root.querySelectorAll('[data-e2e="player-container"] .dySwiperSlide')) : [];
      for (const slide of douyinSlides.slice(0, 100)) {
        const image = slide.querySelector('img');
        imageUrls.push(http(image?.currentSrc || image?.getAttribute('src') || image?.getAttribute('data-src')));
      }
      const galleryRoot = first(['[class*="swiper-wrapper"]', '[data-e2e="image-gallery"]', '[data-e2e="photo-image"]'], root);
      if (galleryRoot && !imageUrls.length) {
        const slides = Array.from(galleryRoot.querySelectorAll('.swiper-slide:not(.swiper-slide-duplicate)'));
        if (slides.length) {
          slides.sort((a, b) => Number(a.getAttribute('data-swiper-slide-index') || 0) - Number(b.getAttribute('data-swiper-slide-index') || 0));
          for (const slide of slides.slice(0, 100)) {
            const image = slide.querySelector('img');
            imageUrls.push(http(image?.currentSrc || image?.getAttribute('src') || image?.getAttribute('data-src')));
          }
        } else {
          const images = galleryRoot.matches('img') ? [galleryRoot] : Array.from(galleryRoot.querySelectorAll('img'));
          for (const image of images.slice(0, 100)) imageUrls.push(http(image.currentSrc || image.getAttribute('src') || image.getAttribute('data-src')));
        }
      }
    }
    const visibleVideos = Array.from(root.querySelectorAll('video')).filter(visible);
    const videoEl = visibleVideos.length === 1 ? visibleVideos[0] : null;
    const stateVideoUrl = urls(video.playAddr || video.play_addr || video.downloadAddr || video.download_addr || video.play_addr_h264)[0] || '';
    let playingVideoUrl = videoEl ? http(videoEl.currentSrc || videoEl.src || videoEl.getAttribute('src')) : '';
    if (platform === 'tiktok' && playingVideoUrl) {
      const playingId = new URL(playingVideoUrl).searchParams.get('item_id');
      if (playingId && playingId !== id) playingVideoUrl = '';
    }
    // TikTok can replace its state CDN URL with a working same-origin play URL.
    // Use only the sole video inside the current post, never a preloaded neighbor.
    let videoUrls = [stateVideoUrl || playingVideoUrl].filter(Boolean);
    if (platform === 'tiktok') {
      const variants = Array.from(new Set([video, ...videoStates]));
      const candidates = Array.from(new Set([
        playingVideoUrl,
        ...variants.flatMap((value) => urls(value.downloadAddr || value.download_addr)),
        ...variants.flatMap((value) => (Array.isArray(value.bitrateInfo || value.bit_rate) ? value.bitrateInfo || value.bit_rate : []).flatMap((rate) => urls(rate.PlayAddr || rate.playAddr || rate.play_addr))),
        ...variants.flatMap((value) => urls(value.playAddr || value.play_addr || value.play_addr_h264)),
      ].filter(Boolean))).filter((value) => {
        const itemId = new URL(value).searchParams.get('item_id');
        return !itemId || itemId === id;
      });
      const playbackEndpoint = (value) => {
        const url = new URL(value);
        return (url.hostname === 'tiktok.com' || url.hostname.endsWith('.tiktok.com')) && url.pathname === '/aweme/v1/play/' && url.searchParams.get('item_id') === id;
      };
      videoUrls = [playingVideoUrl, ...candidates.filter(playbackEndpoint), ...candidates].filter(Boolean);
      videoUrls = Array.from(new Set(videoUrls)).slice(0, 3);
    }
    const videoUrl = videoUrls[0] || '';
    const coverUrl = urls(video.cover || video.originCover || video.origin_cover || imagePost.cover)[0] || imageUrls.find(Boolean) || http(videoEl?.poster);
    const rawStats = item?.statistics || item?.stats || {};
    const stats = {};
    const statKeys = { likes: ['digg_count', 'diggCount'], collects: ['collect_count', 'collectCount'], comments: ['comment_count', 'commentCount'], shares: ['share_count', 'shareCount'], views: ['play_count', 'playCount'] };
    for (const [key, aliases] of Object.entries(statKeys)) {
      const value = aliases.map((alias) => rawStats[alias]).find((value) => value != null);
      const metric = { likes: 'digg', collects: 'collect', comments: 'comment', shares: 'share', views: 'view' }[key];
      const domValue = read([`[data-e2e="browse-${key === 'collects' ? 'favorite' : key === 'likes' ? 'like' : metric}-count"]`, `[data-e2e="${key === 'likes' ? 'like' : metric}-count"]`, `[data-e2e="video-${metric}"]`, `[data-e2e="${key === 'comments' ? 'feed-comment-icon' : `video-player-${metric}`}"]`], root);
      if (value != null || domValue) stats[key] = count(value ?? domValue);
    }
    const commentLimit = Math.max(0, Math.min(200, Math.trunc(Number(options.commentLimit ?? 5)) || 0));
    const readCommentState = (node, body, nickname) => {
      const inspect = (value) => {
        const stack = [{ value, depth: 0 }]; const seen = new Set();
        while (stack.length && seen.size < 500) {
          const { value, depth } = stack.pop();
          if (!value || typeof value !== 'object' || seen.has(value) || depth > 8) continue;
          seen.add(value);
          if (clean(value.cid || value.comment_id) && clean(value.text) === body && (!nickname || !value.user?.nickname || clean(value.user.nickname) === nickname)) return value;
          for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
        }
        return null;
      };
      for (const key of Object.keys(node).filter((key) => key.startsWith('__reactProps$') || key.startsWith('__reactFiber$'))) {
        if (key.startsWith('__reactProps$')) { const result = inspect(node[key]); if (result) return result; }
        else for (let fiber = node[key], depth = 0; fiber && depth < 3; fiber = fiber.return, depth += 1) { const result = inspect(fiber.memoizedProps); if (result) return result; }
      }
      return null;
    };
    const comments = new Map();
    const commentSelectors = '[data-e2e="comment-item"], [data-e2e="comment-level-1"], [data-e2e="comment-level-2"], [class*="CommentItemWrapper"], .comment-item';
    const commentListSelectors = ['[data-e2e="search-comment-container"]', '[data-e2e="comment-list"]', '[data-e2e="browse-comment-list"]', '[class*="CommentListContainer"]', '[class*="comment-list"]'];
    let commentRoot = first(commentListSelectors, root) || first(commentListSelectors);
    let commentsOpened = false;
    const openComments = async () => {
      const button = first(['[data-e2e="comment-icon"]', '[data-e2e="video-comment"]', '[data-e2e="feed-comment-icon"]', 'button[aria-label*="comment" i]', 'button[aria-label*="评论"]'], root);
      if (button) {
        (button.querySelector('button') || button.closest('button, [role="button"]') || button).click();
        commentsOpened = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    };
    if (commentLimit > 0 && !commentRoot && stats.comments !== 0) {
      await openComments();
      commentRoot = first(commentListSelectors, root) || first(commentListSelectors);
    }
    let exhausted = stats.comments === 0;
    let stalled = 0;
    const commentErrors = [];
    let captureBlocker;
    for (let round = 0; commentLimit > 0 && !exhausted && round < 80; round += 1) {
      if (identity() !== id) return fail('CONTENT_IDENTITY_MISMATCH', '评论采集期间作品已变化');
      if (first(['[id*="captcha"]', '[class*="captcha-verify"]'])) { captureBlocker = 'BROWSER_SECURITY_CHALLENGE'; commentErrors.push('评论采集遇到安全验证'); break; }
      const accessProbe = clean(document.body?.innerText || '').slice(0, 3000);
      if (/too many requests|访问过于频繁|操作频繁|请求过于频繁/i.test(accessProbe)) { captureBlocker = 'BROWSER_RATE_LIMITED'; commentErrors.push('评论采集遇到限流'); break; }
      const before = comments.size;
      // Hydration can replace the empty portal while the request is pending.
      commentRoot = first(commentListSelectors, root) || first(commentListSelectors);
      if (!commentRoot) {
        if (!commentsOpened) await openComments();
        commentRoot = first(commentListSelectors, root) || first(commentListSelectors);
        if (!commentRoot) { await new Promise((resolve) => setTimeout(resolve, 450)); continue; }
      }
      const nodes = Array.from((commentRoot || root).querySelectorAll(commentSelectors)).filter(visible);
      for (const node of nodes) {
        if (!node.matches('[data-e2e="comment-level-1"], [data-e2e="comment-level-2"]') && node.querySelector('[data-e2e="comment-level-1"], [data-e2e="comment-level-2"]')) continue;
        const commentNode = node.matches('[data-e2e="comment-level-1"], [data-e2e="comment-level-2"]') ? node.closest('[class*="CommentItemWrapper"], [class*="CommentItemContainer"], [data-comment-id]') || node.parentElement || node : node;
        const douyinInfo = platform === 'douyin' ? commentNode.querySelector('.comment-item-info-wrap') : null;
        const douyinText = douyinInfo?.nextElementSibling;
        const text = clean(douyinText?.textContent) || (node.matches('[data-e2e="comment-level-1"], [data-e2e="comment-level-2"]') ? clean(node.textContent) : '') || read(['[data-e2e="comment-level-1"] p', '[data-e2e="comment-level-2"] p', '[data-e2e="comment-content"]', '[data-e2e="comment-text"]', '[class*="comment-content"]', '[class*="CommentText"]', 'p'], node);
        if (!text) continue;
        const authorScope = douyinInfo || commentNode;
        const authorLinks = Array.from(authorScope.querySelectorAll('a[href^="/@"], a[href*="tiktok.com/@"], a[href*="/user/"]')).filter(visible);
        const link = authorLinks.find((node) => clean(node.textContent)) || authorLinks[0];
        const nickname = clean(link?.querySelector('[data-click-from="title"]')?.textContent || link?.textContent) || read(['[data-e2e="comment-username-1"]', '[data-e2e="comment-username-2"]', '[data-e2e="comment-username"]', '[class*="user-name"]', '[class*="username"]'], authorScope);
        let createdAt = clean(douyinText?.nextElementSibling?.textContent) || read(['time', '[data-e2e="comment-time-1"]', '[data-e2e="comment-time-2"]', '[data-e2e="comment-time"]', '[class*="comment-time"]', '[class*="time"]'], commentNode);
        const state = readCommentState(commentNode, text, nickname);
        const commentTimestamp = Number(state?.create_time || state?.createTime || 0);
        if (!createdAt && commentTimestamp > 0 && commentTimestamp < 1e12) createdAt = new Date(commentTimestamp * 1000).toISOString();
        const domCommentId = (element) => clean(element?.querySelector('[data-e2e="video-comment-more"] [id^="tooltip_"]')?.id).replace(/^tooltip_/, '');
        const commentId = clean(state?.cid || state?.comment_id || commentNode.getAttribute('data-comment-id') || commentNode.getAttribute('data-id') || commentNode.id) || domCommentId(commentNode) || `${clean(link?.getAttribute('href'))}|${createdAt}|${text}`;
        const parent = commentNode.parentElement?.closest('[data-comment-id], [data-e2e="comment-item"], [class*="CommentItemWrapper"], [class*="CommentItemContainer"]');
        const parentId = clean(state?.reply_to_reply_id && state.reply_to_reply_id !== '0' ? state.reply_to_reply_id : state?.reply_id && state.reply_id !== '0' ? state.reply_id : node.getAttribute('data-parent-comment-id') || parent?.getAttribute('data-comment-id') || parent?.getAttribute('data-id') || domCommentId(parent));
        comments.set(commentId, { id: commentId, author: nickname, authorProfileUrl: http(link?.getAttribute('href')), text, likes: state?.digg_count != null ? count(state.digg_count) : count(read(['[data-e2e="comment-like-count"]', '[class*="like-count"]', '.comment-item-stats-container p span'], commentNode)), replies: state?.reply_comment_total != null ? count(state.reply_comment_total) : undefined, createdAt, parentCommentId: parentId || undefined, rootCommentId: clean(state?.reply_id && state.reply_id !== '0' ? state.reply_id : parentId) || undefined, level: parentId || node.matches('[data-e2e="comment-level-2"]') ? 1 : 0 });
        if (comments.size >= commentLimit) break;
      }
      if (comments.size >= commentLimit || stats.comments != null && comments.size >= stats.comments) { exhausted = true; break; }
      if (!commentRoot) break;
      if (/no more comments|没有更多评论|暂无评论|no comments yet/i.test(clean(commentRoot.textContent))) { exhausted = true; break; }
      stalled = comments.size === before ? stalled + 1 : 0;
      if (stalled >= 2 && comments.size > 0) break;
      const replyButtons = Array.from(commentRoot.querySelectorAll('button, [role="button"]')).filter(visible)
        .filter((node) => /^(?:view|see).*repl|展开.*回复|查看更多回复/i.test(clean(node.textContent))).slice(0, 3);
      for (const button of replyButtons) button.click();
      let scroller = commentRoot;
      while (scroller.parentElement && scroller.scrollHeight <= scroller.clientHeight + 5 && scroller !== document.body) scroller = scroller.parentElement;
      if (scroller === document.body) {
        if (!comments.size) { await new Promise((resolve) => setTimeout(resolve, 450)); continue; }
        break;
      }
      scroller.scrollTop += Math.max(scroller.clientHeight * 0.8, 400);
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
    if (identity() !== id) return fail('CONTENT_IDENTITY_MISMATCH', '采集期间作品已变化');
    const captured = Array.from(comments.values()).slice(0, commentLimit);
    const commentsComplete = commentLimit === 0 || captured.length >= commentLimit || exhausted;
    if (!commentsComplete && !commentErrors.length) commentErrors.push('评论未达到采样数量，页面未确认加载完毕');
    const mediaErrors = contentType === 'video' ? videoUrl ? [] : ['未获取到可下载的视频地址'] : imageUrls.length && imageUrls.every(Boolean) ? [] : ['图集图片尚未全部加载'];
    const authorProfileUrl = platform === 'tiktok' && author.uniqueId ? `https://www.tiktok.com/@${encodeURIComponent(author.uniqueId)}`
      : platform === 'douyin' && author.sec_uid ? `https://www.douyin.com/user/${encodeURIComponent(author.sec_uid)}` : http(profileLink?.getAttribute('href'));
    const timestamp = Number(item?.create_time || item?.createTime || stateTimestamp);
    const publishedText = read(['[data-e2e="detail-video-publish-time"]'], root).replace(/^发布时间[：:]\s*/, '')
      || (platform === 'douyin' ? clean(root.innerText || root.textContent).match(/发布时间[：:]\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/)?.[1] || '' : '');
    const publishedAt = timestamp > 0 && timestamp < 1e12 ? new Date(timestamp * 1000).toISOString() : publishedText;
    const metadataErrors = [...(!authorName ? ['未获取到作品作者'] : []), ...(!publishedAt ? ['未获取到作品发布时间'] : [])];
    return {
      platform, externalId: id, contentType,
      sourceUrl: platform === 'douyin' ? `https://www.douyin.com/${contentType === 'video' ? 'video' : 'note'}/${id}` : `https://www.tiktok.com/@${encodeURIComponent(author.uniqueId || location.pathname.split('/')[1]?.replace(/^@/, '') || '_')}/${contentType === 'video' ? 'video' : 'photo'}/${id}`,
      title: body.slice(0, 200) || `${platform === 'douyin' ? '抖音' : 'TikTok'}作品`, text: body,
      author: authorName, authorProfileUrl, publishedAt,
      tags: Array.from(new Set((body.match(/#[^\s#]+/g) || []).map((tag) => tag.slice(1)))),
      stats, coverUrl, imageUrls, videoUrl: contentType === 'video' ? videoUrl : '', videoUrls: contentType === 'video' ? videoUrls : [], comments: captured,
      capture: { blocker: captureBlocker, status: metadataErrors.length || mediaErrors.length || !commentsComplete || captureBlocker ? 'partial' : 'complete', media: mediaErrors.length ? 'partial' : 'complete', comments: commentLimit === 0 ? 'skipped' : commentsComplete ? 'complete' : 'partial', commentLimit, capturedComments: captured.length, commentErrors, errors: [...metadataErrors, ...mediaErrors, ...commentErrors] },
    };
  } catch (error) {
    return { platform, sourceUrl: location.href, accessErrorCode: 'CAPTURE_EXTRACTION_FAILED', message: `作品页面提取失败：${String(error?.message || error).slice(0, 300)}` };
  }
}

export function buildSocialPostEntry(post) {
  if (!post || !['douyin', 'tiktok'].includes(post.platform) || !/^\d+$/.test(post.externalId || '')) throw new Error('未识别到有效的平台作品');
  const label = post.platform === 'douyin' ? '抖音' : 'TikTok';
  return {
    kind: `${post.platform}-${post.contentType === 'image_text' ? 'image' : 'video'}`,
    platform: post.platform, contentType: post.contentType, capture: post.capture,
    source: { sourceUrl: post.sourceUrl, sourceLink: post.sourceUrl, sourceDomain: new URL(post.sourceUrl).hostname, externalId: post.externalId },
    content: { title: post.title, text: post.text, indexText: [post.text, ...post.comments.map((comment) => comment.text)].join('\n\n'), excerpt: post.text.slice(0, 180), author: post.author, authorProfileUrl: post.authorProfileUrl, publishedAt: post.publishedAt, siteName: label, tags: [label, ...post.tags], stats: post.stats, commentsSnapshot: post.comments },
    assets: { coverUrl: post.coverUrl, imageUrls: post.imageUrls, videoUrl: post.videoUrl, videoUrls: post.videoUrls },
    options: { allowUpdate: true, transcribe: post.contentType === 'video' },
  };
}

/** MAIN-world bridge for modern search cards without anchor URLs. Only public
 * post identity is exposed to the isolated research content script. */
export function annotateDouyinSearchCards() {
  if (!(location.hostname === 'douyin.com' || location.hostname.endsWith('.douyin.com'))) return;
  const find = (value, expectedId) => {
    const seen = new Set();
    const found = new Map();
    const stack = [{ value, depth: 0 }];
    let nearestDepth = Infinity;
    while (stack.length && seen.size < 2500) {
      const { value: node, depth } = stack.shift();
      if (!node || typeof node !== 'object' || seen.has(node) || depth > 10) continue;
      if (depth > nearestDepth) break;
      seen.add(node);
      const id = String(node.aweme_id || node.awemeId || '');
      if (/^\d{8,}$/.test(id) && (!expectedId || id === expectedId) && (node.desc || node.video || node.images || node.imagePost || node.aweme_type != null || node.awemeType != null)) {
        nearestDepth = depth;
        found.set(id, { id, desc: String(node.desc || ''), image: Boolean(node.images?.length || node.imagePost || [68, 150].includes(Number(node.aweme_type || node.awemeType))) });
      }
      for (const child of Object.values(node)) if (child && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
    }
    return found.size === 1 ? [...found.values()][0] : null;
  };
  for (const card of document.querySelectorAll('.search-result-card, [data-aweme-id]')) {
    const rect = card.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) continue;
    const mediaIds = new Set(Array.from(card.querySelectorAll('[class*="video_"]')).flatMap((node) => Array.from(String(node.className || '').matchAll(/\bvideo_(\d{8,})\b/g), (match) => match[1])));
    const mediaId = mediaIds.size === 1 ? [...mediaIds][0] : '';
    let identity = null;
    for (const key of Object.keys(card).filter((key) => key.startsWith('__reactProps$') || key.startsWith('__reactFiber$'))) {
      if (key.startsWith('__reactProps$')) identity ||= find(card[key], mediaId);
      else for (let fiber = card[key], depth = 0; fiber && depth < 4 && !identity; fiber = fiber.return, depth += 1) identity = find(fiber.memoizedProps, mediaId);
    }
    if (!identity && mediaId) identity = { id: mediaId, image: false };
    const fallback = String(card.getAttribute('data-aweme-id') || '');
    if (!identity && /^\d{8,}$/.test(fallback)) identity = { id: fallback, image: Boolean(card.querySelector('[href*="/note/"]')) };
    if (identity) {
      card.setAttribute('data-gardenflow-content-id', identity.id);
      card.setAttribute('data-gardenflow-content-type', identity.image ? 'image_text' : 'video');
      for (const stale of card.querySelectorAll('[data-gardenflow-open-id]')) stale.removeAttribute('data-gardenflow-open-id');
      const normalized = (value) => String(value || '').replace(/[^\p{L}\p{N}]/gu, '');
      if (normalized(identity.desc)) {
        const expected = normalized(identity.desc);
        const caption = Array.from(card.querySelectorAll('div, span, p, h3')).find((node) => [expected, `${expected}展开`, `${expected}收起`].includes(normalized(node.textContent)));
        caption?.setAttribute('data-gardenflow-open-id', identity.id);
      }
    } else {
      card.removeAttribute('data-gardenflow-content-id');
      card.removeAttribute('data-gardenflow-content-type');
    }
  }
}
