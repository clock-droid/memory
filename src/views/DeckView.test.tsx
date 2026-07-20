import { createElement } from 'react';
import type { MutableRefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DeckView } from './DeckView';
import { rateAnswer } from '../domain/answerSchedule';
import { toProtoCard } from '../domain/cards';
import type { ProtoCard, ProtoList } from '../domain/cards';
import { initialDeckUi } from '../state/uiSlices';
import type { AnswerSchedule, Card } from '../domain/types';

const DAY = 86_400_000;
const NOW = Date.now();

beforeAll(() => {
  // DeckView reads the one-time gesture hint flag during render.
  vi.stubGlobal('localStorage', { getItem: () => '1', setItem: () => {} });
});

/** Builds the view model the way the app does, from a stored card. */
function protoCard(options: {
  answers?: string[];
  mastery?: boolean[];
  schedules?: Array<AnswerSchedule | null>;
  /** Fewer answers than blanks quarantines the card for repair. */
  broken?: boolean;
} = {}): ProtoCard {
  const answers = options.answers ?? ['서울'];
  const blanks = options.broken ? answers.length + 1 : answers.length;
  const source: Card = {
    id: 'c1',
    type: 'cloze',
    prompt: Array.from({ length: blanks }, () => '___').join(' '),
    answers,
    rawText: answers.map((answer) => `[${answer}]`).join(' '),
    answerMastery: options.mastery ?? answers.map(() => false),
    answerSchedule: options.schedules,
    createdAt: 0,
    updatedAt: NOW,
  };
  return toProtoCard(source);
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
      answers: ['서울'], mastery: [true], schedules: [schedule(NOW + DAY)],
    })]);

    expect(markup).not.toContain('다시 점검할 가림');
  });

  it('counts only known hides whose check date has passed', () => {
    const markup = renderDeck([protoCard({
      answers: ['서울', '부산', '대구'],
      // known+overdue, known+future, unknown+overdue
      mastery: [true, true, false],
      schedules: [schedule(NOW - DAY), schedule(NOW + DAY), schedule(NOW - DAY)],
    })]);

    expect(markup).toContain('다시 점검할 가림 1개');
    expect(markup).toContain('외운 지 시간이 지나 잊었을 수 있어요');
  });

  it('never proposes a checkup for a card that needs repair', () => {
    const markup = renderDeck([protoCard({ broken: true, answers: ['서울'], mastery: [true] })]);

    expect(markup).not.toContain('다시 점검할 가림');
  });

  it('leaves a hide judged known today out of the checkup queue', () => {
    const markup = renderDeck([protoCard({
      answers: ['서울'], mastery: [true], schedules: [rateAnswer(null, true, NOW)],
    })]);

    expect(markup).not.toContain('다시 점검할 가림');
  });
});
