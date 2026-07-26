import { useEffect, useRef, useState } from 'react';
import type { Dispatch, PointerEvent as ReactPointerEvent } from 'react';
import { ACCENT, ACCENT_DEEP } from '../constants';
import { parsePaste, toggleTokenAt, tokensToCard } from '../domain/tokens';
import { qaToNewCard } from '../domain/cards';
import { contentFingerprint, newOperationId } from '../sync/operationId';
import type { Patch } from '../state/patchState';
import type { ComposerState } from '../state/uiSlices';
import type { NewCard } from '../domain/types';
import { TokenChips } from './TokenChips';

function qaHasMatchingBlanks(question: string) {
  const blankCount = question.match(/___/g)?.length ?? 0;
  return blankCount === 0 || blankCount === 1;
}

// 목록은 그대로 둔 채 아래에 붙는 비모달 작성 패널이다.
// 저장 후 패널을 닫지 않고 입력만 비워 연속 추가와 목록 확인을 함께 지원한다.
export function ContinuousAddView(props: {
  composer: ComposerState; setComposer: Dispatch<Patch<ComposerState>>;
  onAddCards: (cards: NewCard[], operationId: string) => Promise<boolean>;
  onUndoLast: () => Promise<number>;
  onClose: () => void;
}) {
  const { composer, setComposer } = props;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const savingRef = useRef(false);
  const dragStartY = useRef(0);
  const dragYRef = useRef(0);
  const draggingRef = useRef(false);
  const [lastAddedCount, setLastAddedCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dragY, setDragY] = useState(0);
  const close = () => {
    if (savingRef.current) return;
    dragYRef.current = 0;
    draggingRef.current = false;
    setDragY(0);
    props.onClose();
  };

  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  // re-parse on every keystroke but keep words the user already masked
  const reparse = (text: string, mode: 'auto' | 'one') => (current: ComposerState): Partial<ComposerState> => {
    const hiddenWords = new Set(
      current.rows.flatMap((r) => (r.kind === 'tokens' ? r.tokens.filter((t) => t.hidden).map((t) => t.word) : [])),
    );
    let g = 7000;
    const rows = parsePaste(text, mode).map((r) =>
      r.kind === 'tokens'
        ? { ...r, tokens: r.tokens.map((t) => (!t.nl && hiddenWords.has(t.word) ? { ...t, hidden: true, gid: g++ } : t)) }
        : r,
    );
    return { text, mode, rows };
  };

  const invalidQaBlanks = composer.rows.filter((r) => r.kind === 'qa' && !qaHasMatchingBlanks(r.q)).length;
  const validRows = composer.rows.filter((r) =>
    r.kind === 'qa' ? qaHasMatchingBlanks(r.q) : r.tokens.some((t) => t.hidden),
  );
  const tokenRows = composer.rows.filter((r) => r.kind === 'tokens');
  const incomplete = tokenRows.filter((r) => r.kind === 'tokens' && !r.tokens.some((t) => t.hidden)).length;
  const blanks = tokenRows.reduce((n, r) => n + (r.kind === 'tokens' && r.tokens.some((t) => t.hidden) ? tokensToCard(r.tokens).a.length : 0), 0);
  const multi = composer.rows.length > 1;

  const add = async () => {
    if (validRows.length === 0 || savingRef.current) return;
    const cards = validRows.map((r) => {
      if (r.kind === 'qa') return qaToNewCard(r.q, [r.a]);
      const { q, a } = tokensToCard(r.tokens);
      return qaToNewCard(q, a);
    });
    const operationId = `${composer.operationId}-append-${contentFingerprint(JSON.stringify(cards))}`;
    const submittedDraft = JSON.stringify([composer.text, composer.mode, composer.rows]);
    savingRef.current = true;
    setSaving(true);
    let saved = false;
    try {
      saved = await props.onAddCards(cards, operationId);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (!saved) return;
    const nextOperationId = newOperationId();
    setLastAddedCount(cards.length);
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setLastAddedCount(0), 4500);
    setComposer((current) => JSON.stringify([current.text, current.mode, current.rows]) === submittedDraft
      ? { text: '', mode: 'auto', rows: [], operationId: nextOperationId, selection: null }
      : { operationId: nextOperationId });
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const undoLast = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    let undone = 0;
    try {
      undone = await props.onUndoLast();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (undone === 0) return;
    setLastAddedCount(0);
    window.clearTimeout(undoTimer.current);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onDismissPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (savingRef.current) return;
    event.preventDefault();
    draggingRef.current = true;
    dragStartY.current = event.clientY;
    dragYRef.current = 0;
    setDragY(0);
    window.addEventListener('pointermove', onDismissPointerMove);
    window.addEventListener('pointerup', finishDismissGesture, { once: true });
    window.addEventListener('pointercancel', finishDismissGesture, { once: true });
  };

  function onDismissPointerMove(event: PointerEvent) {
    if (!draggingRef.current) return;
    const next = Math.max(0, event.clientY - dragStartY.current);
    dragYRef.current = next;
    setDragY(next);
  }

  function finishDismissGesture() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    window.removeEventListener('pointermove', onDismissPointerMove);
    window.removeEventListener('pointerup', finishDismissGesture);
    window.removeEventListener('pointercancel', finishDismissGesture);
    if (dragYRef.current >= 72) {
      close();
      return;
    }
    dragYRef.current = 0;
    setDragY(0);
  }

  return (
    <div
      data-card-composer-layer="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 12,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'center',
      }}
    >
      {lastAddedCount > 0 && (
        <div
          role="status"
          aria-live="polite"
          style={{
            pointerEvents: 'auto',
            width: 'max-content',
            maxWidth: 'calc(100% - 32px)',
            minHeight: 48,
            marginBottom: 10,
            padding: '0 8px 0 16px',
            borderRadius: 11,
            background: 'rgba(29,29,31,0.94)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            animation: 'popIn 0.2s cubic-bezier(0.3,1.2,0.4,1)',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            {lastAddedCount > 1 ? `카드 ${lastAddedCount}개가 추가됐어요` : '카드가 추가됐어요'}
          </span>
          <button
            type="button"
            className="ui-button"
            onClick={undoLast}
            disabled={saving}
            style={{
              minWidth: 64,
              minHeight: 36,
              padding: '0 10px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.14)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              cursor: saving ? 'default' : 'pointer',
              fontSize: 13.5,
              fontWeight: 800,
            }}
          >
            되돌리기
          </button>
        </div>
      )}

      <section
        className="card-composer-dock"
        aria-label="카드 추가"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        }}
        style={{
          pointerEvents: 'auto',
          transform: `translateY(${dragY}px)`,
          transition: draggingRef.current ? 'none' : 'transform 0.2s cubic-bezier(0.3,0.9,0.4,1)',
        }}
      >
        <div
          className="card-composer-handle"
          aria-label="아래로 밀어 카드 추가 닫기"
          role="button"
          tabIndex={0}
          onPointerDown={onDismissPointerDown}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        >
          <span />
        </div>

        <div style={{ minHeight: 44, padding: '0 18px', display: 'grid', gridTemplateColumns: '64px 1fr 64px', alignItems: 'center', flexShrink: 0 }}>
          <span />
          <h2 style={{ margin: 0, textAlign: 'center', fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>카드 추가</h2>
          <button
            type="button"
            className="ui-button"
            onClick={close}
            disabled={saving}
            style={{ minWidth: 44, minHeight: 44, justifySelf: 'end', background: 'transparent', color: ACCENT, fontSize: 15.5, fontWeight: 700, cursor: saving ? 'default' : 'pointer', textAlign: 'right' }}
          >
            취소
          </button>
        </div>

        <div className="card-composer-scroll">
          <label htmlFor="new-memory-content" style={{ fontSize: 14.5, fontWeight: 800, color: '#1d1d1f' }}>암기할 내용</label>
          <textarea
            ref={inputRef}
            id="new-memory-content"
            autoFocus
            disabled={saving}
            rows={Math.min(4, Math.max(2, composer.text.split('\n').length))}
            value={composer.text}
            onChange={(event) => { if (!savingRef.current) setComposer(reparse(event.target.value, composer.mode)); }}
            placeholder={'내용을 입력하거나 붙여넣으세요\n예: 대한민국의 수도는 서울이다'}
            style={{
              width: '100%',
              minHeight: 82,
              border: '1px solid rgba(60,60,67,0.14)',
              borderRadius: 11,
              background: '#fff',
              color: '#000',
              padding: '12px 13px',
              fontSize: 16,
              fontWeight: 600,
              lineHeight: 1.5,
              resize: 'none',
              display: 'block',
              flexShrink: 0,
            }}
          />

          <div style={{ minHeight: 20, color: 'rgba(60,60,67,0.58)', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
            {composer.rows.length === 0
              ? '내용을 입력하세요'
              : incomplete > 0 && validRows.length > 0
                ? `${incomplete}줄은 가릴 부분이 없어 빠져요`
                : blanks > 0
                  ? `가림 ${blanks}곳 선택됨`
                  : tokenRows.length > 0 ? '가릴 부분을 탭하세요' : ''}
          </div>

          {multi && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(60,60,67,0.55)' }}>{composer.rows.length}줄</span>
              <div style={{ display: 'flex', padding: 2, borderRadius: 8, background: 'rgba(120,120,128,0.12)' }}>
                {([['auto', '줄마다 추가'], ['one', '한 카드로']] as const).map(([mode, label]) => (
                  <button
                    type="button"
                    className="ui-button"
                    key={mode}
                    onClick={() => { if (!savingRef.current) setComposer(reparse(composer.text, mode)); }}
                    disabled={saving}
                    aria-pressed={composer.mode === mode}
                    style={{ minHeight: 32, padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: saving ? 'default' : 'pointer', background: composer.mode === mode ? '#fff' : 'transparent', color: composer.mode === mode ? '#1d1d1f' : '#6e6e73', boxShadow: composer.mode === mode ? '0 1px 2px rgba(0,0,0,0.1)' : 'none' }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {invalidQaBlanks > 0 && (
            <div role="alert" style={{ color: '#8a4d00', fontSize: 13, fontWeight: 650, flexShrink: 0 }}>
              가림 수와 답 수가 다른 문답 {invalidQaBlanks}줄은 빠져요
            </div>
          )}

          {composer.rows.map((row, rowIndex) => row.kind === 'qa' ? (
            <div key={rowIndex} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 11px', borderRadius: 10, background: 'rgba(120,120,128,0.07)', flexShrink: 0 }}>
              <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, lineHeight: 1.5, wordBreak: 'keep-all' }}>{row.q}</span>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: ACCENT_DEEP, flexShrink: 0 }}>{row.a}</span>
            </div>
          ) : (
            <div key={rowIndex} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '7px 4px', lineHeight: 1.8, flexShrink: 0 }}>
              <TokenChips
                tokens={row.tokens}
                selection={composer.selection?.row === rowIndex ? composer.selection : null}
                fontSize={15.5}
                outlined
                disabled={saving}
                onSelectStart={(index, wasHidden) => setComposer({ selection: { row: rowIndex, start: index, end: index, wasHidden } })}
                onSelectExtend={(index) => setComposer((current) => (current.selection?.row === rowIndex
                  ? { selection: { ...current.selection, end: index } }
                  : {}))}
                onToggle={(index) => setComposer((current) => ({
                  rows: current.rows.map((currentRow, currentIndex) => (currentIndex === rowIndex && currentRow.kind === 'tokens'
                    ? { ...currentRow, tokens: toggleTokenAt(currentRow.tokens, index) }
                    : currentRow)),
                  selection: null,
                }))}
              />
            </div>
          ))}
        </div>

        <div style={{ padding: '10px 16px calc(12px + env(safe-area-inset-bottom))', flexShrink: 0 }}>
          <button
            type="button"
            className="ui-button"
            onClick={add}
            disabled={validRows.length === 0 || saving}
            style={{ width: '100%', height: 50, borderRadius: 12, background: validRows.length > 0 && !saving ? ACCENT : 'rgba(0,122,255,0.24)', color: '#fff', display: 'grid', placeItems: 'center', cursor: validRows.length > 0 && !saving ? 'pointer' : 'default', fontSize: 15.5, fontWeight: 800, transition: 'background 0.15s, transform 0.12s' }}
          >
            {saving ? '추가 중…' : validRows.length > 1 ? `카드 ${validRows.length}개 추가` : '카드 추가'}
          </button>
        </div>
      </section>
    </div>
  );
}
