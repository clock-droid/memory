import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { ACCENT } from '../constants';
import { toggleTokenAt } from '../tokens';
import type { Token } from '../tokens';
import type { Patch, UIState } from '../uiState';

// Renders a run of tokens as tap/drag-selectable chips. The active selection
// lives in the shared UI state (`sel`); pointer-down/enter update it and the
// window pointer-up in App commits it. `ri` identifies which token run this is:
// -100 is the edit sheet's tokens, otherwise it indexes into `sheetRows`.
export function TokenChips({ tokens, ri, fontSize, outlined = false, sel, dispatch }: {
  tokens: Token[];
  ri: number;
  fontSize: number;
  outlined?: boolean;
  sel: UIState['sel'];
  dispatch: (p: Patch) => void;
}) {
  const views = tokens.map((t, ti) => {
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

  return (
    <>
      {views.map((tv) =>
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
        ),
      )}
    </>
  );
}
