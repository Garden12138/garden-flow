import type { ImageHostingConfig } from '../../../shared/imageHosting.ts';
import { isGithubImageHostingReady } from '../../../shared/imageHosting.ts';
import type { ImageHostingAdapter, ImageHostingUploadInput, ImageHostingUploadResult } from './types.ts';
import { waitForPublicUrlReady } from './publicUrlReady.ts';
import { buildGithubContentsUrl, buildGithubPublicUrl, buildJsdelivrPurgeUrl } from './url.ts';

function extractGithubErrorMessage(payload: unknown, fallback: string): string {
    if (payload && typeof payload === 'object') {
        const message = String((payload as { message?: unknown }).message || '').trim();
        if (message) return message;
    }
    return fallback;
}

export async function uploadToGithub(
    input: ImageHostingUploadInput,
    config: ImageHostingConfig,
    options?: {
        fetchImpl?: typeof fetch;
        waitForPublicUrl?: boolean;
        waitTimeoutMs?: number;
        waitIntervalMs?: number;
        sleep?: (ms: number) => Promise<void>;
    },
): Promise<ImageHostingUploadResult> {
    if (!isGithubImageHostingReady(config)) {
        throw new Error('GitHub 图床配置不完整，请填写仓库名、分支和 Token。');
    }
    const remotePath = String(input.remotePath || '').replace(/^\/+/, '');
    if (!remotePath) {
        throw new Error('GitHub 图床上传路径无效。');
    }

    const fetchImpl = options?.fetchImpl || globalThis.fetch;
    const response = await fetchImpl(buildGithubContentsUrl(config.github.repo, remotePath), {
        method: 'PUT',
        headers: {
            Authorization: `token ${config.github.token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
            message: `upload ${input.fileName || remotePath.split('/').pop() || 'image'}`,
            content: input.buffer.toString('base64'),
            branch: config.github.branch,
        }),
    });

    const rawText = await response.text().catch(() => '');
    let payload: unknown = null;
    if (rawText) {
        try {
            payload = JSON.parse(rawText);
        } catch {
            payload = rawText;
        }
    }
    if (!response.ok) {
        throw new Error(`GitHub 图床上传失败 (${response.status}): ${extractGithubErrorMessage(payload, rawText || response.statusText)}`);
    }

    const publicUrl = buildGithubPublicUrl({
        repo: config.github.repo,
        branch: config.github.branch,
        remotePath,
        customDomain: config.github.customDomain,
        publicUrlStyle: config.github.publicUrlStyle,
    });

    if (publicUrl.includes('cdn.jsdelivr.net/gh/')) {
        try {
            await fetchImpl(buildJsdelivrPurgeUrl({
                repo: config.github.repo,
                branch: config.github.branch,
                remotePath,
            }));
        } catch {
            // jsDelivr 刷新失败时仍继续探测公开地址，不阻断上传。
        }
    }

    if (options?.waitForPublicUrl !== false) {
        await waitForPublicUrlReady(publicUrl, {
            fetchImpl,
            timeoutMs: options?.waitTimeoutMs,
            intervalMs: options?.waitIntervalMs,
            sleep: options?.sleep,
        });
    }

    return {
        publicUrl,
        remotePath,
        provider: 'github',
    };
}

export const githubImageHostingAdapter: ImageHostingAdapter = {
    type: 'github',
    upload: uploadToGithub,
};
