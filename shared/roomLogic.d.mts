import type { Card, Deck, Section } from '../src/domain/types';

export type RoomData = {
  revision: number;
  decks: Deck[];
  cardsByDeck: Record<string, Card[]>;
  sectionsByDeck: Record<string, Section[]>;
};

export type RoomRequestResult = {
  status: number;
  body: unknown;
  write: boolean;
};

export function emptyRoom(): RoomData;
export function ensureRoom(room: Partial<RoomData>): RoomData;
export function applyRoomRequest(input: {
  room: RoomData;
  method: string;
  parts: string[];
  body: Record<string, unknown>;
}): RoomRequestResult;
