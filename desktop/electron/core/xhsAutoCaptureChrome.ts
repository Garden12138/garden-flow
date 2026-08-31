import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService.ts';
import {
  chromeClickError,
  isClickInBrowserChrome,
  isComputerUsePointerTool,
  locateBeforeClickError,
  readClickPoint,
  readScreenshotFrame,
  type CaptureScreenshotFrame,
} from './xhsAutoCaptureLocate.ts';

const execFileAsync = promisify(execFile);

const XHS_SEARCH_ORIGIN = 'https://www.xiaohongshu.com';

export interface XhsCaptureChromeSession {
  keyword: string;
  profile: string;
  searchUrl: string;
  lastScreenshot?: CaptureScreenshotFrame | null;
}

export interface ChromeNavigationResult {
  ok: boolean;
  url: string;
  method?: 'plugin-bound-focus' | 'open-launch' | 'applescript-set-tab-url';
  rewritten?: boolean;
  skippedOpenProfile?: boolean;
  browserPid?: number;
  nativeHostPid?: number;
  extensionInstanceId?: string;
  blockedNativeSave?: boolean;
  blockedChromeClick?: boolean;
  blockedBeforeLocate?: boolean;
  blockedOmniboxShortcut?: boolean;
  note?: string;
  error?: string;
}

let captureSession: XhsCaptureChromeSession | null = null;

export function buildXhsSearchUrl(keyword: string): string {
  return `${XHS_SEARCH_ORIGIN}/search_result?keyword=${encodeURIComponent(String(keyword || '').trim())}`;
}

export function beginXhsCaptureChromeSession(input: {
  keyword: string;
  profile: string;
}): XhsCaptureChromeSession {
  const keyword = String(input.keyword || '').trim();
  const profile = String(input.profile || '').trim() || 'ComputerUse';
  captureSession = {
    keyword,
    profile,
    searchUrl: buildXhsSearchUrl(keyword),
    lastScreenshot: null,
  };
  return captureSession;
}

export function endXhsCaptureChromeSession(): void {
  captureSession = null;
}

export function getXhsCaptureChromeSession(): XhsCaptureChromeSession | null {
  return captureSession;
}

export function isComputerUseOpenUrlTool(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return normalized === 'computer-browser-open-url'
    || normalized === 'browser-open-url'
    || normalized === 'computer-open-url';
}

export function isComputerUseOpenProfileTool(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return normalized === 'computer-browser-open-profile'
    || normalized === 'browser-open-profile';
}

export function isComputerUseKeyTool(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return normalized === 'computer-key'
    || normalized === 'computer-hotkey'
    || normalized === 'computer-press-key'
    || normalized === 'computer-keyboard'
    || normalized === 'key'
    || normalized === 'hotkey'
    || normalized === 'press-key';
}

function readKeyHaystack(toolName: string, args: Record<string, unknown> | null | undefined): string {
  const record = args && typeof args === 'object' ? args : {};
  const modifiers = Array.isArray(record.modifiers)
    ? record.modifiers.map((item) => String(item))
    : [record.modifiers, record.modifier, record.mods];
  return [
    normalizeToolName(toolName),
    record.key,
    record.keys,
    record.combination,
    record.hotkey,
    record.combo,
    record.shortcut,
    ...modifiers,
  ].map((item) => String(item || '').trim().toLowerCase()).join(' ');
}

export function isOmniboxFocusShortcut(
  toolName: string,
  args?: Record<string, unknown> | null,
): boolean {
  if (!isComputerUseKeyTool(toolName) && !/\b(?:key|hotkey|press)\b/.test(normalizeToolName(toolName))) {
    return false;
  }
  const haystack = readKeyHaystack(toolName, args);
  if (/(?:cmd|command|meta|super|ctrl|control)\s*\+?\s*l\b/.test(haystack)) return true;
  const hasL = /(?:^|\s)l(?:\s|$)/.test(haystack) || /\bkey(?:s)?\s+l\b/.test(haystack);
  const hasCommand = /\b(?:cmd|command|meta|super|ctrl|control)\b/.test(haystack);
  return hasL && hasCommand;
}

export function rememberXhsCaptureScreenshot(result: unknown): CaptureScreenshotFrame | null {
  if (!captureSession) return null;
  const frame = readScreenshotFrame(result);
  if (!frame) return captureSession.lastScreenshot || null;
  captureSession.lastScreenshot = frame;
  return frame;
}

export function isNativeBrowserSaveShortcut(
  toolName: string,
  args?: Record<string, unknown> | null,
): boolean {
  if (!isComputerUseKeyTool(toolName) && !/\b(?:key|hotkey|press)\b/.test(normalizeToolName(toolName))) {
    return false;
  }
  const haystack = readKeyHaystack(toolName, args);
  if (/(?:cmd|command|meta|super)\s*\+?\s*s\b/.test(haystack)) return true;
  const hasS = /(?:^|\s)s(?:\s|$)/.test(haystack) || /\bkey(?:s)?\s+s\b/.test(haystack);
  const hasCommand = /\b(?:cmd|command|meta|super)\b/.test(haystack);
  return hasS && hasCommand;
}

export function readMcpUrlArg(args: Record<string, unknown> | null | undefined): string {
  if (!args || typeof args !== 'object') return '';
  return String(args.url || args.URL || args.uri || '').trim();
}

function normalizeToolName(toolName: string): string {
  return String(toolName || '').trim().toLowerCase().replace(/_/g, '-');
}

export type ProcessTableRow = {
  pid: number;
  ppid: number;
  command: string;
};

export function parseProcessTable(stdout: string): ProcessTableRow[] {
  return String(stdout || '').split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) return [];
    return [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: String(match[3] || '').trim(),
    }];
  }).filter((row) => Number.isInteger(row.pid) && row.pid > 0);
}

function isBrowserHelperProcess(command: string): boolean {
  return /helper|renderer|gpu|plugin|crashpad|alerter|nacl/i.test(command);
}

function commandMatchesBrowserFamily(command: string, family: string): boolean {
  const name = String(command || '').toLowerCase();
  if (isBrowserHelperProcess(name)) return false;
  if (family === 'edge') return name.includes('microsoft edge');
  if (family === 'brave') return name.includes('brave');
  if (family === 'chromium') return name.includes('chromium') && !name.includes('chrome');
  return name.includes('google chrome') || /(^|[\\/])chrome$/i.test(command);
}

export function pickBrowserPidFromProcessTree(
  processes: ProcessTableRow[],
  nativeHostPid: number,
  browserFamily = 'chrome',
): number | null {
  if (!Number.isInteger(nativeHostPid) || nativeHostPid <= 0) return null;
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  const seen = new Set<number>();
  let current = nativeHostPid;
  while (current && !seen.has(current)) {
    seen.add(current);
    const row = byPid.get(current);
    if (!row) break;
    if (commandMatchesBrowserFamily(row.command, browserFamily)) {
      return row.pid;
    }
    current = row.ppid;
  }
  return null;
}

async function readProcessTable(): Promise<ProcessTableRow[]> {
  const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'pid=', '-o', 'ppid=', '-o', 'comm='], { timeout: 8000 });
  return parseProcessTable(stdout);
}

async function focusMacProcess(pid: number): Promise<void> {
  const script = [
    'tell application "System Events"',
    `  set targetProcs to (every process whose unix id is ${pid})`,
    '  if (count of targetProcs) is 0 then error "plugin-bound browser process is not running"',
    '  set frontmost of item 1 of targetProcs to true',
    'end tell',
  ].join('\n');
  await execFileAsync('osascript', ['-e', script], { timeout: 12000 });
}

export async function ensureChromeOnXhsSearch(input?: {
  keyword?: string;
  profile?: string;
  url?: string;
}): Promise<ChromeNavigationResult> {
  const session = captureSession;
  const url = String(input?.url || session?.searchUrl || buildXhsSearchUrl(input?.keyword || session?.keyword || '')).trim();
  const instance = getBrowserCaptureBridgeService()?.getStatus().instances[0] || null;
  if (!instance) {
    return {
      ok: false,
      url,
      method: 'plugin-bound-focus',
      error: '未检测到已连接的 GardenFlow 插件。请先人工打开已登录小红书并启用采集插件的那个浏览器，不要靠进程名猜 Chrome。',
    };
  }
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      url,
      method: 'plugin-bound-focus',
      extensionInstanceId: instance.extensionInstanceId,
      nativeHostPid: instance.nativeHostPid,
      error: 'Focusing the plugin-bound browser is only available on macOS',
    };
  }
  const nativeHostPid = Number(instance.nativeHostPid || 0);
  if (!Number.isInteger(nativeHostPid) || nativeHostPid <= 0) {
    return {
      ok: false,
      url,
      method: 'plugin-bound-focus',
      extensionInstanceId: instance.extensionInstanceId,
      error: '插件已连接，但还没有 native host 进程号。请完全退出 GardenFlow 后重载插件再试。',
    };
  }
  try {
    const browserPid = pickBrowserPidFromProcessTree(
      await readProcessTable(),
      nativeHostPid,
      instance.browser || 'chrome',
    );
    if (!browserPid) {
      return {
        ok: false,
        url,
        method: 'plugin-bound-focus',
        extensionInstanceId: instance.extensionInstanceId,
        nativeHostPid,
        error: '插件已连接，但找不到它所属的浏览器进程。请确认采集插件所在的那个浏览器窗口还开着。',
      };
    }
    await focusMacProcess(browserPid);
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await execFileAsync('osascript', ['-e', 'tell application "System Events" to key code 53'], { timeout: 3000 });
    } catch {
      // Blurring the omnibox is best-effort; capture can continue if Escape is ignored.
    }
    return {
      ok: true,
      url,
      method: 'plugin-bound-focus',
      extensionInstanceId: instance.extensionInstanceId,
      nativeHostPid,
      browserPid,
      note: `Focused the browser process that owns the connected GardenFlow plugin (pid ${browserPid}). Did not pick a Chrome by process name.`,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      method: 'plugin-bound-focus',
      extensionInstanceId: instance.extensionInstanceId,
      nativeHostPid,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function maybeRewriteComputerUseNavigation(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ handled: false } | { handled: true; result: ChromeNavigationResult }> {
  if (!captureSession) return { handled: false };

  if (isComputerUseOpenUrlTool(toolName)) {
    const url = readMcpUrlArg(args) || captureSession.searchUrl;
    const result = await ensureChromeOnXhsSearch({ url, profile: captureSession.profile });
    return {
      handled: true,
      result: {
        ...result,
        rewritten: true,
        note: result.note
          || 'Rewrote computer_browser_open_url: focused the plugin-bound browser instead of Cmd+L or launching another Chrome.',
      },
    };
  }

  if (isComputerUseOpenProfileTool(toolName)) {
    const result = await ensureChromeOnXhsSearch({
      url: captureSession.searchUrl,
      profile: captureSession.profile,
    });
    return {
      handled: true,
      result: {
        ...result,
        rewritten: true,
        skippedOpenProfile: true,
        note: 'Skipped computer_browser_open_profile. Focused the already-connected plugin browser instead of launching another Chrome by process name.',
      },
    };
  }

  if (isNativeBrowserSaveShortcut(toolName, args)) {
    return {
      handled: true,
      result: {
        ok: false,
        url: captureSession.searchUrl,
        rewritten: true,
        blockedNativeSave: true,
        error: 'Blocked Chrome Save Page (Cmd+S). That downloads a tiny .html file and does not ingest into the knowledge base. Click the red 保存网页 button in the GardenFlow sidebar on the right. After a correct click the sidebar queue leaves 空闲 and a new log line appears.',
      },
    };
  }

  if (isOmniboxFocusShortcut(toolName, args)) {
    return {
      handled: true,
      result: {
        ok: false,
        url: captureSession.searchUrl,
        rewritten: true,
        blockedOmniboxShortcut: true,
        error: 'Blocked Cmd+L / Ctrl+L. Take a full window screenshot with grid, read the red axis numbers, and click the in-page search box — not the omnibox.',
      },
    };
  }

  if (isComputerUsePointerTool(toolName)) {
    const point = readClickPoint(args);
    if (point) {
      if (!captureSession.lastScreenshot) {
        return {
          handled: true,
          result: {
            ok: false,
            url: captureSession.searchUrl,
            rewritten: true,
            blockedBeforeLocate: true,
            error: locateBeforeClickError(),
          },
        };
      }
      if (isClickInBrowserChrome(point.y, captureSession.lastScreenshot)) {
        return {
          handled: true,
          result: {
            ok: false,
            url: captureSession.searchUrl,
            rewritten: true,
            blockedChromeClick: true,
            error: chromeClickError(point.y, captureSession.lastScreenshot),
          },
        };
      }
    }
  }

  return { handled: false };
}
