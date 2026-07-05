import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Folder,
  FolderOpen,
  Plus,
  Redo2,
  Save,
  Shuffle,
  Star,
  Trash2,
  Undo2,
} from 'lucide-react';
import { createFirebaseRepository } from './firebase';
import { createLocalRepository } from './localRepository';
import { parseInput, splitCloze, toCards } from './parser';
import { createServerRepository } from './serverRepository';
import type { Card, Deck, ParsedLine, Repository, Section } from './types';

const ROOM_KEY = 'exam-memorizer-room-code';
const LAST_DECK_KEY = 'exam-memorizer-last-deck';
const LAST_SECTION_PREFIX = 'exam-memorizer-last-section';

type View = 'home' | 'study' | 'edit';
type NameDialog =
  | { type: 'deck'; title: string; label: string; defaultValue: string }
  | { type: 'section'; deckId: string; title: string; label: string; defaultValue: string };
type DeckCacheEntry = {
  cards: Card[];
  sections: Section[];
  cardsLoaded: boolean;
  sectionsLoaded: boolean;
  cardsError?: boolean;
  sectionsError?: boolean;
};
type DecksState = 'loading' | 'ready' | 'error';
type Toast = { id: number; kind: 'error' | 'success'; message: string };
type RevealHandlers = {
  revealed: Record<string, boolean>;
  hinted: Record<string, boolean>;
  startPress: (key: string) => void;
  endPress: (key: string) => void;
  cancelPress: (key: string) => void;
};

function normalizeRoomCode(value: string) {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
}

function sectionKey(card: Card) {
  return card.sectionId ?? 'default';
}

function sourceFromCards(cards: Card[]) {
  return cards.map((card) => card.rawText).join('\n');
}

function displayDeckName(deck?: Deck) {
  if (!deck) return '암기장';
  return deck.name?.trim() || '암기장';
}

function displaySectionName(section?: Section) {
  if (!section) return '세부 암기장';
  return section.name?.trim() || '세부 암기장';
}

function emptyDeckCache(): DeckCacheEntry {
  return { cards: [], sections: [], cardsLoaded: false, sectionsLoaded: false, cardsError: false, sectionsError: false };
}

function preserveStars(nextCards: ReturnType<typeof toCards>, previousCards: Card[]) {
  const statusByRawText = new Map(
    previousCards.map((card) => [
      card.rawText.trim(),
      { starred: Boolean(card.starred), mastered: Boolean(card.mastered) },
    ]),
  );
  return nextCards.map((card) => ({ ...card, ...(statusByRawText.get(card.rawText.trim()) ?? {}) }));
}

function stableShuffle<T>(items: T[], seed: number) {
  const next = [...items];
  let state = seed || 1;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function shuffledStudyCards(cards: Card[], seed: number) {
  const ordered = [...cards].sort((a, b) => a.createdAt - b.createdAt);
  const starred = stableShuffle(ordered.filter((card) => card.starred), seed);
  const normal = stableShuffle(ordered.filter((card) => !card.starred && !card.mastered), seed + 19);
  const mastered = stableShuffle(ordered.filter((card) => !card.starred && card.mastered), seed + 37);
  return [...starred, ...normal, ...mastered];
}

function revealKeysForCard(card: Card) {
  if (card.type === 'pair') return [`${card.id}:0`];
  if (card.type === 'group') {
    return (card.groupItems ?? []).flatMap((item, itemIndex) =>
      splitCloze(item.text)
        .filter((piece): piece is Extract<ReturnType<typeof splitCloze>[number], { kind: 'blank' }> => piece.kind === 'blank')
        .map((piece) => `${card.id}:group:${itemIndex}:${piece.index}`),
    );
  }
  return splitCloze(card.rawText)
    .filter((piece): piece is Extract<ReturnType<typeof splitCloze>[number], { kind: 'blank' }> => piece.kind === 'blank')
    .map((piece) => `${card.id}:cloze:${piece.index}`);
}

function firstVisibleIndex(value: string) {
  return [...value].findIndex((char) => !/\s/.test(char) && !/^[\p{P}\p{S}]$/u.test(char));
}

function hintSegment(value: string) {
  const chars = [...value];
  const index = firstVisibleIndex(value);
  if (index < 0) return '';
  return chars
    .map((char, charIndex) => {
      if (/\s/.test(char)) return char;
      if (charIndex === index) return char;
      if (/^[\p{P}\p{S}]$/u.test(char)) return char;
      return '_';
    })
    .join('');
}

function answerHint(value: string) {
  const parts = value.split(/([/,])/);
  if (parts.length === 1) return hintSegment(value);
  return parts.map((part) => (part === '/' || part === ',' ? part : hintSegment(part))).join('');
}

const answerItemDelimiterPattern = /([,\/\u3001\u00b7\u318d;])/;

function answerSeparatorIndex(rawText: string) {
  const arrowIndex = rawText.indexOf('->');
  const colonIndex = rawText.indexOf(':');
  if (arrowIndex < 0 && colonIndex < 0) return null;
  if (arrowIndex >= 0 && (colonIndex < 0 || arrowIndex < colonIndex)) {
    return { index: arrowIndex, length: 2 };
  }
  return { index: colonIndex, length: 1 };
}

function maskAnswerSegment(segment: string) {
  const match = segment.match(/^(\s*)(.*?)(\s*)$/);
  if (!match) return segment;
  const [, leading, value, trailing] = match;
  if (!value.trim()) return segment;
  if (value.includes('[') || value.includes(']')) return segment;
  const punctuationMatch = value.match(/^(.*?)([.!?\u3002\uff01\uff1f]+)$/);
  const core = punctuationMatch ? punctuationMatch[1] : value;
  const punctuation = punctuationMatch ? punctuationMatch[2] : '';
  if (!core.trim()) return segment;
  return `${leading}[${core.trim()}]${punctuation}${trailing}`;
}

function maskAnswerItems(rawText: string) {
  const separator = answerSeparatorIndex(rawText);
  if (!separator) return rawText;
  const answerStart = separator.index + separator.length;
  const answer = rawText.slice(answerStart);
  if (!answer.trim()) return rawText;
  const maskedAnswer = answerItemDelimiterPattern.test(answer)
    ? answer
        .split(answerItemDelimiterPattern)
        .map((part) => (answerItemDelimiterPattern.test(part) ? part : maskAnswerSegment(part)))
        .join('')
    : maskAnswerSegment(answer);
  const readableAnswer = maskedAnswer.replace(/,(\S)/g, ', $1').replace(/;(\S)/g, '; $1');
  return `${rawText.slice(0, answerStart)}${readableAnswer}`;
}

export default function App() {
  const [roomCode, setRoomCode] = useState(() => localStorage.getItem(ROOM_KEY) ?? '');
  const [roomInput, setRoomInput] = useState(roomCode);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckDataById, setDeckDataById] = useState<Record<string, DeckCacheEntry>>({});
  const [selectedDeckId, setSelectedDeckId] = useState(() => localStorage.getItem(LAST_DECK_KEY) ?? '');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [view, setView] = useState<View>('home');
  const [editText, setEditText] = useState('');
  const [decksState, setDecksState] = useState<DecksState>('loading');
  const [retryNonce, setRetryNonce] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [shuffleCardIds, setShuffleCardIds] = useState<string[]>([]);
  const [revealResetKey, setRevealResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingStatusIds, setPendingStatusIds] = useState<Set<string>>(() => new Set());
  const pendingStatusIdsRef = useRef<Set<string>>(new Set());
  const prefetchingDeckIdsRef = useRef<Set<string>>(new Set());
  const prefetchTimersRef = useRef<Map<string, number>>(new Map());
  const prefetchUnsubscribersRef = useRef<Map<string, Array<() => void>>>(new Map());
  const pendingDeckRenamesRef = useRef<Record<string, string>>({});
  const pendingSectionRenamesRef = useRef<Record<string, string>>({});
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [nameDialogValue, setNameDialogValue] = useState('');
  const [nameDialogBusy, setNameDialogBusy] = useState(false);
  const [nameDialogError, setNameDialogError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const editBaselineRef = useRef('');
  const [conflictText, setConflictText] = useState<string | null>(null);

  const repository = useMemo<Repository | null>(() => {
    if (!roomCode) return null;
    return createFirebaseRepository(roomCode) ?? createServerRepository(roomCode) ?? createLocalRepository(roomCode);
  }, [roomCode]);

  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? (selectedDeckId ? undefined : decks[0]);
  const selectedDeckData = selectedDeck ? deckDataById[selectedDeck.id] : undefined;
  const deckSectionsReady = Boolean(selectedDeckData?.sectionsLoaded);
  const visibleSections = selectedDeckData?.sections ?? [];
  const visibleCards = selectedDeckData?.cards ?? [];
  const selectedSection = deckSectionsReady
    ? visibleSections.find((section) => section.id === selectedSectionId) ?? (selectedSectionId ? undefined : visibleSections[0])
    : undefined;
  const sectionCards = useMemo(
    () => (selectedSection ? visibleCards.filter((card) => sectionKey(card) === selectedSection.id) : []),
    [visibleCards, selectedSection],
  );
  const savedSourceText = selectedSection?.sourceText || sourceFromCards(sectionCards);
  const parsedLines = useMemo(() => parseInput(editText), [editText]);
  const validCount = parsedLines.filter((line) => line.valid).length;
  const invalidCount = parsedLines.filter((line) => !line.valid).length;

  function showToast(kind: Toast['kind'], message: string) {
    const id = ++toastIdRef.current;
    setToasts((current) => [...current, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }

  const studyCards = useMemo(() => {
    const ordered = [...sectionCards].sort((a, b) => a.createdAt - b.createdAt);
    if (!shuffle) return ordered;
    const cardsById = new Map(ordered.map((card) => [card.id, card]));
    const fixedCards = shuffleCardIds.flatMap((id) => {
      const card = cardsById.get(id);
      if (!card) return [];
      cardsById.delete(id);
      return [card];
    });
    return [...fixedCards, ...cardsById.values()];
  }, [sectionCards, shuffle, shuffleCardIds]);

  useEffect(() => {
    if (!repository) return;
    setDecksState('loading');
    const clearPrefetch = () => {
      prefetchTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      prefetchTimersRef.current.clear();
      prefetchUnsubscribersRef.current.forEach((unsubscribers) => {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      });
      prefetchUnsubscribersRef.current.clear();
    };
    prefetchingDeckIdsRef.current.clear();
    clearPrefetch();
    let reportedError = false;
    const unsubscribeDecks = repository.subscribeDecks((nextDecks) => {
      reportedError = false;
      setDecksState('ready');
      const pendingRenames = pendingDeckRenamesRef.current;
      setDecks(
        nextDecks.map((deck) => {
          const pendingName = pendingRenames[deck.id];
          return pendingName ? { ...deck, name: pendingName } : deck;
        }),
      );
    }, (error) => {
      let shouldToast = false;
      setDecksState((current) => {
        shouldToast = current === 'ready';
        return current === 'ready' ? current : 'error';
      });
      if (shouldToast && !reportedError) {
        reportedError = true;
        showToast('error', error.message || '서버에 연결할 수 없습니다.');
      }
    });
    return () => {
      unsubscribeDecks();
      clearPrefetch();
    };
  }, [repository, retryNonce]);

  useEffect(() => {
    if (decks.length === 0) {
      if (selectedDeckId) setSelectedDeckId('');
      setSelectedSectionId('');
      if (view !== 'home') setView('home');
      return;
    }
    const savedDeck = localStorage.getItem(LAST_DECK_KEY);
    const nextDeck =
      decks.find((deck) => deck.id === selectedDeckId) ??
      decks.find((deck) => deck.id === savedDeck) ??
      decks[0];
    if (nextDeck.id !== selectedDeckId) setSelectedDeckId(nextDeck.id);
  }, [decks, selectedDeckId, view]);

  useEffect(() => {
    if (!repository || !selectedDeck) return;
    localStorage.setItem(LAST_DECK_KEY, selectedDeck.id);
    const deckId = selectedDeck.id;
    let reportedError = false;
    const unsubscribeCards = repository.subscribeCards(deckId, (nextCards) => {
      reportedError = false;
      setDeckDataById((current) => ({
        ...current,
        [deckId]: {
          cards: nextCards,
          sections: current[deckId]?.sections ?? [],
          cardsLoaded: true,
          sectionsLoaded: current[deckId]?.sectionsLoaded ?? false,
          cardsError: false,
          sectionsError: current[deckId]?.sectionsError ?? false,
        },
      }));
    }, (error) => {
      setDeckDataById((current) => {
        const previous = current[deckId] ?? emptyDeckCache();
        return {
          ...current,
          [deckId]: { ...previous, cardsError: true },
        };
      });
      if (!reportedError) {
        reportedError = true;
        showToast('error', error.message || '문제를 불러오지 못했습니다.');
      }
    });
    const unsubscribeSections = repository.subscribeSections(deckId, (nextSections) => {
      reportedError = false;
      const pendingRenames = pendingSectionRenamesRef.current;
      setDeckDataById((current) => ({
        ...current,
        [deckId]: {
          cards: current[deckId]?.cards ?? [],
          sections: nextSections.map((section) => {
            const pendingName = pendingRenames[`${deckId}:${section.id}`];
            return pendingName ? { ...section, name: pendingName } : section;
          }),
          cardsLoaded: current[deckId]?.cardsLoaded ?? false,
          sectionsLoaded: true,
          cardsError: current[deckId]?.cardsError ?? false,
          sectionsError: false,
        },
      }));
    }, (error) => {
      setDeckDataById((current) => {
        const previous = current[deckId] ?? emptyDeckCache();
        return {
          ...current,
          [deckId]: { ...previous, sectionsError: true },
        };
      });
      if (!reportedError) {
        reportedError = true;
        showToast('error', error.message || '세부 암기장을 불러오지 못했습니다.');
      }
    });
    return () => {
      unsubscribeCards();
      unsubscribeSections();
    };
  }, [repository, selectedDeck, retryNonce]);

  useEffect(() => {
    if (!repository || decks.length === 0) return;
    const deckIdsToPrefetch = decks
      .map((deck) => deck.id)
      .filter((deckId) => deckId !== selectedDeck?.id)
      .filter((deckId) => {
        if (prefetchingDeckIdsRef.current.has(deckId)) return false;
        const cached = deckDataById[deckId];
        return !cached?.sectionsLoaded || !cached?.cardsLoaded;
      });

    deckIdsToPrefetch.forEach((deckId, index) => {
      prefetchingDeckIdsRef.current.add(deckId);
      const timer = window.setTimeout(() => {
        prefetchTimersRef.current.delete(deckId);

        const unsubscribeSections = repository.subscribeSections(deckId, (nextSections) => {
          const pendingRenames = pendingSectionRenamesRef.current;
          setDeckDataById((current) => {
            const previous = current[deckId] ?? emptyDeckCache();
            return {
              ...current,
              [deckId]: {
                ...previous,
                sections: nextSections.map((section) => {
                  const pendingName = pendingRenames[`${deckId}:${section.id}`];
                  return pendingName ? { ...section, name: pendingName } : section;
                }),
                sectionsLoaded: true,
                sectionsError: false,
              },
            };
          });
        }, () => {
          setDeckDataById((current) => {
            const previous = current[deckId] ?? emptyDeckCache();
            return {
              ...current,
              [deckId]: { ...previous, sectionsError: true },
            };
          });
        });

        const unsubscribeCards = repository.subscribeCards(deckId, (nextCards) => {
          setDeckDataById((current) => {
            const previous = current[deckId] ?? emptyDeckCache();
            return {
              ...current,
              [deckId]: {
                ...previous,
                cards: nextCards,
                cardsLoaded: true,
                cardsError: false,
              },
            };
          });
        }, () => {
          setDeckDataById((current) => {
            const previous = current[deckId] ?? emptyDeckCache();
            return {
              ...current,
              [deckId]: { ...previous, cardsError: true },
            };
          });
        });

        prefetchUnsubscribersRef.current.set(deckId, [unsubscribeSections, unsubscribeCards]);
      }, index * 250);
      prefetchTimersRef.current.set(deckId, timer);
    });
  }, [repository, decks, selectedDeck?.id, retryNonce]);

  useEffect(() => {
    if (!selectedDeck || !deckSectionsReady) return;
    if (visibleSections.length === 0) {
      if (selectedSectionId) setSelectedSectionId('');
      if (view !== 'home') setView('home');
      return;
    }
    const savedSection = localStorage.getItem(`${LAST_SECTION_PREFIX}:${selectedDeck.id}`);
    const nextSection =
      visibleSections.find((section) => section.id === selectedSectionId) ??
      visibleSections.find((section) => section.id === savedSection) ??
      visibleSections[0];
    if (nextSection.id !== selectedSectionId) setSelectedSectionId(nextSection.id);
  }, [deckSectionsReady, visibleSections, selectedDeck, selectedSectionId, view]);

  useEffect(() => {
    if (!selectedDeck || !selectedSection) return;
    localStorage.setItem(`${LAST_SECTION_PREFIX}:${selectedDeck.id}`, selectedSection.id);
    editBaselineRef.current = savedSourceText;
    setEditText(savedSourceText);
    setConflictText(null);
  }, [selectedDeck?.id, selectedSection?.id]);

  useEffect(() => {
    if (!selectedSection) return;
    if (savedSourceText === editBaselineRef.current) return;
    if (editText === editBaselineRef.current) {
      editBaselineRef.current = savedSourceText;
      setEditText(savedSourceText);
      setConflictText(null);
    } else {
      setConflictText(savedSourceText);
    }
  }, [savedSourceText, editText, selectedSection?.id]);

  async function enterRoom(event: FormEvent) {
    event.preventDefault();
    const code = normalizeRoomCode(roomInput);
    if (code.length < 4) return;
    localStorage.setItem(ROOM_KEY, code);
    setRoomCode(code);
    setRoomInput(code);
    setView('home');
  }

  function leaveRoom() {
    localStorage.removeItem(ROOM_KEY);
    setRoomCode('');
    setRoomInput('');
    setDecks([]);
    setDeckDataById({});
    setView('home');
  }

  function openNameDialog(dialog: NameDialog) {
    setNameDialog(dialog);
    setNameDialogValue(dialog.defaultValue);
    setNameDialogError('');
  }

  function closeNameDialog() {
    if (nameDialogBusy) return;
    setNameDialog(null);
    setNameDialogValue('');
    setNameDialogError('');
  }

  async function submitNameDialog() {
    if (!repository || !nameDialog) return;
    const name = nameDialogValue.trim();
    if (!name) {
      setNameDialogError('이름을 입력하세요.');
      return;
    }
    setNameDialogBusy(true);
    setNameDialogError('');
    try {
      if (nameDialog.type === 'deck') {
        setEditText('');
        const deckId = await repository.addDeck(name);
        setDeckDataById((current) => ({
          ...current,
          [deckId]: { cards: [], sections: [], cardsLoaded: true, sectionsLoaded: true },
        }));
        setSelectedDeckId(deckId);
        setSelectedSectionId('');
        setView('home');
      } else {
        const deckId = nameDialog.deckId;
        const sectionId = await repository.addSection(deckId, name);
        const now = Date.now();
        setDeckDataById((current) => {
          const previous = current[deckId] ?? { cards: [], sections: [], cardsLoaded: false, sectionsLoaded: false };
          const nextSection = { id: sectionId, name, sourceText: '', createdAt: now, updatedAt: now };
          return {
            ...current,
            [deckId]: {
              ...previous,
              sections: previous.sections.some((section) => section.id === sectionId)
                ? previous.sections
                : [...previous.sections, nextSection],
              sectionsLoaded: true,
            },
          };
        });
        setEditText('');
        setSelectedDeckId(deckId);
        setSelectedSectionId(sectionId);
        setView('edit');
      }
      setNameDialog(null);
      setNameDialogValue('');
    } catch (error) {
      setNameDialogError(error instanceof Error ? error.message : '저장에 실패했습니다.');
    } finally {
      setNameDialogBusy(false);
    }
  }

  function addDeck() {
    if (!repository) return;
    openNameDialog({
      type: 'deck',
      title: '새 암기장',
      label: '암기장 이름',
      defaultValue: `암기장 ${decks.length + 1}`,
    });
  }

  async function renameDeck(deckId: string, name: string) {
    if (!repository) return;
    const previousDecks = decks;
    pendingDeckRenamesRef.current = { ...pendingDeckRenamesRef.current, [deckId]: name };
    setDecks((current) => current.map((deck) => (deck.id === deckId ? { ...deck, name } : deck)));
    try {
      await repository.renameDeck(deckId, name);
      window.setTimeout(() => {
        if (pendingDeckRenamesRef.current[deckId] !== name) return;
        const { [deckId]: _discard, ...rest } = pendingDeckRenamesRef.current;
        pendingDeckRenamesRef.current = rest;
      }, 3000);
    } catch (error) {
      const { [deckId]: _discard, ...rest } = pendingDeckRenamesRef.current;
      pendingDeckRenamesRef.current = rest;
      setDecks(previousDecks);
      throw error;
    }
  }

  async function deleteDeck(deck: Deck) {
    if (!repository) return;
    if (!window.confirm(`"${displayDeckName(deck)}" 암기장을 삭제할까요?`)) return;
    try {
      await repository.deleteDeck(deck.id);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '삭제에 실패했습니다.');
      return;
    }
    setDeckDataById((current) => {
      const { [deck.id]: _discard, ...rest } = current;
      return rest;
    });
    if (selectedDeckId === deck.id) {
      setSelectedDeckId('');
      setSelectedSectionId('');
    }
    setView('home');
  }

  function addSection(deckId = selectedDeck?.id) {
    if (!repository || !deckId) return;
    const sectionCount = selectedDeck?.id === deckId ? visibleSections.length : 0;
    openNameDialog({
      type: 'section',
      deckId,
      title: '새 세부 암기장',
      label: '세부 암기장 이름',
      defaultValue: `세부 암기장 ${sectionCount + 1}`,
    });
  }

  async function renameSection(deckId: string, sectionId: string, name: string) {
    if (!repository) return;
    const previousDeckData = deckDataById;
    const pendingKey = `${deckId}:${sectionId}`;
    pendingSectionRenamesRef.current = { ...pendingSectionRenamesRef.current, [pendingKey]: name };
    setDeckDataById((current) => {
      const deckData = current[deckId];
      if (!deckData) return current;
      return {
        ...current,
        [deckId]: {
          ...deckData,
          sections: deckData.sections.map((section) => (section.id === sectionId ? { ...section, name } : section)),
        },
      };
    });
    try {
      await repository.renameSection(deckId, sectionId, name);
      window.setTimeout(() => {
        if (pendingSectionRenamesRef.current[pendingKey] !== name) return;
        const { [pendingKey]: _discard, ...rest } = pendingSectionRenamesRef.current;
        pendingSectionRenamesRef.current = rest;
      }, 3000);
    } catch (error) {
      const { [pendingKey]: _discard, ...rest } = pendingSectionRenamesRef.current;
      pendingSectionRenamesRef.current = rest;
      setDeckDataById(previousDeckData);
      throw error;
    }
  }

  async function deleteSection(section: Section) {
    if (!repository || !selectedDeck) return;
    if (!window.confirm(`"${displaySectionName(section)}" 세부 암기장을 삭제할까요?`)) return;
    try {
      await repository.deleteSection(selectedDeck.id, section.id);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '삭제에 실패했습니다.');
      return;
    }
    setDeckDataById((current) => {
      const deckData = current[selectedDeck.id];
      if (!deckData) return current;
      return {
        ...current,
        [selectedDeck.id]: {
          ...deckData,
          sections: deckData.sections.filter((item) => item.id !== section.id),
          cards: deckData.cards.filter((card) => sectionKey(card) !== section.id),
        },
      };
    });
    if (selectedSectionId === section.id) setSelectedSectionId('');
    setView('home');
  }

  function openSection(deckId: string, sectionId: string) {
    setSelectedDeckId(deckId);
    setSelectedSectionId(sectionId);
    setView('study');
  }

  async function saveContent() {
    if (!repository || !selectedDeck || !selectedSection) return;
    setBusy(true);
    const previousBaseline = editBaselineRef.current;
    const previousConflictText = conflictText;
    try {
      const sourceText = editText;
      const nextCards = preserveStars(toCards(parsedLines), sectionCards);
      editBaselineRef.current = sourceText;
      setConflictText(null);
      await repository.setSectionContent(selectedDeck.id, selectedSection.id, sourceText, nextCards);
      showToast('success', '저장되었습니다.');
      setView('study');
    } catch (error) {
      editBaselineRef.current = previousBaseline;
      setConflictText(previousConflictText);
      showToast('error', error instanceof Error ? error.message : '저장에 실패했습니다. 네트워크를 확인하세요.');
    } finally {
      setBusy(false);
    }
  }

  function acceptRemoteEdit() {
    if (conflictText === null) return;
    editBaselineRef.current = conflictText;
    setEditText(conflictText);
    setConflictText(null);
  }

  function keepLocalEdit() {
    if (conflictText === null) return;
    editBaselineRef.current = conflictText;
    setConflictText(null);
  }

  function setCachedCardStatus(deckId: string, cardId: string, status: Pick<Card, 'starred' | 'mastered'>) {
    setDeckDataById((current) => {
      const deckData = current[deckId];
      if (!deckData) return current;
      return {
        ...current,
        [deckId]: {
          ...deckData,
          cards: deckData.cards.map((item) => (item.id === cardId ? { ...item, ...status } : item)),
        },
      };
    });
  }

  function statusKey(deckId: string, cardId: string) {
    return `${deckId}:${cardId}`;
  }

  function setStatusPending(key: string, pending: boolean) {
    const next = new Set(pendingStatusIdsRef.current);
    if (pending) {
      next.add(key);
    } else {
      next.delete(key);
    }
    pendingStatusIdsRef.current = next;
    setPendingStatusIds(next);
  }

  async function toggleStar(card: Card) {
    if (!repository || !selectedDeck) return;
    const deckId = selectedDeck.id;
    const pendingKey = statusKey(deckId, card.id);
    if (pendingStatusIdsRef.current.has(pendingKey)) return;
    const previous = { starred: Boolean(card.starred), mastered: Boolean(card.mastered) };
    const next = { starred: !card.starred, mastered: !card.starred ? false : Boolean(card.mastered) };
    setCachedCardStatus(deckId, card.id, next);
    setStatusPending(pendingKey, true);
    try {
      await repository.toggleCardStar(deckId, card.id, next.starred);
    } catch (error) {
      setCachedCardStatus(deckId, card.id, previous);
      showToast('error', error instanceof Error ? error.message : '변경을 저장하지 못했습니다.');
    } finally {
      setStatusPending(pendingKey, false);
    }
  }

  async function toggleMastered(card: Card) {
    if (!repository || !selectedDeck) return;
    const deckId = selectedDeck.id;
    const pendingKey = statusKey(deckId, card.id);
    if (pendingStatusIdsRef.current.has(pendingKey)) return;
    const previous = { starred: Boolean(card.starred), mastered: Boolean(card.mastered) };
    const next = { mastered: !card.mastered, starred: !card.mastered ? false : Boolean(card.starred) };
    setCachedCardStatus(deckId, card.id, next);
    setStatusPending(pendingKey, true);
    try {
      await repository.toggleCardMastered(deckId, card.id, next.mastered);
    } catch (error) {
      setCachedCardStatus(deckId, card.id, previous);
      showToast('error', error instanceof Error ? error.message : '변경을 저장하지 못했습니다.');
    } finally {
      setStatusPending(pendingKey, false);
    }
  }

  function resetReveals() {
    setRevealResetKey((current) => current + 1);
  }

  function toggleShuffle() {
    setShuffle((current) => {
      const next = !current;
      if (next) {
        const seed = Date.now();
        setShuffleCardIds(shuffledStudyCards(sectionCards, seed).map((card) => card.id));
      } else {
        setShuffleCardIds([]);
      }
      return next;
    });
    resetReveals();
  }

  function reshuffle() {
    if (!shuffle) return;
    const seed = Date.now();
    setShuffleCardIds(shuffledStudyCards(sectionCards, seed).map((card) => card.id));
    resetReveals();
  }

  if (!roomCode) {
    return <RoomGate roomInput={roomInput} setRoomInput={setRoomInput} enterRoom={enterRoom} />;
  }

  return (
    <main className="app-shell">
      <AppHeader roomCode={roomCode} leaveRoom={leaveRoom} mode={repository?.mode ?? 'cloud'} />
      {view === 'home' && (
        <HomeView
          decks={decks}
          decksState={decksState}
          sections={visibleSections}
          sectionsLoaded={Boolean(selectedDeckData?.sectionsLoaded)}
          sectionsError={Boolean(selectedDeckData?.sectionsError)}
          cards={visibleCards}
          selectedDeck={selectedDeck}
          onRetry={() => setRetryNonce((current) => current + 1)}
          onSelectDeck={(deckId) => setSelectedDeckId(deckId)}
          onOpenSection={openSection}
          onAddDeck={addDeck}
          onRenameDeck={renameDeck}
          onDeleteDeck={deleteDeck}
          onAddSection={addSection}
          onRenameSection={renameSection}
          onDeleteSection={deleteSection}
        />
      )}
      {view === 'study' && (
        <StudyView
          deck={selectedDeck}
          section={selectedSection}
          cards={studyCards}
          cardsLoaded={Boolean(selectedDeckData?.cardsLoaded)}
          cardsError={Boolean(selectedDeckData?.cardsError)}
          totalCount={sectionCards.length}
          shuffle={shuffle}
          revealResetKey={revealResetKey}
          onRetry={() => setRetryNonce((current) => current + 1)}
          onBack={() => setView('home')}
          onEdit={() => setView('edit')}
          onToggleShuffle={toggleShuffle}
          onReshuffle={reshuffle}
          onToggleStar={toggleStar}
          onToggleMastered={toggleMastered}
          isStatusPending={(card) => (selectedDeck ? pendingStatusIds.has(statusKey(selectedDeck.id, card.id)) : false)}
        />
      )}
      {view === 'edit' && (
        <EditView
          deck={selectedDeck}
          section={selectedSection}
          text={editText}
          setText={setEditText}
          parsedLines={parsedLines}
          validCount={validCount}
          invalidCount={invalidCount}
          busy={busy}
          conflictText={conflictText}
          onAcceptRemote={acceptRemoteEdit}
          onKeepMine={keepLocalEdit}
          onBack={() => setView('study')}
          onSave={saveContent}
        />
      )}
      {nameDialog && (
        <NameDialogView
          dialog={nameDialog}
          value={nameDialogValue}
          busy={nameDialogBusy}
          error={nameDialogError}
          setValue={setNameDialogValue}
          onCancel={closeNameDialog}
          onSubmit={submitNameDialog}
        />
      )}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast ${toast.kind}`} key={toast.id}>
            {toast.message}
          </div>
        ))}
      </div>
    </main>
  );
}

function NameDialogView({
  dialog,
  value,
  busy,
  error,
  setValue,
  onCancel,
  onSubmit,
}: {
  dialog: NameDialog;
  value: string;
  busy: boolean;
  error: string;
  setValue: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void onSubmit();
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <form className="name-dialog" onSubmit={handleSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <div>
          <p className="eyebrow">{dialog.type === 'deck' ? '암기장 목록' : '세부 암기장'}</p>
          <h3>{dialog.title}</h3>
        </div>
        <label>
          <span>{dialog.label}</span>
          <input value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
        </label>
        {error && <p className="dialog-error">{error}</p>}
        <div className="dialog-actions">
          <button className="soft-button" type="button" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            추가
          </button>
        </div>
      </form>
    </div>
  );
}

function RoomGate({
  roomInput,
  setRoomInput,
  enterRoom,
}: {
  roomInput: string;
  setRoomInput: (value: string) => void;
  enterRoom: (event: FormEvent) => void;
}) {
  return (
    <main className="room-screen">
      <section className="room-panel">
        <div className="brand-mark">
          <BookOpen size={32} />
        </div>
        <h1>시험암기</h1>
        <p>같은 공유코드를 PC와 아이폰에 입력하면 언제나 같은 암기장을 봅니다.</p>
        <form onSubmit={enterRoom} className="room-form">
          <label htmlFor="room-code">공유코드</label>
          <input
            id="room-code"
            value={roomInput}
            onChange={(event) => setRoomInput(event.target.value)}
            minLength={4}
            maxLength={48}
            placeholder="예: my-exam-2026"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <button type="submit" disabled={normalizeRoomCode(roomInput).length < 4}>
            암기장 열기
          </button>
        </form>
      </section>
    </main>
  );
}

function AppHeader({ roomCode, leaveRoom }: { roomCode: string; mode: Repository['mode']; leaveRoom: () => void }) {
  return (
    <header className="app-header">
      <div className="code-row">
        <p className="eyebrow">공유코드</p>
        <div className="code-line">
          <strong>{roomCode}</strong>
          <button className="code-change-button" onClick={leaveRoom}>
            변경
          </button>
        </div>
      </div>
    </header>
  );
}

function HomeView({
  decks,
  decksState,
  sections,
  sectionsLoaded,
  sectionsError,
  cards,
  selectedDeck,
  onRetry,
  onSelectDeck,
  onOpenSection,
  onAddDeck,
  onRenameDeck,
  onDeleteDeck,
  onAddSection,
  onRenameSection,
  onDeleteSection,
}: {
  decks: Deck[];
  decksState: DecksState;
  sections: Section[];
  sectionsLoaded: boolean;
  sectionsError: boolean;
  cards: Card[];
  selectedDeck?: Deck;
  onRetry: () => void;
  onSelectDeck: (deckId: string) => void;
  onOpenSection: (deckId: string, sectionId: string) => void;
  onAddDeck: () => void;
  onRenameDeck: (deckId: string, name: string) => Promise<void>;
  onDeleteDeck: (deck: Deck) => void;
  onAddSection: (deckId?: string) => void;
  onRenameSection: (deckId: string, sectionId: string, name: string) => Promise<void>;
  onDeleteSection: (section: Section) => void;
}) {
  const [editingName, setEditingName] = useState<
    | { type: 'deck'; deckId: string }
    | { type: 'section'; deckId: string; sectionId: string }
    | null
  >(null);
  const [editingValue, setEditingValue] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [inlineError, setInlineError] = useState('');
  const submittingNameRef = useRef(false);

  function editingKey() {
    if (!editingName) return '';
    return editingName.type === 'deck' ? `deck:${editingName.deckId}` : `section:${editingName.deckId}:${editingName.sectionId}`;
  }

  function startDeckEdit(deck: Deck) {
    setEditingName({ type: 'deck', deckId: deck.id });
    setEditingValue(displayDeckName(deck));
    setInlineError('');
  }

  function startSectionEdit(deckId: string, section: Section) {
    setEditingName({ type: 'section', deckId, sectionId: section.id });
    setEditingValue(displaySectionName(section));
    setInlineError('');
  }

  function cancelNameEdit() {
    if (savingName) return;
    setEditingName(null);
    setEditingValue('');
    setInlineError('');
  }

  async function submitNameEdit() {
    if (!editingName || submittingNameRef.current) return;
    const nextName = editingValue.trim();
    if (!nextName) {
      cancelNameEdit();
      return;
    }

    submittingNameRef.current = true;
    setSavingName(true);
    setInlineError('');
    try {
      if (editingName.type === 'deck') {
        await onRenameDeck(editingName.deckId, nextName);
      } else {
        await onRenameSection(editingName.deckId, editingName.sectionId, nextName);
      }
      setEditingName(null);
      setEditingValue('');
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : '저장 실패');
    } finally {
      submittingNameRef.current = false;
      setSavingName(false);
    }
  }

  function handleNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitNameEdit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelNameEdit();
    }
  }

  return (
    <section className="home-layout">
      <div className="page-title">
        <button className="primary-button" onClick={onAddDeck}>
          <Plus size={18} />
          새 암기장
        </button>
      </div>

      <div className="folder-list">
        {decksState === 'loading' && (
          <div className="empty-state">
            <strong>불러오는 중...</strong>
            <span>암기장을 확인하고 있습니다.</span>
          </div>
        )}
        {decksState === 'error' && (
          <div className="empty-state">
            <strong>서버에 연결할 수 없습니다.</strong>
            <span>인터넷 연결을 확인한 뒤 다시 시도하세요.</span>
            <button className="soft-button" type="button" onClick={onRetry}>
              다시 시도
            </button>
          </div>
        )}
        {decksState === 'ready' && decks.length === 0 && (
          <div className="empty-state">
            <strong>아직 암기장이 없습니다</strong>
            <span>새 암기장을 만들어 시작하세요.</span>
          </div>
        )}
        {decksState === 'ready' && decks.map((deck) => {
          const selected = deck.id === selectedDeck?.id;
          const deckEditing = editingKey() === `deck:${deck.id}`;
          return (
            <article className={`folder-row ${selected ? 'open' : ''}`} key={deck.id}>
              <div className="folder-main">
                {deckEditing ? (
                  <div className="folder-title editing-name">
                    {selected ? <FolderOpen size={22} /> : <Folder size={22} />}
                    <div className="inline-name-field">
                      <input
                        value={editingValue}
                        onChange={(event) => setEditingValue(event.target.value)}
                        onKeyDown={handleNameKeyDown}
                        onBlur={() => void submitNameEdit()}
                        onFocus={(event) => event.currentTarget.select()}
                        disabled={savingName}
                        autoFocus
                        aria-label="암기장 이름"
                      />
                      {inlineError && <small>{inlineError}</small>}
                    </div>
                    <ChevronRight className="folder-chevron" size={18} />
                  </div>
                ) : (
                  <button className="folder-title" onClick={() => onSelectDeck(deck.id)}>
                    {selected ? <FolderOpen size={22} /> : <Folder size={22} />}
                    <span>{displayDeckName(deck)}</span>
                    <ChevronRight className="folder-chevron" size={18} />
                  </button>
                )}
                <div className="folder-actions">
                  <button
                    className="icon-button"
                    onClick={() => (deckEditing ? void submitNameEdit() : startDeckEdit(deck))}
                    disabled={savingName && deckEditing}
                    aria-label={deckEditing ? '암기장 이름 저장' : '암기장 이름 수정'}
                  >
                    {deckEditing ? <Check size={17} /> : <Edit3 size={16} />}
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => onDeleteDeck(deck)}
                    disabled={deckEditing}
                    aria-label="암기장 삭제"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {selected && (
                <div className="section-tree">
                  <div className="tree-summary">
                    <span>{sections.length}개 세부 암기장</span>
                    <span>{cards.length}개 카드</span>
                  </div>
                  {!sectionsLoaded && !sectionsError && (
                    <div className="empty-state section-empty-state">
                      <strong>불러오는 중...</strong>
                      <span>세부 암기장을 확인하고 있습니다.</span>
                    </div>
                  )}
                  {sectionsError && sections.length === 0 && (
                    <div className="empty-state section-empty-state">
                      <strong>불러오지 못했습니다</strong>
                      <span>인터넷 연결을 확인한 뒤 다시 시도하세요.</span>
                      <button className="soft-button" type="button" onClick={onRetry}>
                        다시 시도
                      </button>
                    </div>
                  )}
                  {sectionsLoaded && !sectionsError && sections.length === 0 && (
                    <div className="empty-state section-empty-state">
                      <strong>세부 암기장이 없습니다</strong>
                      <span>세부 암기장을 추가하면 내용을 편집할 수 있습니다.</span>
                    </div>
                  )}
                  {sectionsLoaded && sections.map((section) => {
                    const count = cards.filter((card) => sectionKey(card) === section.id).length;
                    const sectionEditing = editingKey() === `section:${deck.id}:${section.id}`;
                    return (
                      <div className="section-row" key={section.id}>
                        {sectionEditing ? (
                          <div className="section-title editing-name">
                            <div className="inline-name-field section-name-field">
                              <input
                                value={editingValue}
                                onChange={(event) => setEditingValue(event.target.value)}
                                onKeyDown={handleNameKeyDown}
                                onBlur={() => void submitNameEdit()}
                                onFocus={(event) => event.currentTarget.select()}
                                disabled={savingName}
                                autoFocus
                                aria-label="세부 암기장 이름"
                              />
                              {inlineError && <small>{inlineError}</small>}
                            </div>
                            <small>{count}문제</small>
                          </div>
                        ) : (
                          <button className="section-title" onClick={() => onOpenSection(deck.id, section.id)}>
                            <strong>{displaySectionName(section)}</strong>
                            <small>{count}문제</small>
                          </button>
                        )}
                        <div className="folder-actions">
                          <button
                            className="icon-button"
                            onClick={() => (sectionEditing ? void submitNameEdit() : startSectionEdit(deck.id, section))}
                            disabled={savingName && sectionEditing}
                            aria-label={sectionEditing ? '세부 암기장 이름 저장' : '세부 암기장 이름 수정'}
                          >
                            {sectionEditing ? <Check size={16} /> : <Edit3 size={15} />}
                          </button>
                          <button
                            className="icon-button"
                            onClick={() => onDeleteSection(section)}
                            disabled={sectionEditing}
                            aria-label="세부 암기장 삭제"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <button className="add-section-button" onClick={() => onAddSection(deck.id)}>
                    <Plus size={16} />
                    세부 암기장 추가
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StudyView({
  deck,
  section,
  cards,
  cardsLoaded,
  cardsError,
  totalCount,
  shuffle,
  revealResetKey,
  onRetry,
  onBack,
  onEdit,
  onToggleShuffle,
  onReshuffle,
  onToggleStar,
  onToggleMastered,
  isStatusPending,
}: {
  deck?: Deck;
  section?: Section;
  cards: Card[];
  cardsLoaded: boolean;
  cardsError: boolean;
  totalCount: number;
  shuffle: boolean;
  revealResetKey: number;
  onRetry: () => void;
  onBack: () => void;
  onEdit: () => void;
  onToggleShuffle: () => void;
  onReshuffle: () => void;
  onToggleStar: (card: Card) => void;
  onToggleMastered: (card: Card) => void;
  isStatusPending: (card: Card) => boolean;
}) {
  const [activeCardId, setActiveCardId] = useState('');

  return (
    <section className="study-layout">
      <div className="study-top">
        <button className="back-button" onClick={onBack}>
          <ChevronLeft size={19} />
          목록
        </button>
        <div className="study-heading">
          <p className="eyebrow">{displayDeckName(deck)}</p>
          <h2>{displaySectionName(section)}</h2>
          <span>{totalCount}문제</span>
        </div>
        <button className="soft-button" onClick={onEdit}>
          <Edit3 size={17} />
          편집
        </button>
      </div>

      <div className="study-controls">
        <button className={`toggle-button ${shuffle ? 'active' : ''}`} onClick={onToggleShuffle}>
          <Shuffle size={17} />
          셔플
        </button>
        <button className="soft-button" onClick={onReshuffle} disabled={!shuffle}>
          다시 섞기
        </button>
      </div>

      <div className="memory-list">
        {!cardsLoaded && !cardsError && cards.length === 0 && (
          <div className="empty-state">
            불러오는 중...
          </div>
        )}
        {cardsError && cards.length === 0 && (
          <div className="empty-state">
            <strong>문제를 불러오지 못했습니다</strong>
            <span>인터넷 연결을 확인한 뒤 다시 시도하세요.</span>
            <button className="soft-button" type="button" onClick={onRetry}>
              다시 시도
            </button>
          </div>
        )}
        {cardsLoaded && !cardsError && cards.length === 0 && (
          <div className="empty-state">
            아직 문제가 없습니다. 편집을 눌러 A:B, A-&gt;B, [정답], 묶음 제목 아래 목록 형식으로 내용을 추가하세요.
          </div>
        )}
        {cards.map((card, index) => (
          <MemoryCard
            key={card.id}
            index={index + 1}
            card={card}
            active={activeCardId === card.id}
            revealResetKey={revealResetKey}
            statusPending={isStatusPending(card)}
            onActivate={() => setActiveCardId(card.id)}
            onToggleStar={() => onToggleStar(card)}
            onToggleMastered={() => onToggleMastered(card)}
          />
        ))}
      </div>
    </section>
  );
}

function EditView({
  deck,
  section,
  text,
  setText,
  parsedLines,
  validCount,
  invalidCount,
  busy,
  conflictText,
  onAcceptRemote,
  onKeepMine,
  onBack,
  onSave,
}: {
  deck?: Deck;
  section?: Section;
  text: string;
  setText: (value: string) => void;
  parsedLines: ParsedLine[];
  validCount: number;
  invalidCount: number;
  busy: boolean;
  conflictText: string | null;
  onAcceptRemote: () => void;
  onKeepMine: () => void;
  onBack: () => void;
  onSave: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  function restoreEditorScroll(textarea: HTMLTextAreaElement | null, textareaScrollTop: number, windowScroll: { x: number; y: number }) {
    window.requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true });
      if (textarea) textarea.scrollTop = textareaScrollTop;
      window.scrollTo(windowScroll.x, windowScroll.y);
    });
  }

  function applyEditorTransform(nextText: string, nextCursor: number) {
    const textarea = textareaRef.current;
    if (nextText === text) return;
    const textareaScrollTop = textarea?.scrollTop ?? 0;
    const windowScroll = { x: window.scrollX, y: window.scrollY };
    setUndoStack((current) => [...current, text]);
    setRedoStack([]);
    setText(nextText);
    window.requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true });
      textarea?.setSelectionRange(nextCursor, nextCursor);
      if (textarea) textarea.scrollTop = textareaScrollTop;
      window.scrollTo(windowScroll.x, windowScroll.y);
    });
  }

  function undoEditorTransform() {
    const previous = undoStack.at(-1);
    if (previous === undefined) return;
    const textarea = textareaRef.current;
    const textareaScrollTop = textarea?.scrollTop ?? 0;
    const windowScroll = { x: window.scrollX, y: window.scrollY };
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current, text]);
    setText(previous);
    restoreEditorScroll(textarea, textareaScrollTop, windowScroll);
  }

  function redoEditorTransform() {
    const next = redoStack.at(-1);
    if (next === undefined) return;
    const textarea = textareaRef.current;
    const textareaScrollTop = textarea?.scrollTop ?? 0;
    const windowScroll = { x: window.scrollX, y: window.scrollY };
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current, text]);
    setText(next);
    restoreEditorScroll(textarea, textareaScrollTop, windowScroll);
  }

  function handleManualTextChange(value: string) {
    setUndoStack([]);
    setRedoStack([]);
    setText(value);
  }

  function maskCurrentLineAnswerItems() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursor = textarea.selectionStart ?? text.length;
    const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
    const nextLineBreak = text.indexOf('\n', cursor);
    const lineEnd = nextLineBreak >= 0 ? nextLineBreak : text.length;
    const currentLine = text.slice(lineStart, lineEnd);
    const nextLine = maskAnswerItems(currentLine);
    if (nextLine === currentLine) return;
    const nextText = `${text.slice(0, lineStart)}${nextLine}${text.slice(lineEnd)}`;
    const nextCursor = lineStart + nextLine.length;
    applyEditorTransform(nextText, nextCursor);
  }

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== '[') return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    event.preventDefault();
    const selected = text.slice(start, end);
    const nextText = `${text.slice(0, start)}[${selected}]${text.slice(end)}`;
    const nextStart = selected ? start + selected.length + 2 : start + 1;
    applyEditorTransform(nextText, nextStart);
  }

  return (
    <section className="edit-layout">
      <div className="study-top">
        <button className="back-button" onClick={onBack}>
          <ChevronLeft size={19} />
          암기
        </button>
        <div className="study-heading">
          <p className="eyebrow">{displayDeckName(deck)}</p>
          <h2>{displaySectionName(section)} 편집</h2>
          <span>
            {validCount}문제 변환 {invalidCount > 0 ? `· ${invalidCount}줄 확인 필요` : ''}
          </span>
        </div>
        <button className="primary-button" onClick={onSave} disabled={busy}>
          <Save size={17} />
          저장
        </button>
      </div>

      {conflictText !== null && (
        <div className="conflict-banner" role="alert">
          <div>
            <strong>다른 기기에서 이 세부 암기장이 수정되었습니다.</strong>
            <p>원격 내용을 불러오면 현재 편집 내용은 사라집니다.</p>
          </div>
          <div className="conflict-actions">
            <button className="soft-button" type="button" onClick={onAcceptRemote}>
              원격 내용 불러오기
            </button>
            <button className="soft-button" type="button" onClick={onKeepMine}>
              내 편집 유지
            </button>
          </div>
        </div>
      )}

      <div className="editor-grid">
        <section className="editor-pane">
          <div className="editor-toolbar">
            <button className="tool-button mask-tool-button" type="button" onClick={maskCurrentLineAnswerItems}>
              답 항목 가리기
            </button>
            <button
              className="tool-icon-button"
              type="button"
              onClick={undoEditorTransform}
              disabled={undoStack.length === 0}
              aria-label="되돌리기"
              title="되돌리기"
            >
              <Undo2 size={17} />
            </button>
            <button
              className="tool-icon-button"
              type="button"
              onClick={redoEditorTransform}
              disabled={redoStack.length === 0}
              aria-label="앞으로"
              title="앞으로"
            >
              <Redo2 size={17} />
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => handleManualTextChange(event.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder={'수도:서울\n대한민국->서울\n대한민국의 수도는 [서울]이다\n\n커피의 3가지 분류:\n- 아메리카노: 아주 [오래된] 커피\n1. [카페라떼]: 아주 [맛있는] 커피'}
          />
        </section>
        <section className="preview-pane">
          <h3>미리보기</h3>
          <div className="preview-list">
            {parsedLines.length === 0 && <div className="empty-state">입력한 원문이 여기에 카드로 변환되어 보입니다.</div>}
            {parsedLines.map((line) =>
              line.valid ? (
                <PreviewCard line={line} key={`${line.lineNumber}-${line.rawText}`} />
              ) : (
                <div className="preview-row invalid" key={`${line.lineNumber}-${line.rawText}`}>
                  <span>{line.lineNumber}</span>
                  <div>
                    <strong>{line.rawText}</strong>
                    <p>{line.reason}</p>
                  </div>
                </div>
              ),
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function PreviewCard({ line }: { line: Extract<ParsedLine, { valid: true }> }) {
  if (line.card.type === 'group') {
    return (
      <div className="preview-row group-preview">
        <span>{line.lineNumber}</span>
        <div>
          <em>묶음 카드</em>
          <strong>{line.card.prompt}</strong>
          <ul>
            {(line.card.groupItems ?? []).map((item, index) => (
              <li key={`${item.marker}:${index}`}>
                <b>{item.marker}</b> {maskCloze(item.text)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="preview-row">
      <span>{line.lineNumber}</span>
      <div>
        <strong>{line.card.type === 'pair' ? line.card.prompt : maskCloze(line.card.rawText)}</strong>
        <p>{line.card.answers.join(', ')}</p>
      </div>
    </div>
  );
}

function MemoryCard({
  index,
  card,
  active,
  revealResetKey,
  statusPending,
  onActivate,
  onToggleStar,
  onToggleMastered,
}: {
  index: number;
  card: Card;
  active: boolean;
  revealResetKey: number;
  statusPending: boolean;
  onActivate: () => void;
  onToggleStar: () => void;
  onToggleMastered: () => void;
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [hinted, setHinted] = useState<Record<string, boolean>>({});
  const revealKeys = useMemo(() => revealKeysForCard(card), [card]);

  useEffect(() => {
    setRevealed({});
    setHinted({});
  }, [card.id, revealResetKey]);

  useEffect(() => {
    if (active) return;
    setRevealed({});
    setHinted({});
  }, [active]);

  function toggleReveal(key: string) {
    onActivate();
    setRevealed((current) => {
      if (current[key]) {
        setHinted((hintCurrent) => {
          const nextHints = { ...hintCurrent };
          delete nextHints[key];
          return nextHints;
        });
        const nextRevealed = { ...current };
        delete nextRevealed[key];
        return nextRevealed;
      }
      return { ...current, [key]: true };
    });
  }

  function showNextHint() {
    if (revealKeys.length === 0) return;
    onActivate();
    const nextKey = revealKeys.find((key) => !revealed[key] && !hinted[key]);
    if (nextKey) {
      setHinted((current) => ({ ...current, [nextKey]: true }));
      return;
    }
    const nextRevealKey = revealKeys.find((key) => !revealed[key]);
    if (!nextRevealKey) return;
    setRevealed((current) => ({ ...current, [nextRevealKey]: true }));
  }

  function handleCardHint(event: React.PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('.reveal-button, .star-button, .mastered-button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left + rect.width / 2) return;
    showNextHint();
  }

  function startPress(_key: string) {
    // no-op: tap toggles the mask directly.
  }

  function endPress(key: string) {
    toggleReveal(key);
  }

  function cancelPress(_key: string) {
    // no-op
  }

  const handlers = { revealed, hinted, startPress, endPress, cancelPress };

  return (
    <article
      className={`memory-card ${card.type === 'group' ? 'group-card' : ''} ${card.type === 'pair' ? 'pair-card' : ''}`}
      onPointerUp={handleCardHint}
    >
      <div className="memory-index">{index}</div>
      <div className="memory-body">
        <MemoryCardBody card={card} handlers={handlers} />
      </div>
      <div className="memory-actions">
        <button
          className={`star-button ${card.starred ? 'active' : ''}`}
          onClick={onToggleStar}
          disabled={statusPending}
          aria-label="중요 표시"
        >
          <Star size={18} fill={card.starred ? 'currentColor' : 'none'} />
        </button>
        <button
          className={`mastered-button ${card.mastered ? 'active' : ''}`}
          onClick={onToggleMastered}
          disabled={statusPending}
          aria-label="암기 완료"
        >
          <Check size={17} />
        </button>
      </div>
    </article>
  );
}

function MemoryCardBody({ card, handlers }: { card: Card; handlers: RevealHandlers }) {
  if (card.type === 'pair') {
    return (
      <>
        <strong>{card.prompt}</strong>
        <RevealButton
          value={card.answers[0] ?? ''}
          shown={Boolean(handlers.revealed[`${card.id}:0`])}
          hint={handlers.hinted[`${card.id}:0`] ? answerHint(card.answers[0] ?? '') : ''}
          onPointerDown={() => handlers.startPress(`${card.id}:0`)}
          onPointerUp={() => handlers.endPress(`${card.id}:0`)}
          onPointerCancel={() => handlers.cancelPress(`${card.id}:0`)}
          onPointerLeave={() => handlers.cancelPress(`${card.id}:0`)}
        />
      </>
    );
  }

  if (card.type === 'group') {
    return (
      <div className="group-body">
        <strong className="group-title">{card.prompt}</strong>
        <ul className="group-list">
          {(card.groupItems ?? []).map((item, itemIndex) => (
            <li key={`${item.marker}:${itemIndex}`}>
              <span className="group-marker">{item.marker}</span>
              <span className="group-item-text">
                <ClozeText rawText={item.text} keyPrefix={`${card.id}:group:${itemIndex}`} handlers={handlers} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <p className="cloze-line">
      <ClozeText rawText={card.rawText} keyPrefix={`${card.id}:cloze`} handlers={handlers} />
    </p>
  );
}

function ClozeText({ rawText, keyPrefix, handlers }: { rawText: string; keyPrefix: string; handlers: RevealHandlers }) {
  return (
    <>
      {splitCloze(rawText).map((piece, pieceIndex) =>
        piece.kind === 'text' ? (
          <span key={`${keyPrefix}:text:${pieceIndex}`}>{piece.value}</span>
        ) : (
          <RevealButton
            key={`${keyPrefix}:blank:${piece.index}`}
            value={piece.value}
            inline
            shown={Boolean(handlers.revealed[`${keyPrefix}:${piece.index}`])}
            hint={handlers.hinted[`${keyPrefix}:${piece.index}`] ? answerHint(piece.value) : ''}
            onPointerDown={() => handlers.startPress(`${keyPrefix}:${piece.index}`)}
            onPointerUp={() => handlers.endPress(`${keyPrefix}:${piece.index}`)}
            onPointerCancel={() => handlers.cancelPress(`${keyPrefix}:${piece.index}`)}
            onPointerLeave={() => handlers.cancelPress(`${keyPrefix}:${piece.index}`)}
          />
        ),
      )}
    </>
  );
}

function RevealButton({
  value,
  shown,
  hint,
  inline = false,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
}: {
  value: string;
  shown: boolean;
  hint?: string;
  inline?: boolean;
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
}) {
  return (
    <button
      className={`reveal-button ${inline ? 'inline' : ''} ${shown ? 'shown' : ''}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="answer-measure">{value}</span>
      <span className={`answer-mask ${hint ? 'hinted' : ''}`} aria-hidden="true">
        {hint && <span className="hint-text">{hint}</span>}
      </span>
      <span className="answer-text">{value}</span>
    </button>
  );
}

function maskCloze(rawText: string) {
  return rawText.replace(/\[[^\[\]]+\]/g, '____');
}

