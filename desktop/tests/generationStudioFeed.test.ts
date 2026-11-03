import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import type { GenerationFeedEntry } from '../src/features/media-generation/feedModel.ts';
import type { MediaJobProjection } from '../src/features/media-jobs/types.ts';
import { isSuccessfulAgentGenerationEntry } from '../src/features/media-generation/feedVisibility.ts';

function videoEntry(overrides: Partial<GenerationFeedEntry> = {}): GenerationFeedEntry {
    return {
        kind: 'generation',
        id: 'job:job-video-1',
        createdAt: Date.parse('2026-08-18T08:00:00.000Z'),
        source: 'generation_studio',
        request: {
            type: 'video',
            prompt: '生成视频',
            title: '',
            projectId: '',
            model: 'MiniMax-H3',
            aspectRatio: '16:9',
            resolution: '720p',
            durationSeconds: 5,
            generateAudio: false,
            generationMode: 'text-to-video',
            referenceItems: [],
            referenceAudios: [],
        },
        status: 'success',
        jobId: 'job-video-1',
        queueMode: 'ai_generation',
        ownerSessionId: 'session-1',
        assets: [],
        ...overrides,
    };
}

test('successful agent-owned results are omitted from their chat feed', () => {
    const entry = videoEntry();

    assert.equal(isSuccessfulAgentGenerationEntry(entry, 'session-1'), true);
});

test('standalone and other-session results remain visible in the generation feed', () => {
    const standalone = videoEntry({
        queueMode: 'free_creation',
        ownerSessionId: undefined,
    });
    const anotherSession = videoEntry({ ownerSessionId: 'session-2' });

    assert.equal(isSuccessfulAgentGenerationEntry(standalone, 'session-1'), false);
    assert.equal(isSuccessfulAgentGenerationEntry(anotherSession, 'session-1'), false);
});

test('reopening the feed drops stale running cards and restores actual jobs from the queue', async () => {
    const bundle = await build({
        entryPoints: [new URL('../src/features/media-generation/feedModel.ts', import.meta.url).pathname],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
    });
    const module = { exports: {} as typeof import('../src/features/media-generation/feedModel.ts') };
    const storage = new Map<string, string>();
    vm.runInNewContext(bundle.outputFiles[0].text, {
        module, exports: module.exports,
        window: { localStorage: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
        } },
    });
    const feed = module.exports;
    const session = {
        kind: 'agent-session' as const,
        id: 'agent-entry',
        sessionId: 'session-1',
        contextId: 'generation-studio',
        title: '自由创作',
        source: 'generation_studio',
        createdAt: videoEntry().createdAt,
    };
    const stale = videoEntry({ id: 'stale-agent-card', status: 'running', jobId: undefined });
    storage.set(feed.FEED_STORAGE_KEY, JSON.stringify([session, stale]));
    const restored = feed.readPersistedFeedEntries();
    assert.deepEqual(Array.from(restored, (entry) => entry.id), [session.id]);

    const job: MediaJobProjection = {
        jobId: 'real-job', kind: 'video', source: 'generation_studio', queueMode: 'free_creation',
        priority: 'interactive', status: 'polling', providerKey: 'video', request: { prompt: '生成视频' },
        createdAt: new Date(stale.createdAt).toISOString(), updatedAt: new Date(stale.createdAt).toISOString(),
        artifacts: [], recentEvents: [],
    };
    const deleted = feed.normalizeDeletedFeedState(null);
    const withJob = feed.mergeMediaJobsIntoFeedEntries(restored, [job], deleted);
    assert.ok(withJob.some((entry) => entry.kind === 'generation' && entry.jobId === job.jobId && entry.status === 'running'));
    feed.persistFeedEntries(withJob);
    assert.deepEqual(JSON.parse(storage.get(feed.FEED_STORAGE_KEY)!), [session]);

    const pending = videoEntry({ id: 'new-submission', status: 'running', jobId: undefined });
    const unrelated = feed.mergeMediaJobsIntoFeedEntries([pending], [job], deleted);
    assert.equal(unrelated.length, 2);
    const matched = feed.mergeMediaJobsIntoFeedEntries([pending], [{
        ...job,
        request: { ...job.request, clientRequestId: pending.id },
        status: 'completed',
    }], deleted);
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, pending.id);
    assert.ok(matched[0].kind === 'generation' && matched[0].status === 'success');
});
