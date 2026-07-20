import { describe, expect, it } from 'vitest';
import type { AnswerSchedule, Card, CardType } from './types';
import {
  cardNeedsRepair,
  deriveQA,
  keepCard,
  masterySummary,
  normalizeAnswerMastery,
  qaToNewCard,
  reconcileStudyTargets,
  remapAnswerMastery,
  remapAnswerSchedule,
  resolveEditedCardId,
} from './cards';

function card(partial: Partial<Card> & { type: CardType }): Card {
  return {
    id: 'c1',
    prompt: '',
    answers: [],
    rawText: '',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe('deriveQA', () => {
  it('passes a pair card through unchanged', () => {
    expect(deriveQA(card({ type: 'pair', prompt: 'Q', answers: ['A'] }))).toEqual({ q: 'Q', a: ['A'] });
  });

  it('passes a cloze card that already has ___ through unchanged', () => {
    expect(deriveQA(card({ type: 'cloze', prompt: '___ 이다', answers: ['x'] }))).toEqual({
      q: '___ 이다',
      a: ['x'],
    });
  });

  it('rebuilds ___ and extracts answers from a [bracket] cloze prompt', () => {
    expect(deriveQA(card({ type: 'cloze', prompt: '물은 [H2O]', answers: ['H2O'] }))).toEqual({
      q: '물은 ___',
      a: ['H2O'],
    });
  });

  it('joins a bracket-free group card into a single body answer', () => {
    const c = card({
      type: 'group',
      prompt: '과일',
      groupItems: [
        { marker: '- ', text: '사과' },
        { marker: '- ', text: '배' },
      ],
    });
    expect(deriveQA(c)).toEqual({ q: '과일', a: ['- 사과\n- 배'] });
  });

  it('builds cloze lines from a group card whose items contain brackets', () => {
    const c = card({
      type: 'group',
      prompt: '목록',
      groupItems: [{ marker: '1. ', text: '[a] 설명' }],
    });
    expect(deriveQA(c)).toEqual({ q: '목록\n1. ___ 설명', a: ['a'] });
  });

  it('uses the same trimmed bracket answers that the group parser persists', () => {
    const c = card({
      type: 'group',
      prompt: '목록',
      answers: ['a'],
      groupItems: [{ marker: '- ', text: '[ a ] 설명' }],
    });
    expect(deriveQA(c)).toEqual({ q: '목록\n- ___ 설명', a: ['a'] });
  });
});

describe('cardNeedsRepair', () => {
  it('recognizes both explicit quarantine and unmarked legacy zero-answer cards', () => {
    expect(cardNeedsRepair(card({ type: 'pair', prompt: 'Q', answers: [] }))).toBe(true);
    expect(cardNeedsRepair(card({ type: 'cloze', prompt: '___', answers: [], needsRepair: true }))).toBe(true);
    expect(cardNeedsRepair(card({ type: 'pair', prompt: 'Q', answers: ['A'] }))).toBe(false);
    expect(cardNeedsRepair(card({ type: 'cloze', prompt: '___ / ___', answers: ['하나'] }))).toBe(true);
  });

  it('does not quarantine the legacy empty-answer group schema because it has a derivable semantic answer', () => {
    expect(cardNeedsRepair(card({
      type: 'group',
      prompt: '과일',
      answers: [],
      groupItems: [{ marker: '- ', text: '사과' }],
    }))).toBe(false);
  });

  it('quarantines a malformed group without list items instead of inventing its prompt as an answer', () => {
    const malformed = card({
      id: 'broken-group',
      type: 'group',
      prompt: '손상된 묶음',
      answers: [],
      rawText: '손상된 묶음:',
      groupItems: [],
    });
    expect(cardNeedsRepair(malformed)).toBe(true);
    expect(keepCard(malformed)).toMatchObject({
      optimisticId: 'broken-group',
      type: 'pair',
      answers: [],
      needsRepair: true,
      answerMastery: [],
      mastered: false,
    });
  });
});

describe('normalizeAnswerMastery', () => {
  it('coerces an array to booleans padded/truncated to the answer count', () => {
    expect(normalizeAnswerMastery({ answerMastery: [true] }, 3)).toEqual([true, false, false]);
    expect(normalizeAnswerMastery({ answerMastery: [true, true, true] }, 2)).toEqual([true, true]);
  });

  it('falls back to the card-level mastered flag when there is no array', () => {
    expect(normalizeAnswerMastery({ mastered: true }, 2)).toEqual([true, true]);
    expect(normalizeAnswerMastery({}, 2)).toEqual([false, false]);
  });

  it('recovers card-level mastery from the legacy empty group schema', () => {
    expect(normalizeAnswerMastery({
      type: 'group',
      answers: [],
      answerMastery: [],
      mastered: true,
    }, 1)).toEqual([true]);
  });
});

describe('remapAnswerMastery', () => {
  it('keeps mastery for unchanged answers and drops it for changed ones', () => {
    const c = card({ type: 'pair', prompt: 'Q', answers: ['a', 'b'], answerMastery: [true, true] });
    expect(remapAnswerMastery(c, ['a', 'X'])).toEqual([true, false]);
  });

  it('drops mastery for reordered answers (compares by same index, not membership)', () => {
    const c = card({ type: 'pair', prompt: 'Q', answers: ['a', 'b'], answerMastery: [true, true] });
    expect(remapAnswerMastery(c, ['b', 'a'])).toEqual([false, false]);
  });
});

describe('remapAnswerSchedule', () => {
  const entry = (due: number): AnswerSchedule =>
    ({ due, stability: 2, difficulty: 5, reps: 1, lapses: 0, state: 2, lastReview: due - 1000 });

  it('keeps the schedule for unchanged answers and restarts changed ones', () => {
    const c = card({
      type: 'pair', prompt: 'Q', answers: ['a', 'b'],
      answerSchedule: [entry(100), entry(200)],
    });
    expect(remapAnswerSchedule(c, ['a', 'X'])).toEqual([entry(100), null]);
  });

  it('restarts every hide when answers are reordered', () => {
    const c = card({
      type: 'pair', prompt: 'Q', answers: ['a', 'b'],
      answerSchedule: [entry(100), entry(200)],
    });
    expect(remapAnswerSchedule(c, ['b', 'a'])).toEqual([null, null]);
  });

  it('pads with nulls when a card gains a hide', () => {
    const c = card({ type: 'pair', prompt: 'Q', answers: ['a'], answerSchedule: [entry(100)] });
    expect(remapAnswerSchedule(c, ['a', 'new'])).toEqual([entry(100), null]);
  });
});

describe('masterySummary', () => {
  it('sums answer counts and known counts across proto cards', () => {
    const protos = [
      { a: ['x', 'y'], knownCount: 1 },
      { a: ['z'], knownCount: 1 },
    ] as unknown as Parameters<typeof masterySummary>[0];
    expect(masterySummary(protos)).toEqual({ total: 3, known: 2 });
  });

  it('returns zeros for an empty list', () => {
    expect(masterySummary([])).toEqual({ total: 0, known: 0 });
  });
});

describe('reconcileStudyTargets', () => {
  it('removes targets deleted by another device and reports the current-card change', () => {
    const result = reconcileStudyTargets(
      [
        { cardId: 'deleted', answerIndexes: [0, 1] },
        { cardId: 'kept', answerIndexes: [0] },
      ],
      [{ id: 'kept', a: ['답'] }],
    );

    expect(result).toEqual({
      queue: [{ cardId: 'kept', answerIndexes: [0] }],
      removedCount: 2,
      currentChanged: true,
    });
  });

  it('drops answer indexes that no longer exist after an external card edit', () => {
    const result = reconcileStudyTargets(
      [{ cardId: 'card-1', answerIndexes: [0, 1, 2] }],
      [{ id: 'card-1', a: ['첫째', '둘째'] }],
    );

    expect(result.queue).toEqual([{ cardId: 'card-1', answerIndexes: [0, 1] }]);
    expect(result.removedCount).toBe(1);
    expect(result.currentChanged).toBe(true);
  });
});

describe('resolveEditedCardId', () => {
  const cards = [
    { id: 'new-a', q: '질문 A', a: ['답 A'] },
    { id: 'new-b', q: '질문 B', a: ['답 B'] },
  ];

  it('keeps using the stable id when it still exists', () => {
    expect(resolveEditedCardId(cards, 'new-b', JSON.stringify(['질문 A', ['답 A']]))).toBe('new-b');
  });

  it('rebinds a regenerated id only when the original content has one match', () => {
    expect(resolveEditedCardId(cards, 'old-a', JSON.stringify(['질문 A', ['답 A']]))).toBe('new-a');
  });

  it('refuses to guess when the target was deleted or has duplicate matches', () => {
    expect(resolveEditedCardId(cards, 'deleted', JSON.stringify(['없음', ['없음']]))).toBeNull();
    expect(resolveEditedCardId([...cards, { id: 'copy-a', q: '질문 A', a: ['답 A'] }], 'deleted', JSON.stringify(['질문 A', ['답 A']]))).toBeNull();
  });
});

describe('qaToNewCard', () => {
  it('makes a cloze card when the prompt has ___ (rawText is the prompt)', () => {
    expect(qaToNewCard('___ 이다', ['x'])).toMatchObject({
      type: 'cloze',
      prompt: '___ 이다',
      rawText: '___ 이다',
      answers: ['x'],
    });
  });

  it('makes a pair card when there is no ___ (rawText is "Q: A")', () => {
    expect(qaToNewCard('사과', ['apple'])).toMatchObject({ type: 'pair', rawText: '사과: apple' });
  });

  it('sets mastered only when every answer is mastered', () => {
    expect(qaToNewCard('Q', ['a', 'b'], [true, true]).mastered).toBe(true);
    expect(qaToNewCard('Q', ['a', 'b'], [true, false]).mastered).toBe(false);
  });

  it('defaults every hide to an unscheduled slot and keeps a supplied schedule aligned', () => {
    const entry: AnswerSchedule = { due: 5, stability: 2, difficulty: 5, reps: 1, lapses: 0, state: 2, lastReview: 1 };
    expect(qaToNewCard('Q', ['a', 'b']).answerSchedule).toEqual([null, null]);
    expect(qaToNewCard('Q', ['a', 'b'], [true, false], [entry]).answerSchedule).toEqual([entry, null]);
  });
});

describe('keepCard', () => {
  it('carries the current id as optimisticId and recomputes mastery', () => {
    const c = card({ id: 'c1', type: 'pair', prompt: 'Q', answers: ['a'], answerMastery: [true], mastered: true });
    expect(keepCard(c)).toMatchObject({ optimisticId: 'c1', answerMastery: [true], mastered: true });
  });

  it('honors an explicit answerMastery override', () => {
    const c = card({ id: 'c1', type: 'pair', prompt: 'Q', answers: ['a', 'b'], answerMastery: [true, true] });
    expect(keepCard(c, [true, false])).toMatchObject({ answerMastery: [true, false], mastered: false });
  });

  it('carries per-hide schedules through a section rewrite and drops them when quarantined', () => {
    const entry: AnswerSchedule = { due: 9, stability: 2, difficulty: 5, reps: 1, lapses: 0, state: 2, lastReview: 1 };
    const scheduled = card({
      id: 'c1', type: 'pair', prompt: 'Q', answers: ['a', 'b'],
      answerMastery: [true, false], answerSchedule: [entry, null],
    });
    expect(keepCard(scheduled).answerSchedule).toEqual([entry, null]);

    const broken = card({ id: 'c2', type: 'pair', prompt: 'Q', answers: [], answerSchedule: [entry] });
    expect(keepCard(broken)).toMatchObject({ needsRepair: true, answerSchedule: [] });
  });

  it('migrates a legacy normal group to one semantic answer without losing mastery on a section rewrite', () => {
    const c = card({
      id: 'group-1',
      type: 'group',
      prompt: '과일',
      answers: [],
      answerMastery: [],
      mastered: true,
      groupItems: [
        { marker: '- ', text: '사과' },
        { marker: '- ', text: '배' },
      ],
    });

    expect(keepCard(c)).toMatchObject({
      optimisticId: 'group-1',
      answers: ['- 사과\n- 배'],
      answerMastery: [true],
      mastered: true,
    });
  });

  it('preserves a legacy zero-answer pair as a repair quarantine with no mastery target', () => {
    const c = card({
      id: 'repair-1',
      type: 'pair',
      prompt: '손상된 질문',
      answers: [],
      answerMastery: [true],
      mastered: true,
    });

    expect(deriveQA(c).a).toEqual([]);
    expect(keepCard(c, [true])).toMatchObject({
      optimisticId: 'repair-1',
      needsRepair: true,
      answers: [],
      answerMastery: [],
      mastered: false,
    });
  });

  it('preserves existing answers while quarantining a mismatched legacy cloze', () => {
    const c = card({
      id: 'repair-cloze',
      type: 'cloze',
      prompt: '___ / ___',
      answers: ['기존 답'],
      answerMastery: [true],
      mastered: true,
    });

    expect(keepCard(c)).toMatchObject({
      optimisticId: 'repair-cloze',
      needsRepair: true,
      answers: ['기존 답'],
      answerMastery: [],
      mastered: false,
    });
  });

  it('clears repair quarantine by omission when a real answer is saved from the editor', () => {
    const repaired = qaToNewCard('손상된 질문', ['복구된 답']);
    expect(repaired).not.toHaveProperty('needsRepair');
    expect(repaired).toMatchObject({ answers: ['복구된 답'], answerMastery: [false], mastered: false });
  });
});
