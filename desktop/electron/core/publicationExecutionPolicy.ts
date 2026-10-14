import { getPublicationJobContext, savePublicationJobContext, getWorkspacePaths, getXhsPublisherBinding, getDouyinPublisherBinding, getTikTokPublisherBinding } from '../db';
import type { PublicationPlatform } from '../../shared/platformPublisher';
import type { PublicationJobContext } from '../../shared/publication';
import { assertPublicationButton } from './publicationAuthorization';
import { readPublicationSource, publicationFileSha256 } from './publicationSource';
import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService';
import { PUBLICATION_REVIEW_CAPABILITY, XHS_ACCOUNT_BOUND_CAPABILITY } from '../../shared/publication';

export async function requirePublicationAction(platform: PublicationPlatform, jobId: string, action: 'upload' | 'submit'): Promise<PublicationJobContext> {
    assertPublicationButton(action, jobId);
    return validatePublicationContext(platform, jobId, action);
}

/** Also run inside the submission queue, immediately before handing control to the plugin. */
export async function validatePublicationContext(platform: PublicationPlatform, jobId: string, action: 'upload' | 'submit'): Promise<PublicationJobContext> {
    const context = getPublicationJobContext(platform, jobId);
    if (!context || context.spaceId !== getWorkspacePaths().activeSpaceId) throw new Error('旧确认缺少账号或当前空间核验，请重新准备发布');
    const latest = await readPublicationSource(context.snapshot.source, false);
    if (latest.revision !== context.snapshot.revision || latest.semanticDigest !== context.snapshot.semanticDigest) throw new Error('工程、媒体、文案或设置已更新，请重新准备发布');
    if (action === 'submit' && (context.phase !== 'awaiting-submit' || context.uploadReview?.contentDigest !== context.contentDigest)) throw new Error('请先点击上传到页面供核对；上传回读通过后才能最终发布');
    if (action === 'submit' && platform === 'xiaohongshu' && (!context.uploadReview?.pageSettings?.visibilityLabel || context.uploadReview.pageSettings.scheduled !== false)) throw new Error('旧上传核验缺少当前小红书发布设置，请重新上传核对');
    const binding = platform === 'xiaohongshu' ? getXhsPublisherBinding() : platform === 'douyin' ? getDouyinPublisherBinding() : getTikTokPublisherBinding();
    if (binding !== context.extensionInstanceId) throw new Error('发布浏览器已变化，请重新准备发布');
    const bridge = getBrowserCaptureBridgeService();
    const instance = bridge?.getStatus().instances.find(item => item.extensionInstanceId === binding);
    if (!instance?.capabilities.includes(PUBLICATION_REVIEW_CAPABILITY) || (platform === 'xiaohongshu' && !instance.capabilities.includes(XHS_ACCOUNT_BOUND_CAPABILITY))) throw new Error('发布插件未连接或缺少上传核验能力');
    const state = await bridge!.invokeBrowserControl('publisher.status', { platform }, { extensionInstanceId: binding, extensionKind: 'xhs-publisher', requiredCapability: PUBLICATION_REVIEW_CAPABILITY, timeoutMs: 8000 }) as Record<string, any>;
    if (state.accountId !== context.accountId || !['ready', 'draft'].includes(state.pageState)) throw new Error('账号或发布页已变化，请重新核对');
    for (const media of context.snapshot.media) {
        if (await publicationFileSha256(media.path) !== media.sha256) throw new Error('已核对的发布媒体已损坏或被替换，请重新准备');
    }
    const after = await readPublicationSource(context.snapshot.source, false);
    if (after.revision !== context.snapshot.revision || after.semanticDigest !== context.snapshot.semanticDigest) throw new Error('核验期间工程已更新，请重新准备');
    return context;
}
export function recordPublicationUpload(context: PublicationJobContext, raw: unknown): void {
    const response = raw as Record<string, any>;
    const review = response?.uploadReview;
    const count = context.platform === 'xiaohongshu' ? context.snapshot.media.length : 1;
    if (response?.jobId === context.jobId && response.ok === false) {
        const message = typeof response.message === 'string' ? response.message.slice(0, 2000) : '平台未完成上传核对';
        const code = typeof response.code === 'string' ? response.code.slice(0, 100) : '';
        throw new Error(`上传核对失败${code ? `（${code}）` : ''}：${message}`);
    }
    if (response?.jobId !== context.jobId || response.contentDigest !== context.contentDigest
        || response.ok !== true || response.prepared !== true || response.publishStatus !== 'not_submitted'
        || !review || review.jobId !== context.jobId || review.contentDigest !== context.contentDigest
        || review.accountId !== context.accountId || !review.pageFingerprint || review.mediaCount !== count) throw new Error('上传结果、账号或媒体回读不完整，未获得最终提交授权');
    let pageSettings;
    if (context.platform === 'xiaohongshu') {
        const value = review.pageSettings;
        if (!value || typeof value.visibilityLabel !== 'string' || !value.visibilityLabel.trim() || value.visibilityLabel.length > 80) throw new Error('小红书页面可见范围回读缺失，请更新发布插件并重新上传核对');
        if (typeof value.scheduled !== 'boolean') throw new Error('小红书页面发布时间回读缺失，请更新发布插件后重新核对');
        if (value.scheduled === true) throw new Error('当前流程不支持定时发布，请关闭页面定时发布后重新核对');
        pageSettings = { visibilityLabel: value.visibilityLabel.trim(),
            ...(typeof value.original === 'boolean' ? { original: value.original } : {}),
            ...(typeof value.allowCopy === 'boolean' ? { allowCopy: value.allowCopy } : {}),
            ...(typeof value.scheduled === 'boolean' ? { scheduled: value.scheduled } : {}) };
    }
    savePublicationJobContext({ ...context, phase: 'awaiting-submit', uploadReview: { ...review, pageSettings, extensionInstanceId: context.extensionInstanceId, checkedAt: Date.now() } });
}
