import type { BrandWorkspaceImageInput, CapturedProductInput } from './brandWorkspaceStore.ts';
import { fetchProductMedia, readProductMedia, validateProductMediaSource } from './productCapturePolicy.ts';

export const capturedMediaKey = (sourceUrl: string, reviewId?: string) => JSON.stringify([reviewId || null, sourceUrl]);

// Cache entries are supplied only by the main-process store after checking the
// platform, product/review owner, exact source URL and local file contents.
export async function localizeCapturedProductMedia(input: CapturedProductInput, options: {
    headers: Record<string, string>;
    cache?: Map<string, BrandWorkspaceImageInput>;
    fetchImpl?: typeof fetch;
    wait?: (ms: number) => Promise<void>;
    signal?: AbortSignal;
}) {
    const productJobs = (input.images || []).slice(0, 24).map((image, index) => ({ image, index, reviewId: undefined as string | undefined }));
    const allReviewJobs = (input.reviewCapture?.reviews || []).flatMap((review) =>
        (review.imageSourceUrls || []).map((sourceUrl, index) => ({ image: { sourceUrl, role: 'review-image' } as BrandWorkspaceImageInput, index, reviewId: review.id })));
    const reviewJobs = allReviewJobs.slice(0, 100);
    const jobs = [...productJobs, ...reviewJobs];
    const results: Array<{ image?: BrandWorkspaceImageInput; error?: string }> = new Array(jobs.length);
    let next = 0;
    let remoteStop: unknown;
    const deadline = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
    const wait = options.wait || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    async function download(sourceUrl: string) {
        for (let attempt = 0; ; attempt += 1) {
            try {
                if (deadline.aborted) throw new Error('本次图片下载已停止或达到 60 秒上限');
                if (remoteStop) throw remoteStop;
                const response = await fetchProductMedia(input.platform, sourceUrl, options.headers, options.fetchImpl, deadline);
                return await readProductMedia(response);
            } catch (error) {
                if (deadline.aborted) throw new Error('本次图片下载已停止或达到 60 秒上限');
                const failure = error as { name?: string; code?: string; status?: number };
                if ([401, 403, 429].includes(failure.status || 0)) remoteStop = error;
                const transient = failure.name === 'TypeError' || failure.name === 'TimeoutError'
                    || [500, 502, 503, 504].includes(failure.status || 0);
                // Do not retry access denials, rate limits, unsafe redirects or
                // invalid image contents. Transient failures get one retry.
                if (!transient || attempt >= 1) throw error;
                await wait(250);
            }
        }
    }
    async function worker() {
        while (next < jobs.length) {
            const jobIndex = next++;
            const job = jobs[jobIndex];
            try {
                const sourceUrl = validateProductMediaSource(input.platform, job.image.sourceUrl);
                const cached = options.cache?.get(capturedMediaKey(sourceUrl, job.reviewId));
                const media = cached ? undefined : await download(sourceUrl);
                results[jobIndex] = { image: {
                    ...cached,
                    name: job.image.name || (job.reviewId ? `review-${input.platform}-${job.reviewId}-${job.index + 1}` : `product-${input.platform}-${job.index + 1}`),
                    sourceUrl,
                    role: job.image.role || (job.index === 0 ? 'primary' : 'image'),
                    origin: 'capture',
                    ...(media ? { dataUrl: `data:${media.contentType};base64,${media.buffer.toString('base64')}` } : {}),
                } };
            } catch (error) {
                const failure = error as { name?: string; message?: string };
                results[jobIndex] = { error: failure.name === 'TimeoutError' ? '请求超时'
                    : failure.name === 'TypeError' ? '网络连接失败' : (failure.message || '下载失败').slice(0, 150) };
            }
        }
    }
    // Product and review images share the same bounded queue.
    await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
    const productResults = results.slice(0, productJobs.length);
    const reviewResults = results.slice(productJobs.length);
    const failedImages = productResults.filter((item) => !item.image).length;
    const failedReviewImages = reviewResults.filter((item) => !item.image).length;
    const skipped = allReviewJobs.length - reviewJobs.length;
    const reviewCapture = input.reviewCapture && {
        ...input.reviewCapture,
        status: failedReviewImages || skipped ? 'partial' as const : input.reviewCapture.status,
        reviews: input.reviewCapture.reviews.map((review) => ({
            ...review,
            images: reviewJobs.flatMap((job, index) => job.reviewId === review.id && reviewResults[index].image ? [reviewResults[index].image!] : []),
            sourceImages: (review.imageSourceUrls || []).map((sourceUrl, index) => {
                const jobIndex = reviewJobs.findIndex((job) => job.reviewId === review.id && job.index === index);
                return { sourceUrl, status: jobIndex < 0 ? 'skipped' as const : reviewResults[jobIndex].image ? 'localized' as const : 'failed' as const };
            }),
        })),
        warnings: Array.from(new Set([
            ...(input.reviewCapture.warnings || []),
            ...(failedReviewImages ? [`评论图片下载失败（${failedReviewImages} 张），已保留来源链接`] : []),
            ...(skipped ? [`评论图片超过单次 100 张的保存上限（跳过 ${skipped} 张），已保留来源链接`] : []),
        ])),
    };
    return {
        images: productResults.flatMap((item) => item.image ? [item.image] : []),
        failedImages,
        failureReasons: [...new Set(productResults.flatMap((item) => item.error ? [item.error] : []))],
        reviewCapture,
    };
}
