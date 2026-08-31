export type GardenFlowOnboardingState = Record<string, unknown> | null;

export function isGardenFlowOnboardingCompleted(state: GardenFlowOnboardingState): boolean {
  const completedAt = String(state?.completedAt || '').trim();
  return completedAt.length > 0;
}
