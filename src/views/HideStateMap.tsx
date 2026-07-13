import { ACCENT } from '../constants';

export type HideState = 'known' | 'retry' | 'pending' | 'checked';

export function HideStateMap({ states, size = 'compact' }: { states: HideState[]; size?: 'compact' | 'regular' }) {
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
