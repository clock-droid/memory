import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { applyHideSelection } from '../tokens';
import type { Patch } from '../uiState';

/** The edit sheet edits one token row directly instead of a numbered sheet row. */
const EDIT_SHEET_ROW = -100;

/**
 * Pointer gestures start inside a row but can end anywhere, so the release is
 * handled on the window: it commits a pending hide selection and cancels an
 * unfinished long-press reorder.
 */
export function useGlobalPointerRelease(
  dispatch: (patch: Patch) => void,
  longPressTimer: MutableRefObject<number | undefined>,
) {
  useEffect(() => {
    const release = () => {
      dispatch((state) => {
        const selection = state.sel;
        if (!selection) return {};
        if (selection.ri === EDIT_SHEET_ROW) {
          return { editTokens: applyHideSelection(state.editTokens, selection), sel: null };
        }
        return {
          sheetRows: state.sheetRows.map((row, index) => (index === selection.ri && row.kind === 'tokens'
            ? { ...row, tokens: applyHideSelection(row.tokens, selection) }
            : row)),
          sel: null,
        };
      });
      window.clearTimeout(longPressTimer.current);
      dispatch((state) => (state.reorder ? { reorder: null } : {}));
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [dispatch, longPressTimer]);
}
