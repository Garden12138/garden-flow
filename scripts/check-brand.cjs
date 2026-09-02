'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const provenance = new Set(['Docs/MIGRATION.md', 'Docs/SELF_TEST_NEWAPI_AND_AUTOMATION.md', 'Docs/NEW_API_GATEWAY_MIGRATION_PLAN.md']);
const compatibility = new Set(['scripts/check-brand.cjs', 'branding/identity.json', 'desktop/shared/brand.generated.json', 'desktop/shared/brandCompatibility.mjs', 'desktop/shared/brandEnvironment.sh', 'Plugin/brand.generated.json', 'Docs/GARDENFLOW_REBRAND.md']);
const oldNames = /redclaw|redbox|redconvert|red-convert|bojin|博今|beav|xwow/i;
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const failures = [];
for (const file of new Set(files)) {
    if (!fs.existsSync(path.join(root, file))) continue;
    if (provenance.has(file) || compatibility.has(file) || /(?:^|\/)(?:LICENSE[^/]*|ATTRIBUTION\.md|THIRD_PARTY_NOTICES\.txt|AGENTS\.md)$/.test(file) || /(?:\.test\.(?:ts|js)|pnpm-lock\.yaml)$/.test(file)) continue;
    const buffer = fs.readFileSync(path.join(root, file));
    if (buffer.includes(0)) continue;
    if (oldNames.test(file) || oldNames.test(buffer.toString('utf8'))) failures.push(file);
}
const brand = fs.readFileSync(path.join(root, 'branding/identity.json'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'branding/compatibility.cjs'), 'utf8').replace("require('./identity.json')", "require('./brand.generated.json')");
const rendererRuntime = fs.readFileSync(path.join(root, 'branding/compatibility.cjs'), 'utf8')
    .replace("'use strict';\n\n", '')
    .replace("const identity = require('./identity.json');", `const identity = ${brand.trim()};`)
    .replace(
        'module.exports = { identity, canonicalKey, canonicalValue, migrateStructured, applyEnvironmentAliases, migrateStorage };',
        'const compatibility = { identity, canonicalKey, canonicalValue, migrateStructured, applyEnvironmentAliases, migrateStorage };\n\nexport { identity, canonicalKey, canonicalValue, migrateStructured, applyEnvironmentAliases, migrateStorage };\nexport default compatibility;',
    );
const environment = fs.readFileSync(path.join(root, 'branding/environment.cjs'), 'utf8').replace("require('./compatibility.cjs')", "require('./brandCompatibility.cjs')");
for (const directory of ['desktop/shared', 'Plugin']) {
    if (fs.readFileSync(path.join(root, directory, 'brand.generated.json'), 'utf8') !== brand || fs.readFileSync(path.join(root, directory, 'brandCompatibility.cjs'), 'utf8') !== runtime) failures.push(`${directory}: run pnpm sync:brand`);
    if (fs.readFileSync(path.join(root, directory, 'brandEnvironment.cjs'), 'utf8') !== environment) failures.push(`${directory}: environment aliases are stale`);
}
if (fs.readFileSync(path.join(root, 'desktop/shared/brandCompatibility.mjs'), 'utf8') !== rendererRuntime) failures.push('desktop/shared/brandCompatibility.mjs: run pnpm sync:brand');
try {
    execFileSync(process.execPath, ['scripts/check-visual-brand.cjs'], { cwd: root, stdio: 'inherit' });
} catch {
    failures.push('visual brand audit failed');
}
if (failures.length) { console.error('Unapproved legacy names or stale brand artifacts:', failures); process.exitCode = 1; }
else console.log('GardenFlow brand audit passed (compatibility, tests and source/license records retained).');
