interface ChatSendSchedulerHost {
    requestAnimationFrame?: (callback: () => void) => number;
    cancelAnimationFrame?: (id: number) => void;
    setTimeout: (callback: () => void, delay: number) => number;
    clearTimeout: (id: number) => void;
}

// Occluded Electron windows can pause animation frames. Sending must still reach
// the main process, while racing frame/timer callbacks must never send twice.
export function scheduleChatSend(work: () => void, host: ChatSendSchedulerHost): () => void {
    let settled = false;
    let frame: number | undefined;
    let timer: number | undefined;
    const cancel = () => {
        settled = true;
        if (frame !== undefined) host.cancelAnimationFrame?.(frame);
        if (timer !== undefined) host.clearTimeout(timer);
    };
    const dispatch = () => {
        if (settled) return;
        cancel(); work();
    };
    timer = host.setTimeout(dispatch, 150);
    frame = host.requestAnimationFrame?.(dispatch);
    return cancel;
}
