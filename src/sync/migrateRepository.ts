import type { DeckCacheEntry } from '../domain/cards';
import type { Card, Deck, NewCard } from '../domain/types';
import type { Repository } from './repository';

function operationId(kind: 'deck' | 'section' | 'content', id: string) {
  return `migration-${kind}-${id}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
}

function asNewCard(card: Card): NewCard {
  const {
    id: _id,
    sectionId: _sectionId,
    revision: _revision,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...newCard
  } = card;
  return newCard;
}

/**
 * Copies the currently confirmed room into an account repository.
 *
 * Stable operation ids make the transfer resumable: repeating it after a
 * redirect, timeout or app restart reuses the same decks, sections and content.
 * The source is never removed.
 */
export async function migrateRoomToAccount(
  decks: Deck[],
  deckDataById: Record<string, DeckCacheEntry>,
  destination: Repository,
) {
  for (const deck of decks) {
    const destinationDeckId = await destination.addDeck(deck.name, operationId('deck', deck.id));
    const entry = deckDataById[deck.id] ?? {
      cards: [], sections: [], cardsLoaded: true, sectionsLoaded: true,
    };
    for (const section of entry.sections) {
      const destinationSectionId = await destination.addSection(
        destinationDeckId,
        section.name,
        operationId('section', `${deck.id}-${section.id}`),
      );
      const cards = entry.cards
        .filter((card) => (card.sectionId ?? 'default') === section.id)
        .map(asNewCard);
      await destination.setSectionContent(
        destinationDeckId,
        destinationSectionId,
        section.sourceText,
        cards,
        operationId('content', `${deck.id}-${section.id}`),
      );
    }
  }
}
