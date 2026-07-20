/**
 * Client-minted ids that make a retried write idempotent: the server rewrites
 * the same resource instead of creating a duplicate.
 */
export function newOperationId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Stable short hash, so retrying the same payload reuses one operation id. */
export function contentFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
