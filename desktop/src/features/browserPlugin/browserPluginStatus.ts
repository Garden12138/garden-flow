export type BrowserPluginProblem = {
    code: string;
    message: string;
    recovery: string;
};

export type BrowserPluginStatus = {
    success?: boolean;
    bundled: boolean;
    exported: boolean;
    exportPath: string;
    bridge?: {
        listening: boolean;
        protocolVersion: number;
    };
    nativeHost?: {
        installedTargets: Array<{ id: string; label: string }>;
        staleTargets: Array<{ id: string; label: string }>;
    };
    extension?: {
        connected: boolean;
        instances: Array<{
            extensionInstanceId: string;
            browser: string;
            accessProblem?: BrowserPluginProblem & { platform?: string; origin?: string };
        }>;
    };
    problems?: BrowserPluginProblem[];
};

export function describeBrowserPluginStatus(status: BrowserPluginStatus | null): {
    label: string;
    tone: 'success' | 'warning' | 'muted';
    detail: string;
} {
    if (!status) {
        return { label: '正在检查', tone: 'muted', detail: '正在读取插件和 Native Bridge 状态' };
    }
    const accessProblem = status.problems?.find((problem) => [
        'BROWSER_LOGIN_REQUIRED',
        'BROWSER_SECURITY_CHALLENGE',
        'CONTENT_NOT_ACCESSIBLE',
    ].includes(problem.code));
    if (accessProblem) {
        return { label: accessProblem.message, tone: 'warning', detail: accessProblem.recovery };
    }
    if (status.extension?.connected) {
        const browsers = Array.from(new Set(status.extension.instances.map((item) => item.browser).filter(Boolean)));
        return {
            label: '采集插件已连接',
            tone: 'success',
            detail: browsers.length > 0 ? `已连接：${browsers.join('、')}` : '可以从浏览器保存当前可见内容',
        };
    }
    const primaryProblem = status.problems?.[0];
    if (primaryProblem) {
        return { label: primaryProblem.message, tone: 'warning', detail: primaryProblem.recovery };
    }
    return { label: '等待浏览器连接', tone: 'muted', detail: '在浏览器扩展页加载导出的插件目录' };
}
