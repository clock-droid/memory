export function normalizeRoomCode(value: string) {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
}

export function createRoomCode() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `memo-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `memo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
