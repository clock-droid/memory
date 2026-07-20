import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import type { ProtoList } from '../domain/cards';
import { rateHides } from '../domain/hides';
import type { Patch } from '../state/patchState';
import type { RouteState, SessionState } from '../state/uiSlices';
import type { SessionRun } from '../state/useRoomUi';
import { countHides, planCheckupSession, planStudySession, shuffleTargets } from '../domain/studySession';
import type { StudyPlan } from '../domain/studySession';
import type { RoomStore } from '../sync/useRoomStore';
import type { Toast } from './useToast';

export type StudySessionOptions = {
  store: RoomStore;
  lists: ProtoList[];
  activeList: ProtoList | undefined;
  session: SessionState;
  setSession: Dispatch<Patch<SessionState>>;
  setRoute: Dispatch<Patch<RouteState>>;
  startSession: (deckId: string, sectionId: string, run: SessionRun) => void;
  openList: (deckId: string, sectionId: string) => void;
  toast: Toast;
};

/**
 * Starting and finishing sessions. A session is a queue of hides, never a queue
 * of cards: finishing one card can leave its known hides untouched.
 */
export function useStudySession({
  store, lists, activeList, session, setSession, setRoute, startSession, openList, toast,
}: StudySessionOptions) {
  // Guards against a double judgment while the first write is still in flight.
  const savingKey = useRef<string | null>(null);
  const { shuffle, queue, retry } = session;

  const applyPlan = useCallback((deckId: string, sectionId: string, plan: StudyPlan) => {
    if (plan.kind === 'empty-list') return openList(deckId, sectionId);
    if (plan.kind === 'needs-repair') {
      openList(deckId, sectionId);
      toast('답이 없는 카드를 먼저 수정해 주세요');
      return;
    }
    if (plan.kind === 'nothing-due') return toast('지금 점검할 가림이 없어요');
    const targets = shuffle ? shuffleTargets(plan.targets) : plan.targets;
    startSession(deckId, sectionId, {
      mode: plan.mode, queue: targets, total: countHides(targets), done: 0, revealed: [], retry: [],
    });
  }, [shuffle, startSession, openList, toast]);

  /** Blocks a start while a card write is in flight — it would study stale ids. */
  const readyToStart = useCallback((deckId: string, blockedMessage: string) => {
    if (!store.hasPendingCardWrites(deckId)) return true;
    toast(blockedMessage);
    return false;
  }, [store, toast]);

  const startStudy = useCallback((deckId: string, sectionId: string, cardIds?: string[]) => {
    if (!readyToStart(deckId, '카드 저장이 끝난 뒤 학습을 시작해 주세요')) return;
    const list = lists.find((item) => item.deckId === deckId && item.id === sectionId);
    if (!list) return;
    applyPlan(deckId, sectionId, planStudySession(list.cards, cardIds));
  }, [lists, readyToStart, applyPlan]);

  // Checkup re-hides known hides whose FSRS due date has passed, so a "known"
  // judgment is re-earned instead of lasting forever.
  const startCheckup = useCallback((deckId: string, sectionId: string) => {
    if (!readyToStart(deckId, '카드 저장이 끝난 뒤 점검을 시작해 주세요')) return;
    const list = lists.find((item) => item.deckId === deckId && item.id === sectionId);
    if (!list) return;
    applyPlan(deckId, sectionId, planCheckupSession(list.cards, Date.now()));
  }, [lists, readyToStart, applyPlan]);

  const completeTarget = useCallback(async () => {
    const target = queue[0];
    if (!activeList || !target) return;
    const card = activeList.cards.find((item) => item.id === target.cardId);
    if (!card) return;
    if (savingKey.current !== null) return;
    const saveKey = `${activeList.deckId}:${card.id}:${target.hideIndexes.join(',')}`;
    savingKey.current = saveKey;

    const previousRetry = [...retry];
    const judged = rateHides(card.hides, target.hideIndexes, new Set(retry), Date.now());

    const save = (hides: typeof judged) => store.saveHides(
      activeList.deckId, card.id, hides,
      { onFailure: () => toast('학습 상태를 저장하지 못했어요. 연결을 복구해 주세요') },
    );

    try {
      const queued = save(judged);
      if (!queued.accepted || !await queued.done) return;
      setSession((current) => {
        const stillCurrent = current.queue[0]?.cardId === target.cardId;
        return {
          queue: stillCurrent ? current.queue.slice(1) : current.queue,
          done: stillCurrent ? current.done + target.hideIndexes.length : current.done,
          revealed: [],
          retry: [],
        };
      });
      toast('판정을 저장했어요', () => { void (async () => {
        const undone = save(card.hides);
        if (!undone.accepted || !await undone.done) return;
        // The toast outlives the screen: undoing from the deck returns to the run.
        setRoute({ view: 'study' });
        setSession((current) => ({
          queue: [target, ...current.queue],
          done: Math.max(0, current.done - target.hideIndexes.length),
          revealed: [...target.hideIndexes],
          retry: previousRetry,
        }));
      })(); });
    } finally {
      if (savingKey.current === saveKey) savingKey.current = null;
    }
  }, [activeList, queue, retry, store, setSession, setRoute, toast]);

  return { startStudy, startCheckup, completeTarget };
}
