// Self-contained: Chrome serializes this function into MAIN, without module bindings.
export async function taobaoProductPageRuntime(action = 'product', options = {}, pageDocument = globalThis.document, pageLocation = globalThis.location) {
  const clean = (value, limit = 20_000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const text = (node) => clean(node?.innerText || node?.textContent);
  const visible = (node) => {
    for (let current = node; current && current !== pageDocument; current = current.parentElement) {
      if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') return false;
      if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(current.getAttribute?.('style') || '')) return false;
      try {
        const style = pageDocument.defaultView?.getComputedStyle?.(current);
        if (style?.display === 'none' || style?.visibility === 'hidden') return false;
      } catch { /* DOM fixtures have no computed layout. */ }
    }
    return Boolean(node);
  };
  const find = (selector, root = pageDocument) => Array.from(root.querySelectorAll(selector)).find(visible);
  const firstText = (selector, root = pageDocument, limit = 20_000) => { const node = find(selector, root); return clean(node?.innerText || node?.textContent, limit); };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const accessError = () => {
    if (url && pageLocation.href !== url.href) return 'CONTENT_NOT_ACCESSIBLE';
    const probe = text(pageDocument.body).slice(0, 8_000);
    if (/访问频繁|操作频繁|请求过于频繁|稍后再试|too many requests/i.test(probe)) return 'BROWSER_RATE_LIMITED';
    if (/安全验证|人机验证|滑块验证|访问受限|快速验证|captcha|verify you are human/i.test(probe)) return 'BROWSER_SECURITY_CHALLENGE';
    if (/请先登录|登录后查看|登录后继续|login required|sign in to continue/i.test(probe)) return 'BROWSER_LOGIN_REQUIRED';
    return '';
  };
  let url;
  try { url = new URL(pageLocation.href); } catch { return { accessErrorCode: 'CONTENT_NOT_ACCESSIBLE' }; }
  const platform = url.hostname === 'item.taobao.com' ? 'taobao' : ['detail.tmall.com', 'chaoshi.detail.tmall.com'].includes(url.hostname) ? 'tmall' : '';
  const itemId = url.searchParams.get('id') || '';
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || !platform || url.pathname !== '/item.htm' || !/^\d+$/.test(itemId)) return { accessErrorCode: 'CONTENT_NOT_ACCESSIBLE' };
  const sourceUrl = `${url.origin}/item.htm?id=${itemId}`;
  // Verified platform UI assets from local capture QA; dimensions alone are not
  // a safe filter (small seller banners can be genuine product details).
  const platformUiImage = (raw) => /\/(?:O1CN01Dqo1gd1wMhnobvRco_!!6000000006294-2-tps-145-145\.png|O1CN010DB1Un24kXOjdGhG3_!!6000000007429-0-tps-84-82\.jpg)(?:_|\?|$)/.test(String(raw || ''));
  const imageUrl = (raw) => {
    try {
      const image = new URL(clean(raw, 8_000), sourceUrl);
      if (!/^https?:$/.test(image.protocol) || image.username || image.password || image.port) return '';
      if (!/(^|\.)(alicdn\.com|taobaocdn\.com)$/.test(image.hostname)) return '';
      if (platformUiImage(image.pathname)) return '';
      return image.href;
    } catch { return ''; }
  };
  const imageSource = (node) => {
    const direct = ['data-src', 'data-ks-lazyload', 'data-lazyload', 'data-original', 'currentSrc', 'src']
      .map((key) => imageUrl(key === 'currentSrc' ? node.currentSrc : node.getAttribute(key))).find(Boolean);
    if (direct) return direct;
    // Some lazy images expose the real URL only through picture/srcset.
    const sets = [node.getAttribute('data-srcset'), node.getAttribute('srcset'),
      ...Array.from(node.closest('picture')?.querySelectorAll('source') || []).flatMap((source) => [source.getAttribute('data-srcset'), source.getAttribute('srcset')])];
    return sets.flatMap((set) => String(set || '').split(',').map((entry) => imageUrl(entry.trim().split(/\s+/)[0]))).find(Boolean) || '';
  };
  const hash = (value) => {
    let result = 2166136261;
    for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
    return (result >>> 0).toString(16);
  };
  // The desktop detail layout scrolls inside containers as well as the window.
  // Keep this bounded and restore only while still on the same accessible page.
  const pageScrollSession = (anchors) => {
    const view = pageDocument.defaultView;
    const origin = { x: view?.scrollX || 0, y: view?.scrollY || 0 };
    const positions = new Map();
    const remember = () => {
      for (const anchor of anchors()) {
        for (let node = anchor; node && node !== pageDocument; node = node.parentElement) {
          const style = view?.getComputedStyle?.(node);
          if (/(auto|scroll)/.test(style?.overflowY || node.style?.overflowY || '') && node.scrollHeight > node.clientHeight && !positions.has(node)) {
            positions.set(node, { top: node.scrollTop || 0, left: node.scrollLeft || 0 });
          }
        }
      }
    };
    remember();
    return {
      reveal(node) { remember(); node?.scrollIntoView?.({ block: 'center', behavior: 'instant' }); },
      advance() {
        remember();
        for (const node of positions.keys()) {
          if (typeof node.scrollBy === 'function') node.scrollBy({ top: 650, behavior: 'instant' });
          else { node.scrollTop = (node.scrollTop || 0) + 650; node.dispatchEvent(new (view?.Event || globalThis.Event)('scroll')); }
        }
        view?.scrollBy?.({ top: 650, behavior: 'instant' });
      },
      restore() {
        if (accessError()) return;
        for (const [node, position] of positions) {
          if (node.isConnected !== false) { node.scrollTop = position.top; node.scrollLeft = position.left; }
        }
        view?.scrollTo?.({ left: origin.x, top: origin.y, behavior: 'instant' });
      },
    };
  };

  if (action === 'product') {
    const titleSelector = '[data-role="product-title"], .tb-main-title, #J_Title h3, [class*="ItemTitle--mainTitle"], [class*="ItemTitle--title"], h1[itemprop="name"], #tbpcDetail_SkuPanelBody [class*="mainTitle--"], #tbpcDetail_SkuPanelItemhead_fixed [class*="mainTitle--"]';
    const gallerySelector = '[data-role="product-gallery"] img, #J_UlThumb img, #J_ImgBooth, [class*="PicGallery--"] img, [class*="MainPic--"] img, #picGalleryEle img';
    const detailSelector = '[data-role="product-description"], #J_DivItemDesc, #description, [class*="Detail--detailContent"], #imageTextInfo-content';
    // descV8 module names are present in the user's saved page stylesheet.
    const detailUiSelector = '.descV8-charity, .descV8-quality, .descV8-recShop, .descV8-recommend, script, style';
    const priceSelector = '[data-role="product-price"], #J_PromoPrice .tb-rmb-num, #J_PromoPrice .tm-price, [class*="Price--priceText"], [class*="Price--price--"], #J_StrPrice .tb-rmb-num, #J_StrPrice .tm-price';
    // The saved real page uses ICE loader data. Read only JSON, never execute inline scripts.
    const readPageProduct = () => {
      const select = (state) => {
        const product = state?.loaderData?.home?.data?.res;
        return String(product?.item?.itemId || '') === itemId ? product : null;
      };
      const state = pageDocument.defaultView?.__ICE_APP_CONTEXT__;
      if (state?.loaderData?.home?.data?.res?.item?.itemId) return select(state) || {};
      for (const script of pageDocument.querySelectorAll('script:not([src])')) {
        const raw = script.textContent || '';
        if (raw.length > 2_000_000 || !raw.includes('window.__ICE_APP_CONTEXT__')) continue;
        const json = raw.match(/var b\s*=\s*(\{[\s\S]*\});for\s*\(var k in a\)/)?.[1];
        if (!json) continue;
        try { const product = select(JSON.parse(json)); if (product) return product; } catch { /* Optional page state. */ }
      }
      return {};
    };
    const readPrice = () => {
      const panel = find('#tbpcDetail_SkuPanelBody');
      const highlighted = panel && find('[class*="highlightPrice--"]', panel);
      const amount = highlighted && Array.from(highlighted.querySelectorAll('[class*="text--"]')).filter(visible).map(text).join('');
      if (amount && /\d/.test(amount)) return { text: `¥${amount.replace(/^[￥¥]/, '')}`, currency: 'CNY', label: firstText('[class*="title--"]', highlighted) || '页面可见价格' };
      const value = firstText(priceSelector);
      return value && /\d/.test(value) ? { text: /^[\d.,\s]+$/.test(value) ? `¥${value}` : value, currency: 'CNY', label: firstText('[data-role="price-label"], [class*="Price--priceLabel"]') || '页面可见价格' } : undefined;
    };
    const matchesProductUrl = (value) => {
      try {
        const candidate = new URL(value, sourceUrl);
        return /^https?:$/.test(candidate.protocol) && !candidate.username && !candidate.password && !candidate.port
          && ['item.taobao.com', 'detail.tmall.com', 'chaoshi.detail.tmall.com'].includes(candidate.hostname)
          && candidate.pathname === '/item.htm' && candidate.searchParams.get('id') === itemId;
      } catch { return false; }
    };
    const readProductData = () => {
      const structured = [];
      const visit = (node, depth = 0) => {
        if (!node || typeof node !== 'object' || depth > 5) return;
        if (Array.isArray(node)) return node.slice(0, 100).forEach((child) => visit(child, depth + 1));
        if ([node['@type']].flat().includes('Product')) structured.push(node);
        visit(node['@graph'], depth + 1);
        visit(node.mainEntity, depth + 1);
      };
      for (const script of pageDocument.querySelectorAll('script[type="application/ld+json"]')) {
        try { visit(JSON.parse(script.textContent || '')); } catch { /* Optional metadata. */ }
      }
      return structured.find((product) => {
        const id = clean(product.productID);
        if (id && id !== itemId) return false;
        if (product.url && !matchesProductUrl(product.url)) return false;
        return id === itemId || Boolean(product.url);
      }) || {};
    };
    const cleanTitle = (value, metadata = false) => {
      let title = clean(value, 1_000);
      if (metadata) title = title.replace(/\s*[-_|—–]\s*(?:淘宝网?|天猫(?:\s*tmall\.com)?)(?:\s*[-_|—–].*)?$/i, '').trim();
      // Page shells and sign-in titles are not product names.
      if (/^(?:商品详情(?:页)?|宝贝详情|淘宝(?:网)?|天猫(?:\s*tmall\.com)?(?:\s*[-_|—–]+\s*上天猫[，,]?就够了[！!]?)?|淘宝网\s*[-—]\s*淘[！!]?我喜欢|上天猫[，,]?就够了[！!]?|淘宝登录|天猫登录|用户登录|登录|加载中[.。…]*|请稍候[.。…]*)$/i.test(title)) return '';
      return title;
    };
    const readVisibleTitle = () => {
      for (const node of pageDocument.querySelectorAll(titleSelector)) {
        if (!visible(node)) continue;
        const title = cleanTitle(text(node));
        if (title) return title;
      }
      // Semantic headings survive CSS module renames. Ambiguous headings are not guessed.
      const headings = [...new Set(Array.from(pageDocument.querySelectorAll('h1, [role="heading"][aria-level="1"]'))
        .filter((node) => visible(node) && !node.closest('nav, aside, footer'))
        .map((node) => cleanTitle(text(node))).filter(Boolean))];
      return headings.length === 1 ? headings[0] : '';
    };
    const readMetadataTitle = () => {
      const declaredUrls = Array.from(pageDocument.querySelectorAll('link[rel="canonical"], meta[property="og:url"]'))
        .map((node) => node.getAttribute('href') || node.getAttribute('content')).filter(Boolean);
      if (declaredUrls.some((value) => !matchesProductUrl(value))) return '';
      for (const value of [pageDocument.querySelector('meta[property="og:title"]')?.getAttribute('content'), pageDocument.title]) {
        const title = cleanTitle(value, true);
        if (title) return title;
      }
      return '';
    };
    const hasRenderedProductFacts = () => {
      if (readPrice()) return true;
      return Array.from(pageDocument.querySelectorAll(gallerySelector))
        .some((node) => visible(node) && imageUrl(node.getAttribute('data-src') || node.getAttribute('data-ks-lazyload') || node.getAttribute('data-lazyload') || node.getAttribute('src')));
    };
    let productData = {};
    let title = '';
    // Hydration may lag behind navigation. Prefer rendered facts; metadata is a bounded fallback.
    for (let attempt = 0; attempt <= 12; attempt += 1) {
      if (pageLocation.href !== url.href) return { platform, sourceUrl, pageChanged: true };
      const accessErrorCode = accessError();
      if (accessErrorCode) return { platform, sourceUrl, accessErrorCode };
      productData = readProductData();
      title = readVisibleTitle() || cleanTitle(productData.name);
      // A title can render before the price/gallery. Do not return a name-only snapshot early.
      if (title && hasRenderedProductFacts()) break;
      if (attempt === 12) { title ||= readMetadataTitle(); break; }
      await sleep(250);
    }
    const readPayload = () => {
      const pageProduct = readPageProduct();
      const parameters = [];
      const addParameter = (key, value) => {
        key = clean(key, 500).replace(/[:：]$/, '');
        value = clean(value, 4_000);
        if (key && value && parameters.length < 200 && !parameters.some((item) => item.key === key && item.value === value)) parameters.push({ key, value });
      };
      for (const node of pageDocument.querySelectorAll('#attributes li, .attributes-list li, [class*="Attribute--"] li, [data-role="product-parameter"]')) {
        const label = text(node.querySelector('[data-role="parameter-name"], dt, [class*="name"], [class*="label"]'));
        const value = text(node.querySelector('[data-role="parameter-value"], dd, [class*="value"]'));
        if (label && value) addParameter(label, value);
        else {
          const parts = text(node).split(/[:：]/);
          if (parts.length > 1) addParameter(parts.shift(), parts.join('：'));
        }
      }
      for (const item of Array.isArray(productData.additionalProperty) ? productData.additionalProperty : []) addParameter(item?.name, item?.value);
      for (const node of pageDocument.querySelectorAll('.paramsInfoArea [class*="emphasisParamsInfoItem--"]')) {
        // Highlight cards put the value above the label, unlike the general parameter table.
        addParameter(firstText('[class*="emphasisParamsInfoItemSubTitle--"]', node), firstText('[class*="emphasisParamsInfoItemTitle--"]', node));
      }
      for (const node of pageDocument.querySelectorAll('.paramsInfoArea [class*="generalParamsInfoItem--"]')) {
        addParameter(firstText('[class*="generalParamsInfoItemTitle--"]', node), firstText('[class*="generalParamsInfoItemSubTitle--"]', node));
      }
      const skuRoot = find('#skuOptionsArea') || find('[data-role="product-skus"], #J_isku, [class*="SkuContent--"], [class*="skuContent--"]');
      const selectedSelector = '[aria-checked="true"], .tb-selected, .tm-selected, [class*="--selected"], [class*="--isSelected"], [class*="isSelected--"]';
      const groups = skuRoot?.id === 'skuOptionsArea' ? Array.from(skuRoot.querySelectorAll('[class*="skuItem--"]')).filter(visible) : [];
      const props = Array.isArray(pageProduct.skuBase?.props) ? pageProduct.skuBase.props : [];
      const selectedNodes = (scope) => Array.from(scope.querySelectorAll(selectedSelector)).filter((node) => visible(node) && node.getAttribute('data-disabled') !== 'true');
      const matchedProp = (group, node) => {
        const label = firstText('[class*="ItemLabel--"]', group);
        const vid = node.getAttribute('data-vid');
        const matches = props.filter((prop) => clean(prop.name) === label && Array.isArray(prop.values) && prop.values.some((value) => String(value.vid) === vid));
        return matches.length === 1 ? matches[0] : undefined;
      };
      let skuId = clean(skuRoot?.getAttribute('data-sku-id') || skuRoot?.querySelector('input[name="skuId"]')?.value, 500);
      let incompleteSelection = false;
      if (groups.length) {
        const selectedPairs = [];
        for (const group of groups) {
          const selected = selectedNodes(group);
          if (selected.length !== 1) { incompleteSelection = true; continue; }
          const prop = matchedProp(group, selected[0]);
          if (prop) selectedPairs.push(`${prop.pid}:${selected[0].getAttribute('data-vid')}`);
        }
        // Bind a SKU id only when every selected property matches one identity-bound SKU.
        skuId = '';
        if (!incompleteSelection && selectedPairs.length === groups.length && props.length === groups.length) {
          const skus = (Array.isArray(pageProduct.skuBase?.skus) ? pageProduct.skuBase.skus : []).filter((sku) => {
            const pairs = String(sku.propPath || '').split(';');
            return pairs.length === selectedPairs.length && selectedPairs.every((pair) => pairs.includes(pair));
          });
          if (skus.length === 1 && /^\d+$/.test(String(skus[0].skuId))) skuId = String(skus[0].skuId);
        }
      }
      const malformedText = (value) => value.includes('\uFFFD') || Array.from(value).some((char) => {
        const code = char.codePointAt(0); return code >= 0xD800 && code <= 0xDFFF;
      });
      let unreadableVariant = false;
      const variantParts = [];
      for (const node of skuRoot ? selectedNodes(skuRoot) : []) {
        const label = find('[class*="valueItemText--"]', node) || node;
        const candidates = [label.getAttribute('title'), label.getAttribute('aria-label'), text(label)].map((value) => clean(value, 1_000));
        let value = candidates.find((candidate) => candidate && !malformedText(candidate));
        // Recover only the exact selected property of an identity-checked SKU.
        // A malformed title must not override valid rendered text, nor be guessed away.
        if (!value && skuId && groups.length) {
          const group = groups.find((item) => item.contains(node));
          const prop = group && matchedProp(group, node);
          const values = prop?.values.filter((item) => String(item.vid) === node.getAttribute('data-vid')) || [];
          const name = values.length === 1 ? clean(values[0].name, 1_000) : '';
          if (name && !malformedText(name)) value = name;
        }
        if (!value && candidates.some(malformedText)) unreadableVariant = true;
        if (value && !variantParts.includes(value)) variantParts.push(value);
      }
      const variantText = variantParts.join('；');
      const price = readPrice();
      const images = [];
      const seenImages = new Set();
      const addImage = (raw, role) => {
        const source = imageUrl(raw);
        // AliCDN resize/quality suffixes refer to the same original image.
        const key = source.replace(/(\.(?:jpe?g|png|gif|webp))(?:_[^/?]*)?(?:\?.*)?$/i, '$1').replace(/^https?:\/\/[^/]+\//, '/');
        if (!source || seenImages.has(key) || images.length >= 24) return;
        seenImages.add(key);
        images.push({ sourceUrl: source, role: images.length === 0 && role === 'gallery' ? 'primary' : role, origin: 'capture' });
      };
      const collectImages = (selector, role) => {
        for (const node of pageDocument.querySelectorAll(selector)) {
          if (role === 'detail' && node.closest(detailUiSelector)) continue;
          addImage(imageSource(node), role);
        }
      };
      for (const source of Array.isArray(pageProduct.item?.images) ? pageProduct.item.images.slice(0, 24) : []) addImage(source, 'gallery');
      collectImages(gallerySelector, 'gallery');
      collectImages(detailSelector.split(',').map((selector) => `${selector.trim()} img`).join(', '), 'detail');
      const detail = find(detailSelector)?.cloneNode(true);
      detail?.querySelectorAll(detailUiSelector).forEach((node) => node.remove());
      // A section heading by itself is UI, not a product description. Do not
      // strip these words from real seller prose or infer prose from image text.
      const descriptionText = (value) => /^(?:店铺活动|商品详情|图文详情)$/.test(clean(value)) ? '' : clean(value);
      const detailText = descriptionText(text(detail)) || descriptionText(productData.description);
      return {
        captureVersion: 3, platform, externalId: itemId, sourceUrl, capturedAt: new Date().toISOString(), title,
        brandName: parameters.find((item) => /^(品牌|brand)$/i.test(item.key))?.value || clean(typeof productData.brand === 'string' ? productData.brand : productData.brand?.name, 1_000) || undefined,
        shopName: firstText('[data-role="shop-name"], .tb-shop-name a, .slogo-shopname, [class*="ShopHeader--shopName"], [class*="ShopInfo--shopName"], [class*="shopHeader--"] [class*="shopName--"]') || undefined,
        selectedSku: variantText ? { name: variantText, variantText, externalId: skuId || undefined } : undefined,
        price, parameters, detailText: detailText || undefined, description: detailText, images,
        missingFields: [!title && '商品名称', !variantText && '当前规格', unreadableVariant && '当前规格文字异常，请核对原页面', incompleteSelection && '完整规格', !price && '当前价格', !parameters.length && '商品参数', !images.length && '商品图片', !detailText && !images.some((item) => item.role === 'detail') && '商品详情'].filter(Boolean),
      };
    };
    let payload = readPayload();
    if (options.hydrateSections !== true || !title) return payload;
    const parameterSelector = '.paramsInfoArea, #attributes, .attributes-list, [class*="Attribute--"], [data-role="product-parameter"]';
    const scroll = pageScrollSession(() => [find(titleSelector), find(gallerySelector), find(parameterSelector), find(detailSelector)].filter(Boolean));
    const revealed = new Set();
    const complete = () => payload.price && payload.parameters.length && payload.images.length
      && (payload.detailText || payload.images.some((image) => image.role === 'detail'));
    try {
      // Saving gets a separate six-second lazy-section budget. A gallery alone
      // must not certify that price, parameters and details finished loading.
      for (let round = 0; round < 12 && !complete(); round += 1) {
        if (pageLocation.href !== url.href) return { platform, sourceUrl, pageChanged: true };
        if (accessError()) break;
        for (const selector of [parameterSelector, detailSelector]) {
          const node = find(selector);
          if (node && !revealed.has(node)) { scroll.reveal(node); revealed.add(node); }
          if (accessError()) break;
        }
        if (accessError()) break;
        scroll.advance();
        await sleep(500);
        if (pageLocation.href !== url.href) return { platform, sourceUrl, pageChanged: true };
        if (accessError()) break;
        productData = readProductData();
        title = readVisibleTitle() || cleanTitle(productData.name) || title;
        payload = readPayload();
      }
      return payload;
    } finally { scroll.restore(); }
  }

  const reviewRowSelector = '[data-review-id], .rate-grid tr, .tm-rate-fulltxt, [class*="Rate--rateItem"], [class*="CommentItem--"], [class*="commentItem--"], [class*="Comment--"]';
  const filterSelector = '[data-review-filter], [role="tab"], [class*="filter"] button, [class*="tag--"], [class*="Tag--"], [class*="imprItem--"]';
  const reviewRegionSelector = '[data-role="product-reviews"], #J_Reviews, #reviews, [class*="Rate--rateList"], [class*="Rate--rateContent"], [class*="Comments--"], [class*="RateModal--"], [class*="CommentList--"]';
  const fullListEntry = (scope = pageDocument, includeHidden = false) => Array.from(scope.querySelectorAll('button, a, [role="button"], [class*="ShowButton--"]'))
    .find((node) => (includeHidden || visible(node)) && /^(查看)?全部(?:评价|评论)(?:\s*[>›»→])?$/.test(text(node)));
  const replySelector = '[data-role="merchant-reply"], .tm-rate-reply, [class*="--reply"], [class*="reply--"]';
  const appendSelector = '[data-role="review-append"], .tm-rate-append, [class*="append--"], [class*="appendContent--"]';
  const contentSelector = '[data-role="review-text"], [data-role="review-append"], .tm-rate-content, .tb-r-act-bar + .content, [class*="--reviewContent"], [class*="--content"], [class*="contentWrapper--"] [class*="content--"], [class*="append--"] [class*="content--"], [class*="appendContent--"]';
  const reviewContent = (node) => {
    const contents = Array.from(node.querySelectorAll(contentSelector)).filter((content) => visible(content) && !content.closest(replySelector));
    const parts = contents.filter((content) => !contents.some((other) => other !== content && other.contains(content))).map((content) => {
      const copy = content.cloneNode(true);
      copy.querySelectorAll(replySelector).forEach((reply) => reply.remove());
      // Preserve every buyer section, including appended reviews, and keep replies separate.
      const body = clean(content.getAttribute('title') || copy.textContent, Infinity);
      return body && content.closest(appendSelector) ? `追评：${body}` : body;
    }).filter(Boolean);
    return [...new Set(parts)].join('\n')
      || (node.matches('.tm-rate-fulltxt') ? clean(node.innerText || node.textContent, Infinity) : '');
  };
  const reviewImages = (node) => Array.from(node.querySelectorAll('[data-role="review-images"] img, .tm-m-photos img, [class*="--images"] img, [class*="--photo"] img, [class*="images--"] img, [class*="photo--"] img')).filter((image) => visible(image) && !image.closest(replySelector));
  const pendingImage = (image) => !imageSource(image) && (platformUiImage(image.getAttribute('src'))
    || image.getAttribute('aria-busy') === 'true' || image.classList.contains('lazyload')
    || !image.getAttribute('src') || /^(data:|blob:)/.test(image.getAttribute('src')));
  const readableRows = (scope = root) => scope ? Array.from(scope.querySelectorAll(reviewRowSelector)).filter((node) => visible(node)
    && !node.parentElement?.closest('[data-review-id], .rate-grid tr, [class*="Rate--rateItem"], [class*="CommentItem--"], [class*="commentItem--"], [class*="Comment--"]') && reviewContent(node)) : [];
  // An already open dialog can be temporarily empty while loading. Keep it as
  // the review scope instead of clicking the inline entry again and toggling it.
  const reviewDialog = () => Array.from(pageDocument.querySelectorAll('[role="dialog"], [class*="RateModal--"]'))
    .find((node) => visible(node) && (readableRows(node).length || node.matches('[class*="RateModal--"]')
      || node.querySelector(`${reviewRegionSelector}, [data-role="review-scroll"]`)));
  const reviewBusy = (scope) => Boolean(scope && (scope.getAttribute('aria-busy') === 'true'
    || find('[aria-busy="true"], [data-role="review-loading"], [role="progressbar"]', scope)));
  const reviewRoot = () => reviewDialog()
    || Array.from(pageDocument.querySelectorAll(reviewRegionSelector)).find((node) => visible(node) && !fullListEntry(node, true) && readableRows(node).length)
    || find(reviewRegionSelector);
  const serializeReview = (node) => {
    const reviewText = reviewContent(node);
    const authorName = firstText('[data-role="review-author"], .tm-rate-user-info, [class*="--userName"], [class*="--nick"], [class*="userName--"]', node);
    const metadata = firstText('[data-role="review-date"], .tm-rate-date, [class*="--date"], [class*="meta--"]', node);
    const purchase = metadata.match(/^((?:\d{4}年\d{1,2}月\d{1,2}日|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s*已购\s*[:：]\s*(.+)$/);
    const dateText = purchase?.[1] || metadata;
    const skuText = firstText('[data-role="review-sku"], .tm-rate-sku, [class*="--sku"]', node) || purchase?.[2];
    const id = clean(node.getAttribute('data-review-id') || node.getAttribute('data-id') || hash(`${authorName}|${dateText}|${skuText}|${reviewText}`), 500);
    const imageSourceUrls = [...new Set(reviewImages(node).map(imageSource).filter(Boolean))].slice(0, 9);
    const replies = Array.from(node.querySelectorAll(replySelector)).filter(visible);
    const merchantReply = replies.filter((reply) => !replies.some((other) => other !== reply && other.contains(reply))).map((reply) => clean(reply.innerText || reply.textContent, Infinity)).filter(Boolean).join('\n');
    return { id, platformReviewId: node.getAttribute('data-review-id') || undefined, authorName: authorName || undefined, text: reviewText, merchantReply: merchantReply || undefined, dateText: dateText || undefined, skuText: skuText || undefined, matchedFilterIds: [], imageSourceUrls };
  };
  let root = reviewRoot();
  let discoveryScroll;
  try {
    // Inline reviews and their full-list entry can mount only after scrolling.
    // Preview stays quick; saving retries discovery before declaring it absent.
    const needsReviewDiscovery = () => !reviewDialog() && !readableRows(reviewRoot()).length && !fullListEntry();
    if (action === 'reviews' && needsReviewDiscovery() && !accessError()) {
      discoveryScroll = pageScrollSession(() => Array.from(pageDocument.querySelectorAll('#picGalleryEle, [data-role="product-gallery"], #tbpcDetail_SkuPanelBody, #imageTextInfo-content, #J_DivItemDesc')).filter(visible));
      for (let round = 0; round < 12 && needsReviewDiscovery() && !accessError(); round += 1) {
        discoveryScroll.advance();
        await sleep(500);
        if (!accessError()) root = reviewRoot();
      }
    }
    const initialRoot = root;
    const refreshReviewRoot = () => {
      const candidate = reviewRoot();
      // A loading/virtualized dialog can temporarily be empty. Do not switch back
      // to the detail page's inline excerpt while that full list is refreshing.
      if (candidate && (!fullListEntry(candidate, true) || fullListEntry(root, true))) root = candidate;
    };
    // Snapshot before opening: a verification overlay can remove the inline rows.
    const initialReviews = accessError() ? [] : readableRows().slice(0, 50).map(serializeReview);
    let fullListUnavailable = false;
    const openingWarning = '“查看全部评价”未加载出可读取的完整列表，仅保留已读取的评论，请展开全部评价后重试';
    const existingDialog = reviewDialog();
    const entry = existingDialog ? null : fullListEntry(root || pageDocument) || (!root ? fullListEntry() : null);
    if ((entry || existingDialog) && !accessError()) {
      const rowIdentity = (nodes) => nodes.map((node) => serializeReview(node).id).join('|');
      const beforeRows = rowIdentity(readableRows());
      const open = () => {
        entry?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
        if (!accessError()) entry?.click();
      };
      if (entry) open();
      fullListUnavailable = true;
      // One retry is allowed only if the entry stayed idle: no dialog, busy state
      // or expanded signal. The whole opening attempt still has a six-second limit.
      for (let attempt = 0; attempt <= 24 && !accessError(); attempt += 1) {
        const candidate = reviewRoot();
        const candidateRows = readableRows(candidate);
        if (!reviewBusy(candidate) && candidateRows.length && (reviewDialog() || candidate !== initialRoot || rowIdentity(candidateRows) !== beforeRows)) {
          root = candidate; fullListUnavailable = false; break;
        }
        if (attempt === 12 && entry?.isConnected !== false && visible(entry) && !reviewDialog()
          && !reviewBusy(candidate) && entry.getAttribute('aria-expanded') !== 'true'
          && entry.getAttribute('aria-disabled') !== 'true' && !entry.disabled) open();
        if (attempt < 24) await sleep(250);
      }
    }
    const warnings = [];
    const readableReviewCount = readableRows().length;
    const filterNodes = () => root ? Array.from(root.querySelectorAll(filterSelector)).filter(visible) : [];
    const filterActive = (node) => Boolean(node && (['aria-selected', 'aria-checked', 'aria-pressed'].some((key) => node.getAttribute(key) === 'true')
      || ['active', 'selected', 'checked'].includes(node.getAttribute('data-state'))
      || Array.from(node.classList).some((name) => /^(?:(?:is)?(?:active|selected)|(?:imprItem|tag|filter)(?:Active|Selected))(?:--[\w-]+)?$/i.test(name))));
    const readFilters = () => filterNodes().map((node, index) => {
      const copy = node.cloneNode(true);
      const countText = firstText('[class*="imprItemCount--"]', node);
      copy.querySelectorAll('[class*="imprItemCount--"]').forEach((count) => count.remove());
      const label = text(copy).slice(0, 100);
      return { id: clean(node.getAttribute('data-review-filter') || node.getAttribute('data-id') || `tag-${hash(label)}`, 500), label, countText: countText || undefined, node, index };
    }).filter((filter) => filter.label);
    const availableFilters = readFilters().map(({ id, label, countText }) => ({ id, label, countText }));
    // Only exact integer badges are totals. "99+", "1万" and absent badges
    // cannot prove that a sampling range has been exhausted.
    const availableCount = (id) => {
      const count = readFilters().find((filter) => filter.id === id)?.countText;
      return /^\d{1,9}$/.test(count || '') ? Number(count) : undefined;
    };
    // A synthetic current-list scope is explicit, and never a guessed sentiment category.
    // Only advertise a current list in preview when actual review text was read.
    // Saving can still retry an initially empty list using the bounded scrolling below.
    if (root && (readableReviewCount > 0 || action === 'reviews')) availableFilters.unshift({ id: 'current', label: '当前评价列表' });
    const result = { modalDetected: Boolean(root), readableReviewCount, status: root ? readableReviewCount && !fullListUnavailable ? 'ready' : 'partial' : 'not-opened', availableFilters, selectedFilters: [], results: [], reviews: [], warnings, sortText: root ? firstText('[aria-selected="true"], [data-role="review-sort"]', root) : undefined, scopeText: '当前商品' };
    const defaultLimit = Number.isFinite(Number(options.limitPerFilter)) ? Math.max(1, Math.min(50, Math.trunc(Number(options.limitPerFilter)))) : 5;
    const ids = [...new Set((Array.isArray(options.selectedFilterIds) ? options.selectedFilterIds : []).map(String))];
    const labels = Array.isArray(options.selectedFilterLabels) ? options.selectedFilterLabels.map(String) : [];
    const selectedIds = ids.length ? ids : labels.length ? labels.map((label) => availableFilters.find((filter) => filter.label === label)?.id || `missing-${hash(label)}`) : ['current'];
    const requestedLabel = (id) => {
      if (id === 'current') return '当前评价列表';
      const mapped = Object.prototype.hasOwnProperty.call(options.filterLabels || {}, id) ? clean(options.filterLabels[id], 100) : '';
      // Older side panels sent names in a different order from IDs. Match hashed
      // labels by identity; never zip these independent arrays by position.
      return mapped || labels.find((label) => `tag-${hash(label)}` === id || `missing-${hash(label)}` === id) || id;
    };
    const limitFor = (filterId) => Number.isFinite(Number(options.filterLimits?.[filterId])) ? Math.max(1, Math.min(50, Math.trunc(Number(options.filterLimits[filterId])))) : defaultLimit;
    const blocked = accessError();
    if (blocked) {
      result.accessErrorCode = blocked; result.status = 'partial'; warnings.push('检测到登录、安全验证或访问限制，已停止评论采集');
      // Never assign pre-click inline reviews to an unvisited topic tag.
      if (selectedIds.includes('current')) result.reviews = initialReviews.slice(0, limitFor('current')).map((review) => ({ ...review, matchedFilterIds: ['current'] }));
      result.readableReviewCount = result.reviews.length;
      for (const id of selectedIds.slice(0, 50)) {
        const label = availableFilters.find((filter) => filter.id === id)?.label || requestedLabel(id);
        result.selectedFilters.push({ id, label, limit: limitFor(id) });
        result.results.push({ filterId: id, label, requested: limitFor(id), captured: id === 'current' ? result.reviews.length : 0, status: 'partial', warning: '访问受限，评论未完成' });
      }
      return result;
    }
    if (!root) { warnings.push(fullListUnavailable ? openingWarning : '未识别到可读取的评价区域；这不代表商品没有评论'); return result; }
    if (action === 'preview') {
      if (fullListUnavailable) warnings.push(openingWarning);
      if (!readableReviewCount) warnings.push('已找到评价区域，但未读取到评论正文；这不代表商品没有评论');
      return result;
    }
    const seen = new Map();
    // Slots survive virtualization and tag changes. A shorter later row must not
    // erase a previously observed missing image, nor a placeholder erase a URL.
    const mediaSlots = new Map();
    const hasMissingImages = (id) => Array.from(mediaSlots.get(id)?.values() || []).some((slot) => slot.pending);
    const readReviews = (filterId, limit) => {
      const reviews = fullListUnavailable && filterId === 'current'
        ? initialReviews.map((review) => ({ review }))
        : readableRows().map((node) => ({ review: serializeReview(node), node }));
      let added = 0;
      for (const { review, node } of reviews) {
        const previous = seen.get(review.id);
        const full = Array.from(seen.values()).filter((review) => review.matchedFilterIds.includes(filterId)).length >= limit;
        if (!previous && full) continue;
        const slots = mediaSlots.get(review.id) || new Map();
        if (node) reviewImages(node).slice(0, 9).forEach((image, index) => {
          const source = imageSource(image) || slots.get(index)?.source;
          slots.set(index, { source, pending: !source && (pendingImage(image) || slots.get(index)?.pending) });
        });
        mediaSlots.set(review.id, slots);
        if (previous) {
          previous.imageSourceUrls = [...new Set([...previous.imageSourceUrls, ...review.imageSourceUrls])].slice(0, 9);
          if (!full && !previous.matchedFilterIds.includes(filterId)) previous.matchedFilterIds.push(filterId);
          continue;
        }
        seen.set(review.id, { ...review, matchedFilterIds: [filterId] }); added += 1;
      }
      return added;
    };
    const reviewScrollRoot = () => {
      // Scroll the list's actual overflow container, which can wrap the row list.
      for (let node = readableRows()[0]?.parentElement; node && root.contains(node); node = node.parentElement) {
        const style = pageDocument.defaultView?.getComputedStyle?.(node);
        if (/(auto|scroll)/.test(style?.overflowY || '') && node.scrollHeight > node.clientHeight) return node;
        if (node === root) break;
      }
      return find('[data-role="review-scroll"], [class*="--scroll"], [class*="--list"], [class*="comments--"], [class*="scrollContainer--"], [class*="scrollArea--"]', root) || root;
    };
    const originalFilterId = readFilters().find((filter) => filterActive(filter.node))?.id;
    const pageWindow = pageDocument.defaultView || globalThis.window;
    const originalY = pageWindow?.scrollY || 0;
    const originalScrollRoot = reviewScrollRoot();
    const originalScrollTop = originalScrollRoot.scrollTop;
    const mediaScrollPositions = new Map();
    let totalImageWaits = 0;
    const baseWarnings = new Map();
    const interruptedFilters = new Set();
    const stopForAccess = () => {
      const code = pageLocation.href !== url.href ? 'CONTENT_NOT_ACCESSIBLE' : accessError();
      if (!code) return false;
      result.accessErrorCode = code;
      warnings.push(pageLocation.href !== url.href ? '商品页面已变化，已停止评论采集' : '检测到登录、安全验证或访问限制，已停止评论采集');
      return true;
    };
    const loadReviewImages = async (filterId, limit, budget) => {
      // Bring each selected thumbnail into view to trigger IntersectionObserver /
      // native lazy loading. Retry each slot at most twice; 15s per tag, 30s total.
      while (!fullListUnavailable && budget.waits < 60 && totalImageWaits < 120) {
        if (stopForAccess()) return;
        const targets = readableRows().flatMap((row) => {
          const id = serializeReview(row).id;
          if (!seen.get(id)?.matchedFilterIds.includes(filterId)) return [];
          return reviewImages(row).slice(0, 9).flatMap((image, index) => {
            const key = `${id}:${index}`; const attempts = budget.attempts.get(key) || 0;
            return mediaSlots.get(id)?.get(index)?.pending && attempts < 2 ? [{ id, index, image, key, attempts }] : [];
          });
        }).sort((left, right) => left.attempts - right.attempts);
        const target = targets[0];
        if (!target) return;
        budget.attempts.set(target.key, target.attempts + 1);
        // Keep vertical and horizontal scroll positions for normal completion.
        for (let node = target.image.parentElement; node; node = node.parentElement) {
          if (!mediaScrollPositions.has(node)) mediaScrollPositions.set(node, { top: node.scrollTop, left: node.scrollLeft });
        }
        target.image.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'instant' });
        if (stopForAccess()) return;
        refreshReviewRoot(); readReviews(filterId, limit);
        for (let tick = 0; tick < 8 && budget.waits < 60 && totalImageWaits < 120; tick += 1) {
          if (!mediaSlots.get(target.id)?.get(target.index)?.pending) break;
          // Reacquire by review identity after every scroll/render. A recycled row
          // must never attach another buyer's photo to the original review.
          if (!readableRows().some((row) => serializeReview(row).id === target.id)) break;
          budget.waits += 1; totalImageWaits += 1; await sleep(250);
          if (stopForAccess()) return;
          refreshReviewRoot(); readReviews(filterId, limit);
        }
      }
    };
    try {
      for (const filterId of selectedIds.slice(0, 50)) {
        const limit = limitFor(filterId);
        const filter = availableFilters.find((item) => item.id === filterId);
        const label = filter?.label || requestedLabel(filterId);
        result.selectedFilters.push({ id: filterId, label, limit });
        if (accessError()) { result.accessErrorCode = accessError(); warnings.push('检测到登录、安全验证或访问限制，已停止评论采集'); break; }
        if (!filter) { warnings.push(`页面没有提供评价标签：${label}`); result.results.push({ filterId, label, requested: limit, captured: 0, status: 'missing', warning: '页面没有提供此评价标签' }); continue; }
        if (filterId !== 'current') {
          const target = readFilters().find((item) => item.id === filterId)?.node;
          if (!target) { result.results.push({ filterId, label, requested: limit, captured: 0, status: 'missing', warning: '评价标签已变化，请重新预览' }); continue; }
          const wasActive = filterActive(target);
          if (availableCount(filterId) === 0 && !fullListUnavailable && !reviewBusy(root)
            && (!wasActive || !readableRows().length)) {
            result.results.push({ filterId, label, requested: limit, captured: 0, availableCount: 0, status: 'complete' });
            continue;
          }
          const beforeNodes = readableRows();
          const rowFingerprint = (nodes) => nodes.map((node) => {
            const review = serializeReview(node);
            return JSON.stringify([review.id, review.text, review.authorName, review.dateText, review.skuText]);
          }).join('|');
          const before = rowFingerprint(beforeNodes);
          // Clicking a selected tab can be a no-op or toggle its state. Read it
          // directly, while still waiting if the current list is busy/empty.
          if (!wasActive) target.click();
          let changed = wasActive;
          for (let attempt = 0; attempt < 8; attempt += 1) {
            if (accessError()) break;
            if (wasActive && !reviewBusy(root) && readableRows().length) break;
            await sleep(Math.max(400, Math.min(5_000, Number(options.interactionDelayMs) || 800)));
            refreshReviewRoot();
            if (accessError()) break;
            const currentRows = readableRows();
            // Ignore tag styling and image hydration: neither proves the review
            // list switched. Replaced rows may legitimately have identical text.
            changed = wasActive || rowFingerprint(currentRows) !== before
              || (beforeNodes.length > 0 && currentRows.length > 0 && beforeNodes.every((node) => !currentRows.includes(node)));
            if (changed && !reviewBusy(root) && currentRows.length) break;
          }
          if ((!changed || reviewBusy(root) || !readableRows().length) && !accessError()) {
            result.results.push({ filterId, label, requested: limit, captured: 0, status: 'partial', warning: '标签切换后评价未更新，已停止读取该标签' }); continue;
          }
          if (changed && (reviewDialog() || root !== initialRoot || !fullListEntry(root))) fullListUnavailable = false;
        }
        let idleRounds = 0;
        const imageBudget = { waits: 0, attempts: new Map() };
        const maxRounds = Math.max(1, Math.min(6, Math.trunc(Number(options.maxScrollRounds) || 6)));
        for (let round = 0; round <= maxRounds; round += 1) {
          const code = accessError();
          if (code) { result.accessErrorCode = code; warnings.push('检测到登录、安全验证或访问限制，已停止评论采集'); break; }
          const added = readReviews(filterId, limit);
          idleRounds = added ? 0 : idleRounds + 1;
          await loadReviewImages(filterId, limit, imageBudget);
          if (result.accessErrorCode) break;
          const count = Array.from(seen.values()).filter((review) => review.matchedFilterIds.includes(filterId)).length;
          if (count >= limit || idleRounds >= 2 || round === maxRounds || fullListUnavailable) break;
          const scrollRoot = reviewScrollRoot();
          if (typeof scrollRoot.scrollBy === 'function') scrollRoot.scrollBy(0, 500);
          else { scrollRoot.scrollTop = (scrollRoot.scrollTop || 0) + 500; scrollRoot.dispatchEvent(new (pageDocument.defaultView?.Event || globalThis.Event)('scroll')); }
          await sleep(Math.max(400, Math.min(5_000, Number(options.scrollDelayMs) || 1_000)));
          if (!accessError()) refreshReviewRoot();
        }
        const captured = Array.from(seen.values()).filter((review) => review.matchedFilterIds.includes(filterId)).length;
        const count = availableCount(filterId);
        const exhausted = captured > 0 && captured === count && !reviewBusy(root);
        const warning = fullListUnavailable ? openingWarning : captured < limit && !exhausted ? '可见评论不足或已达到安全读取上限' : undefined;
        baseWarnings.set(filterId, warning);
        if (result.accessErrorCode) interruptedFilters.add(filterId);
        result.results.push({ filterId, label, requested: limit, captured, availableCount: count, status: !result.accessErrorCode && !warning ? 'complete' : 'partial', warning });
        if (result.accessErrorCode) break;
      }
    } finally {
      if (!result.accessErrorCode) {
        try {
          const originalFilter = readFilters().find((filter) => filter.id === originalFilterId)?.node;
          if (originalFilter && !filterActive(originalFilter)) originalFilter.click();
          for (const [node, position] of mediaScrollPositions) {
            if (node.isConnected !== false) { node.scrollTop = position.top; node.scrollLeft = position.left; }
          }
          originalScrollRoot.scrollTop = originalScrollTop; pageWindow?.scrollTo?.(0, originalY);
        } catch { /* Best effort restoration. */ }
      }
    }
    result.reviews = Array.from(seen.values());
    result.readableReviewCount = result.reviews.length;
    // A shared review can finish loading on a later tag. Recompute earlier image
    // warnings from final slot state, while retaining body-count / access failures.
    for (const item of result.results) {
      if (!baseWarnings.has(item.filterId)) continue;
      const missing = result.reviews.filter((review) => review.matchedFilterIds.includes(item.filterId) && hasMissingImages(review.id)).length;
      item.warning = [baseWarnings.get(item.filterId), missing && `${missing} 条评论的图片经滚动加载和有限重试仍未就绪，已忽略占位图并保留正文`].filter(Boolean).join('；') || undefined;
      item.status = item.warning || interruptedFilters.has(item.filterId) ? 'partial' : 'complete';
    }
    for (const item of result.results) if (item.warning) warnings.push(`${item.label}：${item.warning}`);
    if (fullListUnavailable && !warnings.some((warning) => warning.includes(openingWarning))) warnings.push(openingWarning);
    result.status = !result.accessErrorCode && result.results.every((item) => item.status === 'complete') ? 'complete' : 'partial';
    return result;
  } finally { discoveryScroll?.restore(); }
}
