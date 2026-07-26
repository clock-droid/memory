import { describe, expect, it } from 'vitest';
import { createRoomCode, normalizeRoomCode } from './roomCode';

describe('room codes', () => {
  it('creates an opaque 128-bit room capability', () => {
    expect(createRoomCode()).toMatch(/^memo-[a-f0-9]{32}$/);
  });

  it('keeps legacy room codes readable while stripping unsupported characters', () => {
    expect(normalizeRoomCode(' old-room_2026! ')).toBe('old-room_2026');
  });
});
