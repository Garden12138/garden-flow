import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService';
import { XHS_AUTO_CAPTURE_TASK_ID } from './xhsAutoCaptureCompletion';
import { buildXhsSearchUrl } from './xhsAutoCaptureChrome';

/**
 * 内置自动化任务：定义在代码，状态在配置。
 *
 * 这里只描述“任务是什么、需要什么配置、就绪条件是什么、执行 prompt 怎么生成”，
 * 用户态（开关 / 频率覆盖 / 配置值 / 上次结果）由 redclawBackgroundRunner 持久化。
 */

export type BuiltinAutomationSettingFieldType = 'string' | 'string-list' | 'number' | 'select';

export interface BuiltinAutomationSettingField {
    key: string;
    label: string;
    type: BuiltinAutomationSettingFieldType;
    description?: string;
    placeholder?: string;
    required?: boolean;
    defaultValue: unknown;
    min?: number;
    max?: number;
    options?: Array<{ value: string; label: string }>;
}

export type BuiltinAutomationReadinessStatus = 'ok' | 'failed' | 'unknown';

export interface BuiltinAutomationReadinessCheck {
    id: string;
    label: string;
    status: BuiltinAutomationReadinessStatus;
    detail: string;
    hint?: string;
}

export interface BuiltinAutomationReadinessReport {
    taskId: string;
    ready: boolean;
    checkedAt: string;
    blockingReason: string;
    checks: BuiltinAutomationReadinessCheck[];
}

export interface BuiltinAutomationDefinition {
    id: string;
    name: string;
    description: string;
    supportedPlatforms: NodeJS.Platform[];
    documentationUrl?: string;
    defaultSchedule: { mode: 'daily'; time: string };
    /** 执行前强制激活的技能 */
    requiredSkills: string[];
    settingsSchema: BuiltinAutomationSettingField[];
    buildPrompt: (settings: Record<string, unknown>) => string;
    checkReadiness: (settings: Record<string, unknown>) => Promise<BuiltinAutomationReadinessReport>;
}

const XHS_AUTO_CAPTURE_ID = XHS_AUTO_CAPTURE_TASK_ID;

function nowIso(): string {
    return new Date().toISOString();
}

function textValue(value: unknown): string {
    return String(value ?? '').trim();
}

function toStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((item) => textValue(item)).filter(Boolean);
    }
    const raw = textValue(value);
    if (!raw) return [];
    return raw
        .split(/[,，\n|]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

const XHS_AUTO_CAPTURE_SETTINGS: BuiltinAutomationSettingField[] = [
    {
        key: 'keywords',
        label: '采集关键词',
        type: 'string-list',
        required: true,
        placeholder: '猫粮测评, 露营装备',
        description: '每轮从列表中轮换取一个关键词进行搜索采集；为空时任务无法开启。',
        defaultValue: [],
    },
    {
        key: 'maxNotesPerRun',
        label: '单轮最多保存笔记数',
        type: 'number',
        min: 1,
        max: 20,
        description: '越小越安全。默认 5 条。',
        defaultValue: 5,
    },
    {
        key: 'pacing',
        label: '采集节奏',
        type: 'select',
        options: [
            { value: 'conservative', label: '保守（推荐）' },
            { value: 'normal', label: '正常' },
        ],
        description: '相邻两条笔记之间的间隔节奏，保守节奏风控暴露面更小。',
        defaultValue: 'conservative',
    },
];

export function resolveXhsAutoCaptureLaunch(settings: Record<string, unknown>): {
    keyword: string;
    searchUrl: string;
    maxNotesPerRun: number;
    pacing: 'normal' | 'conservative';
} {
    const keywords = toStringList(settings.keywords);
    const keywordIndex = keywords.length > 0
        ? Math.floor(Date.now() / (24 * 60 * 60 * 1000)) % keywords.length
        : 0;
    const keyword = keywords[keywordIndex] || '';
    return {
        keyword,
        searchUrl: buildXhsSearchUrl(keyword),
        maxNotesPerRun: clampNumber(settings.maxNotesPerRun, 5, 1, 20),
        pacing: textValue(settings.pacing) === 'normal' ? 'normal' : 'conservative',
    };
}

function buildXhsAutoCapturePrompt(settings: Record<string, unknown>): string {
    const launch = resolveXhsAutoCaptureLaunch(settings);
    const keywords = toStringList(settings.keywords);

    return [
        '[RedClaw 内置自动化任务：小红书自动采集]',
        `任务ID: ${XHS_AUTO_CAPTURE_ID}`,
        '',
        '本轮参数：',
        `- 关键词: ${launch.keyword}`,
        `- 备选关键词: ${keywords.join(' / ') || '(无)'}`,
        `- 本轮最多保存笔记数: ${launch.maxNotesPerRun}`,
        `- 采集节奏(pacing): ${launch.pacing}`,
        '',
        '执行方式（由运行时结构化执行，无需模型操作键鼠）：',
        '1. 桌面让插件 research.run 在已登录浏览器里完成页内搜索，并在结果页内逐条点击打开笔记。',
        '2. 每条打开后调用 capture.save，走与侧栏「保存笔记」相同的 save-xhs / ingestXhsEntryV2 入库。',
        '3. 配额按新入库计：重复或仅更新旧笔记不占条数，未凑满时在同一结果页继续滚动翻页。',
        '4. 保存后关闭笔记回到结果页；插件检测到登录墙 / 安全验证时结构化上报，任务如实停止。',
        '5. 结束时输出结构化小结：关键词、尝试数、新入库数、重复数、失败原因。',
    ].join('\n');
}

async function checkXhsAutoCaptureReadiness(
    settings: Record<string, unknown>,
): Promise<BuiltinAutomationReadinessReport> {
    const checks: BuiltinAutomationReadinessCheck[] = [];

    const keywords = toStringList(settings.keywords);
    checks.push({
        id: 'keywords',
        label: '采集关键词',
        status: keywords.length > 0 ? 'ok' : 'failed',
        detail: keywords.length > 0 ? `已配置 ${keywords.length} 个关键词` : '未配置关键词',
        hint: keywords.length > 0 ? undefined : '请在任务配置中至少填写 1 个采集关键词。',
    });

    const bridgeInstances = getBrowserCaptureBridgeService()?.getStatus().instances || [];
    const bridgeOk = bridgeInstances.length > 0;
    checks.push({
        id: 'plugin-bridge',
        label: '浏览器插件桥接',
        status: bridgeOk ? 'ok' : 'failed',
        detail: bridgeOk ? `已连接 ${bridgeInstances.length} 个插件实例` : '未检测到已连接的 RedClaw 插件',
        hint: bridgeOk
            ? undefined
            : '请打开采集用的浏览器（已登录小红书并启用 RedClaw 插件），确认插件与 Bojin 的原生消息通道已连通。',
    });

    const accessProblem = bridgeInstances
        .map((instance) => instance.accessProblem)
        .find((problem) => problem?.code === 'BROWSER_LOGIN_REQUIRED' || problem?.code === 'BROWSER_SECURITY_CHALLENGE');
    checks.push({
        id: 'browser-login',
        label: '浏览器登录态',
        status: !bridgeOk ? 'unknown' : accessProblem ? 'failed' : 'ok',
        detail: !bridgeOk
            ? '未检测（插件未连接）'
            : accessProblem
                ? `插件上报 ${accessProblem.code}`
                : '插件未上报登录/风控问题',
        hint: accessProblem ? accessProblem.recovery || '请先在浏览器里完成登录或安全验证。' : undefined,
    });

    const blocking = checks.find((check) => check.status === 'failed');
    return {
        taskId: XHS_AUTO_CAPTURE_ID,
        ready: !blocking,
        checkedAt: nowIso(),
        blockingReason: blocking ? `${blocking.label}：${blocking.detail}` : '',
        checks,
    };
}

const BUILTIN_AUTOMATION_DEFINITIONS: BuiltinAutomationDefinition[] = [
    {
        id: XHS_AUTO_CAPTURE_ID,
        name: '小红书自动采集',
        description: '按关键词定时在已登录的浏览器里（通过 RedClaw 插件）页内搜索小红书、逐条打开笔记做 DOM 级提取，并按 noteId 去重入库。默认关闭。',
        supportedPlatforms: ['darwin', 'win32', 'linux'],
        defaultSchedule: { mode: 'daily', time: '10:00' },
        requiredSkills: ['xhs-auto-capture'],
        settingsSchema: XHS_AUTO_CAPTURE_SETTINGS,
        buildPrompt: buildXhsAutoCapturePrompt,
        checkReadiness: checkXhsAutoCaptureReadiness,
    },
];

export function listBuiltinAutomationDefinitions(): BuiltinAutomationDefinition[] {
    return BUILTIN_AUTOMATION_DEFINITIONS;
}

export function getBuiltinAutomationDefinition(taskId: string): BuiltinAutomationDefinition | null {
    const id = textValue(taskId);
    return BUILTIN_AUTOMATION_DEFINITIONS.find((item) => item.id === id) || null;
}

export function normalizeBuiltinTaskSettings(
    definition: BuiltinAutomationDefinition,
    raw: unknown,
): Record<string, unknown> {
    const input = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {};
    const normalized: Record<string, unknown> = {};

    for (const field of definition.settingsSchema) {
        const value = input[field.key];
        if (field.type === 'string-list') {
            const list = value === undefined ? toStringList(field.defaultValue) : toStringList(value);
            normalized[field.key] = list.slice(0, 50);
            continue;
        }
        if (field.type === 'number') {
            const fallback = Number(field.defaultValue) || 0;
            normalized[field.key] = clampNumber(
                value === undefined ? fallback : value,
                fallback,
                field.min ?? 0,
                field.max ?? Number.MAX_SAFE_INTEGER,
            );
            continue;
        }
        if (field.type === 'select') {
            const allowed = (field.options || []).map((option) => option.value);
            const text = textValue(value);
            normalized[field.key] = allowed.includes(text) ? text : textValue(field.defaultValue);
            continue;
        }
        const text = textValue(value);
        normalized[field.key] = text || textValue(field.defaultValue);
    }

    return normalized;
}

export function isBuiltinAutomationSupportedOnCurrentPlatform(
    definition: BuiltinAutomationDefinition,
): boolean {
    return definition.supportedPlatforms.includes(process.platform);
}
