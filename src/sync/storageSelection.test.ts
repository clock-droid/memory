import { describe, expect, it } from 'vitest';
import { DEVICE_STORE_KEY, ROOM_KEY, STORAGE_KEY } from '../constants';
import { readStorageSelection, writeStorageSelection } from './storageSelection';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('storage selection', () => {
  it('keeps existing room-code installations on their current data', () => {
    const storage = memoryStorage({ [ROOM_KEY]: 'old-room' });
    expect(readStorageSelection(storage)).toEqual({ kind: 'legacy', roomCode: 'old-room' });
  });

  it('prefers an explicit device choice over a remembered legacy room', () => {
    const storage = memoryStorage({ [ROOM_KEY]: 'old-room', [STORAGE_KEY]: 'device' });
    expect(readStorageSelection(storage)).toEqual({ kind: 'device', key: DEVICE_STORE_KEY });
  });

  it('persists a legacy choice and its compatibility key together', () => {
    const storage = memoryStorage();
    writeStorageSelection({ kind: 'legacy', roomCode: 'next-room' }, storage);
    expect(storage.getItem(STORAGE_KEY)).toBe('legacy:next-room');
    expect(storage.getItem(ROOM_KEY)).toBe('next-room');
  });
});
