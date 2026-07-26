import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useCardActions } from './actions/useCardActions';
import { useCardEditor } from './actions/useCardEditor';
import { useGlobalPointerRelease } from './actions/useGlobalPointerRelease';
import { useListDraft } from './actions/useListDraft';
import { useRemoteChangeGuard } from './actions/useRemoteChangeGuard';
import { useStudySession } from './actions/useStudySession';
import { useToast } from './actions/useToast';
import { buildLists } from './domain/cards';
import { ACCOUNT_MIGRATION_KEY, DEVICE_STORE_KEY } from './constants';
import { useRoomUi } from './state/useRoomUi';
import { isSyncReadOnly } from './sync/syncHealth';
import { migrateRoomToAccount } from './sync/migrateRepository';
import { createSupabaseRepository } from './sync/supabaseRepository';
import {
  readStorageSelection, writeStorageSelection,
} from './sync/storageSelection';
import type { RepositoryTarget, StorageSelection } from './sync/storageSelection';
import { useAccountSession } from './sync/useAccountSession';
import type { AccountProvider, AccountSession } from './sync/useAccountSession';
import { useRoomStore } from './sync/useRoomStore';
import { ContinuousAddView } from './views/ContinuousAddView';
import { DeckView } from './views/DeckView';
import { EditSheet } from './views/EditSheet';
import { HomeView } from './views/HomeView';
import { IdGate } from './views/IdGate';
import { SettingsSheet } from './views/SettingsSheet';
import { StorageTransferView } from './views/StorageTransferView';
import { StudyView } from './views/StudyView';
import { Toast } from './views/Toast';

const SHELL_STYLE: CSSProperties = {
  height: 'var(--app-viewport-height, 100dvh)', width: '100%', maxWidth: 480, margin: '0 auto', position: 'relative',
  background: '#F2F2F7', color: '#000', display: 'flex', flexDirection: 'column', overflow: 'clip',
};

export default function App() {
  const account = useAccountSession();
  const [selection, setSelection] = useState<StorageSelection | null>(readStorageSelection);
  const selectStorage = (next: StorageSelection) => {
    writeStorageSelection(next);
    setSelection(next);
  };
  const enterAccount = (provider: AccountProvider) => {
    account.clearError();
    selectStorage({ kind: 'account' });
    if (!account.user) void account.signIn(provider);
  };

  let target: RepositoryTarget | null = null;
  if (selection?.kind === 'device') target = selection;
  if (selection?.kind === 'legacy') target = selection;
  if (selection?.kind === 'account' && account.user) {
    target = { kind: 'account', userId: account.user.id };
  }

  if (!target) {
    return (
      <IdGate
        accountConfigured={account.configured}
        accountPending={account.pending || (selection?.kind === 'account' && account.loading)}
        accountError={Boolean(account.error)}
        onDevice={() => selectStorage({ kind: 'device', key: DEVICE_STORE_KEY })}
        onAccount={enterAccount}
        onLegacy={(roomCode) => selectStorage({ kind: 'legacy', roomCode })}
      />
    );
  }

  const roomKey = target.kind === 'legacy'
    ? `legacy:${target.roomCode}`
    : target.kind === 'account'
      ? `account:${target.userId}`
      : `device:${target.key}`;
  return (
    <Room
      key={roomKey}
      target={target}
      account={account}
      onSelectStorage={selectStorage}
    />
  );
}

/**
 * Wires one room together: the synced store, the screen state slices, and the
 * intents the screens can trigger. All of those live in their own modules —
 * this component only hands each screen its slice and decides which is on top.
 */
function Room(props: {
  target: RepositoryTarget;
  account: AccountSession;
  onSelectStorage: (selection: StorageSelection) => void;
}) {
  const { target, account, onSelectStorage } = props;
  const store = useRoomStore(target);
  const ui = useRoomUi();
  const { toast, undoToast } = useToast(ui.setShell);
  const [transferRequested, setTransferRequested] = useState(
    () => localStorage.getItem(ACCOUNT_MIGRATION_KEY) === '1',
  );
  const [transferring, setTransferring] = useState(false);
  const transferStarted = useRef(false);

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
  const visibleList = activeList ?? draft.previewList;
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

  useEffect(() => {
    if (
      !transferRequested
      || transferStarted.current
      || target.kind === 'account'
      || !account.user
      || !store.isReady
    ) return;

    const destination = createSupabaseRepository(account.user.id);
    if (!destination) {
      localStorage.removeItem(ACCOUNT_MIGRATION_KEY);
      setTransferRequested(false);
      toast('계정 동기화를 시작하지 못했어요. 기존 데이터는 그대로예요.');
      return;
    }

    transferStarted.current = true;
    setTransferring(true);
    void migrateRoomToAccount(store.decks, store.deckDataById, destination)
      .then(() => {
        localStorage.removeItem(ACCOUNT_MIGRATION_KEY);
        onSelectStorage({ kind: 'account' });
      })
      .catch(() => {
        localStorage.removeItem(ACCOUNT_MIGRATION_KEY);
        transferStarted.current = false;
        setTransferRequested(false);
        setTransferring(false);
        toast('계정으로 옮기지 못했어요. 기존 데이터는 그대로예요.');
      });
  }, [
    transferRequested,
    target.kind,
    account.user,
    store.isReady,
    store.decks,
    store.deckDataById,
    onSelectStorage,
    toast,
  ]);

  const transferToAccount = (provider?: AccountProvider) => {
    account.clearError();
    localStorage.setItem(ACCOUNT_MIGRATION_KEY, '1');
    setTransferRequested(true);
    if (!account.user && provider) void account.signIn(provider);
  };

  if (transferring) return <StorageTransferView message="카드를 계정으로 옮기는 중…" />;

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

      {!syncReadOnly && ui.route.view === 'deck' && visibleList && (
        <DeckView
          list={visibleList} deck={ui.deck} setDeck={ui.setDeck}
          composerOpen={ui.composer.open}
          shuffle={ui.session.shuffle}
          onToggleShuffle={() => ui.setSession((current) => {
            toast(current.shuffle ? '섞기 끔 — 헷갈린 카드부터' : '섞기 켬 — 순서를 무작위로');
            return { shuffle: !current.shuffle };
          })}
          lpTimer={longPressTimer} rowStart={rowStart}
          onHome={ui.goHome}
          onRename={draft.draft ? draft.renameDraft : renameList}
          onDelete={deleteCard}
          onEdit={editor.openEditFor}
          onMove={moveCard}
          onDeleteList={deleteList}
          onStart={(ids) => activeList && session.startStudy(activeList.deckId, activeList.id, ids)}
          onStartCheckup={() => activeList && session.startCheckup(activeList.deckId, activeList.id)}
          onOpenAdd={draft.openAdd}
          toast={toast}
        />
      )}

      {/* The deck keeps ownership of the page while this non-modal composer is
          open, so cards remain scrollable and editable behind it. */}
      {!syncReadOnly && ui.route.view === 'deck' && ui.composer.open && (
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
          target={target}
          accountConfigured={account.configured}
          accountPending={account.pending}
          accountEmail={account.user?.email}
          accountError={Boolean(account.error)}
          transferPending={transferRequested || transferring}
          onClose={() => ui.setShell({ settingsOpen: false })}
          onChangeLegacy={(roomCode) => onSelectStorage({ kind: 'legacy', roomCode })}
          onTransferToAccount={transferToAccount}
          onSignOut={() => { void account.signOut(); }}
        />
      )}

      {ui.shell.toastVisible && (
        <Toast message={ui.shell.toastMessage} onUndo={ui.shell.toastUndo ? undoToast : undefined} />
      )}
    </div>
  );
}
