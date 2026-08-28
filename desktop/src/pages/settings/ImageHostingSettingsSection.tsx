import { useMemo, useState } from 'react';
import { PasswordInput } from './shared';
import {
    getActiveImageHostingConfig,
    normalizeImageHostingSettings,
    serializeImageHostingSettings,
    updateActiveImageHostingSettings,
    type GithubPublicUrlStyle,
} from '../../features/settings/imageHostingModel';

type ImageHostingSettingsSectionProps = {
    value: string;
    onChange: (nextJson: string) => void;
};

export function ImageHostingSettingsSection({
    value,
    onChange,
}: ImageHostingSettingsSectionProps) {
    const settings = useMemo(() => normalizeImageHostingSettings(value), [value]);
    const active = getActiveImageHostingConfig(settings);
    const [testBusy, setTestBusy] = useState(false);
    const [testMessage, setTestMessage] = useState('');
    const [testUrl, setTestUrl] = useState('');

    const patchSettings = (patch: Parameters<typeof updateActiveImageHostingSettings>[1]) => {
        onChange(serializeImageHostingSettings(updateActiveImageHostingSettings(settings, patch)));
    };

    const handleTestUpload = async () => {
        setTestBusy(true);
        setTestMessage('');
        setTestUrl('');
        try {
            const result = await window.ipcRenderer.imageHosting.testUpload({
                image_hosting_json: serializeImageHostingSettings(settings),
            });
            if (result?.ok && result.publicUrl) {
                setTestUrl(result.publicUrl);
                setTestMessage('测试上传成功');
                return;
            }
            setTestMessage(result?.error || '测试上传失败');
        } catch (error) {
            setTestMessage(error instanceof Error ? error.message : String(error || '测试上传失败'));
        } finally {
            setTestBusy(false);
        }
    };

    return (
        <div className="pt-4 border-t border-border space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-medium text-text-primary">图床 / OSS</h3>
                    <p className="mt-1 text-[11px] text-text-tertiary">
                        生视频参考图需要公网 URL 时，会把本地图片上传到当前图床。目前先支持 GitHub。
                    </p>
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={settings.enabled}
                    aria-label="启用图床"
                    onClick={() => patchSettings({ enabled: !settings.enabled })}
                    className="ui-switch-track shrink-0"
                    data-size="lg"
                    data-state={settings.enabled ? 'on' : 'off'}
                >
                    <span className="ui-switch-thumb" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">图床类型</label>
                    <select
                        value="github"
                        disabled
                        className="w-full rounded border border-border bg-surface-secondary/30 px-3 py-2 text-sm text-text-secondary"
                    >
                        <option value="github">GitHub</option>
                        <option value="aliyun-oss" disabled>阿里云 OSS（即将支持）</option>
                        <option value="tencent-cos" disabled>腾讯云 COS（即将支持）</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        图床配置名 <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={active.name}
                        onChange={(event) => patchSettings({ name: event.target.value })}
                        placeholder="例如：ai"
                        className="w-full rounded border border-border bg-surface-secondary/30 px-3 py-2 text-sm transition-colors focus:border-accent-primary focus:outline-none"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        设定仓库名 <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={active.github.repo}
                        onChange={(event) => patchSettings({ github: { repo: event.target.value } })}
                        placeholder="owner/repo，例如 Garden12138/picbed-cloud"
                        className="w-full rounded border border-border bg-surface-secondary/30 px-3 py-2 text-sm transition-colors focus:border-accent-primary focus:outline-none"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        设定分支名 <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={active.github.branch}
                        onChange={(event) => patchSettings({ github: { branch: event.target.value } })}
                        placeholder="main"
                        className="w-full rounded border border-border bg-surface-secondary/30 px-3 py-2 text-sm transition-colors focus:border-accent-primary focus:outline-none"
                    />
                </div>
                <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        设定 Token <span className="text-red-500">*</span>
                    </label>
                    <PasswordInput
                        value={active.github.token}
                        onChange={(event) => patchSettings({ github: { token: event.target.value } })}
                        placeholder="GitHub Personal Access Token"
                        className="w-full rounded border border-border bg-surface-secondary/30 px-3 py-2 text-sm transition-colors focus:border-accent-primary focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-text-tertiary">
                        Classic Token 需要 repo 或 public_repo；Fine-grained Token 需要 Contents: Read and write。
                    </p>
                </div>
                <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">设定存储路径</label>
                    <input
                        type="text"
                        value={active.github.pathPrefix}
                        onChange={(event) => patchSettings({ github: { pathPrefix: event.target.value } })}
                        placeholder="例如：ai/"
                        className="w-full rounded border border-border bg-surface-secondary/30 px-3 py-2 text-sm transition-colors focus:border-accent-primary focus:outline-none"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">公开访问方式</label>
                    <select
                        value={active.github.publicUrlStyle}
                        onChange={(event) => patchSettings({
                            github: { publicUrlStyle: event.target.value as GithubPublicUrlStyle },
                        })}
                        className="w-full rounded border border-border bg-surface-secondary/30 px-3 py-2 text-sm transition-colors focus:border-accent-primary focus:outline-none"
                    >
                        <option value="jsdmirror">jsDelivr 国内镜像（推荐，阿里云可拉）</option>
                        <option value="jsdelivr">jsDelivr 官方（阿里云常报 Model not exist）</option>
                        <option value="raw">GitHub Raw（海外，阿里云常拉不下来）</option>
                    </select>
                    <p className="mt-1 text-[11px] text-text-tertiary">
                        仓库需公开。阿里云生视频会去下载这张图，请用国内镜像，不要用官方 jsDelivr 或 GitHub Raw。
                    </p>
                </div>
                <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">设定自定义域名</label>
                    <input
                        type="text"
                        value={active.github.customDomain}
                        onChange={(event) => patchSettings({ github: { customDomain: event.target.value } })}
                        placeholder="例如：https://img.example.com"
                        className="w-full rounded border border-border bg-surface-secondary/30 px-3 py-2 text-sm transition-colors focus:border-accent-primary focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-text-tertiary">
                        填写后优先使用自定义域名；需保证阿里云也能访问。
                    </p>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => void handleTestUpload()}
                    disabled={testBusy}
                    className="inline-flex items-center rounded border border-border px-3 py-1.5 text-xs hover:bg-surface-secondary transition-colors disabled:opacity-50"
                >
                    {testBusy ? '上传中…' : '测试上传'}
                </button>
                {testMessage && (
                    <span className={testUrl ? 'text-xs text-text-secondary' : 'text-xs text-red-500'}>
                        {testMessage}
                    </span>
                )}
            </div>
            {testUrl && (
                <p className="break-all text-[11px] text-text-tertiary">{testUrl}</p>
            )}
        </div>
    );
}
