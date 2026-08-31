import fs from 'node:fs';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import desktopPackage from '../package.json' with { type: 'json' };
import {
    BROWSER_CAPTURE_ALLOWED_METHODS,
    BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION,
    BROWSER_CAPTURE_DESCRIPTOR_SCHEMA_VERSION,
    BROWSER_CAPTURE_MAX_FRAME_BYTES,
    BROWSER_CAPTURE_PROTOCOL_VERSION,
    BROWSER_CONTROL_FORWARD_METHODS,
    BROWSER_CONTROL_PROTOCOL_VERSION,
    browserCaptureDescriptorPath,
    findBrowserCaptureOrigin,
    isBrowserControlForwardId,
    isOfficialBrowserCaptureOrigin,
    type BrowserCaptureBridgeDescriptor,
} from './core/browserCaptureProtocol.ts';

type JsonRpcMessage = {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: { code?: number; message?: string; data?: Record<string, unknown> };
};

export type BrowserNativeHostDiagnostic = {
    event: string;
    details?: Record<string, unknown>;
};

export type BrowserNativeHostRuntimeOptions = {
    onDiagnostic?: (diagnostic: BrowserNativeHostDiagnostic) => void;
};

const HOST_INSTANCE_ID = `electron-native-host-${process.pid}-${randomUUID()}`;
const APP_VERSION = String(desktopPackage.version || '0.0.0');

function writeNativeMessage(message: unknown): void {
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    if (payload.length > BROWSER_CAPTURE_MAX_FRAME_BYTES) {
        throw new Error('Native Host response exceeds the frame limit');
    }
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(payload.length, 0);
    fs.writeSync(1, header);
    fs.writeSync(1, payload);
}

function typedError(error: unknown) {
    const source = error as {
        code?: unknown;
        phase?: unknown;
        retryable?: unknown;
        recovery?: unknown;
        details?: unknown;
        message?: unknown;
    };
    return {
        code: -32000,
        message: error instanceof Error ? error.message : String(source?.message || error || 'Native Host request failed'),
        data: {
            code: String(source?.code || 'NATIVE_REQUEST_FAILED'),
            phase: String(source?.phase || 'native_messaging'),
            retryable: source?.retryable === true,
            recovery: String(source?.recovery || ''),
            details: source?.details,
        },
    };
}

function readDescriptor(): BrowserCaptureBridgeDescriptor {
    let parsed: BrowserCaptureBridgeDescriptor;
    try {
        parsed = JSON.parse(fs.readFileSync(browserCaptureDescriptorPath(), 'utf8')) as BrowserCaptureBridgeDescriptor;
    } catch (error) {
        throw Object.assign(new Error('GardenFlow desktop app is not running'), {
            code: 'APP_NOT_RUNNING',
            phase: 'bridge',
            retryable: true,
            details: { cause: error instanceof Error ? error.message : String(error) },
        });
    }
    if (
        parsed.schemaVersion !== BROWSER_CAPTURE_DESCRIPTOR_SCHEMA_VERSION
        || parsed.bridgeProtocolVersion !== BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION
        || parsed.captureProtocolVersion !== BROWSER_CAPTURE_PROTOCOL_VERSION
        || parsed.ready !== true
        || String(parsed.hostAuthToken || '').length < 32
    ) {
        throw Object.assign(new Error('GardenFlow Desktop Bridge descriptor is incompatible'), {
            code: 'BROWSER_PROTOCOL_MISMATCH',
            phase: 'bridge',
            retryable: false,
        });
    }
    return parsed;
}

export class DesktopBridgeHostClient {
    private socket: net.Socket | null = null;
    private buffer = Buffer.alloc(0);
    private sequence = 0;
    private readonly pending = new Map<string, {
        resolve: (value: unknown) => void;
        reject: (error: unknown) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    private hello: unknown = null;
    private registration: Record<string, unknown> | null = null;
    private readonly origin: string;
    private readonly onForwardRequest?: (message: JsonRpcMessage) => void;

    constructor(options: { origin?: string; onForwardRequest?: (message: JsonRpcMessage) => void } = {}) {
        this.origin = String(options.origin || findBrowserCaptureOrigin()).trim();
        this.onForwardRequest = options.onForwardRequest;
    }

    /** 把插件对「桌面转发请求」的响应回写给桌面 bridge。 */
    respondToDesktop(id: string, result: unknown, error?: { code?: string; message: string }): void {
        const socket = this.socket;
        if (!socket || socket.destroyed) return;
        const message = error
            ? { jsonrpc: '2.0', id, error: { code: -32000, message: error.message, data: { code: error.code || 'FORWARD_FAILED' } } }
            : { jsonrpc: '2.0', id, result: result ?? null };
        const payload = Buffer.from(JSON.stringify(message), 'utf8');
        if (payload.length > BROWSER_CAPTURE_MAX_FRAME_BYTES) {
            return this.respondToDesktop(id, undefined, {
                code: 'BROWSER_RESPONSE_TOO_LARGE',
                message: 'Browser control response exceeds the frame limit',
            });
        }
        const frame = Buffer.allocUnsafe(payload.length + 4);
        frame.writeUInt32LE(payload.length, 0);
        payload.copy(frame, 4);
        try {
            socket.write(frame);
        } catch {
            // 桥断开时丢弃响应，由桌面侧超时兜底。
        }
    }

    async connect(): Promise<unknown> {
        if (this.socket && !this.socket.destroyed && this.hello) return this.hello;
        const descriptor = readDescriptor();
        const endpointPath = descriptor.endpoint.kind === 'unix'
            ? descriptor.endpoint.path
            : descriptor.endpoint.name;
        const socket = await new Promise<net.Socket>((resolve, reject) => {
            const candidate = net.createConnection(endpointPath);
            const timer = setTimeout(() => {
                candidate.destroy();
                reject(Object.assign(new Error('GardenFlow Desktop Bridge connection timed out'), {
                    code: 'APP_BRIDGE_UNAVAILABLE',
                    phase: 'bridge',
                    retryable: true,
                }));
            }, 2_000);
            candidate.once('connect', () => {
                clearTimeout(timer);
                resolve(candidate);
            });
            candidate.once('error', (error) => {
                clearTimeout(timer);
                reject(Object.assign(error, {
                    code: 'APP_BRIDGE_UNAVAILABLE',
                    phase: 'bridge',
                    retryable: true,
                }));
            });
        });
        this.socket = socket;
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('error', (error) => this.rejectAll(error));
        socket.on('close', () => {
            this.socket = null;
            this.hello = null;
            this.rejectAll(Object.assign(new Error('GardenFlow Desktop Bridge disconnected'), {
                code: 'APP_BRIDGE_UNAVAILABLE',
                phase: 'bridge',
                retryable: true,
            }));
        });
        try {
            const hello = await this.request('bridge.hello', {
                role: 'native_host',
                bridgeProtocolVersion: BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION,
                captureProtocolVersion: BROWSER_CAPTURE_PROTOCOL_VERSION,
                browserProtocolVersion: BROWSER_CONTROL_PROTOCOL_VERSION,
                appInstanceId: descriptor.appInstanceId,
                hostInstanceId: HOST_INSTANCE_ID,
                nativeHostPid: process.pid,
                authToken: descriptor.hostAuthToken,
                origin: this.origin,
                capabilities: ['knowledge.ingest', 'extension.register'],
            }, 3_000);
            if (this.registration) {
                await this.request('extension.register', this.registration, 3_000);
            }
            this.hello = hello;
            return hello;
        } catch (error) {
            if (this.socket === socket) {
                this.socket = null;
                this.hello = null;
            }
            socket.destroy();
            throw error;
        }
    }

    async call(method: string, params: Record<string, unknown>, timeoutMs = 35_000): Promise<unknown> {
        await this.connect();
        const result = await this.request(method, params, timeoutMs);
        if (method === 'extension.register') {
            this.registration = { ...params };
        }
        return result;
    }

    close(): void {
        const socket = this.socket;
        this.socket = null;
        this.hello = null;
        if (socket && !socket.destroyed) socket.destroy();
        this.rejectAll(new Error('Native Host stopped'));
    }

    private request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
        const socket = this.socket;
        if (!socket || socket.destroyed) {
            return Promise.reject(new Error('Desktop Bridge is disconnected'));
        }
        this.sequence += 1;
        const id = `native-host:${process.pid}:${this.sequence}`;
        const payload = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8');
        if (payload.length > BROWSER_CAPTURE_MAX_FRAME_BYTES) {
            return Promise.reject(Object.assign(new Error('Capture payload exceeds the Native Bridge limit'), {
                code: 'CAPTURE_PAYLOAD_TOO_LARGE',
                phase: 'bridge',
                retryable: false,
            }));
        }
        const frame = Buffer.allocUnsafe(payload.length + 4);
        frame.writeUInt32LE(payload.length, 0);
        payload.copy(frame, 4);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(Object.assign(new Error(`Desktop Bridge request timed out: ${method}`), {
                    code: 'DESKTOP_BRIDGE_TIMEOUT',
                    phase: 'bridge',
                    retryable: true,
                }));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            socket.write(frame, (error) => {
                if (!error) return;
                const pending = this.pending.get(id);
                if (!pending) return;
                this.pending.delete(id);
                clearTimeout(pending.timer);
                pending.reject(error);
            });
        });
    }

    private onData(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 4) {
            const length = this.buffer.readUInt32LE(0);
            if (length <= 0 || length > BROWSER_CAPTURE_MAX_FRAME_BYTES) {
                this.socket?.destroy(new Error('Desktop Bridge returned an invalid frame'));
                return;
            }
            if (this.buffer.length < length + 4) return;
            const raw = this.buffer.subarray(4, length + 4);
            this.buffer = this.buffer.subarray(length + 4);
            let message: JsonRpcMessage;
            try {
                message = JSON.parse(raw.toString('utf8')) as JsonRpcMessage;
            } catch (error) {
                this.socket?.destroy(error as Error);
                return;
            }
            if (message.method && message.id != null) {
                try {
                    this.onForwardRequest?.(message);
                } catch (error) {
                    this.respondToDesktop(String(message.id), undefined, {
                        code: 'FORWARD_FAILED',
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
                continue;
            }
            const id = String(message.id || '');
            const pending = this.pending.get(id);
            if (!pending) continue;
            this.pending.delete(id);
            clearTimeout(pending.timer);
            if (message.error) {
                pending.reject(Object.assign(new Error(message.error.message || 'Desktop Bridge request failed'), {
                    code: message.error.data?.code,
                    phase: message.error.data?.phase,
                    retryable: message.error.data?.retryable,
                    recovery: message.error.data?.recovery,
                    details: message.error.data?.details,
                }));
            } else {
                pending.resolve(message.result);
            }
        }
    }

    private rejectAll(error: unknown): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }
}

function desktopBridgeAvailability(error: unknown) {
    const code = String((error as { code?: unknown })?.code || 'APP_BRIDGE_UNAVAILABLE');
    const appNotRunning = code === 'APP_NOT_RUNNING' || code === 'ENOENT' || code === 'ECONNREFUSED';
    return {
        connected: false,
        availability: appNotRunning ? 'app_not_running' : 'bridge_error',
        errorCode: code,
        appVersion: APP_VERSION,
        bridgeProtocolVersion: BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION,
        captureProtocolVersion: BROWSER_CAPTURE_PROTOCOL_VERSION,
    };
}

export async function runBrowserNativeHost(options: BrowserNativeHostRuntimeOptions = {}): Promise<void> {
    const report = (event: string, details?: Record<string, unknown>) => {
        try {
            options.onDiagnostic?.({ event, details });
        } catch {
            // Diagnostics must never interfere with the Native Messaging protocol.
        }
    };
    const origin = findBrowserCaptureOrigin();
    report('host_started', {
        pid: process.pid,
        platform: process.platform,
        arch: process.arch,
        appVersion: APP_VERSION,
        originAccepted: isOfficialBrowserCaptureOrigin(origin),
    });
    if (!isOfficialBrowserCaptureOrigin(origin)) {
        report('host_rejected_origin');
        process.exitCode = 2;
        return;
    }
    // 须大于桌面侧宏调用超时上限（570s），host 只兜底清理，不先于桌面放弃。
    const FORWARD_TIMEOUT_MS = 600_000;
    const forwardedToExtension = new Map<string, ReturnType<typeof setTimeout>>();
    const client: DesktopBridgeHostClient = new DesktopBridgeHostClient({
        onForwardRequest: (message) => {
            const id = String(message.id ?? '');
            const method = String(message.method || '').trim();
            if (!id) return;
            if (!BROWSER_CONTROL_FORWARD_METHODS.has(method)) {
                client.respondToDesktop(id, undefined, {
                    code: 'METHOD_NOT_ALLOWED',
                    message: `Browser control method is not allowed: ${method}`,
                });
                return;
            }
            report('forward_request_received', { id, method });
            const timer = setTimeout(() => {
                forwardedToExtension.delete(id);
                client.respondToDesktop(id, undefined, {
                    code: 'BROWSER_CONTROL_TIMEOUT',
                    message: `Browser control request timed out in extension: ${method}`,
                });
            }, FORWARD_TIMEOUT_MS);
            forwardedToExtension.set(id, timer);
            try {
                writeNativeMessage({ jsonrpc: '2.0', id, method, params: message.params || {} });
            } catch (error) {
                clearTimeout(timer);
                forwardedToExtension.delete(id);
                client.respondToDesktop(id, undefined, {
                    code: 'FORWARD_FAILED',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        },
    });
    let buffer = Buffer.alloc(0);
    let pendingMessages = 0;
    let inputEnded = false;
    const finishWhenIdle = () => {
        if (!inputEnded || pendingMessages > 0) return;
        client.close();
        process.exitCode = 0;
    };
    const handle = async (message: JsonRpcMessage) => {
        const id = message.id ?? null;
        const method = String(message.method || '').trim();
        if (!method && id != null && isBrowserControlForwardId(String(id))) {
            const timer = forwardedToExtension.get(String(id));
            if (timer) {
                clearTimeout(timer);
                forwardedToExtension.delete(String(id));
            }
            client.respondToDesktop(
                String(id),
                message.result,
                message.error
                    ? {
                        code: String(message.error.data?.code || 'BROWSER_CONTROL_FAILED'),
                        message: message.error.message || 'browser control request failed',
                    }
                    : undefined,
            );
            report('forward_response_relayed', { id: String(id), ok: !message.error });
            return;
        }
        report('request_received', { id: String(id ?? ''), method });
        try {
            if (message.jsonrpc !== '2.0' || id == null || !method) {
                throw Object.assign(new Error('Invalid Native Messaging JSON-RPC request'), { code: 'INVALID_REQUEST' });
            }
            if (method === 'ping' || method === 'getInfo') {
                let hello: any = null;
                let desktopBridge: Record<string, unknown>;
                try {
                    hello = await client.connect();
                    desktopBridge = {
                        connected: true,
                        availability: 'connected',
                        appVersion: String(hello?.appVersion || APP_VERSION),
                        bridgeProtocolVersion: Number(hello?.bridgeProtocolVersion || BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION),
                        captureProtocolVersion: Number(hello?.captureProtocolVersion || BROWSER_CAPTURE_PROTOCOL_VERSION),
                        capabilities: Array.isArray(hello?.acceptedCapabilities)
                            ? hello.acceptedCapabilities
                            : ['knowledge.ingest', 'extension.register'],
                    };
                } catch (error) {
                    desktopBridge = desktopBridgeAvailability(error);
                }
                writeNativeMessage({
                    jsonrpc: '2.0',
                    id,
                    result: {
                        ok: true,
                        hostName: 'com.gardenflow.browser_control',
                        hostInstanceId: HOST_INSTANCE_ID,
                        appVersion: String(hello?.appVersion || APP_VERSION),
                        bridgeProtocolVersion: BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION,
                        captureProtocolVersion: BROWSER_CAPTURE_PROTOCOL_VERSION,
                        browserProtocolVersion: BROWSER_CONTROL_PROTOCOL_VERSION,
                        capabilities: ['knowledge.ingest', 'extension.register'],
                        desktopBridge,
                    },
                });
                report('response_sent', { id: String(id), method, ok: true });
                return;
            }
            if (!BROWSER_CAPTURE_ALLOWED_METHODS.has(method)) {
                throw Object.assign(new Error(`Native Host method is not allowed: ${method}`), { code: 'METHOD_NOT_ALLOWED' });
            }
            const result = await client.call(method, message.params || {});
            writeNativeMessage({ jsonrpc: '2.0', id, result });
            report('response_sent', { id: String(id), method, ok: true });
        } catch (error) {
            const responseError = typedError(error);
            report('request_failed', {
                id: String(id ?? ''),
                method,
                code: responseError.data.code,
                message: responseError.message,
            });
            try {
                writeNativeMessage({ jsonrpc: '2.0', id, error: responseError });
                report('response_sent', { id: String(id ?? ''), method, ok: false });
            } catch (writeError) {
                report('response_write_failed', {
                    id: String(id ?? ''),
                    method,
                    message: writeError instanceof Error ? writeError.message : String(writeError),
                });
                throw writeError;
            }
        }
    };

    process.stdin.on('data', (chunk: Buffer) => {
        report('stdin_data', { bytes: chunk.length });
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
            const length = buffer.readUInt32LE(0);
            if (length <= 0 || length > BROWSER_CAPTURE_MAX_FRAME_BYTES) {
                report('invalid_frame_length', { length });
                client.close();
                process.exit(3);
                return;
            }
            if (buffer.length < length + 4) return;
            const raw = buffer.subarray(4, length + 4);
            buffer = buffer.subarray(length + 4);
            let message: JsonRpcMessage;
            try {
                message = JSON.parse(raw.toString('utf8')) as JsonRpcMessage;
            } catch {
                report('invalid_json', { bytes: raw.length });
                writeNativeMessage({ jsonrpc: '2.0', id: null, error: typedError(Object.assign(new Error('Invalid Native Messaging JSON'), { code: 'INVALID_JSON' })) });
                continue;
            }
            pendingMessages += 1;
            void handle(message).finally(() => {
                pendingMessages -= 1;
                finishWhenIdle();
            });
        }
    });
    process.stdin.on('end', () => {
        report('stdin_end', { pendingMessages });
        inputEnded = true;
        finishWhenIdle();
    });
    process.stdin.on('error', (error) => {
        report('stdin_error', { message: error.message });
    });
    process.stdin.resume();
}
