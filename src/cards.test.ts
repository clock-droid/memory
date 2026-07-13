import { describe, expect, it } from 'vitest';
import type { Card, CardType } from './types';
import {
  deriveQA,
  keepCard,
  masterySummary,
  normalizeAnswerMastery,
  qaToNewCard,
  remapAnswerMastery,
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
});
