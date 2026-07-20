import { useCallback, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { keepCard } from '../domain/cards';
import type { OptimisticNewCard, ProtoList } from '../domain/cards';
import { newOperationId } from '../sync/operationId';
import type { Patch } from '../state/patchState';
import { initialComposer } from '../state/uiSlices';
import type { ComposerState, DeckUiState, RouteState } from '../state/uiSlices';
import type { CreatedList, RoomStore } from '../sync/useRoomStore';
import type { NewCard } from '../domain/types';
import type { CommitSection } from './useCardActions';
import type { Toast } from './useToast';

/** What the last add did, so "되돌리기" can put the list back exactly. */
type AddSnapshot =
  | { kind: 'appended'; deckId: string; sectionId: string; cards: OptimisticNewCard[]; addedCount: number }
  | { kind: 'created'; created: CreatedList; addedCount: number };

export type ListDraftOptions = {
  store: RoomStore;
  activeList: ProtoList | undefined;
  commitSection: CommitSection;
  setRoute: Dispatch<Patch<RouteState>>;
  setComposer: Dispatch<Patch<ComposerState>>;
  setDeck: Dispatch<Patch<DeckUiState>>;
  goHome: () => void;
  toast: Toast;
};

/** A composer opened on an empty draft, ready for the first card. */
const freshComposer = () => ({ ...initialComposer, open: true, operationId: newOperationId() });

/**
 * The add flow, including the case where the list itself does not exist yet.
 * A draft list is only persisted once it has cards, so an abandoned draft never
 * leaves an empty list behind.
 */
export function useListDraft({
  store, activeList, commitSection, setRoute, setComposer, setDeck, goHome, toast,
}: ListDraftOptions) {
  const [draft, setDraft] = useState<{ name: string; operationId: string } | null>(null);
  const snapshot = useRef<AddSnapshot | null>(null);

  const forgetLastAdd = useCallback(() => { snapshot.current = null; }, []);

  const startNewList = useCallback(() => {
    if (!store.isReady) return;
    snapshot.current = null;
    setDraft({ name: '새 암기장', operationId: newOperationId() });
    setRoute({ view: 'deck', deckId: null, sectionId: null });
    setComposer(freshComposer());
  }, [store.isReady, setRoute, setComposer]);

  const openAdd = useCallback(() => {
    snapshot.current = null;
    setComposer(freshComposer());
    setDeck({ openRowId: null });
  }, [setComposer, setDeck]);

  const addCards = useCallback(async (cards: NewCard[], operationId: string) => {
    if (draft) {
      const created = await store.createListWithCards(draft.name, draft.operationId, cards);
      if (!created) {
        toast('암기장을 만들지 못했어요');
        return false;
      }
      snapshot.current = { kind: 'created', created, addedCount: cards.length };
      setDraft(null);
      setRoute({ deckId: created.deckId, sectionId: created.sectionId });
      return true;
    }
    if (!activeList) return false;
    const { deckId, id: sectionId } = activeList;
    const stored = store.storedCardsOf(deckId, sectionId).map((card) => keepCard(card));
    snapshot.current = { kind: 'appended', deckId, sectionId, cards: stored, addedCount: cards.length };
    const queued = commitSection(deckId, sectionId, [...stored, ...cards], operationId);
    const saved = queued.accepted ? await queued.done : false;
    if (!saved) snapshot.current = null;
    return saved;
  }, [draft, store, activeList, commitSection, setRoute, toast]);

  /** Returns how many cards were rolled back, or 0 when nothing was undone. */
  const undoLastAdd = useCallback(async () => {
    const last = snapshot.current;
    if (!last || !store.isReady) return 0;
    if (last.kind === 'created') {
      if (!await store.removeCreatedList(last.created)) {
        toast('되돌리지 못했어요');
        return 0;
      }
      setDraft({ name: '새 암기장', operationId: newOperationId() });
      setRoute({ deckId: null, sectionId: null });
      snapshot.current = null;
      return last.addedCount;
    }
    if (!activeList || last.deckId !== activeList.deckId || last.sectionId !== activeList.id) return 0;
    const queued = commitSection(last.deckId, last.sectionId, last.cards);
    if (!queued.accepted || !await queued.done) return 0;
    snapshot.current = null;
    return last.addedCount;
  }, [store, activeList, commitSection, setRoute, toast]);

  const closeAdd = useCallback(() => {
    snapshot.current = null;
    if (!draft) {
      setComposer(initialComposer);
      return;
    }
    setDraft(null);
    goHome();
  }, [draft, setComposer, goHome]);

  return { draft, startNewList, openAdd, addCards, undoLastAdd, closeAdd, forgetLastAdd };
}
