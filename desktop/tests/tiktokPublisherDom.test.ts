import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { probeTikTokPage, tikTokSettingsPage, tikTokSubmitPoint, readTikTokAccount, tikTokCaptionPoint, readTikTokPosts, matchTikTokPostReceipt } from '../../PublishPlugin/src/tiktokAdapter.js';

test('published receipt uses the actual scoped Posts row and rejects ambiguity, gates, mismatches and review labels', async () => {
    const html = await fs.readFile(new URL('../../PublishPlugin/tests/fixtures/tiktok/posts-published.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'https://www.tiktok.com/tiktokstudio/content', runScripts: 'outside-only' });
    const w = dom.window;
    try {
        w.HTMLElement.prototype.getBoundingClientRect = function () { return { width: 100, height: 40 } as DOMRect; };
        const read = () => vm.runInContext('(' + readTikTokPosts.toString() + ')()', dom.getInternalVMContext());
        const request = { accountId: 'fixture_handle', description: 'Product details', hashtags: ['Product'], publishSettings: { visibility: 'only_me' } };
        const match = () => matchTikTokPostReceipt(read(), request);
        assert.equal(match()?.videoId, '7000000000000000001');
        const link = w.document.querySelector<HTMLAnchorElement>('a')!;
        const originalHref = link.getAttribute('href');
        link.href = 'https://evil.invalid/@fixture_handle/video/7000000000000000001'; assert.equal(match(), null);
        link.setAttribute('href', originalHref!);
        assert.equal(matchTikTokPostReceipt(read(), { ...request, accountId: 'other' }), null);
        assert.equal(matchTikTokPostReceipt(read(), { ...request, description: 'changed' }), null);
        assert.equal(matchTikTokPostReceipt(read(), { ...request, publishSettings: { visibility: 'everyone' } }), null);
        assert.equal(matchTikTokPostReceipt(read(), request, 'https://www.tiktok.com/@fixture_handle/video/7000000000000000002'), null);
        const row = link.closest('[data-tt="components_RowLayout_FlexRow"]')!;
        const duplicate = row.cloneNode(true); row.parentElement!.append(duplicate); assert.equal(match(), null); duplicate.remove();
        const stage = row.querySelector('[data-tt="components_PublishStageLabel_TUXText"]')!;
        for (const label of ['Pending review', 'Rejected', 'Published', 'Upload successful']) { stage.textContent = label; assert.equal(match(), null); }
        stage.textContent = 'Oct 11, 12:25 PM';
        const gate = w.document.createElement('div'); gate.setAttribute('role', 'dialog'); w.document.body.append(gate); assert.equal(read(), null); gate.remove();
        const captcha = w.document.createElement('iframe'); captcha.src = 'https://fixture.invalid/captcha'; w.document.body.append(captcha); assert.equal(read(), null); captcha.remove();
        row.querySelector('[data-tt="components_PrivacyCell_TUXButton"]')!.remove(); assert.equal(match(), null);
    } finally { w.close(); }
});

test('injectable TikTok adapter reads real sanitized editor DOM and rejects changed or ambiguous controls', async () => {
    const html = await fs.readFile(new URL('../../PublishPlugin/tests/fixtures/tiktok/upload-editor.html', import.meta.url), 'utf8');
    const extra = await fs.readFile(new URL('../../PublishPlugin/tests/fixtures/tiktok/upload-settings.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'https://www.tiktok.com/tiktokstudio/upload?tab=video', runScripts: 'outside-only' });
    const w = dom.window;
    try {
        const additional = w.document.createElement('div'); additional.innerHTML = extra;
        for (const node of [...additional.children]) {
            const e2e = node.getAttribute('data-e2e');
            if (e2e) w.document.querySelector('[data-e2e="' + e2e + '"]')?.remove();
            w.document.body.append(node);
        }
        // These anonymized fragments recreate the observed avatar/cover shape;
        // signed media URLs and the account handle are deliberately absent from fixtures.
        w.document.body.insertAdjacentHTML('afterbegin', '<button data-tt="Header_NewHeader_Clickable" aria-haspopup="dialog" aria-expanded="false"></button><div data-e2e="cover_container"><img class="cover-image" src="blob:https://www.tiktok.com/fixture-cover"></div>');
        Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
        w.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 } as DOMRect; };
        w.HTMLElement.prototype.scrollIntoView = () => {};
        const run = (fn: Function, ...args: unknown[]) => { (w as any).__args = args; return vm.runInContext('(' + fn.toString() + ')(...__args)', dom.getInternalVMContext()); };
        const initial = run(probeTikTokPage);
        assert.equal(initial.uploaded, true);
        assert.equal(initial.mediaFilename, 'fixture-video.mp4');
        assert.ok(initial.mediaSignature.includes('fixture-cover'));
        assert.equal(initial.postNow, true);
        assert.equal(initial.settings.allowReuse, true);
        assert.equal(initial.settings.aiGenerated, false);
        assert.equal(initial.settings.audience18Plus, false);
        assert.equal(initial.settings.commercialContent, 'none');
        assert.equal(initial.publishButtonEnabled, true);
        const postNow = w.document.querySelector<HTMLInputElement>('[data-e2e="schedule_container"] input[value="post_now"]')!;
        postNow.disabled = true;
        assert.equal(run(tikTokSettingsPage, 'post-now').ok, true);
        postNow.checked = false;
        assert.equal(run(tikTokSettingsPage, 'post-now').ok, false);
        postNow.disabled = false;
        assert.equal(run(tikTokSettingsPage, 'post-now').ok, true);
        assert.equal(postNow.checked, true);
        const caption = w.document.querySelector<HTMLElement>('[data-e2e="caption_container"] [contenteditable="true"]')!;
        const captionBefore = caption.innerHTML;
        w.document.execCommand = () => { throw new Error('Draft.js DOM must not be rewritten'); };
        w.document.elementFromPoint = () => caption;
        const captionPoint = run(tikTokCaptionPoint);
        assert.equal(captionPoint.x, 50);
        assert.equal(captionPoint.y, 20);
        assert.equal(caption.innerHTML, captionBefore);
        w.document.elementFromPoint = () => w.document.body;
        assert.equal(run(tikTokCaptionPoint), null);
        w.document.elementFromPoint = () => caption;
        const duplicateCaption = caption.cloneNode(true);
        caption.parentElement!.append(duplicateCaption);
        assert.equal(run(tikTokCaptionPoint), null);
        duplicateCaption.remove();
        assert.equal(run(tikTokSettingsPage, 'comment', false).ok, true);
        assert.equal(run(probeTikTokPage).settings.allowComments, false);
        const input = w.document.querySelector('[data-e2e="user_perm_container"] input') as HTMLInputElement;
        input.disabled = true;
        assert.equal(run(tikTokSettingsPage, 'comment', false).ok, true);
        assert.equal(run(tikTokSettingsPage, 'comment', true).ok, false);
        const post = w.document.querySelector('[data-e2e="post_video_button"]')!;
        w.document.elementFromPoint = () => post;
        assert.ok(run(tikTokSubmitPoint));
        w.document.elementFromPoint = () => w.document.body;
        assert.equal(run(tikTokSubmitPoint), null);
        post.setAttribute('aria-disabled', 'true');
        assert.equal(run(probeTikTokPage).publishButtonEnabled, false);
        assert.equal(run(tikTokSubmitPoint), null);
        w.document.body.append(post.cloneNode(true));
        assert.equal(run(probeTikTokPage).publishButtonCount, 2);
        const avatar = w.document.querySelector('[data-tt="Header_NewHeader_Clickable"]')!;
        avatar.addEventListener('click', () => {
            const opened = avatar.getAttribute('aria-expanded') === 'true';
            avatar.setAttribute('aria-expanded', String(!opened));
            if (opened) w.document.querySelector('[role="dialog"]')?.remove();
            else w.document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><a href="https://www.tiktok.com/@fixture_handle">Profile</a></div>');
        });
        assert.equal((await run(readTikTokAccount)).accountId, 'fixture_handle');
        assert.equal(avatar.getAttribute('aria-expanded'), 'false');
        const gate = w.document.createElement('iframe'); gate.src = 'https://fixture.invalid/captcha'; w.document.body.append(gate);
        assert.equal(run(probeTikTokPage).securityChallenge, true);
    } finally { w.close(); }
});

test('TikTok upload entry preserves a real unsaved draft prompt, including localized button text', async () => {
    const html = await fs.readFile(new URL('../../PublishPlugin/tests/fixtures/tiktok/upload-resume-draft.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'https://www.tiktok.com/tiktokstudio/upload?tab=video', runScripts: 'outside-only' });
    const w = dom.window;
    try {
        w.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, width: 100, height: 40 } as DOMRect; };
        w.document.body.insertAdjacentHTML('beforeend', '<button data-tt="Header_NewHeader_Clickable"></button><input type="file" accept="video/*">');
        const run = () => vm.runInContext('(' + probeTikTokPage.toString() + ')()', dom.getInternalVMContext());
        const initial = run();
        assert.equal(initial.uploadPage, true);
        assert.equal(initial.videoInputCount, 1);
        assert.equal(initial.resumeDraft, true);
        assert.equal(initial.hasDraft, true);
        for (const button of w.document.querySelectorAll('[data-e2e="local_draft_container"] button')) button.textContent = '继续／放弃';
        assert.equal(run().hasDraft, true);
        w.document.querySelector<HTMLElement>('[data-e2e="local_draft_container"]')!.style.display = 'none';
        assert.equal(run().resumeDraft, false);
        assert.equal(run().hasDraft, false);
    } finally { w.close(); }
});

test('TikTok account probe waits for its own menu closing animation and preserves an already open menu', async () => {
    const dom = new JSDOM('<button data-tt="Header_NewHeader_Clickable" aria-haspopup="dialog" aria-expanded="false"></button>', {
        url: 'https://www.tiktok.com/tiktokstudio/upload?tab=video', runScripts: 'outside-only',
    });
    const w = dom.window;
    try {
        w.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, width: 100, height: 40 } as DOMRect; };
        const avatar = w.document.querySelector('button')!;
        let clicks = 0;
        avatar.addEventListener('click', () => {
            clicks++;
            const opened = avatar.getAttribute('aria-expanded') === 'true';
            avatar.setAttribute('aria-expanded', String(!opened));
            if (opened) w.setTimeout(() => w.document.querySelector('[role="dialog"]')?.remove(), 40);
            else w.document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><a href="https://www.tiktok.com/@fixture_handle">Profile</a></div>');
        });
        const run = (fn: Function) => vm.runInContext('(' + fn.toString() + ')()', dom.getInternalVMContext());
        assert.equal((await run(readTikTokAccount)).accountId, 'fixture_handle');
        assert.equal(avatar.getAttribute('aria-expanded'), 'false');
        assert.equal(run(probeTikTokPage).blockingDialog, false, 'account read must finish restoring its own menu');
        assert.equal(clicks, 2);
        avatar.click();
        const before = clicks;
        assert.equal((await run(readTikTokAccount)).accountId, 'fixture_handle');
        assert.equal(avatar.getAttribute('aria-expanded'), 'true');
        assert.equal(run(probeTikTokPage).blockingDialog, true);
        assert.equal(clicks, before, 'an already open menu belongs to the user');
    } finally { w.close(); }
});
