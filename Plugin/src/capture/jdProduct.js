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
    platform: 'jd', captureVersion: 2, externalId, sourceUrl, capturedAt: new Date().toISOString(), title,
    brandName: brandName || undefined,
    shopName: shopName || undefined,
    description: description || undefined,
    selectedSku: selectedSkuId || variantText ? { externalId: selectedSkuId || undefined, name: variantText || selectedSkuId, variantText: variantText || undefined } : undefined,
    price: priceText ? { text: priceText, currency: 'CNY', ...(priceLabel ? { label: priceLabel } : {}) } : undefined,
    parameters, detailText: detailText || undefined, images, missingFields,
  };
}
