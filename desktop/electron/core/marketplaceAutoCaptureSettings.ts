import { resolveJdAutoCaptureLaunch } from './jdAutoCaptureSettings.ts';

export const TAOBAO_AUTO_CAPTURE_TASK_ID = 'taobao-product-auto-capture';
export const TMALL_AUTO_CAPTURE_TASK_ID = 'tmall-product-auto-capture';
export type MarketplaceCapturePlatform = 'taobao' | 'tmall';

export function marketplaceCapturePlatform(taskId: string): MarketplaceCapturePlatform | null {
    if (taskId === TAOBAO_AUTO_CAPTURE_TASK_ID) return 'taobao';
    if (taskId === TMALL_AUTO_CAPTURE_TASK_ID) return 'tmall';
    return null;
}

// Same typed settings and daily keyword rotation as JD; empty labels are passed
// through so the Taobao/Tmall adapter samples the current list, without sentiment inference.
export const resolveMarketplaceAutoCaptureLaunch = resolveJdAutoCaptureLaunch;
