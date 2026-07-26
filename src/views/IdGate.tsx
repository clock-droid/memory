import { useState } from 'react';
import { ACCENT } from '../constants';
import { normalizeRoomCode } from '../domain/roomCode';
import { ClozeFlowGraphic } from './ClozeFlowGraphic';

type Props = {
  accountConfigured: boolean;
  accountPending: boolean;
  accountError: boolean;
  onDevice: () => void;
  onAccount: (provider: 'google' | 'kakao') => void;
  onLegacy: (roomCode: string) => void;
};

export function IdGate(props: Props) {
  const [showExisting, setShowExisting] = useState(false);
  const [value, setValue] = useState('');
  const normalized = normalizeRoomCode(value);
  const hasInvalid = value.trim().replace(/[A-Za-z0-9_\s-]/g, '').length > 0;
  const submitLegacy = () => {
    if (normalized) props.onLegacy(normalized);
  };

  if (!showExisting) {
    const accountDisabled = !props.accountConfigured || props.accountPending;
    return (
      <div style={{ minHeight: 'var(--app-viewport-height, 100dvh)', width: '100%', maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', padding: 'calc(env(safe-area-inset-top) + 54px) 24px calc(env(safe-area-inset-bottom) + 28px)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 29, fontWeight: 800, letterSpacing: '-0.035em' }}>시험암기</div>
          <div style={{ maxWidth: 360, fontSize: 16, color: '#5f5f65', lineHeight: 1.65, wordBreak: 'keep-all' }}>
            암기할 내용에서 여러 곳을 가리고, <span style={{ fontWeight: 700, color: '#1d1d1f' }}>몰랐던 부분만 다시</span> 외워요.
          </div>
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
          <ClozeFlowGraphic />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 24 }}>
          <button
            type="button"
            className="ui-button"
            onClick={props.onDevice}
            style={{ width: '100%', minHeight: 54, borderRadius: 13, background: ACCENT, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 16.5, fontWeight: 800, color: '#fff' }}
          >
            이 기기에서 시작
          </button>
          <div style={{ color: '#6e6e73', fontSize: 12.5, lineHeight: 1.5, textAlign: 'center' }}>
            로그인 없이 저장돼요. 다른 기기와는 자동으로 동기화되지 않아요.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0 12px', color: '#8e8e93', fontSize: 12.5, fontWeight: 650 }}>
          <span style={{ flex: 1, height: 0.5, background: 'rgba(60,60,67,0.18)' }} />
          여러 기기에서 사용
          <span style={{ flex: 1, height: 0.5, background: 'rgba(60,60,67,0.18)' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
          <button
            type="button"
            className="ui-button"
            onClick={() => props.onAccount('google')}
            disabled={accountDisabled}
            style={{ minHeight: 48, borderRadius: 12, border: '1px solid rgba(60,60,67,0.18)', background: '#fff', cursor: accountDisabled ? 'default' : 'pointer', fontSize: 14.5, fontWeight: 750, color: accountDisabled ? '#aeaeb2' : '#1d1d1f' }}
          >
            Google
          </button>
          <button
            type="button"
            className="ui-button"
            onClick={() => props.onAccount('kakao')}
            disabled={accountDisabled}
            style={{ minHeight: 48, borderRadius: 12, background: accountDisabled ? 'rgba(120,120,128,0.12)' : '#FEE500', cursor: accountDisabled ? 'default' : 'pointer', fontSize: 14.5, fontWeight: 750, color: accountDisabled ? '#aeaeb2' : '#191919' }}
          >
            Kakao
          </button>
        </div>

        <div role="status" aria-live="polite" style={{ minHeight: 34, paddingTop: 7, color: props.accountError ? '#c9342c' : '#6e6e73', fontSize: 12, lineHeight: 1.45, textAlign: 'center', wordBreak: 'keep-all' }}>
          {props.accountError
            ? '로그인을 완료하지 못했어요. 연결을 확인하고 다시 시도해 주세요.'
            : !props.accountConfigured
              ? '계정 동기화 서버를 연결한 뒤 사용할 수 있어요.'
              : props.accountPending
                ? '로그인 화면을 여는 중…'
                : '로그인하면 계정에 저장되어 다른 기기에서도 이어서 볼 수 있어요.'}
        </div>

        <button
          type="button"
          className="ui-button"
          onClick={() => setShowExisting(true)}
          style={{ alignSelf: 'center', minHeight: 44, padding: '0 8px', background: 'transparent', color: ACCENT, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
        >
          기존 동기화 코드 불러오기
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: 'var(--app-viewport-height, 100dvh)', width: '100%', maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', padding: 'calc(env(safe-area-inset-top) + 18px) 24px calc(env(safe-area-inset-bottom) + 32px)' }}>
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
          이전에 사용하던 동기화 코드를 입력하세요.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 28 }}>
        <label htmlFor="sync-code" style={{ fontSize: 12.5, fontWeight: 700, color: '#6e6e73', letterSpacing: '0.02em' }}>동기화 코드</label>
        <input
          id="sync-code"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') submitLegacy(); }}
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
        onClick={submitLegacy}
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
