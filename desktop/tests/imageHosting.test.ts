import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDefaultImageHostingSettings,
    isImageHostingReady,
    normalizeImageHostingSettings,
    updateActiveImageHostingSettings,
} from '../shared/imageHosting.ts';
import { uploadToGithub } from '../electron/core/imageHosting/githubAdapter.ts';
import { normalizeMediaValueForRemote } from '../electron/core/imageHosting/service.ts';
import { buildGithubPublicUrl, buildRemotePath, normalizePathPrefix } from '../electron/core/imageHosting/url.ts';
import { waitForPublicUrlReady } from '../electron/core/imageHosting/publicUrlReady.ts';

const ONE_PIXEL_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const ONE_PIXEL_PNG = Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64');

const readySettings = normalizeImageHostingSettings({
    enabled: true,
    activeId: 'github-default',
    configs: [{
        id: 'github-default',
        name: 'ai',
        type: 'github',
        github: {
            repo: 'Garden12138/picbed-cloud',
            branch: 'main',
            token: 'ghp_test_token',
            pathPrefix: 'ai/',
            customDomain: '',
        },
    }],
});

test('normalizeImageHostingSettings fills GitHub defaults and keeps named config', () => {
    const settings = normalizeImageHostingSettings({
        enabled: true,
        configs: [{
            name: 'ai',
            type: 'github',
            github: { repo: 'Garden12138/picbed-cloud' },
        }],
    });

    assert.equal(settings.enabled, true);
    assert.equal(settings.configs[0].name, 'ai');
    assert.equal(settings.configs[0].github.branch, 'main');
    assert.equal(settings.configs[0].github.repo, 'Garden12138/picbed-cloud');
    assert.equal(settings.configs[0].github.publicUrlStyle, 'jsdmirror');
    assert.equal(isImageHostingReady(createDefaultImageHostingSettings()), false);
    assert.equal(isImageHostingReady(settings), false);
});

test('normalizePathPrefix strips slashes and rejects parent segments', () => {
    assert.equal(normalizePathPrefix('/ai/'), 'ai');
    assert.equal(normalizePathPrefix('ai/foo/'), 'ai/foo');
    assert.equal(normalizePathPrefix('../secret/../ai'), 'ai');
    assert.equal(normalizePathPrefix(''), '');
});

test('buildGithubPublicUrl defaults to jsdmirror so Aliyun can download the image', () => {
    const remotePath = 'ai/2026/08/25/1.png';
    assert.equal(
        buildGithubPublicUrl({
            repo: 'Garden12138/picbed-cloud',
            branch: 'main',
            remotePath,
        }),
        'https://cdn.jsdmirror.com/gh/Garden12138/picbed-cloud@main/ai/2026/08/25/1.png',
    );
    assert.equal(
        buildGithubPublicUrl({
            repo: 'Garden12138/picbed-cloud',
            branch: 'main',
            remotePath,
            publicUrlStyle: 'jsdelivr',
        }),
        'https://cdn.jsdelivr.net/gh/Garden12138/picbed-cloud@main/ai/2026/08/25/1.png',
    );
    assert.equal(
        buildGithubPublicUrl({
            repo: 'Garden12138/picbed-cloud',
            branch: 'main',
            remotePath,
            publicUrlStyle: 'raw',
        }),
        'https://raw.githubusercontent.com/Garden12138/picbed-cloud/main/ai/2026/08/25/1.png',
    );
    assert.equal(
        buildGithubPublicUrl({
            repo: 'Garden12138/picbed-cloud',
            branch: 'main',
            remotePath,
            customDomain: 'https://img.example.com/',
            publicUrlStyle: 'raw',
        }),
        'https://img.example.com/ai/2026/08/25/1.png',
    );
});

test('buildRemotePath places files under prefix without date folders', () => {
    const now = new Date('2026-08-25T03:04:05.000Z');
    const remotePath = buildRemotePath({
        pathPrefix: 'ai/',
        fileName: 'cover.PNG',
        now,
        randomId: 'abc123',
    });
    assert.equal(remotePath, `ai/${now.getTime()}-abc123.png`);
});

test('GitHub adapter PUTs Contents API with token auth and returns public URL', async () => {
    const originalFetch = globalThis.fetch;
    const requested: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        requested.push({ url: String(input), init });
        return new Response(JSON.stringify({ content: { path: 'ai/1.png' } }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
        });
    }) as typeof fetch;

    try {
        const result = await uploadToGithub({
            buffer: ONE_PIXEL_PNG,
            fileName: 'cover.png',
            mimeType: 'image/png',
            remotePath: 'ai/1756091045000-abc123.png',
        }, readySettings.configs[0]);

        assert.equal(requested.length, 2);
        assert.equal(
            requested[0].url,
            'https://api.github.com/repos/Garden12138/picbed-cloud/contents/ai/1756091045000-abc123.png',
        );
        assert.equal(requested[0].init?.method, 'PUT');
        const headers = requested[0].init?.headers as Record<string, string>;
        assert.equal(headers.Authorization, 'token ghp_test_token');
        assert.equal(headers.Accept, 'application/vnd.github+json');
        const body = JSON.parse(String(requested[0].init?.body || '{}'));
        assert.equal(body.branch, 'main');
        assert.equal(body.content, ONE_PIXEL_PNG.toString('base64'));
        assert.equal(requested[1].url, result.publicUrl);
        assert.equal(requested[1].init?.method, 'HEAD');
        assert.equal(
            result.publicUrl,
            'https://cdn.jsdmirror.com/gh/Garden12138/picbed-cloud@main/ai/1756091045000-abc123.png',
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('normalizeMediaValueForRemote keeps data URL when image hosting is disabled', async () => {
    const filePath = '/tmp/gardenflow-image-hosting-disabled.png';
    const result = await normalizeMediaValueForRemote(filePath, {
        settings: createDefaultImageHostingSettings(),
        readFile: async () => ONE_PIXEL_PNG,
    });
    assert.equal(result, `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`);
});

test('normalizeMediaValueForRemote uploads local images when GitHub hosting is enabled', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ content: { path: 'ok.png' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    try {
        const now = new Date('2026-08-25T03:04:05.000Z');
        const result = await normalizeMediaValueForRemote('/tmp/cover.png', {
            settings: readySettings,
            readFile: async () => ONE_PIXEL_PNG,
            now,
            randomId: 'abc123',
        });
        assert.equal(
            result,
            `https://cdn.jsdmirror.com/gh/Garden12138/picbed-cloud@main/ai/${now.getTime()}-abc123.png`,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('normalizeMediaValueForRemote leaves generic https URLs unchanged', async () => {
    const result = await normalizeMediaValueForRemote('https://cdn.example.com/a.png', {
        settings: readySettings,
        fetchImpl: async () => {
            throw new Error('should not upload remote https images');
        },
    });
    assert.equal(result, 'https://cdn.example.com/a.png');
});

test('normalizeMediaValueForRemote rewrites GitHub raw and official jsDelivr URLs to jsdmirror', async () => {
    const rawResult = await normalizeMediaValueForRemote(
        'https://raw.githubusercontent.com/Garden12138/picbed-cloud/main/ai-content-ops/2026/08/25/1.png',
        {
            settings: readySettings,
            fetchImpl: async () => {
                throw new Error('should not re-upload an already hosted GitHub image');
            },
        },
    );
    const jsdelivrResult = await normalizeMediaValueForRemote(
        'https://cdn.jsdelivr.net/gh/Garden12138/picbed-cloud@main/ai-content-ops/2026/08/25/1787638391900-ch8eaf.png',
        {
            settings: readySettings,
            fetchImpl: async () => {
                throw new Error('should not re-upload an already hosted GitHub image');
            },
        },
    );
    assert.equal(
        rawResult,
        'https://cdn.jsdmirror.com/gh/Garden12138/picbed-cloud@main/ai-content-ops/2026/08/25/1.png',
    );
    assert.equal(
        jsdelivrResult,
        'https://cdn.jsdmirror.com/gh/Garden12138/picbed-cloud@main/ai-content-ops/2026/08/25/1787638391900-ch8eaf.png',
    );
});

test('waitForPublicUrlReady retries until the public URL returns 2xx', async () => {
    let attempts = 0;
    await waitForPublicUrlReady('https://cdn.jsdelivr.net/gh/Garden12138/picbed-cloud@main/ai/1.png', {
        timeoutMs: 1000,
        intervalMs: 1,
        sleep: async () => undefined,
        fetchImpl: (async () => {
            attempts += 1;
            return new Response('', { status: attempts < 3 ? 404 : 200 });
        }) as typeof fetch,
    });
    assert.equal(attempts, 3);
});

test('updateActiveImageHostingSettings patches the current GitHub config', () => {
    const next = updateActiveImageHostingSettings(createDefaultImageHostingSettings(), {
        enabled: true,
        name: 'ai',
        github: { repo: 'Garden12138/picbed-cloud', token: 'secret' },
    });
    assert.equal(next.enabled, true);
    assert.equal(next.configs[0].name, 'ai');
    assert.equal(next.configs[0].github.repo, 'Garden12138/picbed-cloud');
    assert.equal(next.configs[0].github.token, 'secret');
    assert.equal(next.configs[0].github.branch, 'main');
    assert.equal(next.configs[0].github.publicUrlStyle, 'jsdmirror');
});
