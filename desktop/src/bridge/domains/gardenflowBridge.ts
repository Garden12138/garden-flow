import type { BridgeCore, Listener } from '../types';

export type GardenFlowTaskListPayload = {
  ownerScope?: string;
  includeDrafts?: boolean;
};

export type GardenFlowTaskUpdatePayload = {
  jobDefinitionId: string;
  patch: Record<string, unknown>;
  reason: string;
};

export type GardenFlowTaskCancelPayload = {
  jobDefinitionId: string;
  reason?: string;
  deleteSource?: boolean;
};

export type GardenFlowTaskConfirmPayload = {
  draftId: string;
  confirm: boolean;
};

export type GardenFlowScheduledTaskPayload = Record<string, unknown>;

const unavailable = (feature: string) => ({
  success: false,
  error: `${feature} is not available in the Electron archive build.`,
});

export function createGardenFlowBridge(core: BridgeCore) {
  return {
    gardenflowRunner: {
      getStatus: () => core.invokeCommandGuarded('gardenflow_runner_status', undefined, {
        timeoutMs: 2800,
        fallbackChannel: 'gardenflow:runner-status',
      }),
      start: (payload?: Record<string, unknown>) => core.invokeChannel('gardenflow:runner-start', payload || {}),
      stop: () => core.invokeChannel('gardenflow:runner-stop'),
      runNow: (payload?: Record<string, unknown>) => core.invokeChannel('gardenflow:runner-run-now', payload || {}),
      setProject: (payload: Record<string, unknown>) => core.invokeChannel('gardenflow:runner-set-project', payload),
      setConfig: (payload?: Record<string, unknown>) => core.invokeChannel('gardenflow:runner-set-config', payload || {}),
      listScheduled: () => core.invokeChannel('gardenflow:runner-list-scheduled'),
      addScheduled: (payload: GardenFlowScheduledTaskPayload) => core.invokeChannel('gardenflow:runner-add-scheduled', payload),
      removeScheduled: (payload: { taskId: string }) => core.invokeChannel('gardenflow:runner-remove-scheduled', payload),
      setScheduledEnabled: (payload: { taskId: string; enabled: boolean }) =>
        core.invokeChannel('gardenflow:runner-set-scheduled-enabled', payload),
      runScheduledNow: (payload: { taskId: string }) => core.invokeChannel('gardenflow:runner-run-scheduled-now', payload),
      listLongCycle: () => core.invokeChannel('gardenflow:runner-list-long-cycle'),
      addLongCycle: (payload: Record<string, unknown>) => core.invokeChannel('gardenflow:runner-add-long-cycle', payload),
      removeLongCycle: (payload: { taskId: string }) => core.invokeChannel('gardenflow:runner-remove-long-cycle', payload),
      setLongCycleEnabled: (payload: { taskId: string; enabled: boolean }) =>
        core.invokeChannel('gardenflow:runner-set-long-cycle-enabled', payload),
      runLongCycleNow: (payload: { taskId: string }) => core.invokeChannel('gardenflow:runner-run-long-cycle-now', payload),
      listBuiltin: () => core.invokeChannel('gardenflow:runner-list-builtin'),
      builtinReadiness: (payload: { taskId: string }) => core.invokeChannel('gardenflow:runner-builtin-readiness', payload),
      setBuiltinEnabled: (payload: { taskId: string; enabled: boolean }) =>
        core.invokeChannel('gardenflow:runner-set-builtin-enabled', payload),
      setBuiltinSettings: (payload: { taskId: string; settings?: Record<string, unknown>; scheduleTime?: string }) =>
        core.invokeChannel('gardenflow:runner-set-builtin-settings', payload),
      runBuiltinNow: (payload: { taskId: string }) => core.invokeChannel('gardenflow:runner-run-builtin-now', payload),
      installBuiltinMcpPreset: (payload?: { presetId?: string }) =>
        core.invokeChannel('gardenflow:runner-install-builtin-mcp', payload || {}),
      taskPreview: (payload: Record<string, unknown>) => core.invokeChannel('gardenflow:task-preview', payload),
      taskCreate: (payload: Record<string, unknown>) => core.invokeChannel('gardenflow:task-create', payload),
      taskConfirm: (payload: GardenFlowTaskConfirmPayload) => core.invokeChannel('gardenflow:task-confirm', payload),
      taskUpdate: (payload: GardenFlowTaskUpdatePayload) => core.invokeChannel('gardenflow:task-update', payload),
      taskCancel: (payload: GardenFlowTaskCancelPayload) => core.invokeChannel('gardenflow:task-cancel', payload),
      taskList: (payload?: GardenFlowTaskListPayload) => core.invokeChannel('gardenflow:task-list', payload || {}),
      taskStats: () => core.invokeChannel('gardenflow:task-stats'),
      onStatus: (listener: Listener) => core.on('gardenflow:runner-status', listener),
      offStatus: (listener: Listener) => core.off('gardenflow:runner-status', listener),
      onTaskEvent: (listener: Listener) => core.on('gardenflow:task-event', listener),
      offTaskEvent: (listener: Listener) => core.off('gardenflow:task-event', listener),
    },
    gardenflowOrchestration: {
      createRun: (payload: { goal: string; sessionId?: string; projectId?: string; platform?: string; format?: string }) =>
        core.invokeChannelGuarded('gardenflow:orchestration-create-run', payload, {
          timeoutMs: 3200,
          fallback: unavailable('GardenFlow orchestration runs'),
        }),
      getRegistry: () => core.invokeChannelGuarded('gardenflow:orchestration-registry', undefined, {
        timeoutMs: 3200,
        fallback: { success: true, registry: {}, unavailable: true },
      }),
    },
    gardenflowProjects: {
      list: () => core.invokeChannel('gardenflow:list-projects'),
      updateLearningCandidate: (payload: { projectId: string; candidateId: string; status: 'accepted' | 'rejected' | 'pending' }) =>
        core.invokeChannelGuarded('gardenflow:learning-candidate-update', payload, {
          timeoutMs: 3200,
          fallback: unavailable('GardenFlow learning candidate updates'),
        }),
      updateSection: (payload: { projectId: string; sectionId: string; content: string }) =>
        core.invokeChannelGuarded('gardenflow:project-section-update', payload, {
          timeoutMs: 3200,
          fallback: unavailable('GardenFlow project section updates'),
        }),
      exportMediaPlan: (payload: { projectId: string }) =>
        core.invokeChannelGuarded('gardenflow:media-plan-export', payload, {
          timeoutMs: 3200,
          fallback: unavailable('GardenFlow media plan export'),
        }),
      renderRoughCut: (payload: { projectId: string }) =>
        core.invokeChannelGuarded('gardenflow:media-plan-render', payload, {
          timeoutMs: 3200,
          fallback: unavailable('GardenFlow rough cut render'),
        }),
      exportPublishPackage: (payload: { projectId: string }) =>
        core.invokeChannelGuarded('gardenflow:publish-package-export', payload, {
          timeoutMs: 3200,
          fallback: unavailable('GardenFlow publish package export'),
        }),
      exportReviewReport: (payload: { projectId: string }) =>
        core.invokeChannelGuarded('gardenflow:review-report-export', payload, {
          timeoutMs: 3200,
          fallback: unavailable('GardenFlow review report export'),
        }),
      exportXhsPackage: (payload: { projectId: string }) =>
        core.invokeChannelGuarded('gardenflow:xhs-package-export', payload, {
          timeoutMs: 3200,
          fallback: unavailable('GardenFlow XHS package export'),
        }),
    },
    gardenflowProfile: {
      getBundle: () => core.invokeChannel('gardenflow:profile:get-bundle'),
      updateDoc: (payload: { docType: 'agent' | 'soul' | 'user' | 'creator_profile'; markdown: string; reason?: string }) =>
        core.invokeChannel('gardenflow:profile:update-doc', payload),
      getOnboardingStatus: () => core.invokeChannel('gardenflow:profile:onboarding-status'),
      onboardingTurn: (payload: { input: string }) => core.invokeChannel('gardenflow:profile:onboarding-turn', payload),
      saveInitializationProgress: (payload: { stepIndex: number; answers: Record<string, unknown> }) =>
        core.invokeChannel('gardenflow:profile:save-initialization-progress', payload),
      completeInitialization: (payload: { answers: Record<string, unknown> }) =>
        core.invokeChannel('gardenflow:profile:complete-initialization', payload),
      startStyleDefinition: (payload?: { forceRestart?: boolean; source?: string; sessionId?: string }) =>
        core.invokeChannelGuarded('gardenflow:profile:start-style-definition', payload || {}, {
          timeoutMs: 3200,
          fallback: unavailable('GardenFlow style definition'),
        }),
      completeStyleDefinition: (payload: Record<string, unknown>) =>
        core.invokeChannelGuarded('gardenflow:profile:complete-style-definition', payload, {
          timeoutMs: 3200,
          fallback: unavailable('GardenFlow style definition completion'),
        }),
    },
  };
}
