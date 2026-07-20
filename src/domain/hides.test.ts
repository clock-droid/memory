import { describe, expect, it } from 'vitest';
import {
  buildHides, dueHides, hideMastery, hideSchedules, hideTexts,
  normalizeAnswerMastery, rateHides, unknownHides, unratedHides,
} from './hides';
import type { AnswerSchedule, Card, CardType } from './types';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 21);

function card(partial: Partial<Card> & { type: CardType }): Card {
  return {
    id: 'c1', prompt: '', answers: [], rawText: '', createdAt: 0, updatedAt: T0 - 30 * DAY, ...partial,
  };
}

function schedule(due: number): AnswerSchedule {
  return { due, stability: 2, difficulty: 5, reps: 1, lapses: 0, state: 2, lastReview: due - DAY };
}

describe('normalizeAnswerMastery', () => {
  it('coerces an array to booleans padded/truncated to the hide count', () => {
    expect(normalizeAnswerMastery({ answerMastery: [true] }, 3)).toEqual([true, false, false]);
    expect(normalizeAnswerMastery({ answerMastery: [true, true, true] }, 2)).toEqual([true, true]);
  });

  it('falls back to the card-level mastered flag when there is no array', () => {
    expect(normalizeAnswerMastery({ mastered: true }, 2)).toEqual([true, true]);
    expect(normalizeAnswerMastery({}, 2)).toEqual([false, false]);
  });

  it('recovers card-level mastery from the legacy empty group schema', () => {
    expect(normalizeAnswerMastery({
      type: 'group', answers: [], answerMastery: [], mastered: true,
    }, 1)).toEqual([true]);
  });
});

describe('buildHides', () => {
  it('pairs each answer with its own judgment and schedule', () => {
    const entry = schedule(T0 + DAY);
    const hides = buildHides(
      card({ type: 'cloze', answerMastery: [true, false], answerSchedule: [entry, null] }),
      ['서울', '부산'],
    );

    expect(hides).toEqual([
      { index: 0, text: '서울', known: true, schedule: entry, dueAt: entry.due },
      { index: 1, text: '부산', known: false, schedule: null, dueAt: hides[1].dueAt },
    ]);
  });

  it('seeds a due date for a known hide saved before schedules existed', () => {
    const [hide] = buildHides(card({ type: 'cloze', answerMastery: [true] }), ['서울']);
    expect(hide.schedule).toBeNull();
    expect(hide.dueAt).toBeGreaterThan(T0 - 30 * DAY);
  });
});

describe('unratedHides', () => {
  it('shows the text but claims no judgment', () => {
    expect(unratedHides(card({ type: 'pair' }), ['깨진 답'])).toMatchObject([
      { index: 0, text: '깨진 답', known: false, schedule: null },
    ]);
  });
});

describe('dueHides', () => {
  const hides = () => buildHides(
    card({
      type: 'cloze',
      answerMastery: [true, true, false, true],
      answerSchedule: [schedule(T0 - DAY), schedule(T0 + DAY), schedule(T0 - DAY), null],
    }),
    ['a', 'b', 'c', 'd'],
  );

  it('returns only known hides whose check date has passed', () => {
    // 0: known+overdue. 1: known+future. 2: unknown. 3: known, seeded from an old card.
    expect(dueHides(hides(), T0).map((hide) => hide.index)).toEqual([0, 3]);
  });

  it('keeps a freshly saved known hide quiet', () => {
    const fresh = buildHides(
      { ...card({ type: 'cloze', answerMastery: [true] }), updatedAt: T0 - 1 },
      ['서울'],
    );
    expect(dueHides(fresh, T0)).toEqual([]);
  });
});

describe('rateHides', () => {
  const hides = () => buildHides(card({ type: 'cloze', answerMastery: [false, false] }), ['a', 'b']);

  it('marks a judged hide known unless the user asked to retry it', () => {
    const rated = rateHides(hides(), [0, 1], new Set([1]), T0);
    expect(rated.map((hide) => hide.known)).toEqual([true, false]);
    expect(rated[0].schedule).not.toBeNull();
    expect(rated[0].dueAt).toBe(rated[0].schedule?.due);
  });

  it('leaves hides that were not asked untouched', () => {
    const before = hides();
    const rated = rateHides(before, [0], new Set(), T0);
    expect(rated[1]).toBe(before[1]);
  });

  it('schedules a retried hide sooner than one the user knew', () => {
    const [known] = rateHides(hides(), [0], new Set(), T0);
    const [forgotten] = rateHides(hides(), [0], new Set([0]), T0);
    expect(forgotten.dueAt).toBeLessThan(known.dueAt);
  });
});

describe('hide projections', () => {
  const hides = buildHides(
    card({ type: 'cloze', answerMastery: [true, false], answerSchedule: [schedule(T0), null] }),
    ['서울', '부산'],
  );

  it('projects back to the arrays storage expects', () => {
    expect(hideTexts(hides)).toEqual(['서울', '부산']);
    expect(hideMastery(hides)).toEqual([true, false]);
    expect(hideSchedules(hides)).toEqual([schedule(T0), null]);
  });

  it('lists the hides still to learn', () => {
    expect(unknownHides(hides).map((hide) => hide.text)).toEqual(['부산']);
  });
});
