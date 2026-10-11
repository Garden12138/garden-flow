import type { CapturedProductInput } from './brandWorkspaceStore.ts';
import { validateProductCaptureIdentity, validateProductMediaSource } from './productCapturePolicy.ts';
import { splitProductReviewMetadata } from '../../shared/productReviewMetadata.ts';

const bridgePayloadError = (code: string, message: string) => Object.assign(new Error(message), { code });

export function validateCapturedProduct(payload: object): CapturedProductInput {
  const record = payload as Record<string, unknown>;
  const platform = String(record.platform || '').trim().toLowerCase();
  const externalId = String(record.externalId || '').trim().slice(0, 500);
  const sourceUrl = String(record.sourceUrl || '').trim().slice(0, 8_000);
  const title = String(record.title || '').replace(/\s+/g, ' ').trim().slice(0, 1_000);
  validateProductCaptureIdentity(platform, externalId, sourceUrl);
  if (!title) throw bridgePayloadError('INVALID_CAPTURE_PAYLOAD', '商品名称不能为空');

  const source = record as unknown as CapturedProductInput;
  const validateImage = (value: unknown) => validateProductMediaSource(platform, value);
  let rejectedImages = 0;
  const images = (Array.isArray(source.images) ? source.images : [])
    .slice(0, 24)
    .flatMap((image) => {
      try {
        return [{
          name: String(image?.name || '').trim().slice(0, 500) || undefined,
          sourceUrl: validateImage(image?.sourceUrl),
          role: String(image?.role || '').trim().slice(0, 100) || 'image',
          origin: 'capture' as const,
        }];
      } catch {
        rejectedImages += 1;
        return [];
      }
    });
  const reviewCaptureRecord = source.reviewCapture && typeof source.reviewCapture === 'object'
    ? source.reviewCapture
    : undefined;
  let rejectedReviewImages = 0;
  const availableFilters = (Array.isArray(reviewCaptureRecord?.availableFilters) ? reviewCaptureRecord.availableFilters : [])
    .slice(0, 50)
    .flatMap((filter) => {
      const id = String(filter?.id || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 500);
      const label = String(filter?.label || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      if (!id || !label) return [];
      const sentiment = ['positive', 'neutral', 'negative'].includes(String(filter?.sentiment))
        ? filter?.sentiment as 'positive' | 'neutral' | 'negative'
        : undefined;
      return [{ id, label, countText: String(filter?.countText || '').trim().slice(0, 100) || undefined, sentiment }];
    });
  const filterIds = new Set(availableFilters.map((filter) => filter.id));
  const selectedFilters = (Array.isArray(reviewCaptureRecord?.selectedFilters) ? reviewCaptureRecord.selectedFilters : [])
    .slice(0, 50)
    .flatMap((filter) => {
      const id = String(filter?.id || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 500);
      const label = String(filter?.label || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      if (!id || !label) return [];
      const rawLimit = Number(filter?.limit);
      return [{
        id,
        label,
        limit: Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, Math.trunc(rawLimit))) : 5,
        captureAll: filter?.captureAll === true || undefined,
      }];
    });
  const reviewResults = (Array.isArray(reviewCaptureRecord?.results) ? reviewCaptureRecord.results : [])
    .slice(0, 50)
    .flatMap((item) => {
      const filterId = String(item?.filterId || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 500);
      const label = String(item?.label || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      if (!filterId || !label || (!filterIds.has(filterId) && item?.status !== 'missing')) return [];
      const resultStatus = ['complete', 'partial', 'missing'].includes(String(item?.status))
        ? item?.status as 'complete' | 'partial' | 'missing'
        : 'partial';
      return [{
        filterId,
        label,
        requested: Math.max(0, Math.trunc(Number(item?.requested) || 0)),
        captured: Math.max(0, Math.trunc(Number(item?.captured) || 0)),
        availableCount: typeof item?.availableCount === 'number' && Number.isSafeInteger(item.availableCount) && item.availableCount >= 0 ? item.availableCount : undefined,
        status: resultStatus,
        warning: String(item?.warning || '').replace(/\s+/g, ' ').trim().slice(0, 500) || undefined,
        captureAll: item?.captureAll === true || undefined,
      }];
    });
  const reviews = (Array.isArray(reviewCaptureRecord?.reviews) ? reviewCaptureRecord.reviews : [])
    .flatMap((review) => {
      const id = String(review?.id || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 500);
      const text = String(review?.text || '').replace(/\s+/g, ' ').trim();
      if (!id || !text) return [];
      const imageSourceUrls = (Array.isArray(review?.imageSourceUrls) ? review.imageSourceUrls : [])
        .slice(0, 9)
        .flatMap((imageUrl) => {
          try {
            return [validateImage(imageUrl)];
          } catch {
            rejectedReviewImages += 1;
            return [];
          }
        });
      let video;
      if (review?.video?.present === true) {
        try {
          video = {
            present: true as const,
            sourceUrl: review.video.sourceUrl ? validateImage(review.video.sourceUrl) : undefined,
          };
        } catch {
          video = { present: true as const };
        }
      }
      const rating = Number(review?.rating);
      const helpfulCount = Number(review?.helpfulCount);
      const sentiment = ['positive', 'neutral', 'negative'].includes(String(review?.sentiment))
        ? review?.sentiment as 'positive' | 'neutral' | 'negative'
        : undefined;
      return [{
        id,
        platformReviewId: String(review?.platformReviewId || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 500) || undefined,
        authorName: String(review?.authorName || '').replace(/\s+/g, ' ').trim().slice(0, 300) || undefined,
        text,
        merchantReply: String(review?.merchantReply || '').replace(/\s+/g, ' ').trim() || undefined,
        rating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
        sentiment,
        matchedFilterIds: Array.from(new Set((Array.isArray(review?.matchedFilterIds) ? review.matchedFilterIds : [])
          .map((value) => String(value || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 500))
          .filter((value) => value && filterIds.has(value)))).slice(0, 50),
        ...splitProductReviewMetadata(review?.dateText, review?.skuText),
        badges: Array.from(new Set((Array.isArray(review?.badges) ? review.badges : [])
          .map((value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100)).filter(Boolean))).slice(0, 20),
        helpfulCount: Number.isFinite(helpfulCount) && helpfulCount >= 0 ? Math.trunc(helpfulCount) : undefined,
        imageSourceUrls,
        sourceImages: imageSourceUrls.map((sourceUrl) => ({ sourceUrl })),
        video,
      }];
    });
  const reviewStatus = ['not-opened', 'ready', 'complete', 'partial'].includes(String(reviewCaptureRecord?.status))
    ? reviewCaptureRecord?.status as 'not-opened' | 'ready' | 'complete' | 'partial'
    : reviews.length ? 'partial' : 'not-opened';
  const reviewCapture = reviewCaptureRecord ? {
    modalDetected: reviewCaptureRecord.modalDetected === true,
    status: rejectedReviewImages > 0 ? 'partial' as const : reviewStatus,
    availableFilters,
    selectedFilters,
    results: reviewResults,
    reviews,
    warnings: Array.from(new Set([
      ...(Array.isArray(reviewCaptureRecord.warnings) ? reviewCaptureRecord.warnings : [])
        .map((value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500)).filter(Boolean),
      ...(rejectedReviewImages > 0 ? [`已忽略无效来源或平台占位评论图片（${rejectedReviewImages} 张）`] : []),
    ])).slice(0, 100),
    activeFilterId: String(reviewCaptureRecord.activeFilterId || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 500) || undefined,
    sortText: String(reviewCaptureRecord.sortText || '').replace(/\s+/g, ' ').trim().slice(0, 100) || undefined,
    scopeText: String(reviewCaptureRecord.scopeText || '').replace(/\s+/g, ' ').trim().slice(0, 100) || undefined,
  } : undefined;
  return {
    ...source,
    platform,
    externalId,
    sourceUrl,
    title,
    images,
    reviewOptions: {
      selectedFilterIds: Array.from(new Set((Array.isArray(source.reviewOptions?.selectedFilterIds) ? source.reviewOptions.selectedFilterIds : [])
        .map((value) => String(value || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 500)).filter(Boolean))).slice(0, 50),
      selectedFilterLabels: Array.from(new Set((Array.isArray(source.reviewOptions?.selectedFilterLabels) ? source.reviewOptions.selectedFilterLabels : [])
        .map((value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100)).filter(Boolean))).slice(0, 50),
      limitPerFilter: Number.isFinite(Number(source.reviewOptions?.limitPerFilter))
        ? Math.max(1, Math.min(50, Math.trunc(Number(source.reviewOptions?.limitPerFilter))))
        : 5,
      filterLabels: Object.fromEntries(Object.entries(source.reviewOptions?.filterLabels || {}).slice(0, 50)
        .filter(([id, label]) => id && typeof label === 'string')
        .map(([id, label]) => [id.replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 500), label.replace(/\s+/g, ' ').trim().slice(0, 100)])),
      filterLimits: Object.fromEntries(Object.entries(source.reviewOptions?.filterLimits || {}).slice(0, 50).map(([id, limit]) => [id.replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 500), Math.max(1, Math.min(50, Math.trunc(Number(limit) || 5)))])),
      captureAll: platform === 'jd' && source.reviewOptions?.captureAll === true,
    },
    reviewCapture,
    missingFields: [
      ...(Array.isArray(source.missingFields) ? source.missingFields : []),
      ...(rejectedImages > 0 ? [`已忽略无效来源或平台界面图片（${rejectedImages} 张）`] : []),
    ],
  };
}
