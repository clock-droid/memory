import { splitCloze } from './parser';
import { groupSemanticAnswers } from './groupCardSchema';
import { normalizeAnswerSchedule } from './answerSchedule';
import { buildHides, hideTexts, knownCountOf, normalizeAnswerMastery, unratedHides } from './hides';
import type { Hide } from './hides';
import type { AnswerSchedule, Card, Deck, NewCard, Section, StudyTarget } from './types';

// ------------------------------------------------------------------ view model
export type ProtoCard = {
  id: string;
  q: string;
  /** The card's hides, in prompt order. This is the learning unit. */
  hides: Hide[];
  knownCount: number;
  remainingCount: number;
  memorized: boolean;
  needsRepair: boolean;
  isGroup: boolean;
  updatedAt: number;
  source: Card;
};

export type ProtoList = {
  id: string;
  deckId: string;
  name: string;
  synthetic: boolean;
  cards: ProtoCard[];
};

export function protoCardSourceSignature(card: Pick<ProtoCard, 'q' | 'hides'>) {
  return JSON.stringify([card.q, hideTexts(card.hides)]);
}

export function resolveEditedCardId(
  cards: Array<Pick<ProtoCard, 'id' | 'q' | 'hides'>>,
  preferredId: string | null,
  sourceSignature: string,
) {
  if (preferredId && cards.some((card) => card.id === preferredId)) return preferredId;
  const matches = cards.filter((card) => protoCardSourceSignature(card) === sourceSignature);
  return matches.length === 1 ? matches[0].id : null;
}

export function cardNeedsRepair(card: Pick<Card, 'type' | 'prompt' | 'answers' | 'needsRepair'>) {
  if (card.needsRepair === true) return true;
  if (!Array.isArray(card.answers)) return true;
  if (card.type === 'group') {
    const items = (card as Pick<Card, 'groupItems'>).groupItems;
    if (
      !Array.isArray(items)
      || items.length === 0
      || items.some((item) => !item || typeof item.marker !== 'string' || typeof item.text !== 'string' || item.text.trim().length === 0)
    ) return true;
    const semanticAnswers = groupSemanticAnswers(card.prompt, items);
    return card.answers.length > 0 && (
      card.answers.length !== semanticAnswers.length
      || card.answers.some((answer, index) => answer !== semanticAnswers[index])
    );
  }
  if (card.answers.length === 0 || card.answers.some((answer) => typeof answer !== 'string' || answer.trim().length === 0)) {
    return true;
  }
  if (card.type !== 'cloze') return false;
  const placeholderCount = card.prompt.match(/___/g)?.length ?? 0;
  if (placeholderCount > 0) return placeholderCount !== card.answers.length;
  const embeddedAnswers = [...card.prompt.matchAll(/\[([^\[\]]+)\]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  return embeddedAnswers.length === 0
    || embeddedAnswers.length !== card.answers.length
    || embeddedAnswers.some((answer, index) => answer !== card.answers[index]);
}

// NewCard + a client-only hint so the optimistic cache can keep the card's
// current id (the server regenerates ids on every content PUT).
export type OptimisticNewCard = NewCard & { optimisticId?: string };

export type DeckCacheEntry = { cards: Card[]; sections: Section[]; cardsLoaded: boolean; sectionsLoaded: boolean };
export function emptyDeckCache(): DeckCacheEntry {
  return { cards: [], sections: [], cardsLoaded: false, sectionsLoaded: false };
}

/** Replacing a slice also marks it loaded: the caller now holds a real snapshot. */
export function withCards(entry: DeckCacheEntry, cards: Card[]): DeckCacheEntry {
  return { ...entry, cards, cardsLoaded: true };
}

export function withSections(entry: DeckCacheEntry, sections: Section[]): DeckCacheEntry {
  return { ...entry, sections, sectionsLoaded: true };
}

// stored Card -> prototype-style { q(with ___), a[] }
function deriveGroup(card: Card): { q: string; a: string[] } {
  const items = card.groupItems ?? [];
  const semanticAnswers = groupSemanticAnswers(card.prompt, items);
  const anyBlank = items.some((it) => /\[[^\]]+\]/.test(it.text));
  if (anyBlank) {
    const qLines = [card.prompt];
    for (const it of items) {
      let line = it.marker || '';
      for (const piece of splitCloze(it.text)) {
        if (piece.kind === 'text') line += piece.value;
        else line += '___';
      }
      qLines.push(line);
    }
    return { q: qLines.join('\n'), a: semanticAnswers };
  }
  return { q: card.prompt, a: semanticAnswers };
}

export function deriveQA(card: Card): { q: string; a: string[] } {
  if (card.type === 'group') return deriveGroup(card);
  if (card.type === 'cloze') {
    if (card.prompt.includes('___')) return { q: card.prompt, a: card.answers };
    const pieces = splitCloze(card.prompt);
    if (pieces.some((p) => p.kind === 'blank')) {
      let q = '';
      const a: string[] = [];
      for (const piece of pieces) {
        if (piece.kind === 'text') q += piece.value;
        else { q += '___'; a.push(piece.value); }
      }
      return { q, a };
    }
  }
  return { q: card.prompt, a: card.answers };
}

/**
 * The hides a card keeps once its answers are edited. A hide whose text changed
 * is a new memory item — neither the judgment nor the FSRS history describes
 * what the user must now recall — so it restarts unrated.
 */
export function remapHides(card: Card, nextAnswers: string[]): Hide[] {
  const previous = deriveQA(card);
  const kept = buildHides(card, previous.a);
  const restarted = unratedHides(card, nextAnswers);
  return nextAnswers.map((text, index) =>
    previous.a[index] === text ? kept[index] : restarted[index]);
}

/** Stored card -> the hide-level view model every screen reads. */
export function toProtoCard(card: Card): ProtoCard {
  const needsRepair = cardNeedsRepair(card);
  // A broken group card keeps its raw text visible so the user can repair it.
  const { q, a } = needsRepair && card.type === 'group'
    ? { q: card.prompt, a: card.rawText.trim() ? [card.rawText] : [] }
    : deriveQA(card);
  // A card that needs repair still shows its text, but claims no judgments and
  // offers no study target until the user fixes it.
  const hides = needsRepair ? unratedHides(card, a) : buildHides(card, a);
  const knownCount = knownCountOf(hides);
  return {
    id: card.id,
    q,
    hides,
    knownCount,
    remainingCount: needsRepair ? 0 : hides.length - knownCount,
    memorized: !needsRepair && hides.length > 0 && knownCount === hides.length,
    needsRepair,
    isGroup: card.type === 'group',
    updatedAt: card.updatedAt,
    source: card,
  };
}

const DEFAULT_SECTION_ID = 'default';
const sectionIdOf = (card: Card) => card.sectionId ?? DEFAULT_SECTION_ID;

/**
 * Flattens the deck/section/card cache into the flat list of screens.
 * Cards whose section no longer exists stay reachable in a synthetic list
 * instead of disappearing with their hide-level progress.
 */
export function buildLists(decks: Deck[], deckDataById: Record<string, DeckCacheEntry>): ProtoList[] {
  const lists: ProtoList[] = [];
  for (const deck of decks) {
    const data = deckDataById[deck.id];
    const sections = data?.sections ?? [];
    const cards = data?.cards ?? [];
    const knownSectionIds = new Set(sections.map((section) => section.id));
    for (const section of sections) {
      lists.push({
        id: section.id,
        deckId: deck.id,
        name: !section.name || section.name === '새 목록' ? '새 암기장' : section.name,
        synthetic: false,
        cards: cards.filter((card) => sectionIdOf(card) === section.id).map(toProtoCard),
      });
    }
    const orphans = cards.filter((card) => !knownSectionIds.has(sectionIdOf(card)));
    const orphansBySection = new Map<string, Card[]>();
    for (const card of orphans) {
      const key = sectionIdOf(card);
      const bucket = orphansBySection.get(key) ?? [];
      bucket.push(card);
      orphansBySection.set(key, bucket);
    }
    for (const [sectionId, bucket] of orphansBySection) {
      lists.push({
        id: sectionId,
        deckId: deck.id,
        name: '기본',
        synthetic: true,
        cards: bucket.map(toProtoCard),
      });
    }
  }
  return lists;
}

/** Most unknown hides first: the cards that need the work lead the session. */
export function weakestFirst(cards: ProtoCard[]): ProtoCard[] {
  return [...cards].sort((x, y) => y.remainingCount - x.remainingCount);
}

export function masterySummary(cards: ProtoCard[]) {
  return cards.reduce((summary, card) => ({
    total: summary.total + card.hides.length,
    known: summary.known + card.knownCount,
  }), { total: 0, known: 0 });
}

export function reconcileStudyTargets(
  queue: StudyTarget[],
  cards: Array<Pick<ProtoCard, 'id' | 'hides'>>,
): { queue: StudyTarget[]; removedCount: number; currentChanged: boolean } {
  const hideCounts = new Map(cards.map((card) => [card.id, card.hides.length]));
  let removedCount = 0;
  let changed = false;
  const nextQueue = queue.flatMap((target) => {
    const hideCount = hideCounts.get(target.cardId);
    if (hideCount === undefined) {
      removedCount += target.hideIndexes.length;
      changed = true;
      return [];
    }
    const hideIndexes = target.hideIndexes.filter((index) => index >= 0 && index < hideCount);
    removedCount += target.hideIndexes.length - hideIndexes.length;
    if (hideIndexes.length !== target.hideIndexes.length) changed = true;
    return hideIndexes.length > 0 ? [{ ...target, hideIndexes }] : [];
  });
  const previousCurrent = queue[0];
  const nextCurrent = nextQueue[0];
  const currentChanged = Boolean(previousCurrent) && (
    previousCurrent.cardId !== nextCurrent?.cardId
    || previousCurrent.hideIndexes.length !== nextCurrent.hideIndexes.length
  );
  return { queue: changed ? nextQueue : queue, removedCount, currentChanged };
}

/** Builds a card from edited text, carrying over the hides it kept. */
export function qaToNewCard(q: string, a: string[], hides?: Hide[]): NewCard {
  const isCloze = q.includes('___');
  const mastery = a.map((_, i) => Boolean(hides?.[i]?.known));
  return {
    type: isCloze ? 'cloze' : 'pair',
    prompt: q,
    answers: a,
    rawText: isCloze ? q : `${q}: ${a.join(', ')}`,
    answerMastery: mastery,
    answerSchedule: a.map((_, i) => hides?.[i]?.schedule ?? null),
    mastered: mastery.length > 0 && mastery.every(Boolean),
  };
}

function cardToNewCard(card: Card, answerMasteryOverride?: boolean[]): NewCard {
  const needsRepair = cardNeedsRepair(card);
  const repairGroup = needsRepair && card.type === 'group';
  const answers = repairGroup ? [] : card.type === 'group' ? deriveGroup(card).a : card.answers;
  const answerMastery = needsRepair
    ? []
    : answerMasteryOverride
      ? Array.from({ length: answers.length }, (_, index) => Boolean(answerMasteryOverride[index]))
      : normalizeAnswerMastery(card, answers.length);
  return {
    type: repairGroup ? 'pair' : card.type,
    prompt: card.prompt,
    answers,
    rawText: card.rawText,
    groupItems: repairGroup ? undefined : card.groupItems,
    ...(needsRepair ? { needsRepair: true } : {}),
    starred: card.starred,
    answerMastery,
    answerSchedule: needsRepair ? [] : normalizeAnswerSchedule(card, answers.length),
    mastered: !needsRepair && answerMastery.length > 0 && answerMastery.every(Boolean),
  };
}

export function keepCard(card: Card, answerMasteryOverride?: boolean[]): OptimisticNewCard {
  return { ...cardToNewCard(card, answerMasteryOverride), optimisticId: card.id };
}
