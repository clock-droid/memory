import type { Row, Token } from '../domain/tokens';
import type { SessionMode, StudyTarget } from '../domain/types';

/**
 * Screen state, split by the surface that owns it. A screen receives only its
 * own slice, so nothing can reach across and change state it does not render.
 */

export type View = 'home' | 'deck' | 'study';

/** Which list is open, and on which screen. */
export type RouteState = {
  view: View;
  deckId: string | null;
  sectionId: string | null;
};

export const initialRoute: RouteState = { view: 'home', deckId: null, sectionId: null };

/** Deck screen: filtering and the row gestures (swipe to delete, drag to reorder). */
export type DeckUiState = {
  filter: 'all' | 'unknown' | 'done';
  openRowId: string | null;
  rowDrag: { id: string; x: number; base: number } | null;
  reorder: { id: string; dy: number; overId?: string | null } | null;
};

export const initialDeckUi: DeckUiState = { filter: 'all', openRowId: null, rowDrag: null, reorder: null };

/** A study run. Progress counts hides, never cards. */
export type SessionState = {
  mode: SessionMode;
  queue: StudyTarget[];
  total: number;
  done: number;
  revealed: number[];
  retry: number[];
  shuffle: boolean;
};

export const initialSession: SessionState = {
  mode: 'learn', queue: [], total: 0, done: 0, revealed: [], retry: [], shuffle: false,
};

/** Clears a run without touching the user's shuffle preference. */
export const clearedSession: Partial<SessionState> = { queue: [], total: 0, done: 0, revealed: [], retry: [] };

/** A token range being dragged out. `row` indexes the composer's rows. */
export type TokenSelection = { start: number; end: number; wasHidden: boolean };
export type RowSelection = TokenSelection & { row: number };

/** The continuous-add sheet: raw text in, reviewable rows out. */
export type ComposerState = {
  open: boolean;
  text: string;
  mode: 'auto' | 'one';
  rows: Row[];
  operationId: string;
  selection: RowSelection | null;
};

/** Closing the composer returns it to exactly this, so one constant covers both. */
export const initialComposer: ComposerState = {
  open: false, text: '', mode: 'auto', rows: [], operationId: '', selection: null,
};

/** The edit sheet for one existing card. */
export type EditorState = {
  open: boolean;
  index: number | null;
  cardId: string | null;
  /** The card's text when the sheet opened, used to re-find it after a remote change. */
  sourceSignature: string;
  mode: 'qa' | 'tokens';
  singleAnswer: boolean;
  q: string;
  a: string;
  text: string;
  tokens: Token[];
  initialSignature: string;
  selection: TokenSelection | null;
};

export const initialEditor: EditorState = {
  open: false, index: null, cardId: null, sourceSignature: '',
  mode: 'qa', singleAnswer: false, q: '', a: '', text: '', tokens: [],
  initialSignature: '', selection: null,
};

/** Chrome that sits above every screen. */
export type ShellState = {
  settingsOpen: boolean;
  toastMessage: string;
  toastVisible: boolean;
  toastUndo: boolean;
};

export const initialShell: ShellState = {
  settingsOpen: false, toastMessage: '', toastVisible: false, toastUndo: false,
};
