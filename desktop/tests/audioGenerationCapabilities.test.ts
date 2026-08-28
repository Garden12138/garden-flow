import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildDashScopeMiniMaxSpeechRequest,
    buildDashScopeMultimodalGenerationUrl,
    createDashScopeMiniMaxFallbackVoice,
    isDashScopeMiniMaxSpeechRoute,
    parseDashScopeMiniMaxSpeechResponse,
    parseDashScopeMiniMaxVoices,
    resolveAudioModelRoute,
} from '../shared/audioGenerationCapabilities.ts';

const settings = {
    default_ai_source_id: 'dashscope',
    ai_sources_json: JSON.stringify([
        {
            id: 'dashscope',
            name: '阿里云百炼',
            presetId: 'dashscope',
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            apiKey: 'dashscope-key',
            modelsMeta: [{ id: 'MiniMax/speech-2.8-hd', capabilities: ['tts'] }],
        },
        {
            id: 'openai',
            name: 'OpenAI',
            baseURL: 'https://api.openai.com/v1',
            apiKey: 'openai-key',
            models: ['gpt-4o-mini-tts'],
        },
    ]),
    ai_model_routes_json: JSON.stringify({
        voiceTts: { sourceId: 'dashscope', model: 'MiniMax/speech-2.8-hd' },
    }),
    voice_tts_model: 'MiniMax/speech-2.8-hd',
};

test('audio route keeps configured model and rejects an agent-invented model override', () => {
    const configured = resolveAudioModelRoute(settings, 'MiniMax/speech-2.8-hd');
    assert.equal(configured.model, 'MiniMax/speech-2.8-hd');
    assert.equal(configured.source?.id, 'dashscope');
    assert.equal(configured.apiKey, 'dashscope-key');

    const recovered = resolveAudioModelRoute(settings, 'elevenlabs');
    assert.equal(recovered.model, 'MiniMax/speech-2.8-hd');
    assert.equal(recovered.source?.id, 'dashscope');

    const explicitlyConfigured = resolveAudioModelRoute(settings, 'gpt-4o-mini-tts');
    assert.equal(explicitlyConfigured.model, 'gpt-4o-mini-tts');
    assert.equal(explicitlyConfigured.source?.id, 'openai');
});

test('DashScope MiniMax uses the multimodal generation endpoint', () => {
    assert.equal(
        buildDashScopeMultimodalGenerationUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'),
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    assert.equal(
        buildDashScopeMultimodalGenerationUrl('https://example.maas.aliyuncs.com/api/v1'),
        'https://example.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    assert.equal(
        isDashScopeMiniMaxSpeechRoute(
            'MiniMax/speech-2.8-hd',
            'https://dashscope.aliyuncs.com/compatible-mode/v1',
        ),
        true,
    );
});

test('DashScope MiniMax request uses the provider-specific nested schema', () => {
    const request = buildDashScopeMiniMaxSpeechRequest({
        model: 'MiniMax/speech-2.8-hd',
        text: 'Hello world',
        languageBoost: 'en',
        responseFormat: 'mp3',
    });

    assert.equal(request.input.voice_setting.voice_id, 'male-qn-qingse');
    assert.equal(request.input.voice_setting.speed, 1);
    assert.equal(request.input.language_boost, 'English');
    assert.equal(request.input.audio_setting.format, 'mp3');
    assert.equal(request.input.output_format, 'hex');
    assert.equal('voice' in request, false);
    assert.throws(
        () => buildDashScopeMiniMaxSpeechRequest({
            model: 'MiniMax/speech-2.8-hd',
            text: 'Hello',
            speed: 3,
        }),
        /0\.5–2\.0/,
    );
});

test('DashScope MiniMax response parsers expose audio and model-compatible voices', () => {
    const audio = parseDashScopeMiniMaxSpeechResponse({
        output: {
            base_resp: { status_code: 0, status_msg: 'success' },
            data: { audio: '49443304', status: 2 },
            extra_info: { audio_format: 'mp3' },
        },
    });
    assert.deepEqual(audio, { audio: '49443304', encoding: 'hex', format: 'mp3' });

    const voices = parseDashScopeMiniMaxVoices({
        output: {
            base_resp: { status_code: 0, status_msg: 'success' },
            system_voice: [{ voice_id: 'male-qn-qingse', voice_name: '青涩青年音色' }],
        },
    }, 'MiniMax/speech-2.8-hd');
    assert.equal(voices[0].systemVoice, true);
    assert.deepEqual(voices[0].supportedModels, ['MiniMax/speech-2.8-hd']);
    assert.match(voices[0].languageBoost, /English/);
    assert.equal(createDashScopeMiniMaxFallbackVoice('MiniMax/speech-2.8-hd').id, 'male-qn-qingse');

    assert.throws(
        () => parseDashScopeMiniMaxSpeechResponse({
            output: { base_resp: { status_code: 2013, status_msg: 'invalid voice_id' } },
        }),
        /2013: invalid voice_id/,
    );
});
