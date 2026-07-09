import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import { TriangleAlert } from 'lucide-react';
import { createFirebaseRepository } from './firebase';
import { createLocalRepository } from './localRepository';
import { createServerRepository } from './serverRepository';
import { splitCloze } from './parser';
import type { Card, Deck, NewCard, Repository, Section } from './types';

const ROOM_KEY = 'exam-memorizer-room-code';
const ACCENT = '#007aff';
const ACCENT_DEEP = '#0a5dc2';
const ACCENT_SOFT = 'rgba(0,122,255,0.08)';
const SUBJECT_COLORS = ['#007aff', '#af52de', '#ff9500', '#34c759', '#ff2d55', '#5856d6', '#00c7be', '#ff3b30'];
// PC (mouse) users can't discover swipe — surface the keyboard shortcuts to them.
const IS_PC = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;

// ------------------------------------------------------------------ helpers
function normalizeRoomCode(value: string) {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
}

function hashStr(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function colorForDeck(deckId: string) {
  return SUBJECT_COLORS[hashStr(deckId) % SUBJECT_COLORS.length];
}

type Token = { word: string; tail: string; hidden: boolean; gid: number; nl?: boolean };
type Row = { kind: 'qa'; q: string; a: string } | { kind: 'tokens'; tokens: Token[] };

function splitParticle(word: string): { word: string; tail: string } {
  const match = word.match(/^(.{2,})([은는이가을를의와과도만])$/);
  if (match) return { word: match[1], tail: match[2] };
  return { word, tail: '' };
}

function tokenizeLine(line: string, gidStart = 1): Token[] {
  const tokens: Token[] = [];
  let gid = gidStart;
  const re = /\[([^\]]+)\]|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m[1] !== undefined) {
      tokens.push({ word: m[1].trim(), tail: '', hidden: true, gid: gid++ });
    } else {
      const sp = splitParticle(m[0]);
      tokens.push({ word: sp.word, tail: sp.tail, hidden: false, gid: 0 });
    }
  }
  return tokens;
}

function tokenizeText(text: string, gidStart = 1): Token[] {
  let g = gidStart;
  let tokens: Token[] = [];
  text.split('\n').forEach((line, i) => {
    if (i > 0) tokens.push({ nl: true, word: '', tail: '', hidden: false, gid: 0 });
    tokens = tokens.concat(tokenizeLine(line, g));
    g += 100;
  });
  return tokens;
}

function tokensToCard(tokens: Token[]): { q: string; a: string[] } {
  const qParts: string[] = [];
  const answers: string[] = [];
  let j = 0;
  while (j < tokens.length) {
    const t = tokens[j];
    if (t.nl) { qParts.push('\n'); j += 1; continue; }
    if (!t.hidden) { qParts.push(t.word + t.tail); j += 1; continue; }
    const g = t.gid;
    const run: Token[] = [];
    while (j < tokens.length && tokens[j].hidden && tokens[j].gid === g) { run.push(tokens[j]); j += 1; }
    const ansParts = run.map((tt, k) => (k < run.length - 1 ? tt.word + tt.tail : tt.word));
    answers.push(ansParts.join(' '));
    qParts.push('___' + run[run.length - 1].tail);
  }
  let q = '';
  for (const p of qParts) {
    if (p === '\n') { q = q.replace(/ $/, '') + '\n'; continue; }
    if (q && !q.endsWith('\n')) q += ' ';
    q += p;
  }
  return { q: q.trim(), a: answers };
}

function cardToTokens(q: string, answers: string[]): Token[] {
  const tokens: Token[] = [];
  let g = 1;
  let ai = 0;
  q.split('\n').forEach((lineQ, li) => {
    if (li > 0) tokens.push({ nl: true, word: '', tail: '', hidden: false, gid: 0 });
    const parts = lineQ.split('___');
    parts.forEach((part, i) => {
      let rest = part;
      if (i > 0) {
        const tm = rest.match(/^(\S*)([\s\S]*)$/);
        tokens.push({ word: answers[ai++] || '', tail: tm ? tm[1] : '', hidden: true, gid: g++ });
        rest = tm ? tm[2] : rest;
      }
      for (const w of rest.trim().split(/\s+/).filter(Boolean)) {
        const sp = splitParticle(w);
        tokens.push({ word: sp.word, tail: sp.tail, hidden: false, gid: 0 });
      }
    });
  });
  return tokens;
}

function tokensToText(tokens: Token[]) {
  return tokens.map((t) => (t.nl ? '\n' : t.word + t.tail)).join(' ').replace(/ ?\n ?/g, '\n').trim();
}

function parsePaste(text: string, mode: 'auto' | 'one'): Row[] {
  if (mode === 'one') {
    const lines = text.replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    return [{ kind: 'tokens', tokens: tokenizeText(lines.join('\n'), 1) }];
  }
  const rows: Row[] = [];
  const cleaned = text.replace(/\r/g, '');
  const hasBlank = /\n\s*\n/.test(cleaned.trim());
  const units = hasBlank ? cleaned.split(/\n\s*\n+/) : cleaned.split('\n');
  let g = 1;
  for (const rawU of units) {
    const lines = rawU.split('\n').map((x) => x.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.length === 1) {
      const line = lines[0];
      const hasBracket = /\[[^\]]+\]/.test(line);
      if (!hasBracket) {
        const a = line.indexOf('->');
        const c = line.indexOf(':');
        const sep = a >= 0 && (c < 0 || a < c) ? { i: a, len: 2 } : c >= 0 ? { i: c, len: 1 } : null;
        if (sep && line.slice(0, sep.i).trim() && line.slice(sep.i + sep.len).trim()) {
          rows.push({ kind: 'qa', q: line.slice(0, sep.i).trim(), a: line.slice(sep.i + sep.len).trim() });
          continue;
        }
      }
      const tokens = tokenizeLine(line, g);
      g += 100;
      if (tokens.length > 0) rows.push({ kind: 'tokens', tokens });
    } else {
      const tokens = tokenizeText(lines.join('\n'), g);
      g += 100 * lines.length;
      if (tokens.length > 0) rows.push({ kind: 'tokens', tokens });
    }
  }
  return rows;
}

// stored Card -> prototype-style { q(with ___), a[] }
function deriveGroup(card: Card): { q: string; a: string[] } {
  const items = card.groupItems ?? [];
  const anyBlank = items.some((it) => /\[[^\]]+\]/.test(it.text));
  if (anyBlank) {
    const qLines = [card.prompt];
    const a: string[] = [];
    for (const it of items) {
      let line = it.marker || '';
      for (const piece of splitCloze(it.text)) {
        if (piece.kind === 'text') line += piece.value;
        else { line += '___'; a.push(piece.value); }
      }
      qLines.push(line);
    }
    return { q: qLines.join('\n'), a };
  }
  const body = items.map((it) => `${it.marker || '· '}${it.text}`).join('\n');
  return { q: card.prompt, a: [body || card.prompt] };
}

function deriveQA(card: Card): { q: string; a: string[] } {
  if (card.type === 'group') return deriveGroup(card);
  if (card.type === 'cloze') {
    if (card.prompt.includes('___')) return { q: card.prompt, a: card.answers };
    const pieces = splitCloze(card.prompt);
    if (pieces.some((p) => p.kind === 'blank')) {
      let q = '';
      const a: string[] = [];
      for (const piece of pieces) {
        if (piece.kind === 'text') q += piece.value;
        else { q += '___'; a.push(piece.value); }
      }
      return { q, a };
    }
  }
  return { q: card.prompt, a: card.answers };
}

function qaToNewCard(q: string, a: string[], mastered: boolean): NewCard {
  const isCloze = q.includes('___');
  return {
    type: isCloze ? 'cloze' : 'pair',
    prompt: q,
    answers: a,
    rawText: isCloze ? q : `${q}: ${a.join(', ')}`,
    mastered,
  };
}

function cardToNewCard(card: Card, masteredOverride?: boolean): NewCard {
  return {
    type: card.type,
    prompt: card.prompt,
    answers: card.answers,
    rawText: card.rawText,
    groupItems: card.groupItems,
    starred: card.starred,
    mastered: masteredOverride !== undefined ? masteredOverride : card.mastered,
  };
}

// NewCard + a client-only hint so the optimistic cache can keep the card's
// current id (the server regenerates ids on every content PUT).
type OptimisticNewCard = NewCard & { optimisticId?: string };

function keepCard(card: Card, masteredOverride?: boolean): OptimisticNewCard {
  return { ...cardToNewCard(card, masteredOverride), optimisticId: card.id };
}

// ------------------------------------------------------------------ view model
type ProtoCard = {
  id: string;
  q: string;
  a: string[];
  memorized: boolean;
  isGroup: boolean;
  source: Card;
};

type ProtoList = {
  id: string;
  deckId: string;
  subject: string;
  color: string;
  name: string;
  synthetic: boolean;
  cards: ProtoCard[];
};

type DeckCacheEntry = { cards: Card[]; sections: Section[]; cardsLoaded: boolean; sectionsLoaded: boolean };
function emptyDeckCache(): DeckCacheEntry {
  return { cards: [], sections: [], cardsLoaded: false, sectionsLoaded: false };
}

// ------------------------------------------------------------------ ui state
type View = 'home' | 'deck' | 'study';
type UIState = {
  view: View;
  activeSectionId: string | null;
  collapsed: Record<string, boolean>;
  shuffle: boolean;
  filter: 'all' | 'unknown' | 'done';
  again: Record<string, number>;
  queue: string[];
  sessionTotal: number;
  sessionDone: number;
  revealedIdx: number[];
  review: boolean;
  dragX: number;
  dragging: boolean;
  snap: boolean;
  openRowId: string | null;
  rowDrag: { id: string; x: number; base: number } | null;
  reorder: { id: string; dy: number; overId?: string | null } | null;
  sel: { ri: number; start: number; end: number; wasHidden: boolean } | null;
  sheetOpen: boolean;
  addTab: 'type' | 'paste';
  pasteText: string;
  pasteMode: 'auto' | 'one';
  sheetRows: Row[];
  rowSel: { a: number; b: number } | null;
  rowSelDragging: boolean;
  typeMode: 'qa' | 'cloze';
  typeQ: string;
  typeA: string;
  typeText: string;
  typeTokens: Token[];
  typeAdded: number;
  editSheetOpen: boolean;
  editIdx: number | null;
  editMode: 'qa' | 'tokens';
  editQ: string;
  editA: string;
  editText: string;
  editTokens: Token[];
  settingsOpen: boolean;
  toastMsg: string;
  toastVisible: boolean;
};

const initialUI: UIState = {
  view: 'home', activeSectionId: null, collapsed: {}, shuffle: false, filter: 'all', again: {},
  queue: [], sessionTotal: 0, sessionDone: 0, revealedIdx: [], review: false,
  dragX: 0, dragging: false, snap: false,
  openRowId: null, rowDrag: null, reorder: null, sel: null,
  sheetOpen: false, addTab: 'type', pasteText: '', pasteMode: 'auto', sheetRows: [], rowSel: null, rowSelDragging: false,
  typeMode: 'cloze', typeQ: '', typeA: '', typeText: '', typeTokens: [], typeAdded: 0,
  editSheetOpen: false, editIdx: null, editMode: 'qa', editQ: '', editA: '', editText: '', editTokens: [],
  settingsOpen: false, toastMsg: '', toastVisible: false,
};

type Patch = Partial<UIState> | ((s: UIState) => Partial<UIState>);
function uiReducer(state: UIState, patch: Patch): UIState {
  return { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
}

// ================================================================== App
export default function App() {
  const [roomCode, setRoomCode] = useState(() => localStorage.getItem(ROOM_KEY) ?? '');
  if (!roomCode) return <IdGate onSubmit={(code) => { localStorage.setItem(ROOM_KEY, code); setRoomCode(code); }} />;
  return <Room key={roomCode} roomCode={roomCode} onChangeRoom={(code) => { localStorage.setItem(ROOM_KEY, code); setRoomCode(code); }} />;
}

function IdGate({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [value, setValue] = useState('');
  const normalized = normalizeRoomCode(value);
  const hasInvalid = value.trim().replace(/[A-Za-z0-9_\s-]/g, '').length > 0;
  const submit = () => {
    if (!normalized) return;
    onSubmit(normalized);
  };
  return (
    <div style={{ minHeight: '100dvh', width: '100%', maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', padding: 'calc(env(safe-area-inset-top) + 84px) 24px 0', gap: 26 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>시험암기</div>
        <div style={{ fontSize: 14.5, color: 'rgba(60,60,67,0.62)', lineHeight: 1.6 }}>
          처음이면 아이디를 새로 정하세요. 쓰던 아이디를 입력하면 그 암기장이 열려요.
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(60,60,67,0.5)', letterSpacing: '0.03em' }}>내 아이디</span>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="예: hong-gildong-2026"
          style={{ height: 48, borderRadius: 11, border: '1px solid rgba(60,60,67,0.2)', background: '#fff', padding: '0 14px', fontSize: 16, fontWeight: 600, color: '#000' }}
        />
        <span style={{ fontSize: 12, color: hasInvalid ? '#ff9500' : 'rgba(60,60,67,0.45)', fontWeight: hasInvalid ? 700 : 400, lineHeight: 1.5 }}>
          {hasInvalid
            ? '한글·특수문자는 쓸 수 없어요 — 영문·숫자·- _ 만 남아요'
            : '영문·숫자·- _ 만 쓸 수 있어요 · 비밀번호는 없어요'}
        </span>
        <div onClick={() => setValue(`memo-${Math.random().toString(36).slice(2, 8)}`)} style={{ alignSelf: 'flex-start', padding: '6px 2px', cursor: 'pointer' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: ACCENT }}>아이디 자동으로 만들기</span>
        </div>
      </div>
      <div
        onClick={submit}
        style={{ height: 48, borderRadius: 11, background: normalized ? ACCENT : 'rgba(0,122,255,0.28)', display: 'grid', placeItems: 'center', cursor: 'pointer', transition: 'background 0.15s' }}
      >
        <span style={{ fontSize: 15.5, fontWeight: 700, color: '#fff' }}>시작하기</span>
      </div>
    </div>
  );
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
  const pendingSectionRenamesRef = useRef<Record<string, string>>({});
  const toastTimer = useRef<number | undefined>(undefined);
  const lpTimer = useRef<number | undefined>(undefined);
  const rowStart = useRef<{ x: number; y: number; moved: boolean }>({ x: 0, y: 0, moved: false });
  const swipeStart = useRef<{ x: number; moved: boolean }>({ x: 0, moved: false });

  const toast = useCallback((msg: string) => {
    window.clearTimeout(toastTimer.current);
    dispatch({ toastMsg: msg, toastVisible: true });
    toastTimer.current = window.setTimeout(() => dispatch({ toastVisible: false }), 1800);
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
      if (sel.ri === -200) return { typeTokens: apply(st.typeTokens), sel: null };
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
      dispatch((st) => ({
        ...(st.reorder ? { reorder: null } : {}),
        ...(st.rowSelDragging ? { rowSelDragging: false } : {}),
      }));
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
        return { id: c.id, q, a, memorized: !!c.mastered, isGroup: c.type === 'group', source: c };
      };
      for (const section of sections) {
        seen.add(section.id);
        out.push({
          id: section.id, deckId: deck.id, subject: deck.name || '암기장', color: colorForDeck(deck.id),
          name: section.name || '세부 암기장', synthetic: false,
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
            id: key, deckId: deck.id, subject: deck.name || '암기장', color: colorForDeck(deck.id),
            name: '기본', synthetic: true, cards: bucket.map(toProto),
          });
        }
      }
    }
    return out;
  }, [decks, deckDataById]);

  const activeList = lists.find((l) => l.id === state.activeSectionId);
  const weakFirst = useCallback((cards: ProtoCard[]) => [...cards].sort((x, y) => (state.again[y.id] || 0) - (state.again[x.id] || 0)), [state.again]);

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

  const toggleMemorized = useCallback((deckId: string, cardId: string, mastered: boolean) => {
    if (!repository) return;
    setDeckDataById((cur) => {
      const prev = cur[deckId];
      if (!prev) return cur;
      return { ...cur, [deckId]: { ...prev, cards: prev.cards.map((c) => (c.id === cardId ? { ...c, mastered } : c)) } };
    });
    repository.toggleCardMastered(deckId, cardId, mastered).catch(() => {});
  }, [repository]);

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

  const newList = useCallback(async () => {
    if (!repository) return;
    try {
      let deckId = decks.find((d) => d.name === '일반')?.id;
      if (!deckId) deckId = await repository.addDeck('일반');
      const sectionId = await repository.addSection(deckId, '새 목록');
      dispatch({
        view: 'deck', activeSectionId: sectionId, sheetOpen: true, addTab: 'type',
        typeMode: 'cloze', typeQ: '', typeA: '', typeText: '', typeTokens: [], typeAdded: 0, pasteText: '', sheetRows: [],
      });
    } catch {
      toast('목록을 만들지 못했어요');
    }
  }, [repository, decks, toast]);

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
    const label = activeList.cards.length > 0 ? `카드 ${activeList.cards.length}장이 함께 삭제돼요.` : '';
    if (!window.confirm(`"${activeList.name}" 목록을 삭제할까요? ${label}`)) return;
    const remaining = (deckDataById[activeList.deckId]?.sections ?? []).filter((s) => s.id !== activeList.id);
    dispatch({ view: 'home', activeSectionId: null, openRowId: null });
    try {
      await repository.deleteSection(activeList.deckId, activeList.id);
      if (remaining.length === 0) await repository.deleteDeck(activeList.deckId);
      toast('목록을 삭제했어요');
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
      dispatch({ editSheetOpen: true, editIdx: idx, editMode: 'tokens', editTokens: tokens, editText: tokensToText(tokens) });
    } else {
      dispatch({ editSheetOpen: true, editIdx: idx, editMode: 'qa', editQ: c.q, editA: c.a.join(', ') });
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
      i === st.editIdx ? { ...qaToNewCard(q, a, !!c.mastered), optimisticId: c.id } : keepCard(c),
    );
    commitSection(activeList.deckId, activeList.id, rebuilt);
    return true;
  }, [activeList, storedCardsOf, commitSection, toast]);

  const startStudy = useCallback((sectionId: string, cardIds?: string[]) => {
    const list = lists.find((l) => l.id === sectionId);
    if (!list) return;
    if (list.cards.length === 0) { dispatch({ view: 'deck', activeSectionId: sectionId }); return; }
    let ids = cardIds ?? weakFirst(list.cards.filter((c) => !c.memorized)).map((c) => c.id);
    let review = false;
    if (ids.length === 0) { ids = list.cards.map((c) => c.id); review = true; }
    if (state.shuffle) {
      ids = [...ids];
      for (let i = ids.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    }
    dispatch({ view: 'study', activeSectionId: sectionId, queue: ids, sessionTotal: ids.length, sessionDone: 0, revealedIdx: [], dragX: 0, openRowId: null, review });
  }, [lists, weakFirst, state.shuffle]);

  const doKnown = useCallback(() => {
    const list = activeList;
    const cardId = state.queue[0];
    if (!list || !cardId) return;
    toggleMemorized(list.deckId, cardId, true);
    dispatch((st) => ({ queue: st.queue.slice(1), sessionDone: st.sessionDone + 1, revealedIdx: [], dragX: 0, dragging: false, snap: false }));
  }, [activeList, state.queue, toggleMemorized]);

  const doAgain = useCallback(() => {
    const cardId = state.queue[0];
    if (!cardId) return;
    const last = state.queue.length === 1;
    dispatch((st) => {
      const again = { ...st.again, [cardId]: (st.again[cardId] || 0) + 1 };
      if (st.queue.length === 1) return { again, revealedIdx: [], dragX: 0, dragging: false, snap: false };
      return { again, queue: [...st.queue.slice(1), st.queue[0]], revealedIdx: [], dragX: 0, dragging: false, snap: false };
    });
    if (last) toast('마지막 카드예요 — 한 번 더!');
  }, [state.queue, toast]);

  const commitSwipe = useCallback((dir: number) => {
    dispatch({ dragging: false, dragX: dir * 560 });
    window.setTimeout(() => {
      if (dir > 0) doKnown(); else doAgain();
      dispatch({ snap: true, dragX: 0 });
      window.setTimeout(() => dispatch({ snap: false }), 60);
    }, 200);
  }, [doKnown, doAgain]);

  // ---- token view descriptors
  const tokenViews = useCallback((tokens: Token[], ri: number) => {
    const sel = state.sel;
    return tokens.map((t, ti) => {
      if (t.nl) return { brk: true as const, key: ti };
      const inSel = !!sel && sel.ri === ri && ti >= Math.min(sel.start, sel.end) && ti <= Math.max(sel.start, sel.end);
      const marked = t.hidden || inSel;
      return {
        brk: false as const, key: ti, word: t.word, tail: t.tail,
        bg: marked ? ACCENT : '#fff', fg: marked ? '#fff' : '#1d1d1f', fw: marked ? 700 : 600, padX: marked ? 8 : 6,
        bd: marked ? '1px solid transparent' : '1px solid rgba(60,60,67,0.12)',
        onDown: (e: ReactPointerEvent) => {
          e.stopPropagation();
          try { (e.target as Element).releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
          dispatch({ sel: { ri, start: ti, end: ti, wasHidden: t.hidden } });
        },
        onEnter: () => dispatch((st) => (st.sel && st.sel.ri === ri ? { sel: { ...st.sel, end: ti } } : {})),
      };
    });
  }, [state.sel]);

  const renderTokenChips = (tokens: Token[], ri: number, fontSize: number) => tokenViews(tokens, ri).map((tv) =>
    tv.brk ? (
      <span key={tv.key} style={{ width: '100%', height: 2 }} />
    ) : (
      <span key={tv.key} style={{ display: 'inline-flex', alignItems: 'baseline' }}>
        <span
          onPointerDown={tv.onDown}
          onPointerEnter={tv.onEnter}
          style={{ display: 'inline-block', padding: `2px ${tv.padX}px`, borderRadius: 8, background: tv.bg, color: tv.fg, border: tv.bd, boxSizing: 'border-box', fontSize, fontWeight: tv.fw, cursor: 'pointer', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
        >
          {tv.word}
        </span>
        <span style={{ fontSize, fontWeight: 600 }}>{tv.tail}</span>
      </span>
    ));

  // ============================================================ render
  return (
    <div style={{ height: '100dvh', width: '100%', maxWidth: 480, margin: '0 auto', position: 'relative', background: '#F2F2F7', color: '#000', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {state.view === 'home' && (
        <HomeView
          lists={lists} decksState={decksState} collapsed={state.collapsed} roomCode={roomCode}
          weakFirst={weakFirst}
          onToggleCollapse={(deckId) => dispatch((st) => ({ collapsed: { ...st.collapsed, [deckId]: !st.collapsed[deckId] } }))}
          onOpenList={(id) => dispatch({ view: 'deck', activeSectionId: id, openRowId: null, filter: 'all' })}
          onContinue={(id) => startStudy(id)}
          onNewList={newList}
          onOpenSettings={() => dispatch({ settingsOpen: true })}
        />
      )}

      {state.view === 'deck' && activeList && (
        <DeckView
          list={activeList} state={state} dispatch={dispatch} weakFirst={weakFirst}
          lpTimer={lpTimer} rowStart={rowStart}
          onHome={() => dispatch({ view: 'home', openRowId: null })}
          onRename={(name) => !activeList.synthetic && renameSection(activeList.deckId, activeList.id, name)}
          onToggleMem={(card) => toggleMemorized(activeList.deckId, card.id, !card.memorized)}
          onDelete={(card) => {
            const stored = storedCardsOf(activeList.deckId, activeList.id).filter((c) => c.id !== card.id);
            commitSection(activeList.deckId, activeList.id, stored.map((c) => keepCard(c)));
            dispatch({ openRowId: null });
            toast('카드를 삭제했어요');
          }}
          onEdit={openEditFor}
          onMove={moveCard}
          onDeleteList={deleteList}
          onStart={(ids) => startStudy(activeList.id, ids)}
          onOpenSheet={() => dispatch({ sheetOpen: true, addTab: 'type', pasteText: '', sheetRows: [], typeMode: 'cloze', typeQ: '', typeA: '', typeText: '', typeTokens: [], typeAdded: 0, openRowId: null })}
          renderTokenChips={renderTokenChips}
          toast={toast}
        />
      )}

      {state.view === 'study' && (
        <StudyView
          list={activeList} state={state} dispatch={dispatch} swipeStart={swipeStart}
          onCommitSwipe={commitSwipe} onKnown={doKnown} onAgain={doAgain}
          onDeck={() => dispatch({ view: 'deck', queue: [], revealedIdx: [], dragX: 0, openRowId: null })}
          onRetryRemaining={() => activeList && startStudy(activeList.id)}
          onReviewAll={() => activeList && startStudy(activeList.id, activeList.cards.map((c) => c.id))}
        />
      )}

      {/* ---- add sheet ---- */}
      {state.sheetOpen && activeList && (
        <AddSheet
          list={activeList} state={state} dispatch={dispatch} storedCardsOf={storedCardsOf}
          commitSection={commitSection} renderTokenChips={renderTokenChips} toast={toast} commitSelection={commitSelection}
        />
      )}

      {/* ---- edit sheet ---- */}
      {state.editSheetOpen && activeList && (
        <EditSheet
          list={activeList} state={state} dispatch={dispatch}
          saveEditFrom={saveEditFrom} renderTokenChips={renderTokenChips}
          onDelete={() => {
            if (state.editIdx === null) return;
            const stored = storedCardsOf(activeList.deckId, activeList.id).filter((_, i) => i !== state.editIdx);
            commitSection(activeList.deckId, activeList.id, stored.map((c) => keepCard(c)));
            dispatch({ editSheetOpen: false });
            toast('카드를 삭제했어요');
          }}
          openEditFor={openEditFor}
        />
      )}

      {state.settingsOpen && (
        <SettingsSheet roomCode={roomCode} onClose={() => dispatch({ settingsOpen: false })} onChangeRoom={onChangeRoom} />
      )}

      {state.toastVisible && (
        <div style={{ position: 'absolute', left: '50%', bottom: 130, transform: 'translateX(-50%)', padding: '11px 20px', borderRadius: 10, background: 'rgba(29,29,31,0.92)', color: '#fff', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', animation: 'popIn 0.25s cubic-bezier(0.3,1.2,0.4,1)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 20 }}>
          {state.toastMsg}
        </div>
      )}
    </div>
  );
}

function EmptyStateAction(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="primary-action-button"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
    >
      {props.label}
    </button>
  );
}

// ================================================================ HOME
function HomeView(props: {
  lists: ProtoList[]; decksState: 'loading' | 'ready' | 'error'; collapsed: Record<string, boolean>; roomCode: string;
  weakFirst: (cards: ProtoCard[]) => ProtoCard[];
  onToggleCollapse: (deckId: string) => void; onOpenList: (id: string) => void; onContinue: (id: string) => void;
  onNewList: () => void; onOpenSettings: () => void;
}) {
  const { lists, decksState } = props;
  const contList = lists.find((l) => l.cards.some((c) => !c.memorized));
  const contRemain = contList ? contList.cards.filter((c) => !c.memorized).length : 0;

  type Group = { deckId: string; subject: string; color: string; lists: ProtoList[] };
  const groupOrder: string[] = [];
  const groupMap: Record<string, Group> = {};
  for (const l of lists) {
    if (!groupMap[l.deckId]) { groupMap[l.deckId] = { deckId: l.deckId, subject: l.subject, color: l.color, lists: [] }; groupOrder.push(l.deckId); }
    groupMap[l.deckId].lists.push(l);
  }
  // A single "일반"-style group is just noise for a first-timer — show the lists
  // flat and only reveal subject headers once there's more than one subject.
  const showHeaders = groupOrder.length > 1;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, paddingTop: 'env(safe-area-inset-top)' }}>
      <div style={{ padding: '18px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>내 암기장</div>
        <div onClick={props.onOpenSettings} role="button" aria-label="설정" title="설정" style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px calc(env(safe-area-inset-bottom) + 32px)', minHeight: 0 }}>
        {decksState === 'loading' && lists.length === 0 && (
          <div style={{ padding: '44px 20px', textAlign: 'center', color: 'rgba(60,60,67,0.45)', fontSize: 15 }}>불러오는 중…</div>
        )}
        {decksState === 'ready' && lists.length === 0 && (
          <div style={{ padding: '38px 20px', textAlign: 'center', color: 'rgba(60,60,67,0.58)', fontSize: 15, lineHeight: 1.6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div>아직 암기장이 없어요.<br />첫 목록을 만들고 바로 카드를 넣어보세요.</div>
            <EmptyStateAction label="첫 암기장 만들기" onClick={props.onNewList} />
          </div>
        )}

        {contList && (
          <div onClick={() => props.onContinue(contList.id)} style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 12, background: ACCENT, color: '#fff', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.78 }}>이어서 암기 · {contRemain}문제 남음</div>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{showHeaders ? `${contList.subject} · ${contList.name}` : contList.name}</div>
            </div>
            <div style={{ width: 32, height: 32, borderRadius: 999, background: 'rgba(255,255,255,0.24)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <svg width="12" height="14" viewBox="0 0 16 18"><path d="M2 1.5v15l13-7.5z" fill="#fff" /></svg>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {groupOrder.map((deckId, gi) => {
            const g = groupMap[deckId];
            const allCards = g.lists.reduce((n, l) => n + l.cards.length, 0);
            const doneCards = g.lists.reduce((n, l) => n + l.cards.filter((c) => c.memorized).length, 0);
            const isCollapsed = showHeaders && !!props.collapsed[deckId];
            // single-subject home: the "new list" row lives inside the one group
            const withAddRow = !showHeaders && gi === groupOrder.length - 1;
            return (
              <div key={deckId} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {showHeaders && (
                  <div onClick={() => props.onToggleCollapse(deckId)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px', cursor: 'pointer' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: g.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-0.01em' }}>{g.subject}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(60,60,67,0.45)' }}>{g.lists.length}개 · {doneCards}/{allCards} 외움</span>
                    <div style={{ flex: 1 }} />
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.4)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }}><path d="m6 9 6 6 6-6" /></svg>
                  </div>
                )}
                {!isCollapsed && (
                  <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
                    {g.lists.map((l, li) => {
                      const remain = l.cards.filter((c) => !c.memorized).length;
                      const allDone = l.cards.length > 0 && remain === 0;
                      const lastRow = li === g.lists.length - 1 && !withAddRow;
                      return (
                        <div key={l.id} onClick={() => props.onOpenList(l.id)} style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderBottom: lastRow ? 'none' : '1px solid rgba(60,60,67,0.08)' }}>
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                            <div style={{ fontSize: 12.5, color: 'rgba(60,60,67,0.55)' }}>{l.cards.length === 0 ? '비어 있음' : `${l.cards.length}문제 · ${l.cards.length - remain} 외움`}</div>
                          </div>
                          {allDone && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#1e9e46', flexShrink: 0 }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1e9e46" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                              <span style={{ fontSize: 12.5, fontWeight: 700 }}>전부 외움</span>
                            </div>
                          )}
                          <svg width="7" height="12" viewBox="0 0 8 14" style={{ flexShrink: 0 }}><path d="M1 1l6 6-6 6" stroke="rgba(60,60,67,0.3)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </div>
                      );
                    })}
                    {withAddRow && (
                      <div onClick={props.onNewList} role="button" aria-label="새 암기장 만들기" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
                        <span style={{ fontSize: 14, fontWeight: 600, color: ACCENT }}>새 암기장</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {showHeaders && (
            <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
              <div onClick={props.onNewList} role="button" aria-label="새 암기장 만들기" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
                <span style={{ fontSize: 14, fontWeight: 600, color: ACCENT }}>새 암기장</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ================================================================ DECK
function DeckView(props: {
  list: ProtoList; state: UIState; dispatch: (p: Patch) => void; weakFirst: (cards: ProtoCard[]) => ProtoCard[];
  lpTimer: React.MutableRefObject<number | undefined>; rowStart: React.MutableRefObject<{ x: number; y: number; moved: boolean }>;
  onHome: () => void; onRename: (name: string) => void; onToggleMem: (card: ProtoCard) => void;
  onDelete: (card: ProtoCard) => void; onEdit: (card: ProtoCard) => void; onMove: (draggedId: string, targetId: string) => void;
  onDeleteList: () => void;
  onStart: (ids: string[]) => void; onOpenSheet: () => void;
  renderTokenChips: (tokens: Token[], ri: number, fontSize: number) => React.ReactNode; toast: (msg: string) => void;
}) {
  const { list, state, dispatch, weakFirst, lpTimer, rowStart } = props;
  const [nameDraft, setNameDraft] = useState(list.name);
  const nameTimer = useRef<number | undefined>(undefined);
  // Row gestures (swipe-delete, long-press reorder) are invisible — explain them
  // once on the first deck visit, then stay quiet.
  const [showGuide] = useState(() => !localStorage.getItem('exam-memorizer-hint-seen'));
  useEffect(() => { try { localStorage.setItem('exam-memorizer-hint-seen', '1'); } catch { /* noop */ } }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setNameDraft(list.name); }, [list.id]);
  const cardsAll = list.cards;
  const filterFn = (c: ProtoCard) => (state.filter === 'done' ? c.memorized : state.filter === 'unknown' ? !c.memorized : true);
  const visible = cardsAll.filter(filterFn);
  const learningCards = weakFirst(visible.filter((c) => !c.memorized));
  const doneCards = visible.filter((c) => c.memorized);
  const studyCards = visible.filter((c) => !c.memorized);
  const deckRemain = cardsAll.filter((c) => !c.memorized).length;
  const deckTotal = cardsAll.length;
  const deckPct = deckTotal ? Math.round(((deckTotal - deckRemain) / deckTotal) * 100) : 0;
  const cntUnknown = cardsAll.filter((c) => !c.memorized).length;
  const cntDone = cardsAll.filter((c) => c.memorized).length;

  const cardGroup = (c: ProtoCard) => (c.memorized ? 'done' : 'learning');

  const segsFor = (c: ProtoCard) => {
    const parts = c.q.split('___');
    const segs: Array<{ text: string; chip: boolean; chipText: string }> = [];
    if (parts.length > 1) {
      parts.forEach((t, i) => {
        segs.push({ text: t, chip: false, chipText: '' });
        if (i < parts.length - 1) segs.push({ text: '', chip: true, chipText: c.a[i] || '' });
      });
    } else {
      segs.push({ text: `${c.q}  `, chip: false, chipText: '' });
      segs.push({ text: '', chip: true, chipText: c.a.join(', ') });
    }
    return segs;
  };

  const rowPointerDown = (c: ProtoCard, isOpen: boolean) => (e: ReactPointerEvent) => {
    rowStart.current = { x: e.clientX, y: e.clientY, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    window.clearTimeout(lpTimer.current);
    lpTimer.current = window.setTimeout(() => {
      if (!rowStart.current.moved) dispatch({ rowDrag: null, reorder: { id: c.id, dy: 0 } });
    }, 350);
    dispatch({ rowDrag: { id: c.id, x: isOpen ? -82 : 0, base: isOpen ? -82 : 0 } });
  };

  const rowPointerMove = (c: ProtoCard) => (e: ReactPointerEvent) => {
    dispatch((st) => {
      const re = st.reorder;
      if (re && re.id === c.id) {
        let overId: string | null = null;
        const els = Array.from(document.querySelectorAll('[data-cid]'));
        for (const r of els) {
          const el = r as HTMLElement;
          if (el.dataset.cid === c.id) continue;
          const b = el.getBoundingClientRect();
          if (e.clientY > b.top && e.clientY < b.bottom) { overId = el.dataset.cid ?? null; break; }
        }
        return { reorder: { ...re, dy: e.clientY - rowStart.current.y, overId } };
      }
      const rd = st.rowDrag;
      if (!rd || rd.id !== c.id) return {};
      const d = e.clientX - rowStart.current.x;
      if (Math.abs(d) > 8 || Math.abs(e.clientY - rowStart.current.y) > 8) rowStart.current.moved = true;
      return { rowDrag: { ...rd, x: Math.max(-110, Math.min(8, rd.base + d)) } };
    });
  };

  const rowPointerUp = (c: ProtoCard, isOpen: boolean) => () => {
    window.clearTimeout(lpTimer.current);
    const re = state.reorder;
    if (re && re.id === c.id) {
      const overId = re.overId;
      dispatch({ reorder: null });
      if (overId) {
        const target = list.cards.find((cc) => cc.id === overId);
        if (target && cardGroup(target) === cardGroup(c)) window.setTimeout(() => props.onMove(c.id, target.id), 0);
        else if (target) props.toast('같은 그룹 안에서만 이동할 수 있어요');
      }
      return;
    }
    dispatch((st) => {
      const rd = st.rowDrag;
      if (!rd || rd.id !== c.id) return {};
      if (!rowStart.current.moved) {
        if (!isOpen) props.onEdit(c);
        return { rowDrag: null, openRowId: null };
      }
      return { rowDrag: null, openRowId: rd.x < -45 ? c.id : null };
    });
  };

  const rows: Array<{ header: true; label: string; dot: string } | { header: false; card: ProtoCard }> = [];
  if (learningCards.length > 0) {
    rows.push({ header: true, label: `외우는 중 ${learningCards.length}`, dot: 'rgba(120,120,128,0.5)' });
    learningCards.forEach((c) => rows.push({ header: false, card: c }));
  }
  if (doneCards.length > 0) {
    rows.push({ header: true, label: `외웠어요 ${doneCards.length}`, dot: '#34c759' });
    doneCards.forEach((c) => rows.push({ header: false, card: c }));
  }

  const startEnabled = deckTotal > 0 && visible.length > 0;
  const startLabel = deckTotal === 0 ? '카드를 먼저 추가하세요'
    : studyCards.length > 0 ? (state.filter === 'unknown' ? `모르는 것 (${studyCards.length})` : `암기 시작 (${studyCards.length})`)
    : visible.length > 0 ? '복습하기' : '카드 없음';

  const chips: Array<{ key: 'all' | 'unknown' | 'done'; label: string }> = [
    { key: 'all', label: `전체 ${cardsAll.length}` },
    { key: 'unknown', label: `외우는 중 ${cntUnknown}` },
    { key: 'done', label: `외웠어요 ${cntDone}` },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, paddingTop: 'env(safe-area-inset-top)' }}>
      <div style={{ padding: '8px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div onClick={props.onHome} style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', marginLeft: -6 }}>
          <svg width="12" height="20" viewBox="0 0 12 20" fill="none"><path d="M10 2L2 10l8 8" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span style={{ fontSize: 17, color: ACCENT }}>홈</span>
        </div>
        <input
          value={nameDraft}
          onChange={(e) => {
            const v = e.target.value;
            setNameDraft(v);
            window.clearTimeout(nameTimer.current);
            nameTimer.current = window.setTimeout(() => props.onRename(v), 600);
          }}
          onBlur={() => {
            window.clearTimeout(nameTimer.current);
            if (nameDraft !== list.name) props.onRename(nameDraft);
          }}
          style={{ width: 150, textAlign: 'center', fontSize: 16, fontWeight: 700, border: 'none', background: 'transparent', color: '#000', padding: '4px 0', borderRadius: 8 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', marginRight: -6 }}>
          <div
            onClick={() => {
              const next = !state.shuffle;
              dispatch({ shuffle: next });
              props.toast(next ? '섞기 켬 — 순서를 무작위로' : '섞기 끔 — 헷갈린 카드부터');
            }}
            role="button" aria-label="섞기" aria-pressed={state.shuffle} title="섞기"
            style={{ width: 40, height: 40, borderRadius: 12, background: state.shuffle ? 'rgba(0,122,255,0.14)' : 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={state.shuffle ? ACCENT : 'rgba(60,60,67,0.5)'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" /><path d="m18 2 4 4-4 4" /><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" /><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" /><path d="m18 14 4 4-4 4" /></svg>
          </div>
          {!list.synthetic && (
            <div onClick={props.onDeleteList} role="button" aria-label="목록 삭제" title="목록 삭제" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '0 20px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(120,120,128,0.16)', overflow: 'hidden' }}>
          <div style={{ width: `${deckPct}%`, height: '100%', background: '#34c759' }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(60,60,67,0.6)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{deckTotal === 0 ? '0문제' : `${deckTotal - deckRemain}/${deckTotal} 외움`}</span>
      </div>

      <div style={{ margin: '0 16px 4px', display: 'flex', padding: 2, borderRadius: 9, background: 'rgba(120,120,128,0.12)' }}>
        {chips.map((chip) => {
          const active = state.filter === chip.key;
          return (
            <div key={chip.key} onClick={() => dispatch({ filter: chip.key, openRowId: null })} style={{ flex: 1, height: 30, borderRadius: 7, display: 'grid', placeItems: 'center', background: active ? '#fff' : 'transparent', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', cursor: 'pointer', transition: 'background 0.15s' }}>
              <span style={{ fontSize: 12.5, fontWeight: active ? 700 : 600, color: active ? '#1d1d1f' : 'rgba(60,60,67,0.55)' }}>{chip.label}</span>
            </div>
          );
        })}
      </div>

      {deckTotal > 0 && showGuide && (
        <div style={{ padding: '4px 20px 4px', color: 'rgba(60,60,67,0.5)', fontSize: 11.5, fontWeight: 500, lineHeight: 1.45 }}>
          {IS_PC ? '클릭하면 수정 · 왼쪽으로 끌면 삭제 · 길게 누르면 순서 변경' : '탭하면 수정 · 왼쪽으로 밀면 삭제 · 길게 누르면 순서 변경'}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 16px 130px', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {deckTotal === 0 && (
          <div style={{ padding: '38px 20px', textAlign: 'center', color: 'rgba(60,60,67,0.58)', fontSize: 15, lineHeight: 1.6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div>아직 카드가 없어요.<br />시험에 나올 문장 하나부터 넣어보세요.</div>
            <EmptyStateAction label="첫 카드 추가" onClick={props.onOpenSheet} />
          </div>
        )}
        {rows.map((row, idx) => {
          if (row.header) {
            return (
              <div key={`h${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '14px 6px 6px' }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: row.dot }} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(60,60,67,0.55)', letterSpacing: '0.02em' }}>{row.label}</span>
              </div>
            );
          }
          const c = row.card;
          const isOpen = state.openRowId === c.id;
          const isDragging = state.rowDrag && state.rowDrag.id === c.id;
          const isRe = state.reorder && state.reorder.id === c.id;
          const x = isDragging ? state.rowDrag!.x : (isOpen ? -82 : 0);
          const dropActive = !!(state.reorder && state.reorder.id !== c.id && state.reorder.overId === c.id);
          // grouped list: round only the first/last row of each contiguous run
          const firstInGroup = idx === 0 || rows[idx - 1].header;
          const lastInGroup = idx === rows.length - 1 || rows[idx + 1].header;
          const radius = `${firstInGroup ? 12 : 0}px ${firstInGroup ? 12 : 0}px ${lastInGroup ? 12 : 0}px ${lastInGroup ? 12 : 0}px`;
          return (
            <div key={c.id} data-cid={c.id} style={{ position: 'relative', borderRadius: radius, overflow: 'hidden', flexShrink: 0, transform: isRe ? `translateY(${state.reorder!.dy}px) scale(1.02)` : 'none', transition: isRe ? 'none' : 'transform 0.2s cubic-bezier(0.3,0.9,0.4,1), margin 0.16s ease', zIndex: isRe ? 10 : 'auto', boxShadow: isRe ? '0 12px 28px rgba(0,0,0,0.18)' : 'none', opacity: isRe ? 0.9 : 1, marginTop: dropActive ? 12 : 0 }}>
              {dropActive && <div style={{ position: 'absolute', top: -7, left: 8, right: 8, height: 3, borderRadius: 2, background: ACCENT, zIndex: 11 }} />}
              <div onClick={() => props.onDelete(c)} style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 82, background: '#ff3b30', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <span style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>삭제</span>
              </div>
              <div onPointerDown={rowPointerDown(c, isOpen)} onPointerMove={rowPointerMove(c)} onPointerUp={rowPointerUp(c, isOpen)} style={{ padding: '11px 14px', background: '#fff', display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', transform: `translateX(${x}px)`, transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.3,0.9,0.4,1)', touchAction: 'pan-y', boxShadow: lastInGroup ? 'none' : 'inset 0 -1px 0 rgba(60,60,67,0.08)' }}>
                <div style={{ flex: 1, fontSize: 15, fontWeight: 600, lineHeight: 1.6, wordBreak: 'keep-all', minWidth: 0, pointerEvents: 'none', opacity: c.memorized ? 0.55 : 1, whiteSpace: 'pre-line' }}>
                  {segsFor(c).map((seg, i) => (
                    <span key={i}>
                      <span>{seg.text}</span>
                      {seg.chip && <span style={{ color: ACCENT_DEEP, fontWeight: 700, margin: '0 2px' }}>{seg.chipText}</span>}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, paddingTop: 2, pointerEvents: 'none' }}>
                  <div onClick={(e) => { e.stopPropagation(); props.onToggleMem(c); }} onPointerDown={(e) => e.stopPropagation()} role="button" aria-label={c.memorized ? '외움 취소' : '외웠다고 표시'} title={c.memorized ? '외움 취소' : '외웠다고 표시'} style={{ pointerEvents: 'auto', width: 32, height: 32, margin: '-6px -6px -6px 0', display: 'grid', placeItems: 'center', cursor: 'pointer', borderRadius: 999 }}>
                    {c.memorized ? (
                      <div style={{ width: 20, height: 20, borderRadius: 999, background: '#34c759', display: 'grid', placeItems: 'center' }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      </div>
                    ) : (
                      <div style={{ width: 20, height: 20, borderRadius: 999, border: '1.5px solid rgba(120,120,128,0.35)', boxSizing: 'border-box' }} />
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(env(safe-area-inset-bottom) + 20px)', background: 'linear-gradient(180deg,rgba(242,242,247,0) 0%,#F2F2F7 32%)', display: 'flex', gap: 10 }}>
        <div onClick={props.onOpenSheet} style={{ height: 50, padding: '0 18px', borderRadius: 12, background: '#fff', border: '1px solid rgba(60,60,67,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1d1d1f" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>추가</span>
        </div>
        <div
          onClick={() => {
            if (studyCards.length > 0) props.onStart(weakFirst(studyCards).map((c) => c.id));
            else if (visible.length > 0) props.onStart(visible.map((c) => c.id));
            else props.toast('외울 카드가 없어요');
          }}
          style={{ flex: 1, height: 50, borderRadius: 12, background: startEnabled ? ACCENT : 'rgba(120,120,128,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}
        >
          <svg width="13" height="15" viewBox="0 0 16 18"><path d="M2 1.5v15l13-7.5z" fill={startEnabled ? '#fff' : 'rgba(60,60,67,0.35)'} /></svg>
          <span style={{ fontSize: 15.5, fontWeight: 700, color: startEnabled ? '#fff' : 'rgba(60,60,67,0.35)' }}>{startLabel}</span>
        </div>
      </div>
    </div>
  );
}

// ================================================================ STUDY
function StudyView(props: {
  list: ProtoList | undefined; state: UIState; dispatch: (p: Patch) => void;
  swipeStart: React.MutableRefObject<{ x: number; moved: boolean }>;
  onCommitSwipe: (dir: number) => void; onKnown: () => void; onAgain: () => void;
  onDeck: () => void; onRetryRemaining: () => void; onReviewAll: () => void;
}) {
  const { list, state, dispatch, swipeStart } = props;
  const card = list && state.queue.length > 0 ? list.cards.find((c) => c.id === state.queue[0]) : undefined;
  const qParts = card ? card.q.split('___') : [];
  const nBlanks = card ? (qParts.length > 1 ? qParts.length - 1 : 1) : 0;
  const isCloze = !!card && qParts.length > 1;
  let nextIdx = -1;
  for (let i = 0; i < nBlanks; i += 1) { if (!state.revealedIdx.includes(i)) { nextIdx = i; break; } }
  const allRevealed = !!card && nextIdx === -1;
  const dx = state.dragX;

  const revealNext = () => { if (nextIdx >= 0) dispatch((st) => ({ revealedIdx: [...st.revealedIdx, nextIdx] })); };

  // PC keyboard: Space/Enter reveal (then judge as known), arrows judge, Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'Escape') { props.onDeck(); return; }
      if (!card) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (nextIdx >= 0) revealNext();
        else props.onCommitSwipe(1);
        return;
      }
      if (e.key === 'ArrowRight') { e.preventDefault(); props.onCommitSwipe(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); props.onCommitSwipe(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!card) {
    const deckRemain = list ? list.cards.filter((c) => !c.memorized).length : 0;
    const deckTotal = list ? list.cards.length : 0;
    const allMemorized = !!list && deckRemain === 0 && deckTotal > 0;
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, paddingTop: 'env(safe-area-inset-top)', background: '#fff' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '0 32px 100px' }}>
          <div style={{ width: 88, height: 88, borderRadius: 999, background: 'rgba(52,199,89,0.14)', display: 'grid', placeItems: 'center', animation: 'popIn 0.4s cubic-bezier(0.3,1.4,0.4,1)' }}>
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#1e9e46" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em' }}>{state.review ? '복습 끝!' : '오늘 목표 달성!'}</div>
            <div style={{ fontSize: 15, color: 'rgba(60,60,67,0.6)', textAlign: 'center', lineHeight: 1.5 }}>
              {list ? (deckRemain === 0 ? `"${list.name}" 전부 외웠어요` : `${state.sessionTotal}장 확인 완료 · 안 외운 카드 ${deckRemain}장 남음`) : ''}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 10 }}>
            {deckRemain > 0 && (
              <div onClick={props.onRetryRemaining} style={{ height: 50, borderRadius: 12, background: ACCENT, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <span style={{ fontSize: 15.5, fontWeight: 700, color: '#fff' }}>안 외운 {deckRemain}장 다시</span>
              </div>
            )}
            {allMemorized && (
              <div onClick={props.onReviewAll} style={{ height: 50, borderRadius: 12, background: 'rgba(120,120,128,0.16)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <span style={{ fontSize: 15.5, fontWeight: 700, color: '#48484a' }}>처음부터 복습</span>
              </div>
            )}
            <div onClick={props.onDeck} style={{ height: 50, borderRadius: 12, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <span style={{ fontSize: 15.5, fontWeight: 600, color: 'rgba(60,60,67,0.6)' }}>목록으로</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const cardSegs: Array<{ text: string; kind: 'text' | 'next' | 'waiting' | 'revealed'; answer: string }> = [];
  if (isCloze) {
    qParts.forEach((t, i) => {
      cardSegs.push({ text: t, kind: 'text', answer: '' });
      if (i < qParts.length - 1) {
        const kind = state.revealedIdx.includes(i) ? 'revealed' : i === nextIdx ? 'next' : 'waiting';
        cardSegs.push({ text: '', kind, answer: card.a[i] || '' });
      }
    });
  }

  const progressPct = state.sessionTotal ? Math.round((state.sessionDone / state.sessionTotal) * 100) : 0;
  const cardBadge = isCloze ? (nBlanks > 1 ? `빈칸 ${nBlanks}개` : '빈칸') : '문답';
  const tapHint = isCloze && nBlanks > 1
    ? `카드를 탭하면 빈칸이 하나씩 열려요 (${Math.min(state.revealedIdx.length + 1, nBlanks)}/${nBlanks})`
    : '카드를 탭하면 답이 보여요';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, paddingTop: 'env(safe-area-inset-top)', background: '#fff' }}>
      <div style={{ padding: '14px 20px 0', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div onClick={props.onDeck} role="button" aria-label="닫기" title="닫기" style={{ width: 32, height: 32, marginLeft: -8, borderRadius: 999, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.6)" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </div>
        <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(120,120,128,0.16)', overflow: 'hidden' }}>
          <div style={{ width: `${progressPct}%`, height: '100%', borderRadius: 2, background: ACCENT, transition: 'width 0.35s cubic-bezier(0.3,0.9,0.4,1)' }} />
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(60,60,67,0.6)', fontVariantNumeric: 'tabular-nums' }}>{Math.min(state.sessionDone + 1, state.sessionTotal)}/{state.sessionTotal}</span>
      </div>

      <div style={{ position: 'absolute', top: 120, left: 24, padding: '9px 16px', borderRadius: 14, background: 'rgba(255,149,0,0.92)', color: '#fff', fontSize: 15, fontWeight: 800, transform: 'rotate(-8deg)', opacity: Math.min(Math.max(-dx / 110, 0), 1), transition: 'opacity 0.1s', zIndex: 5, pointerEvents: 'none' }}>다시 볼래요</div>
      <div style={{ position: 'absolute', top: 120, right: 24, padding: '9px 16px', borderRadius: 14, background: '#34c759', color: '#fff', fontSize: 15, fontWeight: 800, transform: 'rotate(8deg)', opacity: Math.min(Math.max(dx / 110, 0), 1), transition: 'opacity 0.1s', zIndex: 5, pointerEvents: 'none' }}>외웠어요 ✓</div>

      <div
        key={`${card.id}-${state.sessionDone}-${state.queue.length}`}
        onPointerDown={(e) => { swipeStart.current = { x: e.clientX, moved: false }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ } dispatch({ dragging: true }); }}
        onPointerMove={(e) => { if (!state.dragging) return; const d = e.clientX - swipeStart.current.x; if (Math.abs(d) > 8) swipeStart.current.moved = true; dispatch({ dragX: d }); }}
        onPointerUp={() => {
          if (!state.dragging) return;
          const d = state.dragX;
          if (!swipeStart.current.moved) { dispatch({ dragging: false, dragX: 0 }); revealNext(); return; }
          if (d > 90) props.onCommitSwipe(1);
          else if (d < -90) props.onCommitSwipe(-1);
          else dispatch({ dragging: false, dragX: 0 });
        }}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, animation: 'cardIn 0.3s cubic-bezier(0.3,0.9,0.4,1)', transform: `translateX(${dx}px) rotate(${(dx * 0.035).toFixed(2)}deg)`, transition: state.dragging || state.snap ? 'none' : 'transform 0.25s cubic-bezier(0.3,0.9,0.4,1)', touchAction: 'pan-y', cursor: 'pointer' }}
      >
        <div style={{ padding: '26px 24px 0', display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(60,60,67,0.5)', letterSpacing: '0.03em' }}>{cardBadge}{list ? ` · ${list.name}` : ''}</div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 26, padding: '14px 24px 150px', minHeight: 0, overflowY: 'auto' }}>
          {!isCloze ? (
            <>
              <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.015em', lineHeight: 1.4, wordBreak: 'keep-all', whiteSpace: 'pre-line' }}>{card.q}</div>
              {!allRevealed ? (
                <div style={{ height: 42, borderRadius: 10, background: 'rgba(0,122,255,0.16)', width: `${Math.max(7, Math.min(card.a.join(', ').length + 1, 18))}em`, maxWidth: '100%', fontSize: 16 }} />
              ) : (
                <div style={{ borderLeft: `3px solid ${ACCENT}`, padding: '2px 0 2px 14px', animation: 'popIn 0.22s cubic-bezier(0.3,1.2,0.4,1)' }}>
                  <span style={{ fontSize: 21, fontWeight: 700, color: '#1d1d1f', wordBreak: 'keep-all', lineHeight: 1.45, whiteSpace: 'pre-line' }}>{card.a.join(', ')}</span>
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 2, wordBreak: 'keep-all', whiteSpace: 'pre-line' }}>
              {cardSegs.map((seg, i) => (
                <span key={i}>
                  <span>{seg.text}</span>
                  {seg.kind === 'next' && (
                    <span style={{ display: 'inline-block', minWidth: 68, height: 36, padding: '0 14px', borderRadius: 8, background: 'rgba(0,122,255,0.16)', verticalAlign: 'middle', margin: '0 3px' }} />
                  )}
                  {seg.kind === 'waiting' && (
                    <span style={{ display: 'inline-block', minWidth: 68, height: 36, padding: '0 14px', borderRadius: 8, background: 'rgba(120,120,128,0.12)', verticalAlign: 'middle', margin: '0 3px' }} />
                  )}
                  {seg.kind === 'revealed' && (
                    <span style={{ display: 'inline-block', padding: '0 2px', borderBottom: `2px solid ${ACCENT}`, color: ACCENT_DEEP, fontWeight: 800, margin: '0 3px', animation: 'popIn 0.22s cubic-bezier(0.3,1.2,0.4,1)' }}>{seg.answer}</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '16px 20px 44px', background: 'linear-gradient(180deg,rgba(255,255,255,0) 0%,#fff 30%)', pointerEvents: 'none' }}>
        {!allRevealed ? (
          <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(60,60,67,0.5)', fontWeight: 500, lineHeight: 1.6 }}>
            {IS_PC ? '스페이스를 누르면 답이 보여요' : tapHint}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
            <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(60,60,67,0.5)', fontWeight: 500 }}>{IS_PC ? '← 다시 볼래요 · 외웠어요 →' : '옆으로 밀어서 분류할 수도 있어요'}</div>
            <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, pointerEvents: 'auto' }}>
              <button type="button" className="study-judge-button" onClick={props.onAgain} aria-label="다시 볼래요" title="다시 볼래요" style={{ flex: 1, height: 50, padding: '0 16px', borderRadius: 12, border: 'none', background: 'rgba(255,149,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#8a4d00' }}>다시 볼래요</span>
              </button>
              <button type="button" className="study-judge-button" onClick={props.onKnown} aria-label="외웠어요" title="외웠어요" style={{ flex: 1, height: 50, padding: '0 16px', borderRadius: 12, border: 'none', background: 'rgba(52,199,89,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#116b2d' }}>외웠어요</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ================================================================ ADD SHEET
function AddSheet(props: {
  list: ProtoList; state: UIState; dispatch: (p: Patch) => void;
  storedCardsOf: (deckId: string, sectionId: string) => Card[];
  commitSection: (deckId: string, sectionId: string, cards: OptimisticNewCard[]) => void;
  renderTokenChips: (tokens: Token[], ri: number, fontSize: number) => React.ReactNode;
  toast: (msg: string) => void; commitSelection: () => void;
}) {
  const { list, state, dispatch } = props;

  const setTypeCloze = () => {
    if (state.typeMode === 'cloze') return;
    const patch: Partial<UIState> = { typeMode: 'cloze' };
    if (state.typeQ.trim() || state.typeA.trim()) {
      const text = (state.typeQ.trim() + (state.typeA.trim() ? ' ' + state.typeA.trim() : '')).trim();
      let toks = tokenizeText(text);
      if (state.typeA.trim()) {
        const aWords = new Set(state.typeA.split(/[,\s]+/).map((w) => w.trim()).filter(Boolean));
        let g = 8000;
        toks = toks.map((t) => (!t.nl && aWords.has(t.word) ? { ...t, hidden: true, gid: g++ } : t));
      }
      patch.typeText = text; patch.typeTokens = toks;
    }
    dispatch(patch);
  };
  const setTypeQA = () => {
    if (state.typeMode === 'qa') return;
    const patch: Partial<UIState> = { typeMode: 'qa' };
    if (state.typeText.trim()) {
      const ans = state.typeTokens.filter((t) => t.hidden).map((t) => t.word);
      const vis = tokensToText(state.typeTokens.filter((t) => !t.hidden || t.nl));
      patch.typeQ = vis || state.typeText.trim();
      if (ans.length) patch.typeA = ans.join(', ');
    }
    dispatch(patch);
  };
  const onTypeText = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    const hiddenWords = new Set(state.typeTokens.filter((t) => t.hidden).map((t) => t.word));
    let g = 7000;
    const tokens = tokenizeText(text).map((t) => (!t.nl && hiddenWords.has(t.word) ? { ...t, hidden: true, gid: g++ } : t));
    dispatch({ typeText: text, typeTokens: tokens });
  };
  const typeCanAdd = state.typeMode === 'qa' ? !!(state.typeQ.trim() && state.typeA.trim()) : state.typeTokens.some((t) => t.hidden);
  const typeAdd = () => {
    let q: string; let a: string[];
    if (state.typeMode === 'qa') {
      q = state.typeQ.trim(); a = state.typeA.split(',').map((x) => x.trim()).filter(Boolean);
      if (!q || a.length === 0) { props.toast('질문과 답을 입력하세요'); return; }
    } else {
      if (!state.typeTokens.some((t) => t.hidden)) { props.toast('가릴 단어를 탭하세요'); return; }
      const r = tokensToCard(state.typeTokens); q = r.q; a = r.a;
    }
    const stored = props.storedCardsOf(list.deckId, list.id);
    props.commitSection(list.deckId, list.id, [...stored.map((c) => keepCard(c)), qaToNewCard(q, a, false)]);
    dispatch((st) => ({ typeAdded: st.typeAdded + 1, typeQ: '', typeA: '', typeText: '', typeTokens: [] }));
    props.toast('추가했어요');
  };

  const onPaste = (e: ChangeEvent<HTMLTextAreaElement>) => dispatch({ pasteText: e.target.value, sheetRows: parsePaste(e.target.value, state.pasteMode), rowSel: null });

  const rs = state.rowSel;
  const rsLo = rs ? Math.min(rs.a, rs.b) : -1;
  const rsHi = rs ? Math.max(rs.a, rs.b) : -1;
  const rowSelCount = rs ? rsHi - rsLo + 1 : 0;
  const validRows = state.sheetRows.filter((r) => r.kind === 'qa' || r.tokens.some((t) => t.hidden));
  const incompleteRows = state.sheetRows.filter((r) => r.kind === 'tokens' && !r.tokens.some((t) => t.hidden)).length;

  const mergeRowSel = () => {
    if (rowSelCount <= 1) return;
    dispatch((st) => {
      const rows = [...st.sheetRows];
      if (rsLo < 0 || rsHi >= rows.length || rsLo >= rsHi) return { rowSel: null };
      const toToks = (r: Row, g: number): Token[] => (r.kind === 'tokens' ? r.tokens : [
        ...tokenizeText(r.q),
        { word: ':', tail: '', hidden: false, gid: 0 },
        ...tokenizeText(r.a).map((t) => (t.nl ? t : { ...t, hidden: true, gid: g })),
      ]);
      const tokens: Token[] = [];
      for (let i = rsLo; i <= rsHi; i += 1) {
        if (i > rsLo) tokens.push({ nl: true, word: '', tail: '', hidden: false, gid: 0 });
        tokens.push(...toToks(rows[i], 9000 + i * 3));
      }
      rows.splice(rsLo, rsHi - rsLo + 1, { kind: 'tokens', tokens });
      return { sheetRows: rows, rowSel: null };
    });
    props.toast(`${rowSelCount}줄을 한 문제로 묶었어요`);
  };

  const addParsed = () => {
    if (validRows.length === 0) return;
    const newCards = validRows.map((r) => {
      if (r.kind === 'qa') return qaToNewCard(r.q, [r.a], false);
      const { q, a } = tokensToCard(r.tokens);
      return qaToNewCard(q, a, false);
    });
    const stored = props.storedCardsOf(list.deckId, list.id);
    props.commitSection(list.deckId, list.id, [...stored.map((c) => keepCard(c)), ...newCards]);
    dispatch({ sheetOpen: false, pasteText: '', sheetRows: [] });
    props.toast(`${newCards.length}문제를 추가했어요`);
  };

  const seg = (active: boolean) => ({ background: active ? '#fff' : 'transparent', color: active ? '#1d1d1f' : 'rgba(60,60,67,0.5)' });
  const chip = (active: boolean) => ({ background: active ? ACCENT : 'rgba(120,120,128,0.12)', color: active ? '#fff' : '#48484a' });

  return (
    <>
      <div onClick={() => dispatch({ sheetOpen: false })} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)', zIndex: 15 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: '20px 20px 0 0', background: '#fff', padding: '18px 20px 42px', display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 -12px 40px rgba(0,0,0,0.16)', animation: 'sheetUp 0.32s cubic-bezier(0.3,0.9,0.4,1)', maxHeight: '82%', zIndex: 16 }}>
        <div style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(120,120,128,0.25)', alignSelf: 'center', flexShrink: 0 }} />
        <div onClick={() => dispatch({ sheetOpen: false })} style={{ position: 'absolute', top: 12, right: 14, padding: '8px 12px', borderRadius: 12, cursor: 'pointer', zIndex: 1 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: ACCENT }}>완료</span>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 10, background: 'rgba(120,120,128,0.1)', flexShrink: 0 }}>
          <div onClick={() => dispatch({ addTab: 'type' })} style={{ flex: 1, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'background 0.15s', ...seg(state.addTab === 'type') }}><span style={{ fontSize: 15, fontWeight: 700 }}>직접 쓰기</span></div>
          <div onClick={() => dispatch({ addTab: 'paste' })} style={{ flex: 1, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'background 0.15s', ...seg(state.addTab === 'paste') }}><span style={{ fontSize: 15, fontWeight: 700 }}>붙여넣기</span></div>
        </div>

        {state.addTab === 'type' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <div onClick={setTypeCloze} style={{ padding: '7px 14px', borderRadius: 9, cursor: 'pointer', ...chip(state.typeMode === 'cloze') }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>빈칸형</span></div>
                <div onClick={setTypeQA} style={{ padding: '7px 14px', borderRadius: 9, cursor: 'pointer', ...chip(state.typeMode === 'qa') }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>문답형</span></div>
              </div>
              <div style={{ fontSize: 12.5, color: 'rgba(60,60,67,0.55)', fontWeight: 600, flexShrink: 0, marginTop: -4 }}>
                {state.typeMode === 'cloze' ? '문장을 쓰고, 시험에서 가릴 단어만 탭하면 돼요' : '질문을 보고 답을 떠올리는 카드예요'}
              </div>
              {state.typeMode === 'qa' ? (
                <div style={{ padding: '14px 16px', borderRadius: 12, background: '#F7F7F9', display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(60,60,67,0.45)', letterSpacing: '0.03em' }}>질문</span>
                    <textarea rows={2} value={state.typeQ} onChange={(e) => dispatch({ typeQ: e.target.value })} placeholder="예: 대통령 임기" style={{ fontSize: 17, fontWeight: 600, border: 'none', background: 'transparent', color: '#000', padding: '2px 0', resize: 'none', lineHeight: 1.5 }} />
                  </div>
                  <div style={{ height: 0.5, background: 'rgba(60,60,67,0.12)' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: ACCENT, opacity: 0.75, letterSpacing: '0.03em' }}>답 (가려짐)</span>
                    <input value={state.typeA} onChange={(e) => dispatch({ typeA: e.target.value })} placeholder="예: 5년" style={{ fontSize: 17, fontWeight: 600, border: 'none', background: 'transparent', color: ACCENT_DEEP, padding: '2px 0' }} />
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ padding: '14px 16px', borderRadius: 12, background: '#F7F7F9', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(60,60,67,0.45)', letterSpacing: '0.03em' }}>문장 (여러 줄도 한 카드)</span>
                    <textarea rows={3} value={state.typeText} onChange={onTypeText} placeholder={'예: 커피의 종류\n1. 아메리카노 : 맛이 아주 쓰다'} style={{ fontSize: 16.5, fontWeight: 600, border: 'none', background: 'transparent', color: '#000', padding: '2px 0', resize: 'none', lineHeight: 1.5 }} />
                  </div>
                  {state.typeTokens.length > 0 && (
                    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(120,120,128,0.08)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 2px', lineHeight: 1.9 }}>
                      {props.renderTokenChips(state.typeTokens, -200, 15)}
                      {state.typeTokens.some((t) => t.hidden) ? (
                        <span style={{ width: '100%', fontSize: 12.5, color: '#1e9e46', fontWeight: 700, marginTop: 4 }}>
                          시험 화면: {tokensToCard(state.typeTokens).q.replace(/\n/g, ' / ')}
                        </span>
                      ) : (
                        <span style={{ width: '100%', fontSize: 12.5, color: ACCENT_DEEP, fontWeight: 700, marginTop: 2 }}>가릴 단어를 탭하세요 · 누른 채 끌면 여러 단어가 한 빈칸이 돼요</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div style={{ textAlign: 'center', fontSize: 12.5, color: 'rgba(60,60,67,0.45)', fontWeight: 600, flexShrink: 0 }}>{state.typeAdded > 0 ? `이 목록에 ${state.typeAdded}개 추가됨 — 다 쓰셨으면 오른쪽 위 '완료'` : '입력하면 목록에 한 장씩 쌓여요'}</div>
            <div onClick={typeAdd} style={{ height: 50, borderRadius: 12, background: typeCanAdd ? ACCENT : 'rgba(120,120,128,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', flexShrink: 0, transition: 'background 0.2s' }}>
              {typeCanAdd && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>}
              <span style={{ fontSize: 17, fontWeight: 700, color: typeCanAdd ? '#fff' : 'rgba(60,60,67,0.4)' }}>
                {typeCanAdd ? '추가하고 계속'
                  : state.typeMode === 'cloze' && state.typeText.trim() ? '위에서 가릴 단어를 탭하세요'
                  : state.typeMode === 'cloze' ? '문장을 입력하세요'
                  : '질문과 답을 입력하세요'}
              </span>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13.5, color: 'rgba(60,60,67,0.6)', lineHeight: 1.5, flexShrink: 0 }}>붙여넣으면 줄마다 한 문제. <strong style={{ color: '#1d1d1f' }}>가릴 단어는 탭</strong>(끌면 여러 단어), <strong style={{ color: '#1d1d1f' }}>줄을 세로로 쓸면</strong> 여러 줄을 한 문제로 묶어요</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'rgba(60,60,67,0.45)' }}>나누기</span>
              <div onClick={() => dispatch((st) => ({ pasteMode: 'auto', sheetRows: parsePaste(st.pasteText, 'auto'), rowSel: null }))} style={{ padding: '7px 13px', borderRadius: 9, cursor: 'pointer', ...chip(state.pasteMode === 'auto') }}><span style={{ fontSize: 13, fontWeight: 700 }}>자동 (줄·빈 줄)</span></div>
              <div onClick={() => dispatch((st) => ({ pasteMode: 'one', sheetRows: parsePaste(st.pasteText, 'one'), rowSel: null }))} style={{ padding: '7px 13px', borderRadius: 9, cursor: 'pointer', ...chip(state.pasteMode === 'one') }}><span style={{ fontSize: 13, fontWeight: 700 }}>전체를 한 문제로</span></div>
            </div>
            <textarea rows={4} value={state.pasteText} onChange={onPaste} placeholder={'예시)\n헌법 개정 의결: 국회 재적 2/3 찬성'} style={{ border: '1px solid rgba(60,60,67,0.18)', borderRadius: 11, padding: '12px 14px', fontSize: 15.5, lineHeight: 1.6, resize: 'none', background: '#F7F7F9', color: '#000', flexShrink: 0 }} />
            {state.sheetRows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, overflowY: 'auto', minHeight: 0 }}>
                {state.sheetRows.map((r, ri) => {
                  const inRowSel = !!rs && ri >= rsLo && ri <= rsHi;
                  const common = {
                    background: inRowSel ? 'rgba(0,122,255,0.1)' : 'rgba(120,120,128,0.08)',
                    border: inRowSel ? `2px solid ${ACCENT}` : '2px solid transparent',
                  };
                  const onRowDown = () => {
                    if (state.rowSel && !state.rowSelDragging) {
                      const lo = Math.min(state.rowSel.a, state.rowSel.b), hi = Math.max(state.rowSel.a, state.rowSel.b);
                      if (ri >= lo && ri <= hi) { dispatch({ rowSel: null }); return; }
                    }
                    dispatch({ rowSelDragging: true, rowSel: { a: ri, b: ri } });
                  };
                  const onRowEnter = () => dispatch((st) => (st.rowSelDragging ? { rowSel: { a: st.rowSel!.a, b: ri } } : {}));
                  if (r.kind === 'qa') {
                    return (
                      <div key={ri} onPointerDown={onRowDown} onPointerEnter={onRowEnter} style={{ padding: '9px 12px', borderRadius: 10, ...common, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, touchAction: 'pan-y', transition: 'background 0.12s' }}>
                        <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, lineHeight: 1.45, wordBreak: 'keep-all', pointerEvents: 'none' }}>{r.q}</span>
                        <span style={{ fontSize: 14.5, fontWeight: 700, color: ACCENT_DEEP, flexShrink: 0, pointerEvents: 'none' }}>{r.a}</span>
                      </div>
                    );
                  }
                  const needsTap = !r.tokens.some((t) => t.hidden) && !(state.sel && state.sel.ri === ri) && !rs;
                  return (
                    <div key={ri} onPointerDown={onRowDown} onPointerEnter={onRowEnter} style={{ padding: '9px 12px', borderRadius: 10, ...common, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 2px', flexShrink: 0, lineHeight: 1.9, touchAction: 'pan-y', transition: 'background 0.12s' }}>
                      {props.renderTokenChips(r.tokens, ri, 14.5)}
                      {needsTap && <span style={{ width: '100%', fontSize: 12.5, color: ACCENT_DEEP, fontWeight: 700, marginTop: 2 }}>가릴 단어를 탭하세요 · 누른 채 끌면 여러 단어가 한 빈칸이 돼요</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {rowSelCount > 1 && (
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: ACCENT_SOFT }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: ACCENT_DEEP }}>{rowSelCount}줄 선택됨 · 다시 누르면 해제</span>
                <div onClick={mergeRowSel} style={{ height: 38, padding: '0 16px', borderRadius: 9, background: ACCENT, display: 'flex', alignItems: 'center', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>한 문제로 묶기</div>
              </div>
            )}
            {incompleteRows > 0 && (
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,149,0,0.12)' }}>
                <TriangleAlert size={17} strokeWidth={2.2} color="#a85b00" aria-hidden="true" />
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: '#c26a00', lineHeight: 1.4 }}>{incompleteRows}줄은 가릴 단어를 안 정해서 빠져요 — 위에서 단어를 탭하세요</span>
              </div>
            )}
            {state.sheetRows.length > 0 && (
              <div style={{ flexShrink: 0, textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: validRows.length > 0 ? 'rgba(60,60,67,0.66)' : 'rgba(60,60,67,0.5)' }}>
                {validRows.length > 0
                  ? incompleteRows > 0
                    ? `${validRows.length}문제 추가 예정 · ${incompleteRows}줄 제외`
                    : `${validRows.length}문제 추가 예정`
                  : '가릴 단어를 정하면 추가할 수 있어요'}
              </div>
            )}
            <div onClick={addParsed} style={{ height: 50, borderRadius: 12, background: validRows.length > 0 ? ACCENT : 'rgba(120,120,128,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, transition: 'background 0.2s' }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: validRows.length > 0 ? '#fff' : 'rgba(60,60,67,0.4)' }}>{validRows.length > 0 ? `${validRows.length}문제 추가` : state.sheetRows.length > 0 ? '가릴 단어를 탭하면 문제가 돼요' : '내용을 쓰면 문제를 찾아드려요'}</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ================================================================ EDIT SHEET
function EditSheet(props: {
  list: ProtoList; state: UIState; dispatch: (p: Patch) => void;
  saveEditFrom: (st: UIState, close: boolean) => boolean;
  renderTokenChips: (tokens: Token[], ri: number, fontSize: number) => React.ReactNode;
  onDelete: () => void; openEditFor: (card: ProtoCard) => void;
}) {
  const { list, state, dispatch } = props;
  const cardsAll = list.cards;
  const idx = state.editIdx ?? -1;

  const onEditText = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    const hiddenWords = new Set(state.editTokens.filter((t) => t.hidden).map((t) => t.word));
    let g = 5000;
    const tokens = tokenizeText(text).map((t) => (!t.nl && hiddenWords.has(t.word) ? { ...t, hidden: true, gid: g++ } : t));
    dispatch({ editText: text, editTokens: tokens });
  };
  const setQA = () => {
    if (state.editMode === 'qa') return;
    const ans = state.editTokens.filter((t) => t.hidden).map((t) => t.word);
    const vis = tokensToText(state.editTokens.filter((t) => !t.hidden || t.nl));
    dispatch({ editMode: 'qa', editQ: vis || state.editText.trim(), editA: ans.join(', ') });
  };
  const setCloze = () => {
    if (state.editMode === 'tokens') return;
    const text = (state.editQ.trim() + (state.editA.trim() ? ' ' + state.editA.trim() : '')).trim();
    let toks = tokenizeText(text);
    if (state.editA.trim()) {
      const aWords = new Set(state.editA.split(/[,\s]+/).map((w) => w.trim()).filter(Boolean));
      let g = 8100;
      toks = toks.map((t) => (!t.nl && aWords.has(t.word) ? { ...t, hidden: true, gid: g++ } : t));
    }
    dispatch({ editMode: 'tokens', editText: text, editTokens: toks });
  };
  const goPrev = () => { if (idx > 0) { props.saveEditFrom(state, false); props.openEditFor(cardsAll[idx - 1]); } };
  const goNext = () => { if (idx >= 0 && idx < cardsAll.length - 1) { props.saveEditFrom(state, false); props.openEditFor(cardsAll[idx + 1]); } };
  const save = () => { if (props.saveEditFrom(state, true)) dispatch({ editSheetOpen: false }); };

  const chip = (active: boolean) => ({ background: active ? ACCENT : 'rgba(120,120,128,0.12)', color: active ? '#fff' : '#48484a' });

  return (
    <>
      <div onClick={() => dispatch({ editSheetOpen: false })} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)', zIndex: 15 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: '20px 20px 0 0', background: '#fff', padding: '18px 20px 42px', display: 'flex', flexDirection: 'column', gap: 13, boxShadow: '0 -12px 40px rgba(0,0,0,0.16)', animation: 'sheetUp 0.32s cubic-bezier(0.3,0.9,0.4,1)', maxHeight: '82%', zIndex: 16 }}>
        <div style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(120,120,128,0.25)', alignSelf: 'center', flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div onClick={goPrev} style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(120,120,128,0.1)', display: 'grid', placeItems: 'center', cursor: 'pointer', opacity: idx > 0 ? 1 : 0.25 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1d1d1f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <div onClick={setQA} style={{ padding: '8px 14px', borderRadius: 9, cursor: 'pointer', ...chip(state.editMode === 'qa') }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>문답형</span></div>
            <div onClick={setCloze} style={{ padding: '8px 14px', borderRadius: 9, cursor: 'pointer', ...chip(state.editMode === 'tokens') }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>빈칸형</span></div>
          </div>
          <div onClick={goNext} style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(120,120,128,0.1)', display: 'grid', placeItems: 'center', cursor: 'pointer', opacity: idx >= 0 && idx < cardsAll.length - 1 ? 1 : 0.25 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1d1d1f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </div>
        </div>

        {state.editMode === 'qa' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(60,60,67,0.45)', letterSpacing: '0.03em' }}>질문</span>
              <textarea rows={2} value={state.editQ} onChange={(e) => dispatch({ editQ: e.target.value })} placeholder="질문" style={{ fontSize: 17, fontWeight: 600, border: 'none', background: 'transparent', color: '#000', padding: '2px 0', resize: 'none', lineHeight: 1.5 }} />
            </div>
            <div style={{ height: 0.5, background: 'rgba(60,60,67,0.12)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: ACCENT, opacity: 0.75, letterSpacing: '0.03em' }}>답 (가려짐)</span>
              <input value={state.editA} onChange={(e) => dispatch({ editA: e.target.value })} placeholder="답" style={{ fontSize: 17, fontWeight: 600, border: 'none', background: 'transparent', color: ACCENT_DEEP, padding: '2px 0' }} />
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(60,60,67,0.45)', letterSpacing: '0.03em' }}>문장 (여러 줄도 한 카드)</span>
              <textarea rows={3} value={state.editText} onChange={onEditText} placeholder="문장 전체를 쓰세요" style={{ fontSize: 16.5, fontWeight: 600, border: 'none', background: 'transparent', color: '#000', padding: '2px 0', resize: 'none', lineHeight: 1.5 }} />
            </div>
            <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(120,120,128,0.08)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 2px', lineHeight: 1.9, overflowY: 'auto', minHeight: 0 }}>
              {props.renderTokenChips(state.editTokens, -100, 15)}
              <span style={{ width: '100%', fontSize: 12.5, color: ACCENT_DEEP, fontWeight: 700, marginTop: 2 }}>가릴 단어를 탭하세요 · 누른 채 끌면 여러 단어가 한 빈칸이 돼요</span>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4, flexShrink: 0 }}>
          <div onClick={props.onDelete} style={{ height: 50, padding: '0 20px', borderRadius: 12, background: 'rgba(255,59,48,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#ff3b30' }}>삭제</span>
          </div>
          <div onClick={save} style={{ flex: 1, height: 50, borderRadius: 12, background: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>저장</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ================================================================ SETTINGS
function SettingsSheet(props: { roomCode: string; onClose: () => void; onChangeRoom: (code: string) => void }) {
  const [value, setValue] = useState(props.roomCode);
  const [copied, setCopied] = useState(false);
  const changed = normalizeRoomCode(value) && normalizeRoomCode(value) !== props.roomCode;
  const copy = () => {
    try { navigator.clipboard?.writeText(props.roomCode); } catch { /* clipboard blocked (e.g. sandbox) */ }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <>
      <div onClick={props.onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)', zIndex: 15 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: '20px 20px 0 0', background: '#fff', padding: '18px 20px 42px', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 -12px 40px rgba(0,0,0,0.16)', animation: 'sheetUp 0.32s cubic-bezier(0.3,0.9,0.4,1)', zIndex: 16 }}>
        <div style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(120,120,128,0.25)', alignSelf: 'center' }} />
        <div style={{ fontSize: 20, fontWeight: 800 }}>내 아이디</div>
        <div style={{ fontSize: 13.5, color: 'rgba(60,60,67,0.6)', lineHeight: 1.5 }}>다른 기기(PC·아이폰)에서 <strong style={{ color: '#1d1d1f' }}>같은 아이디</strong>로 접속하면 같은 암기장을 봐요. 아이디를 잊지 않게 적어두거나 복사해 두세요.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, borderRadius: 12, background: '#F7F7F9', padding: '0 8px 0 16px' }}>
          <span style={{ flex: 1, fontSize: 18, fontWeight: 800, color: '#1d1d1f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props.roomCode}</span>
          <div onClick={copy} style={{ height: 40, padding: '0 16px', borderRadius: 9, background: copied ? 'rgba(52,199,89,0.15)' : ACCENT, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: copied ? '#1e9e46' : '#fff' }}>{copied ? '복사됨 ✓' : '복사'}</span>
          </div>
        </div>
        <div style={{ height: 0.5, background: 'rgba(60,60,67,0.1)', margin: '2px 0' }} />
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'rgba(60,60,67,0.45)' }}>다른 아이디로 바꾸기</div>
        <input value={value} onChange={(e) => setValue(e.target.value)} style={{ height: 48, borderRadius: 11, border: '1px solid rgba(60,60,67,0.18)', background: '#fff', padding: '0 14px', fontSize: 16, fontWeight: 600, color: '#000' }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <div onClick={props.onClose} style={{ flex: 1, height: 48, borderRadius: 11, background: 'rgba(120,120,128,0.12)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><span style={{ fontSize: 16, fontWeight: 700, color: '#48484a' }}>닫기</span></div>
          <div onClick={() => { if (changed) props.onChangeRoom(normalizeRoomCode(value)); }} style={{ flex: 1, height: 48, borderRadius: 11, background: changed ? ACCENT : 'rgba(120,120,128,0.12)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><span style={{ fontSize: 16, fontWeight: 700, color: changed ? '#fff' : 'rgba(60,60,67,0.4)' }}>바꾸기</span></div>
        </div>
      </div>
    </>
  );
}
