import type { AgentTaskArtifactRecord } from '../../db';
import type { IntentRoute } from './types';

export interface RuntimeCompletionValidation {
  complete: boolean;
  feedback?: string;
  maxRecoveryAttempts?: number;
}

export interface XhsMediaCompletionState {
  notePath: string;
  noteType: 'image' | 'video';
  completionScope: 'note' | 'slot';
  requestedSlotIds?: string[];
  mediaSlots: Array<{
    id: string;
    role: 'cover' | 'image-page' | 'video' | string;
    status: string;
    error?: string;
  }>;
}

export type ProductVideoCompletionState =
  | { status: 'not-called' }
  | { status: 'awaiting-approval'; callId?: string; proposalId?: string }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string }
  | { status: 'succeeded'; projectId: string; uri: string; projectStatus?: string };

const NON_DELIVERABLE_ARTIFACT_TYPES = new Set([
  'runtime-result',
]);

export function isDeliverableArtifact(artifact: Pick<AgentTaskArtifactRecord, 'type'>): boolean {
  return !NON_DELIVERABLE_ARTIFACT_TYPES.has(String(artifact.type || '').trim());
}

export function routeRequiresSavedArtifact(
  route: IntentRoute,
  metadata?: Record<string, unknown> | null,
): boolean {
  if (!route.requiredCapabilities.includes('artifact-save')) {
    return false;
  }

  const explicitSaveRequirement = metadata?.requireSave === true || Boolean(metadata?.saveArtifact);
  const routedDeliverables = Array.isArray(route.deliverables)
    ? route.deliverables.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  return explicitSaveRequirement || (route.source === 'llm+rule' && routedDeliverables.length > 0);
}

export function validateRuntimeCompletion(input: {
  route: IntentRoute;
  metadata?: Record<string, unknown> | null;
  artifacts?: AgentTaskArtifactRecord[];
  xhsMediaState?: XhsMediaCompletionState | null;
  productVideoState?: ProductVideoCompletionState | null;
}): RuntimeCompletionValidation {
  if (input.route.workflowKind === 'product-video-compose') {
    const state = input.productVideoState || { status: 'not-called' };
    if (state.status === 'awaiting-approval') {
      return { complete: true };
    }
    if (state.status === 'cancelled') {
      return { complete: true };
    }
    if (state.status === 'failed') {
      return { complete: true };
    }
    if (state.status === 'not-called') {
      return {
        complete: false,
        maxRecoveryAttempts: 3,
        feedback: [
          '商品视频工作流尚未提交结构化分镜。',
          '请直接调用 product_video_compose 提交完整提案；该工具的确认卡就是分镜审核步骤，不要先用普通文本结束，也不要调用 image_generate 或 video_generate。',
        ].join('\n'),
      };
    }

    const productProject = (input.artifacts || []).find((artifact) => (
      String(artifact.type || '').trim() === 'product-video-project'
    ));
    if (!productProject) {
      return {
        complete: false,
        feedback: 'product_video_compose 已返回成功，但当前任务尚未登记商品视频工程产物。请保留工程回执并完成 product-video-project 登记；独立 MP4 不能替代商品视频工程。',
      };
    }
    const metadata = productProject.metadata && typeof productProject.metadata === 'object'
      ? productProject.metadata as Record<string, unknown>
      : {};
    const artifactProjectId = String(metadata.projectId || '').trim();
    const artifactUri = String(metadata.uri || '').trim();
    if (artifactProjectId !== state.projectId || artifactUri !== state.uri) {
      return {
        complete: false,
        feedback: '商品视频工程产物与本轮 product_video_compose 回执不一致，请重新登记正确的 projectId 和 video-project:// URI。',
      };
    }
    return { complete: true };
  }

  let completedXhsMediaType: 'image' | 'video' | null = null;
  if (input.xhsMediaState) {
    const state = input.xhsMediaState;
    const requestedSlotIds = new Set(
      (state.requestedSlotIds || []).map((slotId) => String(slotId || '').trim()).filter(Boolean),
    );
    const requiredSlots = state.completionScope === 'slot'
      ? state.mediaSlots.filter((slot) => requestedSlotIds.has(slot.id))
      : state.noteType === 'video'
        ? (() => {
            const finalVideoSlot = state.mediaSlots.find((slot) => slot.id === 'final-video');
            return finalVideoSlot ? [finalVideoSlot] : state.mediaSlots.filter((slot) => slot.role === 'video');
          })()
        : state.mediaSlots.filter((slot) => slot.role === 'cover' || slot.role === 'image-page');

    const missingRequestedSlots = state.completionScope === 'slot'
      ? Array.from(requestedSlotIds).filter((slotId) => !state.mediaSlots.some((slot) => slot.id === slotId))
      : [];
    if (requiredSlots.length === 0 || missingRequestedSlots.length > 0) {
      const missingSummary = missingRequestedSlots.length > 0
        ? `缺少槽位：${missingRequestedSlots.join('、')}`
        : '没有可验收的媒体槽位';
      return {
        complete: false,
        feedback: `小红书媒体任务尚未完成：${missingSummary}。请重新读取笔记并使用有效槽位继续执行。`,
      };
    }

    const incompleteSlots = requiredSlots.filter((slot) => slot.status !== 'ready');
    if (incompleteSlots.length > 0) {
      const slotSummary = incompleteSlots
        .map((slot) => `${slot.id}:${slot.status}${slot.error ? `（${slot.error}）` : ''}`)
        .join('、');
      return {
        complete: false,
        maxRecoveryAttempts: Math.max(6, requiredSlots.length + 3),
        feedback: [
          `小红书媒体任务尚未完成，以下槽位未就绪：${slotSummary}。`,
          '请继续逐槽调用原子生成命令并等待绑定成功；在所有要求槽位变为 ready 前不要输出最终答复。',
        ].join('\n'),
      };
    }

    completedXhsMediaType = state.noteType;
  }

  const artifacts = Array.isArray(input.artifacts) ? input.artifacts : [];
  const deliverableArtifacts = artifacts.filter(isDeliverableArtifact);
  const requiredMediaTypes = [
    input.route.requiredCapabilities.includes('image-generation') ? 'image' : '',
    input.route.requiredCapabilities.includes('video-generation') ? 'video' : '',
    input.route.requiredCapabilities.includes('audio-generation') ? 'audio' : '',
  ].filter(Boolean);
  const missingMediaTypes = requiredMediaTypes.filter((type) => (
    type !== completedXhsMediaType
    && !deliverableArtifacts.some((artifact) => String(artifact.type || '').trim() === type)
  ));
  if (missingMediaTypes.length > 0) {
    const labels = missingMediaTypes.map((type) => (
      type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'
    ));
    return {
      complete: false,
      maxRecoveryAttempts: Math.max(6, missingMediaTypes.length + 4),
      feedback: [
        `媒体生成任务尚未完成：缺少成功的${labels.join('和')}产物回执。`,
        '请继续调用实际生成工具并等待成功结果；命令帮助、执行计划或过程说明不能视为完成。',
        '如果生成工具失败，请保留明确错误并尝试修正参数，不能用半截文字结束任务。',
      ].join('\n'),
    };
  }

  if (input.xhsMediaState) {
    return { complete: true };
  }

  if (!routeRequiresSavedArtifact(input.route, input.metadata)) {
    return { complete: true };
  }

  if (deliverableArtifacts.length > 0) {
    return { complete: true };
  }

  const deliverables = (input.route.deliverables || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const expected = deliverables.length > 0 ? deliverables.join('、') : '可交付产物';
  return {
    complete: false,
    feedback: [
      `运行时验收未通过：任务要求交付并保存“${expected}”，但尚未收到任何成功的产物工具回执。`,
      '请继续执行任务，调用合适的保存或生成工具并等待成功结果。过程说明、下一步打算或仅有文本回答都不能视为完成。',
      '只有拿到真实产物回执后，才能输出最终答复。',
    ].join('\n'),
  };
}
