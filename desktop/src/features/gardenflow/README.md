# `features/gardenflow`

GardenFlow feature helpers that are shared by GardenFlow-adjacent pages.

## Modules

- `automationTasks.ts`: automation task draft shaping, schedule conversion, list filtering and sorting.

## Rules

- Pages keep view state and rendering hereafter; shared task/domain shaping belongs in this feature folder.
- Host calls must go through `window.ipcRenderer.gardenflowRunner`, which is exported from the GardenFlow bridge domain.
- Runtime sessions should carry explicit GardenFlow metadata: `surface`, `runtimeSurface`, `runtimeMode`, and `gardenflowContext`.
