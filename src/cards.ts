import { splitCloze } from './parser';
import { groupSemanticAnswers } from './groupCardSchema';
import { normalizeAnswerSchedule } from './answerSchedule';
import type { AnswerSchedule, Card, NewCard, Section } from './types';
import type { StudyTarget } from './uiState';

// ------------------------------------------------------------------ view model
export type ProtoCard = {
  id: string;
  q: string;
  a: string[];
  answerMastery: boolean[];
  answerSchedule: Array<AnswerSchedule | null>;
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

export function protoCardSourceSignature(card: Pick<ProtoCard, 'q' | 'a'>) {
  return JSON.stringify([card.q, card.a]);
}

export function resolveEditedCardId(
  cards: Array<Pick<ProtoCard, 'id' | 'q' | 'a'>>,
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

type MasterySource = Pick<Card, 'answerMastery' | 'mastered'> & Partial<Pick<Card, 'type' | 'answers'>>;

export function normalizeAnswerMastery(card: MasterySource, answerCount: number): boolean[] {
  const legacyEmptyGroupMastery = card.type === 'group'
    && Array.isArray(card.answers)
    && card.answers.length === 0
    && Array.isArray(card.answerMastery)
    && card.answerMastery.length === 0;
  if (Array.isArray(card.answerMastery) && !legacyEmptyGroupMastery) {
    return Array.from({ length: answerCount }, (_, i) => Boolean(card.answerMastery?.[i]));
  }
  return Array.from({ length: answerCount }, () => Boolean(card.mastered));
}

export function remapAnswerMastery(card: Card, nextAnswers: string[]): boolean[] {
  const previous = deriveQA(card);
  const previousMastery = normalizeAnswerMastery(card, previous.a.length);
  return nextAnswers.map((answer, i) => previous.a[i] === answer && Boolean(previousMastery[i]));
}

// A hide whose answer text changed is a new memory item: its FSRS history no
// longer describes what the user must recall, so it restarts unscheduled.
export function remapAnswerSchedule(card: Card, nextAnswers: string[]): Array<AnswerSchedule | null> {
  const previous = deriveQA(card);
  const previousSchedule = normalizeAnswerSchedule(card, previous.a.length);
  return nextAnswers.map((answer, i) => (previous.a[i] === answer ? previousSchedule[i] : null));
}

export function masterySummary(cards: ProtoCard[]) {
  return cards.reduce((summary, card) => ({
    total: summary.total + card.a.length,
    known: summary.known + card.knownCount,
  }), { total: 0, known: 0 });
}

export function reconcileStudyTargets(
  queue: StudyTarget[],
  cards: Array<Pick<ProtoCard, 'id' | 'a'>>,
): { queue: StudyTarget[]; removedCount: number; currentChanged: boolean } {
  const answerCounts = new Map(cards.map((card) => [card.id, card.a.length]));
  let removedCount = 0;
  let changed = false;
  const nextQueue = queue.flatMap((target) => {
    const answerCount = answerCounts.get(target.cardId);
    if (answerCount === undefined) {
      removedCount += target.answerIndexes.length;
      changed = true;
      return [];
    }
    const answerIndexes = target.answerIndexes.filter((index) => index >= 0 && index < answerCount);
    removedCount += target.answerIndexes.length - answerIndexes.length;
    if (answerIndexes.length !== target.answerIndexes.length) changed = true;
    return answerIndexes.length > 0 ? [{ ...target, answerIndexes }] : [];
  });
  const previousCurrent = queue[0];
  const nextCurrent = nextQueue[0];
  const currentChanged = Boolean(previousCurrent) && (
    previousCurrent.cardId !== nextCurrent?.cardId
    || previousCurrent.answerIndexes.length !== nextCurrent.answerIndexes.length
  );
  return { queue: changed ? nextQueue : queue, removedCount, currentChanged };
}

export function qaToNewCard(
  q: string,
  a: string[],
  answerMastery = a.map(() => false),
  answerSchedule: Array<AnswerSchedule | null> = a.map(() => null),
): NewCard {
  const isCloze = q.includes('___');
  const normalized = a.map((_, i) => Boolean(answerMastery[i]));
  return {
    type: isCloze ? 'cloze' : 'pair',
    prompt: q,
    answers: a,
    rawText: isCloze ? q : `${q}: ${a.join(', ')}`,
    answerMastery: normalized,
    answerSchedule: a.map((_, i) => answerSchedule[i] ?? null),
    mastered: normalized.length > 0 && normalized.every(Boolean),
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
