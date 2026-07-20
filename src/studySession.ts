import { answerDueAt, dueAnswerIndexes } from './answerSchedule';
import { weakestFirst } from './cards';
import type { ProtoCard } from './cards';
import type { SessionMode, StudyTarget } from './types';

/**
 * What a start request resolved to. Anything other than `session` means the
 * list cannot be studied right now and the caller should stay on the deck.
 */
export type StudyPlan =
  | { kind: 'session'; mode: SessionMode; targets: StudyTarget[] }
  | { kind: 'empty-list' }
  | { kind: 'needs-repair' }
  | { kind: 'nothing-due' };

/**
 * The hides one card contributes to a session: the ones the user does not know
 * yet, or — when the whole card is known — all of them, for a fresh pass.
 */
function targetsOf(card: ProtoCard): StudyTarget {
  const unknown = card.answerMastery.flatMap((known, index) => (known ? [] : [index]));
  return {
    cardId: card.id,
    answerIndexes: unknown.length > 0 ? unknown : card.a.map((_, index) => index),
  };
}

function toQueue(cards: ProtoCard[]): StudyTarget[] {
  return cards.map(targetsOf).filter((target) => target.answerIndexes.length > 0);
}

export function countHides(queue: StudyTarget[]) {
  return queue.reduce((total, target) => total + target.answerIndexes.length, 0);
}

/**
 * Plans a study session over a list.
 *
 * `cardIds` studies exactly those cards; otherwise the unknown cards are
 * studied weakest first. When nothing is unknown the session becomes a review
 * of everything, so "다시 학습" never dead-ends on an empty queue.
 */
export function planStudySession(cards: ProtoCard[], cardIds?: string[]): StudyPlan {
  if (cards.length === 0) return { kind: 'empty-list' };
  const eligible = cards.filter((card) => !card.needsRepair);
  const requested = cardIds
    ? cardIds.map((id) => cards.find((card) => card.id === id)).filter((card): card is ProtoCard => Boolean(card))
    : weakestFirst(cards.filter((card) => card.remainingCount > 0));
  const selected = requested.filter((card) => !card.needsRepair);
  if (selected.length === 0 && eligible.length === 0) return { kind: 'needs-repair' };
  if (selected.length === 0) return { kind: 'session', mode: 'review', targets: toQueue(eligible) };
  const mode: SessionMode = selected.every((card) => card.remainingCount === 0) ? 'review' : 'learn';
  return { kind: 'session', mode, targets: toQueue(selected) };
}

/**
 * Plans a checkup: only hides whose FSRS due date has passed, most overdue card
 * first, because the longest-unchecked memories are the most at risk.
 */
export function planCheckupSession(cards: ProtoCard[], now: number): StudyPlan {
  const entries = cards
    .filter((card) => !card.needsRepair)
    .map((card) => ({ card, answerIndexes: dueAnswerIndexes(card, now) }))
    .filter((entry) => entry.answerIndexes.length > 0);
  if (entries.length === 0) return { kind: 'nothing-due' };
  const dueAtOf = ({ card, answerIndexes }: (typeof entries)[number]) =>
    Math.min(...answerIndexes.map((index) => answerDueAt(card.answerSchedule[index], card.updatedAt)));
  const ordered = [...entries].sort((x, y) => dueAtOf(x) - dueAtOf(y));
  return {
    kind: 'session',
    mode: 'checkup',
    targets: ordered.map(({ card, answerIndexes }) => ({ cardId: card.id, answerIndexes })),
  };
}

/** Fisher-Yates. Kept out of the planners so those stay deterministic. */
export function shuffleTargets(queue: StudyTarget[]): StudyTarget[] {
  const shuffled = [...queue];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
