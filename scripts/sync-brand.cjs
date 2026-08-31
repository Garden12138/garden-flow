'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const identity = fs.readFileSync(path.join(root, 'branding/identity.json'), 'utf8');
const compatibility = fs.readFileSync(path.join(root, 'branding/compatibility.cjs'), 'utf8').replace("require('./identity.json')", "require('./brand.generated.json')");
const environment = fs.readFileSync(path.join(root, 'branding/environment.cjs'), 'utf8').replace("require('./compatibility.cjs')", "require('./brandCompatibility.cjs')");
for (const dir of ['desktop/shared', 'Plugin']) {
    fs.writeFileSync(path.join(root, dir, 'brand.generated.json'), identity);
    fs.writeFileSync(path.join(root, dir, 'brandCompatibility.cjs'), compatibility);
    fs.writeFileSync(path.join(root, dir, 'brandEnvironment.cjs'), environment);
}
const brand = JSON.parse(identity);
const shellAliases = Object.entries(brand.legacy.environment).map(([previous, current]) => {
    if (!/^[A-Z][A-Z0-9_]+$/.test(previous) || !/^[A-Z][A-Z0-9_]+$/.test(current)) throw new Error('Invalid environment alias');
    return `if [[ -z \${${current}+x} && -n \${${previous}+x} ]]; then export ${current}="\$${previous}"; fi`;
});
fs.writeFileSync(path.join(root, 'desktop/shared/brandEnvironment.sh'), '# Generated compatibility aliases; edit branding/identity.json.\n' + shellAliases.join('\n') + '\n');
const rendererFile = path.join(root, 'desktop/src/config/brand.generated.json');
const renderer = JSON.parse(fs.readFileSync(rendererFile, 'utf8'));
Object.assign(renderer, { variant: brand.slug, displayName: brand.displayName, windowTitle: brand.displayName, htmlTitle: brand.displayName, aiDisplayName: brand.displayName, logoSrc: '/branding/gardenflow-mark.svg', tagline: 'Grow content with AI.' });
fs.writeFileSync(rendererFile, JSON.stringify(renderer, null, 2) + '\n');
const pluginFile = path.join(root, 'Plugin/src/manifest.json');
const plugin = JSON.parse(fs.readFileSync(pluginFile, 'utf8'));
plugin.name = brand.displayName;
plugin.action.default_title = brand.displayName;
fs.writeFileSync(pluginFile, JSON.stringify(plugin, null, 2) + '\n');
console.log('GardenFlow brand runtime files synchronized.');
