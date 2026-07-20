import { useCallback, useState } from 'react';
import type { SyncResourceState } from '../syncHealth';

/**
 * Every subscribed feed is tracked under a resource key. Keys are built here
 * so no other module has to know the string format.
 */
export const DECKS_KEY = 'decks';
export const cardsKey = (deckId: string) => `cards:${deckId}`;
export const sectionsKey = (deckId: string) => `sections:${deckId}`;

/** The deck a resource key belongs to, or null for room-wide keys. */
export function deckIdOfResourceKey(key: string) {
  const separator = key.indexOf(':');
  return separator < 0 ? null : key.slice(separator + 1);
}

export type SyncResourceTracker = {
  resources: Record<string, SyncResourceState>;
  markPending: (keys: string[]) => void;
  markSuccess: (key: string) => void;
  markFailure: (key: string) => void;
  /** Drops per-deck keys for decks that no longer exist. */
  retainDecks: (deckIds: Set<string>) => void;
};

export function useSyncResources(): SyncResourceTracker {
  const [resources, setResources] = useState<Record<string, SyncResourceState>>({});

  const markPending = useCallback((keys: string[]) => {
    setResources((current) => {
      const next = { ...current };
      let changed = false;
      for (const key of keys) {
        const previous = current[key];
        if (previous?.pending && !previous.failed) continue;
        next[key] = { hasData: previous?.hasData ?? false, pending: true, failed: false };
        changed = true;
      }
      return changed ? next : current;
    });
  }, []);

  const markSuccess = useCallback((key: string) => {
    setResources((current) => {
      const previous = current[key];
      if (previous?.hasData && !previous.pending && !previous.failed) return current;
      return { ...current, [key]: { hasData: true, pending: false, failed: false } };
    });
  }, []);

  const markFailure = useCallback((key: string) => {
    setResources((current) => {
      const previous = current[key];
      if (previous?.failed && !previous.pending) return current;
      return {
        ...current,
        [key]: { hasData: previous?.hasData ?? false, pending: false, failed: true },
      };
    });
  }, []);

  const retainDecks = useCallback((deckIds: Set<string>) => {
    setResources((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => {
        const deckId = deckIdOfResourceKey(key);
        return deckId === null || deckIds.has(deckId);
      }),
    ));
  }, []);

  return { resources, markPending, markSuccess, markFailure, retainDecks };
}
