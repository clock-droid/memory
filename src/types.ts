export type CardType = 'pair' | 'cloze' | 'group';

/** Serialized FSRS memory state for one hide. Timestamps are ms epoch. */
export type AnswerSchedule = {
  due: number;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: number;
};

export type Deck = {
  id: string;
  name: string;
  clientOperationId?: string;
  createdAt: number;
  updatedAt: number;
};

export type Section = {
  id: string;
  name: string;
  sourceText: string;
  clientOperationId?: string;
  contentOperationId?: string | null;
  contentOperationIds?: string[];
  revision?: number;
  createdAt: number;
  updatedAt: number;
};

export type Card = {
  id: string;
  sectionId?: string;
  revision?: number;
  type: CardType;
  prompt: string;
  answers: string[];
  rawText: string;
  groupItems?: GroupItem[];
  /** Quarantined legacy card: visible for repair, but has no study target. */
  needsRepair?: boolean;
  starred?: boolean;
  answerMastery?: boolean[];
  /** Per-hide FSRS state, parallel to answers. Null = never rated. */
  answerSchedule?: Array<AnswerSchedule | null>;
  mastered?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type NewCard = Omit<Card, 'id' | 'createdAt' | 'updatedAt'>;

export type GroupItem = {
  marker: string;
  text: string;
};

export type ParsedLine =
  | {
      lineNumber: number;
      rawText: string;
      valid: true;
      card: NewCard;
    }
  | {
      lineNumber: number;
      rawText: string;
      valid: false;
      reason: string;
    };

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
  setCardAnswerMastery: (
    deckId: string,
    cardId: string,
    answerMastery: boolean[],
    answerSchedule?: Array<AnswerSchedule | null>,
  ) => Promise<void>;
};
