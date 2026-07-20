import { useCallback } from 'react';
import { keepCard, protoCardSourceSignature, qaToNewCard, remapAnswerMastery, remapAnswerSchedule, resolveEditedCardId } from '../cards';
import type { ProtoCard, ProtoList } from '../cards';
import type { RoomStore } from '../sync/useRoomStore';
import { cardToTokens, editSignature, tokensToCard, tokensToText } from '../tokens';
import type { Patch, UIState } from '../uiState';
import type { CommitSection } from './useCardActions';
import type { Toast } from './useToast';

/** `___` placeholders the prompt asks the user to fill. */
function blankCount(prompt: string) {
  return prompt.match(/___/g)?.length ?? 0;
}

export type CardEditorOptions = {
  store: RoomStore;
  activeList: ProtoList | undefined;
  commitSection: CommitSection;
  dispatch: (patch: Patch) => void;
  toast: Toast;
};

/**
 * Opening, validating and saving one card in the edit sheet. Saving rewrites
 * the whole section, so the card being edited is re-located by id first and by
 * its original text second — another device may have renumbered the ids.
 */
export function useCardEditor({ store, activeList, commitSection, dispatch, toast }: CardEditorOptions) {
  const openEditFor = useCallback((card: ProtoCard) => {
    if (!activeList) return;
    const index = activeList.cards.findIndex((item) => item.id === card.id);
    if (index < 0) return;
    if (card.isGroup) toast('묶음 카드는 저장하면 일반 카드로 바뀌어요');
    const shared = {
      editSheetOpen: true,
      editIdx: index,
      editCardId: card.id,
      editSourceSignature: protoCardSourceSignature(card),
    };
    if (card.q.includes('___')) {
      const tokens = cardToTokens(card.q, card.a);
      dispatch({
        ...shared,
        editMode: 'tokens',
        editSingleAnswer: false,
        editTokens: tokens,
        editText: tokensToText(tokens),
        editInitialSignature: editSignature('tokens', '', '', tokens),
      });
      return;
    }
    const editA = card.a.join(', ');
    dispatch({
      ...shared,
      editMode: 'qa',
      editSingleAnswer: card.a.length === 1,
      editQ: card.q,
      editA,
      editInitialSignature: editSignature('qa', card.q, editA, []),
    });
  }, [activeList, dispatch, toast]);

  /** Returns the edited question and hides, or null with a reason toasted. */
  const readDraft = useCallback((state: UIState, notify: boolean) => {
    if (state.editMode === 'tokens') {
      if (!state.editTokens.some((token) => token.hidden)) {
        if (notify) toast('가릴 단어를 선택하세요');
        return null;
      }
      return tokensToCard(state.editTokens);
    }
    const q = state.editQ.trim();
    const a = state.editSingleAnswer
      ? [state.editA.trim()].filter(Boolean)
      : state.editA.split(',').map((part) => part.trim()).filter(Boolean);
    if (!q) {
      if (notify) toast('질문을 입력하세요');
      return null;
    }
    if (a.length === 0) {
      if (notify) toast('답을 입력하세요');
      return null;
    }
    const blanks = blankCount(q);
    if (blanks > 0 && blanks !== a.length) {
      if (notify) toast(`가림 ${blanks}곳에 맞게 답 ${blanks}개를 입력하세요`);
      return null;
    }
    return { q, a };
  }, [toast]);

  const saveEditFrom = useCallback(async (state: UIState, close: boolean) => {
    if (!activeList || state.editCardId === null) return true;
    const draft = readDraft(state, close);
    if (!draft) return false;
    const stored = store.storedCardsOf(activeList.deckId, activeList.id);
    const targetId = resolveEditedCardId(activeList.cards, state.editCardId, state.editSourceSignature);
    const targetIndex = targetId ? stored.findIndex((card) => card.id === targetId) : -1;
    if (targetIndex < 0) {
      toast('다른 기기에서 이 카드가 변경되었어요. 초안을 복사한 뒤 다시 열어 주세요');
      return false;
    }
    const rebuilt = stored.map((card, index) => index === targetIndex
      ? {
          ...qaToNewCard(draft.q, draft.a, remapAnswerMastery(card, draft.a), remapAnswerSchedule(card, draft.a)),
          optimisticId: card.id,
        }
      : keepCard(card));
    const queued = commitSection(activeList.deckId, activeList.id, rebuilt);
    return queued.accepted ? queued.done : false;
  }, [activeList, store, commitSection, readDraft, toast]);

  const deleteEditingCard = useCallback((state: UIState) => {
    if (!activeList || state.editCardId === null) return;
    const { deckId, id: sectionId } = activeList;
    const before = store.storedCardsOf(deckId, sectionId);
    const targetId = resolveEditedCardId(activeList.cards, state.editCardId, state.editSourceSignature);
    if (!targetId || !before.some((card) => card.id === targetId)) {
      toast('다른 기기에서 이 카드가 변경되었어요. 다시 열어 주세요');
      return;
    }
    const after = before.filter((card) => card.id !== targetId);
    if (!commitSection(deckId, sectionId, after.map((card) => keepCard(card))).accepted) return;
    dispatch({ editSheetOpen: false });
    toast('카드를 삭제했어요', () => commitSection(deckId, sectionId, before.map((card) => keepCard(card))));
  }, [activeList, store, commitSection, dispatch, toast]);

  return { openEditFor, saveEditFrom, deleteEditingCard };
}
