import { useCallback } from 'react';
import type { Dispatch } from 'react';
import { keepCard } from '../cards';
import type { OptimisticNewCard, ProtoCard, ProtoList } from '../cards';
import type { EnqueuedMutation } from '../mutationQueue';
import type { Patch } from '../state/patchState';
import type { DeckUiState } from '../state/uiSlices';
import type { RoomStore } from '../sync/useRoomStore';
import type { Toast } from './useToast';

/** Writes a section's full card list, with the shared failure copy attached. */
export type CommitSection = (
  deckId: string,
  sectionId: string,
  cards: OptimisticNewCard[],
  operationId?: string,
) => EnqueuedMutation;

export type CardActionsOptions = {
  store: RoomStore;
  activeList: ProtoList | undefined;
  setDeck: Dispatch<Patch<DeckUiState>>;
  goHome: () => void;
  toast: Toast;
};

/**
 * Card-level intents for the open list. Every one of them is a full-section
 * write: the backend stores a section's cards as one revision.
 */
export function useCardActions({ store, activeList, setDeck, goHome, toast }: CardActionsOptions) {
  const commitSection = useCallback<CommitSection>(
    (deckId, sectionId, cards, operationId) => store.saveSectionCards(deckId, sectionId, cards, {
      operationId,
      onRejected: () => toast('연결을 복구한 뒤 다시 시도해 주세요'),
      onFailure: () => toast('저장하지 못했어요. 연결을 복구한 뒤 다시 시도해 주세요'),
    }),
    [store, toast],
  );

  const renameList = useCallback((name: string) => {
    if (!activeList || activeList.synthetic) return;
    store.renameSection(activeList.deckId, activeList.id, name, {
      onFailure: () => toast('이름을 저장하지 못했어요. 연결을 복구해 주세요'),
    });
  }, [store, activeList, toast]);

  const deleteCard = useCallback((card: ProtoCard) => {
    if (!activeList) return;
    const { deckId, id: sectionId } = activeList;
    const before = store.storedCardsOf(deckId, sectionId);
    const after = before.filter((stored) => stored.id !== card.id);
    if (!commitSection(deckId, sectionId, after.map((stored) => keepCard(stored))).accepted) return;
    setDeck({ openRowId: null });
    toast('카드를 삭제했어요', () => commitSection(deckId, sectionId, before.map((stored) => keepCard(stored))));
  }, [activeList, store, commitSection, setDeck, toast]);

  const moveCard = useCallback((draggedId: string, targetId: string) => {
    if (!activeList) return;
    const stored = store.storedCardsOf(activeList.deckId, activeList.id);
    const from = stored.findIndex((card) => card.id === draggedId);
    const to = stored.findIndex((card) => card.id === targetId);
    if (from < 0 || to < 0) return;
    const reordered = [...stored];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    commitSection(activeList.deckId, activeList.id, reordered.map((card) => keepCard(card)));
  }, [activeList, store, commitSection]);

  const deleteList = useCallback(async () => {
    if (!activeList || activeList.synthetic || !store.isReady) return;
    // Deleting under an in-flight write would race the revision it is bumping.
    if (store.hasPendingWrites(activeList.deckId)) {
      toast('저장이 끝난 뒤 암기장을 삭제해 주세요');
      return;
    }
    const cardNote = activeList.cards.length > 0 ? `카드 ${activeList.cards.length}개가 함께 삭제돼요.` : '';
    if (!window.confirm(`"${activeList.name}" 암기장을 삭제할까요? ${cardNote}`)) return;
    goHome();
    const deleted = await store.deleteSection(activeList.deckId, activeList.id);
    toast(deleted ? '암기장을 삭제했어요' : '삭제에 실패했어요');
  }, [activeList, store, goHome, toast]);

  return { commitSection, renameList, deleteCard, moveCard, deleteList };
}
