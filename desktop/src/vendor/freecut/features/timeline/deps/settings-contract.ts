import { create } from 'zustand';
import { HOTKEYS, type HotkeyBindingMap } from '@/config/hotkeys';

type GardenFlowSettingsState = {
  editorDensity: 'compact' | 'default';
  showWaveforms: boolean;
  showFilmstrips: boolean;
  defaultWhisperModel: string;
  maxUndoHistory: number;
};

type GardenFlowSettingsActions = {
  syncGardenFlowSettings: (patch: Partial<GardenFlowSettingsState>) => void;
};

export const useSettingsStore = create<GardenFlowSettingsState & GardenFlowSettingsActions>((set) => ({
  editorDensity: 'compact',
  showWaveforms: true,
  showFilmstrips: true,
  defaultWhisperModel: 'base',
  maxUndoHistory: 80,
  syncGardenFlowSettings: (patch) => set((state) => ({ ...state, ...patch })),
}));

export function syncGardenFlowTimelineSettings(patch: Partial<GardenFlowSettingsState>) {
  useSettingsStore.getState().syncGardenFlowSettings(patch);
}

export function useResolvedHotkeys(): HotkeyBindingMap {
  return HOTKEYS;
}
