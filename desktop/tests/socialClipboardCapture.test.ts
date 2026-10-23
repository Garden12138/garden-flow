import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle the renderer's pure detectors so these tests use the same imports as Vite.
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/features/capture/clipboardDetector.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
const { detectClipboardCaptureCandidate: detect, clipboardCaptureDedupeKey: key } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('clipboard accepts platform videos, galleries, modal URLs and share text without changing YouTube', () => {
    const cases = [
        ['https://www.douyin.com/note/1234567890123456789', 'douyin', 'douyin-image'],
        ['https://www.douyin.com/jingxuan?modal_id=1234567890123456789', 'douyin', 'douyin-video'],
        ['https://www.tiktok.com/@demo/photo/1234567890123456789', 'tiktok', 'tiktok-image'],
        ['https://www.tiktok.com/@demo/video/1234567890123456789', 'tiktok', 'tiktok-video'],
        ['分享给你 https://v.douyin.com/example/。', 'douyin', 'douyin-video'],
        ['分享 vt.tiktok.com/example/。', 'tiktok', 'tiktok-video'],
        ['https://www.xiaohongshu.com/explore/abc123def456?xsec_token=fixture', 'xiaohongshu', 'xhs-note'],
        ['https://youtu.be/abcdefghijk', 'youtube', 'youtube-video'],
    ];
    for (const [url, platform, kind] of cases) {
        const candidate = detect(url, 'paste');
        assert.ok(candidate, url);
        assert.equal(candidate.platform, platform);
        assert.equal(candidate.kind, kind);
    }
    assert.match(detect('分享 vt.tiktok.com/example/。', 'paste').rawUrl, /^https:\/\/vt\.tiktok\.com\/example\/$/);
});

test('clipboard excludes profiles, unsupported schemes and lookalike hosts; platform dedupe keys remain separate', () => {
    for (const url of ['https://www.tiktok.com/@demo', 'https://www.xiaohongshu.com/user/profile/abc123', 'https://www.douyin.com/user/demo', 'https://tiktok.com.evil.example/@demo/video/123456789', 'file:///tiktok.com/@demo/video/123456789']) assert.equal(detect(url, 'paste'), null);
    const douyin = detect('https://www.douyin.com/video/1234567890123456789', 'paste');
    const tiktok = detect('https://www.tiktok.com/@demo/video/1234567890123456789', 'paste');
    assert.notEqual(key(douyin), key(tiktok));
});
