import { normalizeNote, normalizeVideo } from '../electron/core/normalization.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { captureSocialUrlWithIo, withCaptureInstance } from '../electron/core/socialCaptureRuntime.ts';
import { persistSocialKnowledgeEntry, resolveSocialEntryId } from '../electron/core/socialKnowledgeStore.ts';
import { runSocialStructuredCaptureRound, type XhsStructuredCaptureIo } from '../electron/core/socialStructuredCapture.ts';
import { mergeSocialComments, socialPlatformFromUrl } from '../shared/socialCapture.ts';
import type { BrowserKnowledgeEntryPayload } from '../electron/core/browserCapturePayloads.ts';

const ID = '1234567890123456789';

test('comment recapture retains populated metadata while accepting updated zero counts', () => {
    const merged = mergeSocialComments([{ id: 'c1', text: 'Comment', author: 'Reader', createdAt: '2026-06-04', likes: 2 }], [{ id: 'c1', text: 'Comment', author: '', createdAt: undefined, likes: 0 }]);
    assert.deepEqual(merged, [{ id: 'c1', text: 'Comment', author: 'Reader', createdAt: '2026-06-04', likes: 0 }]);
});

test('comment recapture upgrades a generated DOM identity to the real ID without duplicating the snapshot', () => {
    const old = { id: '/@reader|2025-8-1|Great garden', authorProfileUrl: 'https://www.tiktok.com/@reader', author: 'Reader', createdAt: '2025-8-1', text: 'Great garden', likes: 2 };
    const current = { ...old, id: '7533587406206141189', createdAt: '2025-08-01T12:06:56.000Z', likes: 0 };
    assert.deepEqual(mergeSocialComments([old], [current]), [current]);
    assert.deepEqual(mergeSocialComments([old, current], []), [current]);
    const laterDomSnapshot = { ...old, likes: 3 };
    assert.deepEqual(mergeSocialComments([current], [laterDomSnapshot]), [{ ...current, likes: 3 }]);
});

test('comment identity upgrades preserve distinct real IDs, other dates and ambiguous matches', () => {
    const old = { id: '/@reader|2025-8-1|Great garden', authorProfileUrl: 'https://www.tiktok.com/@reader', createdAt: '2025-8-1', text: 'Great garden' };
    const first = { ...old, id: '111', createdAt: '2025-08-01T12:06:56.000Z' };
    const second = { ...first, id: '222' };
    assert.equal(mergeSocialComments([first], [second]).length, 2);
    assert.equal(mergeSocialComments([old, first, second], []).length, 3);
    assert.equal(mergeSocialComments([old], [{ ...first, createdAt: '2025-08-02T12:06:56.000Z' }]).length, 2);
    assert.equal(mergeSocialComments([old], [{ ...first, authorProfileUrl: 'https://www.tiktok.com/@another' }]).length, 2);
});

test('upgrading a parent comment ID preserves existing reply relationships', () => {
    const old = { id: '/@reader|2025-8-1|Great garden', authorProfileUrl: 'https://www.tiktok.com/@reader', createdAt: '2025-8-1', text: 'Great garden' };
    const reply = { id: 'reply-1', text: 'Thank you', parentCommentId: old.id, rootCommentId: old.id, level: 1 };
    const current = { ...old, id: '7533587406206141189', createdAt: '2025-08-01T12:06:56.000Z' };
    const merged = mergeSocialComments([old, reply], [current]);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged.find(item => item.id === reply.id), { ...reply, parentCommentId: current.id, rootCommentId: current.id });
    assert.equal(reply.parentCommentId, old.id);
});
function entry(platform: 'douyin' | 'tiktok', form: 'video' | 'image_text' = 'video'): BrowserKnowledgeEntryPayload {
    const url = platform === 'douyin' ? `https://www.douyin.com/${form === 'video' ? 'video' : 'note'}/${ID}` : `https://www.tiktok.com/@demo/${form === 'video' ? 'video' : 'photo'}/${ID}`;
    return { platform, contentType: form, kind: `${platform}-${form === 'video' ? 'video' : 'image'}`, source: { sourceUrl: url, externalId: ID }, content: { title: '演示作品', text: '正文', author: '园主', publishedAt: '2026-06-04T00:00:00.000Z', commentsSnapshot: [{ id: 'c1', author: '读者', text: '评论一' }] }, assets: { coverUrl: 'https://media.example/cover.jpg', videoUrl: form === 'video' ? 'https://media.example/video.mp4' : '', imageUrls: form === 'image_text' ? ['https://media.example/1.jpg', 'https://media.example/2.jpg'] : [] }, capture: { status: 'complete', media: 'complete', comments: 'complete', commentLimit: 5, capturedComments: 1, errors: [] } };
}

async function storeFixture(t: any) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-social-'));
    t.after(() => fs.rm(root, { force: true, recursive: true }));
    let failMedia = false;
    const downloads: string[] = [];
    const saved: any[] = [];
    const io = {
        root,
        createPersister: (directory: string) => {
            const write = async (url: string, name = 'media') => {
                downloads.push(url);
                if (failMedia || url.includes('fail')) throw new Error('403 Forbidden');
                const file = `${name}.${url.endsWith('.mp4') ? 'mp4' : 'jpg'}`;
                await fs.writeFile(path.join(directory, file), url);
                return file;
            };
            return { persistImage: write, persistVideo: write };
        },
        verifyVideo: async (file: string) => { assert.match(await fs.readFile(file, 'utf8'), /video\.mp4/); },
        onSaved: async (id: string, directory: string, meta: any, updated: boolean) => { saved.push({ id, directory, meta, updated }); },
    };
    return { root, io, downloads, saved, fail: () => { failMedia = true; } };
}

test('three platforms with identical IDs remain isolated and verified legacy directories are reused', async (t) => {
    const fixture = await storeFixture(t);
    const legacy = path.join(fixture.root, ID);
    await fs.mkdir(legacy);
    await fs.writeFile(path.join(legacy, 'meta.json'), JSON.stringify({ sourceUrl: `https://www.xiaohongshu.com/explore/${ID}`, title: '历史小红书' }));
    const dy = await persistSocialKnowledgeEntry(entry('douyin'), fixture.io);
    const tt = await persistSocialKnowledgeEntry(entry('tiktok'), fixture.io);
    assert.notEqual(dy.entryId, tt.entryId);
    assert.equal(await resolveSocialEntryId(fixture.root, 'xiaohongshu', ID), ID);
    assert.equal(JSON.parse(await fs.readFile(path.join(legacy, 'meta.json'), 'utf8')).title, '历史小红书');
    const another = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-legacy-social-'));
    t.after(() => fs.rm(another, { recursive: true, force: true }));
    await fs.mkdir(path.join(another, ID));
    await fs.writeFile(path.join(another, ID, 'meta.json'), JSON.stringify({ sourceUrl: entry('douyin').source!.sourceUrl }));
    assert.equal(await resolveSocialEntryId(another, 'douyin', ID), ID);
    assert.equal(await resolveSocialEntryId(another, 'tiktok', ID), `tiktok_${ID}`);
});

test('recapture preserves downloaded video, text and comments when extraction or media is unavailable', async (t) => {
    const fixture = await storeFixture(t);
    const initial = await persistSocialKnowledgeEntry(entry('douyin'), fixture.io);
    const old = fixture.saved[0].meta;
    fixture.fail();
    const recapture = entry('douyin');
    recapture.content = { text: '', commentsSnapshot: [{ id: 'c2', author: '另一位', text: '评论二', parentCommentId: 'c1', rootCommentId: 'c1', level: 1 }] };
    recapture.assets = {};
    recapture.capture = { status: 'partial', media: 'partial', comments: 'partial', commentLimit: 5, capturedComments: 1, errors: ['提取不完整'] };
    const result = await persistSocialKnowledgeEntry(recapture, fixture.io);
    assert.equal(result.entryId, initial.entryId);
    assert.equal(result.updated, true);
    assert.equal(result.capture.status, 'partial');
    const meta = fixture.saved.at(-1).meta;
    assert.equal(meta.video, old.video);
    assert.equal(meta.content, '正文');
    assert.equal(meta.commentsSnapshot.length, 2);
    assert.equal(meta.commentsSnapshot[1].parentCommentId, 'c1');
    assert.equal(fixture.downloads.length, 2);
    await fs.access(path.join(fixture.root, initial.entryId, meta.video));
});

test('video download falls back after a rejected candidate and retains the successful local file on recapture', async (t) => {
    const fixture = await storeFixture(t);
    const input = entry('tiktok');
    input.assets!.videoUrl = 'https://media.example/fail.mp4';
    input.assets!.videoUrls = [input.assets!.videoUrl, 'https://media.example/video.mp4', 'https://media.example/unused.mp4'];
    const first = await persistSocialKnowledgeEntry(input, fixture.io);
    assert.equal(first.capture.status, 'complete');
    const local = fixture.saved.at(-1).meta.video;
    assert.equal(fixture.saved.at(-1).meta.videoUrl, 'https://media.example/video.mp4');
    assert.deepEqual(fixture.downloads, ['https://media.example/cover.jpg', 'https://media.example/fail.mp4', 'https://media.example/video.mp4']);
    fixture.fail();
    const again = await persistSocialKnowledgeEntry(input, fixture.io);
    assert.equal(again.entryId, first.entryId);
    assert.equal(again.capture.status, 'complete');
    assert.equal(fixture.saved.at(-1).meta.video, local);
    assert.equal(fixture.downloads.length, 3);
});

test('undecodable video candidates are removed before trying another URL, and retries are bounded', async (t) => {
    const fixture = await storeFixture(t);
    const input = entry('tiktok');
    input.assets!.videoUrl = 'https://media.example/bad.mp4';
    input.assets!.videoUrls = ['https://media.example/video.mp4'];
    const verify = fixture.io.verifyVideo;
    fixture.io.verifyVideo = async (file: string) => {
        if ((await fs.readFile(file, 'utf8')).includes('bad.mp4')) throw new Error('not decodable');
        await verify(file);
    };
    const result = await persistSocialKnowledgeEntry(input, fixture.io);
    assert.equal(result.capture.media, 'complete');
    const directory = path.join(fixture.root, result.entryId);
    assert.equal((await fs.readdir(directory)).filter(file => file.endsWith('.mp4')).length, 1);
    const failing = await storeFixture(t);
    failing.fail();
    input.assets!.videoUrls = Array.from({ length: 8 }, (_, index) => `https://media.example/fail-${index}.mp4`);
    const partial = await persistSocialKnowledgeEntry(input, failing.io);
    assert.equal(partial.capture.status, 'partial');
    assert.equal(failing.downloads.filter(url => url.endsWith('.mp4')).length, 3);
    assert.match(partial.capture.errors.join(' '), /403 Forbidden/);
});

test('partial gallery fills missing slots in place and does not reorder or overwrite saved images', async (t) => {
    const fixture = await storeFixture(t);
    const first = entry('tiktok', 'image_text');
    first.assets!.imageUrls![1] = 'https://media.example/fail.jpg';
    const partial = await persistSocialKnowledgeEntry(first, fixture.io);
    assert.equal(partial.capture.status, 'partial');
    const originalFirst = fixture.saved.at(-1).meta.galleryImages[0];
    const complete = await persistSocialKnowledgeEntry(entry('tiktok', 'image_text'), fixture.io);
    assert.equal(complete.entryId, partial.entryId);
    assert.equal(complete.capture.status, 'complete');
    const meta = fixture.saved.at(-1).meta;
    assert.equal(meta.galleryImages[0], originalFirst);
    assert.match(await fs.readFile(path.join(fixture.root, complete.entryId, meta.images[0]), 'utf8'), /1\.jpg/);
    assert.match(await fs.readFile(path.join(fixture.root, complete.entryId, meta.images[1]), 'utf8'), /2\.jpg/);
});

test('missing post metadata remains partial and recapture completes the same files and entry', async (t) => {
    const fixture = await storeFixture(t);
    const incomplete = entry('douyin');
    incomplete.content!.author = '';
    incomplete.content!.publishedAt = '';
    const initial = await persistSocialKnowledgeEntry(incomplete, fixture.io);
    assert.equal(initial.capture.status, 'partial');
    assert.deepEqual(initial.capture.errors, ['未获取到作品作者', '未获取到作品发布时间']);
    const originalVideo = fixture.saved.at(-1).meta.video;
    const completed = await persistSocialKnowledgeEntry(entry('douyin'), fixture.io);
    assert.equal(completed.entryId, initial.entryId);
    assert.equal(completed.capture.status, 'complete');
    assert.equal(fixture.saved.at(-1).meta.video, originalVideo);
    const emptyRetry = entry('douyin');
    emptyRetry.content!.author = '';
    emptyRetry.content!.publishedAt = '';
    assert.equal((await persistSocialKnowledgeEntry(emptyRetry, fixture.io)).capture.status, 'complete');
    assert.equal(fixture.saved.at(-1).meta.author, '园主');
    assert.equal(fixture.downloads.length, 2);
});

test('concurrent duplicate saves serialize, reject identity mismatch, and respect separate spaces', async (t) => {
    const fixture = await storeFixture(t);
    const results = await Promise.all([persistSocialKnowledgeEntry(entry('douyin'), fixture.io), persistSocialKnowledgeEntry(entry('douyin'), fixture.io)]);
    assert.deepEqual(results.map((result) => result.updated), [false, true]);
    assert.equal(fixture.downloads.length, 2);
    const other = await storeFixture(t);
    assert.equal((await persistSocialKnowledgeEntry(entry('douyin'), other.io)).updated, false);
    const invalid = entry('douyin'); invalid.source!.externalId = '99999999';
    await assert.rejects(persistSocialKnowledgeEntry(invalid, fixture.io), /标识不一致/);
    const wrongKind = entry('douyin'); wrongKind.kind = 'tiktok-video';
    await assert.rejects(persistSocialKnowledgeEntry(wrongKind, fixture.io), /标识不一致/);
    assert.equal(socialPlatformFromUrl('https://www.tiktok.com.evil.test/@demo/video/1'), null);
});

function browserIo(handler: (name: string, args: any) => unknown): XhsStructuredCaptureIo & { calls: any[] } {
    const calls: any[] = [];
    return { calls, checkPluginInstance: () => ({ ok: true, detail: 'ok' }), sleep: async () => undefined,
        invokeBrowserControl: async (_method, params) => { const name = String(params.name); const args = params.arguments || {}; calls.push({ name, args }); return handler(name, args); } };
}

test('short URLs verify redirect identity and pin capture space before saving; foreign redirects never save', async () => {
    const io = browserIo((name) => name === 'tab.create' ? { success: true, tab: { id: 8 } } : name === 'tab.info' ? { success: true, tab: { url: entry('tiktok').source!.sourceUrl } } : { success: true, noteId: 'tiktok_saved' });
    const result = await captureSocialUrlWithIo({ url: 'https://vm.tiktok.com/demo/', captureSpaceId: 'original-space', commentLimit: 5 }, io);
    assert.equal(result.noteId, 'tiktok_saved');
    const args = io.calls.find((call) => call.name === 'capture.save').args;
    assert.equal(args.captureSpaceId, 'original-space');
    assert.deepEqual(args.expectedContent, { platform: 'tiktok', externalId: ID });
    assert.equal(io.calls.at(-1).name, 'tab.close');
    const foreign = browserIo((name) => name === 'tab.create' ? { success: true, tab: { id: 8 } } : { success: true, tab: { url: entry('douyin').source!.sourceUrl } });
    await assert.rejects(captureSocialUrlWithIo({ url: 'https://vm.tiktok.com/demo/', captureSpaceId: 'default', commentLimit: 0 }, foreign), /其他平台/);
    assert.ok(!foreign.calls.some((call) => call.name === 'capture.save'));
    assert.deepEqual(foreign.calls.find((call) => call.name === 'tab.activate').args, { tabId: 8 });
    const changed = browserIo((name) => name === 'tab.create' ? { success: true, tab: { id: 8 } } : { success: true, tab: { url: `https://www.tiktok.com/@demo/video/999999999` } });
    await assert.rejects(captureSocialUrlWithIo({ url: entry('tiktok').source!.sourceUrl!, captureSpaceId: 'default', commentLimit: 0 }, changed), /确认链接/);
});

for (const url of ['https://vm.tiktok.com/fixture/', 'https://vt.tiktok.com/fixture/', 'https://www.tiktok.com/t/fixture/']) {
    for (const form of ['video', 'image_text'] as const) {
        test(`${url}: controlled ${form} redirect preserves the exact target and expired links never save`, async () => {
            const target = entry('tiktok', form).source!.sourceUrl!;
            const io = browserIo((name) => name === 'tab.create' ? { success: true, tab: { id: 8 } } : name === 'tab.info' ? { success: true, tab: { url: target } } : { success: true, noteId: `tiktok_${ID}` });
            await captureSocialUrlWithIo({ url, captureSpaceId: 'acceptance-space', commentLimit: 0 }, io);
            const args = io.calls.find((call) => call.name === 'capture.save').args;
            assert.deepEqual(args.expectedContent, { platform: 'tiktok', externalId: ID });
            assert.equal(args.captureSpaceId, 'acceptance-space');
            assert.equal(args.commentLimit, 0);
            const expired = browserIo((name) => name === 'tab.create' ? { success: true, tab: { id: 8 } } : { success: true, tab: { url: 'https://www.tiktok.com/' } });
            await assert.rejects(captureSocialUrlWithIo({ url, captureSpaceId: 'acceptance-space', commentLimit: 0 }, expired), /确认链接/);
            assert.equal(expired.calls.filter((call) => call.name === 'tab.info').length, 20);
            assert.equal(expired.calls.filter((call) => call.name === 'capture.save').length, 0);
            assert.equal(expired.calls.at(-1).name, 'tabs.finalize');
        });
    }
}

test('short URL capture locks the first post before a slow page load can autoplay a recommendation', async () => {
    const originalUrl = entry('tiktok').source!.sourceUrl!;
    const recommendationUrl = 'https://www.tiktok.com/@other/video/999999999';
    let waitedForLoad = true;
    let infoReads = 0;
    const io = browserIo((name, args) => {
        if (name === 'tab.create') {
            waitedForLoad = args.waitUntilComplete !== false || args.active !== false;
            return { success: true, tab: { id: 8 } };
        }
        if (name === 'tab.info') {
            infoReads += 1;
            return { success: true, tab: { url: waitedForLoad ? recommendationUrl : infoReads === 1 ? 'about:blank' : originalUrl } };
        }
        if (name === 'capture.save') {
            assert.deepEqual(args.expectedContent, { platform: 'tiktok', externalId: ID });
            return { success: true, noteId: `tiktok_${ID}` };
        }
        return { success: true };
    });
    const result = await captureSocialUrlWithIo({ url: 'https://vt.tiktok.com/shared/', captureSpaceId: 'original-space', commentLimit: 5 }, io);
    assert.equal(result.noteId, `tiktok_${ID}`);
    assert.equal(infoReads, 3);
});

test('link capture waits for the locked post navigation to finish before extracting', async () => {
    const target = entry('tiktok').source!.sourceUrl!;
    let loaded = false;
    let activated = false;
    const io = browserIo((name) => {
        if (name === 'tab.create') return { success: true, tab: { id: 8 } };
        if (name === 'tab.info') return { success: true, tab: { url: target } };
        if (name === 'tab.activate') { activated = true; return { success: true }; }
        if (name === 'page.waitForLoadState') {
            assert.equal(activated, true, 'Let the locked detail hydrate in an active tab');
            loaded = true;
            return { success: true };
        }
        if (name === 'capture.save') {
            assert.equal(loaded, true, 'Do not inject into the previous frame while the target navigation is loading');
            return { success: true, noteId: `tiktok_${ID}` };
        }
        return { success: true };
    });
    await captureSocialUrlWithIo({ url: 'https://vm.tiktok.com/loading/', captureSpaceId: 'acceptance-space', commentLimit: 0 }, io);
});

for (const nextUrl of ['https://www.tiktok.com/@other/video/999999999', 'https://www.douyin.com/video/999999999']) {
    test(`link capture refuses a changed target after navigation finishes: ${nextUrl}`, async () => {
        let loaded = false;
        const io = browserIo((name) => {
            if (name === 'tab.create') return { success: true, tab: { id: 8 } };
            if (name === 'tab.info') return { success: true, tab: { url: loaded ? nextUrl : entry('tiktok').source!.sourceUrl! } };
            if (name === 'page.waitForLoadState') { loaded = true; return { success: true }; }
            return { success: true, noteId: 'must-not-save' };
        });
        await assert.rejects(captureSocialUrlWithIo({ url: 'https://vm.tiktok.com/loading/', captureSpaceId: 'acceptance-space', commentLimit: 0 }, io), /作品已变化/);
        assert.equal(io.calls.filter(call => call.name === 'capture.save').length, 0);
        assert.equal(io.calls.at(-1).name, 'tabs.finalize');
    });
}

test('link capture stops when waiting for navigation fails', async () => {
    const io = browserIo((name) => name === 'tab.create' ? { success: true, tab: { id: 8 } }
        : name === 'tab.info' ? { success: true, tab: { url: entry('tiktok').source!.sourceUrl! } }
            : name === 'page.waitForLoadState' ? { success: false, error: 'navigation timed out' } : { success: true });
    await assert.rejects(captureSocialUrlWithIo({ url: 'https://vm.tiktok.com/loading/', captureSpaceId: 'acceptance-space', commentLimit: 0 }, io), /navigation timed out/);
    assert.equal(io.calls.filter(call => call.name === 'capture.save').length, 0);
});

for (const platform of ['douyin', 'tiktok'] as const) {
    test(`${platform}: repeated media failures cannot expand a one-post round into unbounded captures`, async () => {
        const card = (index: number) => {
            const id = String(BigInt(ID) + BigInt(index));
            return { id, sourceUrl: platform === 'douyin' ? `https://www.douyin.com/video/${id}` : `https://www.tiktok.com/@demo/video/${id}`, interactionRef: { kind: 'site_card', site: platform, itemId: id } };
        };
        const io = browserIo((name, args) => {
            if (name === 'research.run' && args.executionMode === 'open_item') return { success: true, targetTabId: 11, openState: { sourceTabId: 11, targetTabId: 11, openedIn: 'same_tab_overlay' } };
            if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
            if (name === 'research.run') return { success: true, tab: { id: 11 }, items: args.executionMode === 'extract' ? Array.from({ length: 40 }, (_, index) => card(index)) : [card(0)] };
            return { success: true, noteId: `${platform}_${args.expectedContent.externalId}`, capture: { status: 'partial' } };
        });
        const round = await runSocialStructuredCaptureRound({ platform, keyword: 'garden', maxNotes: 1, pacing: 'normal' }, io);
        assert.equal(round.saved, 0);
        assert.equal(round.attempted, 9);
        assert.equal(round.partial, 9);
        assert.equal(round.status, 'partial');
        assert.match(round.reason || '', /候选作品上限.*新入库 0 条/);
        assert.equal(io.calls.filter(call => call.name === 'capture.save').length, 9);
    });

    test(`${platform}: an all-duplicate round reports zero new entries and an unmet quota`, async () => {
        const io = browserIo((name, args) => {
            if (name === 'research.run' && args.executionMode === 'open_item') return { success: true, targetTabId: 11, openState: { sourceTabId: 11, targetTabId: 11, openedIn: 'same_tab_overlay' } };
            if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
            if (name === 'research.run') return { success: true, tab: { id: 11 }, items: [{ id: ID, sourceUrl: entry(platform).source!.sourceUrl, interactionRef: { kind: 'site_card', site: platform, itemId: ID } }] };
            return { success: true, noteId: `${platform}_${ID}`, updated: true, capture: { status: 'complete' } };
        });
        const round = await runSocialStructuredCaptureRound({ platform, keyword: 'garden', maxNotes: 1, pacing: 'normal' }, io);
        assert.equal(round.saved, 0);
        assert.equal(round.duplicates, 1);
        assert.equal(round.updated, 1);
        assert.equal(round.status, 'partial');
        assert.match(round.reason || '', /全部重复.*新入库 0 条/);
    });

    test(`${platform}: partial saves and duplicates do not fill the complete-new quota`, async () => {
        const ids = [ID, '2234567890123456789', '3234567890123456789'];
        let save = 0;
        const io = browserIo((name, args) => {
            if (name === 'research.run' && args.executionMode === 'open_item') return { success: true, targetTabId: 11, openState: { sourceTabId: 11, targetTabId: 11, openedIn: 'same_tab_overlay' } };
            if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
            if (name === 'research.run') return { success: true, tab: { id: 11 }, items: ids.map((id) => ({ id, sourceUrl: platform === 'douyin' ? `https://www.douyin.com/video/${id}` : `https://www.tiktok.com/@demo/video/${id}`, interactionRef: { kind: 'site_card', site: platform, itemId: id } })) };
            save += 1;
            return { success: true, noteId: `${platform}_${ids[save - 1]}`, duplicate: save === 2, capture: { status: save === 1 ? 'partial' : 'complete' } };
        });
        const result = await runSocialStructuredCaptureRound({ platform, keyword: 'garden', maxNotes: 1, pacing: 'normal', captureSpaceId: 'original', commentLimit: 5 }, io);
        assert.equal(io.calls[0].args.reuseExistingTab, false);
        assert.equal(result.saved, 1); assert.equal(result.partial, 1); assert.equal(result.duplicates, 1); assert.equal(result.status, 'partial');
        assert.equal(io.calls.filter((call) => call.name === 'capture.save').length, 3);
        assert.ok(io.calls.filter((call) => call.name === 'capture.save').every((call) => call.args.captureSpaceId === 'original' && call.args.expectedContent.platform === platform));
    });
}

test('the shared browser lease serializes tasks, pins an instance and releases after failure', async () => {
    const first = { extensionKind: 'capture', extensionInstanceId: 'first' };
    const second = { extensionKind: 'capture', extensionInstanceId: 'second' };
    let instances = [first, second];
    const forwards: any[] = [];
    const bridge: any = { getStatus: () => ({ instances }), invokeBrowserControl: async (_method: string, params: any, options: any) => { forwards.push({ params, options }); return { success: true }; } };
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let running = 0;
    let peak = 0;
    const action = async (io: XhsStructuredCaptureIo) => {
        running += 1; peak = Math.max(peak, running); entered();
        await pending;
        instances = [second, first];
        await io.invokeBrowserControl('tools/call', { name: 'capture.save', arguments: { tabId: 1 } });
        running -= 1;
    };
    const a = withCaptureInstance(action, undefined, bridge);
    const b = withCaptureInstance(action, undefined, bridge);
    await started; release(); await Promise.all([a, b]);
    assert.equal(peak, 1);
    assert.ok(forwards.every((call) => call.options.extensionInstanceId === 'first'));
    assert.ok(forwards.every((call) => call.params.arguments.sessionId.startsWith('social-capture-')));
    instances = [first, second];
    await assert.rejects(withCaptureInstance(async (io) => {
        instances = [second];
        await io.invokeBrowserControl('tools/call', { name: 'capture.save', arguments: {} });
    }, undefined, bridge), /实例已断开/);
    await withCaptureInstance(async () => 'recovered', undefined, bridge);
});

test('a reconnected native host cannot resume a round that pinned the previous connection', async () => {
    let instance = { extensionKind: 'capture', extensionInstanceId: 'same-browser', hostInstanceId: 'old-host' };
    let forwards = 0;
    const bridge: any = { getStatus: () => ({ instances: [instance] }), invokeBrowserControl: async () => { forwards += 1; return { success: true }; } };
    await assert.rejects(withCaptureInstance(async io => {
        instance = { ...instance, hostInstanceId: 'new-host' };
        assert.equal(io.checkPluginInstance().ok, false);
        await io.invokeBrowserControl('tools/call', { name: 'capture.save', arguments: {} });
    }, undefined, bridge), { code: 'BROWSER_INSTANCE_UNAVAILABLE' });
    assert.equal(forwards, 0);
    await withCaptureInstance(async io => { assert.equal(io.checkPluginInstance().ok, true); }, undefined, bridge);
});

test('disconnect during capture reports a stopped round and keeps earlier partial entries', async () => {
    const ids = [ID, '2234567890123456789'];
    let saves = 0;
    const io = browserIo((name, args) => {
        if (name === 'research.run' && args.executionMode === 'open_item') return { success: true, targetTabId: 11, openState: { sourceTabId: 11, targetTabId: 11, openedIn: 'same_tab_overlay' } };
        if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
        if (name === 'research.run') return { success: true, tab: { id: 11 }, items: ids.map(id => ({ id, sourceUrl: `https://www.douyin.com/video/${id}`, interactionRef: { kind: 'site_card', site: 'douyin', itemId: id } })) };
        saves += 1;
        if (saves === 2) throw Object.assign(new Error('channel disconnected'), { code: 'BROWSER_INSTANCE_UNAVAILABLE' });
        return { success: true, noteId: `douyin_${ID}`, capture: { status: 'partial' } };
    });
    const round = await runSocialStructuredCaptureRound({ platform: 'douyin', keyword: 'garden', maxNotes: 1, pacing: 'normal' }, io);
    assert.equal(round.partial, 1);
    assert.equal(round.status, 'partial');
    assert.equal(round.notes[0].entryId, `douyin_${ID}`);
    assert.match(round.reason || '', /插件实例已断开.*已停止/);
    assert.equal(saves, 2);
});

test('social video transcription preserves the original platform, source URL and note identity in search', () => {
    const meta = { platform: 'tiktok', sourceUrl: entry('tiktok').source!.sourceUrl, content: 'Original caption', author: 'Demo', videoUrl: 'https://media.example/video.mp4' };
    const indexed = normalizeVideo(`tiktok_${ID}`, meta, 'Transcript');
    assert.equal(indexed.displayData.platform, 'tiktok');
    assert.equal(indexed.displayData.url, meta.sourceUrl);
    assert.equal(indexed.sourceId, `tiktok_${ID}`);
    assert.match(indexed.content, /Original caption/);
    assert.match(indexed.content, /Transcript/);
    assert.equal(normalizeNote('legacy', { type: 'douyin-video' }, 'caption').displayData.platform, 'douyin');
    assert.equal(normalizeVideo('youtube', { videoId: 'youtube' }, 'Transcript').displayData.platform, 'youtube');
});

test('a saved post with a failed return to search remains partial and stops navigation', async () => {
    let saves = 0;
    const io = browserIo((name, args) => {
        if (name === 'research.run' && args.executionMode === 'open_item') return { success: true, targetTabId: 11, openState: { sourceTabId: 11, targetTabId: 11, openedIn: 'same_tab_route' } };
        if (name === 'research.run' && args.executionMode === 'close_item') return { success: false, reason: 'restore_failed' };
        if (name === 'research.run') return { success: true, tab: { id: 11 }, items: [{ id: ID, sourceUrl: entry('douyin').source!.sourceUrl, interactionRef: { kind: 'site_card', site: 'douyin', itemId: ID } }] };
        saves += 1;
        return { success: true, noteId: `douyin_${ID}`, capture: { status: 'complete' } };
    });
    const round = await runSocialStructuredCaptureRound({ platform: 'douyin', keyword: 'garden', maxNotes: 1, pacing: 'normal' }, io);
    assert.equal(round.saved, 1);
    assert.equal(round.status, 'partial');
    assert.match(round.reason || '', /无法返回搜索/);
    assert.equal(saves, 1);
});

for (const throws of [false, true]) {
    test(`a failed save (${throws ? 'exception' : 'response'}) stops when search cannot be restored`, async () => {
        let saves = 0;
        const ids = [ID, '2234567890123456789'];
        const io = browserIo((name, args) => {
            if (name === 'research.run' && args.executionMode === 'open_item') return { success: true, targetTabId: 11, openState: { sourceTabId: 11, targetTabId: 11, openedIn: 'same_tab_overlay' } };
            if (name === 'research.run' && args.executionMode === 'close_item') return { success: false, reason: 'restore_failed' };
            if (name === 'research.run') return { success: true, tab: { id: 11 }, items: ids.map(id => ({ id, sourceUrl: `https://www.douyin.com/video/${id}`, interactionRef: { kind: 'site_card', site: 'douyin', itemId: id } })) };
            saves += 1;
            if (throws) throw new Error('media unavailable');
            return { success: false, reason: 'media unavailable' };
        });
        const round = await runSocialStructuredCaptureRound({ platform: 'douyin', keyword: 'garden', maxNotes: 1, pacing: 'normal' }, io);
        assert.equal(round.saved, 0);
        assert.equal(round.failed, 1);
        assert.equal(round.status, 'blocked');
        assert.match(round.reason || '', /无法返回搜索/);
        assert.equal(saves, 1);
    });
}

test('a verification encountered after saving stops the round and retains the partial entry in its report', async () => {
    const io = browserIo((name, args) => {
        if (name === 'research.run' && args.executionMode === 'open_item') return { success: true, targetTabId: 11, openState: { sourceTabId: 11, targetTabId: 11, openedIn: 'same_tab_route' } };
        if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
        if (name === 'research.run') return { success: true, tab: { id: 11 }, items: [{ id: ID, sourceUrl: entry('tiktok').source!.sourceUrl, interactionRef: { kind: 'site_card', site: 'tiktok', itemId: ID } }] };
        return { success: true, noteId: `tiktok_${ID}`, capture: { status: 'partial', blocker: 'BROWSER_SECURITY_CHALLENGE' } };
    });
    const round = await runSocialStructuredCaptureRound({ platform: 'tiktok', keyword: 'garden', maxNotes: 1, pacing: 'normal' }, io);
    assert.equal(round.partial, 1); assert.equal(round.saved, 0); assert.equal(round.status, 'partial');
    assert.equal(round.notes[0].entryId, `tiktok_${ID}`);
    assert.equal(io.calls.filter((call) => call.name === 'capture.save').length, 1);
});

for (const platform of ['douyin', 'tiktok'] as const) {
    for (const partial of [false, true]) {
        test(`${platform}: rate limiting stops later works and retains ${partial ? 'partially sampled comments' : 'earlier complete works'}`, async () => {
            const ids = [ID, '2234567890123456789', '3234567890123456789'];
            let saves = 0;
            const io = browserIo((name, args) => {
                if (name === 'research.run' && args.executionMode === 'open_item') return { success: true, targetTabId: 11, openState: { sourceTabId: 11, targetTabId: 11, openedIn: 'same_tab_route' } };
                if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
                if (name === 'research.run') return { success: true, tab: { id: 11 }, items: ids.map(id => ({ id, sourceUrl: platform === 'douyin' ? `https://www.douyin.com/video/${id}` : `https://www.tiktok.com/@demo/video/${id}`, interactionRef: { kind: 'site_card', site: platform, itemId: id } })) };
                saves += 1;
                if (partial) return { success: true, noteId: `${platform}_${ID}`, capture: { status: 'partial', blocker: 'BROWSER_RATE_LIMITED', comments: 'partial', capturedComments: 1 } };
                if (saves === 1) return { success: true, noteId: `${platform}_${ID}`, capture: { status: 'complete' } };
                return { success: false, code: 'BROWSER_RATE_LIMITED', error: '平台暂时限流，请稍后重试' };
            });
            const round = await runSocialStructuredCaptureRound({ platform, keyword: 'garden', maxNotes: 3, pacing: 'normal' }, io);
            assert.equal(round.status, 'partial');
            assert.equal(round.saved, partial ? 0 : 1);
            assert.equal(round.partial, partial ? 1 : 0);
            assert.equal(round.notes[0].entryId, `${platform}_${ID}`);
            assert.equal(saves, partial ? 1 : 2);
            assert.equal(io.calls.filter((call) => call.name === 'research.run' && call.args.executionMode === 'open_item').length, saves);
        });
    }
}
