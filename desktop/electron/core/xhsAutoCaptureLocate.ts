export const XHS_CAPTURE_CHROME_BAND_PT = 88;

export type CaptureScreenshotFrame = {
  originX: number;
  originY: number;
  scale: number;
  width: number;
  height: number;
  grid?: boolean;
  windowId?: number;
};

export type ClickPoint = {
  x: number;
  y: number;
};

function normalizeToolName(toolName: string): string {
  return String(toolName || '').trim().toLowerCase().replace(/_/g, '-');
}

export function isComputerUseScreenshotTool(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return normalized === 'computer-screenshot'
    || normalized === 'screenshot'
    || normalized === 'computer-window-screenshot'
    || normalized === 'window-screenshot';
}

export function isComputerUsePointerTool(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return normalized === 'computer-click'
    || normalized === 'click'
    || normalized === 'computer-double-click'
    || normalized === 'double-click'
    || normalized === 'computer-move'
    || normalized === 'move'
    || normalized === 'computer-drag'
    || normalized === 'drag';
}

export function readClickPoint(args: Record<string, unknown> | null | undefined): ClickPoint | null {
  if (!args || typeof args !== 'object') return null;
  const x = Number(args.x);
  const y = Number(args.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y };
  }
  return null;
}

export function chromeBandMaxClickY(frame?: CaptureScreenshotFrame | null): number {
  const scale = frame?.scale && frame.scale > 0 ? frame.scale : 1;
  const originY = Number.isFinite(frame?.originY) ? Number(frame?.originY) : 0;
  return (originY + XHS_CAPTURE_CHROME_BAND_PT) * scale;
}

export function isClickInBrowserChrome(
  y: number,
  frame?: CaptureScreenshotFrame | null,
): boolean {
  if (!Number.isFinite(y)) return false;
  return y < chromeBandMaxClickY(frame);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readFrameFromRecord(record: Record<string, unknown>): CaptureScreenshotFrame | null {
  const nested = asRecord(record.data);
  const source = nested && (nested.origin_x != null || nested.origin_y != null || nested.width != null || nested.path != null)
    ? nested
    : record;
  const path = String(source.path || '');
  const looksLikeShot = source.grid != null
    || source.window_id != null
    || source.origin_x != null
    || source.origin_y != null
    || /\.(png|jpe?g|webp)$/i.test(path);
  if (!looksLikeShot) return null;
  const width = Number(source.width);
  const height = Number(source.height);
  const scale = Number(source.scale);
  const originX = Number(source.origin_x ?? source.originX ?? 0);
  const originY = Number(source.origin_y ?? source.originY ?? 0);
  const hasSize = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  return {
    originX: Number.isFinite(originX) ? originX : 0,
    originY: Number.isFinite(originY) ? originY : 0,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    width: hasSize ? width : 0,
    height: hasSize ? height : 0,
    grid: Boolean(source.grid),
    windowId: Number.isFinite(Number(source.window_id)) ? Number(source.window_id) : undefined,
  };
}

export function readScreenshotFrame(value: unknown, depth = 0): CaptureScreenshotFrame | null {
  if (depth > 8 || value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      return readScreenshotFrame(JSON.parse(trimmed), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const frame = readScreenshotFrame(item, depth + 1);
      if (frame) return frame;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const direct = readFrameFromRecord(record);
  if (direct) return direct;
  for (const child of Object.values(record)) {
    const nested = readScreenshotFrame(child, depth + 1);
    if (nested) return nested;
  }
  return null;
}

export function locateBeforeClickError(): string {
  return '先对目标浏览器窗口做整窗截图（computer_screenshot，必须带 window_id 和 grid:true），看红轴数字标出本步坐标，再 click。不要盲点，也不要先点标签栏/地址栏。';
}

export function chromeClickError(y: number, frame?: CaptureScreenshotFrame | null): string {
  const maxY = chromeBandMaxClickY(frame);
  return `Blocked click y=${y}：落在 Chrome 标签栏/地址栏一带（本窗截图 y < ${Math.round(maxY)}）。请用同一张整窗 grid 截图的红轴数字，定位网页里的搜索框/笔记/侧栏按钮后再点。红轴数字已是 click 坐标，不要再加 list-windows 的窗口原点。`;
}
