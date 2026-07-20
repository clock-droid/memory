import { describe, expect, it } from 'vitest';
import { applyRoomRequest, ensureRoom } from './roomLogic.mjs';

function roomWithSection() {
  return ensureRoom({
    decks: [{ id: 'deck-1', name: '일반', createdAt: 1, updatedAt: 1 }],
    sectionsByDeck: {
      'deck-1': [{ id: 'section-1', name: '암기장', sourceText: '', revision: 0, createdAt: 1, updatedAt: 1 }],
    },
    cardsByDeck: { 'deck-1': [] },
  });
}

function request(room, method, parts, body = {}) {
  return applyRoomRequest({ room, method, parts, body });
}

describe('room content integrity', () => {
  it('does not recreate orphan cards when a delayed save arrives after section deletion', () => {
    const room = roomWithSection();
    expect(request(
      room,
      'DELETE',
      ['decks', 'deck-1', 'sections', 'section-1'],
      { expectedRevision: 0 },
    ).status).toBe(200);

    const delayedSave = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        sourceText: '질문:답',
        cards: [{ type: 'pair', prompt: '질문', answers: ['답'], rawText: '질문:답' }],
        expectedRevision: 0,
      },
    );

    expect(delayedSave).toMatchObject({ status: 409, write: false });
    expect(room.cardsByDeck['deck-1']).toEqual([]);
  });

  it('rejects a stale whole-section write instead of overwriting newer content', () => {
    const room = roomWithSection();
    const first = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      { sourceText: '최신:내용', cards: [], expectedRevision: 0 },
    );
    const stale = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      { sourceText: '오래된:내용', cards: [], expectedRevision: 0 },
    );

    expect(first).toMatchObject({ status: 200, write: true });
    expect(stale).toMatchObject({ status: 409, write: false });
    expect(room.sectionsByDeck['deck-1'][0]).toMatchObject({ sourceText: '최신:내용', revision: 1 });
  });

  it('keeps an already-open legacy client writable until a version-aware client upgrades the section', () => {
    const room = roomWithSection();
    const first = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      { sourceText: '첫 저장', cards: [] },
    );
    const second = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      { sourceText: '두 번째 저장', cards: [] },
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(room.sectionsByDeck['deck-1'][0]).toMatchObject({ sourceText: '두 번째 저장', revision: 0 });
  });

  it('rejects an empty or malformed content payload without deleting cards', () => {
    const room = roomWithSection();
    room.cardsByDeck['deck-1'] = [{
      id: 'card-1', sectionId: 'section-1', type: 'pair', prompt: '질문', answers: ['답'],
      rawText: '질문:답', revision: 0, createdAt: 1, updatedAt: 1,
    }];

    const invalid = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {},
    );

    expect(invalid).toMatchObject({ status: 400, write: false });
    expect(room.cardsByDeck['deck-1']).toHaveLength(1);
    expect(room.sectionsByDeck['deck-1'][0].sourceText).toBe('');
  });

  it('rejects malformed card entries before replacing valid section cards', () => {
    const room = roomWithSection();
    room.cardsByDeck['deck-1'] = [{
      id: 'card-1', sectionId: 'section-1', type: 'pair', prompt: '질문', answers: ['답'],
      rawText: '질문:답', revision: 0, createdAt: 1, updatedAt: 1,
    }];

    const invalid = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      { sourceText: '손상 요청', cards: [null], expectedRevision: 0 },
    );

    expect(invalid).toMatchObject({ status: 400, write: false });
    expect(room.cardsByDeck['deck-1']).toHaveLength(1);
    expect(room.cardsByDeck['deck-1'][0].id).toBe('card-1');
  });

  it('persists one semantic answer for a normal group card', () => {
    const room = roomWithSection();
    const save = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        sourceText: '과일:\n- 사과\n- 배',
        cards: [{
          type: 'group',
          prompt: '과일',
          answers: ['- 사과\n- 배'],
          answerMastery: [false],
          mastered: false,
          rawText: '과일:\n- 사과\n- 배',
          groupItems: [{ marker: '- ', text: '사과' }, { marker: '- ', text: '배' }],
        }],
        expectedRevision: 0,
      },
    );

    expect(save).toMatchObject({ status: 200, write: true });
    expect(room.cardsByDeck['deck-1'][0]).toMatchObject({
      answers: ['- 사과\n- 배'],
      answerMastery: [false],
    });
  });

  it('migrates a legacy empty-answer group and preserves its mastery during a whole-section rewrite', () => {
    const room = roomWithSection();
    const save = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        sourceText: '과일:\n- 사과\n- 배',
        cards: [{
          type: 'group',
          prompt: '과일',
          answers: [],
          answerMastery: [],
          mastered: true,
          rawText: '과일:\n- 사과\n- 배',
          groupItems: [{ marker: '- ', text: '사과' }, { marker: '- ', text: '배' }],
        }],
        expectedRevision: 0,
      },
    );

    expect(save).toMatchObject({ status: 200, write: true });
    expect(room.cardsByDeck['deck-1'][0]).toMatchObject({
      answers: ['- 사과\n- 배'],
      answerMastery: [true],
      mastered: true,
    });
  });

  it('normalizes legacy stored group cards before mastery patches', () => {
    const room = roomWithSection();
    room.cardsByDeck['deck-1'] = [{
      id: 'group-1',
      sectionId: 'section-1',
      type: 'group',
      prompt: '과일',
      answers: [],
      answerMastery: [],
      mastered: false,
      rawText: '과일:\n- 사과\n- 배',
      groupItems: [{ marker: '- ', text: '사과' }, { marker: '- ', text: '배' }],
      revision: 0,
      createdAt: 1,
      updatedAt: 1,
    }];
    ensureRoom(room);

    const patch = request(
      room,
      'PATCH',
      ['decks', 'deck-1', 'cards', 'group-1'],
      { answerMastery: [true], expectedRevision: 0 },
    );

    expect(patch).toMatchObject({ status: 200, write: true });
    expect(room.cardsByDeck['deck-1'][0]).toMatchObject({
      answers: ['- 사과\n- 배'],
      answerMastery: [true],
      mastered: true,
    });
  });

  it('quarantines legacy zero-answer non-group cards instead of losing them during a section rewrite', () => {
    const room = roomWithSection();
    const legacySave = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      { sourceText: '질문:', cards: [{ type: 'pair', prompt: '질문', answers: [], rawText: '질문:' }] },
    );

    expect(legacySave).toMatchObject({ status: 200, write: true });
    expect(room.cardsByDeck['deck-1'][0]).toMatchObject({
      type: 'pair',
      answers: [],
      needsRepair: true,
      answerMastery: [],
      mastered: false,
    });
  });

  it('marks legacy stored pair and cloze cards for repair with no mastery target', () => {
    const room = roomWithSection();
    room.cardsByDeck['deck-1'] = [
      {
        id: 'pair-1', sectionId: 'section-1', type: 'pair', prompt: '질문', answers: [],
        answerMastery: [true], mastered: true, rawText: '질문:', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'cloze-1', sectionId: 'section-1', type: 'cloze', prompt: '___', answers: [],
        mastered: true, rawText: '___', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'cloze-2', sectionId: 'section-1', type: 'cloze', prompt: '___ / ___', answers: ['기존 답'],
        answerMastery: [true], mastered: true, rawText: '___ / ___', createdAt: 1, updatedAt: 1,
      },
    ];

    ensureRoom(room);

    expect(room.cardsByDeck['deck-1']).toEqual([
      expect.objectContaining({ id: 'pair-1', needsRepair: true, answers: [], answerMastery: [], mastered: false }),
      expect.objectContaining({ id: 'cloze-1', needsRepair: true, answers: [], answerMastery: [], mastered: false }),
      expect.objectContaining({ id: 'cloze-2', needsRepair: true, answers: ['기존 답'], answerMastery: [], mastered: false }),
    ]);
  });

  it('converts a malformed legacy group into a visible repair quarantine', () => {
    const room = roomWithSection();
    room.cardsByDeck['deck-1'] = [{
      id: 'group-1', sectionId: 'section-1', type: 'group', prompt: '손상된 묶음', answers: [],
      groupItems: [], rawText: '손상된 묶음:', createdAt: 1, updatedAt: 1,
    }];

    ensureRoom(room);

    expect(room.cardsByDeck['deck-1'][0]).toMatchObject({
      id: 'group-1',
      type: 'pair',
      answers: [],
      needsRepair: true,
      answerMastery: [],
      mastered: false,
    });
  });

  it('accepts an explicit repair quarantine in a revision-aware whole-section rewrite', () => {
    const room = roomWithSection();
    const save = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        sourceText: '질문:',
        cards: [{ type: 'pair', prompt: '질문', answers: [], rawText: '질문:', needsRepair: true }],
        expectedRevision: 0,
      },
    );

    expect(save).toMatchObject({ status: 200, write: true });
    expect(room.cardsByDeck['deck-1'][0]).toMatchObject({
      needsRepair: true,
      answers: [],
      answerMastery: [],
      mastered: false,
    });
  });

  it('rejects a new unmarked zero-answer card from a revision-aware client without deleting valid cards', () => {
    const room = roomWithSection();
    room.cardsByDeck['deck-1'] = [{
      id: 'card-1', sectionId: 'section-1', type: 'pair', prompt: '질문', answers: ['답'],
      rawText: '질문:답', revision: 0, createdAt: 1, updatedAt: 1,
    }];

    const emptyPair = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        sourceText: '질문:',
        cards: [{ type: 'pair', prompt: '질문', answers: [], rawText: '질문:' }],
        expectedRevision: 0,
      },
    );
    const invalidQuarantine = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        sourceText: '질문:답',
        cards: [{
          type: 'pair', prompt: '질문', answers: ['답'], rawText: '질문:답', needsRepair: true,
        }],
        expectedRevision: 0,
      },
    );

    expect(emptyPair).toMatchObject({ status: 400, write: false });
    expect(invalidQuarantine).toMatchObject({ status: 400, write: false });
    expect(room.cardsByDeck['deck-1']).toHaveLength(1);
    expect(room.cardsByDeck['deck-1'][0].id).toBe('card-1');
  });

  it('rejects a revision-aware cloze whose blank count and answer count differ', () => {
    const room = roomWithSection();
    const mismatch = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        sourceText: '___은 ___이다',
        cards: [{ type: 'cloze', prompt: '___은 ___이다', answers: ['하나'], rawText: '___은 ___이다' }],
        expectedRevision: 0,
      },
    );

    expect(mismatch).toMatchObject({ status: 400, write: false });
    expect(room.cardsByDeck['deck-1']).toEqual([]);
  });

  it('accepts cloze answers only when they match placeholder count or embedded bracket values', () => {
    const placeholderRoom = roomWithSection();
    const placeholderSave = request(
      placeholderRoom,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        sourceText: '___은 ___이다',
        cards: [{
          type: 'cloze', prompt: '___은 ___이다', answers: ['물', '음료'], rawText: '___은 ___이다',
        }],
        expectedRevision: 0,
      },
    );
    const bracketRoom = roomWithSection();
    const bracketSave = request(
      bracketRoom,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        sourceText: '[물]은 [음료]이다',
        cards: [{
          type: 'cloze', prompt: '[물]은 [음료]이다', answers: ['물', '음료'], rawText: '[물]은 [음료]이다',
        }],
        expectedRevision: 0,
      },
    );

    expect(placeholderSave).toMatchObject({ status: 200, write: true });
    expect(bracketSave).toMatchObject({ status: 200, write: true });
  });

  it('still rejects a malformed empty group because it has neither a semantic answer nor repair intent', () => {
    const room = roomWithSection();
    const emptyGroup = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        sourceText: '빈 묶음:',
        cards: [{ type: 'group', prompt: '빈 묶음', answers: [], rawText: '빈 묶음:', groupItems: [] }],
      },
    );

    expect(emptyGroup).toMatchObject({ status: 400, write: false });
    expect(room.cardsByDeck['deck-1']).toEqual([]);
  });

  it('rejects deletion based on a stale section revision', () => {
    const room = roomWithSection();
    request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      { sourceText: '다른 기기 변경', cards: [], expectedRevision: 0 },
    );

    const staleDelete = request(
      room,
      'DELETE',
      ['decks', 'deck-1', 'sections', 'section-1'],
      { expectedRevision: 0 },
    );

    expect(staleDelete).toMatchObject({ status: 409, write: false });
    expect(room.sectionsByDeck['deck-1']).toHaveLength(1);
  });

  it('rejects a mastery patch for a card id replaced on another device', () => {
    const room = roomWithSection();
    room.cardsByDeck['deck-1'] = [{
      id: 'card-new', sectionId: 'section-1', type: 'pair', prompt: '질문', answers: ['답'],
      rawText: '질문:답', createdAt: 1, updatedAt: 1,
    }];

    const stalePatch = request(
      room,
      'PATCH',
      ['decks', 'deck-1', 'cards', 'card-old'],
      { answerMastery: [true] },
    );

    expect(stalePatch).toMatchObject({ status: 409, write: false });
    expect(room.cardsByDeck['deck-1'][0].answerMastery).toBeUndefined();
  });

  it('rejects a stale per-hide mastery write instead of losing another device result', () => {
    const room = roomWithSection();
    room.cardsByDeck['deck-1'] = [{
      id: 'card-1', sectionId: 'section-1', type: 'pair', prompt: '질문', answers: ['첫째', '둘째'],
      rawText: '질문:첫째,둘째', answerMastery: [false, false], revision: 0, createdAt: 1, updatedAt: 1,
    }];
    const first = request(
      room,
      'PATCH',
      ['decks', 'deck-1', 'cards', 'card-1'],
      { answerMastery: [true, false], expectedRevision: 0 },
    );
    const stale = request(
      room,
      'PATCH',
      ['decks', 'deck-1', 'cards', 'card-1'],
      { answerMastery: [false, true], expectedRevision: 0 },
    );

    expect(first).toMatchObject({ status: 200, body: { revision: 1 }, write: true });
    expect(stale).toMatchObject({ status: 409, write: false });
    expect(room.cardsByDeck['deck-1'][0]).toMatchObject({ answerMastery: [true, false], revision: 1 });
  });

  it('bumps the parent section revision so stale content cannot erase a mastery result', () => {
    const room = roomWithSection();
    room.sectionsByDeck['deck-1'][0].revision = 4;
    room.cardsByDeck['deck-1'] = [{
      id: 'card-1', sectionId: 'section-1', type: 'pair', prompt: '질문', answers: ['답'],
      rawText: '질문:답', answerMastery: [false], mastered: false, revision: 2, createdAt: 1, updatedAt: 1,
    }];

    const mastery = request(
      room,
      'PATCH',
      ['decks', 'deck-1', 'cards', 'card-1'],
      { answerMastery: [true], expectedRevision: 2 },
    );
    const staleContent = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        sourceText: '질문:답',
        cards: [{
          type: 'pair', prompt: '질문', answers: ['답'], rawText: '질문:답',
          answerMastery: [false], mastered: false,
        }],
        expectedRevision: 4,
      },
    );

    expect(mastery).toMatchObject({
      status: 200,
      body: { revision: 3, sectionId: 'section-1', sectionRevision: 5 },
      write: true,
    });
    expect(staleContent).toMatchObject({ status: 409, write: false });
    expect(room.sectionsByDeck['deck-1'][0]).toMatchObject({ revision: 5 });
    expect(room.cardsByDeck['deck-1'][0]).toMatchObject({ answerMastery: [true], revision: 3 });
  });

  it('rejects malformed per-hide mastery arrays without changing the card', () => {
    const room = roomWithSection();
    room.cardsByDeck['deck-1'] = [{
      id: 'card-1', sectionId: 'section-1', type: 'pair', prompt: '질문', answers: ['첫째', '둘째'],
      rawText: '질문:첫째,둘째', answerMastery: [false, false], revision: 0, createdAt: 1, updatedAt: 1,
    }];

    const invalid = request(
      room,
      'PATCH',
      ['decks', 'deck-1', 'cards', 'card-1'],
      { answerMastery: [true], expectedRevision: 0 },
    );

    expect(invalid).toMatchObject({ status: 400, write: false });
    expect(room.cardsByDeck['deck-1'][0]).toMatchObject({ answerMastery: [false, false], revision: 0 });
  });

  it('never allows a quarantined repair card to become mastered', () => {
    const room = roomWithSection();
    room.cardsByDeck['deck-1'] = [{
      id: 'repair-1', sectionId: 'section-1', type: 'pair', prompt: '질문', answers: [],
      needsRepair: true, answerMastery: [], mastered: false, rawText: '질문:', revision: 0, createdAt: 1, updatedAt: 1,
    }];

    const invalid = request(
      room,
      'PATCH',
      ['decks', 'deck-1', 'cards', 'repair-1'],
      { mastered: true, expectedRevision: 0 },
    );

    expect(invalid).toMatchObject({ status: 400, write: false });
    expect(room.cardsByDeck['deck-1'][0]).toMatchObject({ answerMastery: [], mastered: false, revision: 0 });
  });

  it('does not create sections under a deck deleted by another device', () => {
    const room = roomWithSection();
    request(room, 'DELETE', ['decks', 'deck-1']);

    const staleCreate = request(
      room,
      'POST',
      ['decks', 'deck-1', 'sections'],
      { name: '되살아난 암기장' },
    );

    expect(staleCreate).toMatchObject({ status: 409, write: false });
    expect(room.sectionsByDeck['deck-1']).toBeUndefined();
  });

  it('returns the same deck and section for repeated create operation ids', () => {
    const room = ensureRoom({ decks: [], sectionsByDeck: {}, cardsByDeck: {} });
    const firstDeck = request(room, 'POST', ['decks'], { name: '일반', operationId: 'draft-1-deck' });
    const repeatedDeck = request(room, 'POST', ['decks'], { name: '일반', operationId: 'draft-1-deck' });
    const deckId = firstDeck.body.id;
    const firstSection = request(
      room,
      'POST',
      ['decks', deckId, 'sections'],
      { name: '새 암기장', operationId: 'draft-1-section' },
    );
    const repeatedSection = request(
      room,
      'POST',
      ['decks', deckId, 'sections'],
      { name: '새 암기장', operationId: 'draft-1-section' },
    );

    expect(repeatedDeck).toMatchObject({ status: 200, body: { id: deckId }, write: false });
    expect(room.decks).toHaveLength(1);
    expect(repeatedSection).toMatchObject({ status: 200, body: { id: firstSection.body.id }, write: false });
    expect(room.sectionsByDeck[deckId]).toHaveLength(1);
  });

  it('returns the committed cards when a content response is retried with the same operation id', () => {
    const room = roomWithSection();
    const body = {
      sourceText: '질문:답',
      cards: [{ type: 'pair', prompt: '질문', answers: ['답'], rawText: '질문:답' }],
      expectedRevision: 0,
      operationId: 'draft-1-content-abc',
    };
    const first = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      body,
    );
    const intervening = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        ...body,
        sourceText: '질문:답\n추가:카드',
        cards: [...body.cards, { type: 'pair', prompt: '추가', answers: ['카드'], rawText: '추가:카드' }],
        expectedRevision: 1,
        operationId: 'other-device-operation',
      },
    );
    const repeated = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        ...body,
        expectedRevision: 2,
        cards: [...body.cards, { type: 'pair', prompt: '추가', answers: ['카드'], rawText: '추가:카드' }, ...body.cards],
      },
    );

    expect(first).toMatchObject({ status: 200, write: true });
    expect(intervening).toMatchObject({ status: 200, write: true });
    expect(repeated).toMatchObject({ status: 200, body: { revision: 2 }, write: false });
    expect(repeated.body.cards).toHaveLength(2);
    expect(room.cardsByDeck['deck-1']).toHaveLength(2);
    expect(room.sectionsByDeck['deck-1'][0]).toMatchObject({
      revision: 2,
      contentOperationId: 'other-device-operation',
      contentOperationIds: [body.operationId, 'other-device-operation'],
    });
  });
});

describe('per-hide schedule', () => {
  const scheduleEntry = (due) => ({
    due, stability: 2.31, difficulty: 2.12, reps: 1, lapses: 0, state: 2, lastReview: due - 86400000,
  });

  function roomWithPairCard() {
    const room = roomWithSection();
    room.cardsByDeck['deck-1'] = [{
      id: 'card-1', sectionId: 'section-1', type: 'pair', prompt: '질문', answers: ['첫째', '둘째'],
      rawText: '질문:첫째,둘째', answerMastery: [false, false], revision: 0, createdAt: 1, updatedAt: 1,
    }];
    return room;
  }

  it('persists a schedule patch alongside mastery and strips unknown entry fields', () => {
    const room = roomWithPairCard();
    const patch = request(
      room,
      'PATCH',
      ['decks', 'deck-1', 'cards', 'card-1'],
      {
        answerMastery: [true, false],
        answerSchedule: [{ ...scheduleEntry(2000), injected: 'nope' }, null],
        expectedRevision: 0,
      },
    );

    expect(patch).toMatchObject({ status: 200, body: { revision: 1 }, write: true });
    expect(room.cardsByDeck['deck-1'][0].answerSchedule).toEqual([scheduleEntry(2000), null]);
    expect(room.cardsByDeck['deck-1'][0].answerSchedule[0]).not.toHaveProperty('injected');
  });

  it.each([
    ['length mismatch', [scheduleEntry(2000)]],
    ['non-numeric field', [{ ...scheduleEntry(2000), due: 'tomorrow' }, null]],
    ['missing field', [{ due: 2000 }, null]],
    ['non-object entry', ['soon', null]],
  ])('rejects a malformed schedule patch (%s) without changing the card', (_label, answerSchedule) => {
    const room = roomWithPairCard();
    const invalid = request(
      room,
      'PATCH',
      ['decks', 'deck-1', 'cards', 'card-1'],
      { answerMastery: [true, false], answerSchedule, expectedRevision: 0 },
    );

    expect(invalid).toMatchObject({ status: 400, write: false });
    expect(room.cardsByDeck['deck-1'][0]).toMatchObject({ answerMastery: [false, false], revision: 0 });
    expect(room.cardsByDeck['deck-1'][0].answerSchedule).toBeUndefined();
  });

  it('keeps a sanitized schedule through a whole-section rewrite', () => {
    const room = roomWithSection();
    const save = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        sourceText: '질문:첫째,둘째',
        cards: [{
          type: 'pair', prompt: '질문', answers: ['첫째', '둘째'], rawText: '질문:첫째,둘째',
          answerMastery: [true, false],
          answerSchedule: [{ ...scheduleEntry(3000), extra: true }, null],
          mastered: false,
        }],
        expectedRevision: 0,
      },
    );

    expect(save).toMatchObject({ status: 200, write: true });
    expect(room.cardsByDeck['deck-1'][0].answerSchedule).toEqual([scheduleEntry(3000), null]);
  });

  it('rejects a rewrite whose schedule length disagrees with the answers', () => {
    const room = roomWithSection();
    const save = request(
      room,
      'PUT',
      ['decks', 'deck-1', 'sections', 'section-1', 'content'],
      {
        sourceText: '질문:첫째,둘째',
        cards: [{
          type: 'pair', prompt: '질문', answers: ['첫째', '둘째'], rawText: '질문:첫째,둘째',
          answerMastery: [true, false],
          answerSchedule: [null],
          mastered: false,
        }],
        expectedRevision: 0,
      },
    );

    expect(save).toMatchObject({ status: 400, write: false });
    expect(room.cardsByDeck['deck-1']).toEqual([]);
  });

  it('clears the schedule when a card is quarantined for repair', () => {
    const room = roomWithSection();
    room.cardsByDeck['deck-1'] = [{
      id: 'card-1', sectionId: 'section-1', type: 'pair', prompt: '질문', answers: [''],
      rawText: '질문:', answerMastery: [true], answerSchedule: [scheduleEntry(2000)],
      revision: 0, createdAt: 1, updatedAt: 1,
    }];

    ensureRoom(room);

    expect(room.cardsByDeck['deck-1'][0]).toMatchObject({ needsRepair: true, answerMastery: [], answerSchedule: [] });
  });
  it('rejects per-hide patches for a stored card with no usable answer list', () => {
    const room = roomWithSection();
    room.cardsByDeck['deck-1'] = [{
      id: 'card-1', sectionId: 'section-1', type: 'pair', prompt: '질문',
      rawText: '질문:답', revision: 0, createdAt: 1, updatedAt: 1,
    }];

    const mastery = request(
      room,
      'PATCH',
      ['decks', 'deck-1', 'cards', 'card-1'],
      { answerMastery: [true], expectedRevision: 0 },
    );
    const scheduled = request(
      room,
      'PATCH',
      ['decks', 'deck-1', 'cards', 'card-1'],
      { answerMastery: [true], answerSchedule: [scheduleEntry(2000)], expectedRevision: 0 },
    );

    expect(mastery).toMatchObject({ status: 400, write: false });
    expect(scheduled).toMatchObject({ status: 400, write: false });
    expect(room.cardsByDeck['deck-1'][0].answerMastery).toBeUndefined();
    expect(room.cardsByDeck['deck-1'][0].answerSchedule).toBeUndefined();
  });
});
