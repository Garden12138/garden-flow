import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '../src/components/MessageItem.tsx';
import { finalizeCancelledChatMessages } from '../src/features/chat/chatCancellation.ts';
import { buildEditorSessionBinding } from '../src/features/chat/editorSessionBinding.ts';
import { validateRuntimeCompletion } from '../electron/core/ai/runtimeCompletion.ts';
import {
  INTENT_NAMES,
  resolveIntentExecutionPolicy,
} from '../electron/core/ai/intentRoutePolicy.ts';
import type { IntentRoute } from '../electron/core/ai/types.ts';
import {
  AudioGenerateParamsSchema,
  ImageGenerateParamsSchema,
  MEDIA_GENERATION_TOOL_NAMES,
  VideoGenerateParamsSchema,
  applyGenerationToolConstraints,
  generationIntentForMode,
} from '../shared/mediaGenerationContracts.ts';
import {
  attachmentParticipatesInChatRuntime,
  attachmentRequiresDirectModelInput,
} from '../shared/chatAttachmentDelivery.ts';
import { mergeContextSessionMetadata } from '../shared/contextSessionMetadata.ts';
import { resolveLocalAssetByteRange } from '../shared/localAsset.ts';
import {
  buildChatRunMessageMetadata,
  parseChatRunMessageMetadata,
} from '../shared/chatRunState.ts';
import { reduceChatRunEnvelope } from '../src/runtime/chatSessionStore.ts';
import { formatProcessingElapsed, resolveProcessingEndAt } from '../src/utils/processingElapsed.ts';
import {
  fetchLlmWithRetry,
  formatLlmFetchError,
} from '../electron/core/llmFetchRetry.ts';
import {
  buildAliyunBailianVideoCreateUrl,
  buildAliyunBailianVideoCreateUrlCandidates,
  buildAliyunBailianVideoRequest,
  buildAliyunBailianVideoTaskUrl,
  buildMiniMaxVideoCreateUrl,
  buildMiniMaxVideoQueryUrl,
  buildMiniMaxVideoRequest,
  normalizeMiniMaxReferenceAudioUrl,
  resolveVideoProvider,
} from '../shared/videoProvider.ts';

const manuscriptRoute: IntentRoute = {
  intent: 'manuscript_creation',
  secondaryIntents: [],
  goal: '生成并保存视频笔记',
  deliverables: ['结构化视频笔记工程'],
  requiredCapabilities: ['planning', 'writing', 'artifact-save'],
  recommendedRole: 'copywriter',
  requiresLongRunningTask: false,
  requiresMultiAgent: false,
  requiresHumanApproval: false,
  confidence: 0.98,
  reasoning: '用户要求生成结构化视频笔记',
  source: 'llm+rule',
};

const imageRoute: IntentRoute = {
  ...manuscriptRoute,
  intent: 'image_creation',
  goal: '生成小红书整篇配图',
  deliverables: ['图片'],
  requiredCapabilities: ['image-generation'],
  recommendedRole: 'image-director',
};

test('keeps video generation as an explicit routed intent and enforces its execution policy', () => {
  assert.ok(INTENT_NAMES.includes('video_creation'));
  const policy = resolveIntentExecutionPolicy({
    intent: 'video_creation',
    declaredCapabilities: ['planning'],
    recommendedRole: 'copywriter',
  });

  assert.equal(policy.recommendedRole, 'video-director');
  assert.deepEqual(policy.requiredCapabilities, ['planning', 'video-generation', 'artifact-save']);
});

test('keeps image, video, and audio generation as separate session capabilities', () => {
  assert.equal(generationIntentForMode('image'), 'image_creation');
  assert.equal(generationIntentForMode('video'), 'video_creation');
  assert.equal(generationIntentForMode('audio'), 'audio_creation');
  assert.equal(generationIntentForMode('cover'), 'cover_generation');
});

test('exposes dedicated typed image, video, and audio generation tools', () => {
  assert.deepEqual(MEDIA_GENERATION_TOOL_NAMES, ['image_generate', 'video_generate', 'audio_generate']);
  assert.equal(VideoGenerateParamsSchema.safeParse({
    prompt: '参考声音节奏生成视频',
    generationMode: 'reference-guided',
    referenceAudios: ['/tmp/reference.wav'],
    generateAudio: false,
  }).success, true);
});

test('locks video tool inputs to the model and references selected in Generation Studio', () => {
  const selectedInputs = {
    videoGenerate: {
      operation: 'generate' as const,
      model: 'MiniMax-H3',
      generationMode: 'reference-guided' as const,
      referenceImages: ['/tmp/reference.png'],
      referenceAudios: ['/tmp/reference.mp3'],
      durationSeconds: 5,
      aspectRatio: '16:9',
      resolution: '720p' as const,
      generateAudio: false,
    },
  };
  const effective = applyGenerationToolConstraints('video_generate', {
    prompt: '按参考素材生成视频',
    model: 'wan2.7-r2v-video',
    referenceImages: ['/tmp/agent-replacement.png'],
  }, selectedInputs);

  assert.deepEqual(effective, {
    prompt: '按参考素材生成视频',
    operation: 'generate',
    model: 'MiniMax-H3',
    generationMode: 'reference-guided',
    referenceImages: ['/tmp/reference.png'],
    referenceAudios: ['/tmp/reference.mp3'],
    durationSeconds: 5,
    aspectRatio: '16:9',
    resolution: '720p',
    generateAudio: false,
  });
  assert.equal(VideoGenerateParamsSchema.safeParse(effective).success, true);
});

test('locks app_cli video payloads without changing non-video commands', () => {
  const constraints = {
    videoGenerate: {
      model: 'MiniMax-H3',
      referenceAudios: ['/tmp/reference.mp3'],
    },
  };
  assert.deepEqual(applyGenerationToolConstraints('app_cli', {
    command: 'video generate',
    payload: { prompt: '生成', model: 'wan2.7-r2v-video' },
  }, constraints), {
    command: 'video generate',
    payload: {
      prompt: '生成',
      model: 'MiniMax-H3',
      referenceAudios: ['/tmp/reference.mp3'],
    },
  });
  assert.deepEqual(applyGenerationToolConstraints('app_cli', {
    command: 'image generate',
    payload: { prompt: '生成图片' },
  }, constraints), {
    command: 'image generate',
    payload: { prompt: '生成图片' },
  });
});

test('keeps display-only reference audio in chat history without sending it to the chat model', () => {
  assert.equal(attachmentParticipatesInChatRuntime({
    type: 'uploaded-file',
    kind: 'audio',
    displayOnly: true,
    absolutePath: '/tmp/reference.mp3',
  }), false);
  assert.equal(attachmentParticipatesInChatRuntime({
    type: 'uploaded-file',
    kind: 'image',
    absolutePath: '/tmp/reference.png',
  }), true);
});

test('locks explicitly selected image and audio models as runtime-owned inputs', () => {
  assert.deepEqual(applyGenerationToolConstraints('image_generate', {
    prompt: '生成封面',
    model: 'agent-selected-model',
  }, {
    imageGenerate: { model: 'user-selected-image-model' },
  }), {
    prompt: '生成封面',
    model: 'user-selected-image-model',
  });
  assert.deepEqual(applyGenerationToolConstraints('audio_generate', {
    text: '你好',
    model: 'agent-selected-model',
    voiceId: 'agent-selected-voice',
  }, {
    audioGenerate: {
      model: 'user-selected-audio-model',
      voiceId: 'user-selected-voice',
    },
  }), {
    text: '你好',
    model: 'user-selected-audio-model',
    voiceId: 'user-selected-voice',
  });
});

test('persists generation capability metadata when a context session is created or reused', () => {
  const metadata = mergeContextSessionMetadata({
    currentMetadata: { unread: false, intent: 'image_creation' },
    requestedMetadata: {
      intent: 'video_creation',
      generationTarget: 'video',
      preferredRole: 'video-director',
    },
    contextId: 'generation-studio:agent:project',
    contextType: 'generation-agent',
    initialContext: '创作上下文',
  });

  assert.equal(metadata.intent, 'video_creation');
  assert.equal(metadata.generationTarget, 'video');
  assert.equal(metadata.preferredRole, 'video-director');
  assert.equal(metadata.contextType, 'generation-agent');
  assert.equal(metadata.contextContent, '创作上下文');
  assert.equal(metadata.unread, false);
});

test('supports chaining standalone generated images into reference-guided video', () => {
  const standaloneImage = ImageGenerateParamsSchema.safeParse({
    prompt: '两只边牧的角色参考图',
    count: 2,
    aspectRatio: '9:16',
  });
  assert.equal(standaloneImage.success, true);

  const chainedVideo = VideoGenerateParamsSchema.safeParse({
    prompt: '让两只边牧在草地上互动',
    generationMode: 'reference-guided',
    referenceImages: ['/media/xika.png', '/media/ximilu.png'],
    notePath: '/manuscripts/dogs.redvideo',
    slotId: 'final-video',
  });
  assert.equal(chainedVideo.success, true);

  assert.equal(ImageGenerateParamsSchema.safeParse({
    prompt: '错误地绑定中间参考图',
    notePath: '/manuscripts/dogs.redvideo',
  }).success, false);
  assert.equal(VideoGenerateParamsSchema.safeParse({
    prompt: '缺少参考图',
    generationMode: 'reference-guided',
  }).success, false);
  assert.equal(AudioGenerateParamsSchema.safeParse({ text: '欢迎关注' }).success, true);
});

test('keeps processing time live until a terminal timestamp freezes it', () => {
  const startedAt = 1_000;
  assert.equal(resolveProcessingEndAt({
    startedAt,
    isRunning: true,
    now: 763_000,
  }), 763_000);
  assert.equal(formatProcessingElapsed(763_000 - startedAt), '12m 42s');

  assert.equal(resolveProcessingEndAt({
    startedAt,
    finishedAt: 9_000,
    isRunning: false,
    now: 20_000,
  }), 9_000);
  assert.equal(resolveProcessingEndAt({
    startedAt,
    isRunning: false,
    now: 20_000,
  }), startedAt);
});

test('round-trips persisted chat run state used to recover after navigation', () => {
  const metadata = buildChatRunMessageMetadata({
    messageKind: 'chat-run',
    runId: 'run-1',
    status: 'running',
    startedAt: 1_700_000_000_000,
  });

  assert.deepEqual(parseChatRunMessageMetadata(metadata), {
    messageKind: 'chat-run',
    runId: 'run-1',
    status: 'running',
    startedAt: 1_700_000_000_000,
    finishedAt: undefined,
    error: undefined,
  });
  assert.equal(parseChatRunMessageMetadata('{"messageKind":"chat-run","status":"running"}'), null);
  assert.equal(parseChatRunMessageMetadata('{"messageKind":"other"}'), null);
});

test('round-trips the structured chat run identity and sequence', () => {
  const metadata = buildChatRunMessageMetadata({
    messageKind: 'chat-run',
    runId: 'run-structured',
    userMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
    status: 'queued',
    phase: 'queued',
    sequence: 0,
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_100,
  });

  assert.deepEqual(parseChatRunMessageMetadata(metadata), {
    messageKind: 'chat-run',
    runId: 'run-structured',
    userMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
    status: 'queued',
    phase: 'queued',
    sequence: 0,
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_100,
    finishedAt: undefined,
    error: undefined,
  });
});

test('chat session reducer preserves repeated deltas and ignores out-of-order events', () => {
  const event = (sequence: number, content: string) => ({
    eventId: `event-${sequence}`,
    eventType: 'runtime:text-delta',
    sessionId: 'session-1',
    runId: 'run-1',
    userMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
    sequence,
    status: 'running',
    phase: 'responding',
    timestamp: sequence,
    payload: { content, stream: 'response', sequence },
  });

  const first = reduceChatRunEnvelope(null, event(1, '哈'));
  const second = reduceChatRunEnvelope(first, event(2, '哈'));
  const stale = reduceChatRunEnvelope(second, event(1, '不应重复'));

  assert.equal(second?.content, '哈哈');
  assert.equal(stale, second);
});

test('chat session reducer handles long runs and terminal events idempotently', () => {
  let run = null;
  for (let sequence = 1; sequence <= 1001; sequence += 1) {
    run = reduceChatRunEnvelope(run, {
      eventType: 'runtime:text-delta',
      sessionId: 'session-long',
      runId: 'run-long',
      assistantMessageId: 'assistant-long',
      sequence,
      timestamp: sequence,
      payload: { content: 'x', stream: 'response', sequence },
    });
  }
  assert.equal(run?.content.length, 1001);

  const done = reduceChatRunEnvelope(run, {
    eventType: 'runtime:done',
    sessionId: 'session-long',
    runId: 'run-long',
    assistantMessageId: 'assistant-long',
    sequence: 1002,
    timestamp: 1002,
    payload: { content: '最终结果', status: 'completed', sequence: 1002 },
  });
  const duplicateDone = reduceChatRunEnvelope(done, {
    eventType: 'runtime:done',
    sessionId: 'session-long',
    runId: 'run-long',
    assistantMessageId: 'assistant-long',
    sequence: 1002,
    timestamp: 1002,
    payload: { content: '重复结果', status: 'completed', sequence: 1002 },
  });

  assert.equal(done?.status, 'completed');
  assert.equal(done?.content, '最终结果');
  assert.equal(duplicateDone, done);
});

test('allows a staged manuscript attachment to fall back from model vision to tool-read', () => {
  assert.equal(attachmentRequiresDirectModelInput({
    kind: 'image',
    requiresMultimodal: true,
    deliveryMode: 'tool-read',
    absolutePath: '/workspace/uploads/reference.png',
  }), false);
  assert.equal(attachmentRequiresDirectModelInput({
    kind: 'image',
    requiresMultimodal: true,
    deliveryMode: 'direct-input',
    absolutePath: '/workspace/uploads/reference.png',
  }), true);
  assert.equal(attachmentRequiresDirectModelInput({
    kind: 'image',
    requiresMultimodal: true,
  }), true);
});

test('resolves local video byte ranges used by replay and seeking', () => {
  assert.deepEqual(resolveLocalAssetByteRange('bytes=0-499', 1_000), { start: 0, end: 499 });
  assert.deepEqual(resolveLocalAssetByteRange('bytes=500-', 1_000), { start: 500, end: 999 });
  assert.deepEqual(resolveLocalAssetByteRange('bytes=-200', 1_000), { start: 800, end: 999 });
  assert.deepEqual(resolveLocalAssetByteRange('bytes=900-1200', 1_000), { start: 900, end: 999 });
  assert.equal(resolveLocalAssetByteRange('bytes=1000-', 1_000), null);
  assert.equal(resolveLocalAssetByteRange('bytes=0-1,4-5', 1_000), null);
});

test('builds the official Aliyun Bailian async video routes and HappyHorse payload', () => {
  const endpoint = 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1';
  assert.equal(resolveVideoProvider(endpoint, 'happyhorse-1.1-r2v'), 'aliyun-bailian');
  assert.equal(
    buildAliyunBailianVideoCreateUrl(endpoint),
    'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
  );
  assert.equal(
    buildAliyunBailianVideoCreateUrl('https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis'),
    'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
  );
  assert.equal(
    buildAliyunBailianVideoTaskUrl(endpoint, 'task/a b'),
    'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/tasks/task%2Fa%20b',
  );
  assert.deepEqual(buildAliyunBailianVideoCreateUrlCandidates(endpoint), [
    'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
  ]);
  assert.deepEqual(buildAliyunBailianVideoRequest({
    model: 'happyhorse-1.1-r2v',
    prompt: '镜头提示词',
    referenceImages: ['https://example.com/1.jpg'],
    resolution: '720p',
    aspectRatio: '9:16',
    durationSeconds: 5,
  }), {
    model: 'happyhorse-1.1-r2v',
    input: {
      prompt: '镜头提示词',
      media: [{ type: 'reference_image', url: 'https://example.com/1.jpg' }],
    },
    parameters: {
      resolution: '720P',
      ratio: '9:16',
      duration: 5,
    },
  });
});

test('builds the official MiniMax H3 async video routes and multimodal payload', () => {
  assert.equal(resolveVideoProvider('https://api.minimaxi.com', 'MiniMax-H3'), 'minimax');
  assert.equal(
    buildMiniMaxVideoCreateUrl('https://api.minimaxi.com'),
    'https://api.minimaxi.com/v2/video_generation',
  );
  assert.equal(
    buildMiniMaxVideoCreateUrl('https://api.minimaxi.com/v2/video_generation'),
    'https://api.minimaxi.com/v2/video_generation',
  );
  assert.equal(
    buildMiniMaxVideoQueryUrl('https://api.minimaxi.com', 'task/a b'),
    'https://api.minimaxi.com/v2/query/video_generation/task%2Fa%20b',
  );
  assert.deepEqual(buildMiniMaxVideoRequest({
    model: 'MiniMax-H3',
    prompt: '镜头提示词',
    referenceImages: ['https://example.com/first.jpg', 'https://example.com/last.jpg'],
    generationMode: 'first-last-frame',
    resolution: '1080p',
    aspectRatio: '9:16',
    durationSeconds: 15,
  }), {
    model: 'MiniMax-H3',
    content: [
      { type: 'text', text: '镜头提示词' },
      { type: 'image_url', image_url: { url: 'https://example.com/first.jpg' }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: 'https://example.com/last.jpg' }, role: 'last_frame' },
    ],
    resolution: '2K',
    duration: 15,
    ratio: 'adaptive',
  });
  assert.deepEqual(buildMiniMaxVideoRequest({
    model: 'MiniMax-H3',
    prompt: '参考运镜和声音',
    referenceImages: ['https://example.com/reference.jpg'],
    referenceAudios: [
      'https://example.com/voice.mp3',
      'https://example.com/rhythm.wav',
    ],
    generationMode: 'reference-guided',
    resolution: '720p',
    aspectRatio: '16:9',
    durationSeconds: 5,
  }), {
    model: 'MiniMax-H3',
    content: [
      { type: 'text', text: '参考运镜和声音' },
      { type: 'image_url', image_url: { url: 'https://example.com/reference.jpg' }, role: 'reference_image' },
      { type: 'audio_url', audio_url: { url: 'https://example.com/voice.mp3' }, role: 'reference_audio' },
      { type: 'audio_url', audio_url: { url: 'https://example.com/rhythm.wav' }, role: 'reference_audio' },
    ],
    resolution: '768P',
    duration: 5,
    ratio: '16:9',
  });
});

test('normalizes standard MP3 data URLs to the subtype accepted by MiniMax video', () => {
  const normalized = normalizeMiniMaxReferenceAudioUrl('data:audio/mpeg;base64,SUQzBAAAAAA=');
  assert.equal(normalized, 'data:audio/mp3;base64,SUQzBAAAAAA=');
  assert.equal(
    normalizeMiniMaxReferenceAudioUrl('data:audio/wav;base64,UklGRg=='),
    'data:audio/wav;base64,UklGRg==',
  );
  const request = buildMiniMaxVideoRequest({
    model: 'MiniMax-H3',
    prompt: '参考音频生成视频',
    referenceImages: [],
    referenceAudios: [normalized],
    generationMode: 'reference-guided',
    resolution: '720p',
    aspectRatio: '16:9',
    durationSeconds: 5,
  });
  assert.deepEqual(request.content.find((item) => item.type === 'audio_url'), {
    type: 'audio_url',
    audio_url: { url: 'data:audio/mp3;base64,SUQzBAAAAAA=' },
    role: 'reference_audio',
  });
});

test('rejects a progress-only final response when a routed artifact is still missing', () => {
  const result = validateRuntimeCompletion({
    route: manuscriptRoute,
    artifacts: [],
  });

  assert.equal(result.complete, false);
  assert.match(result.feedback || '', /尚未收到任何成功的产物工具回执/);
});

test('requires real image and video artifacts for a routed media generation task', () => {
  const route: IntentRoute = {
    ...imageRoute,
    requiredCapabilities: ['image-generation', 'video-generation'],
    deliverables: ['两只边牧的图片', '基于图片生成的视频'],
  };
  const missingAll = validateRuntimeCompletion({ route, artifacts: [] });
  assert.equal(missingAll.complete, false);
  assert.match(missingAll.feedback || '', /缺少成功的图片和视频产物回执/);

  const missingVideo = validateRuntimeCompletion({
    route,
    artifacts: [{ id: 'image-1', type: 'image', label: 'dog', createdAt: Date.now() }],
  });
  assert.equal(missingVideo.complete, false);
  assert.match(missingVideo.feedback || '', /缺少成功的视频产物回执/);

  const completed = validateRuntimeCompletion({
    route,
    artifacts: [
      { id: 'image-1', type: 'image', label: 'dog', createdAt: Date.now() },
      { id: 'video-1', type: 'video', label: 'dogs', createdAt: Date.now() },
    ],
  });
  assert.equal(completed.complete, true);

  const completedWithBoundVideo = validateRuntimeCompletion({
    route,
    artifacts: [
      { id: 'image-1', type: 'image', label: 'dog', createdAt: Date.now() },
    ],
    xhsMediaState: {
      notePath: 'xiaohongshu/dogs.redvideo',
      noteType: 'video',
      completionScope: 'note',
      mediaSlots: [{ id: 'final-video', role: 'video', status: 'ready' }],
    },
  });
  assert.equal(completedWithBoundVideo.complete, true);
});

test('requires a real audio artifact for audio generation', () => {
  const route: IntentRoute = {
    ...imageRoute,
    intent: 'audio_creation',
    requiredCapabilities: ['planning', 'audio-generation', 'artifact-save'],
    deliverables: ['旁白音频'],
    recommendedRole: 'audio-director',
  };
  assert.equal(validateRuntimeCompletion({ route, artifacts: [] }).complete, false);
  assert.equal(validateRuntimeCompletion({
    route,
    artifacts: [{ id: 'audio-1', type: 'audio', label: 'voiceover', createdAt: Date.now() }],
  }).complete, true);
});

test('accepts an authoring response after a real XHS project artifact is registered', () => {
  const result = validateRuntimeCompletion({
    route: manuscriptRoute,
    artifacts: [{
      id: 'artifact-1',
      type: 'xiaohongshu-note-project',
      label: 'video',
      createdAt: Date.now(),
    }],
  });

  assert.equal(result.complete, true);
});

test('honors an explicit requireSave contract even when routing used a rule fallback', () => {
  const result = validateRuntimeCompletion({
    route: {
      ...manuscriptRoute,
      deliverables: [],
      source: 'rule',
    },
    metadata: { requireSave: true },
    artifacts: [],
  });

  assert.equal(result.complete, false);
});

test('does not force artifact creation for a direct-answer route', () => {
  const result = validateRuntimeCompletion({
    route: {
      ...manuscriptRoute,
      intent: 'direct_answer',
      deliverables: [],
      requiredCapabilities: ['direct-answer'],
      recommendedRole: 'planner',
    },
    artifacts: [],
  });

  assert.equal(result.complete, true);
});

test('rejects a partially generated XHS image note even after image artifacts exist', () => {
  const result = validateRuntimeCompletion({
    route: imageRoute,
    artifacts: [{
      id: 'artifact-cover',
      type: 'image',
      label: 'cover',
      createdAt: Date.now(),
    }],
    xhsMediaState: {
      notePath: 'xiaohongshu/demo.redpost',
      noteType: 'image',
      completionScope: 'note',
      requestedSlotIds: ['cover'],
      mediaSlots: [
        { id: 'cover', role: 'cover', status: 'ready' },
        { id: 'page-1', role: 'image-page', status: 'ready' },
        { id: 'page-2', role: 'image-page', status: 'empty' },
      ],
    },
  });

  assert.equal(result.complete, false);
  assert.match(result.feedback || '', /page-2:empty/);
  assert.equal(result.maxRecoveryAttempts, 6);
});

test('accepts an XHS image note only after every required note slot is ready', () => {
  const result = validateRuntimeCompletion({
    route: imageRoute,
    xhsMediaState: {
      notePath: 'xiaohongshu/demo.redpost',
      noteType: 'image',
      completionScope: 'note',
      mediaSlots: [
        { id: 'cover', role: 'cover', status: 'ready' },
        { id: 'page-1', role: 'image-page', status: 'ready' },
        { id: 'page-2', role: 'image-page', status: 'ready' },
      ],
    },
  });

  assert.equal(result.complete, true);
});

test('allows an explicitly scoped XHS slot task without requiring the rest of the note', () => {
  const result = validateRuntimeCompletion({
    route: imageRoute,
    xhsMediaState: {
      notePath: 'xiaohongshu/demo.redpost',
      noteType: 'image',
      completionScope: 'slot',
      requestedSlotIds: ['cover'],
      mediaSlots: [
        { id: 'cover', role: 'cover', status: 'ready' },
        { id: 'page-1', role: 'image-page', status: 'empty' },
      ],
    },
  });

  assert.equal(result.complete, true);
});

test('retries a transient LLM transport failure and returns the next response', async () => {
  let attempts = 0;
  const response = await fetchLlmWithRetry('https://example.invalid/chat/completions', {}, {
    maxAttempts: 2,
    baseDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new TypeError('fetch failed');
        (error as TypeError & { cause?: unknown }).cause = {
          code: 'ECONNRESET',
          message: 'socket disconnected',
        };
        throw error;
      }
      return new Response('{}', { status: 200 });
    },
  });

  assert.equal(attempts, 2);
  assert.equal(response.status, 200);
});

test('keeps the underlying network code in the final LLM error', async () => {
  const transportError = new TypeError('fetch failed');
  (transportError as TypeError & { cause?: unknown }).cause = {
    code: 'ENOTFOUND',
    syscall: 'getaddrinfo',
    hostname: 'api.example.invalid',
    message: 'getaddrinfo ENOTFOUND api.example.invalid',
  };

  assert.match(formatLlmFetchError(transportError), /code=ENOTFOUND/);
  await assert.rejects(
    fetchLlmWithRetry('https://example.invalid/chat/completions', {}, {
      maxAttempts: 1,
      fetchImpl: async () => {
        throw transportError;
      },
    }),
    /code=ENOTFOUND/,
  );
});

test('finishes streaming placeholders and running timeline items when chat is cancelled', () => {
  const messages: Message[] = [
    {
      id: 'user-1',
      role: 'user',
      content: '修改标题',
      timeline: [],
      tools: [],
    },
    {
      id: 'thinking-1',
      role: 'ai',
      messageType: 'thinking',
      content: '正在思考',
      timeline: [],
      tools: [],
      isStreaming: true,
      processingStartedAt: 100,
    },
    {
      id: 'reply-1',
      role: 'ai',
      messageType: 'reply',
      content: '',
      timeline: [{
        id: 'phase-1',
        type: 'phase',
        content: '正在处理',
        status: 'running',
        timestamp: 200,
      }],
      tools: [],
      isStreaming: false,
      suppressPendingIndicator: true,
    },
  ];

  const result = finalizeCancelledChatMessages(messages, 1200);

  assert.notStrictEqual(result, messages);
  assert.equal(result[1].isStreaming, false);
  assert.equal(result[1].processingFinishedAt, 1200);
  assert.equal(result[2].isStreaming, false);
  assert.equal(result[2].suppressPendingIndicator, false);
  assert.equal(result[2].timeline[0].status, 'done');
  assert.equal(result[2].timeline[0].duration, 1000);
});

test('preserves message identity when cancellation has nothing left to finish', () => {
  const messages: Message[] = [{
    id: 'reply-1',
    role: 'ai',
    messageType: 'reply',
    content: '完成',
    timeline: [],
    tools: [],
    isStreaming: false,
  }];

  assert.strictEqual(finalizeCancelledChatMessages(messages, 1200), messages);
});

test('binds the XHS editor chat to the structured project without Markdown write access', () => {
  const binding = buildEditorSessionBinding({
    editorFile: 'xiaohongshu/demo.redpost',
    editorTitle: '测试笔记',
    editorAiWorkspaceMode: { id: 'xiaohongshu-note-editing', label: '小红书笔记编辑' },
    editorBodyDirty: false,
    xhsNote: {
      noteType: 'image',
      projectPath: '/tmp/manuscripts/xiaohongshu/demo.redpost',
      uri: 'manuscripts://xiaohongshu/demo.redpost',
      revision: 7,
    },
  });

  assert.equal(binding?.session.filePath, '/tmp/manuscripts/xiaohongshu/demo.redpost');
  assert.equal(binding?.metadata.artifactType, 'xiaohongshu-note');
  assert.equal(binding?.metadata.intent, 'manuscript_creation');
  assert.equal(binding?.metadata.editorIntent, 'xiaohongshu_note_editing');
  assert.equal(binding?.metadata.executionProfile, 'artifact-authoring');
  assert.equal(binding?.metadata.requireSave, true);
  assert.equal(binding?.metadata.activeXhsNotePath, '/tmp/manuscripts/xiaohongshu/demo.redpost');
  assert.equal(binding?.metadata.xhsNoteRevision, 7);
  assert.deepEqual(binding?.metadata.allowedAppCliActions, [
    'manuscripts.note-get',
    'manuscripts.note-save',
    'manuscripts.note-bind-media',
    'manuscripts.note-export',
    'image.generate',
    'video.generate',
    'video.generate-note',
  ]);
  assert.deepEqual(binding?.metadata.allowedWriteTargets, ['manuscripts://xiaohongshu/demo.redpost']);
});
