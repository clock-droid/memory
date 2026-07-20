import { useCallback, useRef } from 'react';
import type { Patch } from '../uiState';

const PLAIN_MS = 1800;
/** Undoable toasts stay longer: the user has to read and decide. */
const UNDOABLE_MS = 4200;

export type Toast = (message: string, undo?: () => void) => void;

export function useToast(dispatch: (patch: Patch) => void) {
  const timer = useRef<number | undefined>(undefined);
  const undoAction = useRef<(() => void) | null>(null);

  const toast = useCallback<Toast>((message, undo) => {
    window.clearTimeout(timer.current);
    undoAction.current = undo ?? null;
    dispatch({ toastMsg: message, toastVisible: true, toastUndo: Boolean(undo) });
    timer.current = window.setTimeout(() => {
      undoAction.current = null;
      dispatch({ toastVisible: false, toastUndo: false });
    }, undo ? UNDOABLE_MS : PLAIN_MS);
  }, [dispatch]);

  const undoToast = useCallback(() => {
    const action = undoAction.current;
    if (!action) return;
    window.clearTimeout(timer.current);
    undoAction.current = null;
    dispatch({ toastVisible: false, toastUndo: false });
    action();
  }, [dispatch]);

  return { toast, undoToast };
}
