import { useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useCardActions } from './actions/useCardActions';
import { useCardEditor } from './actions/useCardEditor';
import { useGlobalPointerRelease } from './actions/useGlobalPointerRelease';
import { useListDraft } from './actions/useListDraft';
import { useRemoteChangeGuard } from './actions/useRemoteChangeGuard';
import { useStudySession } from './actions/useStudySession';
import { useToast } from './actions/useToast';
import { buildLists, weakestFirst } from './cards';
import { ROOM_KEY } from './constants';
import { isSyncReadOnly } from './syncHealth';
import { useRoomStore } from './sync/useRoomStore';
import { initialUI, uiReducer } from './uiState';
import { ContinuousAddView } from './views/ContinuousAddView';
import { DeckView } from './views/DeckView';
import { EditSheet } from './views/EditSheet';
import { HomeView } from './views/HomeView';
import { IdGate } from './views/IdGate';
import { SettingsSheet } from './views/SettingsSheet';
import { StudyView } from './views/StudyView';
import { Toast } from './views/Toast';

const SHELL_STYLE: CSSProperties = {
  height: '100dvh', width: '100%', maxWidth: 480, margin: '0 auto', position: 'relative',
  background: '#F2F2F7', color: '#000', display: 'flex', flexDirection: 'column', overflow: 'clip',
};

export default function App() {
  const [roomCode, setRoomCode] = useState(() => localStorage.getItem(ROOM_KEY) ?? '');
  const enterRoom = (code: string) => {
    localStorage.setItem(ROOM_KEY, code);
    setRoomCode(code);
  };
  if (!roomCode) return <IdGate onSubmit={enterRoom} />;
  // Keyed on the room so switching ids rebuilds every subscription and cache.
  return <Room key={roomCode} roomCode={roomCode} onChangeRoom={enterRoom} />;
}

/**
 * Wires one room together: the synced store, the screen state, and the intents
 * the screens can trigger. All of those live in their own modules — this
 * component only decides which screen is on top.
 */
function Room({ roomCode, onChangeRoom }: { roomCode: string; onChangeRoom: (code: string) => void }) {
  const [state, dispatch] = useReducer(uiReducer, initialUI);
  const store = useRoomStore(roomCode);
  const { toast, undoToast } = useToast(dispatch);

  const lists = useMemo(
    () => buildLists(store.decks, store.deckDataById),
    [store.decks, store.deckDataById],
  );
  const activeList = lists.find((list) => list.deckId === state.activeDeckId && list.id === state.activeSectionId);

  const { commitSection, renameList, deleteCard, moveCard, deleteList } =
    useCardActions({ store, activeList, dispatch, toast });
  const editor = useCardEditor({ store, activeList, commitSection, dispatch, toast });
  const draft = useListDraft({ store, activeList, commitSection, dispatch, toast });
  const session = useStudySession({ store, lists, activeList, state, dispatch, toast });

  // Row gesture scratch state, owned here because the pointer release that ends
  // a gesture is handled on the window rather than inside the row.
  const longPressTimer = useRef<number | undefined>(undefined);
  const rowStart = useRef<{ x: number; y: number; moved: boolean }>({ x: 0, y: 0, moved: false });
  useGlobalPointerRelease(dispatch, longPressTimer);

  useRemoteChangeGuard({
    syncHealth: store.syncHealth,
    activeList,
    hasDraftList: Boolean(draft.draft),
    state,
    dispatch,
    toast,
    onLeaveList: draft.forgetLastAdd,
  });

  // A stale or failing snapshot may only be read: writing onto it would resolve
  // conflicts against data the user can no longer see.
  const syncReadOnly = isSyncReadOnly(store.syncHealth.status);

  return (
    <div style={SHELL_STYLE}>
      {(state.view === 'home' || syncReadOnly) && (
        <HomeView
          lists={lists}
          decksState={store.syncHealth.status}
          syncPending={store.syncHealth.pending}
          onRetry={store.retry}
          onOpenList={(list) => dispatch({
            view: 'deck', activeDeckId: list.deckId, activeSectionId: list.id, openRowId: null, filter: 'all',
          })}
          onContinue={(list) => session.startStudy(list.deckId, list.id)}
          onNewList={draft.startNewList}
          onOpenSettings={() => dispatch({ settingsOpen: true })}
        />
      )}

      {!syncReadOnly && state.view === 'deck' && activeList && !state.slotOpen && (
        <DeckView
          list={activeList} state={state} dispatch={dispatch} weakFirst={weakestFirst}
          lpTimer={longPressTimer} rowStart={rowStart}
          onHome={() => dispatch({ view: 'home', activeDeckId: null, activeSectionId: null, openRowId: null })}
          onRename={renameList}
          onDelete={deleteCard}
          onEdit={editor.openEditFor}
          onMove={moveCard}
          onDeleteList={deleteList}
          onStart={(ids) => session.startStudy(activeList.deckId, activeList.id, ids)}
          onStartCheckup={() => session.startCheckup(activeList.deckId, activeList.id)}
          onOpenAdd={draft.openAdd}
          toast={toast}
        />
      )}

      {!syncReadOnly && state.view === 'deck' && state.slotOpen && (activeList || draft.draft) && (
        <ContinuousAddView
          state={state}
          dispatch={dispatch}
          operationSeed={state.addOperationId}
          onAddCards={draft.addCards}
          onUndoLast={draft.undoLastAdd}
          onClose={draft.closeAdd}
        />
      )}

      {!syncReadOnly && state.view === 'study' && (
        <StudyView
          list={activeList} state={state} dispatch={dispatch}
          onComplete={session.completeTarget}
          onDeck={() => dispatch({ view: 'deck', queue: [], revealedIdx: [], retryAnswerIdx: [], openRowId: null })}
          onRetryRemaining={() => activeList && session.startStudy(activeList.deckId, activeList.id)}
          onReviewAll={() => activeList && session.startStudy(
            activeList.deckId, activeList.id, activeList.cards.map((card) => card.id),
          )}
        />
      )}

      {!syncReadOnly && !state.settingsOpen && state.editSheetOpen && activeList && (
        <EditSheet
          list={activeList} state={state} dispatch={dispatch}
          saveEditFrom={editor.saveEditFrom}
          onDelete={() => editor.deleteEditingCard(state)}
          openEditFor={editor.openEditFor}
        />
      )}

      {state.settingsOpen && (
        <SettingsSheet roomCode={roomCode} onClose={() => dispatch({ settingsOpen: false })} onChangeRoom={onChangeRoom} />
      )}

      {state.toastVisible && (
        <Toast message={state.toastMsg} onUndo={state.toastUndo ? undoToast : undefined} />
      )}
    </div>
  );
}
