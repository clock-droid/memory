export type CardType = 'pair' | 'cloze' | 'group';

/** One card's hides queued for a session. Hides, not cards, are the unit. */
export type StudyTarget = { cardId: string; hideIndexes: number[] };

/** learn: unknown hides · review: everything again · checkup: known hides that came due. */
export type SessionMode = 'learn' | 'review' | 'checkup';

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
