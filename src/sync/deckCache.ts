import { useCallback, useRef, useState } from 'react';
import { emptyDeckCache } from '../cards';
import type { DeckCacheEntry } from '../cards';
import { CardIdAliases } from '../mutationState';

export type DeckCacheSlice = 'cards' | 'sections';

/**
 * Two snapshots of the same room.
 *
 * `data` is what the screens render, including writes that have not been
 * acknowledged yet. `confirmed` is the last server-acknowledged snapshot, so a
 * failed write can put the optimistic slice back without discarding a
 * concurrent write to the other slice.
 */
export type DeckCache = {
  data: Record<string, DeckCacheEntry>;
  aliases: CardIdAliases;
  confirmed: (deckId: string) => DeckCacheEntry;
  updateLive: (deckId: string, update: (entry: DeckCacheEntry) => DeckCacheEntry) => void;
  updateConfirmed: (deckId: string, update: (entry: DeckCacheEntry) => DeckCacheEntry) => void;
  /** Rolls one slice back to the confirmed snapshot after a failed write. */
  restore: (deckId: string, slice: DeckCacheSlice) => void;
  removeDeck: (deckId: string) => void;
  retainDecks: (deckIds: Set<string>) => void;
};

export function useDeckCache(): DeckCache {
  const [data, setData] = useState<Record<string, DeckCacheEntry>>({});
  const confirmedRef = useRef<Record<string, DeckCacheEntry>>({});
  const aliasesRef = useRef(new CardIdAliases());

  const confirmed = useCallback((deckId: string) => confirmedRef.current[deckId] ?? emptyDeckCache(), []);

  const updateLive = useCallback((deckId: string, update: (entry: DeckCacheEntry) => DeckCacheEntry) => {
    setData((current) => ({ ...current, [deckId]: update(current[deckId] ?? emptyDeckCache()) }));
  }, []);

  const updateConfirmed = useCallback((deckId: string, update: (entry: DeckCacheEntry) => DeckCacheEntry) => {
    confirmedRef.current = {
      ...confirmedRef.current,
      [deckId]: update(confirmedRef.current[deckId] ?? emptyDeckCache()),
    };
  }, []);

  const restore = useCallback((deckId: string, slice: DeckCacheSlice) => {
    const snapshot = confirmedRef.current[deckId];
    if (!snapshot) return;
    if (slice === 'cards') {
      if (!snapshot.cardsLoaded) return;
      updateLive(deckId, (entry) => ({ ...entry, cards: snapshot.cards, cardsLoaded: true }));
      return;
    }
    if (!snapshot.sectionsLoaded) return;
    updateLive(deckId, (entry) => ({ ...entry, sections: snapshot.sections, sectionsLoaded: true }));
  }, [updateLive]);

  const removeDeck = useCallback((deckId: string) => {
    setData((current) => {
      if (!(deckId in current)) return current;
      const next = { ...current };
      delete next[deckId];
      return next;
    });
    const { [deckId]: _removed, ...rest } = confirmedRef.current;
    confirmedRef.current = rest;
    aliasesRef.current.clearDeck(deckId);
  }, []);

  const retainDecks = useCallback((deckIds: Set<string>) => {
    for (const deckId of Object.keys(confirmedRef.current)) {
      if (!deckIds.has(deckId)) aliasesRef.current.clearDeck(deckId);
    }
    confirmedRef.current = Object.fromEntries(
      Object.entries(confirmedRef.current).filter(([deckId]) => deckIds.has(deckId)),
    );
  }, []);

  return {
    data,
    aliases: aliasesRef.current,
    confirmed,
    updateLive,
    updateConfirmed,
    restore,
    removeDeck,
    retainDecks,
  };
}
