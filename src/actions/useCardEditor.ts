import { useCallback } from 'react';
import type { Dispatch } from 'react';
import { keepCard, protoCardSourceSignature, qaToNewCard, remapAnswerMastery, remapAnswerSchedule, resolveEditedCardId } from '../cards';
import type { ProtoCard, ProtoList } from '../cards';
import { hideTexts } from '../hides';
import type { Patch } from '../state/patchState';
import type { EditorState } from '../state/uiSlices';
import type { RoomStore } from '../sync/useRoomStore';
import { cardToTokens, editSignature, tokensToCard, tokensToText } from '../tokens';
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
  setEditor: Dispatch<Patch<EditorState>>;
  toast: Toast;
};

/**
 * Opening, validating and saving one card in the edit sheet. Saving rewrites
 * the whole section, so the card being edited is re-located by id first and by
 * its original text second — another device may have renumbered the ids.
 */
export function useCardEditor({ store, activeList, commitSection, setEditor, toast }: CardEditorOptions) {
  const openEditFor = useCallback((card: ProtoCard) => {
    if (!activeList) return;
    const index = activeList.cards.findIndex((item) => item.id === card.id);
    if (index < 0) return;
    if (card.isGroup) toast('묶음 카드는 저장하면 일반 카드로 바뀌어요');
    const shared = {
      open: true,
      index,
      cardId: card.id,
      sourceSignature: protoCardSourceSignature(card),
      selection: null,
    };
    const texts = hideTexts(card.hides);
    if (card.q.includes('___')) {
      const tokens = cardToTokens(card.q, texts);
      setEditor({
        ...shared,
        mode: 'tokens',
        singleAnswer: false,
        tokens,
        text: tokensToText(tokens),
        initialSignature: editSignature('tokens', '', '', tokens),
      });
      return;
    }
    const a = texts.join(', ');
    setEditor({
      ...shared,
      mode: 'qa',
      singleAnswer: texts.length === 1,
      q: card.q,
      a,
      initialSignature: editSignature('qa', card.q, a, []),
    });
  }, [activeList, setEditor, toast]);

  /** Returns the edited question and hides, or null with a reason toasted. */
  const readDraft = useCallback((editor: EditorState, notify: boolean) => {
    if (editor.mode === 'tokens') {
      if (!editor.tokens.some((token) => token.hidden)) {
        if (notify) toast('가릴 단어를 선택하세요');
        return null;
      }
      return tokensToCard(editor.tokens);
    }
    const q = editor.q.trim();
    const a = editor.singleAnswer
      ? [editor.a.trim()].filter(Boolean)
      : editor.a.split(',').map((part) => part.trim()).filter(Boolean);
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

  const saveEdit = useCallback(async (editor: EditorState, close: boolean) => {
    if (!activeList || editor.cardId === null) return true;
    const draft = readDraft(editor, close);
    if (!draft) return false;
    const stored = store.storedCardsOf(activeList.deckId, activeList.id);
    const targetId = resolveEditedCardId(activeList.cards, editor.cardId, editor.sourceSignature);
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

  const deleteEditingCard = useCallback((editor: EditorState) => {
    if (!activeList || editor.cardId === null) return;
    const { deckId, id: sectionId } = activeList;
    const before = store.storedCardsOf(deckId, sectionId);
    const targetId = resolveEditedCardId(activeList.cards, editor.cardId, editor.sourceSignature);
    if (!targetId || !before.some((card) => card.id === targetId)) {
      toast('다른 기기에서 이 카드가 변경되었어요. 다시 열어 주세요');
      return;
    }
    const after = before.filter((card) => card.id !== targetId);
    if (!commitSection(deckId, sectionId, after.map((card) => keepCard(card))).accepted) return;
    setEditor({ open: false });
    toast('카드를 삭제했어요', () => commitSection(deckId, sectionId, before.map((card) => keepCard(card))));
  }, [activeList, store, commitSection, setEditor, toast]);

  return { openEditFor, saveEdit, deleteEditingCard };
}
