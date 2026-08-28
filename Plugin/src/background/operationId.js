let operationSequence = 0;

function normalizeOperationPart(value) {
  return String(value || '').trim();
}

function hashOperationFingerprint(value) {
  let hash = 2166136261;
  const input = String(value || '');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createOperationNonce() {
  operationSequence = (operationSequence + 1) % Number.MAX_SAFE_INTEGER;
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint32Array(2);
    globalThis.crypto.getRandomValues(bytes);
    return `${bytes[0].toString(36)}-${bytes[1].toString(36)}-${operationSequence.toString(36)}`;
  }
  return `${Date.now().toString(36)}-${operationSequence.toString(36)}`;
}

export function createBridgeOperationId(scope, payload = {}) {
  const explicitOperationId = normalizeOperationPart(payload?.operationId);
  const normalizedScope = normalizeOperationPart(scope).replace(/[^A-Za-z0-9._-]/g, '-') || 'desktop';
  if (explicitOperationId) {
    return `${normalizedScope}:${hashOperationFingerprint(explicitOperationId)}:retry`;
  }
  const stableSource = normalizeOperationPart(
    payload?.id
    || payload?.entryId
    || payload?.note?.noteId
    || payload?.source?.externalId
    || payload?.source?.sourceLink
    || payload?.source?.sourceUrl,
  );
  const fingerprint = stableSource || JSON.stringify(payload || {});
  return `${normalizedScope}:${hashOperationFingerprint(fingerprint)}:${createOperationNonce()}`;
}
