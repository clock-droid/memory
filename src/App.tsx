import { useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useCardActions } from './actions/useCardActions';
import { useCardEditor } from './actions/useCardEditor';
import { useGlobalPointerRelease } from './actions/useGlobalPointerRelease';
import { useListDraft } from './actions/useListDraft';
import { useRemoteChangeGuard } from './actions/useRemoteChangeGuard';
import { useStudySession } from './actions/useStudySession';
import { useToast } from './actions/useToast';
import { buildLists } from './domain/cards';
import { ROOM_KEY } from './constants';
import { useRoomUi } from './state/useRoomUi';
import { isSyncReadOnly } from './sync/syncHealth';
import { useRoomStore } from './sync/useRoomStore';
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
 * Wires one room together: the synced store, the screen state slices, and the
 * intents the screens can trigger. All of those live in their own modules —
 * this component only hands each screen its slice and decides which is on top.
 */
function Room({ roomCode, onChangeRoom }: { roomCode: string; onChangeRoom: (code: string) => void }) {
  const store = useRoomStore(roomCode);
  const ui = useRoomUi();
  const { toast, undoToast } = useToast(ui.setShell);

  const lists = useMemo(
    () => buildLists(store.decks, store.deckDataById),
    [store.decks, store.deckDataById],
  );
  const activeList = lists.find((list) => list.deckId === ui.route.deckId && list.id === ui.route.sectionId);

  const { commitSection, renameList, deleteCard, moveCard, deleteList } = useCardActions({
    store, activeList, setDeck: ui.setDeck, goHome: ui.goHome, toast,
  });
  const editor = useCardEditor({ store, activeList, commitSection, setEditor: ui.setEditor, toast });
  const draft = useListDraft({
    store, activeList, commitSection,
    setRoute: ui.setRoute, setComposer: ui.setComposer, setDeck: ui.setDeck, goHome: ui.goHome, toast,
  });
  const session = useStudySession({
    store, lists, activeList,
    session: ui.session, setSession: ui.setSession, setRoute: ui.setRoute,
    startSession: ui.startSession, openList: ui.openList, toast,
  });

  // Row gesture scratch state, owned here because the pointer release that ends
  // a gesture is handled on the window rather than inside the row.
  const longPressTimer = useRef<number | undefined>(undefined);
  const rowStart = useRef<{ x: number; y: number; moved: boolean }>({ x: 0, y: 0, moved: false });
  useGlobalPointerRelease({
    setComposer: ui.setComposer, setEditor: ui.setEditor, setDeck: ui.setDeck, longPressTimer,
  });

  useRemoteChangeGuard({
    syncHealth: store.syncHealth,
    activeList,
    hasDraftList: Boolean(draft.draft),
    route: ui.route,
    session: ui.session,
    setSession: ui.setSession,
    goHome: ui.goHome,
    toast,
    onLeaveList: draft.forgetLastAdd,
  });

  // A stale or failing snapshot may only be read: writing onto it would resolve
  // conflicts against data the user can no longer see.
  const syncReadOnly = isSyncReadOnly(store.syncHealth.status);

  return (
    <div style={SHELL_STYLE}>
      {(ui.route.view === 'home' || syncReadOnly) && (
        <HomeView
          lists={lists}
          decksState={store.syncHealth.status}
          syncPending={store.syncHealth.pending}
          onRetry={store.retry}
          onOpenList={(list) => {
            ui.openList(list.deckId, list.id);
            ui.setDeck({ filter: 'all' });
          }}
          onContinue={(list) => session.startStudy(list.deckId, list.id)}
          onNewList={draft.startNewList}
          onOpenSettings={() => ui.setShell({ settingsOpen: true })}
        />
      )}

      {!syncReadOnly && ui.route.view === 'deck' && activeList && !ui.composer.open && (
        <DeckView
          list={activeList} deck={ui.deck} setDeck={ui.setDeck}
          shuffle={ui.session.shuffle}
          onToggleShuffle={() => ui.setSession((current) => {
            toast(current.shuffle ? '섞기 끔 — 헷갈린 카드부터' : '섞기 켬 — 순서를 무작위로');
            return { shuffle: !current.shuffle };
          })}
          lpTimer={longPressTimer} rowStart={rowStart}
          onHome={ui.goHome}
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

      {!syncReadOnly && ui.route.view === 'deck' && ui.composer.open && (activeList || draft.draft) && (
        <ContinuousAddView
          composer={ui.composer}
          setComposer={ui.setComposer}
          onAddCards={draft.addCards}
          onUndoLast={draft.undoLastAdd}
          onClose={draft.closeAdd}
        />
      )}

      {!syncReadOnly && ui.route.view === 'study' && (
        <StudyView
          list={activeList} session={ui.session} setSession={ui.setSession}
          onComplete={session.completeTarget}
          onDeck={ui.backToDeck}
          onRetryRemaining={() => activeList && session.startStudy(activeList.deckId, activeList.id)}
          onReviewAll={() => activeList && session.startStudy(
            activeList.deckId, activeList.id, activeList.cards.map((card) => card.id),
          )}
        />
      )}

      {!syncReadOnly && !ui.shell.settingsOpen && ui.editor.open && activeList && (
        <EditSheet
          list={activeList} editor={ui.editor} setEditor={ui.setEditor}
          saveEdit={editor.saveEdit}
          onDelete={() => editor.deleteEditingCard(ui.editor)}
          openEditFor={editor.openEditFor}
        />
      )}

      {ui.shell.settingsOpen && (
        <SettingsSheet
          roomCode={roomCode}
          onClose={() => ui.setShell({ settingsOpen: false })}
          onChangeRoom={onChangeRoom}
        />
      )}

      {ui.shell.toastVisible && (
        <Toast message={ui.shell.toastMessage} onUndo={ui.shell.toastUndo ? undoToast : undefined} />
      )}
    </div>
  );
}
