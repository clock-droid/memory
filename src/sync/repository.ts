import type { Hide } from '../domain/hides';
import type { Card, Deck, NewCard, Section } from '../domain/types';

/**
 * The port every backend implements. The room store talks only to this, so a
 * screen never learns whether it is on the sync endpoint, Firebase or
 * localStorage.
 */
export type Repository = {
  mode: 'firebase' | 'local' | 'server' | 'cloud';
  subscribeDecks: (callback: (decks: Deck[]) => void, onError?: (error: Error) => void) => () => void;
  subscribeCards: (deckId: string, callback: (cards: Card[]) => void, onError?: (error: Error) => void) => () => void;
  subscribeSections: (deckId: string, callback: (sections: Section[]) => void, onError?: (error: Error) => void) => () => void;
  ensureDefaultDeck: () => Promise<void>;
  addDeck: (name: string, operationId?: string) => Promise<string>;
  renameDeck: (deckId: string, name: string) => Promise<void>;
  deleteDeck: (deckId: string) => Promise<void>;
  addSection: (deckId: string, name: string, operationId?: string) => Promise<string>;
  renameSection: (deckId: string, sectionId: string, name: string) => Promise<void>;
  deleteSection: (deckId: string, sectionId: string) => Promise<void>;
  setSectionContent: (deckId: string, sectionId: string, sourceText: string, cards: NewCard[], operationId?: string) => Promise<Card[]>;
  toggleCardStar: (deckId: string, cardId: string, starred: boolean) => Promise<void>;
  setCardHides: (deckId: string, cardId: string, hides: Hide[]) => Promise<void>;
};
