import assert from 'node:assert/strict';
import test from 'node:test';
import type { GenerationFeedEntry } from '../src/features/media-generation/feedModel.ts';
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
