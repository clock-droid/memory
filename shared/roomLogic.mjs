function id(prefix) {
  const value = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}_${value}`;
}

const CARD_TYPES = new Set(['pair', 'cloze', 'group']);
const BRACKET_ANSWER_PATTERN = /\[([^\[\]]+)\]/g;
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,180}$/;

function operationIdOf(body) {
  return Object.prototype.hasOwnProperty.call(body, 'operationId') ? body.operationId : null;
}

function hasValidOperationId(body) {
  const operationId = operationIdOf(body);
  return operationId === null || (typeof operationId === 'string' && OPERATION_ID_PATTERN.test(operationId));
}

function isValidGroupItem(item) {
  return item
    && typeof item === 'object'
    && !Array.isArray(item)
    && typeof item.marker === 'string'
    && typeof item.text === 'string'
    && item.text.trim().length > 0;
}

function groupSemanticAnswers(card) {
  const items = Array.isArray(card.groupItems) ? card.groupItems : [];
  const bracketAnswers = items.flatMap((item) =>
    typeof item?.text === 'string'
      ? [...item.text.matchAll(BRACKET_ANSWER_PATTERN)].map((match) => match[1].trim()).filter(Boolean)
      : [],
  );
  if (bracketAnswers.length > 0) return bracketAnswers;
  const body = items
    .filter(isValidGroupItem)
    .map((item) => `${item.marker || '· '}${item.text}`)
    .join('\n');
  return body ? [body] : [];
}

function normalizeLegacyGroupCard(card) {
  if (
    !card
    || typeof card !== 'object'
    || Array.isArray(card)
    || card.type !== 'group'
    || !Array.isArray(card.answers)
    || card.answers.length !== 0
  ) return card;
  const answers = groupSemanticAnswers(card);
  if (answers.length === 0) return card;
  const legacyEmptyMastery = Array.isArray(card.answerMastery) && card.answerMastery.length === 0;
  return {
    ...card,
    answers,
    ...(legacyEmptyMastery ? { answerMastery: answers.map(() => Boolean(card.mastered)) } : {}),
  };
}

function isRepairableNonGroup(card) {
  return card
    && typeof card === 'object'
    && !Array.isArray(card)
    && (card.type === 'pair' || card.type === 'cloze')
    && Array.isArray(card.answers);
}

function requiresRepair(card) {
  if (card?.type === 'group' && Array.isArray(card.answers)) {
    if (!Array.isArray(card.groupItems) || card.groupItems.length === 0 || !card.groupItems.every(isValidGroupItem)) {
      return true;
    }
    const semanticAnswers = groupSemanticAnswers(card);
    return semanticAnswers.length === 0 || !sameAnswers(card.answers, semanticAnswers);
  }
  if (!isRepairableNonGroup(card)) return false;
  if (card.answers.length === 0 || card.answers.some((answer) => typeof answer !== 'string' || answer.trim().length === 0)) {
    return true;
  }
  return card.type === 'cloze' && !hasValidClozeAnswers(card);
}

function quarantineRepairCard(card) {
  if (
    !card
    || typeof card !== 'object'
    || Array.isArray(card)
    || !CARD_TYPES.has(card.type)
    || !Array.isArray(card.answers)
    || (card.needsRepair !== true && !requiresRepair(card))
  ) return card;
  const repairGroup = card.type === 'group';
  return {
    ...card,
    ...(repairGroup ? { type: 'pair', answers: [], groupItems: undefined } : {}),
    needsRepair: true,
    answerMastery: [],
    mastered: false,
  };
}

function normalizeStoredCard(card) {
  return quarantineRepairCard(normalizeLegacyGroupCard(card));
}

function normalizeIncomingCard(card, allowLegacyQuarantine) {
  const normalized = normalizeLegacyGroupCard(card);
  if (
    normalized
    && typeof normalized === 'object'
    && !Array.isArray(normalized)
    && (normalized.needsRepair === true || (allowLegacyQuarantine && requiresRepair(normalized)))
  ) {
    return quarantineRepairCard(normalized);
  }
  return normalized;
}

function sameAnswers(actual, expected) {
  return actual.length === expected.length && actual.every((answer, index) => answer === expected[index]);
}

function bracketAnswers(rawText) {
  return [...rawText.matchAll(BRACKET_ANSWER_PATTERN)].map((match) => match[1].trim()).filter(Boolean);
}

function hasValidClozeAnswers(card) {
  const placeholderCount = card.prompt.match(/___/g)?.length ?? 0;
  if (placeholderCount > 0) return placeholderCount === card.answers.length;
  const embeddedAnswers = bracketAnswers(card.prompt);
  return embeddedAnswers.length > 0 && sameAnswers(card.answers, embeddedAnswers);
}

function isValidCardInput(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return false;
  if (!CARD_TYPES.has(card.type)) return false;
  if (typeof card.prompt !== 'string' || typeof card.rawText !== 'string') return false;
  if (Object.prototype.hasOwnProperty.call(card, 'needsRepair') && typeof card.needsRepair !== 'boolean') {
    return false;
  }
  const quarantined = card.needsRepair === true;
  if (quarantined) {
    if (
      !isRepairableNonGroup(card)
      || !requiresRepair(card)
      || !card.answers.every((answer) => typeof answer === 'string')
    ) return false;
    if (!Array.isArray(card.answerMastery) || card.answerMastery.length !== 0 || card.mastered !== false) return false;
    if (Object.prototype.hasOwnProperty.call(card, 'starred') && typeof card.starred !== 'boolean') return false;
    if (
      Object.prototype.hasOwnProperty.call(card, 'groupItems')
      && (!Array.isArray(card.groupItems) || !card.groupItems.every(isValidGroupItem))
    ) return false;
    return true;
  }
  if (
    !Array.isArray(card.answers)
    || card.answers.length === 0
    || !card.answers.every((answer) => typeof answer === 'string' && answer.trim().length > 0)
  ) return false;
  if (
    Object.prototype.hasOwnProperty.call(card, 'answerMastery')
    && (!Array.isArray(card.answerMastery)
      || card.answerMastery.length !== card.answers.length
      || !card.answerMastery.every((known) => typeof known === 'boolean'))
  ) return false;
  if (Object.prototype.hasOwnProperty.call(card, 'mastered') && typeof card.mastered !== 'boolean') return false;
  if (Object.prototype.hasOwnProperty.call(card, 'starred') && typeof card.starred !== 'boolean') return false;
  if (card.type === 'group') {
    if (!Array.isArray(card.groupItems) || card.groupItems.length === 0 || !card.groupItems.every(isValidGroupItem)) {
      return false;
    }
    if (!sameAnswers(card.answers, groupSemanticAnswers(card))) return false;
  } else if (card.type === 'cloze' && !hasValidClozeAnswers(card)) {
    return false;
  } else if (
    Object.prototype.hasOwnProperty.call(card, 'groupItems')
    && (!Array.isArray(card.groupItems) || !card.groupItems.every(isValidGroupItem))
  ) return false;
  return true;
}

export function emptyRoom() {
  return { revision: 0, decks: [], cardsByDeck: {}, sectionsByDeck: {} };
}

export function ensureRoom(room) {
  room.revision = Number.isInteger(room.revision) && room.revision >= 0 ? room.revision : 0;
  room.decks ??= [];
  room.cardsByDeck ??= {};
  room.sectionsByDeck ??= {};
  for (const [deckId, cards] of Object.entries(room.cardsByDeck)) {
    if (Array.isArray(cards)) room.cardsByDeck[deckId] = cards.map(normalizeStoredCard);
  }
  return room;
}

function ensureDeck(room, deckId) {
  room.cardsByDeck[deckId] ??= [];
  room.sectionsByDeck[deckId] ??= [];
}

function revisionOf(section) {
  return Number.isInteger(section?.revision) && section.revision >= 0 ? section.revision : 0;
}

function expectedRevisionOf(body) {
  return Number.isInteger(body.expectedRevision) && body.expectedRevision >= 0
    ? body.expectedRevision
    : null;
}

function hasRevisionConflict(resource, body) {
  const currentRevision = revisionOf(resource);
  const expectedRevision = expectedRevisionOf(body);
  if (expectedRevision !== null) return expectedRevision !== currentRevision;
  // Once a version-aware client has written this section, legacy clients must
  // refresh instead of silently overwriting newer content without a token.
  return currentRevision > 0;
}

function nextRevisionOf(resource, body) {
  const currentRevision = revisionOf(resource);
  // Legacy clients stay on revision zero so an already-open tab does not block
  // its own second save during rollout. The first version-aware write upgrades
  // the resource and protects it from later unversioned overwrites.
  return expectedRevisionOf(body) === null ? currentRevision : currentRevision + 1;
}

function nextUpdatedAt(previous) {
  return Math.max(Date.now(), Number(previous ?? 0) + 1);
}

function contentOperationWasApplied(section, operationId) {
  return section.contentOperationId === operationId
    || (Array.isArray(section.contentOperationIds) && section.contentOperationIds.includes(operationId));
}

function rememberContentOperation(section, operationId) {
  const previous = Array.isArray(section.contentOperationIds)
    ? section.contentOperationIds.filter((item) => typeof item === 'string' && item !== operationId)
    : [];
  return operationId ? [...previous, operationId].slice(-32) : previous.slice(-32);
}

export function applyRoomRequest({ room, method, parts, body }) {
  const deckId = parts[1];
  const sectionId = parts[3];

  if (method === 'POST' && parts[0] === 'ensure') {
    return { status: 200, body: { ok: true }, write: false };
  }

  if (method === 'GET' && parts[0] === 'version' && parts.length === 1) {
    return { status: 200, body: { revision: room.revision }, write: false };
  }

  if (method === 'GET' && parts[0] === 'decks' && parts.length === 1) {
    return { status: 200, body: room.decks, write: false };
  }

  if (method === 'POST' && parts[0] === 'decks' && parts.length === 1) {
    if (!hasValidOperationId(body)) {
      return { status: 400, body: { error: 'Invalid operation id' }, write: false };
    }
    const operationId = operationIdOf(body);
    const existingDeck = operationId
      ? room.decks.find((deck) => deck.clientOperationId === operationId)
      : undefined;
    if (existingDeck) return { status: 200, body: { id: existingDeck.id }, write: false };
    const now = Date.now();
    const nextDeck = {
      id: id('deck'),
      name: String(body.name || '새 암기장'),
      ...(operationId ? { clientOperationId: operationId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    room.decks.push(nextDeck);
    room.cardsByDeck[nextDeck.id] = [];
    room.sectionsByDeck[nextDeck.id] = [];
    return { status: 200, body: { id: nextDeck.id }, write: true };
  }

  if (parts[0] === 'decks' && deckId && parts.length === 2) {
    const deckExists = room.decks.some((deck) => deck.id === deckId);
    if (!deckExists) return { status: 409, body: { error: 'conflict' }, write: false };
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
    const deckExists = room.decks.some((deck) => deck.id === deckId);
    if (!deckExists) return { status: 409, body: { error: 'conflict' }, write: false };
    ensureDeck(room, deckId);
    if (method === 'GET' && parts.length === 3) {
      return { status: 200, body: room.cardsByDeck[deckId], write: false };
    }
    if (method === 'PATCH' && parts[3]) {
      const currentCard = room.cardsByDeck[deckId].find((card) => card.id === parts[3]);
      if (!currentCard) return { status: 409, body: { error: 'conflict' }, write: false };
      const hasStarred = Object.prototype.hasOwnProperty.call(body, 'starred');
      const hasMastered = Object.prototype.hasOwnProperty.call(body, 'mastered');
      const hasAnswerMastery = Object.prototype.hasOwnProperty.call(body, 'answerMastery');
      if (!hasStarred && !hasMastered && !hasAnswerMastery) {
        return { status: 400, body: { error: 'Invalid card patch' }, write: false };
      }
      if (
        (hasStarred && typeof body.starred !== 'boolean')
        || (hasMastered && typeof body.mastered !== 'boolean')
        || (currentCard.needsRepair === true && hasMastered && body.mastered !== false)
        || (hasAnswerMastery
          && (!Array.isArray(body.answerMastery)
            || (currentCard.needsRepair === true
              ? body.answerMastery.length !== 0
              : !Array.isArray(currentCard.answers) || body.answerMastery.length !== currentCard.answers.length)
            || !body.answerMastery.every((known) => typeof known === 'boolean')))
      ) {
        return { status: 400, body: { error: 'Invalid card patch' }, write: false };
      }
      if (hasRevisionConflict(currentCard, body)) {
        return { status: 409, body: { error: 'conflict' }, write: false };
      }
      const revision = nextRevisionOf(currentCard, body);
      const parentSectionId = currentCard.sectionId ?? 'default';
      const parentSection = room.sectionsByDeck[deckId].find((section) => section.id === parentSectionId);
      const sectionRevision = parentSection ? revisionOf(parentSection) + 1 : undefined;
      if (parentSection && sectionRevision !== undefined) {
        const updatedAt = nextUpdatedAt(parentSection.updatedAt);
        room.sectionsByDeck[deckId] = room.sectionsByDeck[deckId].map((section) =>
          section.id === parentSectionId ? { ...section, revision: sectionRevision, updatedAt } : section,
        );
      }
      room.cardsByDeck[deckId] = room.cardsByDeck[deckId].map((card) =>
        card.id === parts[3]
          ? { ...applyCardPatch(card, body, { hasStarred, hasMastered, hasAnswerMastery }), revision }
          : card,
      );
      return {
        status: 200,
        body: {
          ok: true,
          revision,
          ...(parentSection && sectionRevision !== undefined
            ? { sectionId: parentSectionId, sectionRevision }
            : {}),
        },
        write: true,
      };
    }
  }

  if (parts[0] === 'decks' && deckId && parts[2] === 'sections') {
    const deckExists = room.decks.some((deck) => deck.id === deckId);
    if (!deckExists) return { status: 409, body: { error: 'conflict' }, write: false };
    ensureDeck(room, deckId);
    if (method === 'GET' && parts.length === 3) {
      return { status: 200, body: room.sectionsByDeck[deckId], write: false };
    }
    if (method === 'POST' && parts.length === 3) {
      if (!hasValidOperationId(body)) {
        return { status: 400, body: { error: 'Invalid operation id' }, write: false };
      }
      const operationId = operationIdOf(body);
      const existingSection = operationId
        ? room.sectionsByDeck[deckId].find((section) => section.clientOperationId === operationId)
        : undefined;
      if (existingSection) return { status: 200, body: { id: existingSection.id }, write: false };
      const now = Date.now();
      const nextSection = {
        id: id('section'),
        name: String(body.name || '새 세부 목록'),
        sourceText: '',
        ...(operationId ? { clientOperationId: operationId } : {}),
        revision: 0,
        createdAt: now,
        updatedAt: now,
      };
      room.sectionsByDeck[deckId].push(nextSection);
      return { status: 200, body: { id: nextSection.id }, write: true };
    }
    if (sectionId && method === 'PATCH' && parts.length === 4) {
      if (typeof body.name !== 'string') {
        return { status: 400, body: { error: 'Invalid section patch' }, write: false };
      }
      const section = room.sectionsByDeck[deckId].find((item) => item.id === sectionId);
      if (!section) return { status: 409, body: { error: 'conflict' }, write: false };
      if (hasRevisionConflict(section, body)) {
        return { status: 409, body: { error: 'conflict' }, write: false };
      }
      const revision = nextRevisionOf(section, body);
      const updatedAt = nextUpdatedAt(section.updatedAt);
      room.sectionsByDeck[deckId] = room.sectionsByDeck[deckId].map((section) =>
        section.id === sectionId
          ? { ...section, name: String(body.name || section.name), revision, updatedAt }
          : section,
      );
      return { status: 200, body: { ok: true, revision }, write: true };
    }
    if (sectionId && method === 'DELETE' && parts.length === 4) {
      const section = room.sectionsByDeck[deckId].find((item) => item.id === sectionId);
      if (!section) return { status: 409, body: { error: 'conflict' }, write: false };
      if (hasRevisionConflict(section, body)) {
        return { status: 409, body: { error: 'conflict' }, write: false };
      }
      room.sectionsByDeck[deckId] = room.sectionsByDeck[deckId].filter((section) => section.id !== sectionId);
      room.cardsByDeck[deckId] = room.cardsByDeck[deckId].filter((card) => (card.sectionId ?? 'default') !== sectionId);
      return { status: 200, body: { ok: true }, write: true };
    }
    if (sectionId && method === 'PUT' && parts[4] === 'content') {
      if (!hasValidOperationId(body)) {
        return { status: 400, body: { error: 'Invalid operation id' }, write: false };
      }
      const operationId = operationIdOf(body);
      const section = room.sectionsByDeck[deckId].find((item) => item.id === sectionId);
      if (!section) return { status: 409, body: { error: 'conflict' }, write: false };
      if (operationId && contentOperationWasApplied(section, operationId)) {
        const persisted = room.cardsByDeck[deckId].filter(
          (card) => (card.sectionId ?? 'default') === sectionId,
        );
        return {
          status: 200,
          body: { cards: persisted, revision: revisionOf(section) },
          write: false,
        };
      }
      const allowLegacyQuarantine = expectedRevisionOf(body) === null;
      const cards = Array.isArray(body.cards)
        ? body.cards.map((card) => normalizeIncomingCard(card, allowLegacyQuarantine))
        : null;
      if (
        typeof body.sourceText !== 'string'
        || !cards
        || !cards.every(isValidCardInput)
      ) {
        return { status: 400, body: { error: 'Invalid section content' }, write: false };
      }
      if (hasRevisionConflict(section, body)) {
        return { status: 409, body: { error: 'conflict' }, write: false };
      }
      const now = nextUpdatedAt(section.updatedAt);
      const revision = nextRevisionOf(section, body);
      const sourceText = body.sourceText;
      room.sectionsByDeck[deckId] = room.sectionsByDeck[deckId].map((section) =>
        section.id === sectionId
          ? {
              ...section,
              sourceText,
              contentOperationId: operationId,
              contentOperationIds: rememberContentOperation(section, operationId),
              revision,
              updatedAt: now,
            }
          : section,
      );
      const created = cards.map((card) => ({
        ...card, sectionId, id: id('card'), revision: 0, createdAt: now, updatedAt: now,
      }));
      room.cardsByDeck[deckId] = [
        ...room.cardsByDeck[deckId].filter((card) => (card.sectionId ?? 'default') !== sectionId),
        ...created,
      ];
      // return the persisted cards (with real ids) so the client can reconcile
      // its optimistic cache instead of keeping dead tmp_ ids
      return {
        status: 200,
        body: operationId ? { cards: created, revision } : created,
        write: true,
      };
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
