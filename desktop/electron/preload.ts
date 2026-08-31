import compatibility from '../shared/brandCompatibility.cjs';
import { contextBridge, ipcRenderer } from 'electron';

type RawListener = (...args: unknown[]) => void;

const listeners = new Map<string, Map<RawListener, (...args: unknown[]) => void>>();

const electronIpcTransport = {
  on(channel: string, listener: RawListener) {
    channel = compatibility.canonicalKey(channel);
    const wrapper = ((_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      listener(...args);
    }) as (...args: unknown[]) => void;

    if (!listeners.has(channel)) {
      listeners.set(channel, new Map());
    }
    listeners.get(channel)!.set(listener, wrapper);
    ipcRenderer.on(channel, wrapper);
  },
  off(channel: string, listener: RawListener) {
    channel = compatibility.canonicalKey(channel);
    const channelListeners = listeners.get(channel);
    const wrapper = channelListeners?.get(listener);
    if (!wrapper) return;
    ipcRenderer.off(channel, wrapper);
    channelListeners?.delete(listener);
    if (channelListeners && channelListeners.size === 0) {
      listeners.delete(channel);
    }
  },
  removeAllListeners(channel: string) {
    channel = compatibility.canonicalKey(channel);
    const channelListeners = listeners.get(channel);
    if (!channelListeners) return;
    for (const wrapper of channelListeners.values()) {
      ipcRenderer.off(channel, wrapper);
    }
    listeners.delete(channel);
  },
  send(channel: string, payload?: unknown) {
    channel = compatibility.canonicalKey(channel);
    ipcRenderer.send(channel, payload);
  },
  invoke(channel: string, payload?: unknown) {
    channel = compatibility.canonicalKey(channel);
    return ipcRenderer.invoke(channel, payload);
  },
};

contextBridge.exposeInMainWorld('__GARDENFLOW_ELECTRON_IPC__', electronIpcTransport);

for (const [legacy, current] of Object.entries(compatibility.identity.legacy.keys)) {
    if (current === '__GARDENFLOW_ELECTRON_IPC__') contextBridge.exposeInMainWorld(legacy, electronIpcTransport);
}
