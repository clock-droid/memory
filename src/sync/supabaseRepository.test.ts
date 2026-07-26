import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseRepository } from './supabaseRepository';

type Row = {
  user_id: string;
  revision: number;
  room: Record<string, unknown>;
  updated_at?: string;
};

class FakeQuery {
  private operation: 'select' | 'insert' | 'update' = 'select';
  private value: Partial<Row> | null = null;
  private filters: Array<[keyof Row, unknown]> = [];

  constructor(private database: FakeSupabase) {}

  select() {
    return this;
  }

  insert(value: Row) {
    this.operation = 'insert';
    this.value = value;
    return this;
  }

  update(value: Partial<Row>) {
    this.operation = 'update';
    this.value = value;
    return this;
  }

  eq(key: keyof Row, value: unknown) {
    this.filters.push([key, value]);
    return this;
  }

  async maybeSingle() {
    if (this.operation === 'insert') {
      if (this.database.row) return { data: null, error: { code: '23505' } };
      this.database.row = structuredClone(this.value as Row);
      return { data: structuredClone(this.database.row), error: null };
    }

    const matches = this.database.row && this.filters.every(
      ([key, value]) => this.database.row?.[key] === value,
    );
    if (this.operation === 'update') {
      if (!matches) return { data: null, error: null };
      this.database.row = { ...this.database.row!, ...structuredClone(this.value ?? {}) };
      return { data: structuredClone(this.database.row), error: null };
    }
    return { data: matches ? structuredClone(this.database.row) : null, error: null };
  }
}

class FakeSupabase {
  row: Row | null = null;

  from() {
    return new FakeQuery(this);
  }

  channel() {
    const channel = {
      on: () => channel,
      subscribe: () => channel,
    };
    return channel;
  }

  async removeChannel() {
    return 'ok';
  }
}

describe('Supabase account repository', () => {
  it('creates one private room and preserves hide-level state through writes', async () => {
    const client = new FakeSupabase();
    const repository = createSupabaseRepository('user-1', client as unknown as SupabaseClient);
    if (!repository) throw new Error('repository was not created');

    const deckSnapshots: Array<Array<{ id: string; name: string }>> = [];
    const unsubscribeDecks = repository.subscribeDecks((decks) => deckSnapshots.push(decks));
    await vi.waitFor(() => expect(deckSnapshots).toEqual([[]]));

    const deckId = await repository.addDeck('일반', 'create-deck');
    const sectionId = await repository.addSection(deckId, '행성', 'create-section');
    const cards = await repository.setSectionContent(
      deckId,
      sectionId,
      '지구는 [세 번째] 행성',
      [{
        type: 'cloze',
        prompt: '지구는 ___ 행성',
        answers: ['세 번째'],
        rawText: '지구는 [세 번째] 행성',
      }],
      'create-content',
    );
    await repository.setCardHides(deckId, cards[0].id, [{
      index: 0,
      text: '세 번째',
      known: false,
      schedule: null,
      dueAt: 0,
    }]);

    const cardSnapshots: typeof cards[] = [];
    const unsubscribeCards = repository.subscribeCards(deckId, (next) => cardSnapshots.push(next));
    await vi.waitFor(() => expect(cardSnapshots.length).toBeGreaterThan(0));

    expect(deckSnapshots.at(-1)?.[0]).toMatchObject({ id: deckId, name: '일반' });
    expect(cardSnapshots.at(-1)?.[0]).toMatchObject({
      id: cards[0].id,
      answerMastery: [false],
      answerSchedule: [null],
    });
    expect(client.row?.revision).toBe(4);
    unsubscribeCards();
    unsubscribeDecks();
  });
});
