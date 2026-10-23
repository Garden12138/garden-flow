import type { ClipboardCaptureCandidate, ClipboardCaptureSource } from '../captureTypes';
import { hostnameMatches, parseHttpUrl, sanitizeClipboardUrl } from '../clipboardUrlExtractor';

export function detectTikTokClipboardCandidate(rawUrl: string, rawText: string, source: ClipboardCaptureSource): ClipboardCaptureCandidate | null {
    const url = sanitizeClipboardUrl(rawUrl);
    const parsed = parseHttpUrl(url);
    if (!parsed || !hostnameMatches(parsed, ['tiktok.com'])) return null;
    const match = parsed.pathname.match(/^\/@[^/]+\/(video|photo)\/(\d+)/);
    const short = ['vm.tiktok.com', 'vt.tiktok.com'].includes(parsed.hostname) || /^\/t\//.test(parsed.pathname);
    if (!match && !short) return null;
    const kind = match?.[1] === 'photo' ? 'tiktok-image' : 'tiktok-video';
    return { id: `${kind}:${match?.[2] || url}`, kind, platform: 'tiktok', rawText, rawUrl: url, canonicalUrl: url, externalId: match?.[2], confidence: match ? 'exact' : 'probable', source, detectedAt: new Date().toISOString() };
}
