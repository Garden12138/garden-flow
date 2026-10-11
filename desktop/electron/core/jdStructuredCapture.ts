// Compatibility entry points for existing 京东 tasks and integrations.
import {
    runProductStructuredCaptureRound,
    normalizeProductUrl,
    extractProductExternalId,
    uniqueProductSearchCards,
} from './productStructuredCapture.ts';
export {
    createProductStructuredCaptureIo as createJdStructuredCaptureIo,
    resolveProductCapturePacingProfile as resolveJdCapturePacingProfile,
    resolveProductSearchCardLimit as resolveJdSearchCardLimit,
    isProductCaptureBlocker as isJdCaptureBlocker,
    parseProductResearchResult as parseJdResearchResult,
    parseProductCaptureSaveResult as parseJdCaptureSaveResult,
} from './productStructuredCapture.ts';
export type {
    ProductCaptureOutcome as JdProductCaptureOutcome,
    ProductStructuredCaptureRound as JdStructuredCaptureRound,
    ProductStructuredCaptureIo as JdStructuredCaptureIo,
    ProductCapturePacingProfile as JdCapturePacingProfile,
} from './productStructuredCapture.ts';
export const normalizeJdProductUrl = (value: unknown) => normalizeProductUrl(value, 'jd');
export const extractJdProductId = (value: unknown) => extractProductExternalId(value, 'jd');
export const uniqueJdSearchCards = (items: Array<Record<string, unknown>>) => uniqueProductSearchCards(items, 'jd');
export const runJdStructuredCaptureRound: typeof runProductStructuredCaptureRound = (input, io) =>
    runProductStructuredCaptureRound({ ...input, platform: 'jd' }, io);
