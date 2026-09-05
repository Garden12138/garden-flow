import fs from 'node:fs/promises';
import path from 'node:path';
import { app, shell } from 'electron';
import {
  getDebugLogDirectory,
  getRecentDebugLogs,
  isDebugLoggingEnabled,
  logDebugEvent,
} from './debugLogger';

export interface DiagnosticReport {
  id: string;
  trigger: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  summary: string;
  includeAdvancedContext: boolean;
  bundleFileName?: string | null;
  metadata?: unknown;
}

type FeedbackReportPayload = {
  title?: string;
  content?: string;
  category?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  source?: string;
  contact?: string;
  includeAdvancedContext?: boolean;
  context?: Record<string, unknown>;
};

type AutoReportPayload = {
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  category?: string;
  event?: string;
  message?: string;
  fields?: unknown;
  trigger?: string;
};

function reportsRoot(): string {
  return path.join(app.getPath('userData'), 'diagnostic-reports');
}

function recordsDir(): string {
  return path.join(reportsRoot(), 'records');
}

function exportDir(): string {
  return path.join(reportsRoot(), 'exports');
}

function slug(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'report';
}

function reportPath(reportId: string): string {
  return path.join(recordsDir(), `${slug(reportId)}.json`);
}

async function ensureReportDirs(): Promise<void> {
  await fs.mkdir(recordsDir(), { recursive: true });
  await fs.mkdir(exportDir(), { recursive: true });
}

const MAX_REPORTS = 40;
const MAX_TEXT_CHARS = 4_000;
const SENSITIVE_KEY_PATTERN = /authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|access[_-]?key|refresh|html|markdown|body|page[_-]?(?:content|text)|raw[_-]?(?:content|html)|attachment|base64|binary|blob/i;

function redactText(value: unknown, maxChars = MAX_TEXT_CHARS): string {
  return String(value ?? '')
    .replace(/data:(?:image|audio|video)\/[\w.+-]+;base64,[^\s]+/gi, '[REDACTED_DATA_URI]')
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED_SECRET]')
    .replace(/([?&](?:token|access_token|refresh_token|api_key|apikey|secret|signature)=)[^&\s]+/gi, '$1[REDACTED_SECRET]')
    .replace(/((?:api[_-]?key|token|secret|password|cookie|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED_SECRET]')
    .replace(/(?:[A-Za-z]:\\|\/Users\/|\/home\/|\/var\/folders\/)[^\s,;"']+/g, '[REDACTED_PATH]')
    .slice(0, maxChars);
}

function sanitizeValue(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED_SENSITIVE_FIELD]';
  if (depth > 4) return '[TRUNCATED]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeValue(item, key, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 60)
        .map(([childKey, childValue]) => [childKey, sanitizeValue(childValue, childKey, depth + 1)]),
    );
  }
  return redactText(value);
}

function sanitizedLogs(limit: number): string[] {
  return getRecentDebugLogs(limit).map((line) => redactText(line, 8_000));
}

function nowIso(): string {
  return new Date().toISOString();
}

function summarize(value: string, fallback: string): string {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return fallback;
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

async function readReport(filePath: string): Promise<DiagnosticReport | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as DiagnosticReport;
    return parsed && typeof parsed.id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

async function writeReport(report: DiagnosticReport): Promise<DiagnosticReport> {
  await ensureReportDirs();
  await fs.writeFile(reportPath(report.id), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const entries = await fs.readdir(recordsDir(), { withFileTypes: true });
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map(async (entry) => ({
      path: path.join(recordsDir(), entry.name),
      modifiedAt: (await fs.stat(path.join(recordsDir(), entry.name))).mtimeMs,
    })));
  const stale = files.sort((left, right) => right.modifiedAt - left.modifiedAt).slice(MAX_REPORTS);
  await Promise.all(stale.map((entry) => fs.rm(entry.path, { force: true })));
  return report;
}

export async function getDiagnosticsLogStatus() {
  await ensureReportDirs();
  const records = await listDiagnosticReports();
  return {
    enabled: true,
    logDirectory: getDebugLogDirectory(),
    reportDirectory: reportsRoot(),
    retentionDays: 7,
    maxFileMb: 10,
    recentPreviewLimit: 200,
    recordCount: records.length,
    debugVerboseEnabled: isDebugLoggingEnabled(),
    previousUncleanShutdown: false,
  };
}

export function getRecentDiagnosticsLogs(limit = 200) {
  return {
    lines: sanitizedLogs(Number.isFinite(limit) ? Math.max(1, Math.min(limit, 1000)) : 200),
  };
}

export async function openDiagnosticsReportDirectory(): Promise<{ success: boolean; error?: string; path: string }> {
  await ensureReportDirs();
  const targetDir = reportsRoot();
  try {
    const result = await shell.openPath(targetDir);
    if (result) return { success: false, error: result, path: targetDir };
    return { success: true, path: targetDir };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      path: targetDir,
    };
  }
}

export async function listDiagnosticReports(): Promise<DiagnosticReport[]> {
  await ensureReportDirs();
  const entries = await fs.readdir(recordsDir(), { withFileTypes: true }).catch(() => []);
  const reports = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => readReport(path.join(recordsDir(), entry.name))),
  );
  return reports
    .filter((report): report is DiagnosticReport => Boolean(report))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export async function createFeedbackReport(payload: FeedbackReportPayload) {
  const content = redactText(payload?.content || payload?.title || '').trim();
  if (!content) {
    return { success: false, error: 'content is required' };
  }

  const createdAt = nowIso();
  const id = `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const includeAdvancedContext = Boolean(payload.includeAdvancedContext);
  const report: DiagnosticReport = {
    id,
    trigger: 'manual-feedback',
    status: 'saved',
    createdAt,
    updatedAt: createdAt,
    summary: summarize(payload.title || content, '用户反馈'),
    includeAdvancedContext,
    bundleFileName: null,
    metadata: {
      kind: 'feedback',
      title: redactText(payload.title || '').trim(),
      content,
      category: payload.category || 'desktop_bug',
      priority: payload.priority || 'medium',
      source: payload.source || 'desktop',
      contact: redactText(payload.contact || '', 320).trim(),
      context: sanitizeValue(payload.context || {}),
      recentLogs: sanitizedLogs(includeAdvancedContext ? 300 : 120),
    },
  };
  await writeReport(report);
  logDebugEvent('diagnostics', 'info', 'feedback report created', { reportId: id, summary: report.summary });
  return { success: true, report };
}

export async function createAutoDiagnosticReport(payload?: AutoReportPayload) {
  const message = String(payload?.message || payload?.event || '').trim();
  if (!message) {
    return { success: false, error: 'message is required' };
  }

  const trigger = String(payload?.trigger || 'renderer_error').trim() || 'renderer_error';
  const category = String(payload?.category || 'renderer').trim() || 'renderer';
  const event = String(payload?.event || 'renderer.error').trim() || 'renderer.error';
  const level = String(payload?.level || 'error').trim() || 'error';
  const title = `${event}: ${summarize(message, 'Renderer error')}`;
  return createFeedbackReport({
    title,
    content: message,
    category: 'desktop_bug',
    priority: level === 'error' ? 'high' : 'medium',
    source: 'renderer-auto',
    includeAdvancedContext: false,
    context: {
      kind: 'auto-renderer-report',
      trigger,
      category,
      event,
      level,
      fields: payload?.fields ?? null,
    },
  });
}

export async function exportDiagnosticBundle(reportId?: string, payload?: { includeAdvancedContext?: boolean }) {
  await ensureReportDirs();
  const targetId = String(reportId || '').trim();
  const includeAdvancedContext = Boolean(payload?.includeAdvancedContext);
  let report: DiagnosticReport | null = null;

  if (targetId) {
    report = await readReport(reportPath(targetId));
    if (!report) return { success: false, reportId: targetId, path: '', error: 'Report not found' };
  }

  const exportedAt = nowIso();
  const exportId = targetId || `manual-${Date.now()}`;
  const exportPath = path.join(exportDir(), `${slug(exportId)}.json`);
  const bundle = {
    exportedAt,
    reportId: exportId,
    report,
    includeAdvancedContext,
    recentLogs: sanitizedLogs(includeAdvancedContext ? 500 : 200),
  };
  await fs.writeFile(exportPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');

  if (report) {
    report.bundleFileName = path.basename(exportPath);
    report.updatedAt = exportedAt;
    await writeReport(report);
  }

  return { success: true, reportId: exportId, path: exportPath };
}

export async function dismissDiagnosticReport(reportId: string) {
  const targetId = String(reportId || '').trim();
  if (!targetId) return { success: false, reportId: '', error: 'reportId is required' };
  await fs.rm(reportPath(targetId), { force: true });
  return { success: true, reportId: targetId };
}

export function appendRendererDiagnosticLog(payload?: {
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  category?: string;
  event?: string;
  message?: string;
  fields?: unknown;
}) {
  const level = payload?.level === 'error' ? 'error' : payload?.level === 'warn' ? 'warn' : 'info';
  const category = String(payload?.category || 'renderer').trim() || 'renderer';
  const event = String(payload?.event || 'event').trim() || 'event';
  const message = String(payload?.message || event);
  logDebugEvent(category, level, redactText(message), sanitizeValue(payload?.fields));
  return { success: true };
}
