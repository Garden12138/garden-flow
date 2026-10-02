// Compare decoded cover pixels after platform recompression. This check is used
// only after the upload input's exact SHA-256 has matched the confirmed file.
export function douyinCoverPixelComparison(expected, actual) {
  if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== 3072 || actual.length !== expected.length) return { matches: false };
  let sum = 0;
  let large = 0;
  for (let i = 0; i < expected.length; i += 1) {
    if (!Number.isFinite(expected[i]) || !Number.isFinite(actual[i])
      || expected[i] < 0 || expected[i] > 255 || actual[i] < 0 || actual[i] > 255) return { matches: false };
    const delta = Math.abs(expected[i] - actual[i]);
    sum += delta;
    if (delta > 24) large += 1;
  }
  const meanAbsoluteError = sum / expected.length;
  const largeDeltaFraction = large / expected.length;
  return { matches: meanAbsoluteError <= 8 && largeDeltaFraction <= 0.05, meanAbsoluteError, largeDeltaFraction };
}

export function douyinCoverPixelsMatch(expected, actual) {
  return douyinCoverPixelComparison(expected, actual).matches;
}

// Injected into the bound creator page. Keep all DOM and file-reading helpers
// inside this function: executeScript does not preserve module closures.
export async function douyinCoverPage(operation = 'probe', options = {}) {
  const failure = (code) => ({ ok: false, code });
  if (location.origin !== 'https://creator.douyin.com' || location.pathname !== '/creator-micro/content/post/video') {
    return failure('COVER_PAGE_MISMATCH');
  }
  const visible = (node) => {
    if (!(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const labels = { portrait: '竖封面3:4', landscape: '横封面4:3' };
  const previewLabels = { portrait: '竖封面预览（3:4）', landscape: '横封面预览（4:3）' };
  const normalize = (value) => String(value || '').replace(/\s/gu, '');
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).filter(visible)
    .filter((node) => /[竖横]封面预览/.test(node.textContent || ''));
  if (dialogs.length > 1) return failure('COVER_DIALOG_AMBIGUOUS');
  const dialog = dialogs[0];
  const orientation = dialog ? Object.keys(previewLabels).find((key) =>
    Array.from(dialog.querySelectorAll('div,span,p')).some((node) => visible(node)
      && normalize(node.textContent) === previewLabels[key])) : undefined;
  const singleTitles = dialog ? Array.from(dialog.querySelectorAll('[class*="single-title-"]')).filter(visible) : [];
  if (singleTitles.length > 1 || (singleTitles.length === 1
    && normalize(singleTitles[0].textContent) !== (orientation === 'portrait' ? '设置竖封面' : orientation === 'landscape' ? '设置横封面' : ''))) {
    return failure('COVER_EDITOR_MODE_UNSUPPORTED');
  }
  const editorMode = singleTitles.length === 1 ? 'single' : 'combined';
  const card = (key) => {
    const matches = Array.from(document.querySelectorAll('[class*="coverControl-"]')).filter(visible)
      .filter((node) => normalize(node.querySelector('[class*="cover-tip-"]')?.textContent) === labels[key]);
    if (matches.length !== 1) return null;
    const areas = Array.from(matches[0].children).filter((node) =>
      Array.from(node.classList || []).some((name) => name.startsWith('cover-') && !name.startsWith('cover-tip-')));
    return areas.length === 1 ? areas[0] : null;
  };
  const preview = async (key) => {
    const area = card(key);
    const images = area ? Array.from(area.querySelectorAll('img')).filter(visible) : [];
    if (images.length !== 1 || !images[0].complete || !images[0].naturalWidth || !images[0].naturalHeight) return null;
    const image = images[0];
    let source;
    try {
      const url = new URL(image.currentSrc || image.src, location.href);
      if (!['https:', 'blob:', 'data:'].includes(url.protocol)) return null;
      // Signed URL credentials can rotate. The stored object identity and
      // rendering parameters determine whether the confirmed cover changed.
      source = url.protocol === 'https:' ? `${url.origin}${url.pathname}` : url.href;
    } catch { return null; }
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    const sourceDigest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    let pixelDigest = '';
    try {
      const pixelHash = await crypto.subtle.digest('SHA-256', new Uint8Array(pixels(image)));
      pixelDigest = Array.from(new Uint8Array(pixelHash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch { /* A later read-preview fails closed when pixel access is unavailable. */ }
    const style = getComputedStyle(image);
    return { image, signature: JSON.stringify({ sourceDigest, pixelDigest, width: image.naturalWidth, height: image.naturalHeight,
      fit: style.objectFit, position: style.objectPosition, transform: style.transform }) };
  };
  const pixels = (image, region) => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas unavailable');
    // Area resampling avoids aliasing from the platform's small crop/resize
    // differences. Apply the same sampler to the exact uploaded file and the
    // saved preview; the existing comparison limits remain unchanged.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (region) context.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, 256, 256);
    else context.drawImage(image, 0, 0, 256, 256);
    // Both HTML images and ImageBitmaps finish through the same canvas
    // resampling path instead of decoder-specific direct thumbnail scaling.
    const sample = document.createElement('canvas');
    sample.width = 32;
    sample.height = 32;
    const sampleContext = sample.getContext('2d', { willReadFrequently: true });
    if (!sampleContext) throw new Error('Canvas unavailable');
    sampleContext.imageSmoothingEnabled = true;
    sampleContext.imageSmoothingQuality = 'high';
    sampleContext.drawImage(canvas, 0, 0, 32, 32);
    const rgba = sampleContext.getImageData(0, 0, 32, 32).data;
    const rgb = [];
    for (let i = 0; i < rgba.length; i += 4) rgb.push(rgba[i], rgba[i + 1], rgba[i + 2]);
    return rgb;
  };
  const buttons = (text) => dialog ? Array.from(dialog.querySelectorAll('button')).filter(visible)
    .filter((node) => normalize(node.textContent) === text) : [];
  const clickButton = (text) => {
    const found = buttons(text);
    if (found.length !== 1 || found[0].disabled) return failure('COVER_BUTTON_UNAVAILABLE');
    found[0].click();
    return { ok: true };
  };
  const key = options.orientation;
  if (operation === 'probe') return { ok: true, coverEditing: Boolean(dialog), orientation, editorMode,
    coverSnapshot: Object.fromEntries(await Promise.all(Object.keys(labels).map(async (name) => [name, (await preview(name))?.signature || '']))) };
  if (!Object.hasOwn(labels, key)) return failure('COVER_ORIENTATION_INVALID');
  if (operation === 'open') {
    if (dialog) return orientation === key ? { ok: true } : clickButton(key === 'portrait' ? '设置竖封面' : '设置横封面');
    const area = card(key);
    if (!area) return failure('COVER_CARD_AMBIGUOUS');
    area.click();
    return { ok: true };
  }
  if (operation === 'read-preview') {
    if (dialog) return failure('COVER_DIALOG_STILL_OPEN');
    const saved = await preview(key);
    if (!saved) return failure('COVER_PREVIEW_MISSING');
    try {
      let roundedExpectedPixels;
      const file = globalThis.__gardenflowDouyinCoverFiles?.[options.token];
      if (file) {
        const bitmap = await createImageBitmap(file);
        try {
          const width = saved.image.naturalWidth;
          const height = saved.image.naturalHeight;
          // The platform's center crop rounds its preview canvas to integer
          // pixels. Only a bounded central loss (at most 1% per dimension)
          // is normalized; larger crops still compare to the whole file.
          if (width <= bitmap.width && height <= bitmap.height
            && width >= bitmap.width * 0.99 && height >= bitmap.height * 0.99) {
            roundedExpectedPixels = pixels(bitmap, { x: (bitmap.width - width) / 2,
              y: (bitmap.height - height) / 2, width, height });
          }
        } finally { bitmap.close(); }
      }
      return { ok: true, signature: saved.signature, width: saved.image.naturalWidth,
        height: saved.image.naturalHeight, pixels: pixels(saved.image), roundedExpectedPixels };
    }
    catch { return failure('COVER_PIXELS_UNREADABLE'); }
  }
  if (!dialog || orientation !== key) return failure('COVER_DIALOG_MISMATCH');
  const editorSignature = async () => {
    const id = key === 'portrait' ? 'vertical_coverCanvas' : 'horizontal_coverCanvas';
    const canvases = Array.from(dialog.querySelectorAll(`canvas[id="${id}"]`)).filter(visible);
    if (canvases.length !== 1 || !canvases[0].width || !canvases[0].height) return '';
    try {
      const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(pixels(canvases[0])));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch { return ''; }
  };
  if (operation === 'read-editor-ready') {
    const captured = globalThis.__gardenflowDouyinCoverReadbacks?.[options.token];
    const before = captured?.editorBefore;
    const signature = await editorSignature();
    let sameFileLoaded = false;
    const uploaders = Array.from(dialog.querySelectorAll('.semi-upload')).filter((node) => visible(node)
      && Array.from(node.classList).some((name) => name.startsWith('upload-')));
    if (uploaders.length === 1 && captured?.ok) {
      const backgrounds = Array.from(uploaders[0].parentElement?.children || []).filter((node) => visible(node)
        && Array.from(node.classList).some((name) => name.startsWith('bg-')));
      const dataUrl = backgrounds.length === 1 ? backgrounds[0].style.backgroundImage.match(/^url\(["']?(data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)["']?\)$/i)?.[1] : undefined;
      if (dataUrl) {
        try {
          const response = await fetch(dataUrl);
          const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
          sameFileLoaded = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') === captured.sha256;
          if (!sameFileLoaded) {
            // The local upload thumbnail may be re-encoded. It is a readiness
            // signal only; exact input SHA and final saved-cover verification
            // remain mandatory.
            const bitmap = await createImageBitmap(await response.blob());
            try {
              const actual = pixels(bitmap);
              const expected = captured.pixels;
              if (expected?.length === 3072 && actual.length === 3072) {
                let sum = 0;
                let large = 0;
                for (let i = 0; i < expected.length; i += 1) {
                  const delta = Math.abs(expected[i] - actual[i]);
                  sum += delta;
                  if (delta > 24) large += 1;
                }
                sameFileLoaded = sum / expected.length <= 8 && large / expected.length <= 0.05;
              }
            } finally { bitmap.close(); }
          }
        } catch { /* The changed canvas remains the other readiness proof. */ }
      }
    }
    return { ok: Boolean(signature && before && (signature !== before || sameFileLoaded)), signature,
      code: 'COVER_EDITOR_IMAGE_NOT_READY' };
  }
  const inputs = Array.from(dialog.querySelectorAll('input[type="file"]')).filter((node) => {
    const container = node.closest('.semi-upload');
    // The AI reference-image uploader is also visible in this dialog. Only
    // the cover uploader has the observed upload-* container role.
    if (!/image\//i.test(node.accept || '') || !visible(container)
      || !Array.from(container.classList).some((name) => name.startsWith('upload-'))) return false;
    const hasUploadedImage = Array.from(container.parentElement?.children || []).some((child) => visible(child)
      && Array.from(child.classList).some((name) => name.startsWith('bg-'))
      && /^url\(["']?data:image\//i.test(child.style?.backgroundImage || ''));
    return node.classList.contains(hasUploadedImage ? 'semi-upload-hidden-input-replace' : 'semi-upload-hidden-input');
  });
  if (operation === 'arm-input') {
    if (inputs.length !== 1 || !/^douyin_publish_[A-Za-z0-9_-]+:[a-z]+$/.test(String(options.token || ''))) return failure('COVER_INPUT_AMBIGUOUS');
    const input = inputs[0];
    const token = options.token;
    const readbacks = globalThis.__gardenflowDouyinCoverReadbacks ||= Object.create(null);
    const uploadedFiles = globalThis.__gardenflowDouyinCoverFiles ||= Object.create(null);
    const jobPrefix = token.slice(0, token.lastIndexOf(':') + 1);
    for (const storedToken of Object.keys(uploadedFiles)) if (!storedToken.startsWith(jobPrefix)) delete uploadedFiles[storedToken];
    if (input.__gardenflowCoverListener) input.removeEventListener('change', input.__gardenflowCoverListener, true);
    const editorBefore = await editorSignature();
    if (!editorBefore) return failure('COVER_CANVAS_UNAVAILABLE');
    readbacks[token] = { ok: false, code: 'COVER_FILE_NOT_READ', editorBefore };
    const listener = async (event) => {
      const files = Array.from(event.target.files || []);
      readbacks[token] = { ok: false, code: 'COVER_FILE_PROCESSING', editorBefore };
      try {
        if (files.length !== 1) throw new Error('File count');
        const file = files[0];
        uploadedFiles[token] = file;
        const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        const sha256 = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
        const bitmap = await createImageBitmap(file);
        try { readbacks[token] = { ok: true, sha256, width: bitmap.width, height: bitmap.height, pixels: pixels(bitmap), editorBefore }; }
        finally { bitmap.close(); }
      } catch { readbacks[token] = failure('COVER_FILE_DECODE_FAILED'); }
    };
    input.__gardenflowCoverListener = listener;
    input.addEventListener('change', listener, { capture: true, once: true });
    input.setAttribute('data-gardenflow-cover-input', token);
    return { ok: true, token };
  }
  if (operation === 'read-upload') return globalThis.__gardenflowDouyinCoverReadbacks?.[options.token] || failure('COVER_FILE_NOT_READ');
  if (operation === 'switch') return clickButton(key === 'portrait' ? '设置横封面' : '设置竖封面');
  if (operation === 'save') return clickButton('完成');
  return failure('COVER_OPERATION_INVALID');
}
