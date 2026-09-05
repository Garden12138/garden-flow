'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const identityText = fs.readFileSync(path.join(root, 'branding/identity.json'), 'utf8');
const identity = JSON.parse(identityText);
const visualTheme = JSON.parse(fs.readFileSync(path.join(root, 'branding/visual-theme.json'), 'utf8'));

for (const directory of ['desktop/shared', 'Plugin']) {
    fs.writeFileSync(path.join(root, directory, 'brand.generated.json'), identityText);
}

const rendererFile = path.join(root, 'desktop/src/config/brand.generated.json');
const renderer = JSON.parse(fs.readFileSync(rendererFile, 'utf8'));
Object.assign(renderer, {
    variant: identity.slug,
    displayName: identity.displayName,
    windowTitle: identity.displayName,
    htmlTitle: identity.displayName,
    aiDisplayName: identity.displayName,
    logoSrc: '/branding/app-icon.png',
    tagline: 'Grow content with AI.',
    theme: visualTheme.theme,
});
fs.writeFileSync(rendererFile, `${JSON.stringify(renderer, null, 2)}\n`);

const rgbTokenToHex = (value) => `#${String(value).trim().split(/\s+/).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const palette = visualTheme.palette;
const light = visualTheme.theme.light;
const pluginTheme = {
    paper: palette.paper,
    surface: palette.surface,
    surfaceSecondary: rgbTokenToHex(light.surfaceSecondary),
    surfaceTertiary: rgbTokenToHex(light.surfaceTertiary),
    border: rgbTokenToHex(light.border),
    divider: rgbTokenToHex(light.divider),
    ink: palette.ink,
    textSecondary: rgbTokenToHex(light.textSecondary),
    textTertiary: rgbTokenToHex(light.textTertiary),
    iris: palette.iris,
    irisHover: palette.irisHover,
    irisMuted: palette.irisMuted,
    leaf: palette.leaf,
    leafMuted: palette.leafMuted,
    gold: palette.gold,
    danger: palette.danger,
    dangerMuted: palette.dangerMuted,
    success: palette.success,
    successMuted: palette.successMuted,
};
const pluginCss = `/* Generated from branding/visual-theme.json; run pnpm sync:brand. */\n:root {\n${Object.entries(pluginTheme).map(([key, value]) => `  --gf-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: ${value};`).join('\n')}\n}\n`;
fs.writeFileSync(path.join(root, 'Plugin/src/brand-theme.generated.css'), pluginCss);
fs.writeFileSync(
    path.join(root, 'Plugin/src/brandTheme.generated.js'),
    `// Generated from branding/visual-theme.json; run pnpm sync:brand.\nexport const GARDENFLOW_THEME = Object.freeze(${JSON.stringify(pluginTheme, null, 2)});\nexport const GARDENFLOW_ICON_32_DATA_URL = 'data:image/png;base64,${fs.readFileSync(path.join(root, 'Plugin/src/icons/icon32.png')).toString('base64')}';\n`,
);

const manifestFile = path.join(root, 'Plugin/src/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
manifest.name = identity.displayName;
manifest.action.default_title = identity.displayName;
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

console.log('GardenFlow brand files synchronized.');
