import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Dispatch } from 'react';
import { ACCENT, ACCENT_DEEP } from '../constants';
import { masterySummary, weakestFirst } from '../domain/cards';
import { dueHides, hideTexts } from '../domain/hides';
import type { ProtoCard, ProtoList } from '../domain/cards';
import type { Patch } from '../state/patchState';
import type { DeckUiState } from '../state/uiSlices';
import { usePcHints } from './usePcHints';
import { HideStateMap } from './HideStateMap';

export function DeckView(props: {
  list: ProtoList; deck: DeckUiState; setDeck: Dispatch<Patch<DeckUiState>>;
  shuffle: boolean; onToggleShuffle: () => void;
  lpTimer: React.MutableRefObject<number | undefined>; rowStart: React.MutableRefObject<{ x: number; y: number; moved: boolean }>;
  onHome: () => void; onRename: (name: string) => void;
  onDelete: (card: ProtoCard) => void; onEdit: (card: ProtoCard) => void; onMove: (draggedId: string, targetId: string) => void;
  onDeleteList: () => void;
  onStart: (ids: string[]) => void; onStartCheckup: () => void; onOpenAdd: () => void; toast: (msg: string) => void;
}) {
  const { list, deck, setDeck, shuffle, lpTimer, rowStart } = props;
  const isPc = usePcHints();
  const [nameDraft, setNameDraft] = useState(list.name);
  const nameTimer = useRef<number | undefined>(undefined);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  // Row gestures (swipe-delete, long-press reorder) are invisible — explain them
  // once on the first deck visit, then stay quiet.
  const [showGuide] = useState(() => !localStorage.getItem('exam-memorizer-hint-seen'));
  useEffect(() => { try { localStorage.setItem('exam-memorizer-hint-seen', '1'); } catch { /* noop */ } }, []);
  useEffect(() => { setNameDraft(list.name); }, [list.id, list.name]);
  useEffect(() => () => window.clearTimeout(nameTimer.current), []);
  const cardsAll = list.cards;
  const filterFn = (c: ProtoCard) => (deck.filter === 'done' ? c.memorized : deck.filter === 'unknown' ? c.remainingCount > 0 : true);
  const visible = cardsAll.filter(filterFn);
  const repairCards = visible.filter((c) => c.needsRepair);
  const learningCards = weakestFirst(visible.filter((c) => !c.needsRepair && c.remainingCount > 0));
  const doneCards = visible.filter((c) => c.memorized);
  const studyCards = visible.filter((c) => !c.needsRepair && c.remainingCount > 0);
  const reviewCards = visible.filter((c) => !c.needsRepair);
  const deckTotal = cardsAll.length;
  const totalRepairCount = cardsAll.filter((c) => c.needsRepair).length;
  const mastery = masterySummary(cardsAll);
  const deckPct = mastery.total ? Math.round((mastery.known / mastery.total) * 100) : 0;
  const cntUnknown = cardsAll.filter((c) => c.remainingCount > 0).length;
  const cntDone = cardsAll.filter((c) => c.memorized).length;
  // Known hides whose FSRS check date has passed — recomputed per render so the
  // count follows judgments without a timer.
  const checkupNow = Date.now();
  const checkupDueCount = cardsAll.reduce(
    (total, c) => c.needsRepair ? total : total + dueHides(c.hides, checkupNow).length,
    0,
  );

  useEffect(() => {
    if ((deck.filter === 'unknown' && cntUnknown === 0) || (deck.filter === 'done' && cntDone === 0)) {
      setDeck({ filter: 'all', openRowId: null });
    }
  }, [deck.filter, cntUnknown, cntDone, setDeck]);

  const cardGroup = (c: ProtoCard) => (c.needsRepair ? 'repair' : c.memorized ? 'done' : 'learning');

  const segsFor = (c: ProtoCard) => {
    if (c.needsRepair) {
      return [
        { text: `${c.q.replaceAll('___', '[가림]')}  `, chip: false, chipText: '' },
        { text: '', chip: true, chipText: '답을 입력하세요' },
      ];
    }
    const parts = c.q.split('___');
    const segs: Array<{ text: string; chip: boolean; chipText: string }> = [];
    if (parts.length > 1) {
      parts.forEach((t, i) => {
        segs.push({ text: t, chip: false, chipText: '' });
        if (i < parts.length - 1) segs.push({ text: '', chip: true, chipText: c.hides[i]?.text ?? '' });
      });
    } else {
      segs.push({ text: `${c.q}  `, chip: false, chipText: '' });
      segs.push({ text: '', chip: true, chipText: hideTexts(c.hides).join(', ') });
    }
    return segs;
  };

  const rowPointerDown = (c: ProtoCard, isOpen: boolean) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.focus({ preventScroll: true });
    rowStart.current = { x: e.clientX, y: e.clientY, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    window.clearTimeout(lpTimer.current);
    lpTimer.current = window.setTimeout(() => {
      if (!rowStart.current.moved) setDeck({ rowDrag: null, reorder: { id: c.id, dy: 0 } });
    }, 350);
    setDeck({ rowDrag: { id: c.id, x: isOpen ? -82 : 0, base: isOpen ? -82 : 0 } });
  };

  const rowPointerMove = (c: ProtoCard) => (e: ReactPointerEvent<HTMLDivElement>) => {
    setDeck((st) => {
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
    const re = deck.reorder;
    if (re && re.id === c.id) {
      const overId = re.overId;
      setDeck({ reorder: null });
      if (overId) {
        const target = list.cards.find((cc) => cc.id === overId);
        if (target && cardGroup(target) === cardGroup(c)) window.setTimeout(() => props.onMove(c.id, target.id), 0);
        else if (target) props.toast('같은 그룹 안에서만 이동할 수 있어요');
      }
      return;
    }
    setDeck((st) => {
      const rd = st.rowDrag;
      if (!rd || rd.id !== c.id) return {};
      if (!rowStart.current.moved) {
        if (!isOpen) props.onEdit(c);
        return { rowDrag: null, openRowId: null };
      }
      return { rowDrag: null, openRowId: rd.x < -45 ? c.id : null };
    });
  };

  const focusDeleteButton = (cardId: string) => {
    window.requestAnimationFrame(() => deleteButtonRefs.current.get(cardId)?.focus({ preventScroll: true }));
  };

  const rowKeyDown = (c: ProtoCard) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      props.onEdit(c);
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      props.onDelete(c);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setDeck({ openRowId: c.id, rowDrag: null });
      focusDeleteButton(c.id);
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'Escape') {
      event.preventDefault();
      setDeck({ openRowId: null, rowDrag: null });
    }
  };

  const closeDeleteAction = (cardId: string) => {
    setDeck({ openRowId: null, rowDrag: null });
    window.requestAnimationFrame(() => rowRefs.current.get(cardId)?.focus({ preventScroll: true }));
  };

  const rows: Array<{ header: true; label: string; dot: string } | { header: false; card: ProtoCard }> = [];
  if (repairCards.length > 0) {
    rows.push({ header: true, label: `수정 필요 ${repairCards.length}`, dot: '#ff3b30' });
    repairCards.forEach((c) => rows.push({ header: false, card: c }));
  }
  if (learningCards.length > 0) {
    const retryCount = learningCards.reduce((total, card) => total + card.remainingCount, 0);
    rows.push({ header: true, label: `다시 ${retryCount}`, dot: '#ff9500' });
    learningCards.forEach((c) => rows.push({ header: false, card: c }));
  }
  if (doneCards.length > 0) {
    rows.push({ header: true, label: `완료 ${doneCards.length}`, dot: '#34c759' });
    doneCards.forEach((c) => rows.push({ header: false, card: c }));
  }

  const startEnabled = reviewCards.length > 0;
  const startLabel = deckTotal === 0 ? '카드를 먼저 추가하세요'
    : studyCards.length > 0 ? `가림 ${studyCards.reduce((total, card) => total + card.remainingCount, 0)}개 시작`
    : reviewCards.length > 0 ? '복습하기'
    : repairCards.length > 0 ? '답을 먼저 입력하세요' : '카드 없음';

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
            onClick={props.onToggleShuffle}
            aria-label="섞기" aria-pressed={shuffle} title="섞기"
            style={{ width: 44, height: 44, borderRadius: 12, background: shuffle ? 'rgba(0,122,255,0.14)' : 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={shuffle ? ACCENT : 'rgba(60,60,67,0.5)'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" /><path d="m18 2 4 4-4 4" /><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" /><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" /><path d="m18 14 4 4-4 4" /></svg>
          </button>
          {!list.synthetic && (
            <button type="button" className="ui-button" onClick={props.onDeleteList} aria-label="암기장 삭제" title="암기장 삭제" style={{ width: 44, height: 44, borderRadius: 12, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: '0 20px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(120,120,128,0.16)', overflow: 'hidden' }}>
          <div style={{ width: `${deckPct}%`, height: '100%', background: '#34c759' }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: totalRepairCount > 0 ? '#b42318' : '#6e6e73', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{totalRepairCount > 0 ? `수정 필요 ${totalRepairCount}` : mastery.total === 0 ? '가림 없음' : `${mastery.known}/${mastery.total} 가림`}</span>
      </div>

      {checkupDueCount > 0 && (
        <div style={{ padding: '0 16px 10px' }}>
          <button
            type="button"
            className="ui-button"
            onClick={props.onStartCheckup}
            style={{ width: '100%', minHeight: 52, padding: '10px 14px', borderRadius: 12, background: 'rgba(255,149,0,0.1)', border: '1px solid rgba(255,149,0,0.28)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left' }}
          >
            <RotateCcw size={17} strokeWidth={2.4} color="#8a4d00" aria-hidden="true" style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: '#8a4d00' }}>다시 점검할 가림 {checkupDueCount}개</span>
              <span style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'rgba(138,77,0,0.75)', lineHeight: 1.4, wordBreak: 'keep-all' }}>외운 지 시간이 지나 잊었을 수 있어요</span>
            </span>
            <svg width="8" height="13" viewBox="0 0 8 13" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M1.5 1.5L6.5 6.5l-5 5" stroke="rgba(138,77,0,0.55)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      )}

      <div style={{ margin: '0 16px 4px', display: 'flex', padding: 2, borderRadius: 9, background: 'rgba(120,120,128,0.12)' }}>
        {chips.map((chip) => {
          const active = deck.filter === chip.key;
          return (
            <button type="button" className="ui-button" key={chip.key} onClick={() => setDeck({ filter: chip.key, openRowId: null })} aria-pressed={active} disabled={chip.disabled} style={{ flex: 1, height: 44, borderRadius: 7, display: 'grid', placeItems: 'center', background: active ? '#fff' : 'transparent', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', cursor: chip.disabled ? 'default' : 'pointer', opacity: chip.disabled ? 0.42 : 1, transition: 'background 0.15s, opacity 0.15s' }}>
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

      <span id="card-row-keyboard-help" className="sr-only">Enter 또는 스페이스로 수정하고, Delete 키로 삭제합니다. 왼쪽 화살표를 누르면 삭제 버튼이 열립니다.</span>

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
          const isOpen = deck.openRowId === c.id;
          const isDragging = deck.rowDrag && deck.rowDrag.id === c.id;
          const isRe = deck.reorder && deck.reorder.id === c.id;
          const x = isDragging ? deck.rowDrag!.x : (isOpen ? -82 : 0);
          const dropActive = !!(deck.reorder && deck.reorder.id !== c.id && deck.reorder.overId === c.id);
          // grouped list: round only the first/last row of each contiguous run
          const firstInGroup = idx === 0 || rows[idx - 1].header;
          const lastInGroup = idx === rows.length - 1 || rows[idx + 1].header;
          const radius = `${firstInGroup ? 12 : 0}px ${firstInGroup ? 12 : 0}px ${lastInGroup ? 12 : 0}px ${lastInGroup ? 12 : 0}px`;
          return (
            <div key={c.id} data-cid={c.id} style={{ position: 'relative', borderRadius: radius, overflow: 'hidden', flexShrink: 0, transform: isRe ? `translateY(${deck.reorder!.dy}px) scale(1.02)` : 'none', transition: isRe ? 'none' : 'transform 0.2s cubic-bezier(0.3,0.9,0.4,1), margin 0.16s ease', zIndex: isRe ? 10 : 'auto', boxShadow: isRe ? '0 12px 28px rgba(0,0,0,0.18)' : 'none', opacity: isRe ? 0.9 : 1, marginTop: dropActive ? 12 : 0 }}>
              {dropActive && <div style={{ position: 'absolute', top: -7, left: 8, right: 8, height: 3, borderRadius: 2, background: ACCENT, zIndex: 11 }} />}
              <button
                ref={(element) => { if (element) deleteButtonRefs.current.set(c.id, element); else deleteButtonRefs.current.delete(c.id); }}
                type="button"
                className="ui-button"
                onClick={() => props.onDelete(c)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    closeDeleteAction(c.id);
                  }
                }}
                tabIndex={isOpen ? 0 : -1}
                aria-hidden={!isOpen}
                aria-label={`${c.q.replaceAll('___', '가림')} 카드 삭제`}
                style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 82, background: '#ff3b30', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
              >
                <span style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>삭제</span>
              </button>
              <div
                ref={(element) => { if (element) rowRefs.current.set(c.id, element); else rowRefs.current.delete(c.id); }}
                className="card-row-action"
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                aria-describedby="card-row-keyboard-help"
                aria-label={c.needsRepair
                  ? `${c.q.replaceAll('___', '가림')} 카드 수정 필요. 답을 입력하세요`
                  : `${c.q.replaceAll('___', '가림')} ${hideTexts(c.hides).join(', ')} 카드 수정. 가림 ${c.knownCount}/${c.hides.length} 완료`}
                aria-keyshortcuts="Enter Space Delete ArrowLeft"
                onKeyDown={rowKeyDown(c)}
                onPointerDown={rowPointerDown(c, isOpen)}
                onPointerMove={rowPointerMove(c)}
                onPointerUp={rowPointerUp(c, isOpen)}
                onPointerCancel={() => {
                  window.clearTimeout(lpTimer.current);
                  setDeck({ rowDrag: null, reorder: null });
                }}
                style={{ padding: '11px 14px', background: '#fff', display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', transform: `translateX(${x}px)`, transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.3,0.9,0.4,1)', touchAction: 'pan-y', boxShadow: lastInGroup ? 'none' : 'inset 0 -1px 0 rgba(60,60,67,0.08)' }}
              >
                <div style={{ flex: 1, fontSize: 15, fontWeight: 600, lineHeight: 1.6, wordBreak: 'keep-all', minWidth: 0, pointerEvents: 'none', opacity: c.memorized ? 0.55 : 1, whiteSpace: 'pre-line' }}>
                  {segsFor(c).map((seg, i) => (
                    <span key={i}>
                      <span>{seg.text}</span>
                      {seg.chip && <span style={{ color: ACCENT_DEEP, fontWeight: 700, margin: '0 2px' }}>{seg.chipText}</span>}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0, paddingTop: 3, pointerEvents: 'none', color: c.needsRepair ? '#b42318' : c.memorized ? '#1e9e46' : '#6e6e73' }}>
                  {!c.needsRepair && <HideStateMap states={c.hides.map((hide) => hide.known ? 'known' : 'retry')} />}
                  <span style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{c.needsRepair ? '수정 필요' : `${c.knownCount}/${c.hides.length}`}</span>
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
            if (studyCards.length > 0) props.onStart(weakestFirst(studyCards).map((c) => c.id));
            else if (reviewCards.length > 0) props.onStart(reviewCards.map((c) => c.id));
            else if (repairCards.length > 0) props.toast('답이 없는 카드를 먼저 수정해 주세요');
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
