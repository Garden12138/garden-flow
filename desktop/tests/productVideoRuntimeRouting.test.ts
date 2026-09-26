import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyProductVideoWorkflowPolicy,
  readExplicitProductRefs,
  resolveProductVideoVisualPreparation,
} from '../electron/core/ai/productVideoWorkflowPolicy.ts';
import {
  shouldRunSubagentOrchestration,
  shouldUseCoordinator,
} from '../electron/core/ai/orchestrationPolicy.ts';
import { validateRuntimeCompletion } from '../electron/core/ai/runtimeCompletion.ts';
import type { IntentRoute, RuntimeContext } from '../electron/core/ai/types.ts';
import {
  collectProductVideoReviewWarnings,
  evaluateProductVideoToolPolicy,
} from '../electron/core/productVideoRuntimePolicy.ts';
import { evaluateVideoGenerationApprovalPolicy } from '../electron/core/videoGenerationApprovalPolicy.ts';
import { buildDeferredToolConfirmationData } from '../shared/toolConfirmationPolicy.ts';

const explicitProductRefs = [{
  productId: 'product-001',
  name: '测试商品',
  updatedAt: '2026-09-16T10:00:00.000Z',
}];

const productAssetVisualGrounding = {
  status: 'verified' as const,
  verificationId: 'visual-test',
  modelName: 'qwen3.8-max',
  productId: 'product-001',
  productUpdatedAt: '2026-09-16T10:00:00.000Z',
  imageCount: 2,
  verifiedAt: '2026-09-16T10:01:00.000Z',
  assets: [
    {
      assetId: 'asset-001',
      role: 'primary',
      origin: 'catalog',
      description: '白底商品包装',
      visibleText: ['测试商品'],
      hasPrice: false,
      hasPromotion: false,
      hasActivityDate: false,
      suitability: 'safe' as const,
      reasons: [],
    },
    {
      assetId: 'asset-promo',
      role: 'gallery',
      origin: 'catalog',
      description: '带价格和活动日期的促销海报',
      visibleText: ['¥99', '限时活动'],
      hasPrice: true,
      hasPromotion: true,
      hasActivityDate: true,
      suitability: 'exclude' as const,
      reasons: ['包含促销价格'],
    },
  ],
};

const genericVideoRoute: IntentRoute = {
  intent: 'video_creation',
  secondaryIntents: [],
  goal: '给所选商品做一个 15 秒竖版视频',
  deliverables: ['MP4'],
  requiredCapabilities: ['planning', 'video-generation', 'artifact-save'],
  recommendedRole: 'video-director',
  requiresLongRunningTask: true,
  requiresMultiAgent: true,
  requiresHumanApproval: false,
  confidence: 0.98,
  reasoning: 'classified as video creation',
  source: 'llm+rule',
};

const productContext: RuntimeContext = {
  sessionId: 'session_1789545584534_regression',
  runtimeMode: 'gardenflow',
  userInput: '给这个商品做一个 15 秒竖版视频',
  metadata: { explicitProductRefs },
};

const proposal = {
  version: 1 as const,
  proposalId: 'proposal-session-1789545584534',
  productId: 'product-001',
  referencedProductIds: ['product-001'],
  productName: '测试商品',
  productUpdatedAt: '2026-09-16T10:00:00.000Z',
  title: '测试商品｜15 秒商品视频',
  canvas: { width: 1080, height: 1920, fps: 30, aspectRatio: '9:16' as const },
  durationMs: 15_000,
  scenes: [
    {
      id: 'scene-1',
      title: '主视觉',
      durationMs: 15_000,
      source: 'product-asset' as const,
      productAssetIds: ['asset-001'],
      overlayText: '可信商品事实',
      fitMode: 'contain-blur' as const,
      motionPreset: 'slow-zoom-in' as const,
    },
  ],
};

test('routes selected product plus video intent to the foreground product-video workflow', () => {
  const route = applyProductVideoWorkflowPolicy(genericVideoRoute, productContext);

  assert.equal(route.workflowKind, 'product-video-compose');
  assert.equal(route.recommendedRole, 'video-director');
  assert.equal(route.requiresHumanApproval, true);
  assert.equal(route.requiresMultiAgent, false);
  assert.equal(route.requiresLongRunningTask, false);
  assert.deepEqual(route.deliverables, ['可编辑商品视频工程', '商品视频分镜']);
  assert.equal(route.requiredCapabilities.includes('video-generation'), false);
  assert.equal(route.requiredCapabilities.includes('product-video-compose'), true);
  assert.equal(shouldUseCoordinator({ runtimeMode: 'gardenflow', route }), false);
  assert.equal(shouldRunSubagentOrchestration({ runtimeMode: 'gardenflow', route }), false);
});

test('does not route product-backed non-video work or unreferenced video into product composition', () => {
  const articleRoute = applyProductVideoWorkflowPolicy({
    ...genericVideoRoute,
    intent: 'manuscript_creation',
    recommendedRole: 'copywriter',
  }, productContext);
  assert.equal(articleRoute.workflowKind, undefined);

  const unreferencedVideo = applyProductVideoWorkflowPolicy(genericVideoRoute, {
    ...productContext,
    metadata: {},
  });
  assert.equal(unreferencedVideo.workflowKind, undefined);
  assert.equal(unreferencedVideo.requiredCapabilities.includes('video-generation'), true);
});

test('accepts only validated explicit product reference metadata', () => {
  assert.deepEqual(readExplicitProductRefs({
    explicitProductRefs: [
      explicitProductRefs[0],
      { productId: 'missing-version', name: '无版本' },
      { productId: '', name: '空 ID', updatedAt: 'now' },
    ],
  }), explicitProductRefs);
});

test('starts visual preparation only after the resolved product-video route', () => {
  assert.deepEqual(resolveProductVideoVisualPreparation({
    workflowKind: undefined,
    metadata: { explicitProductRefs },
  }), {
    action: 'skip',
    productRefs: explicitProductRefs,
  });

  assert.deepEqual(resolveProductVideoVisualPreparation({
    workflowKind: 'product-video-compose',
    metadata: { explicitProductRefs },
  }), {
    action: 'prepare',
    productRefs: explicitProductRefs,
  });

  assert.equal(resolveProductVideoVisualPreparation({
    workflowKind: 'product-video-compose',
    metadata: { explicitProductRefs: [...explicitProductRefs, {
      productId: 'product-002',
      name: '另一个商品',
      updatedAt: '2026-09-16T10:00:00.000Z',
    }] },
  }).action, 'require-product-selection');
});

test('blocks direct image and video generation inside product-video-compose', () => {
  for (const toolName of ['image_generate', 'video_generate']) {
    const decision = evaluateProductVideoToolPolicy({
      workflowKind: 'product-video-compose',
      toolName,
      args: { prompt: '绕过工程直接生成' },
      explicitProductRefs,
    });
    assert.equal(decision?.outcome, 'deny');
    assert.match(decision?.reason || '', /product_video_compose/);
  }
});

test('blocks command-line fallback inside product-video planning', () => {
  for (const toolName of ['bash', 'app_cli']) {
    const decision = evaluateProductVideoToolPolicy({
      workflowKind: 'product-video-compose',
      toolName,
      args: { command: 'find product-assets' },
      explicitProductRefs,
      productAssetVisualGrounding,
    });
    assert.equal(decision?.outcome, 'deny');
    assert.match(decision?.reason || '', /视觉理解/);
  }
});

test('requires explicit user acknowledgement for every foreground standalone video generation', () => {
  const foreground = evaluateVideoGenerationApprovalPolicy({
    toolName: 'video_generate',
    interactive: true,
  });
  assert.equal(foreground?.outcome, 'confirm');
  assert.equal(foreground?.requiresUserAcknowledgement, true);

  const background = evaluateVideoGenerationApprovalPolicy({
    toolName: 'video_generate',
    interactive: false,
  });
  assert.equal(background?.outcome, 'deny');
  assert.equal(evaluateVideoGenerationApprovalPolicy({
    toolName: 'image_generate',
    interactive: true,
  }), null);
});

test('requires exactly one selected product before allowing product composition', () => {
  const multipleProducts = evaluateProductVideoToolPolicy({
    workflowKind: 'product-video-compose',
    toolName: 'product_video_compose',
    args: proposal,
    explicitProductRefs: [...explicitProductRefs, {
      productId: 'product-002',
      name: '另一个商品',
      updatedAt: '2026-09-16T10:00:00.000Z',
    }],
  });
  assert.equal(multipleProducts?.outcome, 'deny');
  assert.match(multipleProducts?.reason || '', /多个商品/);

  const singleProduct = evaluateProductVideoToolPolicy({
    workflowKind: 'product-video-compose',
    toolName: 'product_video_compose',
    args: proposal,
    explicitProductRefs,
    productAssetVisualGrounding,
  });
  assert.equal(singleProduct, null);
});

test('product composition fails closed without a routed and verified product reference', () => {
  const missingReference = evaluateProductVideoToolPolicy({
    toolName: 'product_video_compose',
    args: proposal,
  });
  assert.equal(missingReference?.outcome, 'deny');
  assert.match(missingReference?.reason || '', /没有已验证的商品引用/);

  const wrongProduct = evaluateProductVideoToolPolicy({
    toolName: 'product_video_compose',
    args: { ...proposal, productId: 'product-002' },
    explicitProductRefs,
  });
  assert.equal(wrongProduct?.outcome, 'deny');
  assert.match(wrongProduct?.reason || '', /productId/);

  const staleVersion = evaluateProductVideoToolPolicy({
    toolName: 'product_video_compose',
    args: { ...proposal, productUpdatedAt: '2026-09-01T00:00:00.000Z' },
    explicitProductRefs,
  });
  assert.equal(staleVersion?.outcome, 'deny');
  assert.match(staleVersion?.reason || '', /商品版本/);

  const missingVisualGrounding = evaluateProductVideoToolPolicy({
    workflowKind: 'product-video-compose',
    toolName: 'product_video_compose',
    args: proposal,
    explicitProductRefs,
  });
  assert.equal(missingVisualGrounding?.outcome, 'deny');
  assert.match(missingVisualGrounding?.reason || '', /视觉模型校验/);

  const visuallyFlaggedAsset = evaluateProductVideoToolPolicy({
    workflowKind: 'product-video-compose',
    toolName: 'product_video_compose',
    args: {
      ...proposal,
      scenes: [{ ...proposal.scenes[0], productAssetIds: ['asset-promo'] }],
    },
    explicitProductRefs,
    productAssetVisualGrounding,
  });
  assert.equal(visuallyFlaggedAsset, null);
});

test('turns visual fact uncertainty and flagged assets into non-blocking review warnings', () => {
  const warnings = collectProductVideoReviewWarnings({
    args: {
      ...proposal,
      scenes: [{
        ...proposal.scenes[0],
        productAssetIds: ['asset-promo'],
        overlayText: '限时活动 ¥99',
      }],
    },
    productAssetVisualGrounding,
  });

  assert.deepEqual(warnings.map((warning) => warning.code), [
    'visual-asset-risk',
    'visual-text-fact-check',
  ]);
  assert.match(warnings[0].message, /可能误判/);
  assert.match(warnings[0].message, /不会阻止创建工程/);
  assert.match(warnings[1].message, /不等于已录入的结构化商品事实/);
});

test('product-video completion rejects standalone MP4 and requires the matching project artifact', () => {
  const route = applyProductVideoWorkflowPolicy(genericVideoRoute, productContext);
  const standaloneVideo = [{ id: 'video-1', type: 'video', label: 'standalone.mp4', createdAt: Date.now() }];

  const notCalled = validateRuntimeCompletion({
    route,
    artifacts: standaloneVideo,
    productVideoState: { status: 'not-called' },
  });
  assert.equal(notCalled.complete, false);
  assert.match(notCalled.feedback || '', /product_video_compose/);

  const missingProject = validateRuntimeCompletion({
    route,
    artifacts: standaloneVideo,
    productVideoState: {
      status: 'succeeded',
      projectId: 'project-001',
      uri: 'video-project://project-001',
    },
  });
  assert.equal(missingProject.complete, false);
  assert.match(missingProject.feedback || '', /独立 MP4 不能替代/);

  const completed = validateRuntimeCompletion({
    route,
    artifacts: [{
      id: 'artifact-project-001',
      type: 'product-video-project',
      label: '测试商品｜15 秒商品视频',
      metadata: {
        projectId: 'project-001',
        uri: 'video-project://project-001',
        status: 'ready',
        proposalId: proposal.proposalId,
      },
      createdAt: Date.now(),
    }],
    productVideoState: {
      status: 'succeeded',
      projectId: 'project-001',
      uri: 'video-project://project-001',
      projectStatus: 'ready',
    },
  });
  assert.equal(completed.complete, true);
});

test('cancelled or failed product-video confirmation ends without forcing generation', () => {
  const route = applyProductVideoWorkflowPolicy(genericVideoRoute, productContext);
  assert.equal(validateRuntimeCompletion({
    route,
    artifacts: [],
    productVideoState: { status: 'cancelled' },
  }).complete, true);
  assert.equal(validateRuntimeCompletion({
    route,
    artifacts: [],
    productVideoState: { status: 'failed', error: '商品已删除' },
  }).complete, true);
  assert.equal(validateRuntimeCompletion({
    route,
    artifacts: [],
    productVideoState: {
      status: 'awaiting-approval',
      callId: 'approval-001',
      proposalId: proposal.proposalId,
    },
  }).complete, true);
});

test('deferred confirmation keeps stable proposal metadata for durable approval', () => {
  assert.deepEqual(buildDeferredToolConfirmationData({
    callId: 'approval-001',
    toolName: 'product_video_compose',
    params: { proposalId: proposal.proposalId },
  }), {
    kind: 'tool-confirmation-pending',
    callId: 'approval-001',
    toolName: 'product_video_compose',
    proposalId: proposal.proposalId,
  });
});
