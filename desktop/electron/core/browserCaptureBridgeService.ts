import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
    BROWSER_CAPTURE_ALLOWED_METHODS,
    BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION,
    BROWSER_CAPTURE_DESCRIPTOR_SCHEMA_VERSION,
    BROWSER_CAPTURE_EXTENSION_ORIGIN,
    BROWSER_CAPTURE_MAX_FRAME_BYTES,
    BROWSER_CAPTURE_PROTOCOL_VERSION,
    BROWSER_CONTROL_FORWARD_ID_PREFIX,
    BROWSER_CONTROL_FORWARD_METHODS,
    BROWSER_CONTROL_PROTOCOL_VERSION,
    browserCaptureDescriptorPath,
    browserCaptureStateRoot,
    isBrowserControlForwardId,
    isOfficialBrowserCaptureOrigin,
    type BrowserCaptureBridgeDescriptor,
    type BrowserCaptureBridgeEndpoint,
} from './browserCaptureProtocol.ts';

type JsonRpcRequest = {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: { code?: number; message?: string; data?: Record<string, unknown> };
};

type BridgeRole = 'native_host' | 'browser_control_client';

type ConnectionState = {
    authenticated: boolean;
    role: BridgeRole | '';
    origin: string;
    hostInstanceId: string;
    extensionInstanceId: string;
    nativeHostPid: number;
};

export type BrowserCaptureExtensionInstance = {
    extensionId: string;
    extensionInstanceId: string;
    extensionVersion: string;
    browser: string;
    hostInstanceId: string;
    nativeHostPid?: number;
    connectedAtMs: number;
    lastSeenAtMs: number;
    accessProblem?: {
        code: 'BROWSER_LOGIN_REQUIRED' | 'BROWSER_SECURITY_CHALLENGE' | 'CONTENT_NOT_ACCESSIBLE';
        platform: string;
        origin: string;
        recovery: string;
    };
};

export type BrowserCaptureBridgeStatus = {
    listening: boolean;
    protocolVersion: number;
    captureProtocolVersion: number;
    descriptorPath: string;
    endpoint: BrowserCaptureBridgeEndpoint | null;
    instances: BrowserCaptureExtensionInstance[];
    lastError: string;
};

export type BrowserCaptureBridgeRequestContext = {
    origin: string;
    hostInstanceId: string;
    extensionInstanceId: string;
};

type BrowserCaptureBridgeOptions = {
    appVersion: string;
    handleRequest: (
        method: string,
        params: Record<string, unknown>,
        context: BrowserCaptureBridgeRequestContext,
    ) => Promise<unknown>;
};

function rpcError(code: string, message: string, patch: Record<string, unknown> = {}) {
    return {
        code: -32000,
        message,
        data: {
            code,
            phase: 'bridge',
            retryable: false,
            ...patch,
        },
    };
}

function errorPayload(error: unknown) {
    const source = error as {
        code?: unknown;
        phase?: unknown;
        retryable?: unknown;
        recovery?: unknown;
        details?: unknown;
        message?: unknown;
    };
    return rpcError(
        String(source?.code || 'DESKTOP_BRIDGE_REQUEST_FAILED'),
        error instanceof Error ? error.message : String(source?.message || error || 'Desktop Bridge request failed'),
        {
            phase: String(source?.phase || 'bridge'),
            retryable: source?.retryable === true,
            recovery: String(source?.recovery || ''),
            details: source?.details,
        },
    );
}

function writeFrame(socket: net.Socket, message: unknown): void {
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    if (payload.length > BROWSER_CAPTURE_MAX_FRAME_BYTES) {
        throw Object.assign(new Error('Desktop Bridge response exceeds the frame limit'), {
            code: 'BROWSER_RESPONSE_TOO_LARGE',
        });
    }
    const frame = Buffer.allocUnsafe(payload.length + 4);
    frame.writeUInt32LE(payload.length, 0);
    payload.copy(frame, 4);
    socket.write(frame);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseNativeHostPidFromInstanceId(hostInstanceId: string): number {
    const match = /^electron-native-host-(\d+)-/.exec(String(hostInstanceId || '').trim());
    const pid = match ? Number(match[1]) : 0;
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

export class BrowserCaptureBridgeService {
    private server: net.Server | null = null;
    private endpoint: BrowserCaptureBridgeEndpoint | null = null;
    private descriptor: BrowserCaptureBridgeDescriptor | null = null;
    private readonly sockets = new Set<net.Socket>();
    private readonly instances = new Map<string, BrowserCaptureExtensionInstance>();
    private readonly hostSockets = new Map<string, net.Socket>();
    private readonly pendingForwards = new Map<string, {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    private forwardSequence = 0;
    private lastError = '';
    private readonly options: BrowserCaptureBridgeOptions;

    constructor(options: BrowserCaptureBridgeOptions) {
        this.options = options;
    }

    getStatus(): BrowserCaptureBridgeStatus {
        return {
            listening: Boolean(this.server?.listening),
            protocolVersion: BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION,
            captureProtocolVersion: BROWSER_CAPTURE_PROTOCOL_VERSION,
            descriptorPath: browserCaptureDescriptorPath(),
            endpoint: this.endpoint,
            instances: Array.from(this.instances.values())
                .sort((left, right) => right.lastSeenAtMs - left.lastSeenAtMs),
            lastError: this.lastError,
        };
    }

    async start(): Promise<void> {
        if (this.server?.listening) return;
        const stateRoot = browserCaptureStateRoot();
        await fs.mkdir(stateRoot, { recursive: true, mode: 0o700 });
        const endpoint = this.createEndpoint(stateRoot);
        const endpointPath = endpoint.kind === 'unix' ? endpoint.path : endpoint.name;
        if (endpoint.kind === 'unix') {
            await fs.rm(endpoint.path, { force: true }).catch(() => undefined);
        }

        const server = net.createServer((socket) => this.accept(socket));
        server.on('error', (error) => {
            this.lastError = error.message;
        });
        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => reject(error);
            server.once('error', onError);
            server.listen(endpointPath, () => {
                server.off('error', onError);
                resolve();
            });
        });
        if (endpoint.kind === 'unix') {
            await fs.chmod(endpoint.path, 0o600).catch(() => undefined);
        }
        this.server = server;
        this.endpoint = endpoint;
        this.descriptor = {
            schemaVersion: BROWSER_CAPTURE_DESCRIPTOR_SCHEMA_VERSION,
            bridgeProtocolVersion: BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION,
            captureProtocolVersion: BROWSER_CAPTURE_PROTOCOL_VERSION,
            browserProtocolVersion: BROWSER_CONTROL_PROTOCOL_VERSION,
            appVersion: this.options.appVersion,
            appInstanceId: randomUUID(),
            endpoint,
            hostAuthToken: randomBytes(32).toString('hex'),
            controlAuthToken: randomBytes(32).toString('hex'),
            ready: true,
            startedAtMs: Date.now(),
            updatedAtMs: Date.now(),
        };
        await this.writeDescriptor();
    }

    async stop(): Promise<void> {
        for (const socket of this.sockets) {
            socket.destroy();
        }
        this.sockets.clear();
        this.instances.clear();
        this.hostSockets.clear();
        for (const pending of this.pendingForwards.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Desktop Bridge stopped'));
        }
        this.pendingForwards.clear();
        const server = this.server;
        this.server = null;
        if (server) {
            await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => undefined);
        }
        if (this.endpoint?.kind === 'unix') {
            await fs.rm(this.endpoint.path, { force: true }).catch(() => undefined);
        }
        await fs.rm(browserCaptureDescriptorPath(), { force: true }).catch(() => undefined);
        this.endpoint = null;
        this.descriptor = null;
    }

    private createEndpoint(stateRoot: string): BrowserCaptureBridgeEndpoint {
        if (process.platform === 'win32') {
            const userHint = String(os.userInfo().username || 'user').replace(/[^A-Za-z0-9._-]/g, '-');
            return { kind: 'windows_named_pipe', name: `\\\\.\\pipe\\redbox-desktop-bridge-${userHint}` };
        }
        return { kind: 'unix', path: path.join(stateRoot, 'desktop-bridge-v1.sock') };
    }

    private async writeDescriptor(): Promise<void> {
        if (!this.descriptor) return;
        this.descriptor.updatedAtMs = Date.now();
        const descriptorPath = browserCaptureDescriptorPath();
        const temporaryPath = `${descriptorPath}.${process.pid}.tmp`;
        await fs.writeFile(temporaryPath, `${JSON.stringify(this.descriptor, null, 2)}\n`, {
            encoding: 'utf8',
            mode: 0o600,
        });
        if (process.platform === 'win32') {
            await fs.rm(descriptorPath, { force: true }).catch(() => undefined);
        }
        await fs.rename(temporaryPath, descriptorPath);
        await fs.chmod(descriptorPath, 0o600).catch(() => undefined);
    }

    private accept(socket: net.Socket): void {
        this.sockets.add(socket);
        const state: ConnectionState = {
            authenticated: false,
            role: '',
            origin: '',
            hostInstanceId: '',
            extensionInstanceId: '',
            nativeHostPid: 0,
        };
        let buffer = Buffer.alloc(0);
        socket.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 4) {
                const length = buffer.readUInt32LE(0);
                if (length <= 0 || length > BROWSER_CAPTURE_MAX_FRAME_BYTES) {
                    socket.destroy(new Error('Desktop Bridge frame length is invalid'));
                    return;
                }
                if (buffer.length < length + 4) return;
                const raw = buffer.subarray(4, length + 4);
                buffer = buffer.subarray(length + 4);
                let message: JsonRpcRequest;
                try {
                    message = JSON.parse(raw.toString('utf8')) as JsonRpcRequest;
                } catch {
                    writeFrame(socket, { jsonrpc: '2.0', id: null, error: rpcError('INVALID_JSON', 'Invalid JSON-RPC payload') });
                    continue;
                }
                void this.handleMessage(socket, state, message);
            }
        });
        const cleanup = () => {
            this.sockets.delete(socket);
            if (state.extensionInstanceId) {
                this.instances.delete(state.extensionInstanceId);
                if (this.hostSockets.get(state.extensionInstanceId) === socket) {
                    this.hostSockets.delete(state.extensionInstanceId);
                }
            }
        };
        socket.on('close', cleanup);
        socket.on('error', () => undefined);
    }

    private settleForwardResponse(message: JsonRpcRequest): boolean {
        const id = String(message.id ?? '');
        if (!isBrowserControlForwardId(id)) return false;
        const pending = this.pendingForwards.get(id);
        if (!pending) return true;
        this.pendingForwards.delete(id);
        clearTimeout(pending.timer);
        if (message.error) {
            pending.reject(Object.assign(
                new Error(message.error.message || 'browser control request failed'),
                {
                    code: message.error.data?.code,
                    details: message.error.data?.details,
                },
            ));
        } else {
            pending.resolve(message.result);
        }
        return true;
    }

    private async handleMessage(socket: net.Socket, state: ConnectionState, request: JsonRpcRequest): Promise<void> {
        if (!request.method && request.id != null && this.settleForwardResponse(request)) {
            return;
        }
        const id = request.id ?? null;
        const method = String(request.method || '').trim();
        const params = isObject(request.params) ? request.params : {};
        const respond = (result: unknown) => writeFrame(socket, { jsonrpc: '2.0', id, result });
        const reject = (error: unknown) => writeFrame(socket, { jsonrpc: '2.0', id, error: errorPayload(error) });
        try {
            if (request.jsonrpc !== '2.0' || !method || id == null) {
                throw Object.assign(new Error('Desktop Bridge requires a JSON-RPC 2.0 request with id and method'), {
                    code: 'INVALID_REQUEST',
                });
            }
            if (!state.authenticated) {
                if (method !== 'bridge.hello') {
                    throw Object.assign(new Error('bridge.hello is required before other requests'), { code: 'AUTHENTICATION_REQUIRED' });
                }
                respond(this.authenticate(state, params));
                return;
            }
            if (method === 'bridge.disconnect') {
                respond({ ok: true });
                socket.end();
                return;
            }
            if (state.role === 'browser_control_client') {
                if (method === 'control.listInstances') {
                    respond({ instances: this.getStatus().instances });
                    return;
                }
                throw Object.assign(new Error(`Control method is outside the content-capture scope: ${method}`), {
                    code: 'METHOD_NOT_ALLOWED',
                });
            }
            if (!BROWSER_CAPTURE_ALLOWED_METHODS.has(method)) {
                throw Object.assign(new Error(`Native method is not allowed: ${method}`), { code: 'METHOD_NOT_ALLOWED' });
            }
            if (method === 'extension.register') {
                respond(this.registerExtension(state, params, socket));
                return;
            }
            if (method !== 'desktop.health' && !state.extensionInstanceId) {
                throw Object.assign(new Error('Extension registration is required before content ingestion'), {
                    code: 'EXTENSION_REGISTRATION_REQUIRED',
                });
            }
            const instance = state.extensionInstanceId ? this.instances.get(state.extensionInstanceId) : null;
            if (instance) instance.lastSeenAtMs = Date.now();
            respond(await this.options.handleRequest(method, params, {
                origin: state.origin,
                hostInstanceId: state.hostInstanceId,
                extensionInstanceId: state.extensionInstanceId,
            }));
        } catch (error) {
            reject(error);
        }
    }

    private authenticate(state: ConnectionState, params: Record<string, unknown>) {
        const descriptor = this.descriptor;
        if (!descriptor) {
            throw Object.assign(new Error('Desktop Bridge is not ready'), { code: 'BRIDGE_NOT_READY' });
        }
        if (Number(params.bridgeProtocolVersion) !== BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION) {
            throw Object.assign(new Error('Desktop Bridge protocol mismatch'), { code: 'BROWSER_PROTOCOL_MISMATCH' });
        }
        const role = String(params.role || '') as BridgeRole;
        const expectedToken = role === 'native_host'
            ? descriptor.hostAuthToken
            : role === 'browser_control_client'
                ? descriptor.controlAuthToken
                : '';
        if (!expectedToken || String(params.authToken || '') !== expectedToken) {
            throw Object.assign(new Error('Desktop Bridge authentication failed'), { code: 'BROWSER_AUTHENTICATION_FAILED' });
        }
        const origin = String(params.origin || '').trim();
        if (role === 'native_host' && !isOfficialBrowserCaptureOrigin(origin)) {
            throw Object.assign(new Error('Native Host origin is not allowed'), { code: 'EXTENSION_ORIGIN_NOT_ALLOWED' });
        }
        state.authenticated = true;
        state.role = role;
        state.origin = origin;
        state.hostInstanceId = String(params.hostInstanceId || '').trim().slice(0, 500) || randomUUID();
        const parsedPid = Number(params.nativeHostPid);
        state.nativeHostPid = Number.isInteger(parsedPid) && parsedPid > 0
            ? parsedPid
            : parseNativeHostPidFromInstanceId(state.hostInstanceId);
        return {
            ok: true,
            bridgeProtocolVersion: BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION,
            captureProtocolVersion: BROWSER_CAPTURE_PROTOCOL_VERSION,
            browserProtocolVersion: BROWSER_CONTROL_PROTOCOL_VERSION,
            appVersion: this.options.appVersion,
            appInstanceId: descriptor.appInstanceId,
            acceptedCapabilities: role === 'native_host' ? ['knowledge.ingest', 'extension.register'] : ['control.listInstances'],
        };
    }

    private registerExtension(state: ConnectionState, params: Record<string, unknown>, socket?: net.Socket) {
        const extensionId = String(params.extensionId || '').trim();
        const extensionInstanceId = String(params.extensionInstanceId || '').trim().slice(0, 500);
        if (`chrome-extension://${extensionId}/` !== BROWSER_CAPTURE_EXTENSION_ORIGIN || !extensionInstanceId) {
            throw Object.assign(new Error('Extension registration identity is invalid'), { code: 'EXTENSION_IDENTITY_INVALID' });
        }
        const now = Date.now();
        const existing = this.instances.get(extensionInstanceId);
        const accessProblemInput = isObject(params.accessProblem) ? params.accessProblem : null;
        const accessCode = String(accessProblemInput?.code || '');
        const accessProblem = ['BROWSER_LOGIN_REQUIRED', 'BROWSER_SECURITY_CHALLENGE', 'CONTENT_NOT_ACCESSIBLE'].includes(accessCode)
            ? {
                code: accessCode as 'BROWSER_LOGIN_REQUIRED' | 'BROWSER_SECURITY_CHALLENGE' | 'CONTENT_NOT_ACCESSIBLE',
                platform: String(accessProblemInput?.platform || 'webpage').slice(0, 100),
                origin: String(accessProblemInput?.origin || '').slice(0, 2_000),
                recovery: String(accessProblemInput?.recovery || '').slice(0, 500),
            }
            : undefined;
        const instance: BrowserCaptureExtensionInstance = {
            extensionId,
            extensionInstanceId,
            extensionVersion: String(params.version || '').trim().slice(0, 100),
            browser: String(params.browser || '').trim().slice(0, 100),
            hostInstanceId: state.hostInstanceId,
            nativeHostPid: state.nativeHostPid || existing?.nativeHostPid || undefined,
            connectedAtMs: existing?.connectedAtMs || now,
            lastSeenAtMs: now,
            accessProblem,
        };
        state.extensionInstanceId = extensionInstanceId;
        this.instances.set(extensionInstanceId, instance);
        if (socket) {
            this.hostSockets.set(extensionInstanceId, socket);
        }
        return {
            ok: true,
            registered: true,
            bridgeProtocolVersion: BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION,
            captureProtocolVersion: BROWSER_CAPTURE_PROTOCOL_VERSION,
            appVersion: this.options.appVersion,
        };
    }

    /**
     * 桌面 → native host → 插件：调用插件 nativeMethodRouter 的方法。
     * `tools/call` + { name, arguments } 会被插件路由到对应 browser action（如 research.run）。
     */
    async invokeBrowserControl(
        method: string,
        params: Record<string, unknown>,
        options: { extensionInstanceId?: string; timeoutMs?: number } = {},
    ): Promise<unknown> {
        if (!BROWSER_CONTROL_FORWARD_METHODS.has(method)) {
            throw Object.assign(new Error(`Browser control method is not forwardable: ${method}`), {
                code: 'METHOD_NOT_ALLOWED',
            });
        }
        const requestedInstance = String(options.extensionInstanceId || '').trim();
        const candidates = this.getStatus().instances;
        const instance = requestedInstance
            ? candidates.find((item) => item.extensionInstanceId === requestedInstance)
            : candidates[0];
        if (!instance) {
            throw Object.assign(new Error('没有已连接的 Bojin 浏览器插件实例'), {
                code: 'BROWSER_INSTANCE_UNAVAILABLE',
            });
        }
        const socket = this.hostSockets.get(instance.extensionInstanceId);
        if (!socket || socket.destroyed) {
            throw Object.assign(new Error('插件的原生消息通道已断开，请重启浏览器后重试'), {
                code: 'BROWSER_INSTANCE_UNAVAILABLE',
            });
        }
        this.forwardSequence += 1;
        const id = `${BROWSER_CONTROL_FORWARD_ID_PREFIX}${this.forwardSequence}:${randomUUID()}`;
        const timeoutMs = Math.max(1_000, Number(options.timeoutMs || 60_000));
        return await new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingForwards.delete(id);
                reject(Object.assign(new Error(`浏览器控制请求超时: ${method}`), {
                    code: 'BROWSER_CONTROL_TIMEOUT',
                }));
            }, timeoutMs);
            this.pendingForwards.set(id, { resolve, reject, timer });
            try {
                writeFrame(socket, { jsonrpc: '2.0', id, method, params });
            } catch (error) {
                this.pendingForwards.delete(id);
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    /** 桌面进程内直接调用采集入库 handler（与插件走 bridge 的入库同一实现）。 */
    async invokeLocalCaptureRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
        return await this.options.handleRequest(method, params, {
            origin: 'bojin://desktop-internal',
            hostInstanceId: 'desktop-internal',
            extensionInstanceId: 'desktop-internal',
        });
    }
}

let service: BrowserCaptureBridgeService | null = null;

export function createBrowserCaptureBridgeService(options: BrowserCaptureBridgeOptions): BrowserCaptureBridgeService {
    if (service) return service;
    service = new BrowserCaptureBridgeService(options);
    return service;
}

export function getBrowserCaptureBridgeService(): BrowserCaptureBridgeService | null {
    return service;
}
