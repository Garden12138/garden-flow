import compatibility from '../brandCompatibility.cjs';

export function normalizeRuntimeMessage(message) {
  if (!message || typeof message !== 'object') return message;
  const result = { ...message };
  for (const field of ['type', 'method', 'action']) {
    if (typeof result[field] === 'string') result[field] = compatibility.canonicalKey(result[field]);
  }
  return result;
}

// Translate only the wire envelope. Existing sender, origin and permission checks
// still receive the original sender and run once in the original handler.
export function installRuntimeAliases(runtime) {
  const event = runtime?.onMessage;
  if (!event) return;
  const add = event.addListener.bind(event);
  const remove = event.removeListener.bind(event);
  const has = event.hasListener.bind(event);
  const listeners = new WeakMap();
  event.addListener = listener => {
    if (!listeners.has(listener)) listeners.set(listener, (message, sender, respond) => listener(normalizeRuntimeMessage(message), sender, respond));
    add(listeners.get(listener));
  };
  event.removeListener = listener => remove(listeners.get(listener) || listener);
  event.hasListener = listener => has(listeners.get(listener) || listener);
}

if (typeof chrome !== 'undefined') installRuntimeAliases(chrome.runtime);
