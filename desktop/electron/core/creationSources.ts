import { recordCreationMetric } from './creationMetrics';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getWorkspacePaths, runInWorkspaceSpace } from '../db';
import { loadDocumentSources, listDocumentFilesForSource } from './documentKnowledgeStore';
import { isPathWithinRoots } from './localAssetManager';
import { SourceRefSchema, type SourceRef } from '../../shared/noteCards';

export interface SourceSegment { location: string; text: string; }
export interface CreationSource extends SourceRef {
    spaceId: string; kind: 'attachment' | 'knowledge' | 'manuscript'; originalPath: string; storedPath: string;
    itemId?: string;
    status: 'ready' | 'empty' | 'unsupported' | 'failed' | 'missing' | 'changed'; error?: string; segments: SourceSegment[];
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const root = () => path.join(getWorkspacePaths().gardenflow, 'creation-sources');
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
async function checkedFile(candidate: string, roots: string[]): Promise<string> {
    const real = await fs.realpath(candidate);
    const allowed = await Promise.all(roots.map(value => fs.realpath(value).catch(() => '')));
    if (!isPathWithinRoots(real, allowed.filter(Boolean)) || !(await fs.stat(real)).isFile()) throw new Error('来源不属于当前空间');
    if ((await fs.stat(real)).size > 20 * 1024 * 1024) throw new Error('来源超过 20MB，请拆分后导入');
    return real;
}
export async function parseCreationSource(bytes: Buffer, extension: string): Promise<{ segments: SourceSegment[]; status: CreationSource['status']; error?: string }> {
    try {
        let segments: SourceSegment[];
        if (['.md', '.markdown', '.mdx', '.txt', '.text', '.knowledge'].includes(extension)) {
            const metadata = extension === '.knowledge' ? JSON.parse(bytes.toString('utf8')) : null;
            const body = metadata ? [metadata.title, metadata.content || metadata.description, metadata.transcript].filter(value => typeof value === 'string').join('\n\n') : bytes.toString('utf8');
            segments = body.split(/\n\s*\n/).map((text, index) => ({ location: `段落 ${index + 1}`, text }));
        } else if (extension === '.pdf') {
            const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
            const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
            const document = await task.promise;
            try {
                if (document.numPages > 500) throw new Error('PDF 超过 500 页，请拆分后导入');
                segments = [];
                for (let index = 1; index <= document.numPages; index++) { const page = await document.getPage(index); const content = await page.getTextContent(); segments.push({ location: `第 ${index} 页`, text: content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : '') : '').join('') }); }
            } finally { await task.destroy(); }
        } else if (extension === '.docx') {
            const mammoth = await import('mammoth');
            const result = await mammoth.extractRawText({ buffer: bytes });
            segments = result.value.split(/\n\s*\n/).map((text, index) => ({ location: `段落 ${index + 1}`, text }));
        } else return { status: 'unsupported', segments: [], error: '暂不支持此格式，请更换为 Markdown、TXT、文本型 PDF 或 DOCX' };
        segments = segments.filter(segment => segment.text.trim());
        if (segments.reduce((sum, value) => sum + value.text.length, 0) > 2_000_000) throw new Error('提取文字超过 200 万字，请拆分来源');
        return { segments, status: segments.length ? 'ready' : 'empty', ...(segments.length ? {} : { error: extension === '.pdf' ? '未提取到文字；扫描件请先 OCR 或更换文本来源' : '来源内容为空' }) };
    } catch (error) { return { segments: [], status: 'failed', error: `解析失败：${error instanceof Error ? error.message : String(error)}` }; }
}
export async function importCreationSource(input: unknown): Promise<CreationSource> {
    const request = z.object({ kind: z.enum(['attachment', 'knowledge', 'manuscript']), path: z.string().min(1).max(2000), sourceId: z.string().max(160).optional(), itemId: idSchema.optional(), name: z.string().max(240).optional() }).strict().parse(input);
    const spaceId = getWorkspacePaths().activeSpaceId;
    return runInWorkspaceSpace(spaceId, async () => {
        const paths = getWorkspacePaths();
        let candidate = request.path;
        let roots: string[];
        if (request.kind === 'knowledge' && request.itemId) {
            roots = [paths.knowledgeRedbook]; candidate = path.join(paths.knowledgeRedbook, request.itemId, 'meta.json');
        } else if (request.kind === 'knowledge') {
            const source = (await loadDocumentSources(paths)).find(source => source.id === request.sourceId);
            if (!source) throw new Error('知识来源不属于当前空间');
            const files = await listDocumentFilesForSource(source, { maxFiles: 10000 });
            const file = files.find(file => file.absolutePath === candidate || file.relativePath === candidate);
            if (!file) throw new Error('知识文件不在已注册来源中');
            candidate = file.absolutePath; roots = [source.rootPath];
        } else roots = [request.kind === 'attachment' ? path.join(paths.gardenflow, 'uploads') : paths.manuscripts];
        if (!path.isAbsolute(candidate)) candidate = path.resolve(roots[0], candidate.replace(/^manuscripts:\/\//, ''));
        candidate = await checkedFile(candidate, roots);
        const bytes = await fs.readFile(candidate); const version = digest(bytes); const id = 'source_' + randomUUID();
        await fs.mkdir(root(), { recursive: true });
        if (!isPathWithinRoots(await fs.realpath(root()), [await fs.realpath(paths.gardenflow)])) throw new Error('来源存储不能通过符号链接访问空间外目录');
        const directory = path.join(root(), id); await fs.mkdir(directory, { recursive: true });
        const storedPath = path.join(directory, 'original' + (request.itemId ? '.knowledge' : path.extname(candidate)));
        await fs.writeFile(storedPath, bytes, { mode: 0o600 });
        const source: CreationSource = { id, version, spaceId, name: request.name || path.basename(candidate), kind: request.kind, itemId: request.itemId, originalPath: candidate, storedPath, ...await parseCreationSource(bytes, request.itemId ? '.knowledge' : path.extname(candidate).toLowerCase()) };
        await fs.writeFile(path.join(directory, 'source.json'), JSON.stringify(source), { mode: 0o600 });
        await recordCreationMetric('source.' + source.status);
        return source;
    });
}
export async function readCreationSource(ref: SourceRef, options: { offset?: number; limit?: number; reread?: boolean } = {}) {
    SourceRefSchema.parse(ref);
    if (!isPathWithinRoots(await fs.realpath(root()), [await fs.realpath(getWorkspacePaths().gardenflow)])) throw new Error('来源存储不属于当前空间');
    const directory = path.join(root(), idSchema.parse(ref.id));
    await checkedFile(path.join(directory, 'source.json'), [root()]);
    const source = JSON.parse(await fs.readFile(path.join(directory, 'source.json'), 'utf8')) as CreationSource;
    if (source.spaceId !== getWorkspacePaths().activeSpaceId || source.id !== ref.id) throw new Error('来源不属于当前空间');
    if (source.version !== ref.version) throw new Error('来源版本不匹配，请重新绑定');
    await checkedFile(source.storedPath, [directory]);
    const stored = await fs.readFile(source.storedPath);
    if (digest(stored) !== source.version) throw new Error('来源快照损坏，请更换来源');
    let changed = false;
    try { changed = digest(await fs.readFile(source.originalPath)) !== source.version; } catch { /* The durable copy remains usable after the original is removed. */ }
    if (options.reread) {
        // Never overwrite an old version: pages can continue citing the original snapshot.
        if (changed) return { ...await importCreationSource({ kind: source.kind, itemId: source.itemId, path: source.originalPath, name: source.name, ...(source.kind === 'knowledge' && !source.itemId ? { sourceId: (await loadDocumentSources(getWorkspacePaths())).find(item => isPathWithinRoots(source.originalPath, [item.rootPath]))?.id } : {}) }), changed: false, offset: 0, nextOffset: null, totalSegments: 0 };
        Object.assign(source, await parseCreationSource(stored, path.extname(source.storedPath).toLowerCase()));
        await fs.writeFile(path.join(directory, 'source.json'), JSON.stringify(source), { mode: 0o600 });
    }
    const offset = z.number().int().nonnegative().parse(options.offset ?? 0); const limit = z.number().int().min(1).max(50).parse(options.limit ?? 10);
    // Split very long paragraphs so the tool remains bounded without discarding content.
    const segments = source.segments.flatMap(segment => Array.from({ length: Math.ceil(segment.text.length / 6000) }, (_, index) => ({ location: segment.location + (segment.text.length > 6000 ? ` · 片段 ${index + 1}` : ''), text: segment.text.slice(index * 6000, (index + 1) * 6000) })));
    return { ...source, status: source.version !== ref.version || changed ? 'changed' as const : source.status, changed, segments: segments.slice(offset, offset + limit), offset, nextOffset: offset + limit < segments.length ? offset + limit : null, totalSegments: segments.length };
}
