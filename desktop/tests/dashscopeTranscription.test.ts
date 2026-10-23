import assert from 'node:assert/strict';
import test from 'node:test';
import { supportsDashscopeFlashTranscription, transcribeDashscopeFlash } from '../electron/core/dashscopeTranscription.ts';

const input = { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-audio-3.0-asr-flash', apiKey: 'test-only-key', audioBuffer: Buffer.from('synthetic-audio'), mimeType: 'audio/mpeg' };

test('Flash ASR routing requires the configured model and a matching provider origin', () => {
    assert.equal(supportsDashscopeFlashTranscription(input.endpoint, input.model), true);
    assert.equal(supportsDashscopeFlashTranscription('https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', 'qwen-audio-3.1-asr-flash'), true);
    for (const endpoint of ['https://dashscope.aliyuncs.com.evil.example/v1', 'https://example.com/v1', 'http://dashscope.aliyuncs.com/v1', 'https://user:password@dashscope.aliyuncs.com/v1']) assert.equal(supportsDashscopeFlashTranscription(endpoint, input.model), false);
    for (const model of ['whisper-1', 'qwen-audio-3.0-asr-flash-streaming', 'qwen-audio-3.0-asr-flash-filetrans', 'qwen3-asr-flash']) assert.equal(supportsDashscopeFlashTranscription(input.endpoint, model), false);
});

test('Flash ASR sends only prepared audio to the configured origin and reads its native response', async () => {
    const request = async (url: URL | RequestInfo, options?: RequestInit) => {
        assert.equal(String(url), 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
        assert.equal(options?.redirect, 'error');
        const body = JSON.parse(String(options?.body));
        assert.equal(body.model, input.model);
        assert.equal(body.input.messages[0].content[0].input_audio.data, `data:audio/mpeg;base64,${input.audioBuffer.toString('base64')}`);
        assert.deepEqual(body.parameters, { format: 'mp3' });
        return new Response(JSON.stringify({ output: { text: '  已识别文本  ' } }));
    };
    assert.equal(await transcribeDashscopeFlash(input, request as typeof fetch), '已识别文本');
    assert.equal(await transcribeDashscopeFlash(input, (async () => new Response(JSON.stringify({ output: { sentence: { text: 'Sentence result' } } }))) as typeof fetch), 'Sentence result');
});

test('Flash ASR rejects invalid or oversized input without invoking the provider', async () => {
    const request = (async () => { throw new Error('Provider must not be called'); }) as typeof fetch;
    await assert.rejects(transcribeDashscopeFlash({ ...input, mimeType: 'video/mp4' }, request), /音频文件/);
    await assert.rejects(transcribeDashscopeFlash({ ...input, audioBuffer: Buffer.alloc(0) }, request), /音频文件/);
    await assert.rejects(transcribeDashscopeFlash({ ...input, audioBuffer: Buffer.alloc(8 * 1024 * 1024) }, request), /10 MB/);
    await assert.rejects(transcribeDashscopeFlash({ ...input, endpoint: 'https://example.com' }, request), /端点或模型/);
});

test('Flash ASR failures remain failures without exposing response bodies or producing false transcripts', async () => {
    await assert.rejects(transcribeDashscopeFlash(input, (async () => new Response(input.apiKey, { status: 429 })) as typeof fetch), (error: Error) => error.message.includes('429') && !error.message.includes(input.apiKey));
    await assert.rejects(transcribeDashscopeFlash(input, (async () => new Response(JSON.stringify({ code: 'InvalidParameter', message: `Rejected ${input.apiKey}` }), { status: 400 })) as typeof fetch), (error: Error) => error.message.includes('InvalidParameter') && !error.message.includes(input.apiKey));
    for (const output of [{}, { output: { text: '' } }, { output: { text: 123 } }]) await assert.rejects(transcribeDashscopeFlash(input, (async () => new Response(JSON.stringify(output))) as typeof fetch), /有效文本/);
});
