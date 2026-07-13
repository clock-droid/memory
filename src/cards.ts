import { splitCloze } from './parser';
import type { Card, NewCard, Section } from './types';

// ------------------------------------------------------------------ view model
export type ProtoCard = {
  id: string;
  q: string;
  a: string[];
  answerMastery: boolean[];
  knownCount: number;
  remainingCount: number;
  memorized: boolean;
  isGroup: boolean;
  source: Card;
};

export type ProtoList = {
  id: string;
  deckId: string;
  name: string;
  synthetic: boolean;
  cards: ProtoCard[];
};

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
  const anyBlank = items.some((it) => /\[[^\]]+\]/.test(it.text));
  if (anyBlank) {
    const qLines = [card.prompt];
    const a: string[] = [];
    for (const it of items) {
      let line = it.marker || '';
      for (const piece of splitCloze(it.text)) {
        if (piece.kind === 'text') line += piece.value;
        else { line += '___'; a.push(piece.value); }
      }
      qLines.push(line);
    }
    return { q: qLines.join('\n'), a };
  }
  const body = items.map((it) => `${it.marker || '· '}${it.text}`).join('\n');
  return { q: card.prompt, a: [body || card.prompt] };
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

export function normalizeAnswerMastery(card: Pick<Card, 'answerMastery' | 'mastered'>, answerCount: number): boolean[] {
  if (Array.isArray(card.answerMastery)) {
    return Array.from({ length: answerCount }, (_, i) => Boolean(card.answerMastery?.[i]));
  }
  return Array.from({ length: answerCount }, () => Boolean(card.mastered));
}

export function remapAnswerMastery(card: Card, nextAnswers: string[]): boolean[] {
  const previous = deriveQA(card);
  const previousMastery = normalizeAnswerMastery(card, previous.a.length);
  return nextAnswers.map((answer, i) => previous.a[i] === answer && Boolean(previousMastery[i]));
}

export function masterySummary(cards: ProtoCard[]) {
  return cards.reduce((summary, card) => ({
    total: summary.total + card.a.length,
    known: summary.known + card.knownCount,
  }), { total: 0, known: 0 });
}

export function qaToNewCard(q: string, a: string[], answerMastery = a.map(() => false)): NewCard {
  const isCloze = q.includes('___');
  const normalized = a.map((_, i) => Boolean(answerMastery[i]));
  return {
    type: isCloze ? 'cloze' : 'pair',
    prompt: q,
    answers: a,
    rawText: isCloze ? q : `${q}: ${a.join(', ')}`,
    answerMastery: normalized,
    mastered: normalized.length > 0 && normalized.every(Boolean),
  };
}

function cardToNewCard(card: Card, answerMasteryOverride?: boolean[]): NewCard {
  const answerMastery = answerMasteryOverride ?? normalizeAnswerMastery(card, card.answers.length);
  return {
    type: card.type,
    prompt: card.prompt,
    answers: card.answers,
    rawText: card.rawText,
    groupItems: card.groupItems,
    starred: card.starred,
    answerMastery,
    mastered: answerMastery.length > 0 && answerMastery.every(Boolean),
  };
}

export function keepCard(card: Card, answerMasteryOverride?: boolean[]): OptimisticNewCard {
  return { ...cardToNewCard(card, answerMasteryOverride), optimisticId: card.id };
}
