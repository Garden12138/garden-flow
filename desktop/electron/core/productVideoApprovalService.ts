import {
  addChatMessage,
  claimPendingToolApproval,
  getPendingToolApproval,
  getPendingToolApprovalForSession,
  resolvePendingToolApproval,
  type PendingToolApprovalSnapshot,
} from '../db';
import { ProductVideoComposeParamsSchema } from '../../shared/productVideoProposal';
import { getAgentRuntime, getTaskGraphRuntime } from './ai';
import { readExplicitProductRefs } from './ai/productVideoWorkflowPolicy';
import {
  collectProductVideoReviewWarnings,
  evaluateProductVideoToolPolicy,
} from './productVideoRuntimePolicy';
import { ProductVideoComposeTool } from './tools/productVideoComposeTool';
import type { ProductVideoVisualGroundingEvidence } from './productVideoVisualGrounding';

export type ProductVideoApprovalRequest = {
  callId: string;
  name: string;
  params: Record<string, unknown>;
  details: Record<string, unknown>;
  status: 'pending' | 'executing';
};

export type ProductVideoApprovalResolution = {
  success: boolean;
  status: 'pending' | 'executing' | 'completed' | 'cancelled' | 'failed';
  sessionId: string;
  callId: string;
  message: string;
  projectId?: string;
  uri?: string;
  error?: string;
};

const inFlightApprovals = new Map<string, Promise<ProductVideoApprovalResolution>>();

function resultData(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function persistResolutionMessage(
  approval: PendingToolApprovalSnapshot,
  content: string,
  status: ProductVideoApprovalResolution['status'],
): void {
  addChatMessage({
    id: `product_video_approval_${status}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    session_id: approval.session_id,
    role: 'assistant',
    content,
    metadata: JSON.stringify({
      messageKind: 'product-video-approval',
      approvalCallId: approval.call_id,
      proposalId: approval.proposal_id || undefined,
      status,
    }),
  });
}

function approvalSafetyError(approval: PendingToolApprovalSnapshot): string | null {
  const parsed = ProductVideoComposeParamsSchema.safeParse(approval.params);
  if (!parsed.success) {
    return `持久化分镜参数无效：${parsed.error.issues.map((issue) => issue.message).join('；')}`;
  }
  const task = approval.task_id ? getTaskGraphRuntime().getTask(approval.task_id) : null;
  const taskMetadata = task?.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
    ? task.metadata as Record<string, unknown>
    : {};
  const decision = evaluateProductVideoToolPolicy({
    workflowKind: task?.route?.workflowKind,
    toolName: 'product_video_compose',
    args: parsed.data,
    explicitProductRefs: readExplicitProductRefs(taskMetadata),
    productAssetVisualGrounding: taskMetadata.productAssetVisualGrounding
      && typeof taskMetadata.productAssetVisualGrounding === 'object'
      && !Array.isArray(taskMetadata.productAssetVisualGrounding)
      ? taskMetadata.productAssetVisualGrounding as ProductVideoVisualGroundingEvidence
      : undefined,
  });
  return decision?.reason || null;
}

function failUnsafeApproval(approval: PendingToolApprovalSnapshot, error: string): void {
  resolvePendingToolApproval({ callId: approval.call_id, status: 'failed', errorMessage: error });
  if (approval.task_id) getAgentRuntime().failExecution(approval.task_id, error);
  persistResolutionMessage(approval, `商品视频分镜已停止：${error}。请重新选择 @商品 后发起视频请求。`, 'failed');
}

export function getProductVideoApprovalRequest(sessionId: string): ProductVideoApprovalRequest | null {
  const approval = getPendingToolApprovalForSession(sessionId);
  if (!approval || approval.tool_name !== 'product_video_compose') return null;
  if (approval.status !== 'pending' && approval.status !== 'executing') return null;
  const unsafeError = approvalSafetyError(approval);
  if (unsafeError) {
    failUnsafeApproval(approval, unsafeError);
    return null;
  }
  const task = approval.task_id ? getTaskGraphRuntime().getTask(approval.task_id) : null;
  const taskMetadata = task?.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
    ? task.metadata as Record<string, unknown>
    : {};
  const grounding = taskMetadata.productAssetVisualGrounding
    && typeof taskMetadata.productAssetVisualGrounding === 'object'
    && !Array.isArray(taskMetadata.productAssetVisualGrounding)
    ? taskMetadata.productAssetVisualGrounding as ProductVideoVisualGroundingEvidence
    : undefined;
  const computedWarnings = collectProductVideoReviewWarnings({
    args: approval.params,
    productAssetVisualGrounding: grounding,
  }).map((warning) => warning.message);
  const storedWarnings = Array.isArray(approval.details.warnings)
    ? approval.details.warnings.map((warning) => String(warning || '').trim()).filter(Boolean)
    : [];
  return {
    callId: approval.call_id,
    name: approval.tool_name,
    params: approval.params,
    details: {
      ...approval.details,
      ...((storedWarnings.length > 0 || computedWarnings.length > 0) ? {
        warnings: Array.from(new Set([...storedWarnings, ...computedWarnings])),
      } : {}),
    },
    status: approval.status,
  };
}

function resolutionFromCompleted(approval: PendingToolApprovalSnapshot): ProductVideoApprovalResolution {
  const stored = resultData(approval.result);
  return {
    success: true,
    status: 'completed',
    sessionId: approval.session_id,
    callId: approval.call_id,
    message: String(stored.message || '商品视频工程已创建。').trim(),
    projectId: String(stored.projectId || '').trim() || undefined,
    uri: String(stored.uri || '').trim() || undefined,
  };
}

async function executeApprovedProductVideo(
  approval: PendingToolApprovalSnapshot,
): Promise<ProductVideoApprovalResolution> {
  const parsed = ProductVideoComposeParamsSchema.safeParse(approval.params);
  if (!parsed.success) {
    const error = `持久化分镜参数无效：${parsed.error.issues.map((issue) => issue.message).join('；')}`;
    resolvePendingToolApproval({ callId: approval.call_id, status: 'failed', errorMessage: error });
    if (approval.task_id) getAgentRuntime().failExecution(approval.task_id, error);
    persistResolutionMessage(approval, `商品视频工程创建失败：${error}`, 'failed');
    return {
      success: false,
      status: 'failed',
      sessionId: approval.session_id,
      callId: approval.call_id,
      message: error,
      error,
    };
  }
  const unsafeError = approvalSafetyError(approval);
  if (unsafeError) {
    failUnsafeApproval(approval, unsafeError);
    return {
      success: false,
      status: 'failed',
      sessionId: approval.session_id,
      callId: approval.call_id,
      message: unsafeError,
      error: unsafeError,
    };
  }

  if (approval.task_id) getTaskGraphRuntime().resumeTask(approval.task_id);
  const result = await new ProductVideoComposeTool().execute(parsed.data, new AbortController().signal);
  const data = resultData(result.data);
  if (!result.success || data.kind !== 'product-video-project') {
    const error = String(result.error?.message || result.llmContent || '商品视频工程创建失败').trim();
    resolvePendingToolApproval({ callId: approval.call_id, status: 'failed', errorMessage: error });
    if (approval.task_id) getAgentRuntime().failExecution(approval.task_id, error);
    persistResolutionMessage(approval, `商品视频工程创建失败：${error}`, 'failed');
    return {
      success: false,
      status: 'failed',
      sessionId: approval.session_id,
      callId: approval.call_id,
      message: error,
      error,
    };
  }

  const projectId = String(data.projectId || '').trim();
  const uri = String(data.uri || '').trim();
  const projectStatus = String(data.status || '').trim();
  const proposalId = String(data.proposalId || approval.proposal_id || '').trim();
  const message = [
    '商品视频工程已按确认分镜创建。',
    uri ? `[打开商品视频工程](${uri})` : '',
    projectStatus ? `工程状态：${projectStatus}` : '',
  ].filter(Boolean).join('\n\n');

  if (approval.task_id) {
    const runtime = getTaskGraphRuntime();
    const task = runtime.getTask(approval.task_id);
    const alreadyRegistered = task?.artifacts.some((artifact) => (
      artifact.type === 'product-video-project'
      && String(resultData(artifact.metadata).projectId || '').trim() === projectId
    ));
    if (!alreadyRegistered) {
      runtime.addArtifact(approval.task_id, {
        type: 'product-video-project',
        label: String(data.title || '商品视频工程').trim(),
        metadata: {
          projectId,
          uri,
          status: projectStatus,
          proposalId,
        },
      });
    }
    getAgentRuntime().completeExecution(approval.task_id, {
      resumedFromApproval: true,
      approvalCallId: approval.call_id,
      projectId,
    });
  }

  resolvePendingToolApproval({
    callId: approval.call_id,
    status: 'completed',
    result: { message, projectId, uri, status: projectStatus, proposalId },
  });
  persistResolutionMessage(approval, message, 'completed');
  return {
    success: true,
    status: 'completed',
    sessionId: approval.session_id,
    callId: approval.call_id,
    message,
    projectId,
    uri,
  };
}

export async function resolveProductVideoApproval(
  callId: string,
  confirmed: boolean,
): Promise<ProductVideoApprovalResolution> {
  const existingExecution = inFlightApprovals.get(callId);
  if (existingExecution) return existingExecution;

  const approval = getPendingToolApproval(callId);
  if (!approval || approval.tool_name !== 'product_video_compose') {
    return {
      success: false,
      status: 'failed',
      sessionId: approval?.session_id || '',
      callId,
      message: '待确认的商品视频分镜不存在或已失效。',
      error: 'approval-not-found',
    };
  }
  if (approval.status === 'completed') return resolutionFromCompleted(approval);

  if (!confirmed) {
    if (approval.status === 'executing') {
      return {
        success: false,
        status: 'executing',
        sessionId: approval.session_id,
        callId,
        message: '商品视频工程已经开始创建，不能再取消本次确认。',
        error: 'approval-already-executing',
      };
    }
    if (approval.status !== 'pending') {
      return {
        success: approval.status === 'cancelled',
        status: approval.status === 'cancelled' ? 'cancelled' : 'failed',
        sessionId: approval.session_id,
        callId,
        message: approval.error_message || '该确认已经结束。',
        error: approval.error_message || undefined,
      };
    }
    resolvePendingToolApproval({ callId, status: 'cancelled' });
    if (approval.task_id) getTaskGraphRuntime().cancelTask(approval.task_id);
    const message = '已取消商品视频分镜，未创建工程、未提交 AI 生成任务。你可以继续修改要求后重新提交。';
    persistResolutionMessage(approval, message, 'cancelled');
    return {
      success: true,
      status: 'cancelled',
      sessionId: approval.session_id,
      callId,
      message,
    };
  }

  if (approval.status === 'executing') {
    return {
      success: true,
      status: 'executing',
      sessionId: approval.session_id,
      callId,
      message: '商品视频工程正在创建中。',
    };
  }
  if (approval.status !== 'pending') {
    return {
      success: false,
      status: 'failed',
      sessionId: approval.session_id,
      callId,
      message: approval.error_message || '该确认已经结束，请重新提交分镜。',
      error: approval.error_message || 'approval-not-pending',
    };
  }

  const operation = (async () => {
    const claimed = claimPendingToolApproval(callId);
    if (!claimed || claimed.status !== 'executing') {
      return {
        success: false,
        status: 'failed',
        sessionId: approval.session_id,
        callId,
        message: '无法锁定待确认分镜，请重新打开会话后再试。',
        error: 'approval-claim-failed',
      } satisfies ProductVideoApprovalResolution;
    }
    return executeApprovedProductVideo(claimed);
  })();
  inFlightApprovals.set(callId, operation);
  try {
    return await operation;
  } finally {
    if (inFlightApprovals.get(callId) === operation) inFlightApprovals.delete(callId);
  }
}
