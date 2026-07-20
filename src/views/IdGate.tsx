import { useState } from 'react';
import { ACCENT } from '../constants';
import { createRoomCode, normalizeRoomCode } from '../domain/roomCode';
import { ClozeFlowGraphic } from './ClozeFlowGraphic';

export function IdGate({ onSubmit }: { onSubmit: (code: string) => void }) {
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
            암기할 내용에서 여러 곳을 가리고, <span style={{ fontWeight: 700, color: '#1d1d1f' }}>몰랐던 부분만 다시</span> 외워요.
          </div>
        </div>

        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center' }}>
          <ClozeFlowGraphic />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 30 }}>
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
