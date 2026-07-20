import { createEmptyCard, fsrs, generatorParameters, Rating } from 'ts-fsrs';
import type { Card as FsrsCard, CardInput } from 'ts-fsrs';
import type { AnswerSchedule, Card } from './types';

// Deterministic day-level scheduling: no fuzz, no minute-level learning steps.
// A hide is judged at most a handful of times per day, and the checkup flow
// works in days, so the short-term memory model would only add noise here.
const scheduler = fsrs(generatorParameters({ enable_fuzz: false, enable_short_term: false }));

function toCardInput(schedule: AnswerSchedule): CardInput {
  return {
    due: schedule.due,
    stability: schedule.stability,
    difficulty: schedule.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: schedule.reps,
    lapses: schedule.lapses,
    state: schedule.state,
    last_review: schedule.lastReview > 0 ? schedule.lastReview : null,
  };
}

function fromFsrsCard(card: FsrsCard): AnswerSchedule {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review ? card.last_review.getTime() : 0,
  };
}

/** Rate one hide as known (Good) or unknown (Again) and return its next state. */
export function rateAnswer(previous: AnswerSchedule | null | undefined, knew: boolean, now: number): AnswerSchedule {
  const base = previous ? toCardInput(previous) : createEmptyCard(now);
  return fromFsrsCard(scheduler.next(base, now, knew ? Rating.Good : Rating.Again).card);
}

// Hides that were memorized before schedules existed have no FSRS state. They
// are treated as if rated Good when the card was last written, so long-idle
// known hides surface for checkup while fresh ones stay quiet.
const SEED_GOOD_INTERVAL_MS = rateAnswer(null, true, 0).due;

export function answerDueAt(schedule: AnswerSchedule | null | undefined, updatedAt: number): number {
  return schedule ? schedule.due : updatedAt + SEED_GOOD_INTERVAL_MS;
}

export function isValidAnswerSchedule(value: unknown): value is AnswerSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return ['due', 'stability', 'difficulty', 'reps', 'lapses', 'state', 'lastReview']
    .every((key) => typeof entry[key] === 'number' && Number.isFinite(entry[key] as number));
}

export function normalizeAnswerSchedule(
  card: Pick<Card, 'answerSchedule'>,
  answerCount: number,
): Array<AnswerSchedule | null> {
  const stored = Array.isArray(card.answerSchedule) ? card.answerSchedule : [];
  return Array.from({ length: answerCount }, (_, index) => {
    const entry = stored[index];
    return isValidAnswerSchedule(entry) ? entry : null;
  });
}

/** Indexes of known hides whose next check date has passed. */
export function dueAnswerIndexes(
  card: { answerMastery: boolean[]; answerSchedule: Array<AnswerSchedule | null>; updatedAt: number },
  now: number,
): number[] {
  return card.answerMastery.flatMap((known, index) =>
    known && answerDueAt(card.answerSchedule[index], card.updatedAt) <= now ? [index] : []);
}
