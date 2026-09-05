import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const roots = [
  path.join(desktopRoot, 'builtin-skills'),
  path.join(desktopRoot, 'electron', 'builtin-skills'),
];

async function collectSkillFiles(root, files = []) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await collectSkillFiles(entryPath, files);
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      files.push(entryPath);
    }
  }
  return files;
}

const files = (await Promise.all(roots.map((root) => collectSkillFiles(root)))).flat().sort();
const failures = [];

for (const filePath of files) {
  try {
    const source = await readFile(filePath, 'utf8');
    const parsed = matter(source);
    if (!String(parsed.data.name || path.basename(path.dirname(filePath))).trim()) {
      failures.push(`${path.relative(desktopRoot, filePath)}: missing skill name`);
    }
    if (!String(parsed.data.description || '').trim()) {
      failures.push(`${path.relative(desktopRoot, filePath)}: missing description`);
    }
  } catch (error) {
    failures.push(`${path.relative(desktopRoot, filePath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error('Built-in skill validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Built-in skill check passed: ${files.length} skill manifests are valid.`);
