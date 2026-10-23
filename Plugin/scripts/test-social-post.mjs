import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { annotateDouyinSearchCards, buildSocialPostEntry, extractSocialPost } from '../src/capture/socialPost.js';
import { extractSiteResearch, prepareSiteResearchItemClick, prepareSiteResearchItemClose, submitSiteResearchSearch } from '../src/content/siteResearchExtractor.js';
import { listSiteCapabilities, normalizeResearchRequest, runSiteResearch } from '../src/background/siteResearchRuntime.js';
import { closeSiteResearchItem, openSiteResearchItem } from '../src/background/siteResearchNavigation.js';
import { dispatchKeyboardPress } from '../src/background/pixelInput.js';

const ID = '1234567890123456789';

function namedFunction(source, name, context) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing function ${name}`);
  const declarationStart = source.slice(start - 6, start) === 'async ' ? start - 6 : start;
  const nextFunction = /\n(?:async )?function /g;
  nextFunction.lastIndex = start + 1;
  const end = nextFunction.exec(source)?.index;
  return vm.runInNewContext(`(${source.slice(declarationStart, end).trim()})`, context);
}

test('URL inspection, page observer and sidebar agree on video and gallery forms', async () => {
  const background = await readFile(new URL('../src/background.js', import.meta.url), 'utf8');
  const observer = await readFile(new URL('../src/pageObserver.js', import.meta.url), 'utf8');
  const sidebar = await readFile(new URL('../src/sidepanel.js', import.meta.url), 'utf8');
  for (const site of ['douyin', 'tiktok']) for (const form of ['video', 'image']) {
    const href = site === 'douyin' ? `https://www.douyin.com/${form === 'image' ? 'note' : 'video'}/${ID}` : `https://www.tiktok.com/@demo/${form === 'image' ? 'photo' : 'video'}/${ID}`;
    const { window, document } = parseHTML('<html><body><h1>Own post</h1></body></html>');
    const context = { window, document, location: new URL(href), URL, productPlatformFromUrl: () => '', normalizeText: value => String(value || '').trim() };
    const fromUrl = namedFunction(background, 'detectCaptureTargetFromUrl', context)(href);
    const fromObserver = namedFunction(observer, 'detectPageInfo', context)();
    for (const info of [fromUrl, fromObserver]) {
      assert.equal(info.kind, `${site}-${form}`);
      const config = namedFunction(sidebar, 'getCaptureActionConfig', { normalizePlatform: () => site, inferPageType: () => form })({ tab: { url: href }, pageInfo: info });
      assert.equal(config.actions[0].label, form === 'image' ? '保存图集' : '保存视频');
    }
  }
});

test('Douyin modal gallery detection scopes its own slides despite an inline video', async () => {
  const background = await readFile(new URL('../src/background.js', import.meta.url), 'utf8');
  const observer = await readFile(new URL('../src/pageObserver.js', import.meta.url), 'utf8');
  const { window, document } = parseHTML(`<html><body><div class="search-result-card"><video></video></div><div class="video_${ID}"><div class="dySwiperSlide"><img></div></div></body></html>`);
  window.Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 200 });
  window.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  const context = { window, document, location: new URL(`https://www.douyin.com/search/garden?modal_id=${ID}`), URL, Element: window.Element, normalizeText: value => String(value || '').trim(), isNodeVisible: () => true };
  assert.equal(namedFunction(background, 'detectCaptureTarget', context)().kind, 'douyin-image');
  assert.equal(namedFunction(observer, 'detectPageInfo', context)().kind, 'douyin-image');
});

test('Browser Enter includes the printable event required by search keypress handlers', async () => {
  const events = [];
  const previous = globalThis.chrome;
  globalThis.chrome = {
    tabs: { get: async () => ({ id: 1, windowId: 1, active: true }), update: async () => {} },
    windows: { update: async () => {}, get: async () => ({ type: 'normal' }) },
    debugger: { attach: async () => {}, sendCommand: async (_target, method, event) => { assert.equal(method, 'Input.dispatchKeyEvent'); events.push(event); } },
  };
  try {
    await dispatchKeyboardPress({ tabId: 1, key: 'Enter' });
    assert.deepEqual(events.map(event => event.type), ['rawKeyDown', 'char', 'keyUp']);
    assert.equal(events[1].text, '\r');
    assert.equal(events[0].windowsVirtualKeyCode, 13);
    events.length = 0;
    await dispatchKeyboardPress({ tabId: 1, key: 'Enter', keys: ['Control'] });
    assert.deepEqual(events.map(event => event.type), ['rawKeyDown', 'keyUp']);
    events.length = 0;
    await dispatchKeyboardPress({ tabId: 1, key: 'Escape' });
    assert.equal(events[0].windowsVirtualKeyCode, 27);
  } finally { globalThis.chrome = previous; }
});

async function extract(platform, form, options = {}, override = '', configure, hrefOverride) {
  const html = override || await readFile(new URL(`fixtures/social-posts/${platform}-${form}.synthetic.html`, import.meta.url), 'utf8');
  const { window } = parseHTML(html);
  window.Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 200, top: 0, left: 0, bottom: 200, right: 300 });
  const href = hrefOverride || (platform === 'douyin' ? `https://www.douyin.com/${form === 'image' ? 'note' : 'video'}/${ID}` : `https://www.tiktok.com/@demo/${form === 'image' ? 'photo' : 'video'}/${ID}`);
  const onWait = configure?.(window);
  const context = { window, document: window.document, location: new URL(href), URL, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), setTimeout: (callback) => { onWait?.(); callback(); return 1; } };
  return await vm.runInNewContext(`(${extractSocialPost.toString()})`, context)(platform, options);
}

test('an unexpected page state error returns a diagnostic instead of an empty injection result', async () => {
  let page;
  try {
    const post = await extract('tiktok', 'video', { commentLimit: 0 }, '', window => {
      page = window;
      window.__INITIAL_STATE__ = new Proxy({}, { ownKeys() { throw new Error('state getter failed'); } });
    });
    assert.equal(post.accessErrorCode, 'CAPTURE_EXTRACTION_FAILED');
    assert.match(post.message, /state getter failed/);
  } finally { if (page) delete page.__INITIAL_STATE__; }
});

for (const outcome of ['saved', 'empty', 'changed']) {
  test(`an empty navigation injection retries once with the pinned identity: ${outcome}`, async () => {
    const source = await readFile(new URL('../src/background.js', import.meta.url), 'utf8');
    const own = await extract('tiktok', 'video', { commentLimit: 0 });
    const expectedContent = { platform: 'tiktok', externalId: ID };
    let reads = 0;
    let writes = 0;
    const save = namedFunction(source, 'saveSocialPostFromTab', {
      readPluginSettings: async () => ({ socialCommentLimit: 5 }),
      extractSocialPost, buildSocialPostEntry,
      runExtraction: async (tabId, _func, options) => {
        assert.equal(tabId, 8);
        assert.equal(options.args[1].commentLimit, 0);
        assert.deepEqual(options.args[1].expectedContent, expectedContent);
        reads += 1;
        if (reads === 1 || outcome === 'empty') return undefined;
        return outcome === 'changed' ? { accessErrorCode: 'CONTENT_IDENTITY_MISMATCH', message: 'post changed' } : own;
      },
      safePageOrigin: () => 'https://www.tiktok.com',
      postKnowledgeEntry: async (_entry, spaceId) => {
        writes += 1;
        assert.equal(spaceId, 'original-space');
        return { entryId: `tiktok_${ID}` };
      },
    });
    const operation = save(8, 'tiktok', { captureSpaceId: 'original-space', commentLimit: 0, expectedContent });
    if (outcome === 'saved') assert.equal((await operation).noteId, `tiktok_${ID}`);
    else await assert.rejects(operation, outcome === 'changed' ? /post changed/ : /未识别/);
    assert.equal(reads, 2);
    assert.equal(writes, outcome === 'saved' ? 1 : 0);
  });
}

test('Exact post metadata survives partial state projections while retaining its media', async () => {
  const projections = [{ id: ID, desc: 'Own caption', video: { playAddr: 'https://media.example/own.mp4' } }, { id: ID, authorInfo: { nickname: 'Own author' }, createTime: 1780531200 }, { id: '9999999999999999999', author: { nickname: 'Recommendation' }, createTime: 1 }];
  const post = await extract('douyin', 'video', { commentLimit: 0 }, `<html><body><p data-e2e="video-desc">Own caption</p><script type="application/json">${JSON.stringify(projections)}</script></body></html>`);
  assert.equal(post.author, 'Own author');
  assert.equal(post.publishedAt, new Date(1780531200 * 1000).toISOString());
  assert.equal(post.videoUrl, 'https://media.example/own.mp4');
  assert.equal(post.capture.status, 'complete');
});

test('TikTok prefers its current post playback URL over the state CDN and ignores preloaded neighbors', async () => {
  const state = { id: ID, desc: 'Own caption', video: { playAddr: 'https://media.example/state.mp4' } };
  const playing = `https://www.tiktok.com/aweme/v1/play/?item_id=${ID}&file_id=own`;
  const html = `<html><body><script type="application/json">${JSON.stringify(state)}</script><main id="main-content-video_detail"><article id="one-column-item-0"><p data-e2e="video-desc">Own caption</p><video src="${playing}"></video></article><article id="one-column-item-1"><video src="https://media.example/neighbor.mp4"></video></article></main></body></html>`;
  const post = await extract('tiktok', 'video', { commentLimit: 0 }, html);
  assert.equal(post.videoUrl, playing);
});

test('TikTok does not prefer a playback endpoint belonging to another post', async () => {
  const state = { id: ID, desc: 'Own caption', video: { playAddr: 'https://media.example/own.mp4' } };
  const html = `<html><body><script type="application/json">${JSON.stringify(state)}</script><article><p data-e2e="video-desc">Own caption</p><video src="https://www.tiktok.com/aweme/v1/play/?item_id=9999999999999999999"></video></article></body></html>`;
  const post = await extract('tiktok', 'video', { commentLimit: 0 }, html);
  assert.equal(post.videoUrl, 'https://media.example/own.mp4');
});

test('TikTok retains its remote state URL when the current player uses a blob', async () => {
  const state = { id: ID, desc: 'Own caption', video: { playAddr: 'https://media.example/own.mp4' } };
  const html = `<html><body><script type="application/json">${JSON.stringify(state)}</script><article><p data-e2e="video-desc">Own caption</p><video src="blob:https://www.tiktok.com/player"></video></article></body></html>`;
  const post = await extract('tiktok', 'video', { commentLimit: 0 }, html);
  assert.equal(post.videoUrl, 'https://media.example/own.mp4');
});

test('TikTok blob playback keeps bounded download and bitrate URLs from exact-ID state projections', async () => {
  const playing = `https://www.tiktok.com/aweme/v1/play/?item_id=${ID}`;
  const wrong = 'https://www.tiktok.com/aweme/v1/play/?item_id=9999999999999999999';
  const states = [
    { id: ID, desc: 'Own caption', video: { playAddr: 'https://media.example/cdn.mp4', downloadAddr: 'https://media.example/download.mp4' } },
    { id: ID, video: { bitrateInfo: [{ PlayAddr: { UrlList: [playing, playing, wrong, 'https://media.example/extra.mp4'] } }] } },
    { id: '9999999999999999999', video: { downloadAddr: 'https://media.example/neighbor.mp4' } },
  ];
  const html = `<html><body><script type="application/json">${JSON.stringify(states)}</script><article><p data-e2e="video-desc">Own caption</p><video src="blob:https://www.tiktok.com/player"></video></article></body></html>`;
  const post = await extract('tiktok', 'video', { commentLimit: 0 }, html);
  assert.equal(post.videoUrl, playing);
  assert.deepEqual(Array.from(post.videoUrls), [playing, 'https://media.example/download.mp4', 'https://media.example/extra.mp4']);
  assert.deepEqual(Array.from(buildSocialPostEntry(post).assets.videoUrls), Array.from(post.videoUrls));
});

test('Douyin modal nickname and avatar belong to the active work, and missing publication time remains partial', async () => {
  const html = `<html><body><div class="search-result-card"><div class="video_${ID}"><p data-e2e="video-desc">Inline</p><a href="/user/wrong">Wrong</a></div></div><div class="video_${ID}"><p data-e2e="video-desc">Own caption</p><a data-e2e="video-avatar" href="/user/own"></a><div data-e2e="feed-video-nickname">@森林北</div><video src="https://media.example/own.mp4"></video></div></body></html>`;
  const post = await extract('douyin', 'video', { commentLimit: 0 }, html, undefined, `https://www.douyin.com/search/garden?modal_id=${ID}`);
  assert.equal(post.author, '森林北');
  assert.equal(post.authorProfileUrl, 'https://www.douyin.com/user/own');
  assert.equal(post.capture.media, 'complete');
  assert.equal(post.capture.status, 'partial');
  assert.ok(post.capture.errors.includes('未获取到作品发布时间'));
});

test('Missing author is reported even when media and comments are available', async () => {
  const state = { id: ID, desc: 'Own caption', createTime: 1780531200, video: { playAddr: 'https://media.example/own.mp4' } };
  const post = await extract('tiktok', 'video', { commentLimit: 0 }, `<html><body><p data-e2e="video-desc">Own caption</p><script type="application/json">${JSON.stringify(state)}</script></body></html>`);
  assert.equal(post.capture.media, 'complete');
  assert.equal(post.capture.comments, 'skipped');
  assert.equal(post.capture.status, 'partial');
  assert.ok(post.capture.errors.includes('未获取到作品作者'));
});

test('Douyin comment authors skip avatars and exclude the author badge and nested reply author', async () => {
  const row = (id, name, text, avatar, reply = '') => `<div data-e2e="comment-item"><div>${avatar ? '<a href="/user/avatar"><img></a>' : ''}<div class="comment-item-info-wrap"><a href="/user/${id}"><span data-click-from="title">${name}</span><span>作者</span></a><div data-e2e="video-comment-more"><span id="tooltip_${id}"></span></div></div><div>${text}</div><div>2周前</div></div>${reply}</div>`;
  const html = `<html><body><p data-e2e="video-desc">Own post</p><section data-e2e="comment-list">${row('first', '福哥', 'Question', true, row('reply', '园主', 'Answer', true))}</section></body></html>`;
  const post = await extract('douyin', 'video', { commentLimit: 2 }, html);
  assert.deepEqual(Array.from(post.comments, comment => comment.author), ['福哥', '园主']);
  assert.equal(post.comments[0].authorProfileUrl, 'https://www.douyin.com/user/first');
  assert.equal(post.comments[1].parentCommentId, 'first');
});

test('TikTok photo captions retain titles and use only matching active-slide caption text', async () => {
  const state = { id: ID, desc: '#garden', author: { nickname: 'Owner' }, createTime: 1780531200, imagePost: { images: [{ imageURL: 'https://media.example/own.jpg' }] } };
  const html = `<html><body><script type="application/json">${JSON.stringify(state)}</script><main id="main-content-video_detail"><article><p data-e2e="video-desc">#garden</p><img alt="10 Likes. image posted on : “Let Granda show you the garden. #garden ”"></article><article><img alt="1 Likes. image posted on : “Unrelated #garden ”"></article></main></body></html>`;
  const post = await extract('tiktok', 'image', { commentLimit: 0 }, html);
  assert.equal(post.text, 'Let Granda show you the garden. #garden');
  state.imagePost.title = 'Garden title';
  const titled = await extract('tiktok', 'image', { commentLimit: 0 }, `<html><body><script type="application/json">${JSON.stringify(state)}</script></body></html>`);
  assert.equal(titled.text, 'Garden title\n#garden');
});

test('tiktok: waits for a delayed comment portal and opens only the active article', async () => {
  const state = JSON.stringify({ id: ID, desc: 'Current post', video: { playAddr: 'https://media.example/video.mp4' }, stats: { commentCount: 5 } });
  let wrongClicks = 0;
  const result = await extract('tiktok', 'video', {}, `<html><body><script type="application/json">${state}</script><main id="main-content-video_detail"><article id="one-column-item-0"><div data-e2e="video-desc">Current post</div><div data-e2e="comment-icon" role="button"><button>Comments</button>5</div></article><article id="one-column-item-1"><button data-e2e="comment-icon">99</button></article></main></body></html>`, (window) => {
    let waits = 0;
    window.document.querySelector('#one-column-item-1 button').addEventListener('click', () => { wrongClicks += 1; });
    window.document.querySelector('#one-column-item-0 button').addEventListener('click', () => {
      const portal = window.document.createElement('div');
      portal.className = 'DivCommentListContainer';
      window.document.body.append(portal);
    });
    return () => {
      waits += 1;
      const portal = window.document.querySelector('.DivCommentListContainer');
      if (waits === 16 && portal) {
        const hydrated = window.document.createElement('div');
        hydrated.className = 'DivCommentListContainer';
        hydrated.innerHTML = Array.from({ length: 5 }, (_, i) => `<div data-e2e="comment-item" data-comment-id="late-${i}"><p data-e2e="comment-content">Delayed comment ${i}</p></div>`).join('');
        portal.replaceWith(hydrated);
      }
    };
  });
  assert.equal(wrongClicks, 0);
  assert.equal(result.comments.length, 5);
  assert.equal(result.capture.comments, 'complete');
});

test('douyin: reads current comment rows without treating likes or reply controls as comments', async () => {
  const row = (id, name, text, child = '') => `<div data-e2e="comment-item"><div><div class="comment-item-info-wrap"><a href="/user/${id}">${name}</a><div data-e2e="video-comment-more"><div id="tooltip_${id}">...</div></div></div><div><span>${text}</span></div><div>2周前·广东</div><div class="comment-item-stats-container"><p><span>17</span></p><p>回复</p></div></div>${child}</div>`;
  const state = JSON.stringify({ id: ID, desc: 'Post', statistics: { comment_count: 2 }, video: { play_addr: { url_list: ['https://media.example/video.mp4'] } } });
  const result = await extract('douyin', 'video', { commentLimit: 5 }, `<html><body><script type="application/json">${state}</script><section data-e2e="comment-list">${row('111', '读者', '正文不是点赞数', row('222', '作者', '回复正文'))}</section></body></html>`);
  assert.equal(result.comments.length, 2);
  assert.deepEqual(Array.from(result.comments, comment => comment.text), ['正文不是点赞数', '回复正文']);
  assert.equal(result.comments[0].id, '111');
  assert.equal(result.comments[0].likes, 17);
  assert.equal(result.comments[1].parentCommentId, '111');
});

for (const platform of ['douyin', 'tiktok']) {
  test(`${platform}: locks hydration to the requested video instead of a recommendation`, async () => {
    const post = await extract(platform, 'video', { commentLimit: 0 });
    assert.equal(post.externalId, ID);
    assert.equal(post.videoUrl, 'https://media.example/video.mp4');
    assert.equal(post.capture.comments, 'skipped');
    assert.equal(post.capture.status, 'complete');
    assert.equal(buildSocialPostEntry(post).kind, `${platform}-video`);
  });
  test(`${platform}: keeps gallery order and one URL per photo`, async () => {
    const post = await extract(platform, 'image', { commentLimit: 0 });
    assert.equal(post.contentType, 'image_text');
    assert.deepEqual([...post.imageUrls], ['https://media.example/first.jpg', 'https://media.example/second.jpg']);
    assert.equal(post.videoUrl, '');
    assert.equal(buildSocialPostEntry(post).kind, `${platform}-image`);
  });
  test(`${platform}: defaults to five comments and preserves explicit reply identity`, async () => {
    const comments = Array.from({ length: 8 }, (_, i) => `<div data-e2e="comment-item" data-comment-id="c${i}" ${i ? 'data-parent-comment-id="c0"' : ''}><a href="/@reader">读者 Reader</a><p data-e2e="comment-content">评论 ${i}</p><time>2026-10-20</time></div>`).join('');
    const script = JSON.stringify({ item: { id: ID, desc: 'A post', video: { playAddr: 'https://media.example/video.mp4', cover: 'https://media.example/cover.jpg' }, stats: { commentCount: 8 } } });
    const post = await extract(platform, 'video', {}, `<html><body><script type="application/json">${script}</script><section data-e2e="comment-list">${comments}</section></body></html>`);
    assert.equal(post.comments.length, 5);
    assert.equal(post.comments[1].parentCommentId, 'c0');
    assert.equal(post.comments[1].author, '读者 Reader');
    assert.equal(post.capture.comments, 'complete');
  });
  test(`${platform}: inaccessible media and comments remain a partial content capture`, async () => {
    const post = await extract(platform, 'video', {}, `<html><body><script type="application/json">${JSON.stringify({ id: ID, desc: '文案可读', stats: { commentCount: 30 } })}</script></body></html>`);
    assert.equal(post.text, '文案可读');
    assert.equal(post.capture.status, 'partial');
    assert.equal(post.capture.media, 'partial');
    assert.equal(post.capture.comments, 'partial');
  });
  test(`${platform}: refuses a changed active post and reports security blockers`, async () => {
    const changed = await extract(platform, 'video', { expectedContent: { platform, externalId: '9999999999999999999' } });
    assert.equal(changed.accessErrorCode, 'CONTENT_IDENTITY_MISMATCH');
    const blocked = await extract(platform, 'video', {}, '<html><body><div id="captcha">Verify</div></body></html>');
    assert.equal(blocked.accessErrorCode, 'BROWSER_SECURITY_CHALLENGE');
    const limited = await extract(platform, 'video', {}, '<html><body>Too many requests</body></html>');
    assert.equal(limited.accessErrorCode, 'BROWSER_RATE_LIMITED');
  });
  for (const message of ['Too many requests', '操作频繁，请稍后再试']) {
    test(`${platform}: a late rate limit (${message}) preserves sampled comments and stops scrolling`, async () => {
      const fixture = await readFile(new URL(`fixtures/social-posts/${platform}-video.synthetic.html`, import.meta.url), 'utf8');
      const html = fixture.replace(/("(?:commentCount|comment_count)"\s*:\s*)0/g, '$120').replace('</body>', '<p data-e2e="video-desc">Own caption</p><div data-e2e="comment-list"><div data-e2e="comment-item" data-comment-id="own-comment"><a href="/@reader">Reader</a><p data-e2e="comment-content">Already sampled</p><time>2026-10-20</time></div></div></body>');
      let waits = 0;
      const post = await extract(platform, 'video', { commentLimit: 5 }, html, (window) => {
        const list = window.document.querySelector('[data-e2e="comment-list"]');
        Object.defineProperties(list, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
        return () => {
          waits += 1;
          const warning = window.document.createElement('p');
          warning.textContent = message;
          window.document.body.appendChild(warning);
        };
      });
      assert.equal(post.capture.blocker, 'BROWSER_RATE_LIMITED');
      assert.equal(post.capture.status, 'partial');
      assert.equal(post.capture.comments, 'partial');
      assert.deepEqual(Array.from(post.comments, (comment) => comment.id), ['own-comment']);
      assert.equal(waits, 1);
    });
  }
}

test('TikTok advertises only implemented search and content scans', () => {
  const capability = listSiteCapabilities().find((item) => item.id === 'tiktok');
  assert.deepEqual(capability.operations, ['search', 'content_scan']);
  assert.equal(normalizeResearchRequest({ site: 'tt', operation: 'search', query: 'garden' }).site.id, 'tiktok');
  assert.throws(() => normalizeResearchRequest({ site: 'tiktok', operation: 'author_scan', url: 'https://www.tiktok.com/@demo' }), /does not support/);
  assert.throws(() => normalizeResearchRequest({ site: 'tiktok', operation: 'content_scan', url: 'https://tiktok.com.evil.example/@demo/video/1' }), /does not belong/);
});

function installResearchDom(html, url) {
  const { window, document } = parseHTML(html);
  window.innerWidth = 1200; window.innerHeight = 800;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  document.elementFromPoint = () => document.querySelector('[data-gardenflow-open-id]') || document.querySelector('[data-gardenflow-content-id], a[href*="/photo/"], [data-e2e="browse-close"]');
  Object.assign(globalThis, { window, document, location: new URL(url), getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto' }) });
  return { window, document };
}

test('Douyin MAIN annotation bridges typed identity for cards without anchor URLs', async () => {
  const { document } = installResearchDom('<html><body><div class="search-result-card"><p>花园图集</p></div></body></html>', 'https://www.douyin.com/jingxuan/search/garden');
  const card = document.querySelector('.search-result-card');
  card.__reactProps$fixture = { children: { props: { aweme: { aweme_id: ID, aweme_type: 68, desc: '花园图集', images: [{}], related: [{ aweme_id: '9999999999999999999', desc: '推荐作品', video: {} }] } } } };
  annotateDouyinSearchCards();
  assert.equal(card.getAttribute('data-gardenflow-content-id'), ID);
  const result = extractSiteResearch({ site: 'douyin', operation: 'search', detailOpenMode: 'page_click' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceUrl, `https://www.douyin.com/note/${ID}`);
  assert.equal(result.items[0].interactionRef.site, 'douyin');
  const click = await prepareSiteResearchItemClick({ site: 'douyin', detailOpenMode: 'page_click', item: result.items[0] });
  assert.equal(click.success, true);
  assert.equal(click.itemId, ID);
  // A recycled virtual card loses the stale identity when its props change.
  card.__reactProps$fixture = { children: null };
  annotateDouyinSearchCards();
  assert.equal(card.getAttribute('data-gardenflow-content-id'), null);
});

test('Douyin cards bind to their own media ID and scroll the caption into view before clicking', async () => {
  const { document } = installResearchDom(`<html><body><div class="search-result-card"><p>Own garden</p><div class="video_${ID}"></div></div></body></html>`, 'https://www.douyin.com/jingxuan/search/garden');
  const card = document.querySelector('.search-result-card');
  const caption = card.querySelector('p');
  let scrolled = false;
  caption.getBoundingClientRect = () => ({ left: 0, top: scrolled ? 0 : 900, right: 320, bottom: scrolled ? 180 : 1080, width: 320, height: 180 });
  caption.scrollIntoView = () => { scrolled = true; };
  document.elementFromPoint = () => caption;
  card.__reactProps$fixture = { related: { aweme_id: '9999999999999999999', desc: 'Recommendation', video: {} }, own: { aweme_id: ID, desc: 'Own garden', video: {} } };
  annotateDouyinSearchCards();
  assert.equal(card.getAttribute('data-gardenflow-content-id'), ID);
  assert.equal(caption.getAttribute('data-gardenflow-open-id'), ID);
  const clicked = await prepareSiteResearchItemClick({ site: 'douyin', detailOpenMode: 'page_click', item: { id: ID, sourceUrl: `https://www.douyin.com/video/${ID}`, interactionRef: { kind: 'site_card', site: 'douyin', itemId: ID } } });
  assert.equal(clicked.success, true);
  assert.equal(scrolled, true);
});

test('TikTok photo cards and close controls use the same typed page-click contract', async () => {
  installResearchDom(`<html><body><article><a href="https://www.tiktok.com/@demo/photo/${ID}"><span>Garden photos</span></a></article></body></html>`, 'https://www.tiktok.com/search?q=garden');
  const result = extractSiteResearch({ site: 'tiktok', operation: 'search', detailOpenMode: 'page_click' });
  assert.equal(result.items[0].id, ID);
  assert.equal((await prepareSiteResearchItemClick({ site: 'tiktok', detailOpenMode: 'page_click', item: result.items[0] })).success, true);
  document.body.insertAdjacentHTML('beforeend', '<button data-e2e="browse-close">Close</button>');
  document.elementFromPoint = () => document.querySelector('[data-e2e="browse-close"]');
  assert.equal((await prepareSiteResearchItemClose({ site: 'tiktok', detailOpenMode: 'page_click' })).success, true);
});

test('TikTok mixed search results preserve page order when the first card is a gallery', () => {
  installResearchDom(`<html><body><article><a href="https://www.tiktok.com/@demo/photo/${ID}">First gallery</a></article><article><a href="https://www.tiktok.com/@demo/video/2234567890123456789">Second video</a></article></body></html>`, 'https://www.tiktok.com/search?q=garden');
  const result = extractSiteResearch({ site: 'tiktok', operation: 'search', detailOpenMode: 'page_click', limit: 1 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, ID);
  assert.equal(result.items[0].interactionRef.rank, 0);
  assert.match(result.items[0].sourceUrl, /\/photo\//);
});

test('Social search never extracts homepage recommendations and Douyin inline players remain results', () => {
  const card = `<div data-gardenflow-content-id="${ID}" data-gardenflow-content-type="video"><p data-e2e="video-desc">Inline player</p></div>`;
  installResearchDom(`<html><body>${card}</body></html>`, 'https://www.douyin.com/jingxuan');
  assert.equal(extractSiteResearch({ site: 'douyin', operation: 'search', detailOpenMode: 'page_click' }).reason, 'search_results_unavailable');
  location = new URL('https://www.douyin.com/jingxuan/search/garden');
  const result = extractSiteResearch({ site: 'douyin', operation: 'search', detailOpenMode: 'page_click' });
  assert.equal(result.pageState.surface, 'search_results');
  assert.equal(result.items.length, 1);
});

test('Social keyword search waits for the SPA search route before reading cards', async () => {
  let ticks = 0;
  let reads = 0;
  const result = await runSiteResearch({ site: 'douyin', operation: 'search', query: 'garden', depth: 'preview', limit: 1, maxScrolls: 0, snapshot: false }, {
    createControlledTab: async () => ({ tab: { id: 1, url: 'https://www.douyin.com/jingxuan' } }),
    getTab: async () => ({ id: 1, url: ticks >= 3 ? 'https://www.douyin.com/jingxuan/search/garden' : 'https://www.douyin.com/jingxuan' }),
    claimTab: async () => {}, waitForTabComplete: async () => {}, submitSearch: async () => ({ success: true }),
    delay: async () => { ticks += 1; }, readSnapshot: async () => ({}),
    readSiteEvidence: async () => {
      reads += 1;
      assert.ok(ticks >= 3);
      return { success: true, pageState: { surface: 'search_results' }, items: [{ id: ID, sourceUrl: `https://www.douyin.com/video/${ID}`, interactionRef: { kind: 'site_card', site: 'douyin', itemId: ID } }] };
    },
  });
  assert.equal(result.success, true);
  assert.ok(reads > 0);
});

test('Closing a social search detail cannot treat a homepage fallback as restored', async () => {
  const result = await closeSiteResearchItem({ operation: 'search', closeTimeoutMs: 500, openState: { sourceTabId: 1, targetTabId: 1, openedIn: 'same_tab_route', sourceUrlBefore: 'https://www.douyin.com/jingxuan/search/garden' } }, {
    getTab: async () => ({ id: 1, url: 'https://www.douyin.com/jingxuan' }),
    readSiteEvidence: async () => ({ success: true, pageState: { surface: 'entry' } }),
    pressEscape: async () => {}, delay: async () => {},
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'item_close_failed');
});

test('Douyin virtual result cards remount at their recorded scroll position before opening', async () => {
  const { document } = installResearchDom(`<html><body><div class="search-result-card" data-gardenflow-content-id="${ID}" data-gardenflow-content-type="video"><p data-gardenflow-open-id="${ID}">Garden</p></div></body></html>`, 'https://www.douyin.com/search/garden');
  let top = 1200;
  const card = document.querySelector('.search-result-card');
  Object.defineProperty(document, 'scrollingElement', { value: {
    get scrollTop() { return top; },
    set scrollTop(value) { top = value; if (value === 1200 && !card.isConnected) document.body.append(card); },
    scrollLeft: 0,
  } });
  const item = extractSiteResearch({ site: 'douyin', operation: 'search', detailOpenMode: 'page_click' }).items[0];
  assert.equal(item.interactionRef.scrollState.top, 1200);
  card.remove(); top = 5000;
  const result = await prepareSiteResearchItemClick({ site: 'douyin', detailOpenMode: 'page_click', item });
  assert.equal(result.success, true);
  assert.equal(result.itemId, ID);
  assert.equal(top, 1200);
});

test('Closing an overlay uses Escape before history can leave the search results', async () => {
  let overlay = true;
  let backs = 0;
  const sourceUrl = 'https://www.douyin.com/search/garden';
  const result = await closeSiteResearchItem({ site: 'douyin', operation: 'search', openState: { sourceTabId: 1, targetTabId: 1, openedIn: 'same_tab_overlay', sourceUrlBefore: sourceUrl } }, {
    getTab: async () => ({ id: 1, url: sourceUrl + (overlay ? `?modal_id=${ID}` : '') }),
    readSiteEvidence: async () => ({ success: true, pageState: { surface: overlay ? 'overlay' : 'search_results' } }),
    pressEscape: async () => { overlay = false; },
    goBack: async () => { backs += 1; }, delay: async () => {},
  });
  assert.equal(result.success, true);
  assert.equal(result.method, 'escape');
  assert.equal(backs, 0);
});

test('Opening a social card waits past stale routes and classifies modal routes as overlays', async () => {
  for (const site of ['douyin', 'tiktok']) {
    const source = `https://www.${site}.com/search?q=garden`;
    const target = site === 'douyin' ? `${source}&modal_id=${ID}` : `https://www.tiktok.com/@demo/photo/${ID}`;
    let clicked = false;
    let waited = false;
    const result = await openSiteResearchItem({ site, tabId: 1, item: { id: ID } }, {
      getTab: async () => ({ id: 1, url: clicked ? waited ? target : `https://www.${site}.com/${site === 'douyin' ? 'video' : '@demo/video'}/9999999999999999999` : source }),
      listTabs: async () => [],
      prepareItemClick: async () => ({ success: true, itemId: ID, observedUrl: target, clickPoint: { x: 10, y: 10 } }),
      clickPoint: async () => { clicked = true; }, delay: async () => { waited = true; },
      readSiteEvidence: async () => ({ success: true, content: {}, pageState: { surface: 'detail' } }),
    });
    assert.equal(waited, true);
    assert.equal(result.success, true);
    assert.equal(result.sourceUrl, target);
    assert.equal(result.openedIn, site === 'douyin' ? 'same_tab_overlay' : 'same_tab_route');
  }
});

test('An unrelated child tab is closed instead of being accepted as the selected post', async () => {
  let clicked = false;
  let closed;
  const source = { id: 1, url: 'https://www.tiktok.com/search?q=garden' };
  const wrong = { id: 2, openerTabId: 1, url: 'https://www.tiktok.com/@demo/video/9999999999999999999' };
  const result = await openSiteResearchItem({ site: 'tiktok', tabId: 1, item: { id: ID } }, {
    getTab: async id => id === 1 ? source : wrong,
    listTabs: async () => clicked ? [source, wrong] : [source],
    prepareItemClick: async () => ({ success: true, itemId: ID, clickPoint: { x: 10, y: 10 } }),
    clickPoint: async () => { clicked = true; }, closeNewTab: async id => { closed = id; },
    readSiteEvidence: async () => ({}),
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'item_identity_mismatch');
  assert.equal(closed, 2);
});

test('TikTok opens the collapsed search panel before searching', async () => {
  const { window, document } = installResearchDom('<html><body><button data-e2e="nav-search">Search</button><input data-e2e="search-user-input" placeholder="Search" type="search"><button data-e2e="search-box-button">Search</button></body></html>', 'https://www.tiktok.com/');
  let opened = false;
  const input = document.querySelector('input');
  input.getBoundingClientRect = () => ({ left: 0, top: 0, right: opened ? 320 : 0, bottom: 40, width: opened ? 320 : 0, height: 40 });
  document.querySelector('[data-e2e="nav-search"]').addEventListener('click', () => { setTimeout(() => { opened = true; }, 650); });
  Object.assign(globalThis, { Node: window.Node, Element: window.Element, PointerEvent: window.Event, Event: window.Event, MouseEvent: window.MouseEvent || window.Event, InputEvent: window.InputEvent || window.Event, KeyboardEvent: window.KeyboardEvent || window.Event, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement });
  document.elementFromPoint = () => document.querySelector('[data-e2e="nav-search"]');
  const result = await submitSiteResearchSearch({ site: 'tiktok', query: 'garden' });
  assert.equal(opened, true);
  assert.equal(result.success, true);
  assert.equal(input.value, 'garden');
  document.querySelector('[data-e2e="search-box-button"]').remove();
  const native = await submitSiteResearchSearch({ site: 'tiktok', query: 'garden', nativeSearchSubmit: true });
  assert.equal(native.requiresNativeEnter, true);
  assert.equal(native.submitted, false);
});

test('TikTok DOM photo fallback excludes Swiper clones, keeps slide order and marks missing slots partial', async () => {
  const html = '<html><body><article><p data-e2e="video-desc">Garden photos</p><div class="swiper-wrapper"><div class="swiper-slide swiper-slide-duplicate" data-swiper-slide-index="1"><img src="https://media.example/last.jpg"></div><div class="swiper-slide" data-swiper-slide-index="0"><img src="https://media.example/first.jpg"></div><div class="swiper-slide" data-swiper-slide-index="1"><img src="https://media.example/last.jpg"></div><div class="swiper-slide" data-swiper-slide-index="2"><img></div></div></article></body></html>';
  const post = await extract('tiktok', 'image', { commentLimit: 0 }, html);
  assert.deepEqual([...post.imageUrls], ['https://media.example/first.jpg', 'https://media.example/last.jpg', '']);
  assert.equal(post.capture.status, 'partial');
});

test('TikTok current comment markup reads author and text from the same item container', async () => {
  const html = '<html><body><script type="application/json">'+JSON.stringify({id:ID,desc:'Garden',video:{playAddr:'https://media.example/video.mp4',cover:'https://media.example/cover.jpg'},stats:{commentCount:1}})+'</script><div class="DivCommentListContainer"><div class="DivCommentItemWrapper"><a data-e2e="comment-username-1" href="/@reader">Reader</a><span data-e2e="comment-level-1"><span>My dream garden</span></span><span data-e2e="comment-time-1">1 day ago</span></div></div></body></html>';
  const post = await extract('tiktok', 'video', {commentLimit:5}, html);
  assert.equal(post.comments[0].text, 'My dream garden');
  assert.equal(post.comments[0].author, 'Reader');
  assert.equal(post.capture.comments, 'complete');
});

test('Douyin note-detail captures only ordered player slides and its caption', async () => {
  const html = '<html><body><main data-e2e="note-detail"><div data-e2e="player-container"><div class="dySwiperSlide"><img src="https://media.example/one.webp"><img src="https://media.example/one.webp"></div><div class="dySwiperSlide"><img src="https://media.example/two.webp"><img src="https://media.example/two.webp"></div></div><div><span>自家花园 <span><a href="/hashtag/11">#花园</a></span></span></div><a href="/user/demo">园主</a><span>发布时间：2026-05-18 10:58:49</span><div data-e2e="feed-comment-icon">抢首评</div><aside><img src="https://media.example/recommendation.webp"></aside></main></body></html>';
  const post = await extract('douyin', 'image', { commentLimit: 5 }, html);
  assert.deepEqual([...post.imageUrls], ['https://media.example/one.webp', 'https://media.example/two.webp']);
  assert.equal(post.text, '自家花园 #花园');
  assert.equal(post.author, '园主');
  assert.equal(post.publishedAt, '2026-05-18 10:58:49');
  assert.equal(post.stats.comments, 0);
  assert.equal(post.capture.status, 'complete');
});

test('Douyin author skips empty navigation and avatar links', async () => {
  const html = '<html><body><main data-e2e="note-detail"><nav><a href="/user/self"><img alt="登录用户头像"></a></nav><a href="/user/demo"><img alt="园主头像"></a><a href="/user/demo">园主</a><div><span>自家花园 <span><a href="/hashtag/11">#花园</a></span></span></div><div data-e2e="player-container"><div class="dySwiperSlide"><img src="https://media.example/one.webp"></div></div></main></body></html>';
  const post = await extract('douyin', 'image', { commentLimit: 0 }, html);
  assert.equal(post.author, '园主');
  assert.equal(post.authorProfileUrl, 'https://www.douyin.com/user/demo');
});

test('Douyin exact video identity scopes its full detail and prefers the post author over commenters', async () => {
  const html = `<html><body><div data-e2e="video-detail"><div data-e2e="detail-video-info" data-e2e-aweme-id="${ID}"><h1>Current video</h1></div><div data-e2e="comment-list"><a href="/user/reader">Reader</a></div><div data-e2e="user-info"><a href="/user/owner"><img></a><a href="/user/owner">Owner</a></div><video src="https://media.example/video.mp4"></video></div></body></html>`;
  const post = await extract('douyin', 'video', { commentLimit: 0 }, html);
  assert.equal(post.author, 'Owner');
  assert.equal(post.authorProfileUrl, 'https://www.douyin.com/user/owner');
  assert.equal(post.videoUrl, 'https://media.example/video.mp4');
});

test('Douyin modal extraction excludes the inline copy and preloaded neighbouring posts', async () => {
  const section = (id, caption, video, author, extra = '') => `<div class="video_${id}"><p data-e2e="video-desc">${caption}</p><div data-e2e="user-info"><a href="/user/${author}">${author}</a></div><video src="https://media.example/${video}.mp4"></video>${extra}</div>`;
  const html = `<html><body><div class="search-result-card">${section(ID, 'Inline copy', 'inline', 'inline-owner')}</div>${section('9999999999999999999', 'Preload', 'preload', 'other-owner')}${section(ID, 'Active modal', 'active', 'Owner', '<button data-e2e="feed-comment-icon">1</button>')}</body></html>`;
  const post = await extract('douyin', 'video', {}, html, (window) => {
    const active = window.document.querySelectorAll(`[class="video_${ID}"]`)[1];
    active.querySelector('button').addEventListener('click', () => {
      active.insertAdjacentHTML('beforeend', '<div data-e2e="comment-list"><div data-e2e="comment-item" data-comment-id="own-comment"><p data-e2e="comment-content">Own comment</p></div>没有更多评论</div>');
    });
  }, `https://www.douyin.com/search/garden?modal_id=${ID}`);
  assert.equal(post.text, 'Active modal');
  assert.equal(post.author, 'Owner');
  assert.equal(post.videoUrl, 'https://media.example/active.mp4');
  assert.equal(post.comments[0].id, 'own-comment');
  assert.equal(post.capture.comments, 'complete');
});

test('TikTok comment timestamps fall back to the exact structured comment', async () => {
  const html = `<html><body><script type="application/json">${JSON.stringify({ id: ID, desc: 'Post', video: { playAddr: 'https://media.example/video.mp4' }, stats: { commentCount: 1 } })}</script><div class="DivCommentListContainer"><div class="DivCommentItemWrapper"><a href="/@reader">Reader</a><span data-e2e="comment-level-1">A comment</span></div></div></body></html>`;
  const post = await extract('tiktok', 'video', {}, html, (window) => {
    window.document.querySelector('.DivCommentItemWrapper').__reactProps$fixture = { comment: { cid: '111', text: 'A comment', user: { nickname: 'Reader' }, create_time: 1750000000 } };
  });
  assert.equal(post.comments[0].id, '111');
  assert.equal(post.comments[0].createdAt, '2025-06-15T15:06:40.000Z');
});

test('A stalled comment list with unknown total does not confirm exhaustion', async () => {
  const html = `<html><body><script type="application/json">${JSON.stringify({ id: ID, desc: 'Post', video: { playAddr: 'https://media.example/video.mp4' } })}</script><div data-e2e="comment-list"><div data-e2e="comment-item" data-comment-id="111"><p data-e2e="comment-content">Only loaded comment</p></div></div></body></html>`;
  const post = await extract('tiktok', 'video', {}, html);
  assert.equal(post.comments.length, 1);
  assert.equal(post.capture.comments, 'partial');
});
