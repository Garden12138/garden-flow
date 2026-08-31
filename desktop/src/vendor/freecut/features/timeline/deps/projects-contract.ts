import { create } from 'zustand';

type ProjectMetadata = {
  width: number;
  height: number;
  fps: number;
};

type GardenFlowProjectState = {
  currentProject: {
    id: string;
    metadata: ProjectMetadata;
  } | null;
};

type GardenFlowProjectActions = {
  syncCurrentProject: (project: GardenFlowProjectState['currentProject']) => void;
};

export const useProjectStore = create<GardenFlowProjectState & GardenFlowProjectActions>((set) => ({
  currentProject: {
    id: 'gardenflow-project',
    metadata: {
      width: 1080,
      height: 1920,
      fps: 30,
    },
  },
  syncCurrentProject: (currentProject) => set({ currentProject }),
}));

export function syncGardenFlowTimelineProject(project: GardenFlowProjectState['currentProject']) {
  useProjectStore.getState().syncCurrentProject(project);
}
