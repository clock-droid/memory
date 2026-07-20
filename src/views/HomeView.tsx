import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ACCENT } from '../constants';
import { masterySummary } from '../domain/cards';
import type { ProtoList } from '../domain/cards';
import type { SyncStatus } from '../sync/syncHealth';
import { ClozeFlowGraphic } from './ClozeFlowGraphic';

function EmptyStateAction(props: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="primary-action-button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      style={props.disabled ? { opacity: 0.5, cursor: 'default' } : undefined}
    >
      {props.label}
    </button>
  );
}

function SyncFailureState(props: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      aria-labelledby="sync-error-title"
      style={{ padding: '52px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
    >
      <div id="sync-error-title" style={{ fontSize: 18, fontWeight: 750, letterSpacing: '-0.01em' }}>
        암기장을 불러오지 못했어요
      </div>
      <div style={{ maxWidth: 300, color: 'rgba(60,60,67,0.68)', fontSize: 14, lineHeight: 1.55 }}>
        인터넷 연결을 확인한 뒤 다시 시도해 주세요.<br />서버에 저장된 암기장이 지워진 것은 아니에요.
      </div>
      <div style={{ marginTop: 8 }}>
        <EmptyStateAction label="다시 시도" onClick={props.onRetry} />
      </div>
    </div>
  );
}

function StaleSyncNotice(props: { pending: boolean; onRetry: () => void }) {
  return (
    <div
      role="status"
      style={{ marginBottom: 14, padding: '12px 13px', borderRadius: 12, background: '#FFF7E8', color: '#6B4600', display: 'flex', alignItems: 'center', gap: 10 }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 750 }}>
          {props.pending ? '최신 상태를 확인하고 있어요' : '최신 내용을 불러오지 못했어요'}
        </div>
        <div style={{ marginTop: 2, fontSize: 12.5, lineHeight: 1.4, opacity: 0.82 }}>
          마지막으로 불러온 내용을 표시합니다. 연결 전에는 학습하거나 수정할 수 없어요.
        </div>
      </div>
      <button
        type="button"
        className="ui-button"
        onClick={props.onRetry}
        disabled={props.pending}
        style={{ minWidth: 70, minHeight: 44, padding: '0 10px', borderRadius: 10, background: 'rgba(107,70,0,0.1)', color: '#6B4600', cursor: props.pending ? 'default' : 'pointer', fontSize: 13, fontWeight: 750, opacity: props.pending ? 0.62 : 1 }}
      >
        {props.pending ? '연결 중…' : '다시 시도'}
      </button>
    </div>
  );
}

export function HomeView(props: {
  lists: ProtoList[]; decksState: SyncStatus; syncPending: boolean;
  onOpenList: (list: ProtoList) => void; onContinue: (list: ProtoList) => void;
  onNewList: () => void; onOpenSettings: () => void; onRetry: () => void;
}) {
  const { lists, decksState } = props;
  const canShowContent = decksState === 'ready' || decksState === 'stale';
  const canInteract = decksState === 'ready';
  const contList = lists.find((l) => l.cards.some((c) => c.remainingCount > 0));
  const contRemain = contList ? contList.cards.reduce((total, card) => total + card.remainingCount, 0) : 0;
  const activateWithKeyboard = (action: () => void) => (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    action();
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, paddingTop: 'env(safe-area-inset-top)' }}>
      <div style={{ padding: '18px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>내 암기장</div>
        <button type="button" className="ui-button" onClick={props.onOpenSettings} aria-label="설정" title="설정" style={{ width: 44, height: 44, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px calc(env(safe-area-inset-bottom) + 32px)', minHeight: 0 }}>
        {decksState === 'loading' && (
          <div style={{ padding: '44px 20px', textAlign: 'center', color: 'rgba(60,60,67,0.45)', fontSize: 15 }}>불러오는 중…</div>
        )}
        {decksState === 'error' && <SyncFailureState onRetry={props.onRetry} />}
        {decksState === 'stale' && <StaleSyncNotice pending={props.syncPending} onRetry={props.onRetry} />}
        {canShowContent && lists.length === 0 && (
          <div style={{ padding: '24px 0 38px', textAlign: 'center', color: 'rgba(60,60,67,0.62)', fontSize: 15, lineHeight: 1.55, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
            <ClozeFlowGraphic />
            <div>외울 문장에서 가릴 부분을 고르면<br />모르는 가림만 다시 학습할 수 있어요.</div>
            <EmptyStateAction label="첫 암기장 만들기" onClick={props.onNewList} disabled={!canInteract} />
          </div>
        )}

        {canShowContent && contList && (
          <button type="button" className="ui-button" onClick={() => props.onContinue(contList)} disabled={!canInteract} style={{ width: '100%', marginBottom: 16, padding: '12px 14px', borderRadius: 12, background: ACCENT, color: '#fff', display: 'flex', alignItems: 'center', gap: 12, cursor: canInteract ? 'pointer' : 'default', opacity: canInteract ? 1 : 0.5 }}>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.82 }}>이어서 암기 · 가림 {contRemain}개</span>
              <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contList.name}</span>
            </span>
            <span style={{ width: 32, height: 32, borderRadius: 999, background: 'rgba(255,255,255,0.24)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <svg width="12" height="14" viewBox="0 0 16 18"><path d="M2 1.5v15l13-7.5z" fill="#fff" /></svg>
            </span>
          </button>
        )}

        {canShowContent && lists.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
            {lists.map((l) => {
              const progress = masterySummary(l.cards);
              const repairCount = l.cards.filter((card) => card.needsRepair).length;
              const allDone = repairCount === 0 && progress.total > 0 && progress.known === progress.total;
              return (
                <div key={`${l.deckId}:${l.id}`} onClick={canInteract ? () => props.onOpenList(l) : undefined} onKeyDown={canInteract ? activateWithKeyboard(() => props.onOpenList(l)) : undefined} role="button" tabIndex={canInteract ? 0 : -1} aria-disabled={!canInteract} aria-label={`${l.name} 열기`} style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: canInteract ? 'pointer' : 'default', borderBottom: '1px solid rgba(60,60,67,0.08)', opacity: canInteract ? 1 : 0.62 }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                    <div style={{ fontSize: 12.5, color: repairCount > 0 ? '#b42318' : '#6e6e73' }}>{l.cards.length === 0 ? '카드 없음' : repairCount > 0 ? `수정 필요 ${repairCount} · 카드 ${l.cards.length}개` : `가림 ${progress.known}/${progress.total} · 카드 ${l.cards.length}개`}</div>
                  </div>
                  {allDone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#1e9e46', flexShrink: 0 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1e9e46" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>전부 외움</span>
                    </div>
                  )}
                  <svg width="7" height="12" viewBox="0 0 8 14" style={{ flexShrink: 0 }}><path d="M1 1l6 6-6 6" stroke="rgba(60,60,67,0.3)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
              );
            })}
            <button type="button" className="ui-button" onClick={props.onNewList} disabled={!canInteract} aria-label="새 암기장 만들기" style={{ width: '100%', padding: '12px 14px', background: 'transparent', display: 'flex', alignItems: 'center', gap: 8, cursor: canInteract ? 'pointer' : 'default', opacity: canInteract ? 1 : 0.5 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
              <span style={{ fontSize: 14, fontWeight: 600, color: ACCENT }}>새 암기장</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
