import type { FlowHandoff, FlowStage, GenerationIntent, PendingChatMessage, ViewType } from '../app-shell/types';

export type WorkbenchNavigationItem = {
  key: string;
  view: ViewType;
  stage: FlowStage;
  labelKey:
    | 'nav.workbench'
    | 'nav.collect'
    | 'nav.ideate'
    | 'nav.compose'
    | 'nav.produce'
    | 'nav.assets'
    | 'nav.media'
    | 'nav.schedule';
  group: 'daily' | 'flow' | 'library' | 'schedule';
};

export const WORKBENCH_NAVIGATION: readonly WorkbenchNavigationItem[] = [
  { key: 'workbench', view: 'home', stage: 'home', labelKey: 'nav.workbench', group: 'daily' },
  { key: 'collect', view: 'knowledge', stage: 'collect', labelKey: 'nav.collect', group: 'flow' },
  { key: 'ideate', view: 'wander', stage: 'ideate', labelKey: 'nav.ideate', group: 'flow' },
  { key: 'compose', view: 'gardenflow', stage: 'compose', labelKey: 'nav.compose', group: 'flow' },
  { key: 'produce', view: 'generation-studio', stage: 'produce', labelKey: 'nav.produce', group: 'flow' },
  { key: 'assets', view: 'subjects', stage: 'library', labelKey: 'nav.assets', group: 'library' },
  { key: 'media', view: 'media-library', stage: 'library', labelKey: 'nav.media', group: 'library' },
  { key: 'schedule', view: 'automation', stage: 'schedule', labelKey: 'nav.schedule', group: 'schedule' },
] as const;

export const FLOW_STAGE_VIEW_MAP: Readonly<Record<FlowStage, ViewType>> = {
  home: 'home',
  collect: 'knowledge',
  ideate: 'wander',
  compose: 'gardenflow',
  produce: 'generation-studio',
  library: 'subjects',
  schedule: 'automation',
};

export const WORKBENCH_LEGAL_VIEWS: readonly ViewType[] = [
  'home',
  'skills',
  'knowledge',
  'settings',
  'archives',
  'wander',
  'gardenflow',
  'media-library',
  'cover-studio',
  'generation-studio',
  'subjects',
  'automation',
  'approval',
] as const;

const WORKBENCH_LEGAL_VIEW_SET = new Set<ViewType>(WORKBENCH_LEGAL_VIEWS);

export type ResolvedFlowOpen = {
  view: ViewType;
  chatMessage?: PendingChatMessage;
  generationIntent?: GenerationIntent;
};

export function viewForFlowStage(stage: FlowStage): ViewType {
  return FLOW_STAGE_VIEW_MAP[stage];
}

export function flowStageForView(view: ViewType): FlowStage | null {
  return WORKBENCH_NAVIGATION.find((item) => item.view === view)?.stage || null;
}

export function normalizeRestoredWorkbenchView(value: unknown): ViewType {
  return typeof value === 'string' && WORKBENCH_LEGAL_VIEW_SET.has(value as ViewType)
    ? value as ViewType
    : 'home';
}

export function resolveFlowOpen(stage: FlowStage, handoff?: FlowHandoff): ResolvedFlowOpen {
  if (handoff?.kind === 'chat-draft') {
    return { view: 'gardenflow', chatMessage: handoff.message };
  }
  if (handoff?.kind === 'generation') {
    return { view: 'generation-studio', generationIntent: handoff.intent };
  }
  return { view: viewForFlowStage(stage) };
}
