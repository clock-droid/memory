import { createElement } from 'react';
import type { MutableRefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DeckView } from './DeckView';
import { rateAnswer } from '../answerSchedule';
import type { ProtoCard, ProtoList } from '../cards';
import { initialDeckUi } from '../state/uiSlices';
import type { AnswerSchedule, Card } from '../types';

const DAY = 86_400_000;
const NOW = Date.now();

beforeAll(() => {
  // DeckView reads the one-time gesture hint flag during render.
  vi.stubGlobal('localStorage', { getItem: () => '1', setItem: () => {} });
});

function protoCard(overrides: Partial<ProtoCard> = {}): ProtoCard {
  const a = overrides.a ?? ['서울'];
  const answerMastery = overrides.answerMastery ?? a.map(() => false);
  const knownCount = answerMastery.filter(Boolean).length;
  const source: Card = {
    id: 'c1', type: 'cloze', prompt: '___', answers: a, rawText: '[서울]', createdAt: 0, updatedAt: NOW,
  };
  return {
    id: 'c1',
    q: '___',
    a,
    answerMastery,
    answerSchedule: a.map(() => null),
    knownCount,
    remainingCount: a.length - knownCount,
    memorized: a.length > 0 && knownCount === a.length,
    needsRepair: false,
    isGroup: false,
    updatedAt: NOW,
    source,
    ...overrides,
  };
}

function renderDeck(cards: ProtoCard[], onStartCheckup = vi.fn()) {
  const list: ProtoList = { id: 's1', deckId: 'd1', name: '암기장', synthetic: false, cards };
  return renderToStaticMarkup(createElement(DeckView, {
    list,
    deck: initialDeckUi,
    setDeck: vi.fn(),
    shuffle: false,
    onToggleShuffle: vi.fn(),
    lpTimer: { current: undefined } as MutableRefObject<number | undefined>,
    rowStart: { current: { x: 0, y: 0, moved: false } },
    onHome: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onMove: vi.fn(),
    onDeleteList: vi.fn(),
    onStart: vi.fn(),
    onStartCheckup,
    onOpenAdd: vi.fn(),
    toast: vi.fn(),
  }));
}

function schedule(due: number): AnswerSchedule {
  return { due, stability: 2, difficulty: 5, reps: 1, lapses: 0, state: 2, lastReview: due - DAY };
}

describe('DeckView checkup banner', () => {
  it('stays hidden while every known hide is still within its interval', () => {
    const markup = renderDeck([protoCard({
      a: ['서울'], answerMastery: [true], answerSchedule: [schedule(NOW + DAY)],
    })]);

    expect(markup).not.toContain('다시 점검할 가림');
  });

  it('counts only known hides whose check date has passed', () => {
    const markup = renderDeck([protoCard({
      a: ['서울', '부산', '대구'],
      // known+overdue, known+future, unknown+overdue
      answerMastery: [true, true, false],
      answerSchedule: [schedule(NOW - DAY), schedule(NOW + DAY), schedule(NOW - DAY)],
    })]);

    expect(markup).toContain('다시 점검할 가림 1개');
    expect(markup).toContain('외운 지 시간이 지나 잊었을 수 있어요');
  });

  it('never proposes a checkup for a card that needs repair', () => {
    const markup = renderDeck([protoCard({
      needsRepair: true, a: [], answerMastery: [], answerSchedule: [], remainingCount: 0, memorized: false,
    })]);

    expect(markup).not.toContain('다시 점검할 가림');
  });

  it('leaves a hide judged known today out of the checkup queue', () => {
    const markup = renderDeck([protoCard({
      a: ['서울'], answerMastery: [true], answerSchedule: [rateAnswer(null, true, NOW)],
    })]);

    expect(markup).not.toContain('다시 점검할 가림');
  });
});
