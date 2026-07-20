import { describe, expect, it } from 'vitest';
import { toProtoCard } from './cards';
import type { ProtoCard } from './cards';
import { countHides, planCheckupSession, planStudySession } from './studySession';
import type { AnswerSchedule, Card, CardType } from './types';

const DAY = 24 * 60 * 60 * 1000;

function protoCard(partial: Partial<Card> & { type: CardType; id: string }): ProtoCard {
  return toProtoCard({
    prompt: '',
    answers: [],
    rawText: '',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  });
}

/** Two hides, mastery per hide as given. */
function pairCard(id: string, mastery: boolean[]): ProtoCard {
  return protoCard({
    id,
    type: 'cloze',
    prompt: '___ 이고 ___ 이다',
    answers: ['a', 'b'],
    answerMastery: mastery,
  });
}

function schedule(dueAt: number): AnswerSchedule {
  return { due: dueAt, stability: 1, difficulty: 5, reps: 1, lapses: 0, state: 2, lastReview: 0 };
}

describe('planStudySession', () => {
  it('reports an empty list instead of starting a session', () => {
    expect(planStudySession([])).toEqual({ kind: 'empty-list' });
  });

  it('queues only the hides the user does not know yet', () => {
    const plan = planStudySession([pairCard('c1', [true, false])]);
    expect(plan).toEqual({
      kind: 'session',
      mode: 'learn',
      targets: [{ cardId: 'c1', hideIndexes: [1] }],
    });
  });

  it('puts the card with the most unknown hides first', () => {
    const plan = planStudySession([pairCard('one-left', [true, false]), pairCard('two-left', [false, false])]);
    expect(plan.kind === 'session' && plan.targets.map((target) => target.cardId))
      .toEqual(['two-left', 'one-left']);
  });

  it('reviews every hide of every card when nothing is unknown', () => {
    const plan = planStudySession([pairCard('c1', [true, true])]);
    expect(plan).toEqual({
      kind: 'session',
      mode: 'review',
      targets: [{ cardId: 'c1', hideIndexes: [0, 1] }],
    });
  });

  it('reviews all hides of a fully known card that was requested by id', () => {
    const plan = planStudySession([pairCard('c1', [true, true])], ['c1']);
    expect(plan).toEqual({
      kind: 'session',
      mode: 'review',
      targets: [{ cardId: 'c1', hideIndexes: [0, 1] }],
    });
  });

  it('studies exactly the requested cards, skipping the rest', () => {
    const plan = planStudySession([pairCard('c1', [false, false]), pairCard('c2', [false, false])], ['c2']);
    expect(plan.kind === 'session' && plan.targets.map((target) => target.cardId)).toEqual(['c2']);
  });

  it('asks for repair when every card is broken', () => {
    const broken = protoCard({ id: 'broken', type: 'cloze', prompt: '___ ___', answers: ['only-one'] });
    expect(broken.needsRepair).toBe(true);
    expect(planStudySession([broken])).toEqual({ kind: 'needs-repair' });
  });

  it('leaves a broken card out of a session with healthy cards', () => {
    const broken = protoCard({ id: 'broken', type: 'cloze', prompt: '___ ___', answers: ['only-one'] });
    const plan = planStudySession([broken, pairCard('ok', [false, false])]);
    expect(plan.kind === 'session' && plan.targets.map((target) => target.cardId)).toEqual(['ok']);
  });
});

describe('planCheckupSession', () => {
  const now = 10 * DAY;

  it('reports nothing due when no known hide has come due', () => {
    const card = protoCard({
      id: 'c1',
      type: 'cloze',
      prompt: '___ 이고 ___ 이다',
      answers: ['a', 'b'],
      answerMastery: [true, true],
      answerSchedule: [schedule(now + DAY), schedule(now + DAY)],
    });
    expect(planCheckupSession([card], now)).toEqual({ kind: 'nothing-due' });
  });

  it('queues only the hides whose due date has passed', () => {
    const card = protoCard({
      id: 'c1',
      type: 'cloze',
      prompt: '___ 이고 ___ 이다',
      answers: ['a', 'b'],
      answerMastery: [true, true],
      answerSchedule: [schedule(now - DAY), schedule(now + DAY)],
    });
    expect(planCheckupSession([card], now)).toEqual({
      kind: 'session',
      mode: 'checkup',
      targets: [{ cardId: 'c1', hideIndexes: [0] }],
    });
  });

  it('orders the most overdue card first', () => {
    const due = (id: string, dueAt: number) => protoCard({
      id,
      type: 'cloze',
      prompt: '___ 이다',
      answers: ['a'],
      answerMastery: [true],
      answerSchedule: [schedule(dueAt)],
    });
    const plan = planCheckupSession([due('recent', now - DAY), due('ancient', now - 5 * DAY)], now);
    expect(plan.kind === 'session' && plan.targets.map((target) => target.cardId))
      .toEqual(['ancient', 'recent']);
  });
});

describe('countHides', () => {
  it('counts hides rather than cards', () => {
    expect(countHides([
      { cardId: 'c1', hideIndexes: [0, 1] },
      { cardId: 'c2', hideIndexes: [3] },
    ])).toBe(3);
  });
});
