import os from 'node:os';
import path from 'node:path';
import {
    XHS_PUBLISHER_CAPABILITY,
    XHS_PUBLISHER_EXTENSION_ID,
    XHS_PUBLISHER_EXTENSION_ORIGIN,
    type BrowserExtensionKind,
} from '../../shared/xhsPublisher.ts';

export const BROWSER_CAPTURE_EXTENSION_ID = 'dhfphfekcjahljnefpdjoidehnhhoeie';
export const BROWSER_CAPTURE_EXTENSION_ORIGIN = `chrome-extension://${BROWSER_CAPTURE_EXTENSION_ID}/`;
export const BROWSER_CAPTURE_NATIVE_HOST_NAME = 'com.gardenflow.browser_control';
export const BROWSER_CAPTURE_DESCRIPTOR_SCHEMA_VERSION = 2;
export const BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION = 1;
export const BROWSER_CAPTURE_PROTOCOL_VERSION = 1;
export const BROWSER_CONTROL_PROTOCOL_VERSION = 3;
export const BROWSER_CAPTURE_MAX_FRAME_BYTES = 16 * 1024 * 1024;

export const BROWSER_CAPTURE_ALLOWED_METHODS = new Set([
    'desktop.health',
    'extension.register',
    'knowledge.ingestEntry',
    'knowledge.ingestXhsEntryV2',
    'knowledge.ingestZhihuAnswer',
    'knowledge.ingestZhihuArticle',
    'knowledge.ingestMediaAssets',
]);

export const BROWSER_CAPTURE_CAPABILITIES = ['knowledge.ingest', 'extension.register'] as const;
export const XHS_PUBLISHER_CAPABILITIES = [XHS_PUBLISHER_CAPABILITY, 'extension.register'] as const;

/**
 * 桌面 → native host → 插件方向允许转发的方法。
 * 插件端由 nativeMethodRouter 处理（tools/call 会路由到 browser action，如 research.run）。
 */
export const BROWSER_CONTROL_FORWARD_METHODS = new Set([
    'ping',
    'getInfo',
    'tools/list',
    'tools/call',
    'publisher.status',
    'publisher.publish',
    'publisher.restore',
]);

export const BROWSER_CONTROL_FORWARD_ID_PREFIX = 'desktop-fwd:';

export function isBrowserControlForwardId(value: unknown): boolean {
    return typeof value === 'string' && value.startsWith(BROWSER_CONTROL_FORWARD_ID_PREFIX);
}

export type BrowserCaptureBridgeEndpoint =
    | { kind: 'unix'; path: string }
    | { kind: 'windows_named_pipe'; name: string };

export type BrowserCaptureBridgeDescriptor = {
    schemaVersion: number;
    bridgeProtocolVersion: number;
    captureProtocolVersion: number;
    browserProtocolVersion: number;
    appVersion: string;
    appInstanceId: string;
    endpoint: BrowserCaptureBridgeEndpoint;
    hostAuthToken: string;
    controlAuthToken: string;
    ready: boolean;
    startedAtMs: number;
    updatedAtMs: number;
};

export function browserCaptureStateRoot(): string {
    if (process.env.GARDENFLOW_BROWSER_CONTROL_STATE_DIR) {
        return path.resolve(process.env.GARDENFLOW_BROWSER_CONTROL_STATE_DIR);
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library/Application Support/GardenFlow/native-host');
    }
    if (process.platform === 'win32') {
        return path.join(
            process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'),
            'GardenFlow/native-host',
        );
    }
    return path.join(
        process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'),
        'GardenFlow/native-host',
    );
}

export function browserCaptureDescriptorPath(): string {
    return process.env.GARDENFLOW_BROWSER_BRIDGE_DESCRIPTOR
        || path.join(browserCaptureStateRoot(), 'desktop-bridge-v1.json');
}

export function isOfficialBrowserCaptureOrigin(value: unknown): boolean {
    return String(value || '').trim() === BROWSER_CAPTURE_EXTENSION_ORIGIN;
}

export function isOfficialBrowserPublisherOrigin(value: unknown): boolean {
    return String(value || '').trim() === XHS_PUBLISHER_EXTENSION_ORIGIN;
}

export function isOfficialGardenFlowExtensionOrigin(value: unknown): boolean {
    return isOfficialBrowserCaptureOrigin(value) || isOfficialBrowserPublisherOrigin(value);
}

export function browserExtensionIdentityForOrigin(value: unknown): {
    extensionId: string;
    extensionKind: BrowserExtensionKind;
    capabilities: string[];
} | null {
    if (isOfficialBrowserCaptureOrigin(value)) {
        return {
            extensionId: BROWSER_CAPTURE_EXTENSION_ID,
            extensionKind: 'capture',
            capabilities: [...BROWSER_CAPTURE_CAPABILITIES],
        };
    }
    if (isOfficialBrowserPublisherOrigin(value)) {
        return {
            extensionId: XHS_PUBLISHER_EXTENSION_ID,
            extensionKind: 'xhs-publisher',
            capabilities: [...XHS_PUBLISHER_CAPABILITIES],
        };
    }
    return null;
}

export function findBrowserCaptureOrigin(argv = process.argv): string {
    return argv.map((item) => String(item || '').trim())
        .find((item) => item.startsWith('chrome-extension://')) || '';
}

export function isBrowserCaptureNativeHostInvocation(argv = process.argv): boolean {
    return isOfficialGardenFlowExtensionOrigin(findBrowserCaptureOrigin(argv));
}
