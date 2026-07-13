import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { createFirebaseRepository } from './firebase';
import { createLocalRepository } from './localRepository';
import { createServerRepository } from './serverRepository';
import { ACCENT, ROOM_KEY } from './constants';
import { cardToTokens, editSignature, toggleTokenAt, tokensToCard, tokensToText } from './tokens';
import type { Token } from './tokens';
import { deriveQA, emptyDeckCache, keepCard, normalizeAnswerMastery, qaToNewCard, remapAnswerMastery } from './cards';
import type { DeckCacheEntry, OptimisticNewCard, ProtoCard, ProtoList } from './cards';
import { initialUI, uiReducer } from './uiState';
import type { StudyTarget, UIState } from './uiState';
import type { Card, Deck, NewCard, Repository, Section } from './types';
import { ContinuousAddView } from './views/ContinuousAddView';
import { DeckView } from './views/DeckView';
import { EditSheet } from './views/EditSheet';
import { HomeView } from './views/HomeView';
import { IdGate } from './views/IdGate';
import { SettingsSheet } from './views/SettingsSheet';
import { StudyView } from './views/StudyView';

// ================================================================== App
export default function App() {
  const [roomCode, setRoomCode] = useState(() => localStorage.getItem(ROOM_KEY) ?? '');
  if (!roomCode) return <IdGate onSubmit={(code) => { localStorage.setItem(ROOM_KEY, code); setRoomCode(code); }} />;
  return <Room key={roomCode} roomCode={roomCode} onChangeRoom={(code) => { localStorage.setItem(ROOM_KEY, code); setRoomCode(code); }} />;
}

function Room({ roomCode, onChangeRoom }: { roomCode: string; onChangeRoom: (code: string) => void }) {
  const repository = useMemo<Repository | null>(() => {
    if (!roomCode) return null;
    return createFirebaseRepository(roomCode) ?? createServerRepository(roomCode) ?? createLocalRepository(roomCode);
  }, [roomCode]);

  const [decks, setDecks] = useState<Deck[]>([]);
  const [decksState, setDecksState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [deckDataById, setDeckDataById] = useState<Record<string, DeckCacheEntry>>({});
  const [state, dispatch] = useReducer(uiReducer, initialUI);
  const [draftList, setDraftList] = useState<{ name: string } | null>(null);
  const pendingSectionRenamesRef = useRef<Record<string, string>>({});
  const toastTimer = useRef<number | undefined>(undefined);
  const toastUndoRef = useRef<(() => void) | null>(null);
  const lpTimer = useRef<number | undefined>(undefined);
  const rowStart = useRef<{ x: number; y: number; moved: boolean }>({ x: 0, y: 0, moved: false });
  const lastAddedSnapshotRef = useRef<{
    deckId: string;
    sectionId: string;
    cards: OptimisticNewCard[];
    addedCount: number;
    createdList?: boolean;
    createdDeck?: boolean;
  } | null>(null);

  const toast = useCallback((msg: string, undo?: () => void) => {
    window.clearTimeout(toastTimer.current);
    toastUndoRef.current = undo ?? null;
    dispatch({ toastMsg: msg, toastVisible: true, toastUndo: Boolean(undo) });
    toastTimer.current = window.setTimeout(() => {
      toastUndoRef.current = null;
      dispatch({ toastVisible: false, toastUndo: false });
    }, undo ? 4200 : 1800);
  }, []);

  const undoToast = useCallback(() => {
    const action = toastUndoRef.current;
    if (!action) return;
    window.clearTimeout(toastTimer.current);
    toastUndoRef.current = null;
    dispatch({ toastVisible: false, toastUndo: false });
    action();
  }, []);

  const commitSelection = useCallback(() => {
    dispatch((st) => {
      const sel = st.sel;
      if (!sel) return {};
      const lo = Math.min(sel.start, sel.end);
      const hi = Math.max(sel.start, sel.end);
      const apply = (tokens: Token[]): Token[] => {
        if (lo === hi && sel.wasHidden) {
          const g = tokens[lo].gid;
          return tokens.map((t) => (t.gid === g && g !== 0 ? { ...t, hidden: false, gid: 0 } : t));
        }
        const g = (Date.now() % 1000000) + lo;
        return tokens.map((t, i) => (!t.nl && i >= lo && i <= hi ? { ...t, hidden: true, gid: g } : t));
      };
      if (sel.ri === -100) return { editTokens: apply(st.editTokens), sel: null };
      return {
        sheetRows: st.sheetRows.map((r, ri) => (ri === sel.ri && r.kind === 'tokens' ? { ...r, tokens: apply(r.tokens) } : r)),
        sel: null,
      };
    });
  }, []);

  // ---- subscriptions
  useEffect(() => {
    if (!repository) return;
    setDecksState('loading');
    repository.ensureDefaultDeck().catch(() => {});
    const unsub = repository.subscribeDecks(
      (next) => { setDecksState('ready'); setDecks(next); },
      (error) => { setDecksState('error'); toast(error.message || '서버에 연결할 수 없습니다.'); },
    );
    return unsub;
  }, [repository, toast]);

  const deckIdsKey = decks.map((d) => d.id).join(',');
  useEffect(() => {
    if (!repository) return;
    const unsubs: Array<() => void> = [];
    for (const deck of decks) {
      const deckId = deck.id;
      unsubs.push(repository.subscribeCards(deckId, (cards) => {
        setDeckDataById((cur) => ({ ...cur, [deckId]: { ...(cur[deckId] ?? emptyDeckCache()), cards, cardsLoaded: true } }));
      }));
      unsubs.push(repository.subscribeSections(deckId, (sections) => {
        const pending = pendingSectionRenamesRef.current;
        setDeckDataById((cur) => ({
          ...cur,
          [deckId]: {
            ...(cur[deckId] ?? emptyDeckCache()),
            sections: sections.map((s) => (pending[`${deckId}:${s.id}`] ? { ...s, name: pending[`${deckId}:${s.id}`] } : s)),
            sectionsLoaded: true,
          },
        }));
      }));
    }
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, deckIdsKey]);

  // ---- window pointer up (commit selections / cancel drags)
  useEffect(() => {
    const up = () => {
      commitSelection();
      window.clearTimeout(lpTimer.current);
      dispatch((st) => (st.reorder ? { reorder: null } : {}));
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [commitSelection]);

  // ---- derived lists (subject=Deck, list=Section, card=Card)
  const lists = useMemo<ProtoList[]>(() => {
    const out: ProtoList[] = [];
    for (const deck of decks) {
      const data = deckDataById[deck.id];
      const sections = data?.sections ?? [];
      const cards = data?.cards ?? [];
      const seen = new Set<string>();
      const toProto = (c: Card): ProtoCard => {
        const { q, a } = deriveQA(c);
        const answerMastery = normalizeAnswerMastery(c, a.length);
        const knownCount = answerMastery.filter(Boolean).length;
        return {
          id: c.id,
          q,
          a,
          answerMastery,
          knownCount,
          remainingCount: a.length - knownCount,
          memorized: a.length > 0 && knownCount === a.length,
          isGroup: c.type === 'group',
          source: c,
        };
      };
      for (const section of sections) {
        seen.add(section.id);
        out.push({
          id: section.id, deckId: deck.id,
          name: !section.name || section.name === '새 목록' ? '새 암기장' : section.name, synthetic: false,
          cards: cards.filter((c) => (c.sectionId ?? 'default') === section.id).map(toProto),
        });
      }
      // orphan cards whose section no longer exists
      const orphans = cards.filter((c) => !seen.has(c.sectionId ?? 'default'));
      if (orphans.length > 0) {
        const byBucket = new Map<string, Card[]>();
        for (const c of orphans) {
          const key = c.sectionId ?? 'default';
          (byBucket.get(key) ?? byBucket.set(key, []).get(key)!).push(c);
        }
        for (const [key, bucket] of byBucket) {
          out.push({
            id: key, deckId: deck.id,
            name: '기본', synthetic: true, cards: bucket.map(toProto),
          });
        }
      }
    }
    return out;
  }, [decks, deckDataById]);

  const activeList = lists.find((l) => l.deckId === state.activeDeckId && l.id === state.activeSectionId);
  const weakFirst = useCallback((cards: ProtoCard[]) => [...cards].sort((x, y) => y.remainingCount - x.remainingCount), []);

  const storedCardsOf = useCallback((deckId: string, sectionId: string): Card[] => {
    const cards = deckDataById[deckId]?.cards ?? [];
    return cards.filter((c) => (c.sectionId ?? 'default') === sectionId);
  }, [deckDataById]);

  // ---- mutations
  const commitSection = useCallback((deckId: string, sectionId: string, newCards: OptimisticNewCard[]) => {
    if (!repository) return;
    const payload: NewCard[] = newCards.map(({ optimisticId: _ignored, ...card }) => card);
    const sourceText = payload.map((c) => c.rawText).join('\n');
    const now = Date.now();
    setDeckDataById((cur) => {
      const prev = cur[deckId] ?? emptyDeckCache();
      const others = prev.cards.filter((c) => (c.sectionId ?? 'default') !== sectionId);
      const optimistic = newCards.map((c, i) => {
        const { optimisticId, ...card } = c;
        return { ...card, id: optimisticId ?? `tmp_${now}_${i}`, sectionId, createdAt: now, updatedAt: now } as Card;
      });
      return { ...cur, [deckId]: { ...prev, cards: [...others, ...optimistic], cardsLoaded: true } };
    });
    repository.setSectionContent(deckId, sectionId, sourceText, payload).catch(() => toast('저장에 실패했어요'));
  }, [repository, toast]);

  const setAnswerMastery = useCallback((deckId: string, cardId: string, answerMastery: boolean[]) => {
    if (!repository) return;
    const mastered = answerMastery.length > 0 && answerMastery.every(Boolean);
    setDeckDataById((cur) => {
      const prev = cur[deckId];
      if (!prev) return cur;
      return {
        ...cur,
        [deckId]: {
          ...prev,
          cards: prev.cards.map((c) => (c.id === cardId ? { ...c, answerMastery, mastered, starred: mastered ? false : c.starred } : c)),
        },
      };
    });
    repository.setCardAnswerMastery(deckId, cardId, answerMastery).catch(() => toast('학습 상태 저장에 실패했어요'));
  }, [repository, toast]);

  const renameSection = useCallback((deckId: string, sectionId: string, name: string) => {
    if (!repository) return;
    pendingSectionRenamesRef.current[`${deckId}:${sectionId}`] = name;
    setDeckDataById((cur) => {
      const prev = cur[deckId];
      if (!prev) return cur;
      return { ...cur, [deckId]: { ...prev, sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, name } : s)) } };
    });
    repository.renameSection(deckId, sectionId, name)
      .then(() => { delete pendingSectionRenamesRef.current[`${deckId}:${sectionId}`]; })
      .catch(() => toast('이름 저장에 실패했어요'));
  }, [repository, toast]);

  const newList = useCallback(() => {
    if (!repository) return;
    lastAddedSnapshotRef.current = null;
    setDraftList({ name: '새 암기장' });
    dispatch({ view: 'deck', activeDeckId: null, activeSectionId: null, slotOpen: true, pasteText: '', sheetRows: [] });
  }, [repository]);

  const createDraftListWithCards = useCallback(async (cards: NewCard[]): Promise<boolean> => {
    if (!repository || !draftList) return false;
    let deckId = decks.find((deck) => deck.name === '일반')?.id;
    let sectionId: string | undefined;
    let createdDeck = false;
    try {
      if (!deckId) {
        deckId = await repository.addDeck('일반');
        createdDeck = true;
      }
      sectionId = await repository.addSection(deckId, draftList.name);
      const sourceText = cards.map((card) => card.rawText).join('\n');
      await repository.setSectionContent(deckId, sectionId, sourceText, cards);

      const now = Date.now();
      const resolvedDeckId = deckId;
      const resolvedSectionId = sectionId;
      const optimisticCards: Card[] = cards.map((card, index) => ({
        ...card,
        id: `tmp_${now}_${index}`,
        sectionId: resolvedSectionId,
        createdAt: now,
        updatedAt: now,
      }));
      setDecks((current) => current.some((deck) => deck.id === resolvedDeckId)
        ? current
        : [...current, { id: resolvedDeckId, name: '일반', createdAt: now, updatedAt: now }]);
      setDeckDataById((current) => {
        const previous = current[resolvedDeckId] ?? emptyDeckCache();
        const section: Section = { id: resolvedSectionId, name: draftList.name, sourceText, createdAt: now, updatedAt: now };
        return {
          ...current,
          [resolvedDeckId]: {
            ...previous,
            cards: [...previous.cards.filter((card) => (card.sectionId ?? 'default') !== resolvedSectionId), ...optimisticCards],
            sections: [...previous.sections.filter((item) => item.id !== resolvedSectionId), section],
            cardsLoaded: true,
            sectionsLoaded: true,
          },
        };
      });
      lastAddedSnapshotRef.current = {
        deckId: resolvedDeckId,
        sectionId: resolvedSectionId,
        cards: [],
        addedCount: cards.length,
        createdList: true,
        createdDeck,
      };
      setDraftList(null);
      dispatch({ activeDeckId: resolvedDeckId, activeSectionId: resolvedSectionId });
      return true;
    } catch {
      try {
        if (sectionId && deckId) await repository.deleteSection(deckId, sectionId);
        if (createdDeck && deckId) await repository.deleteDeck(deckId);
      } catch { /* best-effort cleanup */ }
      toast('암기장을 만들지 못했어요');
      return false;
    }
  }, [repository, draftList, decks, toast]);

  const moveCard = useCallback((draggedId: string, targetId: string) => {
    if (!activeList) return;
    const stored = storedCardsOf(activeList.deckId, activeList.id);
    const from = stored.findIndex((c) => c.id === draggedId);
    const to = stored.findIndex((c) => c.id === targetId);
    if (from < 0 || to < 0) return;
    const arr = [...stored];
    const [d] = arr.splice(from, 1);
    arr.splice(to, 0, d);
    commitSection(activeList.deckId, activeList.id, arr.map((c) => keepCard(c)));
  }, [activeList, storedCardsOf, commitSection]);

  const deleteList = useCallback(async () => {
    if (!repository || !activeList || activeList.synthetic) return;
    const label = activeList.cards.length > 0 ? `카드 ${activeList.cards.length}개가 함께 삭제돼요.` : '';
    if (!window.confirm(`"${activeList.name}" 암기장을 삭제할까요? ${label}`)) return;
    const remaining = (deckDataById[activeList.deckId]?.sections ?? []).filter((s) => s.id !== activeList.id);
    dispatch({ view: 'home', activeDeckId: null, activeSectionId: null, openRowId: null });
    try {
      await repository.deleteSection(activeList.deckId, activeList.id);
      if (remaining.length === 0) await repository.deleteDeck(activeList.deckId);
      toast('암기장을 삭제했어요');
    } catch {
      toast('삭제에 실패했어요');
    }
  }, [repository, activeList, deckDataById, toast]);

  const openEditFor = useCallback((c: ProtoCard) => {
    if (!activeList) return;
    const idx = activeList.cards.findIndex((cc) => cc.id === c.id);
    if (idx < 0) return;
    if (c.isGroup) toast('묶음 카드는 저장하면 일반 카드로 바뀌어요');
    if (c.q.includes('___') || c.isGroup) {
      const tokens = cardToTokens(c.q, c.a);
      dispatch({
        editSheetOpen: true,
        editIdx: idx,
        editMode: 'tokens',
        editTokens: tokens,
        editText: tokensToText(tokens),
        editInitialSignature: editSignature('tokens', '', '', tokens),
      });
    } else {
      const editA = c.a.join(', ');
      dispatch({
        editSheetOpen: true,
        editIdx: idx,
        editMode: 'qa',
        editQ: c.q,
        editA,
        editInitialSignature: editSignature('qa', c.q, editA, []),
      });
    }
  }, [activeList, toast]);

  const saveEditFrom = useCallback((st: UIState, close: boolean) => {
    if (!activeList || st.editIdx === null) return true;
    let q: string;
    let a: string[];
    if (st.editMode === 'qa') {
      q = st.editQ.trim();
      a = st.editA.split(',').map((x) => x.trim()).filter(Boolean);
      if (!q) { if (close) toast('질문을 입력하세요'); return false; }
    } else {
      if (!st.editTokens.some((t) => t.hidden)) { if (close) toast('가릴 단어를 선택하세요'); return false; }
      const r = tokensToCard(st.editTokens);
      q = r.q; a = r.a;
    }
    const stored = storedCardsOf(activeList.deckId, activeList.id);
    if (st.editIdx >= stored.length) return true;
    const rebuilt = stored.map((c, i) =>
      i === st.editIdx ? { ...qaToNewCard(q, a, remapAnswerMastery(c, a)), optimisticId: c.id } : keepCard(c),
    );
    commitSection(activeList.deckId, activeList.id, rebuilt);
    return true;
  }, [activeList, storedCardsOf, commitSection, toast]);

  const startStudy = useCallback((deckId: string, sectionId: string, cardIds?: string[]) => {
    const list = lists.find((l) => l.deckId === deckId && l.id === sectionId);
    if (!list) return;
    if (list.cards.length === 0) { dispatch({ view: 'deck', activeDeckId: deckId, activeSectionId: sectionId }); return; }
    let cards = cardIds
      ? cardIds.map((id) => list.cards.find((card) => card.id === id)).filter((card): card is ProtoCard => Boolean(card))
      : weakFirst(list.cards.filter((card) => card.remainingCount > 0));
    let review = false;
    if (cards.length === 0) { cards = list.cards; review = true; }
    else if (cards.every((card) => card.remainingCount === 0)) review = true;
    let queue: StudyTarget[] = cards.map((card) => {
      const remaining = card.answerMastery.flatMap((known, i) => (known ? [] : [i]));
      return {
        cardId: card.id,
        answerIndexes: remaining.length > 0 ? remaining : card.a.map((_, i) => i),
      };
    }).filter((target) => target.answerIndexes.length > 0);
    if (state.shuffle) {
      queue = [...queue];
      for (let i = queue.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
    }
    const sessionTotal = queue.reduce((total, target) => total + target.answerIndexes.length, 0);
    dispatch({
      view: 'study', activeDeckId: deckId, activeSectionId: sectionId, queue, sessionTotal, sessionDone: 0,
      revealedIdx: [], retryAnswerIdx: [], openRowId: null, review,
    });
  }, [lists, weakFirst, state.shuffle]);

  const completeStudyTarget = useCallback(() => {
    const list = activeList;
    const target = state.queue[0];
    if (!list || !target) return;
    const card = list.cards.find((item) => item.id === target.cardId);
    if (!card) return;
    const retry = new Set(state.retryAnswerIdx);
    const retryAnswerIdx = [...state.retryAnswerIdx];
    const previousMastery = [...card.answerMastery];
    const nextMastery = [...card.answerMastery];
    target.answerIndexes.forEach((answerIndex) => { nextMastery[answerIndex] = !retry.has(answerIndex); });
    setAnswerMastery(list.deckId, card.id, nextMastery);
    dispatch((st) => ({
      queue: st.queue.slice(1),
      sessionDone: st.sessionDone + target.answerIndexes.length,
      revealedIdx: [],
      retryAnswerIdx: [],
    }));
    toast('판정을 저장했어요', () => {
      setAnswerMastery(list.deckId, card.id, previousMastery);
      dispatch((st) => ({
        view: 'study',
        queue: [target, ...st.queue],
        sessionDone: Math.max(0, st.sessionDone - target.answerIndexes.length),
        revealedIdx: [...target.answerIndexes],
        retryAnswerIdx,
      }));
    });
  }, [activeList, state.queue, state.retryAnswerIdx, setAnswerMastery, toast]);

  // ---- token view descriptors
  const tokenViews = useCallback((tokens: Token[], ri: number) => {
    const sel = state.sel;
    return tokens.map((t, ti) => {
      if (t.nl) return { brk: true as const, key: ti };
      const inSel = !!sel && sel.ri === ri && ti >= Math.min(sel.start, sel.end) && ti <= Math.max(sel.start, sel.end);
      const marked = t.hidden || inSel;
      return {
        brk: false as const, key: ti, word: t.word, tail: t.tail, marked,
        // plain words, blue cover on the marked ones — reads as "text with parts
        // painted over", not a pile of buttons
        bg: marked ? ACCENT : 'transparent', fg: marked ? '#fff' : '#1d1d1f', fw: marked ? 700 : 600, padX: marked ? 8 : 3,
        bd: '1px solid transparent',
        onDown: (e: ReactPointerEvent) => {
          e.stopPropagation();
          try { (e.target as Element).releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
          dispatch({ sel: { ri, start: ti, end: ti, wasHidden: t.hidden } });
        },
        onEnter: () => dispatch((st) => (st.sel && st.sel.ri === ri ? { sel: { ...st.sel, end: ti } } : {})),
        onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.stopPropagation();
          dispatch((st) => {
            if (ri === -100) return { editTokens: toggleTokenAt(st.editTokens, ti), sel: null };
            return {
              sheetRows: st.sheetRows.map((row, rowIndex) =>
                rowIndex === ri && row.kind === 'tokens' ? { ...row, tokens: toggleTokenAt(row.tokens, ti) } : row,
              ),
              sel: null,
            };
          });
        },
      };
    });
  }, [state.sel]);

  const renderTokenChips = (tokens: Token[], ri: number, fontSize: number, outlined = false) => tokenViews(tokens, ri).map((tv) =>
    tv.brk ? (
      <span key={tv.key} style={{ width: '100%', height: 2 }} />
    ) : (
      <span key={tv.key} style={{ display: 'inline-flex', alignItems: 'baseline' }}>
        <button
          type="button"
          className="token-button"
          onPointerDown={tv.onDown}
          onPointerEnter={tv.onEnter}
          onKeyDown={tv.onKeyDown}
          aria-pressed={tv.marked}
          aria-label={`${tv.word}${tv.tail} ${tv.marked ? '가림 해제' : '가리기'}`}
          style={outlined ? {
            display: 'inline-flex', alignItems: 'center', minHeight: 46, padding: '8px 14px', borderRadius: 11,
            background: tv.marked ? ACCENT : '#fff', color: tv.marked ? '#fff' : '#1d1d1f',
            border: tv.marked ? '1px solid transparent' : '1px solid rgba(60,60,67,0.14)',
            boxShadow: tv.marked ? '0 2px 5px rgba(0,122,255,0.18)' : '0 1px 2px rgba(0,0,0,0.02)',
            boxSizing: 'border-box', fontSize, fontWeight: tv.marked ? 700 : 600, lineHeight: 1.3,
            cursor: 'pointer', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
          } : {
            display: 'inline-flex', alignItems: 'center', minHeight: 36, padding: `5px ${tv.padX + 2}px`, borderRadius: 8,
            background: tv.bg, color: tv.fg, border: tv.bd, boxSizing: 'border-box', fontSize, fontWeight: tv.fw,
            lineHeight: 1.35, cursor: 'pointer', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
          }}
        >
          {tv.word}{outlined && !tv.marked ? tv.tail : ''}
        </button>
        {(!outlined || tv.marked) && <span style={{ fontSize, fontWeight: 600 }}>{tv.tail}</span>}
      </span>
    ));

  // ============================================================ render
  return (
    <div style={{ height: '100dvh', width: '100%', maxWidth: 480, margin: '0 auto', position: 'relative', background: '#F2F2F7', color: '#000', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {state.view === 'home' && (
        <HomeView
          lists={lists} decksState={decksState}
          onOpenList={(list) => dispatch({ view: 'deck', activeDeckId: list.deckId, activeSectionId: list.id, openRowId: null, filter: 'all' })}
          onContinue={(list) => startStudy(list.deckId, list.id)}
          onNewList={newList}
          onOpenSettings={() => dispatch({ settingsOpen: true })}
        />
      )}

      {state.view === 'deck' && activeList && !state.slotOpen && (
        <DeckView
          list={activeList} state={state} dispatch={dispatch} weakFirst={weakFirst}
          lpTimer={lpTimer} rowStart={rowStart}
          onHome={() => dispatch({ view: 'home', activeDeckId: null, activeSectionId: null, openRowId: null })}
          onRename={(name) => !activeList.synthetic && renameSection(activeList.deckId, activeList.id, name)}
          onDelete={(card) => {
            const deckId = activeList.deckId;
            const sectionId = activeList.id;
            const before = storedCardsOf(deckId, sectionId);
            const after = before.filter((c) => c.id !== card.id);
            commitSection(deckId, sectionId, after.map((c) => keepCard(c)));
            dispatch({ openRowId: null });
            toast('카드를 삭제했어요', () => commitSection(deckId, sectionId, before.map((c) => keepCard(c))));
          }}
          onEdit={openEditFor}
          onMove={moveCard}
          onDeleteList={deleteList}
          onStart={(ids) => startStudy(activeList.deckId, activeList.id, ids)}
          onOpenAdd={() => {
            lastAddedSnapshotRef.current = null;
            dispatch({ slotOpen: true, pasteText: '', pasteMode: 'auto', sheetRows: [], openRowId: null });
          }}
          toast={toast}
        />
      )}

      {state.view === 'deck' && state.slotOpen && (activeList || draftList) && (
        <ContinuousAddView
          state={state}
          dispatch={dispatch}
          renderTokenChips={renderTokenChips}
          onAddCards={async (cards) => {
            if (draftList) return createDraftListWithCards(cards);
            if (!activeList) return false;
            const stored = storedCardsOf(activeList.deckId, activeList.id).map((card) => keepCard(card));
            lastAddedSnapshotRef.current = {
              deckId: activeList.deckId,
              sectionId: activeList.id,
              cards: stored,
              addedCount: cards.length,
            };
            commitSection(activeList.deckId, activeList.id, [...stored, ...cards]);
            return true;
          }}
          onUndoLast={async () => {
            const snapshot = lastAddedSnapshotRef.current;
            if (!snapshot) return 0;
            if (snapshot.createdList) {
              try {
                await repository?.deleteSection(snapshot.deckId, snapshot.sectionId);
                if (snapshot.createdDeck) await repository?.deleteDeck(snapshot.deckId);
                setDeckDataById((current) => {
                  const previous = current[snapshot.deckId];
                  if (!previous) return current;
                  if (snapshot.createdDeck) {
                    const next = { ...current };
                    delete next[snapshot.deckId];
                    return next;
                  }
                  return {
                    ...current,
                    [snapshot.deckId]: {
                      ...previous,
                      cards: previous.cards.filter((card) => (card.sectionId ?? 'default') !== snapshot.sectionId),
                      sections: previous.sections.filter((section) => section.id !== snapshot.sectionId),
                    },
                  };
                });
                if (snapshot.createdDeck) setDecks((current) => current.filter((deck) => deck.id !== snapshot.deckId));
                setDraftList({ name: '새 암기장' });
                dispatch({ activeDeckId: null, activeSectionId: null });
                lastAddedSnapshotRef.current = null;
                return snapshot.addedCount;
              } catch {
                toast('되돌리지 못했어요');
                return 0;
              }
            }
            if (!activeList || snapshot.deckId !== activeList.deckId || snapshot.sectionId !== activeList.id) return 0;
            commitSection(snapshot.deckId, snapshot.sectionId, snapshot.cards);
            lastAddedSnapshotRef.current = null;
            return snapshot.addedCount;
          }}
          onClose={() => {
            lastAddedSnapshotRef.current = null;
            if (draftList) {
              setDraftList(null);
              dispatch({ view: 'home', slotOpen: false, activeDeckId: null, activeSectionId: null, pasteText: '', pasteMode: 'auto', sheetRows: [], sel: null });
            } else {
              dispatch({ slotOpen: false, pasteText: '', pasteMode: 'auto', sheetRows: [], sel: null });
            }
          }}
        />
      )}

      {state.view === 'study' && (
        <StudyView
          list={activeList} state={state} dispatch={dispatch}
          onComplete={completeStudyTarget}
          onDeck={() => dispatch({ view: 'deck', queue: [], revealedIdx: [], retryAnswerIdx: [], openRowId: null })}
          onRetryRemaining={() => activeList && startStudy(activeList.deckId, activeList.id)}
          onReviewAll={() => activeList && startStudy(activeList.deckId, activeList.id, activeList.cards.map((c) => c.id))}
        />
      )}

      {/* ---- edit sheet ---- */}
      {state.editSheetOpen && activeList && (
        <EditSheet
          list={activeList} state={state} dispatch={dispatch}
          saveEditFrom={saveEditFrom} renderTokenChips={renderTokenChips}
          onDelete={() => {
            if (state.editIdx === null) return;
            const deckId = activeList.deckId;
            const sectionId = activeList.id;
            const before = storedCardsOf(deckId, sectionId);
            const after = before.filter((_, i) => i !== state.editIdx);
            commitSection(deckId, sectionId, after.map((c) => keepCard(c)));
            dispatch({ editSheetOpen: false });
            toast('카드를 삭제했어요', () => commitSection(deckId, sectionId, before.map((c) => keepCard(c))));
          }}
          openEditFor={openEditFor}
        />
      )}

      {state.settingsOpen && (
        <SettingsSheet roomCode={roomCode} onClose={() => dispatch({ settingsOpen: false })} onChangeRoom={onChangeRoom} />
      )}

      {state.toastVisible && (
        <div role="status" aria-live="polite" style={{ position: 'absolute', left: '50%', bottom: 130, transform: 'translateX(-50%)', minHeight: 44, padding: state.toastUndo ? '0 8px 0 16px' : '0 18px', borderRadius: 11, background: 'rgba(29,29,31,0.92)', color: '#fff', display: 'flex', alignItems: 'center', gap: 14, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', animation: 'popIn 0.25s cubic-bezier(0.3,1.2,0.4,1)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 20 }}>
          <span>{state.toastMsg}</span>
          {state.toastUndo && (
            <button type="button" className="ui-button" onClick={undoToast} style={{ minWidth: 64, minHeight: 36, padding: '0 10px', borderRadius: 8, background: 'rgba(255,255,255,0.14)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 13.5, fontWeight: 800 }}>
              되돌리기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
