import { useEffect } from 'react';
import { reconcileStudyTargets } from '../cards';
import type { ProtoList } from '../cards';
import type { SyncHealth } from '../syncHealth';
import type { Patch, UIState } from '../uiState';
import type { Toast } from './useToast';

export type RemoteChangeGuardOptions = {
  syncHealth: SyncHealth;
  activeList: ProtoList | undefined;
  hasDraftList: boolean;
  state: UIState;
  dispatch: (patch: Patch) => void;
  toast: Toast;
  onLeaveList: () => void;
};

/**
 * Another device can delete the open list or change the card the user is
 * studying. Both are only acted on once the snapshot is trustworthy again:
 * reacting during a reconnect would throw away work over a transient gap.
 */
export function useRemoteChangeGuard({
  syncHealth, activeList, hasDraftList, state, dispatch, toast, onLeaveList,
}: RemoteChangeGuardOptions) {
  const isReady = syncHealth.status === 'ready';
  const { view, activeDeckId, activeSectionId, queue } = state;

  // The open list no longer exists — leave rather than render an empty shell.
  useEffect(() => {
    if (!isReady || view === 'home' || activeDeckId === null || activeSectionId === null
      || activeList || hasDraftList) return;
    onLeaveList();
    dispatch({
      view: 'home', activeDeckId: null, activeSectionId: null,
      queue: [], revealedIdx: [], retryAnswerIdx: [],
      openRowId: null, slotOpen: false, editSheetOpen: false,
    });
    toast('다른 기기에서 이 암기장이 삭제되어 홈으로 이동했어요');
  }, [isReady, view, activeDeckId, activeSectionId, activeList, hasDraftList, dispatch, toast, onLeaveList]);

  // Hides that vanished mid-session are dropped from the queue, not re-asked.
  useEffect(() => {
    if (!isReady || view !== 'study' || !activeList) return;
    const reconciliation = reconcileStudyTargets(queue, activeList.cards);
    if (reconciliation.removedCount === 0) return;
    dispatch((current) => ({
      queue: reconciliation.queue,
      sessionTotal: Math.max(current.sessionDone, current.sessionTotal - reconciliation.removedCount),
      ...(reconciliation.currentChanged ? { revealedIdx: [], retryAnswerIdx: [] } : {}),
    }));
    toast('다른 기기에서 변경된 가림은 이번 학습에서 제외했어요');
  }, [isReady, view, queue, activeList, dispatch, toast]);
}
