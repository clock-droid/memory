import { hideMastery, hideSchedules } from '../domain/hides';
import type { Hide } from '../domain/hides';
import type { Card, Section } from '../domain/types';

export function replaceSectionCards(cards: Card[], sectionId: string, replacement: Card[]) {
  return [
    ...cards.filter((card) => (card.sectionId ?? 'default') !== sectionId),
    ...replacement,
  ];
}

export function applyHides(cards: Card[], cardId: string, hides: Hide[]) {
  const answerMastery = hideMastery(hides);
  const mastered = answerMastery.length > 0 && answerMastery.every(Boolean);
  return cards.map((card) => card.id === cardId
    ? {
        ...card,
        answerMastery,
        answerSchedule: hideSchedules(hides),
        mastered,
        starred: mastered ? false : card.starred,
      }
    : card);
}

export function applySectionName(sections: Section[], sectionId: string, name: string) {
  return sections.map((section) => section.id === sectionId ? { ...section, name } : section);
}

export class CardIdAliases {
  private readonly aliases = new Map<string, string>();

  private key(deckId: string, cardId: string) {
    return `${deckId}:${cardId}`;
  }

  recordReplacement(deckId: string, optimisticCards: Card[], savedCards: Card[]) {
    optimisticCards.forEach((card, index) => {
      const saved = savedCards[index];
      if (saved && saved.id !== card.id) this.aliases.set(this.key(deckId, card.id), saved.id);
    });
  }

  resolve(deckId: string, cardId: string) {
    let resolved = cardId;
    const seen = new Set<string>();
    while (!seen.has(resolved)) {
      seen.add(resolved);
      const next = this.aliases.get(this.key(deckId, resolved));
      if (!next) break;
      resolved = next;
    }
    return resolved;
  }

  clearDeck(deckId: string) {
    const prefix = `${deckId}:`;
    for (const key of this.aliases.keys()) {
      if (key.startsWith(prefix)) this.aliases.delete(key);
    }
  }
}
