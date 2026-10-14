// Execute the real publisher on a local HTML page in Chromium. No platform request is sent.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(process.argv[2]);
if (!root.startsWith('/private/tmp/')) throw new Error('Fixture output must be temporary');
app.setPath('userData', path.join(root, 'plugin-user-data'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px sans-serif;margin:24px}header{height:40px}main{width:800px}input,textarea{display:block;width:700px;margin:12px;padding:12px}textarea{height:100px}.images{display:flex;flex-wrap:wrap}.upload-item{width:80px;height:100px;margin:4px}.upload-item img{width:80px;height:100px;object-fit:contain}button{padding:12px;margin:8px}</style></head><body>
<header><a href="https://www.xiaohongshu.com/user/profile/local_fixture">本地账号</a></header><main class="publish editor">
<p>上传图片 或写文字生成图片 · 最多 18 张</p><button>上传图片</button><input type="file" accept="image/*" multiple>
<input class="copy" style="display:none" placeholder="填写标题" maxlength="20"><textarea class="copy" style="display:none" placeholder="填写正文"></textarea><div class="images upload-preview"></div>
<div class="permission-card-wrapper"><span class="d-select-description">公开可见</span></div><div class="custom-switch-card">定时发布<input type="checkbox"></div>
<button class="copy" style="display:none" id="publish">发布</button><div id="status"></div><button id="return" style="display:none">立即返回</button></main>
<script>window.__clicks=0;document.querySelector('input[type=file]').onchange=event=>{document.querySelectorAll('.copy').forEach(node=>node.style.display='block');for(const file of event.target.files){const card=document.createElement('div');card.className='upload-item img-container';card.setAttribute('data-upload-item','');const image=document.createElement('img');image.className='img preview';image.src=URL.createObjectURL(file);const format=document.createElement('div');format.className='format-img';format.append(image);card.append(format);const index=document.createElement('div');index.className='img-idx';index.textContent=String(document.querySelectorAll('.img-container').length+1);card.append(index);document.querySelector('.images').append(card);}event.target.value='';};document.querySelector('#publish').onclick=()=>{window.__clicks++;document.querySelectorAll('.copy').forEach(node=>node.style.display='none');document.querySelector('#status').textContent='发布成功';document.querySelector('#return').style.display='inline-block';};document.querySelector('#return').onclick=()=>{document.querySelector('.images').innerHTML='';document.querySelectorAll('.copy').forEach(node=>node.style.display='none');document.querySelector('input[placeholder]').value='';document.querySelector('textarea').value='';document.querySelector('#status').textContent='';document.querySelector('#return').style.display='none';};</script></body></html>`;
async function run() {
    await fs.mkdir(root, { recursive: true }); await app.whenReady();
    const scope = session.fromPartition('publication-fixture');
    await new Promise((resolve, reject) => scope.protocol.interceptBufferProtocol('https', (_request, callback) => callback({ mimeType: 'text/html', data: Buffer.from(html) }), error => error ? reject(error) : resolve()));
    const page = new BrowserWindow({ width: 1000, height: 1100, useContentSize: true, show: false, webPreferences: { session: scope, offscreen: true, backgroundThrottling: false } });
    await page.loadURL('https://creator.xiaohongshu.com/publish/publish?target=image'); await pause(150);
    const evalPage = source => page.webContents.executeJavaScript(source, true);
    const publisher = path.resolve(__dirname, '../../PublishPlugin/src');
    const adapter = await import(pathToFileURL(path.join(publisher, 'pageAdapter.js')).href);
    const review = await import(pathToFileURL(path.join(publisher, 'publicationReview.js')).href);
    const stored = {}; const uploads = []; const noopEvent = { addListener() {} }; let interrupt = true;
    const chrome = {
        runtime: { onMessage: noopEvent, onInstalled: noopEvent, onStartup: noopEvent, connectNative() { throw new Error('Fixture has no native host'); } },
        alarms: { onAlarm: noopEvent, create: async () => {} },
        storage: { local: { get: async key => ({ [key]: structuredClone(stored[key]) }), set: async values => Object.assign(stored, structuredClone(values)), remove: async key => { delete stored[key]; } } },
        tabs: { query: async () => [{ id: 9, url: page.webContents.getURL() }], update: async (_id, options) => page.loadURL(options.url) },
        scripting: { executeScript: async ({ func, args }) => [{ result: await evalPage(`(${func.toString()})(...${JSON.stringify(args || [])})`) }] },
        debugger: { attach: async () => { if (!page.webContents.debugger.isAttached()) page.webContents.debugger.attach('1.3'); }, detach: async () => { if (page.webContents.debugger.isAttached()) page.webContents.debugger.detach(); },
            sendCommand: async (_target, method, params) => { if (method === 'DOM.setFileInputFiles') { if (interrupt && uploads.length === 1) { interrupt = false; throw new Error('Simulated interruption before second image'); } uploads.push([...params.files]); } return page.webContents.debugger.sendCommand(method, params); } },
    };
    const source = (await fs.readFile(path.join(publisher, 'background.js'), 'utf8'))
        .replace(/^import \{[\s\S]*?\} from '\.\/pageAdapter\.js';/, '')
        .replace(/^import \{[^\n]+\} from '\.\/(?:douyinPublisher|tiktokPublisher)\.js';/gm, '');
    const context = vm.createContext({ ...adapter, ...review, chrome, URL, crypto: require('node:crypto').webcrypto, console, Date, setTimeout, clearTimeout });
    vm.runInContext(source + '\nglobalThis.fixtureApi={preparePublish,submitPrepared,currentStatus};', context);
    const picture = (await page.webContents.capturePage()).toPNG();
    const media = []; for (let i = 0; i < 3; i++) { const file = path.join(root, `${i + 1}.png`); await fs.writeFile(file, picture); media.push({ slotId: `page-${i}`, role: i ? 'image-page' : 'cover', path: file, mimeType: 'image/png', order: i }); }
    const request = { protocolVersion: 1, confirmationVersion: 2, jobId: 'chromium-local-job', contentDigest: 'd'.repeat(64), sessionId: 'local-editor', projectPath: '/fixture/product.redpost', revision: 1, noteType: 'image', title: '本地商品图', body: '三张相同内容仍按顺序保留', hashtags: ['原图'], accountId: 'local_fixture', accountLabel: '小红书账号 local_fixture', media, mediaSha256: media.map(() => require('node:crypto').createHash('sha256').update(picture).digest('hex')) };
    const status = await context.fixtureApi.currentStatus(); assert.equal(status.accountId, request.accountId);
    const interrupted = await context.fixtureApi.preparePublish(request); assert.equal(interrupted.ok, false); assert.equal(uploads.length, 1);
    delete stored.gardenflowXhsPublisherPreparedJob.imageUploadAnchors;
    const prepared = await context.fixtureApi.preparePublish(request); assert.equal(prepared.prepared, true, JSON.stringify(prepared)); assert.equal(prepared.uploadReview.mediaCount, 3);
    request.uploadPageFingerprint = prepared.uploadReview.pageFingerprint;
    assert.deepEqual(uploads.map(files => files.length), [1, 1, 1]); assert.equal(await evalPage('window.__clicks'), 0);
    const before = await evalPage('Array.from(document.querySelectorAll(".upload-item img")).map(image=>image.src)'); assert.equal(before.length, 3);
    await evalPage("document.querySelector('.permission-card-wrapper span').textContent='仅自己可见'");
    const changedSettings = await context.fixtureApi.submitPrepared({ jobId: request.jobId, contentDigest: request.contentDigest, request }); assert.equal(changedSettings.code, 'UPLOAD_PAGE_CHANGED'); assert.equal(await evalPage('window.__clicks'), 0);
    await evalPage("document.querySelector('.permission-card-wrapper span').textContent='公开可见'");
    await evalPage("document.querySelector('header a').href='https://www.xiaohongshu.com/user/profile/other'");
    const changed = await context.fixtureApi.submitPrepared({ jobId: request.jobId, contentDigest: request.contentDigest, request }); assert.equal(changed.code, 'ACCOUNT_CHANGED'); assert.equal(await evalPage('window.__clicks'), 0);
    await evalPage("document.querySelector('header a').href='https://www.xiaohongshu.com/user/profile/local_fixture'");
    await fs.writeFile(path.join(root, 'chromium-upload-review.png'), (await page.webContents.capturePage()).toPNG());
    const submitted = await context.fixtureApi.submitPrepared({ jobId: request.jobId, contentDigest: request.contentDigest, request });
    assert.equal(submitted.publishStatus, 'published', JSON.stringify(submitted));
    await fs.writeFile(path.join(root, 'chromium-publication-result.json'), JSON.stringify({ localHtmlFixture: true, externalPlatformRequests: 0, interrupted, legacyPartialPrefixRecovered: true, prepared, changedSettingsResult: changedSettings, changedAccountResult: changed, submitted, uploads: uploads.map(files => files.map(file => path.basename(file))), mediaAnchors: before, realAccountUsed: false }, null, 2));
    console.log('PUBLICATION_PLUGIN_CHROMIUM_QA_SUCCESS'); page.destroy(); app.exit(0);
}
run().catch(async error => { console.error(error); await fs.writeFile(path.join(root, 'plugin-fixture-error.txt'), String(error.stack || error)).catch(() => {}); app.exit(1); });
setTimeout(() => app.exit(1), 180000).unref();
