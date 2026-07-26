import { describe, expect, it, vi } from 'vitest';
import type { Repository } from './repository';
import { migrateRoomToAccount } from './migrateRepository';

function destination(): Repository {
  return {
    mode: 'cloud',
    subscribeDecks: () => () => {},
    subscribeCards: () => () => {},
    subscribeSections: () => () => {},
    ensureDefaultDeck: vi.fn(),
    addDeck: vi.fn().mockResolvedValue('account-deck'),
    renameDeck: vi.fn(),
    deleteDeck: vi.fn(),
    addSection: vi.fn().mockResolvedValue('account-section'),
    renameSection: vi.fn(),
    deleteSection: vi.fn(),
    setSectionContent: vi.fn().mockResolvedValue([]),
    toggleCardStar: vi.fn(),
    setCardHides: vi.fn(),
  };
}

describe('room account migration', () => {
  it('copies per-hide mastery and schedule without source ids', async () => {
    const target = destination();
    const answerSchedule = [{
      due: 10, stability: 2, difficulty: 3, reps: 4, lapses: 1, state: 2, lastReview: 5,
    }];
    await migrateRoomToAccount(
      [{ id: 'deck-1', name: '일반', createdAt: 1, updatedAt: 1 }],
      {
        'deck-1': {
          cardsLoaded: true,
          sectionsLoaded: true,
          sections: [{
            id: 'section-1', name: '행성', sourceText: '지구는 [세 번째] 행성', createdAt: 1, updatedAt: 1,
          }],
          cards: [{
            id: 'card-1',
            sectionId: 'section-1',
            revision: 7,
            type: 'cloze',
            prompt: '지구는 ___ 행성',
            answers: ['세 번째'],
            rawText: '지구는 [세 번째] 행성',
            answerMastery: [false],
            answerSchedule,
            createdAt: 1,
            updatedAt: 2,
          }],
        },
      },
      target,
    );

    expect(target.setSectionContent).toHaveBeenCalledWith(
      'account-deck',
      'account-section',
      '지구는 [세 번째] 행성',
      [expect.objectContaining({
        answerMastery: [false],
        answerSchedule,
      })],
      'migration-content-deck-1-section-1',
    );
    const migratedCard = vi.mocked(target.setSectionContent).mock.calls[0][3][0];
    expect(migratedCard).not.toHaveProperty('id');
    expect(migratedCard).not.toHaveProperty('revision');
    expect(migratedCard).not.toHaveProperty('sectionId');
  });
});
