import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import { createFirebaseRepository } from './firebase';
import { createLocalRepository } from './localRepository';
import { createServerRepository } from './serverRepository';
import { splitCloze } from './parser';
import type { Card, Deck, NewCard, Repository, Section } from './types';

const ROOM_KEY = 'exam-memorizer-room-code';
const ACCENT = '#007aff';
const ACCENT_DEEP = '#0a5dc2';
const ACCENT_SOFT = 'rgba(0,122,255,0.08)';
const PC_HINT_QUERY = '(min-width: 769px) and (pointer: fine)';

function usePcHints() {
  const [isPc, setIsPc] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(PC_HINT_QUERY).matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(PC_HINT_QUERY);
    const update = () => setIsPc(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isPc;
}

// ------------------------------------------------------------------ helpers
function normalizeRoomCode(value: string) {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
}

function createRoomCode() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `memo-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `memo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function toggleTokenAt(tokens: Token[], index: number): Token[] {
  const target = tokens[index];
  if (!target || target.nl) return tokens;
  if (target.hidden) {
    return tokens.map((token) => (token.gid === target.gid ? { ...token, hidden: false, gid: 0 } : token));
  }
  const gid = (Date.now() % 1000000) + index;
  return tokens.map((token, tokenIndex) => (tokenIndex === index ? { ...token, hidden: true, gid } : token));
}

function editSignature(mode: 'qa' | 'tokens', q: string, a: string, tokens: Token[]) {
  if (mode === 'qa') {
    return JSON.stringify(['qa', q.trim(), a.split(',').map((answer) => answer.trim()).filter(Boolean)]);
  }
  const card = tokensToCard(tokens);
  return JSON.stringify(['tokens', card.q, card.a]);
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

function normalizeAnswerMastery(card: Pick<Card, 'answerMastery' | 'mastered'>, answerCount: number): boolean[] {
  if (Array.isArray(card.answerMastery)) {
    return Array.from({ length: answerCount }, (_, i) => Boolean(card.answerMastery?.[i]));
  }
  return Array.from({ length: answerCount }, () => Boolean(card.mastered));
}

function remapAnswerMastery(card: Card, nextAnswers: string[]): boolean[] {
  const previous = deriveQA(card);
  const previousMastery = normalizeAnswerMastery(card, previous.a.length);
  return nextAnswers.map((answer, i) => previous.a[i] === answer && Boolean(previousMastery[i]));
}

function masterySummary(cards: ProtoCard[]) {
  return cards.reduce((summary, card) => ({
    total: summary.total + card.a.length,
    known: summary.known + card.knownCount,
  }), { total: 0, known: 0 });
}

type HideState = 'known' | 'retry' | 'pending' | 'checked';

function HideStateMap({ states, size = 'compact' }: { states: HideState[]; size?: 'compact' | 'regular' }) {
  if (states.length === 0) return null;
  const dense = states.length > 10;
  const known = states.filter((state) => state === 'known').length;
  const checked = states.filter((state) => state === 'checked').length;
  const retry = states.filter((state) => state === 'retry').length;
  const pending = states.filter((state) => state === 'pending').length;
  const label = [
    `완료 ${known}개`,
    checked > 0 ? `방금 확인 ${checked}개` : '',
    retry > 0 ? `다시 ${retry}개` : '',
    pending > 0 ? `확인 전 ${pending}개` : '',
  ].filter(Boolean).join(', ');
  const colorOf = (state: HideState) => {
    if (state === 'retry') return '#ff9500';
    if (state === 'known') return '#34c759';
    if (state === 'checked') return ACCENT;
    return 'rgba(120,120,128,0.26)';
  };
  return (
    <div role="img" aria-label={`가림 상태: ${label}`} style={{ display: 'flex', alignItems: 'center', gap: dense ? 2 : size === 'regular' ? 5 : 3, width: dense ? (size === 'regular' ? 92 : 64) : 'auto', flexShrink: 0 }}>
      {states.map((state, index) => (
        <span
          key={index}
          style={{
            width: dense ? 'auto' : size === 'regular' ? 10 : 7,
            minWidth: dense ? 2 : size === 'regular' ? 10 : 7,
            flex: dense ? 1 : 'none',
            height: size === 'regular' ? 10 : 7,
            borderRadius: state === 'retry' ? 3 : 999,
            border: state === 'retry' ? `2px solid ${colorOf(state)}` : 'none',
            background: state === 'retry' ? 'rgba(255,149,0,0.1)' : colorOf(state),
            boxSizing: 'border-box',
            transition: 'background 160ms ease, border-color 160ms ease, transform 160ms ease',
            transform: state === 'retry' ? 'scale(1.12)' : 'scale(1)',
          }}
        />
      ))}
    </div>
  );
}

function qaToNewCard(q: string, a: string[], answerMastery = a.map(() => false)): NewCard {
  const isCloze = q.includes('___');
  const normalized = a.map((_, i) => Boolean(answerMastery[i]));
  return {
    type: isCloze ? 'cloze' : 'pair',
    prompt: q,
    answers: a,
    rawText: isCloze ? q : `${q}: ${a.join(', ')}`,
    answerMastery: normalized,
    mastered: normalized.length > 0 && normalized.every(Boolean),
  };
}

function cardToNewCard(card: Card, answerMasteryOverride?: boolean[]): NewCard {
  const answerMastery = answerMasteryOverride ?? normalizeAnswerMastery(card, card.answers.length);
  return {
    type: card.type,
    prompt: card.prompt,
    answers: card.answers,
    rawText: card.rawText,
    groupItems: card.groupItems,
    starred: card.starred,
    answerMastery,
    mastered: answerMastery.length > 0 && answerMastery.every(Boolean),
  };
}

// NewCard + a client-only hint so the optimistic cache can keep the card's
// current id (the server regenerates ids on every content PUT).
type OptimisticNewCard = NewCard & { optimisticId?: string };

function keepCard(card: Card, answerMasteryOverride?: boolean[]): OptimisticNewCard {
  return { ...cardToNewCard(card, answerMasteryOverride), optimisticId: card.id };
}

// ------------------------------------------------------------------ view model
type ProtoCard = {
  id: string;
  q: string;
  a: string[];
  answerMastery: boolean[];
  knownCount: number;
  remainingCount: number;
  memorized: boolean;
  isGroup: boolean;
  source: Card;
};

type ProtoList = {
  id: string;
  deckId: string;
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
type StudyTarget = { cardId: string; answerIndexes: number[] };
type UIState = {
  view: View;
  activeDeckId: string | null;
  activeSectionId: string | null;
  shuffle: boolean;
  filter: 'all' | 'unknown' | 'done';
  queue: StudyTarget[];
  sessionTotal: number;
  sessionDone: number;
  revealedIdx: number[];
  retryAnswerIdx: number[];
  review: boolean;
  openRowId: string | null;
  rowDrag: { id: string; x: number; base: number } | null;
  reorder: { id: string; dy: number; overId?: string | null } | null;
  sel: { ri: number; start: number; end: number; wasHidden: boolean } | null;
  slotOpen: boolean;
  pasteText: string;
  pasteMode: 'auto' | 'one';
  sheetRows: Row[];
  editSheetOpen: boolean;
  editIdx: number | null;
  editMode: 'qa' | 'tokens';
  editQ: string;
  editA: string;
  editText: string;
  editTokens: Token[];
  editInitialSignature: string;
  settingsOpen: boolean;
  toastMsg: string;
  toastVisible: boolean;
  toastUndo: boolean;
};

const initialUI: UIState = {
  view: 'home', activeDeckId: null, activeSectionId: null, shuffle: false, filter: 'all',
  queue: [], sessionTotal: 0, sessionDone: 0, revealedIdx: [], retryAnswerIdx: [], review: false,
  openRowId: null, rowDrag: null, reorder: null, sel: null,
  slotOpen: false, pasteText: '', pasteMode: 'auto', sheetRows: [],
  editSheetOpen: false, editIdx: null, editMode: 'qa', editQ: '', editA: '', editText: '', editTokens: [], editInitialSignature: '',
  settingsOpen: false, toastMsg: '', toastVisible: false, toastUndo: false,
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
  const [showExisting, setShowExisting] = useState(false);
  const [value, setValue] = useState('');
  const normalized = normalizeRoomCode(value);
  const hasInvalid = value.trim().replace(/[A-Za-z0-9_\s-]/g, '').length > 0;
  const submit = () => {
    if (!normalized) return;
    onSubmit(normalized);
  };

  if (!showExisting) {
    return (
      <div style={{ minHeight: '100dvh', width: '100%', maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', padding: 'calc(env(safe-area-inset-top) + 72px) 24px calc(env(safe-area-inset-bottom) + 32px)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 29, fontWeight: 800, letterSpacing: '-0.035em' }}>시험암기</div>
          <div style={{ maxWidth: 360, fontSize: 16, color: '#5f5f65', lineHeight: 1.65, wordBreak: 'keep-all' }}>
            암기할 내용을 적고, 원하는 부분을 여러 곳 가려서 하나씩 외워요.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 34 }}>
          <button
            type="button"
            className="ui-button"
            onClick={() => onSubmit(createRoomCode())}
            style={{ width: '100%', minHeight: 54, borderRadius: 13, background: ACCENT, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 16.5, fontWeight: 800, color: '#fff' }}
          >
            새로 시작하기
          </button>
          <button
            type="button"
            className="ui-button"
            onClick={() => setShowExisting(true)}
            style={{ width: '100%', minHeight: 50, borderRadius: 13, border: '1px solid rgba(60,60,67,0.16)', background: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 15.5, fontWeight: 700, color: '#1d1d1f' }}
          >
            기존 데이터 불러오기
          </button>
          <div style={{ padding: '2px 6px 0', color: '#6e6e73', fontSize: 12.5, lineHeight: 1.55, textAlign: 'center', wordBreak: 'keep-all' }}>
            공유 코드는 자동으로 만들어요. 다른 기기 연결은 시작 후 설정에서 할 수 있어요.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', width: '100%', maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', padding: 'calc(env(safe-area-inset-top) + 18px) 24px calc(env(safe-area-inset-bottom) + 32px)' }}>
      <button
        type="button"
        className="ui-button"
        onClick={() => { setShowExisting(false); setValue(''); }}
        aria-label="처음 화면으로"
        style={{ alignSelf: 'flex-start', minWidth: 44, minHeight: 44, marginLeft: -10, background: 'transparent', display: 'flex', alignItems: 'center', gap: 3, color: ACCENT, cursor: 'pointer', fontSize: 16, fontWeight: 600 }}
      >
        <svg width="11" height="18" viewBox="0 0 12 20" fill="none"><path d="M10 2 2 10l8 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        처음
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 22 }}>
        <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.025em' }}>기존 데이터 불러오기</div>
        <div style={{ fontSize: 14.5, color: '#5f5f65', lineHeight: 1.6, wordBreak: 'keep-all' }}>
          다른 기기에서 사용하던 동기화 코드를 입력하세요.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 28 }}>
        <label htmlFor="sync-code" style={{ fontSize: 12.5, fontWeight: 700, color: '#6e6e73', letterSpacing: '0.02em' }}>동기화 코드</label>
        <input
          id="sync-code"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="예: hong-gildong-2026"
          aria-describedby="sync-code-help"
          style={{ height: 48, borderRadius: 11, border: '1px solid rgba(60,60,67,0.2)', background: '#fff', padding: '0 14px', fontSize: 16, fontWeight: 600, color: '#000' }}
        />
        <span id="sync-code-help" style={{ fontSize: 12, color: hasInvalid ? '#b45309' : '#6e6e73', fontWeight: hasInvalid ? 700 : 500, lineHeight: 1.5 }}>
          {hasInvalid
            ? '한글·특수문자는 쓸 수 없어요 — 영문·숫자·- _ 만 남아요'
            : '영문·숫자·- _ 만 사용할 수 있어요'}
        </span>
      </div>
      <button
        type="button"
        className="ui-button"
        onClick={submit}
        disabled={!normalized}
        style={{ minHeight: 52, marginTop: 22, borderRadius: 12, background: normalized ? ACCENT : 'rgba(0,122,255,0.28)', display: 'grid', placeItems: 'center', cursor: normalized ? 'pointer' : 'default', transition: 'background 0.15s' }}
      >
        <span style={{ fontSize: 16, fontWeight: 750, color: '#fff' }}>불러오기</span>
      </button>
      <div style={{ marginTop: 12, color: '#6e6e73', fontSize: 12, lineHeight: 1.5, textAlign: 'center' }}>
        코드를 아는 사람은 같은 카드 데이터를 볼 수 있어요.
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
  lists: ProtoList[]; decksState: 'loading' | 'ready' | 'error';
  onOpenList: (list: ProtoList) => void; onContinue: (list: ProtoList) => void;
  onNewList: () => void; onOpenSettings: () => void;
}) {
  const { lists, decksState } = props;
  const contList = lists.find((l) => l.cards.some((c) => c.remainingCount > 0));
  const contRemain = contList ? contList.cards.reduce((total, card) => total + card.remainingCount, 0) : 0;
  const activateWithKeyboard = (action: () => void) => (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    action();
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, paddingTop: 'env(safe-area-inset-top)' }}>
      <div style={{ padding: '18px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>내 암기장</div>
        <button type="button" className="ui-button" onClick={props.onOpenSettings} aria-label="설정" title="설정" style={{ width: 44, height: 44, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px calc(env(safe-area-inset-bottom) + 32px)', minHeight: 0 }}>
        {decksState === 'loading' && lists.length === 0 && (
          <div style={{ padding: '44px 20px', textAlign: 'center', color: 'rgba(60,60,67,0.45)', fontSize: 15 }}>불러오는 중…</div>
        )}
        {decksState === 'ready' && lists.length === 0 && (
          <div style={{ padding: '38px 20px', textAlign: 'center', color: 'rgba(60,60,67,0.58)', fontSize: 15, lineHeight: 1.6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div>아직 암기장이 없어요.<br />첫 암기장에 외울 카드를 추가해보세요.</div>
            <EmptyStateAction label="첫 암기장 만들기" onClick={props.onNewList} />
          </div>
        )}

        {contList && (
          <button type="button" className="ui-button" onClick={() => props.onContinue(contList)} style={{ width: '100%', marginBottom: 16, padding: '12px 14px', borderRadius: 12, background: ACCENT, color: '#fff', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.82 }}>이어서 암기 · 가림 {contRemain}개</span>
              <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contList.name}</span>
            </span>
            <span style={{ width: 32, height: 32, borderRadius: 999, background: 'rgba(255,255,255,0.24)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <svg width="12" height="14" viewBox="0 0 16 18"><path d="M2 1.5v15l13-7.5z" fill="#fff" /></svg>
            </span>
          </button>
        )}

        {lists.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
            {lists.map((l) => {
              const progress = masterySummary(l.cards);
              const allDone = progress.total > 0 && progress.known === progress.total;
              return (
                <div key={`${l.deckId}:${l.id}`} onClick={() => props.onOpenList(l)} onKeyDown={activateWithKeyboard(() => props.onOpenList(l))} role="button" tabIndex={0} aria-label={`${l.name} 열기`} style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderBottom: '1px solid rgba(60,60,67,0.08)' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                    <div style={{ fontSize: 12.5, color: '#6e6e73' }}>{l.cards.length === 0 ? '카드 없음' : `가림 ${progress.known}/${progress.total} · 카드 ${l.cards.length}개`}</div>
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
            <button type="button" className="ui-button" onClick={props.onNewList} aria-label="새 암기장 만들기" style={{ width: '100%', padding: '12px 14px', background: 'transparent', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
              <span style={{ fontSize: 14, fontWeight: 600, color: ACCENT }}>새 암기장</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ================================================================ DECK
function DeckView(props: {
  list: ProtoList; state: UIState; dispatch: (p: Patch) => void; weakFirst: (cards: ProtoCard[]) => ProtoCard[];
  lpTimer: React.MutableRefObject<number | undefined>; rowStart: React.MutableRefObject<{ x: number; y: number; moved: boolean }>;
  onHome: () => void; onRename: (name: string) => void;
  onDelete: (card: ProtoCard) => void; onEdit: (card: ProtoCard) => void; onMove: (draggedId: string, targetId: string) => void;
  onDeleteList: () => void;
  onStart: (ids: string[]) => void; onOpenAdd: () => void; toast: (msg: string) => void;
}) {
  const { list, state, dispatch, weakFirst, lpTimer, rowStart } = props;
  const isPc = usePcHints();
  const [nameDraft, setNameDraft] = useState(list.name);
  const nameTimer = useRef<number | undefined>(undefined);
  // Row gestures (swipe-delete, long-press reorder) are invisible — explain them
  // once on the first deck visit, then stay quiet.
  const [showGuide] = useState(() => !localStorage.getItem('exam-memorizer-hint-seen'));
  useEffect(() => { try { localStorage.setItem('exam-memorizer-hint-seen', '1'); } catch { /* noop */ } }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setNameDraft(list.name); }, [list.id]);
  const cardsAll = list.cards;
  const filterFn = (c: ProtoCard) => (state.filter === 'done' ? c.memorized : state.filter === 'unknown' ? c.remainingCount > 0 : true);
  const visible = cardsAll.filter(filterFn);
  const learningCards = weakFirst(visible.filter((c) => c.remainingCount > 0));
  const doneCards = visible.filter((c) => c.memorized);
  const studyCards = visible.filter((c) => c.remainingCount > 0);
  const deckTotal = cardsAll.length;
  const mastery = masterySummary(cardsAll);
  const deckPct = mastery.total ? Math.round((mastery.known / mastery.total) * 100) : 0;
  const cntUnknown = cardsAll.filter((c) => c.remainingCount > 0).length;
  const cntDone = cardsAll.filter((c) => c.memorized).length;

  useEffect(() => {
    if ((state.filter === 'unknown' && cntUnknown === 0) || (state.filter === 'done' && cntDone === 0)) {
      dispatch({ filter: 'all', openRowId: null });
    }
  }, [state.filter, cntUnknown, cntDone, dispatch]);

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
    const retryCount = learningCards.reduce((total, card) => total + card.remainingCount, 0);
    rows.push({ header: true, label: `다시 ${retryCount}`, dot: '#ff9500' });
    learningCards.forEach((c) => rows.push({ header: false, card: c }));
  }
  if (doneCards.length > 0) {
    rows.push({ header: true, label: `완료 ${doneCards.length}`, dot: '#34c759' });
    doneCards.forEach((c) => rows.push({ header: false, card: c }));
  }

  const startEnabled = deckTotal > 0 && visible.length > 0;
  const startLabel = deckTotal === 0 ? '카드를 먼저 추가하세요'
    : studyCards.length > 0 ? `가림 ${studyCards.reduce((total, card) => total + card.remainingCount, 0)}개 시작`
    : visible.length > 0 ? '복습하기' : '카드 없음';

  const chips: Array<{ key: 'all' | 'unknown' | 'done'; label: string; disabled: boolean }> = [
    { key: 'all', label: `전체 ${cardsAll.length}`, disabled: false },
    { key: 'unknown', label: `다시 ${cntUnknown}`, disabled: cntUnknown === 0 },
    { key: 'done', label: `완료 ${cntDone}`, disabled: cntDone === 0 },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, paddingTop: 'env(safe-area-inset-top)' }}>
      <div style={{ padding: '8px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button type="button" className="ui-button" onClick={props.onHome} aria-label="홈으로" style={{ minWidth: 44, minHeight: 44, background: 'transparent', display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', marginLeft: -6 }}>
          <svg width="12" height="20" viewBox="0 0 12 20" fill="none"><path d="M10 2L2 10l8 8" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span style={{ fontSize: 17, color: ACCENT }}>홈</span>
        </button>
        <input
          aria-label="암기장 이름"
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
          <button
            type="button"
            className="ui-button"
            onClick={() => {
              const next = !state.shuffle;
              dispatch({ shuffle: next });
              props.toast(next ? '섞기 켬 — 순서를 무작위로' : '섞기 끔 — 헷갈린 카드부터');
            }}
            aria-label="섞기" aria-pressed={state.shuffle} title="섞기"
            style={{ width: 40, height: 40, borderRadius: 12, background: state.shuffle ? 'rgba(0,122,255,0.14)' : 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={state.shuffle ? ACCENT : 'rgba(60,60,67,0.5)'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" /><path d="m18 2 4 4-4 4" /><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" /><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" /><path d="m18 14 4 4-4 4" /></svg>
          </button>
          {!list.synthetic && (
            <button type="button" className="ui-button" onClick={props.onDeleteList} aria-label="암기장 삭제" title="암기장 삭제" style={{ width: 40, height: 40, borderRadius: 12, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: '0 20px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(120,120,128,0.16)', overflow: 'hidden' }}>
          <div style={{ width: `${deckPct}%`, height: '100%', background: '#34c759' }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#6e6e73', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{mastery.total === 0 ? '가림 없음' : `${mastery.known}/${mastery.total} 가림`}</span>
      </div>

      <div style={{ margin: '0 16px 4px', display: 'flex', padding: 2, borderRadius: 9, background: 'rgba(120,120,128,0.12)' }}>
        {chips.map((chip) => {
          const active = state.filter === chip.key;
          return (
            <button type="button" className="ui-button" key={chip.key} onClick={() => dispatch({ filter: chip.key, openRowId: null })} aria-pressed={active} disabled={chip.disabled} style={{ flex: 1, height: 30, borderRadius: 7, display: 'grid', placeItems: 'center', background: active ? '#fff' : 'transparent', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', cursor: chip.disabled ? 'default' : 'pointer', opacity: chip.disabled ? 0.42 : 1, transition: 'background 0.15s, opacity 0.15s' }}>
              <span style={{ fontSize: 12.5, fontWeight: active ? 700 : 600, color: active ? '#1d1d1f' : 'rgba(60,60,67,0.55)' }}>{chip.label}</span>
            </button>
          );
        })}
      </div>

      {deckTotal > 0 && showGuide && (
        <div style={{ padding: '4px 20px 4px', color: 'rgba(60,60,67,0.5)', fontSize: 11.5, fontWeight: 500, lineHeight: 1.45 }}>
          {isPc ? '클릭하면 수정 · 왼쪽으로 끌면 삭제 · 길게 누르면 순서 변경' : '탭하면 수정 · 왼쪽으로 밀면 삭제 · 길게 누르면 순서 변경'}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 16px 130px', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {deckTotal === 0 && (
          <div style={{ padding: '26px 20px 12px', textAlign: 'center', color: 'rgba(60,60,67,0.58)', fontSize: 14.5, lineHeight: 1.6 }}>
            아직 카드가 없어요.<br />외울 카드 하나부터 추가해보세요.
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
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0, paddingTop: 3, pointerEvents: 'none', color: c.memorized ? '#1e9e46' : '#6e6e73' }}>
                  <HideStateMap states={c.answerMastery.map((known) => known ? 'known' : 'retry')} />
                  <span style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{c.knownCount}/{c.a.length}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(env(safe-area-inset-bottom) + 20px)', background: 'linear-gradient(180deg,rgba(242,242,247,0) 0%,#F2F2F7 32%)', display: 'flex', gap: 10 }}>
        <button type="button" className="ui-button" onClick={props.onOpenAdd} style={{ height: 50, padding: '0 18px', borderRadius: 12, background: '#fff', border: '1px solid rgba(60,60,67,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1d1d1f" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>카드 추가</span>
        </button>
        <button
          type="button"
          className="ui-button"
          onClick={() => {
            if (studyCards.length > 0) props.onStart(weakFirst(studyCards).map((c) => c.id));
            else if (visible.length > 0) props.onStart(visible.map((c) => c.id));
            else props.toast('외울 카드가 없어요');
          }}
          disabled={!startEnabled}
          style={{ flex: 1, height: 50, borderRadius: 12, background: startEnabled ? ACCENT : 'rgba(120,120,128,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: startEnabled ? 'pointer' : 'default' }}
        >
          <svg width="13" height="15" viewBox="0 0 16 18"><path d="M2 1.5v15l13-7.5z" fill={startEnabled ? '#fff' : 'rgba(60,60,67,0.35)'} /></svg>
          <span style={{ fontSize: 15.5, fontWeight: 700, color: startEnabled ? '#fff' : 'rgba(60,60,67,0.35)' }}>{startLabel}</span>
        </button>
      </div>
    </div>
  );
}

// ================================================================ CONTINUOUS ADD
// 추가 중에는 목록 관리 UI를 모두 치우고 현재 입력에만 집중한다.
// 저장 후 편집기를 닫지 않고 비운 뒤 다시 포커스해 연속 입력을 지원한다.
function ContinuousAddView(props: {
  state: UIState; dispatch: (p: Patch) => void;
  renderTokenChips: (tokens: Token[], ri: number, fontSize: number, outlined?: boolean) => React.ReactNode;
  onAddCards: (cards: NewCard[]) => Promise<boolean>;
  onUndoLast: () => Promise<number>;
  onClose: () => void;
}) {
  const { state, dispatch } = props;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const [addedCount, setAddedCount] = useState(0);
  const [lastAddedCount, setLastAddedCount] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  // re-parse on every keystroke but keep words the user already masked
  const reparse = (text: string, mode: 'auto' | 'one') => (st: UIState): Partial<UIState> => {
    const hiddenWords = new Set(
      st.sheetRows.flatMap((r) => (r.kind === 'tokens' ? r.tokens.filter((t) => t.hidden).map((t) => t.word) : [])),
    );
    let g = 7000;
    const rows = parsePaste(text, mode).map((r) =>
      r.kind === 'tokens'
        ? { ...r, tokens: r.tokens.map((t) => (!t.nl && hiddenWords.has(t.word) ? { ...t, hidden: true, gid: g++ } : t)) }
        : r,
    );
    return { pasteText: text, pasteMode: mode, sheetRows: rows };
  };

  const validRows = state.sheetRows.filter((r) => r.kind === 'qa' || r.tokens.some((t) => t.hidden));
  const tokenRows = state.sheetRows.filter((r) => r.kind === 'tokens');
  const incomplete = tokenRows.filter((r) => r.kind === 'tokens' && !r.tokens.some((t) => t.hidden)).length;
  const blanks = tokenRows.reduce((n, r) => n + (r.kind === 'tokens' && r.tokens.some((t) => t.hidden) ? tokensToCard(r.tokens).a.length : 0), 0);
  const multi = state.sheetRows.length > 1;

  const add = async () => {
    if (validRows.length === 0 || saving) return;
    const cards = validRows.map((r) => {
      if (r.kind === 'qa') return qaToNewCard(r.q, [r.a]);
      const { q, a } = tokensToCard(r.tokens);
      return qaToNewCard(q, a);
    });
    setSaving(true);
    const saved = await props.onAddCards(cards);
    setSaving(false);
    if (!saved) return;
    setAddedCount((count) => count + cards.length);
    setLastAddedCount(cards.length);
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setLastAddedCount(0), 4500);
    dispatch({ pasteText: '', pasteMode: 'auto', sheetRows: [], sel: null });
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const undoLast = async () => {
    if (saving) return;
    setSaving(true);
    const undone = await props.onUndoLast();
    setSaving(false);
    if (undone === 0) return;
    setAddedCount((count) => Math.max(0, count - undone));
    setLastAddedCount(0);
    window.clearTimeout(undoTimer.current);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', background: '#F2F2F7', paddingTop: 'env(safe-area-inset-top)' }}>
      <div style={{ height: 60, padding: '6px 16px 0', display: 'grid', gridTemplateColumns: '76px 1fr 76px', alignItems: 'center', flexShrink: 0 }}>
        <button type="button" className="ui-button" onClick={props.onClose} style={{ minWidth: 44, minHeight: 44, justifySelf: 'start', background: 'transparent', color: ACCENT, fontSize: 16.5, fontWeight: 600, cursor: 'pointer' }}>
          닫기
        </button>
        <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>카드 연속 추가</div>
        <span />
      </div>
      {addedCount > 0 && (
        <div aria-live="polite" style={{ minHeight: 34, display: 'grid', placeItems: 'center', color: 'rgba(60,60,67,0.55)', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
          카드 {addedCount}개 추가됨
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px 190px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: '18px 14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label htmlFor="new-memory-content" style={{ fontSize: 16, fontWeight: 800, color: '#1d1d1f' }}>암기할 내용</label>
          <div style={{ minHeight: 150, border: '1px solid rgba(60,60,67,0.14)', borderRadius: 11, background: '#fff', padding: '12px 13px' }}>
            <textarea
              ref={inputRef}
              id="new-memory-content"
              autoFocus
              rows={Math.min(6, Math.max(4, state.pasteText.split('\n').length))}
              value={state.pasteText}
              onChange={(e) => dispatch(reparse(e.target.value, state.pasteMode))}
              placeholder={'내용을 입력하거나 붙여넣으세요\n예: 대한민국의 수도는 서울이다'}
              style={{ width: '100%', minHeight: 124, border: 'none', background: 'transparent', color: '#000', fontSize: 17, fontWeight: 600, lineHeight: 1.55, resize: 'none', display: 'block' }}
            />
          </div>
        </div>

        {state.sheetRows.length > 0 && (
          <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {multi && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(60,60,67,0.55)' }}>{state.sheetRows.length}줄</span>
              <div style={{ display: 'flex', padding: 2, borderRadius: 8, background: 'rgba(120,120,128,0.12)' }}>
                {([['auto', '줄마다 추가'], ['one', '한 카드로']] as const).map(([mode, label]) => (
                  <button type="button" className="ui-button" key={mode} onClick={() => dispatch(reparse(state.pasteText, mode))} aria-pressed={state.pasteMode === mode} style={{ minHeight: 34, padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: state.pasteMode === mode ? '#fff' : 'transparent', color: state.pasteMode === mode ? '#1d1d1f' : '#6e6e73', boxShadow: state.pasteMode === mode ? '0 1px 2px rgba(0,0,0,0.1)' : 'none' }}>{label}</button>
                ))}
              </div>
            </div>
          )}

          {tokenRows.length > 0 && (
            <div style={{ color: 'rgba(60,60,67,0.58)', fontSize: 13.5, fontWeight: 600 }}>
              {incomplete > 0 && validRows.length > 0
                ? `${incomplete}줄은 가릴 부분이 없어 빠져요`
                : blanks > 0 ? `가림 ${blanks}곳 선택됨` : '가릴 부분을 탭하세요'}
            </div>
          )}

          {state.sheetRows.map((r, ri) => r.kind === 'qa' ? (
            <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 10, background: 'rgba(120,120,128,0.07)' }}>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600, lineHeight: 1.5, wordBreak: 'keep-all' }}>{r.q}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: ACCENT_DEEP, flexShrink: 0 }}>{r.a}</span>
            </div>
          ) : (
            <div key={ri} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '7px 4px', lineHeight: 1.9 }}>
              {props.renderTokenChips(r.tokens, ri, 16, true)}
            </div>
          ))}

          </div>
        )}
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '10px 16px calc(env(safe-area-inset-bottom) + 18px)', background: '#F2F2F7', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ minHeight: 54 }}>
          {lastAddedCount > 0 && (
            <div
              role="status"
              aria-live="polite"
              style={{ minHeight: 54, borderRadius: 12, background: '#fff', border: '1px solid rgba(60,60,67,0.1)', display: 'flex', alignItems: 'center', padding: '0 14px', animation: 'undoIn 0.18s ease-out' }}
            >
              <span style={{ flex: 1, fontSize: 14.5, fontWeight: 650 }}>추가했어요</span>
              <button type="button" className="ui-button" onClick={undoLast} disabled={lastAddedCount === 0 || saving} style={{ minWidth: 64, minHeight: 44, background: 'transparent', color: '#6e6e73', fontSize: 14, fontWeight: 700, textAlign: 'right', cursor: saving ? 'default' : 'pointer' }}>
                되돌리기
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="ui-button"
          onClick={add}
          disabled={validRows.length === 0 || saving}
          style={{ width: '100%', height: 54, borderRadius: 12, background: validRows.length > 0 && !saving ? ACCENT : 'rgba(0,122,255,0.24)', color: '#fff', display: 'grid', placeItems: 'center', cursor: validRows.length > 0 && !saving ? 'pointer' : 'default', fontSize: 16, fontWeight: 800, transition: 'background 0.15s, transform 0.12s' }}
        >
          {saving ? '추가 중…' : validRows.length > 1 ? `${validRows.length}개 추가하고 계속` : '추가하고 계속'}
        </button>
      </div>
    </div>
  );
}

// ================================================================ STUDY
function StudyView(props: {
  list: ProtoList | undefined; state: UIState; dispatch: (p: Patch) => void;
  onComplete: () => void;
  onDeck: () => void; onRetryRemaining: () => void; onReviewAll: () => void;
}) {
  const { list, state, dispatch } = props;
  const isPc = usePcHints();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const target = state.queue[0];
  const card = list && target ? list.cards.find((c) => c.id === target.cardId) : undefined;
  const qParts = card ? card.q.split('___') : [];
  const nBlanks = card ? (qParts.length > 1 ? qParts.length - 1 : 1) : 0;
  const isCloze = !!card && qParts.length > 1;
  const targetIndexes = target?.answerIndexes ?? [];
  const targetSet = new Set(targetIndexes);
  const retrySet = new Set(state.retryAnswerIdx);
  let nextIdx = -1;
  for (const answerIndex of targetIndexes) {
    if (!state.revealedIdx.includes(answerIndex)) { nextIdx = answerIndex; break; }
  }
  const allRevealed = !!card && targetIndexes.length > 0 && nextIdx === -1;

  const revealNext = () => { if (nextIdx >= 0) dispatch((st) => ({ revealedIdx: [...st.revealedIdx, nextIdx] })); };
  const toggleRetry = (answerIndex: number) => {
    dispatch((st) => ({
      retryAnswerIdx: st.retryAnswerIdx.includes(answerIndex)
        ? st.retryAnswerIdx.filter((i) => i !== answerIndex)
        : [...st.retryAnswerIdx, answerIndex],
    }));
  };

  // PC keyboard: Space/Enter reveals the next target, then advances.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (e.key === 'Escape') { props.onDeck(); return; }
      if (tag === 'input' || tag === 'textarea' || tag === 'button' || tag === 'select') return;
      if (!card) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (nextIdx >= 0) revealNext();
        else props.onComplete();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!card || targetIndexes.length <= 1) return;
    const focusIndex = nextIdx >= 0 ? nextIdx : state.revealedIdx[state.revealedIdx.length - 1];
    if (focusIndex === undefined) return;
    const frame = window.requestAnimationFrame(() => {
      const container = contentRef.current;
      if (!container || container.scrollHeight <= container.clientHeight + 8) return;
      const element = container.querySelector<HTMLElement>(`[data-study-answer-index="${focusIndex}"]`);
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      element?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [card, targetIndexes.length, nextIdx, state.revealedIdx]);

  if (!card) {
    const progress = list ? masterySummary(list.cards) : { total: 0, known: 0 };
    const remaining = progress.total - progress.known;
    const allMemorized = progress.total > 0 && remaining === 0;
    const resultStates: HideState[] = list
      ? list.cards.flatMap((item) => item.answerMastery.map((known) => known ? 'known' : 'retry'))
      : [];
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, paddingTop: 'env(safe-area-inset-top)', background: '#fff' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '0 32px 100px' }}>
          <div style={{ width: 88, height: 88, borderRadius: 999, background: 'rgba(52,199,89,0.14)', display: 'grid', placeItems: 'center', animation: 'popIn 0.4s cubic-bezier(0.3,1.4,0.4,1)' }}>
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#1e9e46" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em' }}>{state.review ? '복습 끝!' : '오늘 학습 끝!'}</div>
            <div style={{ fontSize: 15, color: 'rgba(60,60,67,0.6)', textAlign: 'center', lineHeight: 1.5 }}>
              {list ? (remaining === 0 ? `가림 ${progress.total}개 완료` : `가림 ${state.sessionTotal}개 확인 · 다시 ${remaining}개`) : ''}
            </div>
          </div>
          <HideStateMap states={resultStates} size="regular" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 10 }}>
            {remaining > 0 && (
              <button type="button" className="ui-button" onClick={props.onRetryRemaining} style={{ height: 50, borderRadius: 12, background: ACCENT, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 15.5, fontWeight: 700, color: '#fff' }}>가림 {remaining}개 다시</button>
            )}
            {allMemorized && (
              <button type="button" className="ui-button" onClick={props.onReviewAll} style={{ height: 50, borderRadius: 12, background: 'rgba(120,120,128,0.16)', display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 15.5, fontWeight: 700, color: '#48484a' }}>처음부터 복습</button>
            )}
            <button type="button" className="ui-button" onClick={props.onDeck} style={{ height: 50, borderRadius: 12, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 15.5, fontWeight: 600, color: '#6e6e73' }}>암기장으로</button>
          </div>
        </div>
      </div>
    );
  }

  const cardSegs: Array<{ text: string; kind: 'text' | 'next' | 'waiting' | 'revealed'; answer: string; answerIndex: number; target: boolean }> = [];
  if (isCloze) {
    qParts.forEach((t, i) => {
      cardSegs.push({ text: t, kind: 'text', answer: '', answerIndex: -1, target: false });
      if (i < qParts.length - 1) {
        const isTarget = targetSet.has(i);
        const kind = !isTarget || state.revealedIdx.includes(i) ? 'revealed' : i === nextIdx ? 'next' : 'waiting';
        cardSegs.push({ text: '', kind, answer: card.a[i] || '', answerIndex: i, target: isTarget });
      }
    });
  }

  const checkedInCard = targetIndexes.filter((i) => state.revealedIdx.includes(i)).length;
  const checkedTotal = state.sessionDone + checkedInCard;
  const progressPct = state.sessionTotal ? Math.round((checkedTotal / state.sessionTotal) * 100) : 0;
  const cardBadge = isCloze ? (nBlanks > 1 ? `가림 ${nBlanks}곳` : '가림 1곳') : (card.a.length > 1 ? `문답 · 답 ${card.a.length}개` : '문답');
  const tapHint = targetIndexes.length > 1
    ? `탭하면 다음 답 (${checkedInCard + 1}/${targetIndexes.length})`
    : '화면을 탭하면 답이 보여요';
  const keyboardHint = targetIndexes.length > 1
    ? `스페이스를 누르면 다음 답 (${checkedInCard + 1}/${targetIndexes.length})`
    : '스페이스를 누르면 답이 보여요';
  const liveHideStates: HideState[] = card.answerMastery.map((known, answerIndex) => {
    if (retrySet.has(answerIndex)) return 'retry';
    if (targetSet.has(answerIndex)) return state.revealedIdx.includes(answerIndex) ? 'checked' : 'pending';
    return known ? 'known' : 'retry';
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, paddingTop: 'env(safe-area-inset-top)', background: '#fff' }}>
      <div style={{ padding: '14px 20px 0', display: 'flex', alignItems: 'center', gap: 14 }}>
        <button type="button" className="ui-button" onClick={props.onDeck} aria-label="닫기" title="닫기" style={{ width: 44, height: 44, marginLeft: -14, borderRadius: 999, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.6)" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
        <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(120,120,128,0.16)', overflow: 'hidden' }}>
          <div style={{ width: `${progressPct}%`, height: '100%', borderRadius: 2, background: ACCENT, transition: 'width 0.35s cubic-bezier(0.3,0.9,0.4,1)' }} />
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(60,60,67,0.6)', fontVariantNumeric: 'tabular-nums' }}>{checkedTotal}/{state.sessionTotal}</span>
      </div>

      <div
        key={`${card.id}-${state.sessionDone}-${state.queue.length}`}
        role={allRevealed ? undefined : 'button'}
        tabIndex={allRevealed ? undefined : 0}
        aria-label={allRevealed ? undefined : isCloze ? `가림막 공개 ${checkedInCard + 1}/${targetIndexes.length}` : '답 공개'}
        onClick={() => { if (!allRevealed) revealNext(); }}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, animation: 'cardIn 0.3s cubic-bezier(0.3,0.9,0.4,1)', touchAction: 'pan-y', cursor: allRevealed ? 'default' : 'pointer' }}
      >
        <div style={{ padding: '26px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(60,60,67,0.5)', letterSpacing: '0.03em' }}>{cardBadge}{list ? ` · ${list.name}` : ''}</div>
          <HideStateMap states={liveHideStates} />
        </div>
        <div ref={contentRef} aria-live="polite" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 26, padding: '14px 24px 150px', minHeight: 0, overflowY: 'auto', scrollBehavior: 'smooth' }}>
          {!isCloze ? (
            <>
              <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.015em', lineHeight: 1.4, wordBreak: 'keep-all', whiteSpace: 'pre-line' }}>{card.q}</div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
                {card.a.map((answer, answerIndex) => {
                  const isTarget = targetSet.has(answerIndex);
                  const revealed = !isTarget || state.revealedIdx.includes(answerIndex);
                  if (!revealed) {
                    return <div key={answerIndex} data-study-answer-index={answerIndex} style={{ height: 42, borderRadius: 10, background: answerIndex === nextIdx ? 'rgba(0,122,255,0.16)' : 'rgba(120,120,128,0.12)', width: `${Math.max(7, Math.min(answer.length + 1, 18))}em`, maxWidth: '100%', fontSize: 16 }} />;
                  }
                  if (!allRevealed || !isTarget) {
                    return <div key={answerIndex} data-study-answer-index={answerIndex} style={{ borderLeft: `3px solid ${isTarget ? ACCENT : 'rgba(120,120,128,0.24)'}`, padding: '2px 0 2px 14px', color: isTarget ? '#1d1d1f' : 'rgba(60,60,67,0.62)', fontSize: 21, fontWeight: 700, wordBreak: 'keep-all', lineHeight: 1.45, whiteSpace: 'pre-line', animation: isTarget ? 'popIn 0.22s cubic-bezier(0.3,1.2,0.4,1)' : undefined }}>{answer}</div>;
                  }
                  const retry = retrySet.has(answerIndex);
                  return (
                    <button
                      key={answerIndex}
                      type="button"
                      className="token-button"
                      data-study-answer-index={answerIndex}
                      aria-pressed={retry}
                      onClick={(e) => { e.stopPropagation(); toggleRetry(answerIndex); }}
                      style={{ border: 0, borderLeft: `3px solid ${retry ? '#ff9500' : 'rgba(120,120,128,0.32)'}`, borderRadius: 6, padding: '2px 10px 2px 14px', background: retry ? 'rgba(255,149,0,0.12)' : 'rgba(120,120,128,0.07)', color: retry ? '#8a4d00' : '#1d1d1f', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', animation: 'popIn 0.22s cubic-bezier(0.3,1.2,0.4,1)' }}
                    >
                      <span style={{ fontSize: 21, fontWeight: 700, wordBreak: 'keep-all', lineHeight: 1.45, whiteSpace: 'pre-line' }}>{answer}</span>
                      {retry && <RotateCcw size={15} strokeWidth={2.4} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 2, wordBreak: 'keep-all', whiteSpace: 'pre-line' }}>
              {cardSegs.map((seg, i) => (
                <span key={i}>
                  <span>{seg.text}</span>
                  {seg.kind === 'next' && (
                    <span data-study-answer-index={seg.answerIndex} style={{ display: 'inline-block', minWidth: 68, height: 36, padding: '0 14px', borderRadius: 8, background: 'rgba(0,122,255,0.16)', verticalAlign: 'middle', margin: '0 3px' }} />
                  )}
                  {seg.kind === 'waiting' && (
                    <span data-study-answer-index={seg.answerIndex} style={{ display: 'inline-block', minWidth: 68, height: 36, padding: '0 14px', borderRadius: 8, background: 'rgba(120,120,128,0.12)', verticalAlign: 'middle', margin: '0 3px' }} />
                  )}
                  {seg.kind === 'revealed' && (
                    allRevealed && seg.target ? (
                      <button
                        type="button"
                        className="token-button"
                        data-study-answer-index={seg.answerIndex}
                        aria-pressed={retrySet.has(seg.answerIndex)}
                        onClick={(e) => { e.stopPropagation(); toggleRetry(seg.answerIndex); }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 7px', border: 0, borderBottom: `2px solid ${retrySet.has(seg.answerIndex) ? '#ff9500' : 'rgba(120,120,128,0.32)'}`, borderRadius: 6, background: retrySet.has(seg.answerIndex) ? 'rgba(255,149,0,0.12)' : 'rgba(120,120,128,0.07)', color: retrySet.has(seg.answerIndex) ? '#8a4d00' : '#1d1d1f', font: 'inherit', fontWeight: 800, lineHeight: 'inherit', margin: '0 3px', cursor: 'pointer', animation: 'popIn 0.22s cubic-bezier(0.3,1.2,0.4,1)' }}
                      >
                        {seg.answer}
                        {retrySet.has(seg.answerIndex) && <RotateCcw size={14} strokeWidth={2.4} aria-hidden="true" />}
                      </button>
                    ) : (
                      <span data-study-answer-index={seg.answerIndex} style={{ display: 'inline-block', padding: '0 2px', borderBottom: `2px solid ${seg.target ? ACCENT : 'rgba(120,120,128,0.24)'}`, color: seg.target ? ACCENT_DEEP : 'rgba(60,60,67,0.62)', fontWeight: 800, margin: '0 3px', animation: seg.target ? 'popIn 0.22s cubic-bezier(0.3,1.2,0.4,1)' : undefined }}>{seg.answer}</span>
                    )
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
            {isPc ? keyboardHint : tapHint}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
            <div style={{ minHeight: 15, textAlign: 'center', fontSize: 12, color: 'rgba(60,60,67,0.5)', fontWeight: 600, visibility: retrySet.size > 0 ? 'hidden' : 'visible' }}>
              몰랐던 답을 탭하세요
            </div>
            <button type="button" className="study-judge-button" onClick={props.onComplete} style={{ width: '100%', height: 50, padding: '0 16px', borderRadius: 12, border: 'none', background: ACCENT, color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', pointerEvents: 'auto', fontFamily: 'inherit', fontSize: 15.5, fontWeight: 800 }}>
              {retrySet.size > 0 ? `다음 · 다시 ${retrySet.size}개` : '다음'}
            </button>
          </div>
        )}
      </div>
    </div>
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
  const dirty = editSignature(state.editMode, state.editQ, state.editA, state.editTokens) !== state.editInitialSignature;

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
      <div onClick={() => { if (!dirty) dispatch({ editSheetOpen: false }); }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)', zIndex: 15 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: '20px 20px 0 0', background: '#fff', padding: '18px 20px 42px', display: 'flex', flexDirection: 'column', gap: 13, boxShadow: '0 -12px 40px rgba(0,0,0,0.16)', animation: 'sheetUp 0.32s cubic-bezier(0.3,0.9,0.4,1)', maxHeight: '82%', zIndex: 16 }}>
        <div style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(120,120,128,0.25)', alignSelf: 'center', flexShrink: 0 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 80px', alignItems: 'center', flexShrink: 0 }}>
          <button type="button" className="ui-button" onClick={() => dispatch({ editSheetOpen: false })} style={{ minWidth: 44, minHeight: 40, justifySelf: 'start', background: 'transparent', color: '#6e6e73', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {dirty ? '변경 취소' : '닫기'}
          </button>
          <div style={{ display: 'flex', gap: 6, justifySelf: 'center' }}>
            <button type="button" className="ui-button" onClick={setQA} aria-pressed={state.editMode === 'qa'} style={{ padding: '8px 14px', borderRadius: 9, cursor: 'pointer', ...chip(state.editMode === 'qa') }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>문답형</span></button>
            <button type="button" className="ui-button" onClick={setCloze} aria-pressed={state.editMode === 'tokens'} style={{ padding: '8px 14px', borderRadius: 9, cursor: 'pointer', ...chip(state.editMode === 'tokens') }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>가림형</span></button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
            {!dirty && idx > 0 && (
              <button type="button" className="ui-button" onClick={goPrev} aria-label="이전 카드" style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(120,120,128,0.1)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1d1d1f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
              </button>
            )}
            {!dirty && idx >= 0 && idx < cardsAll.length - 1 && (
              <button type="button" className="ui-button" onClick={goNext} aria-label="다음 카드" style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(120,120,128,0.1)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1d1d1f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            )}
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
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#6e6e73', letterSpacing: '0.03em' }}>내용</span>
              <textarea rows={3} value={state.editText} onChange={onEditText} placeholder="문장 전체를 쓰세요" style={{ fontSize: 16.5, fontWeight: 600, border: 'none', background: 'transparent', color: '#000', padding: '2px 0', resize: 'none', lineHeight: 1.5 }} />
            </div>
            <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(120,120,128,0.08)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 2px', lineHeight: 1.9, overflowY: 'auto', minHeight: 0 }}>
              {props.renderTokenChips(state.editTokens, -100, 15)}
              <span style={{ width: '100%', fontSize: 12.5, color: ACCENT_DEEP, fontWeight: 700, marginTop: 2 }}>가릴 답을 탭하세요</span>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4, flexShrink: 0 }}>
          <button type="button" className="ui-button" onClick={props.onDelete} style={{ height: 50, padding: '0 20px', borderRadius: 12, background: 'rgba(255,59,48,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#ff3b30' }}>삭제</span>
          </button>
          <button type="button" className="ui-button" onClick={save} disabled={!dirty} style={{ flex: 1, height: 50, borderRadius: 12, background: dirty ? ACCENT : 'rgba(120,120,128,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: dirty ? 'pointer' : 'default' }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: dirty ? '#fff' : 'rgba(60,60,67,0.35)' }}>저장</span>
          </button>
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
        <div style={{ fontSize: 20, fontWeight: 800 }}>동기화 코드</div>
        <div style={{ fontSize: 13.5, color: '#5f5f65', lineHeight: 1.5 }}>다른 기기(PC·아이폰)에서 <strong style={{ color: '#1d1d1f' }}>같은 코드</strong>를 입력하면 같은 카드 데이터를 봐요. 코드를 아는 사람도 불러올 수 있으니 안전하게 보관하세요.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, borderRadius: 12, background: '#F7F7F9', padding: '0 8px 0 16px' }}>
          <span style={{ flex: 1, fontSize: 18, fontWeight: 800, color: '#1d1d1f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props.roomCode}</span>
          <button type="button" className="ui-button" onClick={copy} style={{ height: 40, padding: '0 16px', borderRadius: 9, background: copied ? 'rgba(52,199,89,0.15)' : ACCENT, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0, fontSize: 14.5, fontWeight: 700, color: copied ? '#1e9e46' : '#fff' }}>{copied ? '복사됨 ✓' : '복사'}</button>
        </div>
        <div style={{ height: 0.5, background: 'rgba(60,60,67,0.1)', margin: '2px 0' }} />
        <label htmlFor="change-sync-code" style={{ fontSize: 12.5, fontWeight: 700, color: '#6e6e73' }}>다른 코드로 바꾸기</label>
        <input id="change-sync-code" value={value} onChange={(e) => setValue(e.target.value)} style={{ height: 48, borderRadius: 11, border: '1px solid rgba(60,60,67,0.18)', background: '#fff', padding: '0 14px', fontSize: 16, fontWeight: 600, color: '#000' }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="ui-button" onClick={props.onClose} style={{ flex: 1, height: 48, borderRadius: 11, background: 'rgba(120,120,128,0.12)', display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 16, fontWeight: 700, color: '#48484a' }}>닫기</button>
          <button type="button" className="ui-button" onClick={() => { if (changed) props.onChangeRoom(normalizeRoomCode(value)); }} disabled={!changed} style={{ flex: 1, height: 48, borderRadius: 11, background: changed ? ACCENT : 'rgba(120,120,128,0.12)', display: 'grid', placeItems: 'center', cursor: changed ? 'pointer' : 'default', fontSize: 16, fontWeight: 700, color: changed ? '#fff' : 'rgba(60,60,67,0.55)' }}>바꾸기</button>
        </div>
      </div>
    </>
  );
}
