import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../workbench/useDialogFocus';

type ConsentRequest = {
    resolve: (proceed: boolean) => void;
    applying: boolean;
};

type DialogState = {
    address: string;
    error?: string;
    applying?: boolean;
};

function normalizeAddress(input: string): string {
    const trimmed = input.trim();
    const address = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const url = new URL(address);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('请输入 HTTP 或 HTTPS 代理地址。');
    return address;
}

function ProxyConsentDialog({ state, onAddress, onEnable, onDirect, onCancel }: {
    state: DialogState;
    onAddress: (address: string) => void;
    onEnable: () => void;
    onDirect: () => void;
    onCancel: () => void;
}) {
    const ref = useDialogFocus(onCancel);
    return createPortal(
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
            <section ref={ref} role="dialog" aria-modal="true" aria-label="开启网络代理？"
                className="w-full max-w-md rounded-2xl border border-border bg-surface-primary shadow-2xl">
                <form onSubmit={event => { event.preventDefault(); onEnable(); }}>
                    <div className="space-y-3 px-5 py-4">
                        <h2 className="text-sm font-semibold text-text-primary">开启网络代理？</h2>
                        <p className="text-sm leading-6 text-text-secondary">xcli 可能需要代理访问模型服务。启用后，地址会保存为 GardenFlow 的全局代理，也会用于其他外部 AI 和素材请求。</p>
                        <label className="block text-sm text-text-primary">
                            代理地址
                            <input className="mt-1 block w-full rounded-lg border border-border bg-surface-primary px-3 py-2"
                                value={state.address} onChange={event => onAddress(event.target.value)}
                                placeholder="http://主机:端口" disabled={state.applying} />
                        </label>
                        {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
                        <button type="button" className="workspace-secondary-button" onClick={onCancel} disabled={state.applying}>取消</button>
                        <button type="button" className="workspace-secondary-button" onClick={onDirect} disabled={state.applying}>继续直连</button>
                        <button type="submit" className="workspace-primary-button" disabled={state.applying || !state.address.trim()}>
                            {state.applying ? '正在启用…' : '启用并继续'}
                        </button>
                    </div>
                </form>
            </section>
        </div>,
        document.body,
    );
}

export function useXcliProxyConsent(isActive: boolean) {
    const pending = useRef<ConsentRequest | null>(null);
    const [dialog, setDialog] = useState<DialogState | null>(null);

    const finish = useCallback((request: ConsentRequest, proceed: boolean) => {
        if (pending.current !== request) return;
        pending.current = null;
        setDialog(null);
        request.resolve(proceed);
    }, []);

    const confirmProxy = useCallback((): Promise<boolean> => {
        if (!isActive || pending.current) return Promise.resolve(false);

        return new Promise(resolve => {
            const request = { resolve, applying: false };
            pending.current = request;
            void window.ipcRenderer.getSettings().then(settings => {
                if (pending.current !== request) return;
                const address = settings?.proxy_url?.trim() || '';
                if (settings?.proxy_enabled && address) finish(request, true);
                else setDialog({ address });
            }).catch(() => {
                if (pending.current === request) setDialog({ address: '', error: '无法读取已保存的代理地址。' });
            });
        });
    }, [finish, isActive]);

    useEffect(() => {
        if (!isActive) {
            setDialog(null);
            return;
        }
        return () => {
            const request = pending.current;
            pending.current = null;
            request?.resolve(false);
        };
    }, [isActive]);

    const enable = async () => {
        const request = pending.current;
        if (!request || request.applying || !dialog?.address.trim()) return;
        let address: string;
        try {
            address = normalizeAddress(dialog.address);
        } catch {
            setDialog({ ...dialog, error: '请输入有效的 HTTP 或 HTTPS 代理地址。' });
            return;
        }
        request.applying = true;
        setDialog({ address: dialog.address, applying: true });
        try {
            await window.ipcRenderer.saveSettings({ proxy_enabled: true, proxy_url: address });
            finish(request, true);
        } catch {
            request.applying = false;
            if (pending.current === request) setDialog({ address: dialog.address, error: '应用代理失败，请检查地址后重试。' });
        }
    };

    const decide = (proceed: boolean) => {
        const request = pending.current;
        if (request && !request.applying) finish(request, proceed);
    };

    return {
        confirmProxy,
        proxyDialog: isActive && dialog ? <ProxyConsentDialog state={dialog}
            onAddress={address => setDialog({ address })}
            onEnable={() => void enable()} onDirect={() => decide(true)} onCancel={() => decide(false)} /> : null,
    };
}
