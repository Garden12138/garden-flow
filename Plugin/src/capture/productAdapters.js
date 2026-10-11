import { captureJdProductReviews, ensureJdReviewModal, extractJdProductPayload, extractJdReviewPreview, isJdProductUrl } from './jdProduct.js';
import { taobaoProductPageRuntime } from './taobaoProduct.js';

export function productPlatformFromUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return '';
    if (isJdProductUrl(value)) return 'jd';
    if (url.pathname !== '/item.htm' || !/^\d+$/.test(url.searchParams.get('id') || '')) return '';
    if (url.hostname === 'item.taobao.com') return 'taobao';
    if (['detail.tmall.com', 'chaoshi.detail.tmall.com'].includes(url.hostname)) return 'tmall';
  } catch { /* Not a supported desktop product page. */ }
  return '';
}

const adapters = {
  jd: { platform: 'jd', label: '京东', extract: extractJdProductPayload, extractArgs: [], ensureReviews: ensureJdReviewModal, ensureArgs: [], previewReviews: extractJdReviewPreview, previewArgs: [], captureReviews: captureJdProductReviews, captureArgs: (options) => [options] },
  taobao: { platform: 'taobao', label: '淘宝', extract: taobaoProductPageRuntime, extractArgs: ['product'], previewReviews: taobaoProductPageRuntime, previewArgs: ['preview'], captureReviews: taobaoProductPageRuntime, captureArgs: (options) => ['reviews', options] },
  tmall: { platform: 'tmall', label: '天猫', extract: taobaoProductPageRuntime, extractArgs: ['product'], previewReviews: taobaoProductPageRuntime, previewArgs: ['preview'], captureReviews: taobaoProductPageRuntime, captureArgs: (options) => ['reviews', options] },
};

export function getProductCaptureAdapter(url) {
  return adapters[productPlatformFromUrl(url)] || null;
}

export function assertExpectedProductMatches(url, expected, product = null) {
  if (expected == null) return;
  const platforms = expected?.platforms;
  const externalId = String(expected?.externalId || '');
  if (!/^\d+$/.test(externalId) || !Array.isArray(platforms) || !platforms.length || platforms.length > 3
    || platforms.some((value) => !['jd', 'taobao', 'tmall'].includes(value))) throw new Error('自动采集商品校验参数无效');
  const parsed = new URL(url);
  if (/^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password && !parsed.port) {
    if (/^(?:login|passport)\.(?:taobao|tmall)\.com$/.test(parsed.hostname)) {
      throw Object.assign(new Error('需要先在浏览器中登录，已停止商品采集'), { code: 'BROWSER_LOGIN_REQUIRED' });
    }
    if (['punish.taobao.com', 'punish.tmall.com'].includes(parsed.hostname)
      || (/\.(?:taobao|tmall)\.com$/.test(parsed.hostname) && /\/_____tmd_____\/punish/.test(parsed.pathname))) {
      throw Object.assign(new Error('商品页已跳转安全验证，已停止商品采集'), { code: 'BROWSER_SECURITY_CHALLENGE' });
    }
  }
  const platform = productPlatformFromUrl(url);
  const actualId = platform === 'jd' ? /\/(\d+)\.html$/i.exec(parsed.pathname)?.[1] : parsed.searchParams.get('id');
  if (!platforms.includes(platform) || actualId !== externalId || (product && (product.platform !== platform || String(product.externalId) !== externalId))) {
    const page = `${parsed.hostname}${parsed.pathname}`;
    const extracted = product ? `；提取商品 ${product.platform || '未识别'}:${String(product.externalId || '未识别')}` : '';
    throw Object.assign(new Error(`商品详情与搜索卡片不一致，已跳过保存（搜索商品 ${externalId}；实际页面 ${page}，商品 ${actualId || '未识别'}${extracted}）`), {
      code: 'BROWSER_PRODUCT_IDENTITY_MISMATCH',
    });
  }
}
