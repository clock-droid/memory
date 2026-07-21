import { describe, expect, it } from 'vitest';
import type { AnswerSchedule, Card, CardType } from './types';
import type { DeckCacheEntry } from './cards';
import {
  buildLists,
  cardNeedsRepair,
  deriveQA,
  emptyDeckCache,
  keepCard,
  masterySummary,
  qaToNewCard,
  reconcileStudyTargets,
  remapHides,
  resolveEditedCardId,
} from './cards';

/** Minimal hides for tests that only care about their texts. */
function hides(texts: string[]) {
  return texts.map((text, index) => ({ index, text, known: false, schedule: null, dueAt: 0 }));
}

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

describe('remapHides', () => {
  const entry = (due: number): AnswerSchedule =>
    ({ due, stability: 2, difficulty: 5, reps: 1, lapses: 0, state: 2, lastReview: due - 1000 });

  const edited = card({
    type: 'pair', prompt: 'Q', answers: ['a', 'b'],
    answerMastery: [true, true], answerSchedule: [entry(100), entry(200)],
  });

  it('keeps the judgment and the schedule of a hide whose text is unchanged', () => {
    expect(remapHides(edited, ['a', 'X'])).toMatchObject([
      { index: 0, text: 'a', known: true, schedule: entry(100) },
      { index: 1, text: 'X', known: false, schedule: null },
    ]);
  });

  it('restarts every hide when answers are reordered (compares by position, not membership)', () => {
    expect(remapHides(edited, ['b', 'a'])).toMatchObject([
      { text: 'b', known: false, schedule: null },
      { text: 'a', known: false, schedule: null },
    ]);
  });

  it('adds an unrated hide when a card gains one', () => {
    const grown = card({
      type: 'pair', prompt: 'Q', answers: ['a'],
      answerMastery: [true], answerSchedule: [entry(100)],
    });
    expect(remapHides(grown, ['a', 'new'])).toMatchObject([
      { text: 'a', known: true, schedule: entry(100) },
      { text: 'new', known: false, schedule: null },
    ]);
  });
});

describe('masterySummary', () => {
  it('sums answer counts and known counts across proto cards', () => {
    const protos = [
      { hides: [{}, {}], knownCount: 1 },
      { hides: [{}], knownCount: 1 },
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
        { cardId: 'deleted', hideIndexes: [0, 1] },
        { cardId: 'kept', hideIndexes: [0] },
      ],
      [{ id: 'kept', hides: hides(['답']) }],
    );

    expect(result).toEqual({
      queue: [{ cardId: 'kept', hideIndexes: [0] }],
      removedCount: 2,
      currentChanged: true,
    });
  });

  it('drops answer indexes that no longer exist after an external card edit', () => {
    const result = reconcileStudyTargets(
      [{ cardId: 'card-1', hideIndexes: [0, 1, 2] }],
      [{ id: 'card-1', hides: hides(['첫째', '둘째']) }],
    );

    expect(result.queue).toEqual([{ cardId: 'card-1', hideIndexes: [0, 1] }]);
    expect(result.removedCount).toBe(1);
    expect(result.currentChanged).toBe(true);
  });
});

describe('resolveEditedCardId', () => {
  const cards = [
    { id: 'new-a', q: '질문 A', hides: hides(['답 A']) },
    { id: 'new-b', q: '질문 B', hides: hides(['답 B']) },
  ];

  it('keeps using the stable id when it still exists', () => {
    expect(resolveEditedCardId(cards, 'new-b', JSON.stringify(['질문 A', ['답 A']]))).toBe('new-b');
  });

  it('rebinds a regenerated id only when the original content has one match', () => {
    expect(resolveEditedCardId(cards, 'old-a', JSON.stringify(['질문 A', ['답 A']]))).toBe('new-a');
  });

  it('refuses to guess when the target was deleted or has duplicate matches', () => {
    expect(resolveEditedCardId(cards, 'deleted', JSON.stringify(['없음', ['없음']]))).toBeNull();
    const withDuplicate = [...cards, { id: 'copy-a', q: '질문 A', hides: hides(['답 A']) }];
    expect(resolveEditedCardId(withDuplicate, 'deleted', JSON.stringify(['질문 A', ['답 A']]))).toBeNull();
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

  it('leaves every hide unrated when none are carried over', () => {
    expect(qaToNewCard('Q', ['a', 'b'])).toMatchObject({
      answerMastery: [false, false],
      answerSchedule: [null, null],
      mastered: false,
    });
  });

  it('projects the carried hides onto the stored arrays', () => {
    const entry: AnswerSchedule = { due: 5, stability: 2, difficulty: 5, reps: 1, lapses: 0, state: 2, lastReview: 1 };
    const carried = [
      { index: 0, text: 'a', known: true, schedule: entry, dueAt: entry.due },
      { index: 1, text: 'b', known: false, schedule: null, dueAt: 0 },
    ];
    expect(qaToNewCard('Q', ['a', 'b'], carried)).toMatchObject({
      answerMastery: [true, false],
      answerSchedule: [entry, null],
      mastered: false,
    });
  });

  it('sets mastered only when every carried hide is known', () => {
    const known = (text: string, index: number) =>
      ({ index, text, known: true, schedule: null, dueAt: 0 });
    expect(qaToNewCard('Q', ['a', 'b'], ['a', 'b'].map(known)).mastered).toBe(true);
  });
});

describe('keepCard', () => {
  it('carries the current id as optimisticId and recomputes mastery', () => {
    const c = card({ id: 'c1', type: 'pair', prompt: 'Q', answers: ['a'], answerMastery: [true], mastered: true });
    expect(keepCard(c)).toMatchObject({ optimisticId: 'c1', answerMastery: [true], mastered: true });
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
    expect(keepCard(c)).toMatchObject({
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

describe('buildLists', () => {
  const deck = { id: 'd1', name: '일반', createdAt: 0, updatedAt: 0 };
  const section = (id: string, name: string) => ({ id, name, sourceText: '', createdAt: 0, updatedAt: 0 });
  const cache = (partial: Partial<DeckCacheEntry>): Record<string, DeckCacheEntry> => ({
    d1: { ...emptyDeckCache(), ...partial },
  });

  it('groups each card under the section it belongs to', () => {
    const lists = buildLists([deck], cache({
      sections: [section('s1', '1과'), section('s2', '2과')],
      cards: [
        card({ id: 'a', type: 'pair', prompt: 'Q1', answers: ['A'], sectionId: 's1' }),
        card({ id: 'b', type: 'pair', prompt: 'Q2', answers: ['A'], sectionId: 's2' }),
      ],
    }));
    expect(lists.map((list) => [list.name, list.cards.map((c) => c.id)]))
      .toEqual([['1과', ['a']], ['2과', ['b']]]);
  });

  it('renames the legacy default section name', () => {
    const lists = buildLists([deck], cache({ sections: [section('s1', '새 목록')] }));
    expect(lists[0].name).toBe('새 암기장');
  });

  it('keeps cards whose section was deleted in a synthetic list', () => {
    const lists = buildLists([deck], cache({
      sections: [section('s1', '1과')],
      cards: [card({ id: 'orphan', type: 'pair', prompt: 'Q', answers: ['A'], sectionId: 'gone' })],
    }));
    expect(lists).toHaveLength(2);
    expect(lists[1]).toMatchObject({ id: 'gone', name: '기본', synthetic: true });
    expect(lists[1].cards.map((c) => c.id)).toEqual(['orphan']);
  });

  it('exposes hide-level progress rather than a card-level flag', () => {
    const lists = buildLists([deck], cache({
      sections: [section('s1', '1과')],
      cards: [card({
        id: 'a', type: 'cloze', prompt: '___ 이고 ___ 이다',
        answers: ['x', 'y'], answerMastery: [true, false], sectionId: 's1',
      })],
    }));
    expect(lists[0].cards[0]).toMatchObject({ knownCount: 1, remainingCount: 1, memorized: false });
  });

  it('yields no list for a deck whose data has not arrived yet', () => {
    expect(buildLists([deck], {})).toEqual([]);
  });
});
