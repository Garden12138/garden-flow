// Search cards provide navigation evidence only. Product facts and selected SKU
// are always read again by the detail-page capture adapter.
export function marketplaceProductLink(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return null;
    if (url.pathname !== '/item.htm' || !/^\d+$/.test(url.searchParams.get('id') || '')) return null;
    const platform = url.hostname === 'item.taobao.com' ? 'taobao' : ['detail.tmall.com', 'chaoshi.detail.tmall.com'].includes(url.hostname) ? 'tmall' : '';
    if (!platform) return null;
    const id = url.searchParams.get('id');
    const skuId = url.searchParams.get('skuId');
    url.protocol = 'https:';
    // Open the link the page actually supplied. Attribution/context parameters
    // can also select a detail-page experience; strip them only for identity.
    const navigationUrl = url.href;
    url.search = '';
    url.searchParams.set('id', id);
    if (/^\d+$/.test(skuId || '')) url.searchParams.set('skuId', skuId);
    url.hash = '';
    return { id, platform, sourceUrl: url.href, navigationUrl };
  } catch { return null; }
}

export function marketplaceSurface(value) {
  try {
    const url = new URL(value);
    if (!['taobao.com', 'tmall.com'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return 'page';
    if (marketplaceProductLink(value)) return 'detail';
    if (/^\/search(?:\/|$|\.htm)/i.test(url.pathname) || url.pathname === '/search_product.htm') return 'search_results';
    return 'entry';
  } catch { return 'page'; }
}

export function extractMarketplaceSearch({ limit = 20, query = '' } = {}) {
  const currentUrl = new URL(location.href);
  const pageQuery = currentUrl.searchParams.get('q') || currentUrl.searchParams.get('search_word') || currentUrl.searchParams.get('keyword');
  if (marketplaceSurface(location.href) !== 'search_results' || (query && pageQuery && pageQuery.trim() !== query.trim())) {
    return { items: [], resultState: { status: 'loading', candidateCount: 0, interactableCount: 0 } };
  }
  const cards = new Map();
  for (const anchor of document.querySelectorAll('a[href]')) {
    const product = marketplaceProductLink(anchor.getAttribute('href'), location.href);
    if (!product || !visible(anchor)) continue;
    const root = anchor.closest('[data-item-id], [data-nid], article, li, [role="listitem"], [class*="doubleCard"], [class*="itemCard"], [class*="CardWrap"]') || anchor;
    const titleNode = [...root.querySelectorAll('[class*="title"], [class*="Title"], [class*="desc"], [class*="Desc"]')].find(visible);
    const title = clean(titleNode?.innerText || titleNode?.textContent || anchor.getAttribute('title') || anchor.querySelector('img')?.getAttribute('alt') || anchor.innerText || anchor.textContent);
    const key = `${product.platform}:${product.id}`;
    const previous = cards.get(key);
    if (!previous) cards.set(key, { ...product, title });
    else {
      if (!previous.title && title) previous.title = title;
      // A secondary image/title anchor can expose a bare URL before the main
      // card anchor. Keep the actual link with the most page-provided context.
      if (new URL(product.navigationUrl).searchParams.size > new URL(previous.navigationUrl).searchParams.size) {
        previous.sourceUrl = product.sourceUrl;
        previous.navigationUrl = product.navigationUrl;
      }
    }
  }
  const empty = /没有找到相关宝贝|没有找到相关商品|未找到相关商品/.test(String(document.body?.innerText || document.body?.textContent || ''));
  const items = [...cards.values()].slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
  return { items, resultState: { status: items.length ? 'ready' : empty ? 'empty' : 'loading', candidateCount: cards.size, interactableCount: cards.size } };
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function visible(node) {
  for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || current.hidden) return false;
  }
  const bounds = node.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}
