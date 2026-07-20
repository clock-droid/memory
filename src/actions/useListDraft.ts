import { useCallback, useRef, useState } from 'react';
import { keepCard } from '../cards';
import type { OptimisticNewCard, ProtoList } from '../cards';
import { newOperationId } from '../operationId';
import type { CreatedList, RoomStore } from '../sync/useRoomStore';
import type { NewCard } from '../types';
import type { Patch } from '../uiState';
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
  dispatch: (patch: Patch) => void;
  toast: Toast;
};

/**
 * The add flow, including the case where the list itself does not exist yet.
 * A draft list is only persisted once it has cards, so an abandoned draft never
 * leaves an empty list behind.
 */
export function useListDraft({ store, activeList, commitSection, dispatch, toast }: ListDraftOptions) {
  const [draft, setDraft] = useState<{ name: string; operationId: string } | null>(null);
  const snapshot = useRef<AddSnapshot | null>(null);

  const forgetLastAdd = useCallback(() => { snapshot.current = null; }, []);

  const startNewList = useCallback(() => {
    if (!store.isReady) return;
    snapshot.current = null;
    setDraft({ name: '새 암기장', operationId: newOperationId() });
    dispatch({
      view: 'deck', activeDeckId: null, activeSectionId: null,
      slotOpen: true, pasteText: '', sheetRows: [], addOperationId: newOperationId(),
    });
  }, [store.isReady, dispatch]);

  const openAdd = useCallback(() => {
    snapshot.current = null;
    dispatch({
      slotOpen: true, pasteText: '', pasteMode: 'auto', sheetRows: [],
      addOperationId: newOperationId(), openRowId: null,
    });
  }, [dispatch]);

  const addCards = useCallback(async (cards: NewCard[], operationId: string) => {
    if (draft) {
      const created = await store.createListWithCards(draft.name, draft.operationId, cards);
      if (!created) {
        toast('암기장을 만들지 못했어요');
        return false;
      }
      snapshot.current = { kind: 'created', created, addedCount: cards.length };
      setDraft(null);
      dispatch({ activeDeckId: created.deckId, activeSectionId: created.sectionId });
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
  }, [draft, store, activeList, commitSection, dispatch, toast]);

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
      dispatch({ activeDeckId: null, activeSectionId: null });
      snapshot.current = null;
      return last.addedCount;
    }
    if (!activeList || last.deckId !== activeList.deckId || last.sectionId !== activeList.id) return 0;
    const queued = commitSection(last.deckId, last.sectionId, last.cards);
    if (!queued.accepted || !await queued.done) return 0;
    snapshot.current = null;
    return last.addedCount;
  }, [store, activeList, commitSection, dispatch, toast]);

  const closeAdd = useCallback(() => {
    snapshot.current = null;
    const cleared = { slotOpen: false, pasteText: '', pasteMode: 'auto' as const, sheetRows: [], addOperationId: '', sel: null };
    if (!draft) {
      dispatch(cleared);
      return;
    }
    setDraft(null);
    dispatch({ ...cleared, view: 'home', activeDeckId: null, activeSectionId: null });
  }, [draft, dispatch]);

  return { draft, startNewList, openAdd, addCards, undoLastAdd, closeAdd, forgetLastAdd };
}
