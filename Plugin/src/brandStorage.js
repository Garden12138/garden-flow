import compatibility from '../brandCompatibility.cjs';

export async function migrateChromeStorage(storage) {
  const values = await storage.get(null);
  const patch = {};
  for (const [key, value] of Object.entries(values)) {
    const target = compatibility.canonicalKey(key);
    if (target !== key && !Object.hasOwn(values, target)) patch[target] = compatibility.migrateStructured(value);
  }
  if (Object.keys(patch).length) await storage.set(patch);
}

if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  const storage = chrome.storage.local;
  const original = { get: storage.get.bind(storage), set: storage.set.bind(storage) };
  const ready = migrateChromeStorage(original);
  storage.get = (keys, callback) => {
    const pending = ready.then(() => original.get(keys));
    if (callback) { void pending.then(callback); return; }
    return pending;
  };
  storage.set = (items, callback) => {
    const pending = ready.then(() => original.set(items));
    if (callback) { void pending.then(callback); return; }
    return pending;
  };
}
