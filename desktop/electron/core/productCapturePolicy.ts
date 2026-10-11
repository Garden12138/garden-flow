export type ProductCapturePlatform = 'jd' | 'taobao' | 'tmall';

export const PRODUCT_CAPTURE_LABELS: Record<ProductCapturePlatform, string> = {
    jd: '京东', taobao: '淘宝', tmall: '天猫',
};

const mediaDomains: Record<ProductCapturePlatform, string[]> = {
    jd: ['jd.com', 'jd.hk', 'jdimg.com', '360buyimg.com', 'jcloudcs.com'],
    taobao: ['alicdn.com', 'taobaocdn.com'],
    tmall: ['alicdn.com', 'taobaocdn.com'],
};

const invalid = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };

function remoteUrl(value: unknown): URL {
    let url;
    try { url = new URL(String(value || '')); }
    catch { return invalid('INVALID_MEDIA_SOURCE', '商品来源链接无效'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
        return invalid('INVALID_MEDIA_SOURCE', '商品来源必须是无凭据的 HTTP/HTTPS 地址');
    }
    return url;
}

export function validateProductCaptureIdentity(platformInput: unknown, externalId: string, sourceUrl: string): ProductCapturePlatform {
    const platform = String(platformInput || '').trim().toLowerCase() as ProductCapturePlatform;
    const url = remoteUrl(sourceUrl);
    if (!/^\d+$/.test(externalId)) return invalid('INVALID_CAPTURE_PAYLOAD', '商品标识无效');
    if (platform === 'jd' && /(^|\.)jd\.(com|hk)$/.test(url.hostname) && /\/\d+\.html$/.test(url.pathname)) return platform;
    if ((platform === 'taobao' && url.hostname === 'item.taobao.com' || platform === 'tmall' && ['detail.tmall.com', 'chaoshi.detail.tmall.com'].includes(url.hostname))
        && url.pathname === '/item.htm' && url.searchParams.get('id') === externalId) return platform;
    return invalid('INVALID_CAPTURE_PAYLOAD', '来源平台、商品标识与详情页地址不一致');
}

export function validateProductMediaSource(platform: string, value: unknown): string {
    const url = remoteUrl(value);
    const allowed = mediaDomains[platform as ProductCapturePlatform];
    if (!allowed?.some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`))) {
        return invalid('INVALID_MEDIA_SOURCE', '商品图片必须来自所属平台的图片服务');
    }
    // Known loading tile and charity icon verified from saved local captures.
    // Keep real small photos and banners; do not classify images by dimensions.
    if (isProductCaptureUiImage(platform, url.href)) {
        return invalid('INVALID_MEDIA_SOURCE', '已忽略平台加载占位图或公益图标');
    }
    return url.href;
}

export function isProductCaptureUiImage(platform: string, value: unknown): boolean {
    if (!['taobao', 'tmall'].includes(platform)) return false;
    try {
        const url = new URL(String(value || ''));
        return /(^|\.)(alicdn\.com|taobaocdn\.com)$/.test(url.hostname)
            && /\/(?:O1CN01Dqo1gd1wMhnobvRco_!!6000000006294-2-tps-145-145\.png|O1CN010DB1Un24kXOjdGhG3_!!6000000007429-0-tps-84-82\.jpg)(?:_|$)/.test(url.pathname);
    } catch { return false; }
}

// Validate each redirect before sending a request, rather than only the final URL.
export async function fetchProductMedia(platform: string, value: unknown, headers: Record<string, string>, fetchImpl: typeof fetch = fetch, parentSignal?: AbortSignal): Promise<Response> {
    let url = validateProductMediaSource(platform, value);
    const timeout = AbortSignal.timeout(15_000);
    const signal = parentSignal ? AbortSignal.any([timeout, parentSignal]) : timeout;
    for (let hop = 0; hop <= 4; hop += 1) {
        const response = await fetchImpl(url, { headers, redirect: 'manual', signal });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            if (!location || hop === 4) throw new Error('商品图片重定向无效或次数过多');
            url = validateProductMediaSource(platform, new URL(location, url).href);
            continue;
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw Object.assign(new Error(`商品图片下载失败（HTTP ${response.status}）`), { status: response.status });
        }
        if (response.url) validateProductMediaSource(platform, response.url);
        return response;
    }
    throw new Error('商品图片下载失败');
}

// Bound streamed bodies even when a server omits or lies about Content-Length.
export async function readProductMedia(response: Response): Promise<{ contentType: string; buffer: Buffer }> {
    const maximum = 12 * 1024 * 1024;
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const reject = async (message: string): Promise<never> => { await response.body?.cancel(); throw new Error(message); };
    if (!['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(contentType)) return reject('商品图片响应类型无效');
    if (Number(response.headers.get('content-length') || 0) > maximum) return reject('商品图片超过 12MB');
    if (!response.body) throw new Error('商品图片为空');
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maximum) { await reader.cancel(); throw new Error('商品图片超过 12MB'); }
            chunks.push(Buffer.from(value));
        }
    } finally { reader.releaseLock(); }
    if (!size) throw new Error('商品图片为空');
    const buffer = Buffer.concat(chunks, size);
    const prefix = buffer.subarray(0, 12);
    const kind = contentType.replace('image/', '');
    const valid = ['jpeg', 'jpg', 'pjpeg'].includes(kind) ? prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff
        : kind === 'png' ? prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : kind === 'webp' ? prefix.subarray(0, 4).toString() === 'RIFF' && prefix.subarray(8, 12).toString() === 'WEBP'
        : kind === 'gif' ? /^GIF8[79]a$/.test(prefix.subarray(0, 6).toString())
        : prefix.subarray(4, 8).toString() === 'ftyp' && ['avif', 'avis'].includes(prefix.subarray(8, 12).toString());
    if (!valid) throw new Error('商品图片内容与类型不一致');
    return { contentType, buffer };
}
