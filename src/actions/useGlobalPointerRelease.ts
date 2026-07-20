import { useEffect } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import type { Patch } from '../state/patchState';
import type { ComposerState, DeckUiState, EditorState } from '../state/uiSlices';
import { applyHideSelection } from '../domain/tokens';

export type PointerReleaseOptions = {
  setComposer: Dispatch<Patch<ComposerState>>;
  setEditor: Dispatch<Patch<EditorState>>;
  setDeck: Dispatch<Patch<DeckUiState>>;
  longPressTimer: MutableRefObject<number | undefined>;
};

/**
 * Pointer gestures start inside a row but can end anywhere, so the release is
 * handled on the window: it commits whichever hide selection is pending and
 * cancels an unfinished long-press reorder. Each slice ignores the release when
 * it has nothing in progress.
 */
export function useGlobalPointerRelease({ setComposer, setEditor, setDeck, longPressTimer }: PointerReleaseOptions) {
  useEffect(() => {
    const release = () => {
      setComposer((current) => {
        const selection = current.selection;
        if (!selection) return {};
        return {
          rows: current.rows.map((row, index) => (index === selection.row && row.kind === 'tokens'
            ? { ...row, tokens: applyHideSelection(row.tokens, selection) }
            : row)),
          selection: null,
        };
      });
      setEditor((current) => (current.selection
        ? { tokens: applyHideSelection(current.tokens, current.selection), selection: null }
        : {}));
      window.clearTimeout(longPressTimer.current);
      setDeck((current) => (current.reorder ? { reorder: null } : {}));
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [setComposer, setEditor, setDeck, longPressTimer]);
}
