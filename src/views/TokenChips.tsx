import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { ACCENT } from '../constants';
import type { Token } from '../domain/tokens';

/**
 * Renders a run of tokens as tap/drag-selectable chips.
 *
 * The component owns no state: the parent holds the tokens and the active
 * selection, so the same chips work for a composer row and for the edit sheet
 * without either one knowing about the other.
 */
export function TokenChips({ tokens, selection, fontSize, outlined = false, disabled = false, onSelectStart, onSelectExtend, onToggle }: {
  tokens: Token[];
  /** The active selection when it belongs to this run of tokens, else null. */
  selection: { start: number; end: number } | null;
  fontSize: number;
  outlined?: boolean;
  disabled?: boolean;
  onSelectStart: (index: number, wasHidden: boolean) => void;
  onSelectExtend: (index: number) => void;
  onToggle: (index: number) => void;
}) {
  const views = tokens.map((t, ti) => {
    if (t.nl) return { brk: true as const, key: ti };
    const inSel = !!selection
      && ti >= Math.min(selection.start, selection.end)
      && ti <= Math.max(selection.start, selection.end);
    const marked = t.hidden || inSel;
    return {
      brk: false as const, key: ti, word: t.word, tail: t.tail, marked,
      // plain words, blue cover on the marked ones — reads as "text with parts
      // painted over", not a pile of buttons
      bg: marked ? ACCENT : 'transparent', fg: marked ? '#fff' : '#1d1d1f', fw: marked ? 700 : 600, padX: marked ? 8 : 3,
      bd: '1px solid transparent',
      onDown: (e: ReactPointerEvent) => {
        if (disabled) return;
        e.stopPropagation();
        try { (e.target as Element).releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
        onSelectStart(ti, t.hidden);
      },
      onEnter: () => {
        if (!disabled) onSelectExtend(ti);
      },
      onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (disabled) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        onToggle(ti);
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
              disabled={disabled}
              aria-pressed={tv.marked}
              aria-label={`${tv.word}${tv.tail} ${tv.marked ? '가림 해제' : '가리기'}`}
              style={outlined ? {
                display: 'inline-flex', alignItems: 'center', minHeight: 46, padding: '8px 14px', borderRadius: 11,
                background: tv.marked ? ACCENT : '#fff', color: tv.marked ? '#fff' : '#1d1d1f',
                border: tv.marked ? '1px solid transparent' : '1px solid rgba(60,60,67,0.14)',
                boxShadow: tv.marked ? '0 2px 5px rgba(0,122,255,0.18)' : '0 1px 2px rgba(0,0,0,0.02)',
                boxSizing: 'border-box', fontSize, fontWeight: tv.marked ? 700 : 600, lineHeight: 1.3,
                cursor: disabled ? 'default' : 'pointer', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
              } : {
                display: 'inline-flex', alignItems: 'center', minHeight: 36, padding: `5px ${tv.padX + 2}px`, borderRadius: 8,
                background: tv.bg, color: tv.fg, border: tv.bd, boxSizing: 'border-box', fontSize, fontWeight: tv.fw,
                lineHeight: 1.35, cursor: disabled ? 'default' : 'pointer', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
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
