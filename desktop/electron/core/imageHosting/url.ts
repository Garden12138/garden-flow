import { isGithubRepoName, normalizeGithubPublicUrlStyle, type GithubPublicUrlStyle } from '../../../shared/imageHosting.ts';

export function normalizePathPrefix(raw: string): string {
    const parts: string[] = [];
    for (const part of String(raw || '').replace(/\\/g, '/').split('/')) {
        const segment = part.trim();
        if (!segment || segment === '.') continue;
        if (segment === '..') {
            parts.pop();
            continue;
        }
        parts.push(segment);
    }
    return parts.join('/');
}

export function parseGithubRepo(repo: string): { owner: string; name: string } {
    const normalized = String(repo || '').trim();
    if (!isGithubRepoName(normalized)) {
        throw new Error('仓库名格式应为 owner/repo');
    }
    const [owner, name] = normalized.split('/');
    return { owner, name };
}

export function buildRemotePath(input: {
    pathPrefix?: string;
    fileName: string;
    now?: Date;
    randomId?: string;
}): string {
    const now = input.now ?? new Date();
    const stamp = String(now.getTime());
    const randomId = String(input.randomId || Math.random().toString(36).slice(2, 8)).replace(/[^a-zA-Z0-9]/g, '') || 'img';
    const ext = String(input.fileName || '')
        .trim()
        .toLowerCase()
        .match(/\.([a-z0-9]+)$/)?.[1] || 'png';
    const fileName = `${stamp}-${randomId}.${ext}`;
    const prefix = normalizePathPrefix(input.pathPrefix || '');
    return [prefix, fileName].filter(Boolean).join('/');
}

export function buildGithubPublicUrl(input: {
    repo: string;
    branch: string;
    remotePath: string;
    customDomain?: string;
    publicUrlStyle?: GithubPublicUrlStyle | string;
}): string {
    const remotePath = String(input.remotePath || '').replace(/^\/+/, '');
    const customDomain = String(input.customDomain || '').trim().replace(/\/+$/, '');
    if (customDomain) {
        return `${customDomain}/${remotePath}`;
    }
    const { owner, name } = parseGithubRepo(input.repo);
    const branch = String(input.branch || '').trim() || 'main';
    const style = normalizeGithubPublicUrlStyle(input.publicUrlStyle);
    if (style === 'raw') {
        return `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${remotePath}`;
    }
    if (style === 'jsdelivr') {
        return `https://cdn.jsdelivr.net/gh/${owner}/${name}@${branch}/${remotePath}`;
    }
    return `https://cdn.jsdmirror.com/gh/${owner}/${name}@${branch}/${remotePath}`;
}

export function rewriteGithubRawPublicUrl(
    url: string,
    options?: {
        customDomain?: string;
        publicUrlStyle?: GithubPublicUrlStyle | string;
    },
): string {
    const raw = String(url || '').trim();
    const githubRaw = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i.exec(raw);
    if (githubRaw) {
        return buildGithubPublicUrl({
            repo: `${githubRaw[1]}/${githubRaw[2]}`,
            branch: githubRaw[3],
            remotePath: githubRaw[4],
            customDomain: options?.customDomain,
            publicUrlStyle: options?.publicUrlStyle,
        });
    }
    const jsdelivr = /^https?:\/\/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^/@]+)(?:@([^/]+))?\/(.+)$/i.exec(raw);
    if (jsdelivr) {
        return buildGithubPublicUrl({
            repo: `${jsdelivr[1]}/${jsdelivr[2]}`,
            branch: jsdelivr[3] || 'main',
            remotePath: jsdelivr[4],
            customDomain: options?.customDomain,
            publicUrlStyle: options?.publicUrlStyle,
        });
    }
    return raw;
}

export function buildJsdelivrPurgeUrl(input: {
    repo: string;
    branch: string;
    remotePath: string;
}): string {
    const { owner, name } = parseGithubRepo(input.repo);
    const branch = String(input.branch || '').trim() || 'main';
    const remotePath = String(input.remotePath || '').replace(/^\/+/, '');
    return `https://purge.jsdelivr.net/gh/${owner}/${name}@${branch}/${remotePath}`;
}

export function buildGithubContentsUrl(repo: string, remotePath: string): string {
    const { owner, name } = parseGithubRepo(repo);
    const encodedPath = String(remotePath || '')
        .split('/')
        .filter(Boolean)
        .map((part) => encodeURIComponent(part))
        .join('/');
    return `https://api.github.com/repos/${owner}/${name}/contents/${encodedPath}`;
}
