import { normalizeCaptureDocument } from '../capture/captureDocument.js';
import { assessCaptureQuality, applyCaptureQuality } from '../capture/captureQuality.js';
import { GENERIC_CAPTURE_MESSAGE_TYPE } from '../capture/genericCaptureProtocol.js';

const CACHE_TTL_MS = 5_000;
const GENERIC_CAPTURE_SCRIPT = 'genericCaptureContent.js';
const captureCache = new Map();

function isWechatUrl(value) {
  try {
    return new URL(value).hostname === 'mp.weixin.qq.com';
  } catch {
    return false;
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} 超时`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export function clearGenericCaptureCache(tabId) {
  captureCache.delete(Number(tabId));
}

export function createGenericCaptureCoordinator(deps = {}) {
  const now = deps.now || (() => Date.now());
  const timeoutMs = Number(deps.timeoutMs || 4_000);

  function runtime() {
    const scripting = deps.scripting || globalThis.chrome?.scripting;
    const tabs = deps.tabs || globalThis.chrome?.tabs;
    if (!scripting?.executeScript || !tabs?.get || !tabs?.sendMessage) {
      throw new Error('浏览器扩展运行时不可用');
    }
    return { scripting, tabs };
  }

  async function requestDefuddledCapture(tabId) {
    const { scripting, tabs } = runtime();
    await scripting.executeScript({
      target: { tabId },
      files: [GENERIC_CAPTURE_SCRIPT],
      world: 'ISOLATED',
    });
    const response = await withTimeout(
      tabs.sendMessage(tabId, { type: GENERIC_CAPTURE_MESSAGE_TYPE }),
      timeoutMs,
      '网页正文提取',
    );
    if (!response?.ok || !response?.capture) {
      throw new Error(response?.error || '网页正文提取没有返回内容');
    }
    const capture = applyCaptureQuality(normalizeCaptureDocument(response.capture));
    const quality = assessCaptureQuality(capture);
    if (!quality.accepted) {
      const code = quality.accessErrorCode || 'CONTENT_NOT_ACCESSIBLE';
      const message = code === 'BROWSER_SECURITY_CHALLENGE'
        ? '当前页面需要在浏览器中完成安全验证'
        : code === 'BROWSER_LOGIN_REQUIRED'
          ? '当前页面需要先在浏览器中登录平台账号'
          : '当前页面正文不可访问';
      throw Object.assign(new Error(message), {
        code,
        phase: 'capture',
        retryable: false,
        recovery: code === 'CONTENT_NOT_ACCESSIBLE'
          ? '确认正文已在页面中展开后重试'
          : '回到当前浏览器页面自行完成登录或验证，然后重新采集',
      });
    }
    return capture;
  }

  return {
    async extract(tabId) {
      const { tabs } = runtime();
      const tab = await tabs.get(tabId);
      const sourceUrl = String(tab?.url || '');
      // WeChat uses the MAIN-world extractor for its rich HTML and localized images.
      if (!sourceUrl || isWechatUrl(sourceUrl)) {
        return { capture: null, reason: 'page-extractor-required' };
      }
      const cached = captureCache.get(Number(tabId));
      if (cached && cached.url === sourceUrl && now() - cached.at <= CACHE_TTL_MS) {
        return { capture: cached.capture, reason: 'cache-hit' };
      }
      try {
        const capture = await requestDefuddledCapture(tabId);
        captureCache.set(Number(tabId), { url: sourceUrl, at: now(), capture });
        return { capture, reason: 'defuddle' };
      } catch (error) {
        if (['BROWSER_LOGIN_REQUIRED', 'BROWSER_SECURITY_CHALLENGE', 'CONTENT_NOT_ACCESSIBLE'].includes(String(error?.code || ''))) {
          throw error;
        }
        return {
          capture: null,
          reason: 'page-extractor-required',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

export const genericCaptureCoordinator = createGenericCaptureCoordinator();
