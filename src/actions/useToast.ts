import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import type { Patch } from '../state/patchState';
import type { ShellState } from '../state/uiSlices';

const PLAIN_MS = 1800;
/** Undoable toasts stay longer: the user has to read and decide. */
const UNDOABLE_MS = 4200;

export type Toast = (message: string, undo?: () => void) => void;

export function useToast(setShell: Dispatch<Patch<ShellState>>) {
  const timer = useRef<number | undefined>(undefined);
  const undoAction = useRef<(() => void) | null>(null);

  const toast = useCallback<Toast>((message, undo) => {
    window.clearTimeout(timer.current);
    undoAction.current = undo ?? null;
    setShell({ toastMessage: message, toastVisible: true, toastUndo: Boolean(undo) });
    timer.current = window.setTimeout(() => {
      undoAction.current = null;
      setShell({ toastVisible: false, toastUndo: false });
    }, undo ? UNDOABLE_MS : PLAIN_MS);
  }, [setShell]);

  const undoToast = useCallback(() => {
    const action = undoAction.current;
    if (!action) return;
    window.clearTimeout(timer.current);
    undoAction.current = null;
    setShell({ toastVisible: false, toastUndo: false });
    action();
  }, [setShell]);

  return { toast, undoToast };
}
