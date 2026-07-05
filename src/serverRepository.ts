import type { Card, Deck, NewCard, Repository, Section } from './types';

const SYNC_BASE = import.meta.env.VITE_SYNC_BASE || '';

function apiPath(roomCode: string, path: string) {
  return `${SYNC_BASE}/.netlify/functions/sync?room=${encodeURIComponent(roomCode)}&path=${encodeURIComponent(path)}`;
}

async function request<T>(roomCode: string, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiPath(roomCode, path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    if (response.status === 409) {
      throw new Error('다른 기기와 동시에 수정되었습니다. 잠시 후 다시 시도하세요.');
    }
    throw new Error(`Server sync request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error('서버에 연결할 수 없습니다.');
}

function addSub<T>(set: Set<(items: T[]) => void>, callback: (items: T[]) => void) {
  set.add(callback);
  return () => set.delete(callback);
}

export function createServerRepository(roomCode: string): Repository | null {
  const deckSubs = new Set<(items: Deck[]) => void>();
  const cardSubs = new Map<string, Set<(items: Card[]) => void>>();
  const sectionSubs = new Map<string, Set<(items: Section[]) => void>>();

  async function emitDecks() {
    if (deckSubs.size === 0) return;
    const decks = await request<Deck[]>(roomCode, '/decks');
    deckSubs.forEach((callback) => callback(decks));
  }

  async function emitCards(deckId: string) {
    const subs = cardSubs.get(deckId);
    if (!subs?.size) return;
    const cards = await request<Card[]>(roomCode, `/decks/${encodeURIComponent(deckId)}/cards`);
    subs.forEach((callback) => callback(cards));
  }

  async function emitSections(deckId: string) {
    const subs = sectionSubs.get(deckId);
    if (!subs?.size) return;
    const sections = await request<Section[]>(roomCode, `/decks/${encodeURIComponent(deckId)}/sections`);
    subs.forEach((callback) => callback(sections));
  }

  return {
    mode: 'cloud',
    ensureDefaultDeck() {
      return Promise.resolve();
    },
    subscribeDecks(callback, onError) {
      let active = true;
      let timer = 0;
      const unsubscribe = addSub(deckSubs, callback);
      const load = () => {
        void request<Deck[]>(roomCode, '/decks')
          .then((items) => {
            if (active) callback(items);
          })
          .catch((error) => {
            if (!active) return;
            onError?.(toError(error));
            timer = window.setTimeout(load, 5000);
          });
      };
      load();
      return () => {
        active = false;
        window.clearTimeout(timer);
        unsubscribe();
      };
    },
    subscribeCards(deckId, callback, onError) {
      let active = true;
      let timer = 0;
      const subs = cardSubs.get(deckId) ?? new Set<(items: Card[]) => void>();
      cardSubs.set(deckId, subs);
      const unsubscribe = addSub(subs, callback);
      const load = () => {
        void request<Card[]>(roomCode, `/decks/${encodeURIComponent(deckId)}/cards`)
          .then((items) => {
            if (active) callback(items);
          })
          .catch((error) => {
            if (!active) return;
            onError?.(toError(error));
            timer = window.setTimeout(load, 5000);
          });
      };
      load();
      return () => {
        active = false;
        window.clearTimeout(timer);
        unsubscribe();
      };
    },
    subscribeSections(deckId, callback, onError) {
      let active = true;
      let timer = 0;
      const subs = sectionSubs.get(deckId) ?? new Set<(items: Section[]) => void>();
      sectionSubs.set(deckId, subs);
      const unsubscribe = addSub(subs, callback);
      const load = () => {
        void request<Section[]>(roomCode, `/decks/${encodeURIComponent(deckId)}/sections`)
          .then((items) => {
            if (active) callback(items);
          })
          .catch((error) => {
            if (!active) return;
            onError?.(toError(error));
            timer = window.setTimeout(load, 5000);
          });
      };
      load();
      return () => {
        active = false;
        window.clearTimeout(timer);
        unsubscribe();
      };
    },
    async addDeck(name) {
      const result = await request<{ id: string }>(roomCode, '/decks', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await emitDecks();
      await emitSections(result.id);
      await emitCards(result.id);
      return result.id;
    },
    async renameDeck(deckId, name) {
      await request(roomCode, `/decks/${encodeURIComponent(deckId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      await emitDecks();
    },
    async deleteDeck(deckId) {
      await request(roomCode, `/decks/${encodeURIComponent(deckId)}`, { method: 'DELETE' });
      await emitDecks();
    },
    async addSection(deckId, name) {
      const result = await request<{ id: string }>(roomCode, `/decks/${encodeURIComponent(deckId)}/sections`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await emitSections(deckId);
      return result.id;
    },
    async renameSection(deckId, sectionId, name) {
      await request(roomCode, `/decks/${encodeURIComponent(deckId)}/sections/${encodeURIComponent(sectionId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      await emitSections(deckId);
    },
    async deleteSection(deckId, sectionId) {
      await request(roomCode, `/decks/${encodeURIComponent(deckId)}/sections/${encodeURIComponent(sectionId)}`, {
        method: 'DELETE',
      });
      await emitSections(deckId);
      await emitCards(deckId);
    },
    async setSectionContent(deckId, sectionId, sourceText, cards: NewCard[]) {
      await request(roomCode, `/decks/${encodeURIComponent(deckId)}/sections/${encodeURIComponent(sectionId)}/content`, {
        method: 'PUT',
        body: JSON.stringify({ sourceText, cards }),
      });
      await emitSections(deckId);
      await emitCards(deckId);
    },
    async toggleCardStar(deckId, cardId, starred) {
      await request(roomCode, `/decks/${encodeURIComponent(deckId)}/cards/${encodeURIComponent(cardId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ starred }),
      });
    },
    async toggleCardMastered(deckId, cardId, mastered) {
      await request(roomCode, `/decks/${encodeURIComponent(deckId)}/cards/${encodeURIComponent(cardId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ mastered }),
      });
    },
  };
}
