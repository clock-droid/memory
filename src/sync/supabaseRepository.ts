import { hideMastery, hideSchedules } from '../domain/hides';
import type { Card, Deck, NewCard, Section } from '../domain/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyRoomRequest, emptyRoom, ensureRoom } from '../../shared/roomLogic.mjs';
import type { RoomData } from '../../shared/roomLogic.mjs';
import type { Repository } from './repository';
import { supabase } from './supabaseClient';

type AccountRoomRow = {
  user_id: string;
  revision: number;
  room: RoomData;
};

type Listener<T> = {
  callback: (items: T[]) => void;
  onError?: (error: Error) => void;
};

const MAX_WRITE_ATTEMPTS = 5;

class AccountRoomError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'AccountRoomError';
  }
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error('Account sync failed');
}

function normalizeRow(row: AccountRoomRow): AccountRoomRow {
  const revision = Number(row.revision) || 0;
  const room = ensureRoom(structuredClone(row.room ?? emptyRoom()));
  room.revision = revision;
  return { ...row, revision, room };
}

/**
 * One private, revisioned room per Supabase account.
 *
 * The room payload intentionally keeps the already-proven card/section shape.
 * Postgres supplies ownership (RLS), compare-and-swap writes and realtime
 * invalidation; the shared room reducer keeps validation and hide-level fields
 * identical to the legacy sync endpoint.
 */
export function createSupabaseRepository(
  userId: string,
  requestedClient: SupabaseClient | null = supabase,
): Repository | null {
  const client = requestedClient;
  if (!client || !userId) return null;

  const deckListeners = new Set<Listener<Deck>>();
  const cardListeners = new Map<string, Set<Listener<Card>>>();
  const sectionListeners = new Map<string, Set<Listener<Section>>>();
  let current: AccountRoomRow | null = null;
  let refreshPromise: Promise<AccountRoomRow> | null = null;
  let channel: ReturnType<typeof client.channel> | null = null;

  const listenerCount = () => deckListeners.size
    + [...cardListeners.values()].reduce((sum, listeners) => sum + listeners.size, 0)
    + [...sectionListeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);

  const emit = () => {
    if (!current) return;
    const { room } = current;
    deckListeners.forEach(({ callback }) => callback(room.decks));
    cardListeners.forEach((listeners, deckId) => {
      const cards = room.cardsByDeck[deckId] ?? [];
      listeners.forEach(({ callback }) => callback(cards));
    });
    sectionListeners.forEach((listeners, deckId) => {
      const sections = room.sectionsByDeck[deckId] ?? [];
      listeners.forEach(({ callback }) => callback(sections));
    });
  };

  const notifyError = (value: unknown) => {
    const error = asError(value);
    deckListeners.forEach(({ onError }) => onError?.(error));
    cardListeners.forEach((listeners) => listeners.forEach(({ onError }) => onError?.(error)));
    sectionListeners.forEach((listeners) => listeners.forEach(({ onError }) => onError?.(error)));
  };

  const selectRow = async (): Promise<AccountRoomRow | null> => {
    const { data, error } = await client
      .from('account_rooms')
      .select('user_id, revision, room')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ? normalizeRow(data as AccountRoomRow) : null;
  };

  const readOrCreateRow = async (): Promise<AccountRoomRow> => {
    const existing = await selectRow();
    if (existing) return existing;

    const initial: AccountRoomRow = {
      user_id: userId,
      revision: 0,
      room: emptyRoom(),
    };
    const { data, error } = await client
      .from('account_rooms')
      .insert(initial)
      .select('user_id, revision, room')
      .maybeSingle();
    if (error && error.code !== '23505') throw error;
    if (data) return normalizeRow(data as AccountRoomRow);

    const raced = await selectRow();
    if (!raced) throw new Error('Account room could not be created');
    return raced;
  };

  const refresh = (): Promise<AccountRoomRow> => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = readOrCreateRow()
      .then((row) => {
        current = row;
        emit();
        return row;
      })
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  };

  const startRealtime = () => {
    if (channel) return;
    channel = client
      .channel(`account-room:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'account_rooms', filter: `user_id=eq.${userId}` },
        (payload) => {
          const next = payload.new as AccountRoomRow | Record<string, never>;
          if ('room' in next) {
            current = normalizeRow(next as AccountRoomRow);
            emit();
            return;
          }
          void refresh().catch(notifyError);
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          notifyError(new Error(`Account realtime channel ${status.toLowerCase()}`));
        }
      });
  };

  const stopRealtimeIfIdle = () => {
    if (!channel || listenerCount() > 0) return;
    const idleChannel = channel;
    channel = null;
    void client.removeChannel(idleChannel);
  };

  const addListener = <T,>(
    collection: Set<Listener<T>>,
    callback: (items: T[]) => void,
    onError?: (error: Error) => void,
  ) => {
    const listener = { callback, onError };
    collection.add(listener);
    startRealtime();
    if (current) emit();
    else void refresh().catch((error) => onError?.(asError(error)));
    return () => {
      collection.delete(listener);
      stopRealtimeIfIdle();
    };
  };

  const mutate = async <T,>(
    method: string,
    parts: string[],
    body: Record<string, unknown> = {},
  ): Promise<T> => {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const base = await readOrCreateRow();
      const room = structuredClone(base.room);
      const result = applyRoomRequest({ room, method, parts, body });
      if (result.status >= 400) {
        current = base;
        emit();
        throw new AccountRoomError(result.status, String(
          (result.body as { error?: unknown })?.error ?? 'Account room request failed',
        ));
      }
      if (!result.write) {
        current = base;
        emit();
        return result.body as T;
      }

      const revision = base.revision + 1;
      room.revision = revision;
      const { data, error } = await client
        .from('account_rooms')
        .update({ revision, room, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('revision', base.revision)
        .select('user_id, revision, room')
        .maybeSingle();
      if (error) throw error;
      if (!data) continue;

      current = normalizeRow(data as AccountRoomRow);
      emit();
      return result.body as T;
    }

    await refresh();
    throw new AccountRoomError(409, 'Concurrent account room update');
  };

  const sectionRevision = (deckId: string, sectionId: string) =>
    current?.room.sectionsByDeck[deckId]?.find((section) => section.id === sectionId)?.revision ?? 0;
  const cardRevision = (deckId: string, cardId: string) =>
    current?.room.cardsByDeck[deckId]?.find((card) => card.id === cardId)?.revision ?? 0;

  return {
    mode: 'cloud',
    async ensureDefaultDeck() {
      await refresh();
    },
    subscribeDecks(callback, onError) {
      return addListener(deckListeners, callback, onError);
    },
    subscribeCards(deckId, callback, onError) {
      const listeners = cardListeners.get(deckId) ?? new Set<Listener<Card>>();
      cardListeners.set(deckId, listeners);
      const unsubscribe = addListener(listeners, callback, onError);
      return () => {
        unsubscribe();
        if (listeners.size === 0) cardListeners.delete(deckId);
      };
    },
    subscribeSections(deckId, callback, onError) {
      const listeners = sectionListeners.get(deckId) ?? new Set<Listener<Section>>();
      sectionListeners.set(deckId, listeners);
      const unsubscribe = addListener(listeners, callback, onError);
      return () => {
        unsubscribe();
        if (listeners.size === 0) sectionListeners.delete(deckId);
      };
    },
    async addDeck(name, operationId) {
      const result = await mutate<{ id: string }>('POST', ['decks'], { name, operationId });
      return result.id;
    },
    async renameDeck(deckId, name) {
      await mutate('PATCH', ['decks', deckId], { name });
    },
    async deleteDeck(deckId) {
      await mutate('DELETE', ['decks', deckId]);
    },
    async addSection(deckId, name, operationId) {
      const result = await mutate<{ id: string }>(
        'POST',
        ['decks', deckId, 'sections'],
        { name, operationId },
      );
      return result.id;
    },
    async renameSection(deckId, sectionId, name) {
      await mutate(
        'PATCH',
        ['decks', deckId, 'sections', sectionId],
        { name, expectedRevision: sectionRevision(deckId, sectionId) },
      );
    },
    async deleteSection(deckId, sectionId) {
      await mutate(
        'DELETE',
        ['decks', deckId, 'sections', sectionId],
        { expectedRevision: sectionRevision(deckId, sectionId) },
      );
    },
    async setSectionContent(deckId, sectionId, sourceText, cards: NewCard[], operationId) {
      const response = await mutate<Card[] | { cards: Card[]; revision: number }>(
        'PUT',
        ['decks', deckId, 'sections', sectionId, 'content'],
        {
          sourceText,
          cards,
          operationId,
          expectedRevision: sectionRevision(deckId, sectionId),
        },
      );
      return Array.isArray(response) ? response : response.cards;
    },
    async toggleCardStar(deckId, cardId, starred) {
      await mutate(
        'PATCH',
        ['decks', deckId, 'cards', cardId],
        { starred, expectedRevision: cardRevision(deckId, cardId) },
      );
    },
    async setCardHides(deckId, cardId, hides) {
      await mutate(
        'PATCH',
        ['decks', deckId, 'cards', cardId],
        {
          answerMastery: hideMastery(hides),
          answerSchedule: hideSchedules(hides),
          expectedRevision: cardRevision(deckId, cardId),
        },
      );
    },
  };
}
