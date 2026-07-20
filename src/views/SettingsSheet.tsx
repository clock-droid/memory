import { useEffect, useRef, useState } from 'react';
import { ACCENT } from '../constants';
import { normalizeRoomCode } from '../domain/roomCode';
import { readJudgeHintEnabled, writeJudgeHintEnabled } from './judgeHint';
import { ModalSheet } from './ModalSheet';

type CopyStatus = 'idle' | 'copying' | 'success' | 'error';

export function SettingsSheet(props: { roomCode: string; onClose: () => void; onChangeRoom: (code: string) => void }) {
  const [value, setValue] = useState(props.roomCode);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const [judgeHintEnabled, setJudgeHintEnabled] = useState(readJudgeHintEnabled);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const copyResetTimer = useRef<number | undefined>(undefined);
  const changed = normalizeRoomCode(value) && normalizeRoomCode(value) !== props.roomCode;

  useEffect(() => () => window.clearTimeout(copyResetTimer.current), []);

  const toggleJudgeHint = () => {
    const next = !judgeHintEnabled;
    setJudgeHintEnabled(next);
    writeJudgeHintEnabled(next);
  };
  const copy = async () => {
    if (copyStatus === 'copying') return;
    window.clearTimeout(copyResetTimer.current);
    setCopyStatus('copying');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable');
      await navigator.clipboard.writeText(props.roomCode);
      setCopyStatus('success');
    } catch {
      setCopyStatus('error');
    }
    copyResetTimer.current = window.setTimeout(() => setCopyStatus('idle'), 2500);
  };
  const copyLabel = copyStatus === 'copying' ? '복사 중…'
    : copyStatus === 'success' ? '복사됨 ✓'
    : copyStatus === 'error' ? '다시 복사'
    : '복사';

  return (
    <ModalSheet title="동기화 코드" showTitle onRequestClose={props.onClose} initialFocusRef={copyButtonRef}>
        <div style={{ fontSize: 13.5, color: '#5f5f65', lineHeight: 1.5 }}>다른 기기(PC·아이폰)에서 <strong style={{ color: '#1d1d1f' }}>같은 코드</strong>를 입력하면 같은 카드 데이터를 봐요. 코드를 아는 사람도 불러올 수 있으니 안전하게 보관하세요.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, borderRadius: 12, background: '#F7F7F9', padding: '0 8px 0 16px' }}>
          <span style={{ flex: 1, fontSize: 18, fontWeight: 800, color: '#1d1d1f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'all' }}>{props.roomCode}</span>
          <button
            ref={copyButtonRef}
            type="button"
            className="ui-button"
            onClick={copy}
            disabled={copyStatus === 'copying'}
            aria-describedby="sync-code-copy-status"
            style={{ minHeight: 44, padding: '0 16px', borderRadius: 9, background: copyStatus === 'success' ? 'rgba(52,199,89,0.15)' : ACCENT, display: 'grid', placeItems: 'center', cursor: copyStatus === 'copying' ? 'default' : 'pointer', flexShrink: 0, fontSize: 14.5, fontWeight: 700, color: copyStatus === 'success' ? '#1e9e46' : '#fff' }}
          >
            {copyLabel}
          </button>
        </div>
        <div id="sync-code-copy-status" role="status" aria-live="polite" style={{ minHeight: 18, marginTop: -8, fontSize: 12.5, fontWeight: 600, color: copyStatus === 'error' ? '#c9342c' : '#1e9e46' }}>
          {copyStatus === 'error' ? '복사하지 못했어요. 코드를 길게 눌러 복사해 주세요.' : copyStatus === 'success' ? '동기화 코드를 복사했어요.' : ''}
        </div>
        <div style={{ height: 0.5, background: 'rgba(60,60,67,0.1)', margin: '2px 0' }} />
        <label htmlFor="change-sync-code" style={{ fontSize: 12.5, fontWeight: 700, color: '#6e6e73' }}>다른 코드로 바꾸기</label>
        <input id="change-sync-code" value={value} onChange={(e) => setValue(e.target.value)} style={{ height: 48, borderRadius: 11, border: '1px solid rgba(60,60,67,0.18)', background: '#fff', padding: '0 14px', fontSize: 16, fontWeight: 600, color: '#000' }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="ui-button" onClick={props.onClose} style={{ flex: 1, height: 48, borderRadius: 11, background: 'rgba(120,120,128,0.12)', display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 16, fontWeight: 700, color: '#48484a' }}>닫기</button>
          <button type="button" className="ui-button" onClick={() => { if (changed) props.onChangeRoom(normalizeRoomCode(value)); }} disabled={!changed} style={{ flex: 1, height: 48, borderRadius: 11, background: changed ? ACCENT : 'rgba(120,120,128,0.12)', display: 'grid', placeItems: 'center', cursor: changed ? 'pointer' : 'default', fontSize: 16, fontWeight: 700, color: changed ? '#fff' : 'rgba(60,60,67,0.55)' }}>바꾸기</button>
        </div>
        <div style={{ height: 0.5, background: 'rgba(60,60,67,0.1)', margin: '2px 0' }} />
        <button
          type="button"
          className="ui-button"
          onClick={toggleJudgeHint}
          aria-pressed={judgeHintEnabled}
          style={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1d1d1f' }}>판정 안내 강조</span>
            <span style={{ fontSize: 12.5, color: '#6e6e73', lineHeight: 1.45 }}>학습 중 &apos;몰랐던 답을 탭하세요&apos;를 눈에 띄게 보여줘요.</span>
          </span>
          <span style={{ flexShrink: 0, width: 46, height: 27, borderRadius: 999, background: judgeHintEnabled ? ACCENT : 'rgba(120,120,128,0.28)', position: 'relative', transition: 'background 0.15s' }}>
            <span style={{ position: 'absolute', top: 2, left: judgeHintEnabled ? 21 : 2, width: 23, height: 23, borderRadius: 999, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.15s cubic-bezier(0.3,0.9,0.4,1)' }} />
          </span>
        </button>
    </ModalSheet>
  );
}
