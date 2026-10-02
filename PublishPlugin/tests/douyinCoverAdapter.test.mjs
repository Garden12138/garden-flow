import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
import { douyinCoverPage, douyinCoverPixelsMatch, douyinCoverPixelComparison } from '../src/douyinCoverAdapter.js';

function fixture() {
  class Element {
    constructor(text = '', classes = []) {
      this.textContent = text; this.children = []; this.attributes = {};
      this.classList = Object.assign(classes, { contains: name => classes.includes(name) });
      this.hidden = false; this.disabled = false; this.clicked = 0;
    }
    getBoundingClientRect() { return { width: this.hidden ? 0 : 100, height: 100 }; }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    closest() { return this.uploadContainer; }
    querySelectorAll(selector) {
      if (selector.includes('cover-tip-')) return [this.tip].filter(Boolean);
      if (selector === 'img') return [this.image].filter(Boolean);
      if (selector === 'input[type="file"]') return this.inputs || [];
      if (selector === 'div,span,p') return this.labels || [];
      if (selector === '[class*="single-title-"]') return this.singleTitles || [];
      if (selector === 'button') return this.buttons || [];
      if (selector === '.semi-upload') return this.uploaders || [];
      if (selector.startsWith('canvas[id=')) return this.canvases || [];
      return [];
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    click() { this.clicked += 1; }
    addEventListener(name, listener) { this.listener = listener; }
    removeEventListener() {}
  }
  const cards = ['portrait', 'landscape'].map((orientation) => {
    const card = new Element('', ['coverControl-CjlzqC']);
    card.tip = new Element(orientation === 'portrait' ? '竖封面 3:4' : '横封面 4:3');
    const area = new Element('', ['cover-Jg3T4p']);
    area.image = Object.assign(new Element(), { src: `https://media.example/${orientation}.jpeg?token=secret`, complete: true,
      naturalWidth: orientation === 'portrait' ? 1080 : 1440, naturalHeight: orientation === 'portrait' ? 1440 : 1080 });
    card.children = [area]; return card;
  });
  const dialog = new Element('竖封面预览');
  dialog.labels = [new Element('竖封面预览（3:4）')];
  dialog.inputs = ['semi-upload-hidden-input', 'semi-upload-hidden-input-replace'].map(name =>
    Object.assign(new Element('', [name]), { accept: 'image/png,image/jpeg', uploadContainer: new Element('', ['semi-upload', 'upload-BvM5FF']) }));
  const hiddenUploadContainer = new Element('', ['semi-upload', 'upload-BvM5FF']);
  hiddenUploadContainer.hidden = true;
  dialog.inputs.push(...['semi-upload-hidden-input', 'semi-upload-hidden-input-replace'].map(name =>
    Object.assign(new Element('', [name]), { accept: 'image/png,image/jpeg', uploadContainer: hiddenUploadContainer })));
  dialog.inputs.push(...['semi-upload-hidden-input', 'semi-upload-hidden-input-replace'].map(name =>
    Object.assign(new Element('', [name]), { accept: 'image/png,image/jpeg', uploadContainer: new Element('', ['semi-upload']) })));
  dialog.buttons = [new Element('设置横封面'), new Element('完成')];
  dialog.canvases = [Object.assign(new Element(), { width: 596, height: 341 })];
  const state = { dialogs: [], unreadable: false, color: 100, samplers: [], sampledRegions: [] };
  const location = { origin: 'https://creator.douyin.com', pathname: '/creator-micro/content/post/video', href: 'https://creator.douyin.com/creator-micro/content/post/video' };
  const context = vm.createContext({ location, HTMLElement: Element, URL, TextEncoder, crypto: webcrypto,
    fetch: async (url) => {
      assert.match(url, /^data:image\//);
      const response = { arrayBuffer: async () => Uint8Array.from(Buffer.from(url.split(',')[1], 'base64')).buffer };
      response.clone = () => response;
      return response;
    },
    getComputedStyle: node => ({ visibility: 'visible', display: node.hidden ? 'none' : 'block', objectFit: 'cover', objectPosition: 'center center', transform: node.transform || 'none' }),
    createImageBitmap: async () => ({ width: 1080, height: 1440, close() {} }),
    document: {
      querySelectorAll: selector => selector.includes('role="dialog"') ? state.dialogs : cards,
      createElement: () => ({ getContext: () => ({ drawImage(...args) {
        state.samplers.push({ enabled: this.imageSmoothingEnabled, quality: this.imageSmoothingQuality });
        state.sampledRegions.push(args.slice(1));
      }, getImageData() {
        if (state.unreadable) throw new Error('SecurityError');
        return { data: new Uint8Array(4096).fill(state.color) };
      } }) }),
    },
  });
  const invoke = (operation, options = {}) => {
    context.operation = operation; context.options = options;
    return vm.runInContext(`(${douyinCoverPage.toString()})(operation, options)`, context);
  };
  return { invoke, cards, dialog, state, location };
}

test('injected cover probe confines page, reads saved previews and ignores signed query rotation', async () => {
  const { invoke, cards, state, location } = fixture();
  const first = await invoke('probe');
  assert.ok(first.coverSnapshot.portrait);
  assert.equal(JSON.stringify(first).includes('secret'), false);
  cards[0].children[0].image.src = 'https://media.example/portrait.jpeg?token=changed';
  assert.equal((await invoke('probe')).coverSnapshot.portrait, first.coverSnapshot.portrait);
  cards[0].children[0].image.src = 'https://media.example/other.jpeg';
  assert.notEqual((await invoke('probe')).coverSnapshot.portrait, first.coverSnapshot.portrait);
  cards[0].children[0].image.transform = 'scale(1.2)';
  const transformed = await invoke('probe');
  assert.notEqual(transformed.coverSnapshot.portrait, first.coverSnapshot.portrait);
  assert.equal((await invoke('read-preview', { orientation: 'portrait' })).pixels.length, 3072);
  assert.ok(state.samplers.length > 0);
  assert.ok(state.samplers.every((sampler) => sampler.enabled === true && sampler.quality === 'high'));
  const beforePixels = (await invoke('probe')).coverSnapshot.portrait;
  state.color = 120;
  assert.notEqual((await invoke('probe')).coverSnapshot.portrait, beforePixels, 'same URL with different pixels must invalidate');
  state.unreadable = true;
  assert.equal((await invoke('read-preview', { orientation: 'portrait' })).code, 'COVER_PIXELS_UNREADABLE');
  location.origin = 'https://evil.example';
  assert.equal((await invoke('open', { orientation: 'portrait' })).code, 'COVER_PAGE_MISMATCH');
});

test('only visible cover dialog original input is armed; SHA captures file before platform clears input', async () => {
  const { invoke, dialog, state, cards } = fixture();
  assert.equal((await invoke('open', { orientation: 'portrait' })).ok, true);
  assert.equal(cards[0].children[0].clicked, 1);
  state.dialogs = [dialog];
  assert.equal((await invoke('probe')).orientation, 'portrait');
  const token = 'douyin_publish_test:portrait';
  assert.equal((await invoke('arm-input', { orientation: 'portrait', token })).ok, true);
  assert.equal(dialog.inputs[0].attributes['data-gardenflow-cover-input'], token);
  assert.equal(dialog.inputs[1].attributes['data-gardenflow-cover-input'], undefined);
  assert.equal(dialog.inputs[2].attributes['data-gardenflow-cover-input'], undefined, 'hidden orientation input must not be armed');
  assert.equal(dialog.inputs[4].attributes['data-gardenflow-cover-input'], undefined, 'visible AI reference-image input must not receive the cover');
  const bytes = Buffer.from('selected JPEG bytes');
  const input = dialog.inputs[0];
  input.files = [{ arrayBuffer: async () => bytes }];
  const reading = input.listener({ target: input });
  input.files = [];
  await reading;
  const read = await invoke('read-upload', { orientation: 'portrait', token });
  assert.equal(read.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(read.width, 1080);
  assert.equal(read.pixels.length, 3072);
  dialog.buttons[1].disabled = true;
  assert.equal((await invoke('save', { orientation: 'portrait' })).code, 'COVER_BUTTON_UNAVAILABLE');
  dialog.buttons[1].disabled = false;
  assert.equal((await invoke('save', { orientation: 'portrait' })).ok, true);
  assert.equal(dialog.buttons[1].clicked, 1);
  dialog.inputs.push(dialog.inputs[0]);
  assert.equal((await invoke('arm-input', { orientation: 'portrait', token })).code, 'COVER_INPUT_AMBIGUOUS');
  state.dialogs = [dialog, dialog];
  assert.equal((await invoke('probe')).code, 'COVER_DIALOG_AMBIGUOUS');
});

test('pixel readback tolerates recompression and rejects different, absent or invalid pixels', () => {
  const pixels = Array(3072).fill(100);
  assert.equal(douyinCoverPixelsMatch(pixels, Array(3072).fill(104)), true);
  assert.equal(douyinCoverPixelsMatch(pixels, Array(3072).fill(150)), false);
  assert.equal(douyinCoverPixelsMatch(pixels, [...pixels.slice(0, 3000), ...Array(72).fill(NaN)]), false);
  assert.equal(douyinCoverPixelsMatch(pixels, Array(3072).fill(-1)), false);
  assert.equal(douyinCoverPixelsMatch(pixels, []), false);
  assert.deepEqual(douyinCoverPixelComparison(pixels, Array(3072).fill(104)), {
    matches: true, meanAbsoluteError: 4, largeDeltaFraction: 0,
  });
  assert.deepEqual(douyinCoverPixelComparison(pixels, Array(3072).fill(150)), {
    matches: false, meanAbsoluteError: 50, largeDeltaFraction: 1,
  });
});

test('saved cover reopens in the observed single editor and mismatched or duplicate headers fail closed', async () => {
  const { invoke, dialog, state } = fixture();
  state.dialogs = [dialog];
  dialog.singleTitles = [new dialog.constructor('设置竖封面')];
  assert.equal((await invoke('probe')).editorMode, 'single');
  assert.equal((await invoke('probe')).orientation, 'portrait');
  dialog.singleTitles[0].textContent = '设置横封面';
  assert.equal((await invoke('probe')).code, 'COVER_EDITOR_MODE_UNSUPPORTED');
  dialog.singleTitles[0].textContent = '设置竖封面';
  dialog.singleTitles.push(dialog.singleTitles[0]);
  assert.equal((await invoke('probe')).code, 'COVER_EDITOR_MODE_UNSUPPORTED');
});

test('saved preview normalizes only bounded center rounding from the exact uploaded file', async () => {
  const { invoke, dialog, state, cards } = fixture();
  state.dialogs = [dialog];
  const token = 'douyin_publish_rounding:portrait';
  await invoke('arm-input', { orientation: 'portrait', token });
  await dialog.inputs[0].listener({ target: { files: [{ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }] } });
  state.dialogs = [];
  const image = cards[0].children[0].image;
  image.naturalWidth = 1074; image.naturalHeight = 1433;
  const result = await invoke('read-preview', { orientation: 'portrait', token });
  assert.equal(result.roundedExpectedPixels.length, 3072);
  assert.ok(state.sampledRegions.some((region) => JSON.stringify(region) === JSON.stringify([3, 3.5, 1074, 1433, 0, 0, 256, 256])));
  image.naturalWidth = 1050;
  assert.equal((await invoke('read-preview', { orientation: 'portrait', token })).roundedExpectedPixels, undefined);
  image.naturalWidth = 1081;
  assert.equal((await invoke('read-preview', { orientation: 'portrait', token })).roundedExpectedPixels, undefined);
  assert.equal((await invoke('read-preview', { orientation: 'portrait', token: 'other' })).roundedExpectedPixels, undefined);
});

test('editor readiness requires newly painted pixels and the unique visible canvas', async () => {
  const { invoke, dialog, state } = fixture();
  state.dialogs = [dialog];
  const token = 'douyin_publish_paint:portrait';
  await invoke('arm-input', { orientation: 'portrait', token });
  assert.equal((await invoke('read-editor-ready', { orientation: 'portrait', token })).ok, false);
  state.color = 130;
  assert.equal((await invoke('read-editor-ready', { orientation: 'portrait', token })).ok, true);
  dialog.canvases.push(dialog.canvases[0]);
  assert.equal((await invoke('read-editor-ready', { orientation: 'portrait', token })).ok, false);
});

test('reuploading the identical image requires exact loaded thumbnail bytes before unchanged paint is ready', async () => {
  const { invoke, dialog, state } = fixture();
  state.dialogs = [dialog];
  const token = 'douyin_publish_identical:portrait';
  await invoke('arm-input', { orientation: 'portrait', token });
  const bytes = Uint8Array.from([1, 2, 3]);
  await dialog.inputs[0].listener({ target: { files: [{ arrayBuffer: async () => bytes.buffer }] } });
  const uploader = dialog.inputs[0].uploadContainer;
  const background = Object.assign(new (uploader.constructor)('', ['bg-UvmtRj']), {
    style: { backgroundImage: 'url("data:image/jpeg;base64,AQID")' },
  });
  uploader.parentElement = { children: [background] };
  dialog.uploaders = [uploader];
  assert.equal((await invoke('read-editor-ready', { orientation: 'portrait', token })).ok, true);
  background.style.backgroundImage = 'url("data:image/jpeg;base64,AQIE")';
  assert.equal((await invoke('read-editor-ready', { orientation: 'portrait', token })).ok, false);
  background.style.backgroundImage = 'url("https://example.test/unknown.jpg")';
  assert.equal((await invoke('read-editor-ready', { orientation: 'portrait', token })).ok, false);
});

test('an existing uploaded image selects the replacement control without falling back to the full original slot', async () => {
  const { invoke, dialog, state } = fixture();
  state.dialogs = [dialog];
  const thumbnail = Object.assign(new (dialog.constructor)('', ['bg-UvmtRj']), {
    style: { backgroundImage: 'url("data:image/jpeg;base64,AQID")' },
  });
  for (const input of dialog.inputs.slice(0, 2)) input.uploadContainer.parentElement = { children: [thumbnail] };
  const token = 'douyin_publish_replace:portrait';
  assert.equal((await invoke('arm-input', { orientation: 'portrait', token })).ok, true);
  assert.equal(dialog.inputs[0].attributes['data-gardenflow-cover-input'], undefined);
  assert.equal(dialog.inputs[1].attributes['data-gardenflow-cover-input'], token);
  dialog.inputs.splice(1, 1);
  assert.equal((await invoke('arm-input', { orientation: 'portrait', token })).code, 'COVER_INPUT_AMBIGUOUS');
});
