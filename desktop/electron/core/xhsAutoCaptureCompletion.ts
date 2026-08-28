export const XHS_AUTO_CAPTURE_TASK_ID = 'builtin:xhs-auto-capture';

export interface XhsAutoCaptureToolEvidence {
  toolName?: string;
  command?: string;
  success?: boolean;
  resultText?: string;
  createdAt?: number;
}

export interface XhsAutoCaptureCompletionInput {
  metadata?: Record<string, unknown> | null;
  toolResults?: XhsAutoCaptureToolEvidence[];
  assistantResponse?: string;
  sinceCreatedAt?: number;
}

export interface XhsAutoCaptureCompletionResult {
  applies: boolean;
  complete: boolean;
  captured: boolean;
  blocked: boolean;
  hasSaveClick: boolean;
  hasKnowledgeCheck: boolean;
  feedback?: string;
  maxRecoveryAttempts?: number;
  stopReason?: string;
}

const XHS_AUTO_CAPTURE_MAX_RECOVERY_ATTEMPTS = 8;

const INCOMPLETE_CAPTURE_FEEDBACK = [
  '小红书自动采集尚未完成：打开发现页、列窗口、截图、点搜索框、按回车，都不等于已经搜到。',
  '正确流程：点页内搜索框 → Cmd+A 清空 → 输入本轮关键词 → 截图确认框内就是该词 → 回车 → 截图确认已离开 /explore 进入搜索结果 → 点开笔记详情 → 点侧栏红色「保存笔记」→ 执行日志出现当前时间 → 点 X → knowledge list 出现新 id。',
  '若截图仍是 /explore 发现页，或搜索框里是别的占位词/旧搜索词，就是没搜到。不要写成已经搜索，也不要报登录墙结束。',
  '发现页上的「保存网页」和侧栏里更早的成功日志（例如 16:53）都不是本轮结果。',
  'knowledge list 必须相对开场基线出现新的笔记 id。',
  '只有截图里能看到登录表单/验证码/滑块时才可以因登录或风控停止；发现页信息流可见时继续搜索。',
].join('\n');

export function isXhsAutoCaptureTask(metadata?: Record<string, unknown> | null): boolean {
  if (!metadata) return false;
  return String(metadata.builtinTaskId || '').trim() === XHS_AUTO_CAPTURE_TASK_ID;
}

function commandHaystack(item: XhsAutoCaptureToolEvidence): string {
  return `${item.toolName || ''} ${item.command || ''}`.toLowerCase();
}

function hasSaveClickCommand(haystack: string): boolean {
  if (/\bcomputer_click\b/.test(haystack)) return true;
  if (/\bcomputer_mouse_click\b/.test(haystack)) return true;
  if (/--tool\s+(?:computer_)?(?:mouse_)?click\b/.test(haystack)) return true;
  if (/--tool\s+left_click\b/.test(haystack)) return true;
  if (/\bcomputer-use\s+click\b/.test(haystack)) return true;
  return false;
}

function hasKnowledgeListCommand(haystack: string): boolean {
  return /\bknowledge\s+list\b/.test(haystack);
}

function parseJsonValue(text: string): unknown | null {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf('{');
    if (start < 0) return null;
    try {
      return JSON.parse(trimmed.slice(start)) as unknown;
    } catch {
      return null;
    }
  }
}

function collectRedbookIds(value: unknown, into: string[], depth = 0): void {
  if (depth > 6 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectRedbookIds(item, into, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const redbook = record.redbook;
  if (Array.isArray(redbook)) {
    for (const item of redbook) {
      if (typeof item === 'string' && /^[a-f0-9]{16,}$/i.test(item.trim())) {
        into.push(item.trim());
      } else if (item && typeof item === 'object') {
        const id = String((item as Record<string, unknown>).id || '').trim();
        if (/^[a-f0-9]{16,}$/i.test(id)) into.push(id);
      }
    }
  }
  for (const child of Object.values(record)) {
    collectRedbookIds(child, into, depth + 1);
  }
}

export function extractRedbookIds(resultText?: string): string[] {
  const parsed = parseJsonValue(String(resultText || ''));
  if (parsed == null) return [];
  const ids: string[] = [];
  collectRedbookIds(parsed, ids);
  return [...new Set(ids)];
}

function knowledgeIdGrew(toolResults: XhsAutoCaptureToolEvidence[]): boolean {
  const snapshots: string[][] = [];
  for (const item of toolResults) {
    if (item.success === false) continue;
    if (!hasKnowledgeListCommand(commandHaystack(item))) continue;
    const ids = extractRedbookIds(item.resultText);
    if (ids.length > 0) snapshots.push(ids);
  }
  if (snapshots.length < 2) return false;
  const baseline = new Set(snapshots[0]);
  return snapshots.slice(1).some((ids) => ids.some((id) => !baseline.has(id)));
}

export function inspectXhsAutoCaptureToolEvidence(
  toolResults: XhsAutoCaptureToolEvidence[] = [],
  sinceCreatedAt?: number,
): { hasSaveClick: boolean; hasKnowledgeCheck: boolean; captured: boolean } {
  const scoped = Number.isFinite(sinceCreatedAt)
    ? toolResults.filter((item) => !item.createdAt || item.createdAt >= Number(sinceCreatedAt))
    : toolResults;
  let hasSaveClick = false;
  let hasKnowledgeCheck = false;
  for (const item of scoped) {
    if (item.success === false) continue;
    const haystack = commandHaystack(item);
    if (hasSaveClickCommand(haystack)) hasSaveClick = true;
    if (hasKnowledgeListCommand(haystack)) hasKnowledgeCheck = true;
  }
  return {
    hasSaveClick,
    hasKnowledgeCheck,
    captured: hasSaveClick && hasKnowledgeCheck && knowledgeIdGrew(scoped),
  };
}

function detectExplicitCaptureBlocker(assistantResponse?: string): { blocked: boolean; stopReason?: string } {
  const text = String(assistantResponse || '').trim();
  if (!text) return { blocked: false };
  const stillOnExplore = /\/explore|发现页|homefeed|信息流/.test(text);
  if (stillOnExplore) return { blocked: false };
  const hasCaptchaOrRisk = /验证码|滑块|风控/.test(text);
  const hasLoginForm = /登录表单|登录二维码|短信验证码/.test(text);
  const hasStop = /立即停止|无法继续|停止并报告|不要尝试绕过|绝不尝试绕过|需要用户.{0,24}(?:手动)?登录/.test(text);
  if ((hasCaptchaOrRisk || hasLoginForm) && hasStop) {
    return {
      blocked: true,
      stopReason: '采集因登录墙/验证码/风控停止，无法继续点击保存。',
    };
  }
  return { blocked: false };
}

export function validateXhsAutoCaptureCompletion(
  input: XhsAutoCaptureCompletionInput,
): XhsAutoCaptureCompletionResult | null {
  if (!isXhsAutoCaptureTask(input.metadata)) return null;

  const evidence = inspectXhsAutoCaptureToolEvidence(input.toolResults, input.sinceCreatedAt);
  if (evidence.captured) {
    return {
      applies: true,
      complete: true,
      blocked: false,
      ...evidence,
    };
  }

  const blocker = detectExplicitCaptureBlocker(input.assistantResponse);
  if (blocker.blocked) {
    return {
      applies: true,
      complete: true,
      blocked: true,
      ...evidence,
      stopReason: blocker.stopReason,
    };
  }

  return {
    applies: true,
    complete: false,
    blocked: false,
    ...evidence,
    maxRecoveryAttempts: XHS_AUTO_CAPTURE_MAX_RECOVERY_ATTEMPTS,
    feedback: INCOMPLETE_CAPTURE_FEEDBACK,
  };
}

export function applyXhsAutoCaptureCompletionGate<T extends {
  complete: boolean;
  feedback?: string;
  maxRecoveryAttempts?: number;
  terminalError?: string;
}>(
  base: T,
  capture: XhsAutoCaptureCompletionResult | null,
): T {
  if (!capture || capture.complete) {
    return base;
  }
  if (!base.complete) {
    return {
      ...base,
      maxRecoveryAttempts: Math.max(
        Number(base.maxRecoveryAttempts) || 0,
        capture.maxRecoveryAttempts || XHS_AUTO_CAPTURE_MAX_RECOVERY_ATTEMPTS,
        XHS_AUTO_CAPTURE_MAX_RECOVERY_ATTEMPTS,
      ),
    };
  }
  return {
    ...base,
    complete: false,
    feedback: capture.feedback,
    maxRecoveryAttempts: capture.maxRecoveryAttempts || XHS_AUTO_CAPTURE_MAX_RECOVERY_ATTEMPTS,
    terminalError: undefined,
  };
}

export function evaluateXhsAutoCaptureRun(input: XhsAutoCaptureCompletionInput): {
  applies: boolean;
  captured: boolean;
  blocked: boolean;
  failureMessage?: string;
  skipMessage?: string;
} {
  const result = validateXhsAutoCaptureCompletion(input);
  if (!result) {
    return { applies: false, captured: false, blocked: false };
  }
  if (result.captured) {
    return { applies: true, captured: true, blocked: false };
  }
  if (result.blocked) {
    return {
      applies: true,
      captured: false,
      blocked: true,
      skipMessage: result.stopReason,
    };
  }
  return {
    applies: true,
    captured: false,
    blocked: false,
    failureMessage: result.feedback || '内置采集未完成，不记为成功',
  };
}
