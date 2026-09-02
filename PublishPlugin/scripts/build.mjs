import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(pluginRoot, 'src');
const output = path.join(pluginRoot, 'dist', 'extension');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.cpSync(source, output, { recursive: true });
console.log(`Built Xiaohongshu publisher extension into ${path.relative(pluginRoot, output)}`);
