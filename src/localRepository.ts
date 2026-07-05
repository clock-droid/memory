import type { Card, Deck, NewCard, Repository, Section } from './types';

type RoomState = {
  decks: Deck[];
  cardsByDeck: Record<string, Card[]>;
  sectionsByDeck: Record<string, Section[]>;
};

const listeners = new Map<string, Set<() => void>>();

function key(roomCode: string) {
  return `exam-memorizer-room:${roomCode}`;
}

function emptyState(): RoomState {
  return { decks: [], cardsByDeck: {}, sectionsByDeck: {} };
}

function read(roomCode: string): RoomState {
  const raw = localStorage.getItem(key(roomCode));
  if (!raw) return emptyState();
  try {
    const state = JSON.parse(raw) as Partial<RoomState>;
    return {
      decks: state.decks ?? [],
      cardsByDeck: state.cardsByDeck ?? {},
      sectionsByDeck: state.sectionsByDeck ?? {},
    };
  } catch {
    return emptyState();
  }
}

function write(roomCode: string, state: RoomState) {
  localStorage.setItem(key(roomCode), JSON.stringify(state));
  listeners.get(roomCode)?.forEach((listener) => listener());
}

function subscribe(roomCode: string, listener: () => void) {
  const roomListeners = listeners.get(roomCode) ?? new Set<() => void>();
  roomListeners.add(listener);
  listeners.set(roomCode, roomListeners);
  return () => {
    roomListeners.delete(listener);
  };
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function defaultSection(now = Date.now()): Section {
  return { id: 'default', name: '기본', sourceText: '', createdAt: now, updatedAt: now };
}

function ensureSections(state: RoomState, deckId: string) {
  if (!state.sectionsByDeck[deckId]?.length) {
    state.sectionsByDeck[deckId] = [defaultSection()];
  }
}

export function createLocalRepository(roomCode: string): Repository {
  return {
    mode: 'local',
    subscribeDecks(callback, _onError) {
      const emit = () => callback(read(roomCode).decks);
      emit();
      return subscribe(roomCode, emit);
    },
    subscribeCards(deckId, callback, _onError) {
      const emit = () => callback(read(roomCode).cardsByDeck[deckId] ?? []);
      emit();
      return subscribe(roomCode, emit);
    },
    subscribeSections(deckId, callback, _onError) {
      const emit = () => {
        const state = read(roomCode);
        callback(state.sectionsByDeck[deckId] ?? []);
      };
      emit();
      return subscribe(roomCode, emit);
    },
    async ensureDefaultDeck() {
      return Promise.resolve();
      const state = read(roomCode);
      const now = Date.now();
      if (!state.decks.some((deck) => deck.id === 'default')) {
        state.decks.push({ id: 'default', name: '기본 암기장', createdAt: now, updatedAt: now });
      }
      return Promise.resolve();
    },
    async addDeck(name) {
      const state = read(roomCode);
      const now = Date.now();
      const deckId = id('deck');
      state.decks.push({ id: deckId, name, createdAt: now, updatedAt: now });
      state.cardsByDeck[deckId] = [];
      state.sectionsByDeck[deckId] = [];
      write(roomCode, state);
      return deckId;
    },
    async renameDeck(deckId, name) {
      const state = read(roomCode);
      state.decks = state.decks.map((deck) =>
        deck.id === deckId ? { ...deck, name, updatedAt: Date.now() } : deck,
      );
      write(roomCode, state);
    },
    async deleteDeck(deckId) {
      const state = read(roomCode);
      state.decks = state.decks.filter((deck) => deck.id !== deckId);
      delete state.cardsByDeck[deckId];
      delete state.sectionsByDeck[deckId];
      write(roomCode, state);
    },
    async addSection(deckId, name) {
      const state = read(roomCode);
      const now = Date.now();
      state.sectionsByDeck[deckId] ??= [];
      const sectionId = id('section');
      state.sectionsByDeck[deckId].push({ id: sectionId, name, sourceText: '', createdAt: now, updatedAt: now });
      write(roomCode, state);
      return sectionId;
    },
    async renameSection(deckId, sectionId, name) {
      const state = read(roomCode);
      state.sectionsByDeck[deckId] ??= [];
      state.sectionsByDeck[deckId] = state.sectionsByDeck[deckId].map((section) =>
        section.id === sectionId ? { ...section, name, updatedAt: Date.now() } : section,
      );
      write(roomCode, state);
    },
    async deleteSection(deckId, sectionId) {
      const state = read(roomCode);
      state.sectionsByDeck[deckId] ??= [];
      state.sectionsByDeck[deckId] = state.sectionsByDeck[deckId].filter((section) => section.id !== sectionId);
      state.cardsByDeck[deckId] = (state.cardsByDeck[deckId] ?? []).filter(
        (card) => (card.sectionId ?? 'default') !== sectionId,
      );
      write(roomCode, state);
    },
    async setSectionContent(deckId, sectionId, sourceText, cards: NewCard[]) {
      const state = read(roomCode);
      const now = Date.now();
      state.sectionsByDeck[deckId] ??= [];
      const nextCards = cards.map((card) => ({
        ...card,
        sectionId,
        id: id('card'),
        createdAt: now,
        updatedAt: now,
      }));
      state.sectionsByDeck[deckId] = state.sectionsByDeck[deckId].map((section) =>
        section.id === sectionId ? { ...section, sourceText, updatedAt: now } : section,
      );
      state.cardsByDeck[deckId] = [
        ...(state.cardsByDeck[deckId] ?? []).filter((card) => (card.sectionId ?? 'default') !== sectionId),
        ...nextCards,
      ];
      write(roomCode, state);
    },
    async toggleCardStar(deckId, cardId, starred) {
      const state = read(roomCode);
      state.cardsByDeck[deckId] = (state.cardsByDeck[deckId] ?? []).map((card) =>
        card.id === cardId ? { ...card, starred, mastered: starred ? false : card.mastered, updatedAt: Date.now() } : card,
      );
      write(roomCode, state);
    },
    async toggleCardMastered(deckId, cardId, mastered) {
      const state = read(roomCode);
      state.cardsByDeck[deckId] = (state.cardsByDeck[deckId] ?? []).map((card) =>
        card.id === cardId ? { ...card, mastered, starred: mastered ? false : card.starred, updatedAt: Date.now() } : card,
      );
      write(roomCode, state);
    },
  };
}
