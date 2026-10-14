import { app, BrowserWindow, nativeImage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PRODUCT_IMAGE_WIDTH, PRODUCT_IMAGE_HEIGHT } from '../../shared/productImageSet';
import { decodeProductVideoImage, transcodeProductVideoImageToJpeg } from './productVideoImageDecode';

let fontCssPromise: Promise<string> | undefined;

/** Use the same Fontsource font files shipped by Vite, including Chinese subsets. */
export function getProductImageFontCss(): Promise<string> {
    return fontCssPromise ||= (async () => {
        const appRoot = app.getAppPath();
        const assetRoot = path.join(appRoot, 'dist', 'assets');
        let styles: Array<{ css: string; root: string }> = [];
        try {
            const names = await fs.readdir(assetRoot);
            styles = await Promise.all(names.filter((name) => name.endsWith('.css')).map(async (name) => ({ css: await fs.readFile(path.join(assetRoot, name), 'utf8'), root: assetRoot })));
        } catch { /* Development builds read installed Fontsource files. */ }
        if (!styles.length) {
            const root = path.join(appRoot, 'node_modules', '@fontsource', 'noto-sans-sc');
            styles = await Promise.all(['400.css', '700.css'].map(async (name) => ({ css: await fs.readFile(path.join(root, name), 'utf8'), root })));
        }
        const rules: string[] = [];
        for (const { css, root } of styles) {
            for (const match of css.matchAll(/@font-face\s*\{[^}]+\}/g)) {
                let rule = match[0];
                if (!/font-family\s*:\s*['"]?Noto Sans SC/i.test(rule)) continue;
                if (!/font-weight\s*:\s*(400|700)(?:;|\s)/.test(rule)) continue;
                const preferred = Array.from(rule.matchAll(/url\(['"]?([^'"()]+)['"]?\)/g)).find((url) => url[1].endsWith('.woff2'));
                if (preferred) rule = rule.replace(/src\s*:[^;]+;/, `src:${preferred[0]} format('woff2');`);
                // The bundled stylesheet is trusted; all font bytes are embedded for offline rendering.
                for (const url of Array.from(rule.matchAll(/url\(['"]?([^'"()]+)['"]?\)/g))) {
                    const local = path.resolve(root, url[1].replace(/^\.\//, '').replace(/^\/assets\//, ''));
                    if (!local.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('字体路径无效');
                    const bytes = await fs.readFile(local);
                    const mime = local.endsWith('.woff2') ? 'font/woff2' : 'font/woff';
                    rule = rule.replace(url[0], `url(data:${mime};base64,${bytes.toString('base64')})`);
                }
                rules.push(rule);
            }
        }
        if (!rules.length) throw new Error('未找到套图所需的打包中文字体');
        return rules.join('\n');
    })();
}

export async function productImageDataUrl(absolutePath: string): Promise<string> {
    const decoded = await decodeProductVideoImage({
        decodeNative: () => {
            const image = nativeImage.createFromPath(absolutePath);
            if (image.isEmpty()) return null;
            const size = image.getSize();
            const scale = Math.min(1, 1920 / Math.max(size.width, size.height));
            return image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }).toJPEG(94);
        },
        decodeFallback: () => {
            const bundled = require('ffmpeg-static') as string;
            return transcodeProductVideoImageToJpeg({ inputPath: absolutePath, ffmpegCommand: bundled.replace('app.asar/', 'app.asar.unpacked/') });
        },
    });
    if (!decoded) throw new Error('商品图片损坏或无法解码');
    return `data:image/jpeg;base64,${decoded.jpeg.toString('base64')}`;
}

export async function renderProductImagePng(html: string, cacheDirectory: string, spec = { width: PRODUCT_IMAGE_WIDTH, height: PRODUCT_IMAGE_HEIGHT }): Promise<Buffer> {
    await fs.mkdir(cacheDirectory, { recursive: true });
    const file = path.join(cacheDirectory, `render-${randomUUID()}.html`);
    await fs.writeFile(file, html, 'utf8');
    const window = new BrowserWindow({
        width: spec.width, height: spec.height, useContentSize: true, show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('套图渲染超时，请检查图片和文字后重试')), 30000); });
        await Promise.race([window.loadFile(file), deadline]);
        window.webContents.setZoomFactor(1);
        // Application-owned inspection; no user-supplied script or HTML is evaluated.
        const problem = await Promise.race([window.webContents.executeJavaScript(`(async () => {
            const heading = document.querySelector('h1');
            const paragraph = document.querySelector('p');
            await document.fonts.load('700 ' + getComputedStyle(heading).fontSize + ' "Noto Sans SC"', heading.textContent);
            if (paragraph) await document.fonts.load('400 ' + getComputedStyle(paragraph).fontSize + ' "Noto Sans SC"', paragraph.textContent);
            await document.fonts.ready;
            await Promise.all(Array.from(document.images).map(image => image.decode()));
            if (Array.from(document.images).some(image => !image.naturalWidth)) return '图片加载失败';
            const text = document.querySelector('.text');
            const pictures = document.querySelector('.pictures');
            if (text.scrollHeight > Number.parseFloat(getComputedStyle(text).maxHeight) || pictures.getBoundingClientRect().height < 300 || text.getBoundingClientRect().bottom > ${spec.height - 100}) return '文字超出排版区域，请缩短文字或调小字号';
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return '';
        })()`), deadline]);
        if (problem) throw new Error(String(problem));
        // Font loading can finish before offscreen rasterization. Request and consume a full painted frame.
        const painted = new Promise<Electron.NativeImage>((resolve) => {
            const listener = (_event: Electron.Event, dirty: Electron.Rectangle, frame: Electron.NativeImage) => {
                if (dirty.x !== 0 || dirty.y !== 0 || dirty.width < spec.width || dirty.height < spec.height) return;
                window.webContents.off('paint', listener);
                resolve(frame);
            };
            window.webContents.on('paint', listener);
            window.webContents.invalidate();
        });
        const captured = await Promise.race([painted, deadline]);
        if (captured.isEmpty()) throw new Error('套图画面捕捉失败');
        return captured.resize({ width: spec.width, height: spec.height }).toPNG();
    } finally {
        clearTimeout(timeout);
        window.destroy();
        await fs.rm(file, { force: true });
    }
}
