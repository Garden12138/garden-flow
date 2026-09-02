'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const visual = JSON.parse(fs.readFileSync(path.join(root, 'branding/visual-theme.json'), 'utf8'));
const failures = [];

function fail(message) {
    failures.push(message);
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parsePng(filePath, decodePixels = false) {
    const buffer = fs.readFileSync(filePath);
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!buffer.subarray(0, 8).equals(signature)) throw new Error(`${filePath} is not a PNG`);
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idat = [];
    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        offset += 12 + length;
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
    }
    const result = { width, height, bitDepth, colorType };
    if (!decodePixels) return result;
    if (bitDepth !== 8 || colorType !== 6) throw new Error(`${filePath} must be an 8-bit RGBA PNG`);
    const bytesPerPixel = 4;
    const stride = width * bytesPerPixel;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const pixels = Buffer.alloc(stride * height);
    let inputOffset = 0;
    let previous = Buffer.alloc(stride);
    for (let y = 0; y < height; y += 1) {
        const filter = raw[inputOffset];
        inputOffset += 1;
        const row = Buffer.alloc(stride);
        for (let x = 0; x < stride; x += 1) {
            const source = raw[inputOffset + x];
            const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
            const up = previous[x];
            const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
            if (filter === 0) row[x] = source;
            else if (filter === 1) row[x] = (source + left) & 255;
            else if (filter === 2) row[x] = (source + up) & 255;
            else if (filter === 3) row[x] = (source + Math.floor((left + up) / 2)) & 255;
            else if (filter === 4) row[x] = (source + paeth(left, up, upLeft)) & 255;
            else throw new Error(`${filePath} uses unsupported PNG filter ${filter}`);
        }
        row.copy(pixels, y * stride);
        previous = row;
        inputOffset += stride;
    }
    return { ...result, pixels };
}

function paeth(left, up, upLeft) {
    const estimate = left + up - upLeft;
    const leftDistance = Math.abs(estimate - left);
    const upDistance = Math.abs(estimate - up);
    const diagonalDistance = Math.abs(estimate - upLeft);
    if (leftDistance <= upDistance && leftDistance <= diagonalDistance) return left;
    if (upDistance <= diagonalDistance) return up;
    return upLeft;
}

function alphaBounds(png) {
    let minX = png.width;
    let minY = png.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < png.height; y += 1) {
        for (let x = 0; x < png.width; x += 1) {
            if (png.pixels[(y * png.width + x) * 4 + 3] === 0) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }
    return { minX, minY, maxX, maxY };
}

const artwork = visual.artwork;
const sourcePath = path.join(root, artwork.source);
if (sha256(sourcePath) !== artwork.sourceSha256) fail('Watercolor source SHA-256 does not match visual-theme.json');
const sourcePng = parsePng(sourcePath);
if (sourcePng.width !== artwork.sourceWidth || sourcePng.height !== artwork.sourceHeight) fail('Watercolor source dimensions do not match visual-theme.json');

const masterPath = path.join(root, 'branding/gardenflow-iris-master.png');
if (sha256(masterPath) !== artwork.masterSha256) fail('Generated watercolor master hash is stale; run pnpm generate:brand-assets');
const masterPng = parsePng(masterPath, true);
if (masterPng.width !== artwork.master.size || masterPng.height !== artwork.master.size) fail('Watercolor master must be 1024x1024');
const expectedMax = artwork.master.padding + artwork.master.contentSize - 1;
const bounds = alphaBounds(masterPng);
if (bounds.minX !== artwork.master.padding || bounds.minY !== artwork.master.padding || bounds.maxX !== expectedMax || bounds.maxY !== expectedMax) {
    fail(`Watercolor master alpha bounds are ${JSON.stringify(bounds)}`);
}

for (const relativePath of [
    'desktop/gardenflow.png',
    'desktop/public/branding/app-icon.png',
    'desktop/public/branding/logo.png',
    'desktop/public/onboarding/brand/gardenflow-logo.png',
    'desktop/public/provider-logos/gardenflow.png',
]) {
    if (sha256(path.join(root, relativePath)) !== artwork.masterSha256) fail(`${relativePath} is not synchronized with the watercolor master`);
}

for (const size of [16, 32, 48, 128]) {
    const icon = parsePng(path.join(root, `Plugin/src/icons/icon${size}.png`));
    if (icon.width !== size || icon.height !== size) fail(`Plugin icon${size}.png has unexpected dimensions`);
}

const rendererBrand = JSON.parse(fs.readFileSync(path.join(root, 'desktop/src/config/brand.generated.json'), 'utf8'));
if (rendererBrand.logoSrc !== '/branding/app-icon.png') fail('Desktop logoSrc does not use the watercolor PNG');
if (JSON.stringify(rendererBrand.theme) !== JSON.stringify(visual.theme)) fail('Desktop visual theme is stale; run pnpm sync:brand');

const pluginThemeSource = fs.readFileSync(path.join(root, 'Plugin/src/brandTheme.generated.js'), 'utf8');
const expectedIconData = fs.readFileSync(path.join(root, 'Plugin/src/icons/icon32.png')).toString('base64');
if (!pluginThemeSource.includes(expectedIconData)) fail('Plugin default favicon data is stale; run pnpm sync:brand');

const forbiddenBrandRed = /#(?:e60012|c2000f|b0000e|ff2a3a|ff4d5b|ff7480)|rgba\(230\s*,\s*0\s*,\s*18|brand-red|color-brand-red/i;
for (const relativePath of [
    'desktop/src/config/brand.generated.json',
    'desktop/src/config/brand.ts',
    'desktop/src/config/theme.ts',
    'desktop/src/index.css',
    'desktop/src/pages/GardenFlow.tsx',
    'desktop/src/pages/GenerationStudio.tsx',
    'Plugin/src/popup.css',
    'Plugin/src/settings.css',
    'Plugin/src/sidepanel.css',
    'Plugin/src/pageObserver.js',
    'Plugin/src/content/controlBadge.js',
    'Plugin/src/content/cursorOverlay.js',
    'Plugin/src/background/tabFaviconBadge.js',
]) {
    if (forbiddenBrandRed.test(fs.readFileSync(path.join(root, relativePath), 'utf8'))) fail(`${relativePath} still contains the old brand red`);
}

for (const obsoletePath of [
    'desktop/public/branding/gardenflow-mark.svg',
    'desktop/public/provider-logos/gardenflow.svg',
]) {
    if (fs.existsSync(path.join(root, obsoletePath))) fail(`${obsoletePath} should no longer exist`);
}

if (failures.length) {
    console.error('GardenFlow visual brand audit failed:', failures);
    process.exitCode = 1;
} else {
    console.log('GardenFlow watercolor assets and visual theme audit passed.');
}
