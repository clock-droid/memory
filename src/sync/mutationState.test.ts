import { describe, expect, it } from 'vitest';
import { CardIdAliases, applyHides, replaceSectionCards } from './mutationState';
import type { Card } from '../domain/types';

function card(id: string, sectionId = 's1'): Card {
  return {
    id,
    sectionId,
    type: 'cloze',
    prompt: '___',
    answers: ['답'],
    rawText: '[답]',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('mutation state helpers', () => {
  it('rolls one section forward without disturbing the confirmed cards of another section', () => {
    expect(replaceSectionCards(
      [card('old', 's1'), card('keep', 's2')],
      's1',
      [card('saved', 's1')],
    ).map((item) => item.id)).toEqual(['keep', 'saved']);
  });

  it('projects judged hides onto the stored arrays while preserving unrelated cards', () => {
    const schedule = { due: 9, stability: 2, difficulty: 5, reps: 1, lapses: 0, state: 2, lastReview: 1 };
    const judged = [{ index: 0, text: '답', known: true, schedule, dueAt: schedule.due }];

    const result = applyHides([card('c1'), card('c2')], 'c1', judged);

    expect(result[0]).toMatchObject({
      id: 'c1', answerMastery: [true], answerSchedule: [schedule], mastered: true, starred: false,
    });
    expect(result[1]).toEqual(card('c2'));
  });

  it('resolves regenerated card ids across consecutive section saves', () => {
    const aliases = new CardIdAliases();
    aliases.recordReplacement('d1', [card('tmp')], [card('server-1')]);
    aliases.recordReplacement('d1', [card('server-1')], [card('server-2')]);

    expect(aliases.resolve('d1', 'tmp')).toBe('server-2');
    expect(aliases.resolve('d1', 'server-1')).toBe('server-2');
  });
});
