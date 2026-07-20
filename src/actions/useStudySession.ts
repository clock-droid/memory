import { useCallback, useRef } from 'react';
import { rateAnswer } from '../answerSchedule';
import type { ProtoList } from '../cards';
import { countHides, planCheckupSession, planStudySession, shuffleTargets } from '../studySession';
import type { StudyPlan } from '../studySession';
import type { RoomStore } from '../sync/useRoomStore';
import type { Patch, UIState } from '../uiState';
import type { Toast } from './useToast';

export type StudySessionOptions = {
  store: RoomStore;
  lists: ProtoList[];
  activeList: ProtoList | undefined;
  state: UIState;
  dispatch: (patch: Patch) => void;
  toast: Toast;
};

/**
 * Starting and finishing sessions. A session is a queue of hides, never a queue
 * of cards: finishing one card can leave its known hides untouched.
 */
export function useStudySession({ store, lists, activeList, state, dispatch, toast }: StudySessionOptions) {
  // Guards against a double judgment while the first write is still in flight.
  const savingKey = useRef<string | null>(null);
  const { shuffle, queue, retryAnswerIdx } = state;

  const applyPlan = useCallback((deckId: string, sectionId: string, plan: StudyPlan) => {
    const openDeck = () => dispatch({ view: 'deck', activeDeckId: deckId, activeSectionId: sectionId });
    if (plan.kind === 'empty-list') return openDeck();
    if (plan.kind === 'needs-repair') {
      openDeck();
      toast('답이 없는 카드를 먼저 수정해 주세요');
      return;
    }
    if (plan.kind === 'nothing-due') return toast('지금 점검할 가림이 없어요');
    const targets = shuffle ? shuffleTargets(plan.targets) : plan.targets;
    dispatch({
      view: 'study', activeDeckId: deckId, activeSectionId: sectionId,
      queue: targets, sessionTotal: countHides(targets), sessionDone: 0,
      revealedIdx: [], retryAnswerIdx: [], openRowId: null, sessionMode: plan.mode,
    });
  }, [shuffle, dispatch, toast]);

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
    const saveKey = `${activeList.deckId}:${card.id}:${target.answerIndexes.join(',')}`;
    savingKey.current = saveKey;

    const retried = new Set(retryAnswerIdx);
    const previousRetry = [...retryAnswerIdx];
    const previousMastery = [...card.answerMastery];
    const previousSchedule = [...card.answerSchedule];
    const nextMastery = [...card.answerMastery];
    const nextSchedule = [...card.answerSchedule];
    const judgedAt = Date.now();
    for (const answerIndex of target.answerIndexes) {
      const knew = !retried.has(answerIndex);
      nextMastery[answerIndex] = knew;
      nextSchedule[answerIndex] = rateAnswer(card.answerSchedule[answerIndex], knew, judgedAt);
    }

    const save = (mastery: boolean[], schedule: typeof nextSchedule) => store.saveAnswerMastery(
      activeList.deckId, card.id, mastery, schedule,
      { onFailure: () => toast('학습 상태를 저장하지 못했어요. 연결을 복구해 주세요') },
    );

    try {
      const queued = save(nextMastery, nextSchedule);
      if (!queued.accepted || !await queued.done) return;
      dispatch((current) => {
        const stillCurrent = current.queue[0]?.cardId === target.cardId;
        return {
          queue: stillCurrent ? current.queue.slice(1) : current.queue,
          sessionDone: stillCurrent ? current.sessionDone + target.answerIndexes.length : current.sessionDone,
          revealedIdx: [],
          retryAnswerIdx: [],
        };
      });
      toast('판정을 저장했어요', () => { void (async () => {
        const undone = save(previousMastery, previousSchedule);
        if (!undone.accepted || !await undone.done) return;
        dispatch((current) => ({
          view: 'study',
          queue: [target, ...current.queue],
          sessionDone: Math.max(0, current.sessionDone - target.answerIndexes.length),
          revealedIdx: [...target.answerIndexes],
          retryAnswerIdx: previousRetry,
        }));
      })(); });
    } finally {
      if (savingKey.current === saveKey) savingKey.current = null;
    }
  }, [activeList, queue, retryAnswerIdx, store, dispatch, toast]);

  return { startStudy, startCheckup, completeTarget };
}
