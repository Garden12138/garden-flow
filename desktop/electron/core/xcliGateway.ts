import { isIP } from 'node:net';

export interface XcliModel {
    id: string;
    xcli: {
        capabilities: string[];
        validated: boolean;
        inference_location: 'local' | 'remote' | 'unknown';
    };
}

export function xcliEndpoint(value: string): string {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('xcli endpoint is invalid'); }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (url.protocol !== 'http:' || !isIP(host) || !(host === '::1' || host.startsWith('127.'))
        || !url.port || url.username || url.password || url.search || url.hash
        || url.pathname.replace(/\/+$/, '') !== '/v1') {
        throw new Error('xcli requires a loopback IP, explicit port and /v1 path');
    }
    return url.toString().replace(/\/+$/, '');
}

export async function xcliRequest(baseURL: string, token: string, suffix: string, body?: BodyInit): Promise<Response> {
    const endpoint = xcliEndpoint(baseURL);
    if (!token.trim() || token === 'local') throw new Error('xcli requires an independent application Token');
    if (!['/models', '/images/generations', '/images/edits'].includes(suffix)) throw new Error('Unsupported xcli route');
    let response: Response;
    try {
        response = await fetch(endpoint + suffix, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { Authorization: `Bearer ${token}`, ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
            body, redirect: 'error', signal: AbortSignal.timeout(180_000),
        });
    } catch { throw new Error('Unable to reach xcli Model Gateway'); }
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`xcli request failed (HTTP ${response.status}); check Token, model capability and permissions`);
    }
    return response;
}

export async function xcliJson(response: Response, limit = 32 * 1024 * 1024): Promise<any> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('xcli returned an empty response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            if (size > limit) throw new Error('xcli response exceeds the size limit');
            chunks.push(next.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw new Error('xcli response is invalid or exceeds the size limit'); }
    finally { await reader.cancel().catch(() => {}); }
}

export async function xcliModels(baseURL: string, token: string): Promise<XcliModel[]> {
    const catalog = await xcliJson(await xcliRequest(baseURL, token, '/models'), 4 * 1024 * 1024);
    if (catalog?.object !== 'list' || !Array.isArray(catalog.data)) throw new Error('xcli model catalog is invalid');
    const seen = new Set<string>();
    return catalog.data.map((model: any) => {
        if (typeof model?.id !== 'string' || !model.id || seen.has(model.id)
            || !Array.isArray(model.xcli?.capabilities) || !model.xcli.capabilities.every((cap: unknown) => typeof cap === 'string')) {
            throw new Error('xcli model catalog is invalid');
        }
        seen.add(model.id);
        return { id: model.id, xcli: {
            capabilities: model.xcli.capabilities,
            validated: model.xcli.validated === true,
            inference_location: ['local', 'remote'].includes(model.xcli.inference_location) ? model.xcli.inference_location : 'unknown',
        } };
    });
}

export function requireXcliCapabilities(models: XcliModel[], alias: string, capabilities: string[]): XcliModel {
    const model = models.find((item) => item.id === alias);
    if (!model || capabilities.some((cap) => !model.xcli.capabilities.includes(cap)
        || (!['text.generate', 'text.stream'].includes(cap) && !model.xcli.validated))) {
        throw new Error('Selected xcli model lacks the required verified capability');
    }
    return model;
}
