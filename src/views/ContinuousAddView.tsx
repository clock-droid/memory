import { useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
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

// 추가 중에는 목록 관리 UI를 모두 치우고 현재 입력에만 집중한다.
// 저장 후 편집기를 닫지 않고 비운 뒤 다시 포커스해 연속 입력을 지원한다.
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
  const [addedCount, setAddedCount] = useState(0);
  const [lastAddedCount, setLastAddedCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const close = () => { if (!savingRef.current) props.onClose(); };

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
    setAddedCount((count) => count + cards.length);
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
    setAddedCount((count) => Math.max(0, count - undone));
    setLastAddedCount(0);
    window.clearTimeout(undoTimer.current);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', background: '#F2F2F7', paddingTop: 'env(safe-area-inset-top)' }}>
      <div style={{ height: 60, padding: '6px 16px 0', display: 'grid', gridTemplateColumns: '76px 1fr 76px', alignItems: 'center', flexShrink: 0 }}>
        <button type="button" className="ui-button" onClick={close} disabled={saving} style={{ minWidth: 44, minHeight: 44, justifySelf: 'start', background: 'transparent', color: ACCENT, fontSize: 16.5, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
          {saving ? '저장 중…' : '닫기'}
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
              disabled={saving}
              rows={Math.min(6, Math.max(4, composer.text.split('\n').length))}
              value={composer.text}
              onChange={(e) => { if (!savingRef.current) setComposer(reparse(e.target.value, composer.mode)); }}
              placeholder={'내용을 입력하거나 붙여넣으세요\n예: 대한민국의 수도는 서울이다'}
              style={{ width: '100%', minHeight: 124, border: 'none', background: 'transparent', color: '#000', fontSize: 17, fontWeight: 600, lineHeight: 1.55, resize: 'none', display: 'block' }}
            />
          </div>
        </div>

        {composer.rows.length > 0 && (
          <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {multi && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(60,60,67,0.55)' }}>{composer.rows.length}줄</span>
              <div style={{ display: 'flex', padding: 2, borderRadius: 8, background: 'rgba(120,120,128,0.12)' }}>
                {([['auto', '줄마다 추가'], ['one', '한 카드로']] as const).map(([mode, label]) => (
                  <button type="button" className="ui-button" key={mode} onClick={() => { if (!savingRef.current) setComposer(reparse(composer.text, mode)); }} disabled={saving} aria-pressed={composer.mode === mode} style={{ minHeight: 34, padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: saving ? 'default' : 'pointer', background: composer.mode === mode ? '#fff' : 'transparent', color: composer.mode === mode ? '#1d1d1f' : '#6e6e73', boxShadow: composer.mode === mode ? '0 1px 2px rgba(0,0,0,0.1)' : 'none' }}>{label}</button>
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
          {invalidQaBlanks > 0 && (
            <div role="alert" style={{ color: '#8a4d00', fontSize: 13.5, fontWeight: 650 }}>
              가림 수와 답 수가 다른 문답 {invalidQaBlanks}줄은 빠져요
            </div>
          )}

          {composer.rows.map((r, ri) => r.kind === 'qa' ? (
            <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 10, background: 'rgba(120,120,128,0.07)' }}>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600, lineHeight: 1.5, wordBreak: 'keep-all' }}>{r.q}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: ACCENT_DEEP, flexShrink: 0 }}>{r.a}</span>
            </div>
          ) : (
            <div key={ri} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '7px 4px', lineHeight: 1.9 }}>
              <TokenChips
                tokens={r.tokens}
                selection={composer.selection?.row === ri ? composer.selection : null}
                fontSize={16}
                outlined
                disabled={saving}
                onSelectStart={(index, wasHidden) => setComposer({ selection: { row: ri, start: index, end: index, wasHidden } })}
                onSelectExtend={(index) => setComposer((current) => (current.selection?.row === ri
                  ? { selection: { ...current.selection, end: index } }
                  : {}))}
                onToggle={(index) => setComposer((current) => ({
                  rows: current.rows.map((row, rowIndex) => (rowIndex === ri && row.kind === 'tokens'
                    ? { ...row, tokens: toggleTokenAt(row.tokens, index) }
                    : row)),
                  selection: null,
                }))}
              />
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
