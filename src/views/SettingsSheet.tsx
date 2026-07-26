import { useEffect, useRef, useState } from 'react';
import { ACCENT } from '../constants';
import { normalizeRoomCode } from '../domain/roomCode';
import type { RepositoryTarget } from '../sync/storageSelection';
import { readJudgeHintEnabled, writeJudgeHintEnabled } from './judgeHint';
import { ModalSheet } from './ModalSheet';
import { ServiceLinks } from './ServiceLinks';

type CopyStatus = 'idle' | 'copying' | 'success' | 'error';

type Props = {
  target: RepositoryTarget;
  accountConfigured: boolean;
  accountPending: boolean;
  accountEmail?: string;
  accountError: boolean;
  transferPending: boolean;
  onClose: () => void;
  onChangeLegacy: (roomCode: string) => void;
  onTransferToAccount: (provider?: 'google' | 'kakao') => void;
  onSignOut: () => void;
};

export function SettingsSheet(props: Props) {
  const roomCode = props.target.kind === 'legacy' ? props.target.roomCode : '';
  const [value, setValue] = useState(roomCode);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const [judgeHintEnabled, setJudgeHintEnabled] = useState(readJudgeHintEnabled);
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const copyResetTimer = useRef<number | undefined>(undefined);
  const changedRoomCode = normalizeRoomCode(value)
    && normalizeRoomCode(value) !== roomCode;

  useEffect(() => () => window.clearTimeout(copyResetTimer.current), []);

  const toggleJudgeHint = () => {
    const next = !judgeHintEnabled;
    setJudgeHintEnabled(next);
    writeJudgeHintEnabled(next);
  };
  const copy = async () => {
    if (copyStatus === 'copying' || !roomCode) return;
    window.clearTimeout(copyResetTimer.current);
    setCopyStatus('copying');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable');
      await navigator.clipboard.writeText(roomCode);
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
  const accountActionDisabled = !props.accountConfigured
    || props.accountPending
    || props.transferPending;

  return (
    <ModalSheet title="저장 및 설정" showTitle onRequestClose={props.onClose} initialFocusRef={firstButtonRef}>
      {props.target.kind === 'device' && (
        <>
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 750, color: '#1d1d1f' }}>이 기기에 저장 중</div>
            <div style={{ marginTop: 5, fontSize: 13, color: '#6e6e73', lineHeight: 1.5 }}>
              로그인 없이 사용할 수 있지만 앱을 삭제하면 복구할 수 없어요.
            </div>
          </div>
          <button ref={firstButtonRef} type="button" className="ui-button" onClick={props.onClose} style={{ width: '100%', minHeight: 46, borderRadius: 11, background: 'rgba(120,120,128,0.12)', color: '#48484a', cursor: 'pointer', fontSize: 15, fontWeight: 700, textAlign: 'center' }}>
            닫기
          </button>
        </>
      )}

      {props.target.kind === 'legacy' && (
        <>
          <div style={{ fontSize: 13.5, color: '#5f5f65', lineHeight: 1.5 }}>
            동기화 코드로 연결되어 있어요. 코드를 아는 사람도 데이터를 볼 수 있으니 안전하게 보관하세요.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, borderRadius: 12, background: '#F7F7F9', padding: '0 8px 0 16px' }}>
            <span style={{ flex: 1, fontSize: 16, fontWeight: 800, color: '#1d1d1f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'all' }}>{roomCode}</span>
            <button
              ref={firstButtonRef}
              type="button"
              className="ui-button"
              onClick={copy}
              disabled={copyStatus === 'copying'}
              aria-describedby="sync-code-copy-status"
              style={{ minHeight: 44, padding: '0 16px', borderRadius: 9, background: copyStatus === 'success' ? 'rgba(52,199,89,0.15)' : ACCENT, cursor: copyStatus === 'copying' ? 'default' : 'pointer', flexShrink: 0, fontSize: 14.5, fontWeight: 700, color: copyStatus === 'success' ? '#1e9e46' : '#fff' }}
            >
              {copyLabel}
            </button>
          </div>
          <div id="sync-code-copy-status" role="status" aria-live="polite" style={{ minHeight: 18, marginTop: -8, fontSize: 12.5, fontWeight: 600, color: copyStatus === 'error' ? '#c9342c' : '#1e9e46' }}>
            {copyStatus === 'error' ? '복사하지 못했어요. 코드를 길게 눌러 복사해 주세요.' : copyStatus === 'success' ? '동기화 코드를 복사했어요.' : ''}
          </div>
          <label htmlFor="change-sync-code" style={{ fontSize: 12.5, fontWeight: 700, color: '#6e6e73' }}>다른 코드로 바꾸기</label>
          <input id="change-sync-code" value={value} onChange={(event) => setValue(event.target.value)} style={{ height: 48, borderRadius: 11, border: '1px solid rgba(60,60,67,0.18)', background: '#fff', padding: '0 14px', fontSize: 16, fontWeight: 600, color: '#000' }} />
          <button
            type="button"
            className="ui-button"
            onClick={() => { if (changedRoomCode) props.onChangeLegacy(normalizeRoomCode(value)); }}
            disabled={!changedRoomCode}
            style={{ height: 48, borderRadius: 11, background: changedRoomCode ? ACCENT : 'rgba(120,120,128,0.12)', cursor: changedRoomCode ? 'pointer' : 'default', fontSize: 16, fontWeight: 700, color: changedRoomCode ? '#fff' : 'rgba(60,60,67,0.55)' }}
          >
            이 코드로 바꾸기
          </button>
        </>
      )}

      {props.target.kind === 'account' && (
        <>
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 750, color: '#1d1d1f' }}>계정으로 동기화 중</div>
            <div style={{ marginTop: 5, fontSize: 13, color: '#6e6e73', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
              {props.accountEmail ?? '로그인된 계정'}
            </div>
          </div>
          <button
            ref={firstButtonRef}
            type="button"
            className="ui-button"
            onClick={props.onSignOut}
            disabled={props.accountPending}
            style={{ height: 46, borderRadius: 11, background: 'rgba(120,120,128,0.12)', cursor: props.accountPending ? 'default' : 'pointer', fontSize: 15, fontWeight: 700, color: '#48484a' }}
          >
            {props.accountPending ? '로그아웃 중…' : '이 기기에서 로그아웃'}
          </button>
        </>
      )}

      {props.target.kind !== 'account' && (
        <>
          <div style={{ height: 0.5, background: 'rgba(60,60,67,0.1)', margin: '2px 0' }} />
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 750, color: '#1d1d1f' }}>계정으로 옮기기</div>
            <div style={{ marginTop: 5, fontSize: 12.5, color: '#6e6e73', lineHeight: 1.5, wordBreak: 'keep-all' }}>
              현재 카드를 계정으로 복사해 다른 기기에서도 이어서 볼 수 있어요. 지금 저장본은 지우지 않아요.
            </div>
          </div>
          {props.accountEmail ? (
            <button
              type="button"
              className="ui-button"
              onClick={() => props.onTransferToAccount()}
              disabled={accountActionDisabled}
              style={{ minHeight: 48, borderRadius: 11, background: accountActionDisabled ? 'rgba(0,122,255,0.25)' : ACCENT, cursor: accountActionDisabled ? 'default' : 'pointer', fontSize: 15, fontWeight: 750, color: '#fff' }}
            >
              {props.transferPending ? '계정으로 옮기는 중…' : '로그인된 계정으로 옮기기'}
            </button>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              <button type="button" className="ui-button" onClick={() => props.onTransferToAccount('google')} disabled={accountActionDisabled} style={{ minHeight: 46, borderRadius: 11, border: '1px solid rgba(60,60,67,0.18)', background: '#fff', cursor: accountActionDisabled ? 'default' : 'pointer', fontSize: 14, fontWeight: 750, color: accountActionDisabled ? '#aeaeb2' : '#1d1d1f' }}>
                Google
              </button>
              <button type="button" className="ui-button" onClick={() => props.onTransferToAccount('kakao')} disabled={accountActionDisabled} style={{ minHeight: 46, borderRadius: 11, background: accountActionDisabled ? 'rgba(120,120,128,0.12)' : '#FEE500', cursor: accountActionDisabled ? 'default' : 'pointer', fontSize: 14, fontWeight: 750, color: accountActionDisabled ? '#aeaeb2' : '#191919' }}>
                Kakao
              </button>
            </div>
          )}
          <div role="status" aria-live="polite" style={{ minHeight: 18, marginTop: -4, fontSize: 12, lineHeight: 1.45, color: props.accountError ? '#c9342c' : '#6e6e73' }}>
            {props.accountError
              ? '계정 연결을 완료하지 못했어요. 다시 시도해 주세요.'
              : !props.accountConfigured
                ? '계정 동기화 서버를 연결한 뒤 사용할 수 있어요.'
                : ''}
          </div>
        </>
      )}

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
      <ServiceLinks />
    </ModalSheet>
  );
}
