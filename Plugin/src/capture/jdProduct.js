export function isJdProductUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol)
      && /(^|\.)jd\.(com|hk)$/.test(url.hostname)
      && /\/\d+\.html$/i.test(url.pathname);
  } catch {
    return false;
  }
}

// Keep this function self-contained: chrome.scripting serializes it into the page.
export async function ensureJdReviewModal(pageDocument = globalThis.document) {
  const clean = (value, limit = 2_000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const detectAccessErrorCode = () => {
    const pageProbe = clean(pageDocument.body?.innerText || pageDocument.body?.textContent || '', 8_000);
    if (/captcha|安全验证|人机验证|访问受限|滑块验证|verify you are human|验证一下[，,\s]*购物无忧|快速验证/i.test(pageProbe)) {
      return 'BROWSER_SECURITY_CHALLENGE';
    }
    if (/请先登录|登录后查看|登录后继续|sign in to continue|login required/i.test(pageProbe)) return 'BROWSER_LOGIN_REQUIRED';
    return '';
  };
  const isVisible = (node) => {
    let current = node;
    while (current && current !== pageDocument) {
      if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') return false;
      const style = clean(current.getAttribute?.('style'), 1_000).toLowerCase();
      if (/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/.test(style)) return false;
      try {
        const computed = pageDocument.defaultView?.getComputedStyle?.(current);
        if (computed?.display === 'none' || computed?.visibility === 'hidden') return false;
      } catch {
        // Inline state is still sufficient in DOM-only test environments.
      }
      current = current.parentElement;
    }
    return Boolean(node);
  };
  const initialAccessErrorCode = detectAccessErrorCode();
  if (initialAccessErrorCode) {
    return { modalDetected: false, opened: false, entryFound: false, accessErrorCode: initialAccessErrorCode };
  }
  const findModal = () => {
    const candidates = Array.from(pageDocument.querySelectorAll('[role="dialog"], dialog, [aria-modal="true"], [class*="dialog"], [class*="modal"]'));
    const explicit = candidates.find((node) => {
      if (!isVisible(node)) return false;
      const text = clean(node.textContent, 20_000);
      return /商品(?:评论|评价)/.test(text) && /(好评|中评|差评|图\/视频|追评)/.test(text);
    });
    if (explicit) return explicit;
    const headings = Array.from(pageDocument.querySelectorAll('h1, h2, h3, [role="heading"], div, span'))
      .filter((node) => isVisible(node) && /^商品(?:评论|评价)$/.test(clean(node.textContent, 20)));
    for (const heading of headings) {
      let root = heading.parentElement;
      for (let depth = 0; root && root !== pageDocument.body && depth < 8; depth += 1, root = root.parentElement) {
        const text = clean(root.textContent, 20_000);
        if (/好评/.test(text) && /中评/.test(text) && /差评/.test(text) && /最新|当前商品/.test(text)) return root;
      }
    }
    return null;
  };
  if (findModal()) return { modalDetected: true, opened: false, entryFound: true };

  const entryPattern = /^全部(?:评价|评论)(?:\s*[>›»→]|$)/;
  const entries = [];
  const seen = new Set();
  for (const node of pageDocument.querySelectorAll('button, a, [role="button"], div, span')) {
    const label = clean(node.textContent, 100);
    if (!isVisible(node) || label.length > 40 || !entryPattern.test(label)) continue;
    const interactive = node.closest?.('button, a, [role="button"]') || node;
    if (!isVisible(interactive) || interactive.disabled || interactive.getAttribute?.('aria-disabled') === 'true' || seen.has(interactive)) continue;
    seen.add(interactive);
    entries.push({
      node: interactive,
      priority: /^(BUTTON|A)$/i.test(String(interactive.tagName || '')) || interactive.getAttribute?.('role') === 'button' ? 0 : 1,
      labelLength: label.length,
    });
  }
  if (!entries.length) return { modalDetected: false, opened: false, entryFound: false };
  entries.sort((left, right) => left.priority - right.priority || left.labelLength - right.labelLength);

  const pageWindow = pageDocument.defaultView || globalThis.window;
  const originalX = Number(pageWindow?.scrollX || 0);
  const originalY = Number(pageWindow?.scrollY || 0);
  for (const candidate of entries.slice(0, 4)) {
    const entry = candidate.node;
    try {
      entry.scrollIntoView?.({ block: 'center', inline: 'nearest' });
      entry.click?.();
    } catch {
      // Continue with the remaining visible entry candidates.
    }
    for (let attempt = 0; attempt < 16; attempt += 1) {
      await sleep(250);
      const accessErrorCode = detectAccessErrorCode();
      if (accessErrorCode) {
        return { modalDetected: false, opened: false, entryFound: true, accessErrorCode };
      }
      if (findModal()) {
        try { pageWindow?.scrollTo?.(originalX, originalY); } catch { /* Best effort. */ }
        return { modalDetected: true, opened: true, entryFound: true };
      }
    }
  }
  try { pageWindow?.scrollTo?.(originalX, originalY); } catch { /* Best effort. */ }
  return { modalDetected: false, opened: false, entryFound: true };
}

// Keep this function self-contained: chrome.scripting serializes it into the page.
export function extractJdReviewPreview(pageDocument = globalThis.document) {
  const clean = (value, limit = 2_000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const pageProbe = clean(pageDocument.body?.innerText || pageDocument.body?.textContent || '', 8_000);
  const accessErrorCode = /captcha|安全验证|人机验证|访问受限|滑块验证|verify you are human|验证一下[，,\s]*购物无忧|快速验证/i.test(pageProbe)
    ? 'BROWSER_SECURITY_CHALLENGE'
    : /请先登录|登录后查看|登录后继续|sign in to continue|login required/i.test(pageProbe)
      ? 'BROWSER_LOGIN_REQUIRED'
      : '';
  if (accessErrorCode) {
    return {
      modalDetected: false,
      availableFilters: [],
      selectedFilters: [],
      results: [],
      reviews: [],
      status: 'blocked',
      warnings: ['检测到登录或安全验证，已停止评论采集'],
      accessErrorCode,
    };
  }
  const isVisible = (node) => {
    if (!node || node.hidden || node.getAttribute?.('aria-hidden') === 'true') return false;
    const style = clean(node.getAttribute?.('style'), 1_000).toLowerCase();
    return !/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/.test(style);
  };
  const hash = (value) => {
    let result = 2166136261;
    for (const character of String(value || '')) {
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  };
  const findModal = () => {
    const candidates = Array.from(pageDocument.querySelectorAll('[role="dialog"], dialog, [aria-modal="true"], [class*="dialog"], [class*="modal"]'));
    const explicit = candidates.find((node) => {
      if (!isVisible(node)) return false;
      const text = clean(node.textContent, 20_000);
      return /商品(?:评论|评价)/.test(text) && /(好评|中评|差评|图\/视频|追评)/.test(text);
    });
    if (explicit) return explicit;
    const headings = Array.from(pageDocument.querySelectorAll('h1, h2, h3, [role="heading"], div, span'))
      .filter((node) => isVisible(node) && /^商品(?:评论|评价)$/.test(clean(node.textContent, 20)));
    for (const heading of headings) {
      let root = heading.parentElement;
      for (let depth = 0; root && root !== pageDocument.body && depth < 8; depth += 1, root = root.parentElement) {
        const text = clean(root.textContent, 20_000);
        if (/好评/.test(text) && /中评/.test(text) && /差评/.test(text) && /最新|当前商品/.test(text)) return root;
      }
    }
    return null;
  };
  const modal = findModal();
  if (!modal) {
    return {
      modalDetected: false,
      availableFilters: [],
      selectedFilters: [],
      results: [],
      reviews: [],
      status: 'not-opened',
      warnings: ['未检测到商品评价弹窗；保存时会再次尝试自动打开，商品资料仍可正常保存'],
    };
  }
  const filterSelectors = [
    '[role="tab"]',
    'button',
    '[role="button"]',
    '[class*="filter"] [class*="item"]',
    '[class*="tag"]',
    '[class*="Tag"]',
  ].join(', ');
  const availableFilters = [];
  const seenLabels = new Set();
  for (const node of modal.querySelectorAll(filterSelectors)) {
    if (!isVisible(node)) continue;
    const rawText = clean(node.textContent, 100);
    if (!rawText || rawText.length > 48 || /^(关闭|回复|有用|更多|上一页|下一页)$/.test(rawText)) continue;
    if ((rawText.match(/\d+(?:\.\d+)?%?(?:万|千|百)?\+?/g) || []).length > 1) continue;
    const match = rawText.match(/^(.*?)(\d+(?:\.\d+)?%?(?:万|千|百)?\+?|99%好评)$/);
    const label = clean(match?.[1] || rawText, 40);
    const countText = clean(match?.[2], 30);
    const isSentiment = /^(好评|中评|差评)$/.test(label);
    if (!label || (match && !clean(match[1], 40)) || (!match && !isSentiment) || seenLabels.has(label)) continue;
    seenLabels.add(label);
    const sentiment = label === '好评' ? 'positive' : label === '中评' ? 'neutral' : label === '差评' ? 'negative' : undefined;
    availableFilters.push({
      id: `review-filter-${availableFilters.length}-${hash(label)}`,
      label,
      ...(countText ? { countText } : {}),
      ...(sentiment ? { sentiment } : {}),
    });
  }
  const activeFilter = availableFilters.find((filter) => {
    const node = Array.from(modal.querySelectorAll(filterSelectors)).find((candidate) => clean(candidate.textContent, 100).startsWith(filter.label));
    return node?.getAttribute('aria-selected') === 'true' || /(?:^|\s)(?:active|selected|checked)(?:\s|$)/i.test(String(node?.className || ''));
  });
  const sortText = clean(Array.from(modal.querySelectorAll('[class*="sort"], [role="tablist"]')).map((node) => node.textContent).find((text) => /最新|默认|时间/.test(String(text))), 100);
  const scopeText = clean(Array.from(modal.querySelectorAll('[class*="scope"], [class*="product"]')).map((node) => node.textContent).find((text) => /当前商品|全部商品/.test(String(text))), 100);
  return {
    modalDetected: true,
    availableFilters,
    selectedFilters: [],
    results: [],
    reviews: [],
    status: availableFilters.length ? 'ready' : 'partial',
    warnings: availableFilters.length ? [] : ['已检测到商品评价弹窗，但没有识别到可用筛选标签'],
    ...(activeFilter ? { activeFilterId: activeFilter.id } : {}),
    ...(sortText ? { sortText } : {}),
    ...(scopeText ? { scopeText } : {}),
  };
}

// Keep this function self-contained: chrome.scripting serializes it into the page.
export async function captureJdProductReviews(reviewOptions = {}, pageDocument = globalThis.document, pageLocation = globalThis.location) {
  const clean = (value, limit = 20_000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const detectAccessErrorCode = () => {
    const pageProbe = clean(pageDocument.body?.innerText || pageDocument.body?.textContent || '', 8_000);
    if (/captcha|安全验证|人机验证|访问受限|滑块验证|verify you are human|验证一下[，,\s]*购物无忧|快速验证/i.test(pageProbe)) {
      return 'BROWSER_SECURITY_CHALLENGE';
    }
    if (/请先登录|登录后查看|登录后继续|sign in to continue|login required/i.test(pageProbe)) return 'BROWSER_LOGIN_REQUIRED';
    return '';
  };
  const isVisible = (node) => {
    if (!node || node.hidden || node.getAttribute?.('aria-hidden') === 'true') return false;
    const style = clean(node.getAttribute?.('style'), 1_000).toLowerCase();
    return !/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/.test(style);
  };
  const hash = (value) => {
    let result = 2166136261;
    for (const character of String(value || '')) {
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  };
  const absoluteMediaUrl = (value) => {
    const source = clean(value, 8_000);
    if (!source || /^(data|blob):/i.test(source)) return '';
    try {
      const url = new URL(source, String(pageLocation?.href || ''));
      return /^https?:$/.test(url.protocol) && /(^|\.)(jd\.com|jd\.hk|jdimg\.com|360buyimg\.com|jcloudcs\.com)$/.test(url.hostname) ? url.href : '';
    } catch { return ''; }
  };
  const findModal = () => {
    const candidates = Array.from(pageDocument.querySelectorAll('[role="dialog"], dialog, [aria-modal="true"], [class*="dialog"], [class*="modal"]'));
    const explicit = candidates.find((node) => {
      if (!isVisible(node)) return false;
      const text = clean(node.textContent, 20_000);
      return /商品(?:评论|评价)/.test(text) && /(好评|中评|差评|图\/视频|追评)/.test(text);
    });
    if (explicit) return explicit;
    const headings = Array.from(pageDocument.querySelectorAll('h1, h2, h3, [role="heading"], div, span'))
      .filter((node) => isVisible(node) && /^商品(?:评论|评价)$/.test(clean(node.textContent, 20)));
    for (const heading of headings) {
      let root = heading.parentElement;
      for (let depth = 0; root && root !== pageDocument.body && depth < 8; depth += 1, root = root.parentElement) {
        const text = clean(root.textContent, 20_000);
        if (/好评/.test(text) && /中评/.test(text) && /差评/.test(text) && /最新|当前商品/.test(text)) return root;
      }
    }
    return null;
  };
  const initialAccessErrorCode = detectAccessErrorCode();
  if (initialAccessErrorCode) {
    return {
      modalDetected: false,
      availableFilters: [],
      selectedFilters: [],
      results: [],
      reviews: [],
      status: 'blocked',
      warnings: ['检测到登录或安全验证，已停止评论采集'],
      accessErrorCode: initialAccessErrorCode,
    };
  }
  const modal = findModal();
  if (!modal) {
    return {
      modalDetected: false,
      availableFilters: [],
      selectedFilters: [],
      results: [],
      reviews: [],
      status: 'not-opened',
      warnings: ['未检测到商品评价弹窗，本次仅保存商品资料'],
    };
  }

  const filterSelectors = [
    '[role="tab"]',
    'button',
    '[role="button"]',
    '[class*="filter"] [class*="item"]',
    '[class*="tag"]',
    '[class*="Tag"]',
  ].join(', ');
  const discoverFilters = () => {
    const found = [];
    const seenLabels = new Set();
    for (const node of modal.querySelectorAll(filterSelectors)) {
      if (!isVisible(node)) continue;
      const rawText = clean(node.textContent, 100);
      if (!rawText || rawText.length > 48 || /^(关闭|回复|有用|更多|上一页|下一页)$/.test(rawText)) continue;
      if ((rawText.match(/\d+(?:\.\d+)?%?(?:万|千|百)?\+?/g) || []).length > 1) continue;
      const match = rawText.match(/^(.*?)(\d+(?:\.\d+)?%?(?:万|千|百)?\+?|99%好评)$/);
      const label = clean(match?.[1] || rawText, 40);
      const countText = clean(match?.[2], 30);
      const isSentiment = /^(好评|中评|差评)$/.test(label);
      if (!label || (match && !clean(match[1], 40)) || (!match && !isSentiment) || seenLabels.has(label)) continue;
      seenLabels.add(label);
      const sentiment = label === '好评' ? 'positive' : label === '中评' ? 'neutral' : label === '差评' ? 'negative' : undefined;
      found.push({
        id: `review-filter-${found.length}-${hash(label)}`,
        label,
        countText,
        sentiment,
        node,
      });
    }
    return found;
  };
  const available = discoverFilters();
  const availableFilters = available.map(({ node: _node, ...filter }) => ({
    id: filter.id,
    label: filter.label,
    ...(filter.countText ? { countText: filter.countText } : {}),
    ...(filter.sentiment ? { sentiment: filter.sentiment } : {}),
  }));
  const captureAll = reviewOptions?.captureAll === true;
  const requestedLimit = Number(reviewOptions?.limitPerFilter);
  const limitPerFilter = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(50, Math.trunc(requestedLimit)))
    : 5;
  const maxScrollRounds = Number.isFinite(Number(reviewOptions?.maxScrollRounds))
    ? Math.max(1, Math.min(12, Math.trunc(Number(reviewOptions.maxScrollRounds))))
    : 6;
  const safetyReviewLimit = captureAll ? 50 : limitPerFilter;
  const requestedIds = Array.from(new Set((Array.isArray(reviewOptions?.selectedFilterIds) ? reviewOptions.selectedFilterIds : [])
    .map((value) => clean(value, 200)).filter(Boolean)));
  const requestedLabels = Array.from(new Set((Array.isArray(reviewOptions?.selectedFilterLabels) ? reviewOptions.selectedFilterLabels : [])
    .map((value) => clean(value, 40)).filter(Boolean)));
  let selected = available.filter((filter) => requestedIds.includes(filter.id) || requestedLabels.includes(filter.label));
  if (!requestedIds.length && !requestedLabels.length) {
    selected = ['好评', '中评', '差评'].flatMap((label) => available.find((filter) => filter.label === label) || []);
  }
  const selectedFilters = selected.map((filter) => ({
    id: filter.id,
    label: filter.label,
    limit: limitPerFilter,
    ...(captureAll ? { captureAll: true } : {}),
  }));
  const warnings = [];
  if (!requestedIds.length && !requestedLabels.length) {
    for (const label of ['好评', '中评', '差评']) {
      if (!selected.some((filter) => filter.label === label)) warnings.push(`未找到默认筛选标签“${label}”`);
    }
  } else if (selected.length < Math.max(requestedIds.length, requestedLabels.length)) {
    warnings.push('部分所选评论标签在保存时已不可用');
  }

  const originalFilter = available.find((filter) => (
    filter.node.getAttribute?.('aria-selected') === 'true'
    || /(?:^|\s)(?:active|selected|checked)(?:\s|$)/i.test(String(filter.node.className || ''))
  ));
  const scrollCandidates = Array.from(modal.querySelectorAll('*')).filter((node) => Number(node.scrollHeight || 0) > Number(node.clientHeight || 0) + 20);
  const scrollContainer = scrollCandidates.sort((left, right) => Number(right.clientHeight || 0) - Number(left.clientHeight || 0))[0] || modal;
  const originalScrollTop = Number(scrollContainer.scrollTop || 0);

  const firstText = (root, selectors, limit = 2_000) => {
    for (const selector of selectors) {
      for (const node of root.querySelectorAll(selector)) {
        const value = clean(node.getAttribute?.('content') || node.textContent, limit);
        if (value) return value;
      }
    }
    return '';
  };
  const fullReviewText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const splitReviewText = (value) => {
    const normalized = fullReviewText(value);
    const merchantReply = /(?:商家|卖家|店铺|客服)(?:回复)?\s*[：:]/.exec(normalized);
    if (!merchantReply) return { text: normalized, merchantReply: '' };
    const replyText = normalized.slice(merchantReply.index).trim()
      .replace(/^(?:商家|卖家|店铺|客服)(?:回复)?\s*[：:]\s*/, '');
    return {
      text: fullReviewText(normalized.slice(0, merchantReply.index)),
      merchantReply: fullReviewText(replyText),
    };
  };
  const isMerchantReplyNode = (node, row) => {
    let current = node;
    for (let depth = 0; current && current !== row && depth < 5; depth += 1, current = current.parentElement) {
      const identity = [
        current.getAttribute?.('data-role'),
        current.getAttribute?.('class'),
        current.getAttribute?.('id'),
      ].map((value) => String(value || '')).join(' ');
      if (/(?:^|[\s_-])(?:merchant|seller|vendor|shop|service)?[-_ ]*repl(?:y|ies)(?:[\s_-]|$)/i.test(identity)
        || /(?:商家|卖家|店铺|客服)(?:回复)?/.test(identity)) return true;
      const directText = fullReviewText(Array.from(current.childNodes || [])
        .filter((child) => child.nodeType === 3)
        .map((child) => child.textContent)
        .join(' '));
      if (/^(?:商家|卖家|店铺|客服)(?:回复)?\s*[：:]/.test(directText)) return true;
    }
    return false;
  };
  const firstUserReviewContent = (root, selectors) => {
    for (const selector of selectors) {
      for (const node of root.querySelectorAll(selector)) {
        if (isMerchantReplyNode(node, root)) continue;
        const value = splitReviewText(node.getAttribute?.('content') || node.textContent);
        if (value.text) return value;
      }
    }
    return { text: '', merchantReply: '' };
  };
  const leafTexts = (root) => Array.from(root.querySelectorAll('div, span, p, time, li'))
    .filter((node) => isVisible(node))
    .map((node) => ({ node, text: fullReviewText(node.textContent) }))
    .filter(({ node, text }) => text && !Array.from(node.children || []).some((child) => fullReviewText(child.textContent)));
  const merchantReplyText = (root, textItems) => {
    const dedicated = Array.from(root.querySelectorAll([
      '[data-role*="reply" i]',
      '[class*="reply" i]',
      '[class*="merchant" i]',
      '[class*="seller" i]',
      '[class*="shop-reply" i]',
    ].join(', ')))
      .filter((node) => isMerchantReplyNode(node, root))
      .map((node) => {
        const content = splitReviewText(node.getAttribute?.('content') || node.textContent);
        return content.merchantReply || fullReviewText(node.textContent)
          .replace(/^(?:商家|卖家|店铺|客服)(?:回复)?\s*[：:]\s*/, '');
      })
      .filter(Boolean);
    const marked = textItems
      .map((item) => splitReviewText(item.text).merchantReply)
      .filter(Boolean);
    const combined = splitReviewText(root.textContent).merchantReply;
    return [...dedicated, ...marked, ...(combined ? [combined] : [])]
      .sort((left, right) => right.length - left.length)[0] || '';
  };
  const discoverReviewRows = () => {
    const selector = [
      '[data-comment-id]',
      '[data-review-id]',
      '.comment-item',
      '.comment-column',
      '[class*="comment-item"]',
      '[class*="commentItem"]',
      '[class*="CommentItem"]',
      '[class*="review-item"]',
      '[class*="reviewItem"]',
    ].join(', ');
    const explicitRows = Array.from(modal.querySelectorAll(selector));
    const structuralRows = [];
    if (!explicitRows.length) {
      const avatars = Array.from(modal.querySelectorAll('img[alt*="avatar" i], img[class*="avatar" i], [class*="avatar" i] img'));
      for (const avatar of avatars) {
        let candidate = avatar.parentElement;
        for (let depth = 0; candidate && candidate !== modal && depth < 8; depth += 1, candidate = candidate.parentElement) {
          const text = clean(candidate.textContent, 20_000);
          const avatarCount = candidate.querySelectorAll('img[alt*="avatar" i], img[class*="avatar" i], [class*="avatar" i] img').length;
          const hasDate = /(?:^|[^\d])(?:\d{4}-)?\d{2}-\d{2}(?!\d)/.test(text);
          const hasBody = leafTexts(candidate).some((item) => item.text.length >= 18 && !/(?:^|[^\d])(?:\d{4}-)?\d{2}-\d{2}(?!\d)/.test(item.text));
          if (avatarCount === 1 && hasDate && hasBody) {
            structuralRows.push(candidate);
            break;
          }
        }
      }
    }
    const candidates = explicitRows.length ? explicitRows : structuralRows;
    return Array.from(new Set(candidates)).filter((node, index, items) => (
      isVisible(node) && !items.some((candidate, candidateIndex) => candidateIndex !== index && candidate.contains(node))
    ));
  };
  const extractReviews = (filter) => {
    const rows = discoverReviewRows();
    const reviews = [];
    for (const row of rows) {
      const textItems = leafTexts(row);
      const explicitContent = firstUserReviewContent(row, ['[data-role="comment-text"]', '[class*="comment-content"]', '[class*="commentText"]', '[class*="comment-text"]', '[class*="content"] [class*="text"]', '.comment-con']);
      const fallbackContent = textItems
        .filter((item) => !isMerchantReplyNode(item.node, row))
        .map((item) => splitReviewText(item.text))
        .filter((value) => value.text)
        .filter((value) => value.text.length >= 2 && !/(?:^|[^\d])(?:\d{4}-)?\d{2}-\d{2}(?!\d)/.test(value.text))
        .filter((value) => !/该店铺购买|^(?:回复|有用|超赞)$/.test(value.text))
        .sort((left, right) => right.text.length - left.text.length)[0] || { text: '', merchantReply: '' };
      const text = explicitContent.text || fallbackContent.text;
      const merchantReply = explicitContent.merchantReply
        || merchantReplyText(row, textItems)
        || fallbackContent.merchantReply;
      if (!text) continue;
      const explicitAuthor = firstText(row, ['[data-role="author"]', '[class*="user-name"]', '[class*="nickname"]', '[class*="userName"]', '[class*="user"] [class*="name"]'], 300);
      const fallbackAuthor = textItems.map((item) => item.text.match(/^([^\s]{1,20}\*{2,}[^\s]{0,12})/)?.[1]).find(Boolean) || '';
      const authorName = explicitAuthor || fallbackAuthor;
      const explicitDate = firstText(row, ['time', '[data-role="date"]', '[class*="date"]', '[class*="time"]'], 300);
      const fallbackDate = textItems.map((item) => item.text.match(/(?:^|[^\d])((?:\d{4}-)?\d{2}-\d{2})(?!\d)/)?.[1]).find(Boolean) || '';
      const dateText = explicitDate || fallbackDate;
      const explicitSku = firstText(row, ['[data-role="sku"]', '[class*="sku"]', '[class*="product-info"]', '[class*="order-info"]'], 1_000);
      const fallbackSku = textItems.map((item) => item.text)
        .find((value) => value !== text && value.length <= 120 && /(?:kg|\d+g|口味|猫粮|装|味)$/i.test(value)) || '';
      const skuText = explicitSku || fallbackSku;
      const ratingNodes = Array.from(row.querySelectorAll('[data-score], [data-rating], [aria-label*="星"], [title*="星"], [class*="star" i], img[alt*="星"]'));
      const ratingSources = [row, ...ratingNodes].flatMap((node) => [
        node.getAttribute?.('data-score'),
        node.getAttribute?.('data-rating'),
        node.getAttribute?.('aria-label'),
        node.getAttribute?.('title'),
        node.getAttribute?.('alt'),
        node.getAttribute?.('class'),
        node.getAttribute?.('style'),
        node.textContent,
      ]).map((value) => clean(value, 200)).filter(Boolean);
      let rating;
      for (const source of ratingSources) {
        const explicitMatch = source.match(/^([1-5])(?:\.0)?$/)
          || source.match(/(?:^|[^\d])([1-5])(?:\.0)?\s*(?:星|分|stars?)(?:[^\d]|$)/i)
          || source.match(/(?:star|score|rating|level)[-_:\s]*([1-5])(?:[^\d]|$)/i)
          || source.match(/(?:width\s*:\s*)(20|40|60|80|100)%/i);
        if (!explicitMatch) continue;
        const numeric = Number(explicitMatch[1]);
        rating = numeric > 5 ? numeric / 20 : numeric;
        break;
      }
      const badges = Array.from(row.querySelectorAll('[data-role="badge"], [class*="badge"], [class*="tag"]'))
        .map((node) => clean(node.textContent, 100)).filter(Boolean).slice(0, 12);
      for (const item of textItems) {
        if (/该店铺购买|^(?:超赞|追评)$/.test(item.text) && item.text.length <= 100) badges.push(item.text);
      }
      const helpfulText = firstText(row, ['[data-role="helpful"]', '[class*="helpful"]', '[class*="useful"]'], 200);
      const helpfulMatch = helpfulText.match(/(\d+)/);
      const imageSourceUrls = [];
      for (const image of row.querySelectorAll('img')) {
        if (image.closest?.('[class*="avatar"], [class*="user"]')) continue;
        const imageRole = clean([image.getAttribute?.('alt'), image.className, image.getAttribute?.('class')].join(' '), 500).toLowerCase();
        if (/(?:avatar|star|more|icon|头像|星)/.test(imageRole) && !/(?:pic|photo|image)/.test(imageRole)) continue;
        const source = ['data-original', 'data-src', 'src'].map((attribute) => image.getAttribute(attribute)).map(absoluteMediaUrl).find(Boolean);
        if (source && !imageSourceUrls.includes(source)) imageSourceUrls.push(source);
      }
      const videoNode = row.querySelector('video, [data-role="review-video"], [class*="video"]');
      const videoSourceUrl = absoluteMediaUrl(videoNode?.getAttribute?.('src') || videoNode?.querySelector?.('source')?.getAttribute?.('src'));
      const platformReviewId = clean(row.getAttribute?.('data-comment-id') || row.getAttribute?.('data-review-id'), 500);
      const id = platformReviewId ? `jd-${platformReviewId}` : `jd-review-${hash([authorName, dateText, skuText, text, imageSourceUrls.join('|')].join('::'))}`;
      reviews.push({
        id,
        ...(platformReviewId ? { platformReviewId } : {}),
        ...(authorName ? { authorName } : {}),
        text,
        ...(merchantReply ? { merchantReply } : {}),
        ...(rating ? { rating } : {}),
        ...(filter.sentiment ? { sentiment: filter.sentiment } : {}),
        matchedFilterIds: [filter.id],
        ...(dateText ? { dateText } : {}),
        ...(skuText ? { skuText } : {}),
        ...(badges.length ? { badges: Array.from(new Set(badges)) } : {}),
        ...(helpfulMatch ? { helpfulCount: Number(helpfulMatch[1]) } : {}),
        imageSourceUrls: imageSourceUrls.slice(0, 9),
        ...(videoNode ? { video: { present: true, ...(videoSourceUrl ? { sourceUrl: videoSourceUrl } : {}) } } : {}),
      });
    }
    return reviews;
  };
  const signature = () => clean(discoverReviewRows().slice(0, 2).map((node) => node.textContent).join('|'), 1_000);
  const merged = new Map();
  const results = [];
  let accessErrorCode = '';
  captureFilters: for (const filter of selected) {
    const before = signature();
    filter.node.click?.();
    let sawLoadingState = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await sleep(250);
      accessErrorCode = detectAccessErrorCode();
      if (accessErrorCode) break captureFilters;
      const active = filter.node.getAttribute?.('aria-selected') === 'true'
        || /(?:^|\s)(?:active|selected|checked)(?:\s|$)/i.test(String(filter.node.className || ''));
      const current = signature();
      if (!current) sawLoadingState = true;
      if (current && current !== before) break;
      if (active && current && ((sawLoadingState && attempt >= 1) || attempt >= 3)) break;
    }
    scrollContainer.scrollTop = 0;
    const collectedById = new Map();
    let stalled = 0;
    let scrollRounds = 0;
    let stoppedBySafetyLimit = false;
    while (stalled < 3) {
      accessErrorCode = detectAccessErrorCode();
      if (accessErrorCode) break captureFilters;
      const beforeCount = collectedById.size;
      for (const review of extractReviews(filter)) collectedById.set(review.id, review);
      if (collectedById.size === beforeCount) stalled += 1;
      else stalled = 0;
      if (collectedById.size >= safetyReviewLimit) {
        stoppedBySafetyLimit = captureAll;
        break;
      }
      if (scrollRounds >= maxScrollRounds) {
        stoppedBySafetyLimit = stalled < 3;
        break;
      }
      const priorTop = Number(scrollContainer.scrollTop || 0);
      const step = Math.max(Number(scrollContainer.clientHeight || 0) * 0.75, 480);
      scrollContainer.scrollTop = priorTop + step;
      scrollRounds += 1;
      const PageEvent = pageDocument.defaultView?.Event || globalThis.Event;
      if (PageEvent) scrollContainer.dispatchEvent?.(new PageEvent('scroll', { bubbles: true }));
      await sleep(400);
    }
    const collected = Array.from(collectedById.values());
    if (collected.length > safetyReviewLimit) collected.splice(safetyReviewLimit);
    for (const review of collected) {
      const prior = merged.get(review.id);
      merged.set(review.id, prior ? {
        ...prior,
        matchedFilterIds: Array.from(new Set([...(prior.matchedFilterIds || []), filter.id])),
      } : review);
    }
    const complete = !stoppedBySafetyLimit
      && (captureAll ? collected.length > 0 || /^0(?:\D|$)/.test(filter.countText || '') : collected.length >= limitPerFilter);
    const warning = stoppedBySafetyLimit
      ? `已达到安全采集上限（${collected.length} 条或 ${maxScrollRounds} 次滚动）`
      : !complete
        ? captureAll ? '页面未加载出可采集评论' : `仅加载到 ${collected.length} 条评论`
        : '';
    if (stoppedBySafetyLimit && warning) warnings.push(`${filter.label}：${warning}`);
    results.push({
      filterId: filter.id,
      label: filter.label,
      requested: captureAll ? collected.length : limitPerFilter,
      captured: collected.length,
      status: complete ? 'complete' : 'partial',
      ...(captureAll ? { captureAll: true } : {}),
      ...(warning ? { warning } : {}),
    });
  }
  if (accessErrorCode) {
    return {
      modalDetected: true,
      availableFilters,
      selectedFilters,
      results,
      reviews: Array.from(merged.values()),
      status: 'blocked',
      warnings: Array.from(new Set([...warnings, '检测到登录或安全验证，已停止评论采集'])),
      accessErrorCode,
    };
  }
  if (originalFilter && !selected.some((filter) => filter.id === originalFilter.id)) {
    originalFilter.node.click?.();
    await sleep(250);
  }
  scrollContainer.scrollTop = originalScrollTop;
  const reviews = Array.from(merged.values());
  if (!selected.length) warnings.push('没有可执行的评论筛选标签，本次仅保存商品资料');
  if (results.some((result) => result.status !== 'complete')) {
    warnings.push(captureAll ? '部分评论标签未能加载出评论' : '部分评论标签未达到请求数量');
  }
  const sortText = clean(Array.from(modal.querySelectorAll('[class*="sort"], [role="tablist"]')).map((node) => node.textContent).find((text) => /最新|默认|时间/.test(String(text))), 100);
  const scopeText = clean(Array.from(modal.querySelectorAll('[class*="scope"], [class*="product"]')).map((node) => node.textContent).find((text) => /当前商品|全部商品/.test(String(text))), 100);
  return {
    modalDetected: true,
    availableFilters,
    selectedFilters,
    results,
    reviews,
    status: selected.length && !warnings.length && results.every((result) => result.status === 'complete') ? 'complete' : 'partial',
    warnings: Array.from(new Set(warnings)),
    ...(sortText ? { sortText } : {}),
    ...(scopeText ? { scopeText } : {}),
  };
}

// Keep this function self-contained: chrome.scripting serializes it into the page.
export function extractJdProductPayload(pageDocument = globalThis.document, pageLocation = globalThis.location) {
  const clean = (value, limit = 20_000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const nodeText = (node) => clean(node?.getAttribute('content') || node?.textContent);
  const firstText = (...selectors) => {
    for (const selector of selectors) {
      for (const node of pageDocument.querySelectorAll(selector)) {
        const value = nodeText(node);
        if (value) return value;
      }
    }
    return '';
  };
  const unique = (values) => Array.from(new Set(values.filter(Boolean)));
  const sourceUrl = String(pageLocation.href || '');
  const pageProbe = clean(pageDocument.body?.innerText || pageDocument.body?.textContent || '', 8_000);
  const accessErrorCode = /captcha|安全验证|人机验证|访问受限|滑块验证|verify you are human|验证一下[，,\s]*购物无忧|快速验证/i.test(pageProbe)
    ? 'BROWSER_SECURITY_CHALLENGE'
    : /请先登录|登录后查看|登录后继续|sign in to continue|login required/i.test(pageProbe)
      ? 'BROWSER_LOGIN_REQUIRED'
      : '';
  if (accessErrorCode) {
    return {
      platform: 'jd',
      captureVersion: 3,
      sourceUrl,
      capturedAt: new Date().toISOString(),
      title: '',
      externalId: '',
      parameters: [],
      images: [],
      missingFields: ['商品名称', '商品标识'],
      accessErrorCode,
    };
  }
  const currentUrl = new URL(sourceUrl);
  const pathSku = currentUrl.pathname.match(/\/(\d+)\.html/i)?.[1] || '';
  const selectedSkuId = clean(pathSku || currentUrl.searchParams.get('sku') || currentUrl.searchParams.get('skuId'), 500);

  // Read explicit Product metadata only; recommendations and unrelated scripts are not product identity.
  const structuredProducts = [];
  const visitStructured = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 6) return;
    if (Array.isArray(value)) {
      value.slice(0, 100).forEach((item) => visitStructured(item, depth + 1));
      return;
    }
    if ([value['@type']].flat().includes('Product')) structuredProducts.push(value);
    visitStructured(value['@graph'], depth + 1);
    visitStructured(value.mainEntity, depth + 1);
  };
  pageDocument.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try { visitStructured(JSON.parse(script.textContent || '')); } catch { /* Invalid metadata is optional. */ }
  });
  const structuredMatches = (item) => {
    const id = clean(item.sku || item.productID);
    return id ? id === selectedSkuId : String(item.url || '').includes(`/${selectedSkuId}.html`);
  };
  const structured = structuredProducts.find(structuredMatches)
    || (structuredProducts.length === 1 && !structuredProducts[0].sku && !structuredProducts[0].productID && !structuredProducts[0].url ? structuredProducts[0] : {});
  const pageProduct = pageDocument.defaultView?.pageConfig?.product || {};
  const pageProductMatches = String(pageProduct.skuid || pageProduct.skuId || '') === selectedSkuId;
  // Older JD pages embed pageConfig before rendering it. Do not scan the entire document for SKU/SPU ids.
  let embeddedSpu = '';
  for (const script of pageDocument.querySelectorAll('script:not([src])')) {
    const content = script.textContent || '';
    if (!/\bpageConfig\s*=/.test(content)) continue;
    const sku = content.match(/\b(?:skuId|skuid|sku_id)["']?\s*:\s*["']?(\d+)/)?.[1];
    if (sku === selectedSkuId) embeddedSpu = content.match(/\b(?:spuId|spu_id)["']?\s*:\s*["']?(\d+)/)?.[1] || '';
  }
  const externalId = clean((pageProductMatches && pageProduct.spuId) || embeddedSpu || selectedSkuId, 500);
  const rawTitle = clean(
    firstText('.sku-title-name', '.sku-name', '.itemInfo-wrap h1', '[itemtype$="/Product"] [itemprop="name"]')
      || structured.name
      || pageDocument.querySelector('meta[property="og:title"]')?.getAttribute('content')
      || pageDocument.title,
    1_000,
  ).replace(/\s*【行情\s*报价\s*价格\s*评测】\s*/g, '').replace(/\s*[-_]\s*京东.*$/i, '').trim();
  const title = /^京东\s*\(JD\.COM\)/i.test(rawTitle) ? '' : rawTitle;

  const parameters = [];
  const seenParameters = new Set();
  const pushParameter = (keyValue, rawValue = '') => {
    let key = clean(keyValue, 500);
    let value = clean(rawValue, 4_000);
    if (!value) {
      const parts = key.split(/\s*[:：]\s*/);
      if (parts.length < 2) return;
      key = clean(parts.shift(), 500);
      value = clean(parts.join('：'), 4_000);
    }
    key = key.replace(/[：:]$/, '').trim();
    if (!key || !value || seenParameters.has(key) || parameters.length >= 200) return;
    seenParameters.add(key);
    parameters.push({ key, value });
  };
  pageDocument.querySelectorAll('.p-parameter-list li, .parameter2 li, #parameter-brand').forEach((node) => {
    // Some JD li titles hold only the value, while the label is in textContent.
    pushParameter(node.textContent || node.getAttribute('title'));
  });
  pageDocument.querySelectorAll('.Ptable-item dl').forEach((node) => {
    pushParameter(nodeText(node.querySelector('dt')), nodeText(node.querySelector('dd')));
  });
  // New desktop: gallery parameter card and the full product-attribute table.
  pageDocument.querySelectorAll('#spec-n1 .attribute .list > .item, .attrs > .item').forEach((node) => {
    pushParameter(nodeText(node.querySelector('.label .text, .label')), nodeText(node.querySelector('.value .text, .value')));
  });
  pageDocument.querySelectorAll('.highlight-attrs > .item').forEach((node) => {
    pushParameter(nodeText(node.querySelector('.desc .text')), nodeText(node.querySelector('.title')));
  });
  (Array.isArray(structured.additionalProperty) ? structured.additionalProperty : []).forEach((item) => {
    pushParameter(item?.name, item?.value);
  });
  const brandName = clean(parameters.find((item) => /^(品牌|brand)$/i.test(item.key))?.value
    || (typeof structured.brand === 'string' ? structured.brand : structured.brand?.name)
    || firstText('.p-author a', '#parameter-brand a'), 1_000);
  const shopName = clean(firstText('.top-shop-info .top-name', '.top-name-tag .top-name', '.name a[clstag*="shop"]', '.J-hove-wrap .name a', '#popbox .mt h3'), 1_000);

  const selectedVariantParts = [];
  const addVariant = (value) => {
    const text = clean(value, 1_000);
    if (text && !selectedVariantParts.includes(text)) selectedVariantParts.push(text);
  };
  pageDocument.querySelectorAll('.specification-series-layout, .specification-group').forEach((group) => {
    const label = nodeText(group.querySelector('.specification-group-label, .layout-label'));
    group.querySelectorAll('.specification-item-sku--selected, .specification-series-item--selected').forEach((node) => {
      const value = nodeText(node.querySelector('.specification-item-sku-text, .specification-series-item-text')) || nodeText(node);
      if (value) addVariant(label ? `${label}：${value}` : value);
    });
  });
  pageDocument.querySelectorAll('#choose-attrs .item.selected, #choose-attrs .item.hover, [class*="choose"] .selected, [class*="sku"] [aria-checked="true"]').forEach((node) => {
    addVariant(node.getAttribute('title') || node.querySelector('a')?.getAttribute('title') || nodeText(node));
  });
  const variantText = selectedVariantParts.join('；');
  const offers = [structured.offers].flat().filter((item) => item && typeof item === 'object');
  const offer = offers.find((item) => String(item.url || '').includes(`/${selectedSkuId}.html`))
    || (offers.length === 1 ? offers[0] : {});
  const rawPrice = firstText('.product-price--main .product-price--value', '.summary-price .p-price .price', '.p-price .price', '[itemprop="offers"] [itemprop="price"]') || clean(offer.price);
  // Parse only the actual price node. Coupons, instalments and original prices are separate fields.
  const priceValue = clean(rawPrice).replace(/[¥￥,\s]/g, '');
  const priceText = /^\d+(?:\.\d{1,2})?$/.test(priceValue) ? `¥${priceValue}` : '';
  const priceLabel = priceText ? clean(firstText('.product-price--activity-item--tag', '.product-price--activity-item--text'), 100) : '';

  const absoluteImageUrl = (value) => {
    const source = clean(value, 8_000);
    if (!source || /^(data|blob):/i.test(source)) return '';
    try {
      const url = new URL(source, sourceUrl);
      if (!/^https?:$/.test(url.protocol) || !/(^|\.)(jd\.com|jd\.hk|jdimg\.com|360buyimg\.com|jcloudcs\.com)$/.test(url.hostname)) return '';
      if (/\.(gif|svg|ico)(?:$|\.)/i.test(url.pathname) || /\/(imagetools|icon|icons)\//i.test(url.pathname)) return '';
      // JD gallery thumbnails share the original's jfs path. Use the large rendition and dedupe formats/sizes.
      if (/\/jfs\//.test(url.pathname) || /_jfs\//.test(url.pathname)) {
        url.pathname = url.pathname.replace(/\/n[0-9]\//, '/n1/').replace(/\/s\d+x\d+_/, '/s1440x1440_');
      }
      return url.href;
    } catch { return ''; }
  };
  const imageKey = (url) => {
    const parsed = new URL(url);
    return (parsed.pathname.match(/(?:\/|_)(jfs\/.*)/)?.[1] || parsed.pathname)
      .replace(/\.(avif|webp)$/i, '').replace(/!.*$/, '');
  };
  const images = [];
  const seenImages = new Set();
  const addImage = (source, role) => {
    const url = absoluteImageUrl(source);
    if (!url || images.length >= 24 || seenImages.has(imageKey(url))) return;
    seenImages.add(imageKey(url));
    images.push({ name: `京东${role === 'detail' ? '详情' : '商品'}图 ${images.length + 1}`, sourceUrl: url, role: images.length === 0 && role === 'gallery' ? 'primary' : role, origin: 'capture' });
  };
  const addNodeImage = (node, role) => {
    if (node.matches('.thumbnails-play-icon, .sku-type-icon, .tips, .icon')) return;
    // Intrinsic dimensions are reliable; CSS thumbnail size is not the original image size.
    if (node.naturalWidth > 0 && node.naturalHeight > 0 && (node.naturalWidth < 80 || node.naturalHeight < 80)) return;
    const srcset = String(node.getAttribute('srcset') || '').split(',').map((part) => part.trim().split(/\s+/))
      .sort((a, b) => (parseFloat(b[1]) || 0) - (parseFloat(a[1]) || 0)).map((part) => part[0]);
    const candidates = ['data-lazy-img', 'data-lazyload', 'data-original', 'data-src'].map((attribute) => node.getAttribute(attribute));
    const source = [...candidates, ...srcset, node.getAttribute('src')].map(absoluteImageUrl).find(Boolean);
    if (source) addImage(source, role);
  };
  pageDocument.querySelectorAll('#spec-list img, .spec-items img, [class*="_gallery_"] .thumbnails img.image').forEach((node) => addNodeImage(node, 'gallery'));
  pageDocument.querySelectorAll('#spec-n1 .image-area img, #spec-n1 img.main-img, #preview #spec-img, #preview > img').forEach((node) => addNodeImage(node, 'gallery'));
  [structured.image].flat().filter(Boolean).forEach((item) => addImage(typeof item === 'string' ? item : item.url || item.contentUrl, 'gallery'));
  if (!images.length) addImage(pageDocument.querySelector('meta[property="og:image"]')?.getAttribute('content'), 'gallery');
  const detailSelectors = '#J-detail-content, #detail .detail-content, #detail-main, .ssd-module-wrap';
  pageDocument.querySelectorAll(detailSelectors).forEach((root) => {
    root.querySelectorAll('img').forEach((node) => addNodeImage(node, 'detail'));
    // JD long descriptions can be CSS background slices rather than img elements.
    root.querySelectorAll('.ssd-module[style], .ssd-module [style]').forEach((node) => {
      const style = node.getAttribute('style') || '';
      for (const match of style.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) addImage(match[1], 'detail');
    });
    root.querySelectorAll('style').forEach((node) => {
      for (const rule of (node.textContent || '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/\.ssd-module/.test(rule[1]) || !/background/i.test(rule[2])) continue;
        for (const match of rule[2].matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) addImage(match[1], 'detail');
      }
    });
  });
  const detailParts = [];
  pageDocument.querySelectorAll(detailSelectors).forEach((root) => {
    const copy = root.cloneNode(true);
    copy.querySelectorAll('script, style, noscript, iframe, button').forEach((node) => node.remove());
    const text = clean(copy.textContent, 50_000);
    if (text && !detailParts.some((part) => part.includes(text))) detailParts.push(text);
  });
  const detailText = clean(unique(detailParts).join('\n'), 50_000);
  const description = clean(firstText('.itemInfo-wrap .news', '.itemInfo-wrap .p-ad') || structured.description, 20_000);
  const missingFields = [];
  if (!title) missingFields.push('商品名称');
  if (!externalId) missingFields.push('商品标识');
  if (!variantText) missingFields.push('当前规格');
  if (!priceText) missingFields.push('价格');
  if (!images.length) missingFields.push('商品图片');
  if (!parameters.length) missingFields.push('商品参数');

  return {
    platform: 'jd', captureVersion: 3, externalId, sourceUrl, capturedAt: new Date().toISOString(), title,
    brandName: brandName || undefined,
    shopName: shopName || undefined,
    description: description || undefined,
    selectedSku: selectedSkuId || variantText ? { externalId: selectedSkuId || undefined, name: variantText || selectedSkuId, variantText: variantText || undefined } : undefined,
    price: priceText ? { text: priceText, currency: 'CNY', ...(priceLabel ? { label: priceLabel } : {}) } : undefined,
    parameters, detailText: detailText || undefined, images, missingFields,
  };
}
