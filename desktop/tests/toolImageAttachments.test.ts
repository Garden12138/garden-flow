import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    attachLocalImagesToToolResult,
    buildAgentToolResultContent,
    collectLocalImagePaths,
    stripToolResultImagesForPersist,
    uniqueLocalImagePaths,
} from '../electron/core/toolImageAttachments.ts';

const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

test('collects computer-use screenshot paths from nested JSON text', () => {
    const payload = {
        id: 'computer-use',
        tool: 'computer_screenshot',
        result: {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    data: {
                        path: '/tmp/computer-use-1787803369185.png',
                        width: 1632,
                        height: 1050,
                        window_id: 15584,
                    },
                }),
            }],
        },
    };
    assert.deepEqual(
        collectLocalImagePaths(payload),
        ['/tmp/computer-use-1787803369185.png'],
    );
});

test('collects materialized MCP image path blocks', () => {
    const payload = {
        type: 'image',
        mimeType: 'image/png',
        path: '/tmp/computer-use-abc.png',
        note: 'saved',
    };
    assert.deepEqual(collectLocalImagePaths(payload), ['/tmp/computer-use-abc.png']);
});

test('does not treat knowledge-base png paths as screenshots', () => {
    const payload = {
        items: [{
            title: '一篇笔记',
            path: '/Users/cengjiada/.redconvert/spaces/default/media/cover.png',
        }],
    };
    assert.deepEqual(collectLocalImagePaths(payload), []);
});

test('attaches screenshot bytes to the tool result without putting base64 in llmContent', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-image-'));
    const filePath = path.join(dir, 'computer-use-1.png');
    await fs.writeFile(filePath, TINY_PNG);
    try {
        const result = await attachLocalImagesToToolResult({
            success: true,
            llmContent: JSON.stringify({
                data: {
                    path: filePath,
                    width: 1,
                    height: 1,
                },
            }, null, 2),
            display: 'mcp screenshot',
        });
        assert.equal(result.images?.length, 1);
        assert.equal(result.images?.[0]?.mimeType, 'image/png');
        assert.ok(result.images?.[0]?.data);
        assert.equal(result.llmContent?.includes(result.images?.[0]?.data || 'NOPE'), false);
        assert.match(String(result.llmContent), /已附加整窗截图/);

        const content = buildAgentToolResultContent(result);
        assert.equal(content[0]?.type, 'text');
        assert.equal(content[1]?.type, 'image');
        if (content[1]?.type === 'image') {
            assert.equal(content[1].mimeType, 'image/png');
            assert.equal(content[1].data, TINY_PNG.toString('base64'));
        }

        const persisted = stripToolResultImagesForPersist(result);
        assert.equal(persisted.images, undefined);
        assert.match(String(persisted.llmContent), /已附加整窗截图/);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('deduplicates the same screenshot path', () => {
    const filePath = '/tmp/computer-use-1.png';
    const paths = uniqueLocalImagePaths({
        path: filePath,
        width: 10,
        height: 10,
        nested: { path: filePath, width: 10, height: 10 },
    });
    assert.deepEqual(paths, [path.resolve(filePath)]);
});
