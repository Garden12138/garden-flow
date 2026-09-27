import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute the actual injected reader, not a mocked snapshot return value.
const background = await readFile(new URL('../src/background.js', import.meta.url), 'utf8');
const reader = background.slice(background.indexOf('function readPreparedEditorSnapshot()'), background.indexOf('function preparedEditorFailure('));
const probeReader = background.slice(background.indexOf('function probePage()'), background.indexOf('async function inspectTab('));

function runProbe({ headings = [], controls = [], text = '', alerts = [], editor = false } = {}) {
  const node = (textContent, extra = {}) => ({ textContent, innerText: textContent,
    getBoundingClientRect: () => ({ width: 100, height: 20 }), getAttribute: () => null, ...extra });
  const title = node('', { value: '当前标题', getAttribute: key => key === 'placeholder' ? '填写标题' : null,
    closest: () => null });
  const body = { innerText: text, querySelector: () => null };
  const document = { body, getElementById: () => null, querySelectorAll: selector => {
    if (selector === 'h1,h2,h3,[role="heading"]' || selector === 'h1,h2,h3,[role="heading"],div,span,p') return headings.map(value => node(value));
    if (selector === 'button,a,[role="button"]') return controls.map(value => node(value));
    if (selector === 'input,textarea' || selector === 'input,textarea,[aria-invalid="true"]') return editor ? [title] : [];
    if (selector === '[contenteditable="true"],textarea') return editor ? [node('当前正文')] : [];
    if (selector === 'input[type="file"]') return editor ? [node('')] : [];
    if (selector === '[role="alert"],[class*="toast"],[class*="message-content"]') return alerts.map(value => node(value));
    return [];
  } };
  return vm.runInNewContext(`${probeReader}\nprobePage()`, { document, URL,
    location: { href: 'https://creator.xiaohongshu.com/publish/publish?target=video', pathname: '/publish/publish' },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) });
}

test('actual page probe accepts success plus return or timer, but not an active editor', () => {
  assert.equal(runProbe({ headings: ['发布成功'], controls: ['立即返回'] }).successPage, true);
  assert.equal(runProbe({ headings: ['发布成功'], text: '5 秒后将返回发布页' }).successPage, true);
  assert.equal(runProbe({ headings: ['发布成功'] }).successPage, false);
  assert.equal(runProbe({ controls: ['立即返回'] }).successPage, false);
  assert.equal(runProbe({ headings: ['发布成功'], controls: ['立即返回'], editor: true }).successPage, false);
});

test('actual page probe distinguishes platform errors from progress and success alerts', () => {
  const result = runProbe({ alerts: ['正在发布，请稍候', '上传完成', '发布成功', '服务器繁忙，请稍后重试', '请填写标题'] });
  assert.deepEqual(Array.from(result.pageAlerts), ['服务器繁忙，请稍后重试', '请填写标题']);
});

test('actual snapshot reader finds a visible video file label without a video element', () => {
  const node = (text, extra = {}) => ({ children: [], innerText: text, textContent: text,
    getBoundingClientRect: () => ({ width: 100, height: 100 }),
    getAttribute: () => null, ...extra });
  const insideCopy = node('foreign.mp4');
  const title = node('', { value: '旧超长标题', getAttribute: key => key === 'placeholder' ? '填写标题' : null,
    closest: () => ({ querySelectorAll: () => [] }) });
  const body = node('正文\n#原料透明猫粮[话题]#', { contains: item => item === insideCopy });
  const fileLabel = node('media_1790242761384_97f48d4e.mp4', { children: [{}],
    childNodes: [{ nodeType: 3, textContent: 'media_1790242761384_97f48d4e.mp4' }, { nodeType: 1, textContent: '' }] });
  const hiddenLabel = node('hidden.mp4', { hidden: true });
  const document = { body: { innerText: '视频文件 重新上传 media_1790242761384_97f48d4e.mp4' },
    querySelectorAll: selector => {
      if (selector === 'input,textarea') return [title];
      if (selector === '[contenteditable="true"],textarea') return [body];
      if (selector === 'span,div,p,[title]') return [fileLabel, hiddenLabel, insideCopy, node('不是文件')];
      return [];
    } };
  const snapshot = vm.runInNewContext(`${reader}\nreadPreparedEditorSnapshot()`, {
    document, getComputedStyle: item => ({ visibility: item.hidden ? 'hidden' : 'visible', display: 'block' }),
  });
  assert.deepEqual(Array.from(snapshot.mediaFileNames), ['media_1790242761384_97f48d4e.mp4']);
  assert.deepEqual(Array.from(snapshot.mediaSources), []);
  assert.equal(snapshot.bodyValue, body.innerText);
  assert.equal(snapshot.titleValue, title.value);
  assert.equal(snapshot.mediaBusy, false);
});
