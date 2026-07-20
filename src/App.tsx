import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createFirebaseRepository } from './firebase';
import { createLocalRepository } from './localRepository';
import { createServerRepository } from './serverRepository';
import { ROOM_KEY } from './constants';
import { deriveSyncHealth, isSyncReadOnly } from './syncHealth';
import type { SyncResourceState } from './syncHealth';
import { KeyedMutationQueue } from './mutationQueue';
import type { EnqueuedMutation } from './mutationQueue';
import { CardIdAliases, applyAnswerMastery, applySectionName, replaceSectionCards } from './mutationState';
import { cardToTokens, editSignature, tokensToCard, tokensToText } from './tokens';
import type { Token } from './tokens';
import { cardNeedsRepair, deriveQA, emptyDeckCache, keepCard, normalizeAnswerMastery, protoCardSourceSignature, qaToNewCard, reconcileStudyTargets, remapAnswerMastery, remapAnswerSchedule, resolveEditedCardId } from './cards';
import { answerDueAt, dueAnswerIndexes, normalizeAnswerSchedule, rateAnswer } from './answerSchedule';
import type { DeckCacheEntry, OptimisticNewCard, ProtoCard, ProtoList } from './cards';
import { initialUI, uiReducer } from './uiState';
import type { SessionMode, StudyTarget, UIState } from './uiState';
import type { AnswerSchedule, Card, Deck, NewCard, Repository, Section } from './types';
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

function rejectedMutation(): EnqueuedMutation {
  return { accepted: false, version: 0, done: Promise.resolve(false) };
}

function canonicalBlankCount(prompt: string) {
  return prompt.match(/___/g)?.length ?? 0;
}

function newOperationId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function contentFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function Room({ roomCode, onChangeRoom }: { roomCode: string; onChangeRoom: (code: string) => void }) {
  const repository = useMemo<Repository | null>(() => {
    if (!roomCode) return null;
    // The revisioned sync endpoint is the authoritative production backend.
    // Keep legacy adapters only as fallbacks for environments without it;
    // preferring Firebase would bypass conflict checks and idempotent writes.
    return createServerRepository(roomCode) ?? createFirebaseRepository(roomCode) ?? createLocalRepository(roomCode);
  }, [roomCode]);

  const [decks, setDecks] = useState<Deck[]>([]);
  const [syncGeneration, setSyncGeneration] = useState(0);
  const [syncResources, setSyncResources] = useState<Record<string, SyncResourceState>>({});
  const [deckDataById, setDeckDataById] = useState<Record<string, DeckCacheEntry>>({});
  const [mutationQueue] = useState(() => new KeyedMutationQueue());
  const [state, dispatch] = useReducer(uiReducer, initialUI);
  const [draftList, setDraftList] = useState<{ name: string; operationId: string } | null>(null);
  const confirmedDeckDataByIdRef = useRef<Record<string, DeckCacheEntry>>({});
  const cardIdAliasesRef = useRef(new CardIdAliases());
  const toastTimer = useRef<number | undefined>(undefined);
  const toastUndoRef = useRef<(() => void) | null>(null);
  const lpTimer = useRef<number | undefined>(undefined);
  const rowStart = useRef<{ x: number; y: number; moved: boolean }>({ x: 0, y: 0, moved: false });
  const studySaveKeyRef = useRef<string | null>(null);
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

  const markSyncPending = useCallback((keys: string[]) => {
    setSyncResources((current) => {
      const next = { ...current };
      let changed = false;
      for (const key of keys) {
        const previous = current[key];
        if (previous?.pending && !previous.failed) continue;
        next[key] = {
          hasData: previous?.hasData ?? false,
          pending: true,
          failed: false,
        };
        changed = true;
      }
      return changed ? next : current;
    });
  }, []);

  const markSyncSuccess = useCallback((key: string) => {
    setSyncResources((current) => {
      const previous = current[key];
      if (previous?.hasData && !previous.pending && !previous.failed) return current;
      return {
        ...current,
        [key]: { hasData: true, pending: false, failed: false },
      };
    });
  }, []);

  const markSyncFailure = useCallback((key: string) => {
    setSyncResources((current) => {
      const previous = current[key];
      if (previous?.failed && !previous.pending) return current;
      return {
        ...current,
        [key]: {
          hasData: previous?.hasData ?? false,
          pending: false,
          failed: true,
        },
      };
    });
  }, []);

  const confirmCards = useCallback((deckId: string, cards: Card[]) => {
    const previous = confirmedDeckDataByIdRef.current[deckId] ?? emptyDeckCache();
    confirmedDeckDataByIdRef.current = {
      ...confirmedDeckDataByIdRef.current,
      [deckId]: { ...previous, cards, cardsLoaded: true },
    };
  }, []);

  const confirmSections = useCallback((deckId: string, sections: Section[]) => {
    const previous = confirmedDeckDataByIdRef.current[deckId] ?? emptyDeckCache();
    confirmedDeckDataByIdRef.current = {
      ...confirmedDeckDataByIdRef.current,
      [deckId]: { ...previous, sections, sectionsLoaded: true },
    };
  }, []);

  const restoreConfirmedCards = useCallback((deckId: string) => {
    const confirmed = confirmedDeckDataByIdRef.current[deckId];
    if (!confirmed?.cardsLoaded) return;
    setDeckDataById((current) => {
      const previous = current[deckId] ?? emptyDeckCache();
      return { ...current, [deckId]: { ...previous, cards: confirmed.cards, cardsLoaded: true } };
    });
  }, []);

  const restoreConfirmedSections = useCallback((deckId: string) => {
    const confirmed = confirmedDeckDataByIdRef.current[deckId];
    if (!confirmed?.sectionsLoaded) return;
    setDeckDataById((current) => {
      const previous = current[deckId] ?? emptyDeckCache();
      return { ...current, [deckId]: { ...previous, sections: confirmed.sections, sectionsLoaded: true } };
    });
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
    markSyncPending(['decks']);
    repository.ensureDefaultDeck().catch(() => {});
    const unsub = repository.subscribeDecks(
      (next) => {
        const activeDeckIds = new Set(next.map((deck) => deck.id));
        for (const deckId of Object.keys(confirmedDeckDataByIdRef.current)) {
          if (!activeDeckIds.has(deckId)) cardIdAliasesRef.current.clearDeck(deckId);
        }
        confirmedDeckDataByIdRef.current = Object.fromEntries(
          Object.entries(confirmedDeckDataByIdRef.current).filter(([deckId]) => activeDeckIds.has(deckId)),
        );
        setDecks(next);
        setSyncResources((current) => {
          const kept = Object.fromEntries(
            Object.entries(current).filter(([key]) => {
              if (key === 'decks') return true;
              const separator = key.indexOf(':');
              return separator >= 0 && activeDeckIds.has(key.slice(separator + 1));
            }),
          );
          return { ...kept, decks: { hasData: true, pending: false, failed: false } };
        });
      },
      () => {
        markSyncFailure('decks');
      },
    );
    return unsub;
  }, [repository, syncGeneration, markSyncPending, markSyncFailure]);

  const deckIdsKey = decks.map((d) => d.id).join(',');
  useEffect(() => {
    if (!repository) return;
    const unsubs: Array<() => void> = [];
    const resourceKeys = decks.flatMap((deck) => [`cards:${deck.id}`, `sections:${deck.id}`]);
    markSyncPending(resourceKeys);
    for (const deck of decks) {
      const deckId = deck.id;
      unsubs.push(repository.subscribeCards(
        deckId,
        (cards) => {
          const resourceKey = `cards:${deckId}`;
          confirmCards(deckId, cards);
          if (!mutationQueue.hasPending(resourceKey)) {
            cardIdAliasesRef.current.clearDeck(deckId);
            setDeckDataById((cur) => ({ ...cur, [deckId]: { ...(cur[deckId] ?? emptyDeckCache()), cards, cardsLoaded: true } }));
          }
          mutationQueue.resume(resourceKey);
          markSyncSuccess(resourceKey);
        },
        () => {
          markSyncFailure(`cards:${deckId}`);
        },
      ));
      unsubs.push(repository.subscribeSections(
        deckId,
        (sections) => {
          const resourceKey = `sections:${deckId}`;
          confirmSections(deckId, sections);
          if (!mutationQueue.hasPending(resourceKey)) {
            setDeckDataById((cur) => ({
              ...cur,
              [deckId]: { ...(cur[deckId] ?? emptyDeckCache()), sections, sectionsLoaded: true },
            }));
          }
          mutationQueue.resume(resourceKey);
          markSyncSuccess(resourceKey);
        },
        () => {
          markSyncFailure(`sections:${deckId}`);
        },
      ));
    }
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, deckIdsKey, syncGeneration, mutationQueue, confirmCards, confirmSections, markSyncPending, markSyncSuccess, markSyncFailure]);

  const requiredSyncKeys = useMemo(
    () => ['decks', ...decks.flatMap((deck) => [`cards:${deck.id}`, `sections:${deck.id}`])],
    [decks],
  );
  const syncHealth = useMemo(
    () => deriveSyncHealth(requiredSyncKeys, syncResources),
    [requiredSyncKeys, syncResources],
  );
  const retrySync = useCallback(() => {
    markSyncPending(requiredSyncKeys);
    setSyncGeneration((current) => current + 1);
  }, [markSyncPending, requiredSyncKeys]);

  // There is no offline write queue. A stale snapshot renders the read-only
  // Home surface, while the interrupted add/edit state stays in memory. Once a
  // fresh snapshot arrives, the user returns to the exact unsaved draft rather
  // than losing it because of a transient failure.

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
        const needsRepair = cardNeedsRepair(c);
        const { q, a } = needsRepair && c.type === 'group'
          ? { q: c.prompt, a: c.rawText.trim() ? [c.rawText] : [] }
          : deriveQA(c);
        const answerMastery = needsRepair ? [] : normalizeAnswerMastery(c, a.length);
        const knownCount = answerMastery.filter(Boolean).length;
        return {
          id: c.id,
          q,
          a,
          answerMastery,
          answerSchedule: needsRepair ? [] : normalizeAnswerSchedule(c, a.length),
          knownCount,
          remainingCount: needsRepair ? 0 : a.length - knownCount,
          memorized: !needsRepair && a.length > 0 && knownCount === a.length,
          needsRepair,
          isGroup: c.type === 'group',
          updatedAt: c.updatedAt,
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

  useEffect(() => {
    if (
      syncHealth.status !== 'ready'
      || state.view === 'home'
      || state.activeDeckId === null
      || state.activeSectionId === null
      || activeList
      || draftList
    ) return;
    lastAddedSnapshotRef.current = null;
    dispatch({
      view: 'home',
      activeDeckId: null,
      activeSectionId: null,
      queue: [],
      revealedIdx: [],
      retryAnswerIdx: [],
      openRowId: null,
      slotOpen: false,
      editSheetOpen: false,
    });
    toast('다른 기기에서 이 암기장이 삭제되어 홈으로 이동했어요');
  }, [syncHealth.status, state.view, state.activeDeckId, state.activeSectionId, activeList, draftList, toast]);

  useEffect(() => {
    if (syncHealth.status !== 'ready' || state.view !== 'study' || !activeList) return;
    const reconciliation = reconcileStudyTargets(state.queue, activeList.cards);
    if (reconciliation.removedCount === 0) return;
    dispatch((current) => ({
      queue: reconciliation.queue,
      sessionTotal: Math.max(current.sessionDone, current.sessionTotal - reconciliation.removedCount),
      ...(reconciliation.currentChanged ? { revealedIdx: [], retryAnswerIdx: [] } : {}),
    }));
    toast('다른 기기에서 변경된 가림은 이번 학습에서 제외했어요');
  }, [syncHealth.status, state.view, state.queue, activeList, toast]);

  const storedCardsOf = useCallback((deckId: string, sectionId: string): Card[] => {
    const cards = deckDataById[deckId]?.cards ?? [];
    return cards.filter((c) => (c.sectionId ?? 'default') === sectionId);
  }, [deckDataById]);

  // ---- mutations
  const commitSection = useCallback((deckId: string, sectionId: string, newCards: OptimisticNewCard[], operationId?: string) => {
    if (!repository || syncHealth.status !== 'ready') return rejectedMutation();
    const resourceKey = `cards:${deckId}`;
    const payload: NewCard[] = newCards.map(({ optimisticId: _ignored, ...card }) => card);
    const sourceText = payload.map((c) => c.rawText).join('\n');
    const now = Date.now();
    const optimistic = newCards.map((candidate, index) => {
      const { optimisticId, ...card } = candidate;
      return {
        ...card,
        id: optimisticId ?? `tmp_${now}_${index}_${Math.random().toString(36).slice(2, 8)}`,
        sectionId,
        createdAt: now,
        updatedAt: now,
      } as Card;
    });
    const queued = mutationQueue.enqueue(
      resourceKey,
      () => repository.setSectionContent(deckId, sectionId, sourceText, payload, operationId),
      {
        onSuccess: (saved, context) => {
          cardIdAliasesRef.current.recordReplacement(deckId, optimistic, saved);
          const confirmed = confirmedDeckDataByIdRef.current[deckId] ?? emptyDeckCache();
          const nextCards = replaceSectionCards(confirmed.cards, sectionId, saved);
          confirmCards(deckId, nextCards);
          if (!context.isLatest) return;
          setDeckDataById((current) => {
            const previous = current[deckId] ?? emptyDeckCache();
            return { ...current, [deckId]: { ...previous, cards: nextCards, cardsLoaded: true } };
          });
          cardIdAliasesRef.current.clearDeck(deckId);
        },
        onFailure: () => {
          restoreConfirmedCards(deckId);
          markSyncFailure(resourceKey);
          toast('저장하지 못했어요. 연결을 복구한 뒤 다시 시도해 주세요');
        },
      },
    );
    if (!queued.accepted) {
      toast('연결을 복구한 뒤 다시 시도해 주세요');
      return queued;
    }
    setDeckDataById((cur) => {
      const prev = cur[deckId] ?? emptyDeckCache();
      return { ...cur, [deckId]: { ...prev, cards: replaceSectionCards(prev.cards, sectionId, optimistic), cardsLoaded: true } };
    });
    return queued;
  }, [repository, syncHealth.status, mutationQueue, confirmCards, restoreConfirmedCards, markSyncFailure, toast]);

  const setAnswerMastery = useCallback((
    deckId: string,
    cardId: string,
    answerMastery: boolean[],
    answerSchedule?: Array<AnswerSchedule | null>,
  ) => {
    if (!repository || syncHealth.status !== 'ready') return rejectedMutation();
    const resourceKey = `cards:${deckId}`;
    const queued = mutationQueue.enqueue(
      resourceKey,
      async () => {
        const resolvedCardId = cardIdAliasesRef.current.resolve(deckId, cardId);
        const confirmed = confirmedDeckDataByIdRef.current[deckId];
        if (!confirmed?.cards.some((card) => card.id === resolvedCardId)) {
          throw new Error('Confirmed card id is unavailable');
        }
        await repository.setCardAnswerMastery(deckId, resolvedCardId, answerMastery, answerSchedule);
        return resolvedCardId;
      },
      {
        onSuccess: (resolvedCardId, context) => {
          const confirmed = confirmedDeckDataByIdRef.current[deckId] ?? emptyDeckCache();
          const nextCards = applyAnswerMastery(confirmed.cards, resolvedCardId, answerMastery, answerSchedule);
          confirmCards(deckId, nextCards);
          if (!context.isLatest) return;
          setDeckDataById((current) => {
            const previous = current[deckId] ?? emptyDeckCache();
            return { ...current, [deckId]: { ...previous, cards: nextCards, cardsLoaded: true } };
          });
          cardIdAliasesRef.current.clearDeck(deckId);
        },
        onFailure: () => {
          restoreConfirmedCards(deckId);
          markSyncFailure(resourceKey);
          toast('학습 상태를 저장하지 못했어요. 연결을 복구해 주세요');
        },
      },
    );
    if (!queued.accepted) return queued;
    setDeckDataById((cur) => {
      const prev = cur[deckId];
      if (!prev) return cur;
      return {
        ...cur,
        [deckId]: {
          ...prev,
          cards: applyAnswerMastery(prev.cards, cardId, answerMastery, answerSchedule),
        },
      };
    });
    return queued;
  }, [repository, syncHealth.status, mutationQueue, confirmCards, restoreConfirmedCards, markSyncFailure, toast]);

  const renameSection = useCallback((deckId: string, sectionId: string, name: string) => {
    if (!repository || syncHealth.status !== 'ready') return false;
    // Section name and content share one server revision. Serialize them with
    // card/content writes so a normal rename + save sequence cannot conflict
    // with itself while still reporting failures against the sections feed.
    const mutationKey = `cards:${deckId}`;
    const resourceKey = `sections:${deckId}`;
    const queued = mutationQueue.enqueue(
      mutationKey,
      () => repository.renameSection(deckId, sectionId, name),
      {
        onSuccess: (_value, context) => {
          const confirmed = confirmedDeckDataByIdRef.current[deckId] ?? emptyDeckCache();
          const nextSections = applySectionName(confirmed.sections, sectionId, name);
          confirmSections(deckId, nextSections);
          if (!context.isLatest) return;
          setDeckDataById((current) => {
            const previous = current[deckId] ?? emptyDeckCache();
            return { ...current, [deckId]: { ...previous, sections: nextSections, sectionsLoaded: true } };
          });
        },
        onFailure: () => {
          restoreConfirmedSections(deckId);
          markSyncFailure(resourceKey);
          toast('이름을 저장하지 못했어요. 연결을 복구해 주세요');
        },
      },
    );
    if (!queued.accepted) return false;
    setDeckDataById((cur) => {
      const prev = cur[deckId];
      if (!prev) return cur;
      return { ...cur, [deckId]: { ...prev, sections: applySectionName(prev.sections, sectionId, name) } };
    });
    return true;
  }, [repository, syncHealth.status, mutationQueue, confirmSections, restoreConfirmedSections, markSyncFailure, toast]);

  const newList = useCallback(() => {
    if (!repository || syncHealth.status !== 'ready') return;
    lastAddedSnapshotRef.current = null;
    setDraftList({ name: '새 암기장', operationId: newOperationId() });
    dispatch({ view: 'deck', activeDeckId: null, activeSectionId: null, slotOpen: true, pasteText: '', sheetRows: [], addOperationId: newOperationId() });
  }, [repository, syncHealth.status]);

  const createDraftListWithCards = useCallback(async (cards: NewCard[]): Promise<boolean> => {
    if (!repository || !draftList || syncHealth.status !== 'ready') return false;
    const deckOperationId = `${draftList.operationId}-deck`;
    const existingDeck = decks.find((deck) => deck.name === '일반');
    let deckId = existingDeck?.id;
    let sectionId: string | undefined;
    let createdDeck = existingDeck?.clientOperationId === deckOperationId;
    try {
      if (!deckId) {
        deckId = await repository.addDeck('일반', deckOperationId);
        createdDeck = true;
      }
      sectionId = await repository.addSection(deckId, draftList.name, `${draftList.operationId}-section`);
      const sourceText = cards.map((card) => card.rawText).join('\n');
      // Seed the optimistic cache from the persisted cards (real server ids),
      // not minted tmp_ ids — otherwise this new-list path leaves stale ids in
      // the cache and per-hide mastery writes are lost on reload.
      const payloadFingerprint = contentFingerprint(JSON.stringify([sourceText, cards]));
      const saved = await repository.setSectionContent(
        deckId,
        sectionId,
        sourceText,
        cards,
        `${draftList.operationId}-content-${payloadFingerprint}`,
      );

      const now = Date.now();
      const resolvedDeckId = deckId;
      const resolvedSectionId = sectionId;
      const section: Section = { id: resolvedSectionId, name: draftList.name, sourceText, createdAt: now, updatedAt: now };
      const confirmed = confirmedDeckDataByIdRef.current[resolvedDeckId] ?? emptyDeckCache();
      confirmCards(resolvedDeckId, replaceSectionCards(confirmed.cards, resolvedSectionId, saved));
      confirmSections(
        resolvedDeckId,
        [...confirmed.sections.filter((item) => item.id !== resolvedSectionId), section],
      );
      setDecks((current) => current.some((deck) => deck.id === resolvedDeckId)
        ? current
        : [...current, { id: resolvedDeckId, name: '일반', createdAt: now, updatedAt: now }]);
      setDeckDataById((current) => {
        const previous = current[resolvedDeckId] ?? emptyDeckCache();
        return {
          ...current,
          [resolvedDeckId]: {
            ...previous,
            cards: [...previous.cards.filter((card) => (card.sectionId ?? 'default') !== resolvedSectionId), ...saved],
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
      // Creation calls carry stable operation ids. A timed-out response may
      // still have committed, so deleting here could destroy a successful
      // list or create duplicates. Keep the draft and retry the same operation;
      // every backend will return/rewrite the same resources idempotently.
      markSyncFailure('decks');
      if (deckId) {
        markSyncFailure(`cards:${deckId}`);
        markSyncFailure(`sections:${deckId}`);
      }
      toast('암기장을 만들지 못했어요');
      return false;
    }
  }, [repository, draftList, decks, syncHealth.status, confirmCards, confirmSections, markSyncFailure, toast]);

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
    if (!repository || !activeList || activeList.synthetic || syncHealth.status !== 'ready') return;
    if (mutationQueue.hasPending(`cards:${activeList.deckId}`) || mutationQueue.hasPending(`sections:${activeList.deckId}`)) {
      toast('저장이 끝난 뒤 암기장을 삭제해 주세요');
      return;
    }
    const label = activeList.cards.length > 0 ? `카드 ${activeList.cards.length}개가 함께 삭제돼요.` : '';
    if (!window.confirm(`"${activeList.name}" 암기장을 삭제할까요? ${label}`)) return;
    dispatch({ view: 'home', activeDeckId: null, activeSectionId: null, openRowId: null });
    try {
      await repository.deleteSection(activeList.deckId, activeList.id);
      toast('암기장을 삭제했어요');
    } catch {
      markSyncFailure(`sections:${activeList.deckId}`);
      markSyncFailure(`cards:${activeList.deckId}`);
      toast('삭제에 실패했어요');
    }
  }, [repository, activeList, syncHealth.status, mutationQueue, markSyncFailure, toast]);

  const openEditFor = useCallback((c: ProtoCard) => {
    if (!activeList) return;
    const idx = activeList.cards.findIndex((cc) => cc.id === c.id);
    if (idx < 0) return;
    if (c.isGroup) toast('묶음 카드는 저장하면 일반 카드로 바뀌어요');
    if (c.q.includes('___')) {
      const tokens = cardToTokens(c.q, c.a);
      dispatch({
        editSheetOpen: true,
        editIdx: idx,
        editCardId: c.id,
        editSourceSignature: protoCardSourceSignature(c),
        editMode: 'tokens',
        editSingleAnswer: false,
        editTokens: tokens,
        editText: tokensToText(tokens),
        editInitialSignature: editSignature('tokens', '', '', tokens),
      });
    } else {
      const editA = c.a.join(', ');
      dispatch({
        editSheetOpen: true,
        editIdx: idx,
        editCardId: c.id,
        editSourceSignature: protoCardSourceSignature(c),
        editMode: 'qa',
        editSingleAnswer: c.a.length === 1,
        editQ: c.q,
        editA,
        editInitialSignature: editSignature('qa', c.q, editA, []),
      });
    }
  }, [activeList, toast]);

  const saveEditFrom = useCallback(async (st: UIState, close: boolean) => {
    if (!activeList || st.editCardId === null) return true;
    let q: string;
    let a: string[];
    if (st.editMode === 'qa') {
      q = st.editQ.trim();
      a = st.editSingleAnswer
        ? [st.editA.trim()].filter(Boolean)
        : st.editA.split(',').map((x) => x.trim()).filter(Boolean);
      if (!q) { if (close) toast('질문을 입력하세요'); return false; }
      if (a.length === 0) { if (close) toast('답을 입력하세요'); return false; }
      const blankCount = canonicalBlankCount(q);
      if (blankCount > 0 && blankCount !== a.length) {
        if (close) toast(`가림 ${blankCount}곳에 맞게 답 ${blankCount}개를 입력하세요`);
        return false;
      }
    } else {
      if (!st.editTokens.some((t) => t.hidden)) { if (close) toast('가릴 단어를 선택하세요'); return false; }
      const r = tokensToCard(st.editTokens);
      q = r.q; a = r.a;
    }
    const stored = storedCardsOf(activeList.deckId, activeList.id);
    const targetId = resolveEditedCardId(activeList.cards, st.editCardId, st.editSourceSignature);
    const targetIndex = targetId ? stored.findIndex((card) => card.id === targetId) : -1;
    if (targetIndex < 0) {
      toast('다른 기기에서 이 카드가 변경되었어요. 초안을 복사한 뒤 다시 열어 주세요');
      return false;
    }
    const rebuilt = stored.map((c, i) =>
      i === targetIndex
        ? { ...qaToNewCard(q, a, remapAnswerMastery(c, a), remapAnswerSchedule(c, a)), optimisticId: c.id }
        : keepCard(c),
    );
    const queued = commitSection(activeList.deckId, activeList.id, rebuilt);
    return queued.accepted ? queued.done : false;
  }, [activeList, storedCardsOf, commitSection, toast]);

  const startStudy = useCallback((deckId: string, sectionId: string, cardIds?: string[]) => {
    if (mutationQueue.hasPending(`cards:${deckId}`)) {
      toast('카드 저장이 끝난 뒤 학습을 시작해 주세요');
      return;
    }
    const list = lists.find((l) => l.deckId === deckId && l.id === sectionId);
    if (!list) return;
    if (list.cards.length === 0) { dispatch({ view: 'deck', activeDeckId: deckId, activeSectionId: sectionId }); return; }
    let cards = cardIds
      ? cardIds.map((id) => list.cards.find((card) => card.id === id)).filter((card): card is ProtoCard => Boolean(card))
      : weakFirst(list.cards.filter((card) => !card.needsRepair && card.remainingCount > 0));
    cards = cards.filter((card) => !card.needsRepair);
    const eligibleCards = list.cards.filter((card) => !card.needsRepair);
    if (cards.length === 0 && eligibleCards.length === 0) {
      dispatch({ view: 'deck', activeDeckId: deckId, activeSectionId: sectionId });
      toast('답이 없는 카드를 먼저 수정해 주세요');
      return;
    }
    let sessionMode: SessionMode = 'learn';
    if (cards.length === 0) { cards = eligibleCards; sessionMode = 'review'; }
    else if (cards.every((card) => card.remainingCount === 0)) sessionMode = 'review';
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
      revealedIdx: [], retryAnswerIdx: [], openRowId: null, sessionMode,
    });
  }, [lists, weakFirst, state.shuffle, mutationQueue, toast]);

  // Checkup sessions re-hide known hides whose FSRS due date has passed, so a
  // "known" judgment is re-earned instead of lasting forever.
  const startCheckup = useCallback((deckId: string, sectionId: string) => {
    if (mutationQueue.hasPending(`cards:${deckId}`)) {
      toast('카드 저장이 끝난 뒤 점검을 시작해 주세요');
      return;
    }
    const list = lists.find((l) => l.deckId === deckId && l.id === sectionId);
    if (!list) return;
    const now = Date.now();
    const dueAtOf = (card: ProtoCard, answerIndexes: number[]) =>
      Math.min(...answerIndexes.map((index) => answerDueAt(card.answerSchedule[index], card.updatedAt)));
    const entries = list.cards
      .filter((card) => !card.needsRepair)
      .map((card) => ({ card, answerIndexes: dueAnswerIndexes(card, now) }))
      .filter((entry) => entry.answerIndexes.length > 0);
    if (entries.length === 0) {
      toast('지금 점검할 가림이 없어요');
      return;
    }
    // Most-overdue card first: the longest-unchecked memories are most at risk.
    entries.sort((x, y) => dueAtOf(x.card, x.answerIndexes) - dueAtOf(y.card, y.answerIndexes));
    let queue: StudyTarget[] = entries.map(({ card, answerIndexes }) => ({ cardId: card.id, answerIndexes }));
    if (state.shuffle) {
      queue = [...queue];
      for (let i = queue.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
    }
    const sessionTotal = queue.reduce((total, target) => total + target.answerIndexes.length, 0);
    dispatch({
      view: 'study', activeDeckId: deckId, activeSectionId: sectionId, queue, sessionTotal, sessionDone: 0,
      revealedIdx: [], retryAnswerIdx: [], openRowId: null, sessionMode: 'checkup',
    });
  }, [lists, state.shuffle, mutationQueue, toast]);

  const completeStudyTarget = useCallback(async () => {
    const list = activeList;
    const target = state.queue[0];
    if (!list || !target) return;
    const card = list.cards.find((item) => item.id === target.cardId);
    if (!card) return;
    const saveKey = `${list.deckId}:${card.id}:${target.answerIndexes.join(',')}`;
    if (studySaveKeyRef.current !== null) return;
    studySaveKeyRef.current = saveKey;
    const retry = new Set(state.retryAnswerIdx);
    const retryAnswerIdx = [...state.retryAnswerIdx];
    const previousMastery = [...card.answerMastery];
    const nextMastery = [...card.answerMastery];
    const previousSchedule = [...card.answerSchedule];
    const nextSchedule = [...card.answerSchedule];
    const judgedAt = Date.now();
    target.answerIndexes.forEach((answerIndex) => {
      const knew = !retry.has(answerIndex);
      nextMastery[answerIndex] = knew;
      nextSchedule[answerIndex] = rateAnswer(card.answerSchedule[answerIndex], knew, judgedAt);
    });
    try {
      const queued = setAnswerMastery(list.deckId, card.id, nextMastery, nextSchedule);
      if (!queued.accepted || !(await queued.done)) return;
      dispatch((st) => ({
        queue: st.queue[0]?.cardId === target.cardId ? st.queue.slice(1) : st.queue,
        sessionDone: st.queue[0]?.cardId === target.cardId
          ? st.sessionDone + target.answerIndexes.length
          : st.sessionDone,
        revealedIdx: [],
        retryAnswerIdx: [],
      }));
      toast('판정을 저장했어요', () => { void (async () => {
        const undo = setAnswerMastery(list.deckId, card.id, previousMastery, previousSchedule);
        if (!undo.accepted || !(await undo.done)) return;
        dispatch((st) => ({
          view: 'study',
          queue: [target, ...st.queue],
          sessionDone: Math.max(0, st.sessionDone - target.answerIndexes.length),
          revealedIdx: [...target.answerIndexes],
          retryAnswerIdx,
        }));
      })(); });
    } finally {
      if (studySaveKeyRef.current === saveKey) studySaveKeyRef.current = null;
    }
  }, [activeList, state.queue, state.retryAnswerIdx, setAnswerMastery, toast]);

  // ============================================================ render
  const syncReadOnly = isSyncReadOnly(syncHealth.status);
  return (
    <div style={{ height: '100dvh', width: '100%', maxWidth: 480, margin: '0 auto', position: 'relative', background: '#F2F2F7', color: '#000', display: 'flex', flexDirection: 'column', overflow: 'clip' }}>
      {(state.view === 'home' || syncReadOnly) && (
        <HomeView
          lists={lists}
          decksState={syncHealth.status}
          syncPending={syncHealth.pending}
          onRetry={retrySync}
          onOpenList={(list) => dispatch({ view: 'deck', activeDeckId: list.deckId, activeSectionId: list.id, openRowId: null, filter: 'all' })}
          onContinue={(list) => startStudy(list.deckId, list.id)}
          onNewList={newList}
          onOpenSettings={() => dispatch({ settingsOpen: true })}
        />
      )}

      {!syncReadOnly && state.view === 'deck' && activeList && !state.slotOpen && (
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
            if (!commitSection(deckId, sectionId, after.map((c) => keepCard(c))).accepted) return;
            dispatch({ openRowId: null });
            toast('카드를 삭제했어요', () => commitSection(deckId, sectionId, before.map((c) => keepCard(c))));
          }}
          onEdit={openEditFor}
          onMove={moveCard}
          onDeleteList={deleteList}
          onStart={(ids) => startStudy(activeList.deckId, activeList.id, ids)}
          onStartCheckup={() => startCheckup(activeList.deckId, activeList.id)}
          onOpenAdd={() => {
            lastAddedSnapshotRef.current = null;
            dispatch({ slotOpen: true, pasteText: '', pasteMode: 'auto', sheetRows: [], addOperationId: newOperationId(), openRowId: null });
          }}
          toast={toast}
        />
      )}

      {!syncReadOnly && state.view === 'deck' && state.slotOpen && (activeList || draftList) && (
        <ContinuousAddView
          state={state}
          dispatch={dispatch}
          operationSeed={state.addOperationId}
          onAddCards={async (cards, operationId) => {
            if (draftList) return createDraftListWithCards(cards);
            if (!activeList) return false;
            const stored = storedCardsOf(activeList.deckId, activeList.id).map((card) => keepCard(card));
            lastAddedSnapshotRef.current = {
              deckId: activeList.deckId,
              sectionId: activeList.id,
              cards: stored,
              addedCount: cards.length,
            };
            const queued = commitSection(activeList.deckId, activeList.id, [...stored, ...cards], operationId);
            const saved = queued.accepted ? await queued.done : false;
            if (!saved) lastAddedSnapshotRef.current = null;
            return saved;
          }}
          onUndoLast={async () => {
            if (syncHealth.status !== 'ready') return 0;
            const snapshot = lastAddedSnapshotRef.current;
            if (!snapshot) return 0;
            if (snapshot.createdList) {
              let failedResourceKeys = [`sections:${snapshot.deckId}`, `cards:${snapshot.deckId}`];
              try {
                await repository?.deleteSection(snapshot.deckId, snapshot.sectionId);
                if (snapshot.createdDeck) {
                  failedResourceKeys = ['decks'];
                  await repository?.deleteDeck(snapshot.deckId);
                }
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
                setDraftList({ name: '새 암기장', operationId: newOperationId() });
                dispatch({ activeDeckId: null, activeSectionId: null });
                lastAddedSnapshotRef.current = null;
                return snapshot.addedCount;
              } catch {
                failedResourceKeys.forEach(markSyncFailure);
                toast('되돌리지 못했어요');
                return 0;
              }
            }
            if (!activeList || snapshot.deckId !== activeList.deckId || snapshot.sectionId !== activeList.id) return 0;
            const queued = commitSection(snapshot.deckId, snapshot.sectionId, snapshot.cards);
            if (!queued.accepted || !(await queued.done)) return 0;
            lastAddedSnapshotRef.current = null;
            return snapshot.addedCount;
          }}
          onClose={() => {
            lastAddedSnapshotRef.current = null;
            if (draftList) {
              setDraftList(null);
              dispatch({ view: 'home', slotOpen: false, activeDeckId: null, activeSectionId: null, pasteText: '', pasteMode: 'auto', sheetRows: [], addOperationId: '', sel: null });
            } else {
              dispatch({ slotOpen: false, pasteText: '', pasteMode: 'auto', sheetRows: [], addOperationId: '', sel: null });
            }
          }}
        />
      )}

      {!syncReadOnly && state.view === 'study' && (
        <StudyView
          list={activeList} state={state} dispatch={dispatch}
          onComplete={completeStudyTarget}
          onDeck={() => dispatch({ view: 'deck', queue: [], revealedIdx: [], retryAnswerIdx: [], openRowId: null })}
          onRetryRemaining={() => activeList && startStudy(activeList.deckId, activeList.id)}
          onReviewAll={() => activeList && startStudy(activeList.deckId, activeList.id, activeList.cards.map((c) => c.id))}
        />
      )}

      {/* ---- edit sheet ---- */}
      {!syncReadOnly && !state.settingsOpen && state.editSheetOpen && activeList && (
        <EditSheet
          list={activeList} state={state} dispatch={dispatch}
          saveEditFrom={saveEditFrom}
          onDelete={() => {
            if (state.editCardId === null) return;
            const deckId = activeList.deckId;
            const sectionId = activeList.id;
            const before = storedCardsOf(deckId, sectionId);
            const targetId = resolveEditedCardId(activeList.cards, state.editCardId, state.editSourceSignature);
            if (!targetId || !before.some((card) => card.id === targetId)) {
              toast('다른 기기에서 이 카드가 변경되었어요. 다시 열어 주세요');
              return;
            }
            const after = before.filter((card) => card.id !== targetId);
            if (!commitSection(deckId, sectionId, after.map((c) => keepCard(c))).accepted) return;
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
        <div role="status" aria-live="polite" style={{ position: 'absolute', left: '50%', bottom: 130, transform: 'translateX(-50%)', maxWidth: 'calc(100% - 32px)', minHeight: 44, padding: state.toastUndo ? '0 8px 0 16px' : '0 18px', borderRadius: 11, background: 'rgba(29,29,31,0.92)', color: '#fff', display: 'flex', alignItems: 'center', gap: 14, fontSize: 14, fontWeight: 600, lineHeight: 1.4, whiteSpace: 'normal', animation: 'popIn 0.25s cubic-bezier(0.3,1.2,0.4,1)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 20 }}>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{state.toastMsg}</span>
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
