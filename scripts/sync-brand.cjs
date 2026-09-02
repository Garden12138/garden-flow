'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const identity = fs.readFileSync(path.join(root, 'branding/identity.json'), 'utf8');
const visualTheme = JSON.parse(fs.readFileSync(path.join(root, 'branding/visual-theme.json'), 'utf8'));
const compatibility = fs.readFileSync(path.join(root, 'branding/compatibility.cjs'), 'utf8').replace("require('./identity.json')", "require('./brand.generated.json')");
const compatibilityEsm = fs.readFileSync(path.join(root, 'branding/compatibility.cjs'), 'utf8')
    .replace("'use strict';\n\n", '')
    .replace("const identity = require('./identity.json');", `const identity = ${identity.trim()};`)
    .replace(
        'module.exports = { identity, canonicalKey, canonicalValue, migrateStructured, applyEnvironmentAliases, migrateStorage };',
        'const compatibility = { identity, canonicalKey, canonicalValue, migrateStructured, applyEnvironmentAliases, migrateStorage };\n\nexport { identity, canonicalKey, canonicalValue, migrateStructured, applyEnvironmentAliases, migrateStorage };\nexport default compatibility;',
    );
const environment = fs.readFileSync(path.join(root, 'branding/environment.cjs'), 'utf8').replace("require('./compatibility.cjs')", "require('./brandCompatibility.cjs')");
for (const dir of ['desktop/shared', 'Plugin']) {
    fs.writeFileSync(path.join(root, dir, 'brand.generated.json'), identity);
    fs.writeFileSync(path.join(root, dir, 'brandCompatibility.cjs'), compatibility);
    fs.writeFileSync(path.join(root, dir, 'brandEnvironment.cjs'), environment);
}
fs.writeFileSync(path.join(root, 'desktop/shared/brandCompatibility.mjs'), compatibilityEsm);
const brand = JSON.parse(identity);
const shellAliases = Object.entries(brand.legacy.environment).map(([previous, current]) => {
    if (!/^[A-Z][A-Z0-9_]+$/.test(previous) || !/^[A-Z][A-Z0-9_]+$/.test(current)) throw new Error('Invalid environment alias');
    return `if [[ -z \${${current}+x} && -n \${${previous}+x} ]]; then export ${current}="\$${previous}"; fi`;
});
fs.writeFileSync(path.join(root, 'desktop/shared/brandEnvironment.sh'), '# Generated compatibility aliases; edit branding/identity.json.\n' + shellAliases.join('\n') + '\n');
const rendererFile = path.join(root, 'desktop/src/config/brand.generated.json');
const renderer = JSON.parse(fs.readFileSync(rendererFile, 'utf8'));
Object.assign(renderer, {
    variant: brand.slug,
    displayName: brand.displayName,
    windowTitle: brand.displayName,
    htmlTitle: brand.displayName,
    aiDisplayName: brand.displayName,
    logoSrc: '/branding/app-icon.png',
    tagline: 'Grow content with AI.',
    theme: visualTheme.theme,
});
fs.writeFileSync(rendererFile, JSON.stringify(renderer, null, 2) + '\n');

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
const pluginFile = path.join(root, 'Plugin/src/manifest.json');
const plugin = JSON.parse(fs.readFileSync(pluginFile, 'utf8'));
plugin.name = brand.displayName;
plugin.action.default_title = brand.displayName;
fs.writeFileSync(pluginFile, JSON.stringify(plugin, null, 2) + '\n');
console.log('GardenFlow brand runtime files synchronized.');
