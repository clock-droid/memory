import { DEVICE_STORE_KEY, ROOM_KEY, STORAGE_KEY } from '../constants';
import { normalizeRoomCode } from '../domain/roomCode';

export type StorageSelection =
  | { kind: 'device'; key: string }
  | { kind: 'account' }
  | { kind: 'legacy'; roomCode: string };

export type RepositoryTarget =
  | { kind: 'device'; key: string }
  | { kind: 'account'; userId: string }
  | { kind: 'legacy'; roomCode: string };

export function readStorageSelection(storage: Pick<Storage, 'getItem'> = localStorage): StorageSelection | null {
  const saved = storage.getItem(STORAGE_KEY);
  if (saved === 'device') return { kind: 'device', key: DEVICE_STORE_KEY };
  if (saved === 'account') return { kind: 'account' };
  if (saved?.startsWith('legacy:')) {
    const roomCode = normalizeRoomCode(saved.slice('legacy:'.length));
    if (roomCode) return { kind: 'legacy', roomCode };
  }

  // Existing installations used only ROOM_KEY. Preserve their current data
  // source without making them choose again after this upgrade.
  const legacyRoomCode = normalizeRoomCode(storage.getItem(ROOM_KEY) ?? '');
  return legacyRoomCode ? { kind: 'legacy', roomCode: legacyRoomCode } : null;
}

export function writeStorageSelection(
  selection: StorageSelection,
  storage: Pick<Storage, 'setItem'> = localStorage,
) {
  if (selection.kind === 'legacy') {
    storage.setItem(ROOM_KEY, selection.roomCode);
    storage.setItem(STORAGE_KEY, `legacy:${selection.roomCode}`);
    return;
  }
  storage.setItem(STORAGE_KEY, selection.kind);
}
