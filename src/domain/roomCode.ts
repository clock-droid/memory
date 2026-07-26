export function normalizeRoomCode(value: string) {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
}

export function createRoomCode() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `memo-${crypto.randomUUID().replace(/-/g, '')}`;
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return `memo-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  return `memo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
