import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolResult } from './toolRegistry';

export interface ToolImageAttachment {
    data: string;
    mimeType: string;
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const SCREENSHOT_PATH_HINT = /(?:computer-use[-_]?\d+|xhs-capture|screenshot)/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 4;
const MAX_WALK_DEPTH = 8;

const IMAGE_HINT = '已附加整窗截图。请先读红轴数字（那就是 click 坐标，不要再加窗口原点），在这张图里标出本步要点后再点。标签栏/地址栏那一条不要点。';

function parseJson(value: string): unknown | null {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return null;
    }
    try {
        return JSON.parse(trimmed) as unknown;
    } catch {
        return null;
    }
}

function asLocalFilePath(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(https?:\/\/|data:|file:\/\/)/i.test(raw)) return '';
    return raw;
}

function mimeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    return 'image/png';
}

function isLikelyScreenshotRecord(record: Record<string, unknown>, filePath: string): boolean {
    const type = String(record.type || '').toLowerCase();
    const mime = String(record.mimeType || record.mime_type || '').toLowerCase();
    const width = Number(record.width || record.bounds_width);
    const height = Number(record.height || record.bounds_height);
    const hasDimensions = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    return type === 'image'
        || mime.startsWith('image/')
        || hasDimensions
        || SCREENSHOT_PATH_HINT.test(filePath);
}

function collectFromRecord(record: Record<string, unknown>, into: string[]): void {
    const candidates = [
        record.path,
        record.file,
        record.filepath,
        record.filePath,
        record.out,
        record.output,
    ];
    for (const candidate of candidates) {
        const filePath = asLocalFilePath(candidate);
        if (!filePath || !IMAGE_EXT.test(filePath)) continue;
        if (!isLikelyScreenshotRecord(record, filePath)) continue;
        into.push(filePath);
    }
}

export function collectLocalImagePaths(value: unknown, depth = 0, into: string[] = []): string[] {
    if (depth > MAX_WALK_DEPTH || value == null) return into;
    if (typeof value === 'string') {
        const parsed = parseJson(value);
        if (parsed != null) {
            collectLocalImagePaths(parsed, depth + 1, into);
        }
        return into;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectLocalImagePaths(item, depth + 1, into);
        }
        return into;
    }
    if (typeof value !== 'object') return into;
    const record = value as Record<string, unknown>;
    collectFromRecord(record, into);
    for (const child of Object.values(record)) {
        collectLocalImagePaths(child, depth + 1, into);
    }
    return into;
}

export function uniqueLocalImagePaths(value: unknown): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const filePath of collectLocalImagePaths(value)) {
        const resolved = path.resolve(filePath);
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        unique.push(resolved);
        if (unique.length >= MAX_IMAGES) break;
    }
    return unique;
}

export async function loadLocalImageAttachmentsFromValue(value: unknown): Promise<ToolImageAttachment[]> {
    const attachments: ToolImageAttachment[] = [];
    for (const filePath of uniqueLocalImagePaths(value)) {
        try {
            const stat = await fs.stat(filePath);
            if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) continue;
            const bytes = await fs.readFile(filePath);
            attachments.push({
                data: bytes.toString('base64'),
                mimeType: mimeFromPath(filePath),
            });
        } catch {
            // Skip vanished or unreadable screenshot files.
        }
    }
    return attachments;
}

export async function attachLocalImagesToToolResult(result: ToolResult): Promise<ToolResult> {
    if (result.images && result.images.length > 0) {
        return result;
    }
    const images = await loadLocalImageAttachmentsFromValue({
        llmContent: result.llmContent,
        display: result.display,
        data: result.data,
    });
    if (images.length === 0) {
        return result;
    }
    const text = String(result.llmContent || '').trim();
    const hint = images.length === 1 ? IMAGE_HINT : `已附加 ${images.length} 张整窗截图。请先读红轴数字标出本步坐标再点，不要再加窗口原点。`;
    return {
        ...result,
        images,
        llmContent: text ? `${text}\n\n${hint}` : hint,
    };
}

export function stripToolResultImagesForPersist(result: ToolResult): ToolResult {
    if (!result.images?.length) return result;
    return {
        success: result.success,
        llmContent: result.llmContent,
        display: result.display,
        data: result.data,
        error: result.error,
    };
}

export function buildAgentToolResultContent(result: ToolResult): Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
> {
    const text = result.llmContent || result.display || result.error?.message || '';
    const content: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
    > = [{ type: 'text', text }];
    for (const image of result.images || []) {
        if (!image?.data || !image.mimeType) continue;
        content.push({
            type: 'image',
            data: image.data,
            mimeType: image.mimeType,
        });
    }
    return content;
}
