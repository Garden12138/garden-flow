import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    applyXhsMediaSlotBinding,
    assertExpectedXhsRevision,
    buildXhsVideoGenerationPrompt,
    createXhsNotePackageManifest,
    isXhsMediaCompatible,
    normalizeXhsNoteDocument,
    planXhsVideoGenerationSegments,
    resolveXhsMediaGenerationSlot,
    renderXhsNoteHtml,
    renderXhsNoteMarkdown,
    sanitizeXhsMaterialFileName,
    uniqueXhsMaterialFileName,
} from '../shared/xhsNote.ts';
import { writeXhsMaterialZip } from '../electron/core/xhsMaterialZip.ts';
import { coerceToGardenFlowAssetUrl } from '../shared/localAsset.ts';

test('accepts only media compatible with an XHS note slot', () => {
    assert.equal(isXhsMediaCompatible('cover', 'image/png'), true);
    assert.equal(isXhsMediaCompatible('image-page', '', 'reference.webp'), true);
    assert.equal(isXhsMediaCompatible('video', 'video/mp4'), true);
    assert.equal(isXhsMediaCompatible('video', 'image/jpeg'), false);
    assert.equal(isXhsMediaCompatible('cover', 'video/mp4'), false);
});

test('normalizes image note pages and creates stable media slots', () => {
    const document = normalizeXhsNoteDocument({
        noteType: 'image',
        title: '周末去露营',
        tags: ['露营', '#周末'],
        pages: [
            { title: '装备清单', content: '帐篷和睡袋', prompt: '俯拍装备' },
            { index: 3, title: '营地晚餐', copy: '简单也很好吃' },
        ],
    });

    assert.equal(document.finalTitle, '周末去露营');
    assert.deepEqual(document.hashtags, ['露营', '周末']);
    assert.deepEqual(document.imagePages.map((page) => page.index), [1, 3]);
    assert.ok(document.mediaSlots.some((slot) => slot.id === 'cover' && slot.role === 'cover'));
    assert.ok(document.mediaSlots.some((slot) => slot.id === 'page-1-image' && slot.pageId === 'page-1'));
    assert.ok(document.mediaSlots.some((slot) => slot.id === 'page-3-image' && slot.pageId === 'page-3'));
});

test('normalizes video-only fields and final video slot', () => {
    const document = normalizeXhsNoteDocument({
        noteType: 'video',
        title: '一分钟收纳',
        script: '先清空桌面，再分类放回。',
        duration: 45,
        aspectRatio: '9:16',
        storyboard: [{ name: '开场', duration: 3, description: '凌乱桌面', narration: '桌面总是很乱？' }],
        subtitles: [{ start: 0, end: 3, content: '桌面总是很乱？' }],
    }, 'video');

    assert.equal(document.voiceover, '先清空桌面，再分类放回。');
    assert.equal(document.durationSeconds, 45);
    assert.equal(document.storyboard[0].shot, '开场');
    assert.equal(document.subtitles[0].text, '桌面总是很乱？');
    assert.ok(document.mediaSlots.some((slot) => slot.id === 'final-video' && slot.role === 'video'));
});

test('plans a 30 second XHS storyboard as bounded generation clips', () => {
    const document = normalizeXhsNoteDocument({
        noteType: 'video',
        durationSeconds: 30,
        storyboard: [3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2].map((durationSeconds, index) => ({
            id: `shot-${index + 1}`,
            index: index + 1,
            durationSeconds,
            visual: `镜头 ${index + 1}`,
        })),
    }, 'video');
    const segments = planXhsVideoGenerationSegments(document, 12);

    assert.deepEqual(segments.map((segment) => segment.durationSeconds), [10, 10, 10]);
    assert.equal(segments.flatMap((segment) => segment.shots).length, 12);
    assert.ok(segments.every((segment) => segment.durationSeconds <= 12));

    const happyHorseSegments = planXhsVideoGenerationSegments(document, 15);
    assert.deepEqual(happyHorseSegments.map((segment) => segment.durationSeconds), [15, 15]);
    assert.equal(happyHorseSegments.flatMap((segment) => segment.shots).length, 12);
    assert.ok(happyHorseSegments.every((segment) => segment.durationSeconds <= 15));

    const qualityFirstSegments = planXhsVideoGenerationSegments(document, 15, 2);
    assert.deepEqual(qualityFirstSegments.map((segment) => segment.durationSeconds), [5, 5, 5, 5, 5, 5]);
    assert.ok(qualityFirstSegments.every((segment) => segment.shots.length <= 2));
});

test('builds a cohesive video prompt with audio-only voiceover and leaves visible copy for post-production', () => {
    const document = normalizeXhsNoteDocument({
        noteType: 'video',
        durationSeconds: 5,
        storyboard: [{
            index: 1,
            durationSeconds: 3,
            visual: '中央弹出价格标题，房间由暗变亮',
            generationPrompt: '固定机位展示同一房间，斑驳墙面由冷灰光线过渡到暖黄色光线，空间透视保持一致，镜头缓慢前推',
            voiceover: '只要五百元就能完成改造',
            onScreenText: '500元改造前后',
        }, {
            index: 2,
            durationSeconds: 2,
            visual: '手贴上有纹理的米白色挂布',
            voiceover: '第一步先处理墙面',
            onScreenText: 'STEP 1 墙面',
        }],
    }, 'video');
    const [segment] = planXhsVideoGenerationSegments(document, 15, 2);
    const prompt = buildXhsVideoGenerationPrompt(segment, {
        segmentCount: 1,
        referenceImageCount: 1,
        generateAudio: true,
    });

    assert.match(prompt, /斑驳墙面由冷灰光线过渡到暖黄色光线/);
    assert.match(prompt, /手贴上有纹理的米白色挂布/);
    assert.match(prompt, /参考图是主体、空间布局、材质、配色与光线的视觉锚点/);
    assert.match(prompt, /口播或对白只用于音轨/);
    assert.match(prompt, /0-3秒声音要求：只要五百元就能完成改造/);
    assert.match(prompt, /3-5秒声音要求：第一步先处理墙面/);
    assert.match(prompt, /全部留给后期剪辑/);
    assert.doesNotMatch(prompt, /500元改造前后/);
    assert.doesNotMatch(prompt, /STEP 1 墙面/);
    assert.doesNotMatch(prompt, /中央弹出价格标题/);

    const silentPrompt = buildXhsVideoGenerationPrompt(segment, {
        segmentCount: 1,
        generateAudio: false,
    });
    assert.doesNotMatch(silentPrompt, /五百元就能完成改造/);
    assert.doesNotMatch(silentPrompt, /第一步先处理墙面/);

    const textPrompt = buildXhsVideoGenerationPrompt(segment, {
        segmentCount: 1,
        generateAudio: true,
        renderText: true,
    });
    assert.match(textPrompt, /只要五百元就能完成改造/);
    assert.match(textPrompt, /需要模型直接呈现的屏幕文字：500元改造前后；STEP 1 墙面/);
});

test('detects revision conflicts', () => {
    assert.doesNotThrow(() => assertExpectedXhsRevision(4, 4));
    assert.throws(() => assertExpectedXhsRevision(4, 3), /REVISION_CONFLICT/);
});

test('binds media to a named slot without changing unrelated slots', () => {
    const document = normalizeXhsNoteDocument({
        noteType: 'image',
        imagePages: [{ id: 'page-a', index: 1, mediaSlotId: 'page-a-image' }],
    });
    const bound = applyXhsMediaSlotBinding(document, {
        slotId: 'page-a-image',
        assetId: 'media-1',
        sourcePath: 'generated/图 1.png',
        mimeType: 'image/png',
        updatedAt: '2026-08-11T00:00:00.000Z',
    });

    const pageSlot = bound.mediaSlots.find((slot) => slot.id === 'page-a-image');
    assert.equal(pageSlot?.assetId, 'media-1');
    assert.equal(pageSlot?.status, 'ready');
    assert.equal(bound.mediaSlots.find((slot) => slot.id === 'cover')?.status, 'empty');
});

test('reuses a ready XHS media slot unless replacement is explicit', () => {
    const document = applyXhsMediaSlotBinding(normalizeXhsNoteDocument({
        noteType: 'image',
        imagePages: [{ id: 'page-a', index: 1, mediaSlotId: 'page-a-image' }],
    }), {
        slotId: 'page-a-image',
        assetId: 'media-existing',
        sourcePath: 'generated/page-a.png',
        mimeType: 'image/png',
    });

    const retryDecision = resolveXhsMediaGenerationSlot(document, {
        slotId: 'page-a-image',
        mediaKind: 'image',
    });
    const replaceDecision = resolveXhsMediaGenerationSlot(document, {
        slotId: 'page-a-image',
        mediaKind: 'image',
        replace: true,
    });

    assert.equal(retryDecision.action, 'reuse');
    assert.equal(retryDecision.slot.assetId, 'media-existing');
    assert.equal(replaceDecision.action, 'generate');
});

test('rejects binding generated media to an incompatible XHS slot', () => {
    const imageDocument = normalizeXhsNoteDocument({ noteType: 'image' });
    const videoDocument = normalizeXhsNoteDocument({ noteType: 'video' }, 'video');

    assert.throws(() => resolveXhsMediaGenerationSlot(imageDocument, {
        slotId: 'cover',
        mediaKind: 'video',
    }), /不接受 视频素材/);
    assert.throws(() => resolveXhsMediaGenerationSlot(videoDocument, {
        slotId: 'final-video',
        mediaKind: 'image',
    }), /不接受 图片素材/);
});

test('keeps local previews on the Electron asset protocol', () => {
    const existingUrl = 'gardenflow-asset://asset//Users/demo/media/cover.png';
    assert.equal(coerceToGardenFlowAssetUrl(existingUrl), existingUrl);
    assert.equal(
        coerceToGardenFlowAssetUrl('/Users/demo/media/封面.png'),
        'gardenflow-asset://asset//Users/demo/media/%E5%B0%81%E9%9D%A2.png',
    );
    assert.equal(
        coerceToGardenFlowAssetUrl('gardenflow-asset://asset///server/share/cover.png'),
        'gardenflow-asset://asset///server/share/cover.png',
    );
});

test('renders portable Markdown and escapes untrusted HTML', () => {
    const document = normalizeXhsNoteDocument({
        noteType: 'image',
        finalTitle: '安全测试 <img src=x onerror=alert(1)>',
        body: '</script><script>alert("x")</script>\n第二行',
        hashtags: ['测试'],
    });
    const markdown = renderXhsNoteMarkdown(document, { cover: 'assets/封面.png' });
    const html = renderXhsNoteHtml(document, { cover: 'assets/封面.png' });

    assert.match(markdown, /!\[封面\]\(assets\/封面.png\)/);
    assert.doesNotMatch(markdown, /data-copy=/);
    assert.doesNotMatch(html, /<img src=x onerror=/);
    assert.doesNotMatch(html, /<script>alert\("x"\)<\/script>/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /navigator\.clipboard/);
    assert.match(html, /execCommand\('copy'\)/);
});

test('builds warning-preserving package manifest', () => {
    const document = normalizeXhsNoteDocument({ noteType: 'video', finalTitle: '缺素材也能导出', revision: 7 }, 'video');
    const manifest = createXhsNotePackageManifest({
        document,
        assets: [{ slotId: 'final-video', role: 'video', status: 'missing' }],
        warnings: ['最终成片未包含可用文件'],
        exportedAt: '2026-08-11T00:00:00.000Z',
    });

    assert.equal(manifest.schema, 'gardenflow-xiaohongshu-material-package');
    assert.equal(manifest.revision, 7);
    assert.equal(manifest.assets[0].status, 'missing');
    assert.deepEqual(manifest.warnings, ['最终成片未包含可用文件']);
});

test('normalizes archive names and deduplicates Unicode file names', () => {
    const used = new Set<string>();
    const safeName = sanitizeXhsMaterialFileName('../../素材/封面?.png', 'cover.png');
    assert.equal(safeName, '封面-.png');
    assert.equal(uniqueXhsMaterialFileName(safeName, used), '封面-.png');
    assert.equal(uniqueXhsMaterialFileName(safeName, used), '封面--2.png');
    assert.ok(!safeName.includes('..'));
    assert.ok(!safeName.includes('/'));
    assert.equal(sanitizeXhsMaterialFileName('C:\\Users\\运营\\成片.mp4', 'video.mp4'), '成片.mp4');
});

test('writes an offline ZIP with HTML, Markdown, manifest and Unicode assets', async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-xhs-note-'));
    try {
        const sourceAsset = path.join(tempDirectory, '封面图片.png');
        const outputPath = path.join(tempDirectory, '素材包.zip');
        await fs.writeFile(sourceAsset, Buffer.from([137, 80, 78, 71]));
        await writeXhsMaterialZip(outputPath, [
            { name: 'index.html', content: '<!doctype html><button data-copy="body">复制</button>' },
            { name: 'content.md', content: '# 标题\n' },
            { name: 'manifest.json', content: '{"schemaVersion":1}\n' },
        ], [
            { name: 'assets/封面图片.png', absolutePath: sourceAsset },
        ]);

        const stats = await fs.stat(outputPath);
        assert.ok(stats.size > 0);
        const listing = spawnSync('unzip', ['-Z1', outputPath], { encoding: 'utf-8' });
        if (!listing.error) {
            assert.equal(listing.status, 0);
            assert.match(listing.stdout, /^index\.html$/m);
            assert.match(listing.stdout, /^content\.md$/m);
            assert.match(listing.stdout, /^manifest\.json$/m);
            assert.match(listing.stdout, /^assets\/.*\.png$/m);
        }
    } finally {
        await fs.rm(tempDirectory, { recursive: true, force: true });
    }
});
