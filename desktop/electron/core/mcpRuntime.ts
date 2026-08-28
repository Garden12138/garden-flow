import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { McpServerConfig } from './mcpStore';
import { maybeRewriteComputerUseNavigation, rememberXhsCaptureScreenshot } from './xhsAutoCaptureChrome';
import { isComputerUseScreenshotTool } from './xhsAutoCaptureLocate';
import packageJson from '../../package.json';

interface JsonRpcError {
  code?: number;
  message?: string;
  data?: unknown;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: JsonRpcError;
}

interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

type StdioWireMode = 'content-length' | 'jsonl';

const JSONRPC_VERSION = '2.0';
const MCP_PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_TIMEOUT_MS = 20000;
const MCP_LIST_TIMEOUT_MS = 30000;
const MCP_CALL_TIMEOUT_MS = 120000;
const MCP_CLIENT_VERSION = String((packageJson as { version?: string }).version || '0.0.0');

const parseJson = (text: string): unknown | null => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

class StdioJsonRpcClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private buffer = Buffer.alloc(0);
  private lineBuffer = '';
  private closed = false;
  private wireMode: StdioWireMode;

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly env: Record<string, string>,
    wireMode: StdioWireMode
  ) {
    this.wireMode = wireMode;
    this.child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    this.child.stderr.on('data', (_chunk: Buffer) => {
      // Ignore noisy stderr output by default; errors are handled by request timeouts/exits.
    });
    this.child.on('error', (error) => this.closeWithError(error));
    this.child.on('exit', (code, signal) => {
      if (!this.closed) {
        this.closeWithError(new Error(`MCP stdio process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
      }
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'Bojin',
        version: MCP_CLIENT_VERSION,
      },
    });

    await this.notify('notifications/initialized', {});
  }

  async listTools(timeoutMs = MCP_LIST_TIMEOUT_MS): Promise<McpToolInfo[]> {
    const result = await this.request('tools/list', {}, timeoutMs) as { tools?: McpToolInfo[] };
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs = MCP_CALL_TIMEOUT_MS): Promise<unknown> {
    return this.request('tools/call', {
      name,
      arguments: args,
    }, timeoutMs);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.child.kill('SIGTERM');
    } catch {
      // ignore
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MCP stdio client closed'));
    }
    this.pending.clear();
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    const message = {
      jsonrpc: JSONRPC_VERSION,
      method,
      params,
    };
    this.writeMessage(message);
  }

  private request(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    const id = this.nextId++;
    const payload = {
      jsonrpc: JSONRPC_VERSION,
      id,
      method,
      params,
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.writeMessage(payload);
    });
  }

  private writeMessage(payload: Record<string, unknown>) {
    const body = JSON.stringify(payload);
    if (this.wireMode === 'jsonl') {
      this.child.stdin.write(`${body}\n`);
      return;
    }
    const encoded = Buffer.from(body, 'utf8');
    const header = Buffer.from(`Content-Length: ${encoded.length}\r\n\r\n`, 'utf8');
    this.child.stdin.write(Buffer.concat([header, encoded]));
  }

  private handleStdout(chunk: Buffer) {
    if (this.wireMode === 'jsonl') {
      this.handleJsonl(chunk);
      return;
    }

    // Parse Content-Length framed messages.
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const sepIndex = this.buffer.indexOf('\r\n\r\n');
      if (sepIndex < 0) break;

      const headerText = this.buffer.slice(0, sepIndex).toString('utf8');
      const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        // Fallback: maybe this stream is jsonl in practice.
        this.handleJsonl(this.buffer);
        this.buffer = Buffer.alloc(0);
        break;
      }

      const contentLength = Number(lengthMatch[1]);
      const totalLength = sepIndex + 4 + contentLength;
      if (this.buffer.length < totalLength) break;

      const body = this.buffer.slice(sepIndex + 4, totalLength).toString('utf8');
      this.buffer = this.buffer.slice(totalLength);
      this.handleMessageBody(body);
    }
  }

  private handleJsonl(chunk: Buffer) {
    this.lineBuffer += chunk.toString('utf8');
    let newlineIndex = this.lineBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const rawLine = this.lineBuffer.slice(0, newlineIndex).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      if (rawLine) {
        this.handleMessageBody(rawLine);
      }
      newlineIndex = this.lineBuffer.indexOf('\n');
    }
  }

  private handleMessageBody(body: string) {
    const parsed = parseJson(body) as JsonRpcResponse | null;
    if (!parsed || typeof parsed !== 'object') return;
    if (typeof parsed.id !== 'number') return;

    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);
    clearTimeout(pending.timer);

    if (parsed.error) {
      pending.reject(new Error(parsed.error.message || 'MCP request failed'));
      return;
    }
    pending.resolve(parsed.result);
  }

  private closeWithError(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

const callHttpJsonRpc = async (
  url: string,
  payload: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<{ response: unknown; sessionId?: string }> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(headers || {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  const sessionId = res.headers.get('mcp-session-id') || undefined;
  const body = await res.json() as unknown;
  return { response: body, sessionId };
};

const extractRpcResult = (raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object') return raw;
  const response = raw as JsonRpcResponse;
  if (response.error) {
    throw new Error(response.error.message || 'MCP response error');
  }
  return response.result;
};

const parseToolListResult = (raw: unknown): McpToolInfo[] => {
  const result = extractRpcResult(raw) as { tools?: McpToolInfo[] } | undefined;
  return Array.isArray(result?.tools) ? result.tools : [];
};

const parseToolCallResult = (raw: unknown): unknown => {
  return extractRpcResult(raw);
};

const extensionForMime = (mime: string): string => {
  const normalized = mime.toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  return 'png';
};

const writeMcpImageFile = async (data: string, mimeType: string): Promise<string> => {
  const raw = data.startsWith('data:')
    ? data.replace(/^data:[^;]+;base64,/, '')
    : data;
  const filePath = path.join(
    os.tmpdir(),
    `computer-use-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionForMime(mimeType)}`,
  );
  await fs.writeFile(filePath, Buffer.from(raw, 'base64'));
  return filePath;
};

const materializeMcpImages = async (value: unknown, depth = 0): Promise<unknown> => {
  if (depth > 8 || value == null) return value;
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => materializeMcpImages(item, depth + 1)));
  }
  if (typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const type = String(record.type || '').toLowerCase();
  const mime = String(record.mimeType || record.mime_type || '').toLowerCase();
  const data = typeof record.data === 'string'
    ? record.data
    : (typeof record.blob === 'string' ? record.blob : '');
  const isImage = type === 'image'
    || mime.startsWith('image/')
    || (typeof record.data === 'string' && record.data.startsWith('data:image/'));
  if (isImage && data) {
    const filePath = await writeMcpImageFile(data, mime || 'image/png');
    return {
      type: 'image',
      mimeType: mime || 'image/png',
      path: filePath,
      note: '截图已保存为本地文件。画面会作为图片附加给模型，不要再去读这个路径。',
    };
  }

  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    next[key] = await materializeMcpImages(child, depth + 1);
  }
  return next;
};

const withStdioMcpClient = async <T>(server: McpServerConfig, fn: (client: StdioJsonRpcClient) => Promise<T>): Promise<T> => {
  const command = String(server.command || '').trim();
  if (!command) {
    throw new Error('MCP stdio server missing command');
  }

  const args = Array.isArray(server.args) ? server.args : [];
  const env = (server.env || {}) as Record<string, string>;
  const modes: StdioWireMode[] = ['content-length', 'jsonl'];
  let client: StdioJsonRpcClient | null = null;
  let lastInitError: unknown = null;

  for (const mode of modes) {
    const candidate = new StdioJsonRpcClient(command, args, env, mode);
    try {
      await candidate.initialize();
      client = candidate;
      break;
    } catch (error) {
      lastInitError = error;
      await candidate.close();
    }
  }

  if (!client) {
    const message = lastInitError instanceof Error ? lastInitError.message : String(lastInitError);
    throw new Error(`MCP stdio initialize failed: ${message}`);
  }

  try {
    return await fn(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`MCP stdio request failed: ${message}`);
  } finally {
    await client.close();
  }
};

const getHttpHeadersFromEnv = (server: McpServerConfig): Record<string, string> => {
  const env = server.env || {};
  const headers: Record<string, string> = {};
  if (env.AUTHORIZATION) headers.Authorization = env.AUTHORIZATION;
  if (env.MCP_AUTHORIZATION) headers.Authorization = env.MCP_AUTHORIZATION;
  if (env.MCP_API_KEY) headers['x-api-key'] = env.MCP_API_KEY;
  return headers;
};

export async function listMcpTools(server: McpServerConfig): Promise<McpToolInfo[]> {
  if (server.transport === 'stdio') {
    return withStdioMcpClient(server, async (client) => client.listTools());
  }

  const url = String(server.url || '').trim();
  if (!url) throw new Error('MCP HTTP server missing url');

  const headers = getHttpHeadersFromEnv(server);
  const init = await callHttpJsonRpc(url, {
    jsonrpc: JSONRPC_VERSION,
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: { name: 'Bojin', version: MCP_CLIENT_VERSION },
    },
  }, headers);
  const sessionHeader = init.sessionId ? { ...headers, 'mcp-session-id': init.sessionId } : headers;

  const list = await callHttpJsonRpc(url, {
    jsonrpc: JSONRPC_VERSION,
    id: 2,
    method: 'tools/list',
    params: {},
  }, sessionHeader);

  return parseToolListResult(list.response);
}

const rememberComputerUseScreenshot = (server: McpServerConfig, toolName: string, result: unknown): unknown => {
  if (String(server.id || '').trim() === 'computer-use' && isComputerUseScreenshotTool(toolName)) {
    rememberXhsCaptureScreenshot(result);
  }
  return result;
};

export async function callMcpTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (!toolName.trim()) {
    throw new Error('toolName is required');
  }

  if (String(server.id || '').trim() === 'computer-use') {
    const rewritten = await maybeRewriteComputerUseNavigation(toolName, args);
    if (rewritten.handled) {
      return rewritten.result;
    }
  }

  if (server.transport === 'stdio') {
    const result = await withStdioMcpClient(server, async (client) => client.callTool(toolName, args));
    return rememberComputerUseScreenshot(server, toolName, await materializeMcpImages(result));
  }

  const url = String(server.url || '').trim();
  if (!url) throw new Error('MCP HTTP server missing url');

  const headers = getHttpHeadersFromEnv(server);
  const init = await callHttpJsonRpc(url, {
    jsonrpc: JSONRPC_VERSION,
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: { name: 'Bojin', version: MCP_CLIENT_VERSION },
    },
  }, headers);
  const sessionHeader = init.sessionId ? { ...headers, 'mcp-session-id': init.sessionId } : headers;

  const call = await callHttpJsonRpc(url, {
    jsonrpc: JSONRPC_VERSION,
    id: 3,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  }, sessionHeader);

  return rememberComputerUseScreenshot(
    server,
    toolName,
    await materializeMcpImages(parseToolCallResult(call.response)),
  );
}
