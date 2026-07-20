import { useEffect } from 'react';
import type { Dispatch } from 'react';
import { reconcileStudyTargets } from '../domain/cards';
import type { ProtoList } from '../domain/cards';
import type { Patch } from '../state/patchState';
import type { RouteState, SessionState } from '../state/uiSlices';
import type { SyncHealth } from '../sync/syncHealth';
import type { Toast } from './useToast';

export type RemoteChangeGuardOptions = {
  syncHealth: SyncHealth;
  activeList: ProtoList | undefined;
  hasDraftList: boolean;
  route: RouteState;
  session: SessionState;
  setSession: Dispatch<Patch<SessionState>>;
  goHome: () => void;
  toast: Toast;
  onLeaveList: () => void;
};

/**
 * Another device can delete the open list or change the card the user is
 * studying. Both are only acted on once the snapshot is trustworthy again:
 * reacting during a reconnect would throw away work over a transient gap.
 */
export function useRemoteChangeGuard({
  syncHealth, activeList, hasDraftList, route, session, setSession, goHome, toast, onLeaveList,
}: RemoteChangeGuardOptions) {
  const isReady = syncHealth.status === 'ready';
  const { view, deckId, sectionId } = route;
  const { queue } = session;

  // The open list no longer exists — leave rather than render an empty shell.
  useEffect(() => {
    if (!isReady || view === 'home' || deckId === null || sectionId === null
      || activeList || hasDraftList) return;
    onLeaveList();
    goHome();
    toast('다른 기기에서 이 암기장이 삭제되어 홈으로 이동했어요');
  }, [isReady, view, deckId, sectionId, activeList, hasDraftList, goHome, toast, onLeaveList]);

  // Hides that vanished mid-session are dropped from the queue, not re-asked.
  useEffect(() => {
    if (!isReady || view !== 'study' || !activeList) return;
    const reconciliation = reconcileStudyTargets(queue, activeList.cards);
    if (reconciliation.removedCount === 0) return;
    setSession((current) => ({
      queue: reconciliation.queue,
      total: Math.max(current.done, current.total - reconciliation.removedCount),
      ...(reconciliation.currentChanged ? { revealed: [], retry: [] } : {}),
    }));
    toast('다른 기기에서 변경된 가림은 이번 학습에서 제외했어요');
  }, [isReady, view, queue, activeList, setSession, toast]);
}
