import { useCallback, useEffect, useMemo, useState } from 'react';
import { createFirebaseRepository } from './firebase';
import { createLocalRepository } from './localRepository';
import { createServerRepository } from './serverRepository';
import { withCards, withSections } from '../domain/cards';
import type { DeckCacheEntry, OptimisticNewCard } from '../domain/cards';
import { KeyedMutationQueue, rejectedMutation } from './mutationQueue';
import type { EnqueuedMutation } from './mutationQueue';
import { applyAnswerMastery, applySectionName, replaceSectionCards } from './mutationState';
import { contentFingerprint } from './operationId';
import { deriveSyncHealth } from './syncHealth';
import type { SyncHealth } from './syncHealth';
import type { AnswerSchedule, Card, Deck, NewCard, Section } from '../domain/types';
import type { Repository } from './repository';
import { useDeckCache } from './deckCache';
import type { DeckCacheSlice } from './deckCache';
import { DECKS_KEY, cardsKey, sectionsKey, useSyncResources } from './syncResources';

/** Where a failed write reports itself, so screens can phrase their own copy. */
export type WriteCallbacks = {
  /** The queue refused the write because the resource is paused. */
  onRejected?: () => void;
  /** The write reached the server and failed. */
  onFailure?: () => void;
};

type WriteSpec<T> = {
  deckId: string;
  run: () => Promise<T>;
  /** Applied to the rendered snapshot immediately. */
  optimistic?: (entry: DeckCacheEntry) => DeckCacheEntry;
  /** Applied to the confirmed snapshot once the server acknowledges. */
  confirm: (entry: DeckCacheEntry, result: T) => DeckCacheEntry;
  /** Runs on every success, before the cache is updated. */
  beforeCommit?: (result: T) => void;
  /** Runs after the rendered snapshot is updated, only for the newest write. */
  afterLatestCommit?: (result: T) => void;
  /** Overrides the serialization key when two feeds share one server revision. */
  mutationKey?: string;
} & WriteCallbacks;

export type CreatedList = { deckId: string; sectionId: string; createdDeck: boolean };

export type RoomStore = {
  decks: Deck[];
  deckDataById: Record<string, DeckCacheEntry>;
  syncHealth: SyncHealth;
  isReady: boolean;
  retry: () => void;
  /** Stored cards of one section, in their persisted order. */
  storedCardsOf: (deckId: string, sectionId: string) => Card[];
  /** A card write is in flight — starting a study session now would race it. */
  hasPendingCardWrites: (deckId: string) => boolean;
  /** Any write to this deck is in flight. */
  hasPendingWrites: (deckId: string) => boolean;
  saveSectionCards: (
    deckId: string,
    sectionId: string,
    cards: OptimisticNewCard[],
    options?: WriteCallbacks & { operationId?: string },
  ) => EnqueuedMutation;
  saveAnswerMastery: (
    deckId: string,
    cardId: string,
    answerMastery: boolean[],
    answerSchedule: Array<AnswerSchedule | null> | undefined,
    options?: WriteCallbacks,
  ) => EnqueuedMutation;
  renameSection: (deckId: string, sectionId: string, name: string, options?: WriteCallbacks) => boolean;
  createListWithCards: (name: string, operationId: string, cards: NewCard[]) => Promise<CreatedList | null>;
  deleteSection: (deckId: string, sectionId: string) => Promise<boolean>;
  /** Undo for `createListWithCards`: removes the list and the deck it minted. */
  removeCreatedList: (created: CreatedList) => Promise<boolean>;
};

/** Client-side ids that let the optimistic cache render a card before it is saved. */
function mintOptimisticCards(cards: OptimisticNewCard[], sectionId: string): Card[] {
  const now = Date.now();
  return cards.map((candidate, index) => {
    const { optimisticId, ...card } = candidate;
    return {
      ...card,
      id: optimisticId ?? `tmp_${now}_${index}_${Math.random().toString(36).slice(2, 8)}`,
      sectionId,
      createdAt: now,
      updatedAt: now,
    } as Card;
  });
}

function stripOptimisticIds(cards: OptimisticNewCard[]): NewCard[] {
  return cards.map(({ optimisticId: _ignored, ...card }) => card);
}

/**
 * Owns everything about talking to the room: which backend is in use, the live
 * and confirmed snapshots, and how an optimistic write is applied, confirmed or
 * rolled back. It deliberately holds no user-facing copy and no screen state.
 */
export function useRoomStore(roomCode: string): RoomStore {
  const repository = useMemo<Repository | null>(() => {
    if (!roomCode) return null;
    // The revisioned sync endpoint is the authoritative production backend.
    // Keep legacy adapters only as fallbacks for environments without it;
    // preferring Firebase would bypass conflict checks and idempotent writes.
    return createServerRepository(roomCode) ?? createFirebaseRepository(roomCode) ?? createLocalRepository(roomCode);
  }, [roomCode]);

  const [decks, setDecks] = useState<Deck[]>([]);
  const [generation, setGeneration] = useState(0);
  const [mutationQueue] = useState(() => new KeyedMutationQueue());
  const sync = useSyncResources();
  const cache = useDeckCache();

  // Every member below is referentially stable, so the callbacks built from
  // them do not change identity when the cached snapshot changes.
  const { markPending, markSuccess, markFailure, retainDecks: retainSyncDecks } = sync;
  const {
    aliases, confirmed, updateLive, updateConfirmed, restore, removeDeck,
    retainDecks: retainCacheDecks,
  } = cache;

  // ---- subscriptions
  useEffect(() => {
    if (!repository) return;
    markPending([DECKS_KEY]);
    repository.ensureDefaultDeck().catch(() => {});
    return repository.subscribeDecks(
      (next) => {
        const activeDeckIds = new Set(next.map((deck) => deck.id));
        retainCacheDecks(activeDeckIds);
        setDecks(next);
        retainSyncDecks(activeDeckIds);
        markSuccess(DECKS_KEY);
      },
      () => markFailure(DECKS_KEY),
    );
  }, [repository, generation, markPending, markSuccess, markFailure, retainCacheDecks, retainSyncDecks]);

  const deckIdsKey = decks.map((deck) => deck.id).join(',');
  useEffect(() => {
    if (!repository) return;
    const deckIds = deckIdsKey ? deckIdsKey.split(',') : [];
    markPending(deckIds.flatMap((deckId) => [cardsKey(deckId), sectionsKey(deckId)]));
    const unsubscribes = deckIds.flatMap((deckId) => [
      repository.subscribeCards(
        deckId,
        (cards) => {
          const resourceKey = cardsKey(deckId);
          updateConfirmed(deckId, (entry) => withCards(entry, cards));
          // A pending write already shows a newer value; overwriting it here
          // would make the user's own edit flicker back to the old snapshot.
          if (!mutationQueue.hasPending(resourceKey)) {
            aliases.clearDeck(deckId);
            updateLive(deckId, (entry) => withCards(entry, cards));
          }
          mutationQueue.resume(resourceKey);
          markSuccess(resourceKey);
        },
        () => markFailure(cardsKey(deckId)),
      ),
      repository.subscribeSections(
        deckId,
        (sections) => {
          const resourceKey = sectionsKey(deckId);
          updateConfirmed(deckId, (entry) => withSections(entry, sections));
          if (!mutationQueue.hasPending(resourceKey)) {
            updateLive(deckId, (entry) => withSections(entry, sections));
          }
          mutationQueue.resume(resourceKey);
          markSuccess(resourceKey);
        },
        () => markFailure(sectionsKey(deckId)),
      ),
    ]);
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [repository, deckIdsKey, generation, mutationQueue, aliases,
    updateLive, updateConfirmed, markPending, markSuccess, markFailure]);

  const requiredSyncKeys = useMemo(
    () => [DECKS_KEY, ...decks.flatMap((deck) => [cardsKey(deck.id), sectionsKey(deck.id)])],
    [decks],
  );
  const syncHealth = useMemo(
    () => deriveSyncHealth(requiredSyncKeys, sync.resources),
    [requiredSyncKeys, sync.resources],
  );
  const isReady = syncHealth.status === 'ready';

  const retry = useCallback(() => {
    markPending(requiredSyncKeys);
    setGeneration((current) => current + 1);
  }, [markPending, requiredSyncKeys]);

  // ---- optimistic writes
  const write = useCallback(<T,>(slice: DeckCacheSlice, spec: WriteSpec<T>): EnqueuedMutation => {
    const { deckId } = spec;
    const resourceKey = slice === 'cards' ? cardsKey(deckId) : sectionsKey(deckId);
    const queued = mutationQueue.enqueue(spec.mutationKey ?? resourceKey, spec.run, {
      onSuccess: (result, context) => {
        spec.beforeCommit?.(result);
        const next = spec.confirm(confirmed(deckId), result);
        updateConfirmed(deckId, () => next);
        if (!context.isLatest) return;
        updateLive(deckId, () => next);
        spec.afterLatestCommit?.(result);
      },
      onFailure: () => {
        restore(deckId, slice);
        markFailure(resourceKey);
        spec.onFailure?.();
      },
    });
    if (!queued.accepted) {
      spec.onRejected?.();
      return queued;
    }
    if (spec.optimistic) updateLive(deckId, spec.optimistic);
    return queued;
  }, [mutationQueue, confirmed, restore, updateLive, updateConfirmed, markFailure]);

  const saveSectionCards = useCallback((
    deckId: string,
    sectionId: string,
    cards: OptimisticNewCard[],
    options?: WriteCallbacks & { operationId?: string },
  ): EnqueuedMutation => {
    if (!repository || !isReady) return rejectedMutation();
    const payload = stripOptimisticIds(cards);
    const sourceText = payload.map((card) => card.rawText).join('\n');
    const optimistic = mintOptimisticCards(cards, sectionId);
    return write('cards', {
      deckId,
      run: () => repository.setSectionContent(deckId, sectionId, sourceText, payload, options?.operationId),
      optimistic: (entry) => withCards(entry, replaceSectionCards(entry.cards, sectionId, optimistic)),
      confirm: (entry, saved) => withCards(entry, replaceSectionCards(entry.cards, sectionId, saved)),
      // The server regenerates card ids on every content write; the aliases let
      // a hide-level write that was queued against the old id still land.
      beforeCommit: (saved) => aliases.recordReplacement(deckId, optimistic, saved),
      afterLatestCommit: () => aliases.clearDeck(deckId),
      onRejected: options?.onRejected,
      onFailure: options?.onFailure,
    });
  }, [repository, isReady, write, aliases]);

  const saveAnswerMastery = useCallback((
    deckId: string,
    cardId: string,
    answerMastery: boolean[],
    answerSchedule: Array<AnswerSchedule | null> | undefined,
    options?: WriteCallbacks,
  ): EnqueuedMutation => {
    if (!repository || !isReady) return rejectedMutation();
    return write('cards', {
      deckId,
      run: async () => {
        const resolvedCardId = aliases.resolve(deckId, cardId);
        if (!confirmed(deckId).cards.some((card) => card.id === resolvedCardId)) {
          throw new Error('Confirmed card id is unavailable');
        }
        await repository.setCardAnswerMastery(deckId, resolvedCardId, answerMastery, answerSchedule);
        return resolvedCardId;
      },
      optimistic: (entry) => ({
        ...entry,
        cards: applyAnswerMastery(entry.cards, cardId, answerMastery, answerSchedule),
      }),
      confirm: (entry, resolvedCardId) => withCards(
        entry,
        applyAnswerMastery(entry.cards, resolvedCardId, answerMastery, answerSchedule),
      ),
      afterLatestCommit: () => aliases.clearDeck(deckId),
      onRejected: options?.onRejected,
      onFailure: options?.onFailure,
    });
  }, [repository, isReady, write, aliases, confirmed]);

  const renameSection = useCallback((
    deckId: string,
    sectionId: string,
    name: string,
    options?: WriteCallbacks,
  ): boolean => {
    if (!repository || !isReady) return false;
    return write('sections', {
      deckId,
      // Section name and content share one server revision. Serialize them with
      // card writes so a normal rename + save sequence cannot conflict with
      // itself, while still reporting failures against the sections feed.
      mutationKey: cardsKey(deckId),
      run: () => repository.renameSection(deckId, sectionId, name),
      optimistic: (entry) => ({ ...entry, sections: applySectionName(entry.sections, sectionId, name) }),
      confirm: (entry) => withSections(entry, applySectionName(entry.sections, sectionId, name)),
      onRejected: options?.onRejected,
      onFailure: options?.onFailure,
    }).accepted;
  }, [repository, isReady, write]);

  const createListWithCards = useCallback(async (
    name: string,
    operationId: string,
    cards: NewCard[],
  ): Promise<CreatedList | null> => {
    if (!repository || !isReady) return null;
    const deckOperationId = `${operationId}-deck`;
    const existingDeck = decks.find((deck) => deck.name === '일반');
    let deckId = existingDeck?.id;
    let createdDeck = existingDeck?.clientOperationId === deckOperationId;
    try {
      if (!deckId) {
        deckId = await repository.addDeck('일반', deckOperationId);
        createdDeck = true;
      }
      const sectionId = await repository.addSection(deckId, name, `${operationId}-section`);
      const sourceText = cards.map((card) => card.rawText).join('\n');
      // Seed the optimistic cache from the persisted cards (real server ids),
      // not minted tmp_ ids — otherwise this new-list path leaves stale ids in
      // the cache and per-hide mastery writes are lost on reload.
      const payloadFingerprint = contentFingerprint(JSON.stringify([sourceText, cards]));
      const saved = await repository.setSectionContent(
        deckId,
        sectionId,
        sourceText,
        cards,
        `${operationId}-content-${payloadFingerprint}`,
      );

      const now = Date.now();
      const section: Section = { id: sectionId, name, sourceText, createdAt: now, updatedAt: now };
      const commit = (entry: DeckCacheEntry) => withSections(
        withCards(entry, replaceSectionCards(entry.cards, sectionId, saved)),
        [...entry.sections.filter((item) => item.id !== sectionId), section],
      );
      updateConfirmed(deckId, commit);
      updateLive(deckId, commit);
      const resolvedDeckId = deckId;
      setDecks((current) => current.some((deck) => deck.id === resolvedDeckId)
        ? current
        : [...current, { id: resolvedDeckId, name: '일반', createdAt: now, updatedAt: now }]);
      return { deckId: resolvedDeckId, sectionId, createdDeck };
    } catch {
      // Creation calls carry stable operation ids. A timed-out response may
      // still have committed, so deleting here could destroy a successful
      // list or create duplicates. Keep the draft and retry the same operation;
      // every backend will return/rewrite the same resources idempotently.
      markFailure(DECKS_KEY);
      if (deckId) {
        markFailure(cardsKey(deckId));
        markFailure(sectionsKey(deckId));
      }
      return null;
    }
  }, [repository, isReady, decks, updateConfirmed, updateLive, markFailure]);

  const deleteSection = useCallback(async (deckId: string, sectionId: string): Promise<boolean> => {
    if (!repository || !isReady) return false;
    try {
      await repository.deleteSection(deckId, sectionId);
      return true;
    } catch {
      markFailure(sectionsKey(deckId));
      markFailure(cardsKey(deckId));
      return false;
    }
  }, [repository, isReady, markFailure]);

  const removeCreatedList = useCallback(async ({ deckId, sectionId, createdDeck }: CreatedList): Promise<boolean> => {
    if (!repository || !isReady) return false;
    let failedKeys = [sectionsKey(deckId), cardsKey(deckId)];
    try {
      await repository.deleteSection(deckId, sectionId);
      if (createdDeck) {
        failedKeys = [DECKS_KEY];
        await repository.deleteDeck(deckId);
        removeDeck(deckId);
        setDecks((current) => current.filter((deck) => deck.id !== deckId));
        return true;
      }
      updateLive(deckId, (entry) => ({
        ...entry,
        cards: entry.cards.filter((card) => (card.sectionId ?? 'default') !== sectionId),
        sections: entry.sections.filter((section) => section.id !== sectionId),
      }));
      return true;
    } catch {
      failedKeys.forEach(markFailure);
      return false;
    }
  }, [repository, isReady, removeDeck, updateLive, markFailure]);

  const storedCardsOf = useCallback((deckId: string, sectionId: string): Card[] => {
    const cards = cache.data[deckId]?.cards ?? [];
    return cards.filter((card) => (card.sectionId ?? 'default') === sectionId);
  }, [cache.data]);

  const hasPendingCardWrites = useCallback(
    (deckId: string) => mutationQueue.hasPending(cardsKey(deckId)),
    [mutationQueue],
  );

  const hasPendingWrites = useCallback(
    (deckId: string) => mutationQueue.hasPending(cardsKey(deckId)) || mutationQueue.hasPending(sectionsKey(deckId)),
    [mutationQueue],
  );

  return {
    decks,
    deckDataById: cache.data,
    syncHealth,
    isReady,
    retry,
    storedCardsOf,
    hasPendingCardWrites,
    hasPendingWrites,
    saveSectionCards,
    saveAnswerMastery,
    renameSection,
    createListWithCards,
    deleteSection,
    removeCreatedList,
  };
}
