function id(prefix) {
  const value = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}_${value}`;
}

export function emptyRoom() {
  return { decks: [], cardsByDeck: {}, sectionsByDeck: {} };
}

export function ensureRoom(room) {
  room.decks ??= [];
  room.cardsByDeck ??= {};
  room.sectionsByDeck ??= {};
  return room;
}

function ensureDeck(room, deckId) {
  room.cardsByDeck[deckId] ??= [];
  room.sectionsByDeck[deckId] ??= [];
}

export function applyRoomRequest({ room, method, parts, body }) {
  const deckId = parts[1];
  const sectionId = parts[3];

  if (method === 'POST' && parts[0] === 'ensure') {
    return { status: 200, body: { ok: true }, write: false };
  }

  if (method === 'GET' && parts[0] === 'decks' && parts.length === 1) {
    return { status: 200, body: room.decks, write: false };
  }

  if (method === 'POST' && parts[0] === 'decks' && parts.length === 1) {
    const now = Date.now();
    const nextDeck = { id: id('deck'), name: String(body.name || '새 암기장'), createdAt: now, updatedAt: now };
    room.decks.push(nextDeck);
    room.cardsByDeck[nextDeck.id] = [];
    room.sectionsByDeck[nextDeck.id] = [];
    return { status: 200, body: { id: nextDeck.id }, write: true };
  }

  if (parts[0] === 'decks' && deckId && parts.length === 2) {
    if (method === 'PATCH') {
      room.decks = room.decks.map((deck) =>
        deck.id === deckId ? { ...deck, name: String(body.name || deck.name), updatedAt: Date.now() } : deck,
      );
      return { status: 200, body: { ok: true }, write: true };
    }
    if (method === 'DELETE') {
      room.decks = room.decks.filter((deck) => deck.id !== deckId);
      delete room.cardsByDeck[deckId];
      delete room.sectionsByDeck[deckId];
      return { status: 200, body: { ok: true }, write: true };
    }
  }

  if (parts[0] === 'decks' && deckId && parts[2] === 'cards') {
    ensureDeck(room, deckId);
    if (method === 'GET' && parts.length === 3) {
      return { status: 200, body: room.cardsByDeck[deckId], write: false };
    }
    if (method === 'PATCH' && parts[3]) {
      const hasStarred = Object.prototype.hasOwnProperty.call(body, 'starred');
      const hasMastered = Object.prototype.hasOwnProperty.call(body, 'mastered');
      const hasAnswerMastery = Array.isArray(body.answerMastery);
      room.cardsByDeck[deckId] = room.cardsByDeck[deckId].map((card) =>
        card.id === parts[3] ? applyCardPatch(card, body, { hasStarred, hasMastered, hasAnswerMastery }) : card,
      );
      return { status: 200, body: { ok: true }, write: true };
    }
  }

  if (parts[0] === 'decks' && deckId && parts[2] === 'sections') {
    ensureDeck(room, deckId);
    if (method === 'GET' && parts.length === 3) {
      return { status: 200, body: room.sectionsByDeck[deckId], write: false };
    }
    if (method === 'POST' && parts.length === 3) {
      const now = Date.now();
      const nextSection = {
        id: id('section'),
        name: String(body.name || '새 세부 목록'),
        sourceText: '',
        createdAt: now,
        updatedAt: now,
      };
      room.sectionsByDeck[deckId].push(nextSection);
      return { status: 200, body: { id: nextSection.id }, write: true };
    }
    if (sectionId && method === 'PATCH' && parts.length === 4) {
      room.sectionsByDeck[deckId] = room.sectionsByDeck[deckId].map((section) =>
        section.id === sectionId ? { ...section, name: String(body.name || section.name), updatedAt: Date.now() } : section,
      );
      return { status: 200, body: { ok: true }, write: true };
    }
    if (sectionId && method === 'DELETE' && parts.length === 4) {
      room.sectionsByDeck[deckId] = room.sectionsByDeck[deckId].filter((section) => section.id !== sectionId);
      room.cardsByDeck[deckId] = room.cardsByDeck[deckId].filter((card) => (card.sectionId ?? 'default') !== sectionId);
      return { status: 200, body: { ok: true }, write: true };
    }
    if (sectionId && method === 'PUT' && parts[4] === 'content') {
      const now = Date.now();
      const sourceText = String(body.sourceText ?? '');
      const cards = Array.isArray(body.cards) ? body.cards : [];
      room.sectionsByDeck[deckId] = room.sectionsByDeck[deckId].map((section) =>
        section.id === sectionId ? { ...section, sourceText, updatedAt: now } : section,
      );
      room.cardsByDeck[deckId] = [
        ...room.cardsByDeck[deckId].filter((card) => (card.sectionId ?? 'default') !== sectionId),
        ...cards.map((card) => ({ ...card, sectionId, id: id('card'), createdAt: now, updatedAt: now })),
      ];
      return { status: 200, body: { ok: true }, write: true };
    }
  }

  return { status: 404, body: { error: 'Not found' }, write: false };
}

function applyCardPatch(card, body, { hasStarred, hasMastered, hasAnswerMastery }) {
  const answerMastery = hasAnswerMastery ? body.answerMastery.map(Boolean) : card.answerMastery;
  const masteredFromAnswers = hasAnswerMastery && answerMastery.length > 0 ? answerMastery.every(Boolean) : undefined;
  let mastered = masteredFromAnswers ?? (hasMastered ? Boolean(body.mastered) : card.mastered);
  let starred = hasStarred ? Boolean(body.starred) : card.starred;
  if (hasStarred && starred) mastered = false;
  if ((hasMastered || hasAnswerMastery) && mastered) starred = false;
  return {
    ...card,
    ...(hasStarred || ((hasMastered || hasAnswerMastery) && mastered) ? { starred } : {}),
    ...(hasAnswerMastery ? { answerMastery } : {}),
    ...(hasStarred || hasMastered || hasAnswerMastery ? { mastered } : {}),
    updatedAt: Date.now(),
  };
}
