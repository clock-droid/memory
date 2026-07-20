import type { Row, Token } from './tokens';

export type View = 'home' | 'deck' | 'study';
export type StudyTarget = { cardId: string; answerIndexes: number[] };

export type UIState = {
  view: View;
  activeDeckId: string | null;
  activeSectionId: string | null;
  shuffle: boolean;
  filter: 'all' | 'unknown' | 'done';
  queue: StudyTarget[];
  sessionTotal: number;
  sessionDone: number;
  revealedIdx: number[];
  retryAnswerIdx: number[];
  review: boolean;
  openRowId: string | null;
  rowDrag: { id: string; x: number; base: number } | null;
  reorder: { id: string; dy: number; overId?: string | null } | null;
  sel: { ri: number; start: number; end: number; wasHidden: boolean } | null;
  slotOpen: boolean;
  pasteText: string;
  pasteMode: 'auto' | 'one';
  sheetRows: Row[];
  addOperationId: string;
  editSheetOpen: boolean;
  editIdx: number | null;
  editCardId: string | null;
  editSourceSignature: string;
  editMode: 'qa' | 'tokens';
  editSingleAnswer: boolean;
  editQ: string;
  editA: string;
  editText: string;
  editTokens: Token[];
  editInitialSignature: string;
  settingsOpen: boolean;
  toastMsg: string;
  toastVisible: boolean;
  toastUndo: boolean;
};

export const initialUI: UIState = {
  view: 'home', activeDeckId: null, activeSectionId: null, shuffle: false, filter: 'all',
  queue: [], sessionTotal: 0, sessionDone: 0, revealedIdx: [], retryAnswerIdx: [], review: false,
  openRowId: null, rowDrag: null, reorder: null, sel: null,
  slotOpen: false, pasteText: '', pasteMode: 'auto', sheetRows: [], addOperationId: '',
  editSheetOpen: false, editIdx: null, editCardId: null, editSourceSignature: '', editMode: 'qa', editSingleAnswer: false, editQ: '', editA: '', editText: '', editTokens: [], editInitialSignature: '',
  settingsOpen: false, toastMsg: '', toastVisible: false, toastUndo: false,
};

export type Patch = Partial<UIState> | ((s: UIState) => Partial<UIState>);
export function uiReducer(state: UIState, patch: Patch): UIState {
  return { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
}
