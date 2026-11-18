import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

export interface XcliExecutableEnv {
    configured?: string;
    xcliPathEnv?: string;
    pathEnv?: string;
    home?: string;
}

function isExecutable(file: string): boolean {
    try {
        fs.accessSync(file, fs.constants.X_OK);
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
}

function findOnPath(name: string, pathEnv: string): string | undefined {
    if (!pathEnv) return undefined;
    return pathEnv.split(path.delimiter).map((directory) => path.resolve(directory, name)).find(isExecutable);
}

export function resolveXcliExecutable(env: XcliExecutableEnv = {}): string {
    const configured = env.configured?.trim() || 'xcli';
    const home = env.home ?? os.homedir();
    const pathEnv = env.pathEnv ?? process.env.PATH ?? '';
    const xcliPathEnv = (env.xcliPathEnv ?? process.env.XCLI_PATH)?.trim();
    if (configured.startsWith('~/')) return path.join(home, configured.slice(2));
    if (configured.includes('/')) return configured;
    if (configured !== 'xcli') {
        const executable = findOnPath(configured, pathEnv);
        if (executable) return executable;
    }

    const envExecutable = xcliPathEnv?.startsWith('~/') ? path.join(home, xcliPathEnv.slice(2)) : xcliPathEnv;
    if (envExecutable && fs.existsSync(envExecutable)) return path.resolve(envExecutable);
    const homeExecutable = path.join(home, '.local/bin/xcli');
    return findOnPath('xcli', pathEnv) ?? (fs.existsSync(homeExecutable) ? homeExecutable : 'xcli');
}

export function assertXcliExecutableName(executable: string): string {
    if (path.basename(executable) !== 'xcli') throw new Error('xcli 可执行文件的文件名必须是 xcli');
    return executable;
}

export function resolveTrustedXcliExecutable(
    configured: string | undefined,
    env?: Omit<XcliExecutableEnv, 'configured'>,
): string {
    return assertXcliExecutableName(resolveXcliExecutable({ ...env, configured }));
}

export interface XcliEvent {
    v: number;
    ts: string;
    task: string;
    seq: number;
    type: string;
    step?: string;
    agent?: string;
    data?: unknown;
}

export interface XcliArtifact {
    path: string;
    kind: string;
    mime: string;
    width?: number;
    height?: number;
    bytes: number;
    sha256: string;
    step_id?: string;
    agent?: string;
}

export interface XcliResult {
    version: number;
    task_id: string;
    status: string;
    summary: string;
    artifacts: XcliArtifact[];
    error: { kind: string; message: string; step_id?: string } | null;
    [key: string]: unknown;
}

export class XcliCancelledError extends Error {
    constructor() {
        super('xcli 任务已取消');
        this.name = 'XcliCancelledError';
    }
}

export interface XcliSubmitOptions {
    signal?: AbortSignal;
    onEvent?: (event: XcliEvent) => void;
}

function missingXcliError(executable: string): Error {
    return new Error(`未找到 xcli（${executable}），请从 https://github.com/Garden12138/xcli/releases 安装，或在设置中填写 xcli 的绝对路径`);
}

function parseEvent(line: string): XcliEvent | undefined {
    try {
        const event = JSON.parse(line);
        if (typeof event?.type === 'string') return event;
    } catch {
        // Ignore lines outside the JSONL event stream.
    }
    return undefined;
}

export async function submitXcliTask(
    executable: string,
    request: Record<string, unknown>,
    { signal, onEvent }: XcliSubmitOptions = {},
): Promise<XcliResult> {
    if (process.platform === 'win32') throw new Error('xcli 暂不支持 Windows');
    if (signal?.aborted) throw new XcliCancelledError();
    assertXcliExecutableName(executable);
    const requestJson = JSON.stringify(request);

    return new Promise((resolve, reject) => {
        const child = spawn(executable, ['submit', '--request', '-', '--events'], { stdio: 'pipe' });
        let result: XcliResult | undefined;
        let stderr = Buffer.alloc(0);
        let launchFailed = false;
        let killTimer: ReturnType<typeof setTimeout> | undefined;

        const cancel = () => {
            child.kill('SIGTERM');
            killTimer = setTimeout(() => child.kill('SIGKILL'), 10_000);
            killTimer.unref();
        };
        signal?.addEventListener('abort', cancel, { once: true });
        child.on('error', () => { launchFailed = !child.pid; });
        // The process can reject the request and close its stdin before the write completes.
        child.stdin.on('error', () => {});
        child.stderr.on('data', (chunk: Buffer) => {
            stderr = Buffer.concat([stderr, chunk]).subarray(-4096);
        });
        createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
            const event = parseEvent(line);
            if (!event) return;
            if (event.type === 'task.finished' && event.data && typeof event.data === 'object') {
                const finished = event.data as XcliResult;
                if (typeof finished.status === 'string') {
                    result = { ...finished, artifacts: Array.isArray(finished.artifacts) ? finished.artifacts : [] };
                }
            }
            onEvent?.(event);
        });
        child.once('close', (code, exitSignal) => {
            clearTimeout(killTimer);
            signal?.removeEventListener('abort', cancel);
            if (signal?.aborted) reject(new XcliCancelledError());
            else if (launchFailed) reject(missingXcliError(executable));
            else if (result) resolve(result);
            else reject(new Error(`xcli 异常退出（退出码 ${code ?? exitSignal}）：${stderr.toString().trim().slice(-500)}`));
        });
        child.stdin.end(requestJson);
    });
}

export interface XcliAgentStatus {
    name: string;
    installed: boolean;
    version?: string;
    auth?: string;
    available: boolean;
    cooldown_until?: string;
    cooldown_reason?: string;
    strengths?: Record<string, number>;
}

export async function listXcliAgents(
    executable: string,
    { timeoutMs = 15_000 }: { timeoutMs?: number } = {},
): Promise<XcliAgentStatus[]> {
    if (process.platform === 'win32') throw new Error('xcli 暂不支持 Windows');
    assertXcliExecutableName(executable);
    return new Promise((resolve, reject) => {
        execFile(executable, ['agents', '--json'], { timeout: timeoutMs, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
            if (error) {
                if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'ENOTDIR') reject(missingXcliError(executable));
                else if (error.killed) reject(new Error('检查 xcli CLI 状态超时'));
                else reject(new Error(`检查 xcli CLI 状态失败：${stderr.trim().slice(-500) || error.message}`));
                return;
            }
            try {
                const agents = JSON.parse(stdout);
                if (!Array.isArray(agents) || agents.some((agent) => typeof agent?.name !== 'string'
                    || typeof agent.installed !== 'boolean' || typeof agent.available !== 'boolean')) {
                    throw new Error('Invalid xcli agents JSON');
                }
                resolve(agents);
            } catch {
                reject(new Error('xcli CLI 状态响应格式无效'));
            }
        });
    });
}
