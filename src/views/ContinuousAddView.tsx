import { useEffect, useRef, useState } from 'react';
import { ACCENT, ACCENT_DEEP } from '../constants';
import { parsePaste, tokensToCard } from '../tokens';
import { qaToNewCard } from '../cards';
import type { Patch, UIState } from '../uiState';
import type { NewCard } from '../types';
import { TokenChips } from './TokenChips';

// 추가 중에는 목록 관리 UI를 모두 치우고 현재 입력에만 집중한다.
// 저장 후 편집기를 닫지 않고 비운 뒤 다시 포커스해 연속 입력을 지원한다.
export function ContinuousAddView(props: {
  state: UIState; dispatch: (p: Patch) => void;
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
              <TokenChips tokens={r.tokens} ri={ri} fontSize={16} outlined sel={state.sel} dispatch={dispatch} />
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
