import { describe, expect, it } from 'vitest';
import {
  answerDueAt,
  dueAnswerIndexes,
  isValidAnswerSchedule,
  normalizeAnswerSchedule,
  rateAnswer,
} from './answerSchedule';
import type { AnswerSchedule } from './types';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 21);

function schedule(partial: Partial<AnswerSchedule> = {}): AnswerSchedule {
  return { due: T0, stability: 1, difficulty: 5, reps: 1, lapses: 0, state: 2, lastReview: T0 - DAY, ...partial };
}

describe('rateAnswer', () => {
  it('schedules a first Good several days out instead of within the session', () => {
    const rated = rateAnswer(null, true, T0);
    expect(rated.due - T0).toBeGreaterThanOrEqual(DAY);
    expect(rated.reps).toBe(1);
    expect(rated.lapses).toBe(0);
    expect(rated.lastReview).toBe(T0);
  });

  it('grows the interval when a hide survives its scheduled gap', () => {
    const first = rateAnswer(null, true, T0);
    const second = rateAnswer(first, true, first.due);
    expect(second.due - first.due).toBeGreaterThan(first.due - T0);
    expect(second.reps).toBe(2);
  });

  it('collapses the interval and records a lapse on Again', () => {
    const first = rateAnswer(null, true, T0);
    const failedAt = first.due;
    const failed = rateAnswer(first, false, failedAt);
    expect(failed.lapses).toBe(first.lapses + 1);
    expect(failed.due - failedAt).toBeLessThanOrEqual(DAY);
    expect(failed.due - failedAt).toBeGreaterThan(0);
  });

  it('is deterministic for identical inputs', () => {
    expect(rateAnswer(null, true, T0)).toEqual(rateAnswer(null, true, T0));
  });

  it('keeps a sane day-level interval when re-rated within the same day', () => {
    const first = rateAnswer(null, true, T0);
    const again = rateAnswer(first, true, T0);
    expect(again.due - T0).toBeGreaterThanOrEqual(DAY);
  });
});

describe('answerDueAt', () => {
  it('uses the stored due date when a schedule exists', () => {
    expect(answerDueAt(schedule({ due: T0 + 5 * DAY }), T0)).toBe(T0 + 5 * DAY);
  });

  it('seeds unscheduled hides as if rated Good at the card timestamp', () => {
    const seededDue = answerDueAt(null, T0);
    expect(seededDue - T0).toBe(rateAnswer(null, true, 0).due);
    expect(seededDue).toBeGreaterThan(T0);
  });
});

describe('isValidAnswerSchedule', () => {
  it('accepts a complete numeric entry', () => {
    expect(isValidAnswerSchedule(schedule())).toBe(true);
  });

  it.each([
    ['null', null],
    ['array', []],
    ['missing field', { due: 1, stability: 1, difficulty: 1, reps: 1, lapses: 0, state: 2 }],
    ['non-numeric field', schedule({ due: Number.NaN })],
    ['string field', { ...schedule(), due: 'tomorrow' }],
  ])('rejects %s', (_label, value) => {
    expect(isValidAnswerSchedule(value)).toBe(false);
  });
});

describe('normalizeAnswerSchedule', () => {
  it('pads and trims to the answer count', () => {
    const entry = schedule();
    expect(normalizeAnswerSchedule({ answerSchedule: [entry] }, 3)).toEqual([entry, null, null]);
    expect(normalizeAnswerSchedule({ answerSchedule: [entry, entry, entry] }, 1)).toEqual([entry]);
  });

  it('nulls malformed entries and missing arrays', () => {
    expect(normalizeAnswerSchedule({ answerSchedule: [{ due: 1 } as AnswerSchedule] }, 1)).toEqual([null]);
    expect(normalizeAnswerSchedule({}, 2)).toEqual([null, null]);
  });
});

describe('dueAnswerIndexes', () => {
  it('returns only known hides whose check date has passed', () => {
    const overdue = schedule({ due: T0 - DAY });
    const future = schedule({ due: T0 + DAY });
    const card = {
      answerMastery: [true, true, false, true],
      answerSchedule: [overdue, future, overdue, null],
      updatedAt: T0 - 30 * DAY,
    };
    // index 0: known+overdue → due. index 1: known+future → not due.
    // index 2: unknown → never due. index 3: known, seeded from an old card → due.
    expect(dueAnswerIndexes(card, T0)).toEqual([0, 3]);
  });

  it('keeps freshly saved known hides quiet', () => {
    const card = { answerMastery: [true], answerSchedule: [null], updatedAt: T0 - 1 };
    expect(dueAnswerIndexes(card, T0)).toEqual([]);
  });
});
