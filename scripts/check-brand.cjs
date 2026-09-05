'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const failures = [];
const decode = (value) => Buffer.from(value, 'base64').toString('utf8');

const blockedText = [
    'cmVkY2xhdw==',
    'cmVkYm94',
    'cmVkY29udmVydA==',
    'cmVkLWNvbnZlcnQ=',
    'Ym9qaW4=',
    '5Y2a5LuK',
    'YmVhdg==',
    'eHdvdw==',
    'YXBpLnppei5oaw==',
    'bWlncmF0ZTpkYXRh',
    'cHJlcGFyZTpwcml2YXRlLXJ1bnRpbWU=',
    'b2ZmaWNpYWxBdXRo',
    'Z2FyZGVuZmxvdy1hdXRo',
    'YXBwOnN0YXJ0dXAtbWlncmF0aW9u',
    'c3RhcnR1cE1pZ3JhdGlvbg==',
    'YW5hbHl0aWNzQnJpZGdl',
    'bW9kdWxlQW5hbHl0aWNz',
    'bm9ybWFsaXplUmVjaGFyZ2VBbW91bnRJbnB1dA==',
    'ZXh0cmFjdEFsaXBheQ==',
    'b2ZmaWNpYWxGZWF0dXJlQnJpZGdl',
    'cHJpY2luZ0VzdGltYXRl',
].map(decode);

const removedPaths = [
    'YnJhbmRpbmcvY29tcGF0aWJpbGl0eS5janM=',
    'YnJhbmRpbmcvZW52aXJvbm1lbnQuY2pz',
    'ZGVza3RvcC9wcml2YXRl',
    'ZGVza3RvcC9lbGVjdHJvbi9vZmZpY2lhbEZlYXR1cmVCcmlkZ2UudHM=',
    'ZGVza3RvcC9lbGVjdHJvbi9jb3JlL2dhcmRlbmZsb3dNaWdyYXRpb25TdGF0ZS50cw==',
    'ZGVza3RvcC9lbGVjdHJvbi9jb3JlL2xlZ2FjeVBhdGhSZXNvbHZlci50cw==',
    'ZGVza3RvcC9zY3JpcHRzL2dhcmRlbmZsb3ctZGF0YS1taWdyYXRpb24uY2pz',
    'ZGVza3RvcC9zY3JpcHRzL3ByZXBhcmUtcHJpdmF0ZS1ydW50aW1lLmNqcw==',
    'ZGVza3RvcC9zcmMvY29tcGF0L3N0b3JhZ2VCb290c3RyYXAudHM=',
    'ZGVza3RvcC9zcmMvY29tcG9uZW50cy9TdGFydHVwTWlncmF0aW9uTW9kYWwudHN4',
    'ZGVza3RvcC9zcmMvYnJpZGdlL2RvbWFpbnMvYXV0aEJyaWRnZS50cw==',
    'ZGVza3RvcC9zcmMvYnJpZGdlL2RvbWFpbnMvYW5hbHl0aWNzQnJpZGdlLnRz',
    'UGx1Z2luL2JyYW5kQ29tcGF0aWJpbGl0eS5janM=',
    'UGx1Z2luL2JyYW5kRW52aXJvbm1lbnQuY2pz',
    'UGx1Z2luL3NyYy9icmFuZFJ1bnRpbWUuanM=',
    'UGx1Z2luL3NyYy9icmFuZFN0b3JhZ2UuanM=',
].map(decode);

for (const relativePath of removedPaths) {
    if (fs.existsSync(path.join(root, relativePath))) failures.push(`${relativePath} must not exist`);
}

const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
).split('\0').filter(Boolean);

const ignoredGeneratedDirectories = /^(?:desktop\/dist(?:-electron)?|desktop\/release|Plugin\/dist|PublishPlugin\/dist)\//;
const privateAddress = /(?:^|[^0-9])(?:10(?:\.[0-9]{1,3}){3}|192\.168(?:\.[0-9]{1,3}){2}|172\.(?:1[6-9]|2[0-9]|3[01])(?:\.[0-9]{1,3}){2})(?:[^0-9]|$)/;
const licensePlaceholderTokens = ['eW91ciBuYW1l', 'eW91ciBwcm9qZWN0'].map(decode);

for (const file of new Set(files)) {
    if (ignoredGeneratedDirectories.test(file)) continue;
    const absolutePath = path.join(root, file);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
    const buffer = fs.readFileSync(absolutePath);
    if (buffer.includes(0)) continue;
    const text = buffer.toString('utf8');
    const normalized = `${file}\n${text}`.toLowerCase();
    for (const value of blockedText) {
        if (normalized.includes(value.toLowerCase())) {
            failures.push(`${file} contains a removed product or interface identifier`);
            break;
        }
    }
    if (privateAddress.test(text)) failures.push(`${file} contains a private-network IPv4 address`);
    const lowerText = text.toLowerCase();
    if (licensePlaceholderTokens.some((token) => lowerText.includes(`[${token}`))) {
        failures.push(`${file} contains a license placeholder`);
    }
}

const identityPath = path.join(root, 'branding/identity.json');
const identityText = fs.readFileSync(identityPath, 'utf8');
const identity = JSON.parse(identityText);
const allowedIdentityKeys = [
    'appId',
    'assetProtocol',
    'database',
    'displayName',
    'nativeHost',
    'repository',
    'schemaVersion',
    'slug',
    'updatesEnabled',
    'workspaceDirectory',
];
if (JSON.stringify(Object.keys(identity).sort()) !== JSON.stringify(allowedIdentityKeys)) {
    failures.push('branding/identity.json must contain only the current public identity fields');
}
if (identity.displayName !== 'GardenFlow' || identity.slug !== 'gardenflow') {
    failures.push('branding/identity.json does not describe GardenFlow');
}

for (const relativePath of ['desktop/shared/brand.generated.json', 'Plugin/brand.generated.json']) {
    if (fs.readFileSync(path.join(root, relativePath), 'utf8') !== identityText) {
        failures.push(`${relativePath} is stale; run pnpm sync:brand`);
    }
}

try {
    execFileSync(process.execPath, ['scripts/check-visual-brand.cjs'], { cwd: root, stdio: 'inherit' });
} catch {
    failures.push('visual brand audit failed');
}

if (failures.length > 0) {
    console.error('GardenFlow public brand audit failed:');
    for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
    process.exitCode = 1;
} else {
    console.log('GardenFlow public brand, service, address, and license audit passed.');
}
