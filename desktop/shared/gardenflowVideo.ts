import { APP_BRAND } from '../src/config/brand';

export type GardenFlowOfficialVideoMode =
  | 'text-to-video'
  | 'reference-guided'
  | 'first-last-frame'
  | 'continuation';

export const GARDENFLOW_OFFICIAL_VIDEO_BASE_URL = '';

export const GARDENFLOW_OFFICIAL_VIDEO_MODELS = {
  'text-to-video': 'seedance-2.0',
  'reference-guided': 'seedance-2.0',
  'first-last-frame': 'seedance-2.0',
  'continuation': 'seedance-2.0',
} as const;

export const GARDENFLOW_OFFICIAL_VIDEO_MODEL_LIST = [
  GARDENFLOW_OFFICIAL_VIDEO_MODELS['text-to-video'],
  GARDENFLOW_OFFICIAL_VIDEO_MODELS['reference-guided'],
  GARDENFLOW_OFFICIAL_VIDEO_MODELS['first-last-frame'],
] as const;

export function getGardenFlowOfficialVideoModel(mode: GardenFlowOfficialVideoMode): string {
  return GARDENFLOW_OFFICIAL_VIDEO_MODELS[mode];
}

export function isGardenFlowOfficialVideoModel(model: string): boolean {
  const normalized = String(model || '').trim();
  return GARDENFLOW_OFFICIAL_VIDEO_MODEL_LIST.includes(normalized as typeof GARDENFLOW_OFFICIAL_VIDEO_MODEL_LIST[number]);
}
