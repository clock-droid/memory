import { useCallback } from 'react';
import type { Dispatch } from 'react';
import { usePatchState } from './patchState';
import type { Patch } from './patchState';
import {
  clearedSession,
  initialComposer, initialDeckUi, initialEditor, initialRoute, initialSession, initialShell,
} from './uiSlices';
import type { ComposerState, DeckUiState, EditorState, RouteState, SessionState, ShellState } from './uiSlices';

export type RoomUi = {
  route: RouteState;
  setRoute: Dispatch<Patch<RouteState>>;
  deck: DeckUiState;
  setDeck: Dispatch<Patch<DeckUiState>>;
  session: SessionState;
  setSession: Dispatch<Patch<SessionState>>;
  composer: ComposerState;
  setComposer: Dispatch<Patch<ComposerState>>;
  editor: EditorState;
  setEditor: Dispatch<Patch<EditorState>>;
  shell: ShellState;
  setShell: Dispatch<Patch<ShellState>>;
  /** Leaves the open list: no slice below the home screen stays meaningful. */
  goHome: () => void;
  openList: (deckId: string, sectionId: string) => void;
  startSession: (deckId: string, sectionId: string, run: SessionRun) => void;
  backToDeck: () => void;
};

/** A study run without the user's persistent shuffle preference. */
export type SessionRun = Omit<SessionState, 'shuffle'>;

/**
 * Composes the screen state out of independent slices. Crossing a slice
 * boundary has to go through a named action here, which is what keeps a change
 * to one screen from quietly rewriting another.
 */
export function useRoomUi(): RoomUi {
  const [route, setRoute] = usePatchState(initialRoute);
  const [deck, setDeck] = usePatchState(initialDeckUi);
  const [session, setSession] = usePatchState(initialSession);
  const [composer, setComposer] = usePatchState(initialComposer);
  const [editor, setEditor] = usePatchState(initialEditor);
  const [shell, setShell] = usePatchState(initialShell);

  const goHome = useCallback(() => {
    setRoute({ view: 'home', deckId: null, sectionId: null });
    setSession(clearedSession);
    setDeck({ openRowId: null });
    setComposer(initialComposer);
    setEditor({ open: false });
  }, [setRoute, setSession, setDeck, setComposer, setEditor]);

  const openList = useCallback((deckId: string, sectionId: string) => {
    setRoute({ view: 'deck', deckId, sectionId });
    setDeck({ openRowId: null });
  }, [setRoute, setDeck]);

  const startSession = useCallback((deckId: string, sectionId: string, run: SessionRun) => {
    setRoute({ view: 'study', deckId, sectionId });
    setSession(run);
    setDeck({ openRowId: null });
  }, [setRoute, setSession, setDeck]);

  const backToDeck = useCallback(() => {
    setRoute({ view: 'deck' });
    setSession(clearedSession);
    setDeck({ openRowId: null });
  }, [setRoute, setSession, setDeck]);

  return {
    route, setRoute,
    deck, setDeck,
    session, setSession,
    composer, setComposer,
    editor, setEditor,
    shell, setShell,
    goHome, openList, startSession, backToDeck,
  };
}
