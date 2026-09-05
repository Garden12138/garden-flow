'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '*.md', '-z'],
    { cwd: root, encoding: 'utf8' },
).split('\0').filter(Boolean);
const failures = [];

for (const file of new Set(files)) {
    if (/^(?:desktop\/dist-electron|desktop\/(?:electron\/)?builtin-skills\/skill-creator)\//.test(file)) continue;
    const absolutePath = path.join(root, file);
    if (!fs.existsSync(absolutePath)) continue;
    const source = fs.readFileSync(absolutePath, 'utf8');
    const links = source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g);
    for (const match of links) {
        let target = String(match[1] || '').trim();
        if (!target || /^(?:https?:|mailto:|#|codex:)/i.test(target)) continue;
        if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
        target = target.split(/\s+["']/)[0].split('#')[0].split('?')[0];
        if (!target) continue;
        try {
            target = decodeURIComponent(target);
        } catch {
            failures.push(`${file}: invalid encoded link ${match[1]}`);
            continue;
        }
        const resolved = path.resolve(path.dirname(absolutePath), target);
        if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
            failures.push(`${file}: local link escapes the repository: ${match[1]}`);
        } else if (!fs.existsSync(resolved)) {
            failures.push(`${file}: broken local link: ${match[1]}`);
        }
    }
}

if (failures.length > 0) {
    console.error('Documentation link check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
} else {
    console.log(`Documentation link check passed (${new Set(files).size} Markdown files).`);
}
