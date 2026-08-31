export type GardenFlowTaskListResponse = Awaited<ReturnType<typeof window.ipcRenderer.gardenflowRunner.taskList>>;
export type GardenFlowTaskListItem = NonNullable<GardenFlowTaskListResponse['items']>[number];

export type GardenFlowAutomationScheduleMode = 'hourly' | 'daily' | 'workday' | 'weekly';

export interface GardenFlowAutomationDraft {
  name: string;
  scheduleMode: GardenFlowAutomationScheduleMode;
  weekday: number;
  time: string;
  prompt: string;
}

export const GARDENFLOW_AUTOMATION_WEEKDAY_OPTIONS = [
  { value: 1, label: '星期一' },
  { value: 2, label: '星期二' },
  { value: 3, label: '星期三' },
  { value: 4, label: '星期四' },
  { value: 5, label: '星期五' },
  { value: 6, label: '星期六' },
  { value: 0, label: '星期日' },
];

export const DEFAULT_GARDENFLOW_AUTOMATION_DRAFT: GardenFlowAutomationDraft = {
  name: '',
  scheduleMode: 'daily',
  weekday: 1,
  time: '09:00',
  prompt: '',
};

export function gardenFlowAutomationDraftFromItem(item: GardenFlowTaskListItem): GardenFlowAutomationDraft {
  const weekdays = Array.isArray(item.weekdays) ? item.weekdays.join(',') : '';
  const scheduleMode: GardenFlowAutomationScheduleMode = item.triggerKind === 'interval'
    ? 'hourly'
    : item.triggerKind === 'weekly' && weekdays === '1,2,3,4,5'
      ? 'workday'
      : item.triggerKind === 'weekly'
        ? 'weekly'
        : 'daily';
  return {
    name: item.title || '',
    scheduleMode,
    weekday: Array.isArray(item.weekdays) && item.weekdays.length > 0 ? Number(item.weekdays[0]) : 1,
    time: String(item.time || '09:00').slice(0, 5),
    prompt: item.prompt || item.goal || '',
  };
}

export function gardenFlowAutomationScheduledPayload(
  draft: GardenFlowAutomationDraft,
  name: string,
  prompt: string,
): Record<string, unknown> {
  const base = {
    name,
    prompt,
    actionType: 'gardenflow_prompt',
    ownerScope: 'manual:gardenflow',
    timezone: 'local',
    missedRunPolicy: 'single',
    enabled: true,
  };
  if (draft.scheduleMode === 'hourly') {
    return { ...base, mode: 'interval', intervalMinutes: 60 };
  }
  if (draft.scheduleMode === 'daily') {
    return { ...base, mode: 'daily', time: draft.time };
  }
  if (draft.scheduleMode === 'workday') {
    return { ...base, mode: 'weekly', time: draft.time, weekdays: [1, 2, 3, 4, 5] };
  }
  if (draft.scheduleMode === 'weekly') {
    return { ...base, mode: 'weekly', time: draft.time, weekdays: [draft.weekday] };
  }
  return { ...base, mode: 'daily', time: draft.time };
}

export function gardenFlowAutomationIntentFromDraft(
  draft: GardenFlowAutomationDraft,
  name: string,
  prompt: string,
): Record<string, unknown> {
  return {
    kind: 'scheduled',
    name,
    cron: gardenFlowAutomationScheduleToCron(draft),
    prompt,
    goal: prompt,
    actionType: 'gardenflow_prompt',
    ownerScope: 'manual:gardenflow',
    timezone: 'local',
    missedRunPolicy: 'single',
    creatorMode: 'ui-manual',
    createdBy: 'automation-page',
  };
}

export function gardenFlowAutomationScheduleToCron(draft: GardenFlowAutomationDraft): string {
  if (draft.scheduleMode === 'hourly') {
    return '0 * * * *';
  }
  const [hourRaw = '9', minuteRaw = '0'] = draft.time.split(':');
  const hour = Math.min(23, Math.max(0, Number(hourRaw) || 0));
  const minute = Math.min(59, Math.max(0, Number(minuteRaw) || 0));
  if (draft.scheduleMode === 'workday') {
    return `${minute} ${hour} * * 1,2,3,4,5`;
  }
  if (draft.scheduleMode === 'weekly') {
    return `${minute} ${hour} * * ${draft.weekday}`;
  }
  return `${minute} ${hour} * * *`;
}

export function gardenFlowAutomationIsTask(item: GardenFlowTaskListItem): boolean {
  return item.kind === 'scheduled' || item.kind === 'scheduled_draft' || item.sourceKind === 'scheduled';
}

export function sortGardenFlowAutomationItems(items: GardenFlowTaskListItem[]): GardenFlowTaskListItem[] {
  return [...items].sort((left, right) => {
    const leftDueAt = Date.parse(left.nextDueAt || '') || Number.MAX_SAFE_INTEGER;
    const rightDueAt = Date.parse(right.nextDueAt || '') || Number.MAX_SAFE_INTEGER;
    if (leftDueAt !== rightDueAt) return leftDueAt - rightDueAt;
    return Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || '');
  });
}

export function gardenFlowAutomationWeekdayLabel(value: number): string {
  return GARDENFLOW_AUTOMATION_WEEKDAY_OPTIONS.find((item) => item.value === value)?.label || '星期一';
}
