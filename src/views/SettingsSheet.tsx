import { useState } from 'react';
import { ACCENT } from '../constants';
import { normalizeRoomCode } from '../roomCode';

export function SettingsSheet(props: { roomCode: string; onClose: () => void; onChangeRoom: (code: string) => void }) {
  const [value, setValue] = useState(props.roomCode);
  const [copied, setCopied] = useState(false);
  const changed = normalizeRoomCode(value) && normalizeRoomCode(value) !== props.roomCode;
  const copy = () => {
    try { navigator.clipboard?.writeText(props.roomCode); } catch { /* clipboard blocked (e.g. sandbox) */ }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <>
      <div onClick={props.onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)', zIndex: 15 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: '20px 20px 0 0', background: '#fff', padding: '18px 20px 42px', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 -12px 40px rgba(0,0,0,0.16)', animation: 'sheetUp 0.32s cubic-bezier(0.3,0.9,0.4,1)', zIndex: 16 }}>
        <div style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(120,120,128,0.25)', alignSelf: 'center' }} />
        <div style={{ fontSize: 20, fontWeight: 800 }}>동기화 코드</div>
        <div style={{ fontSize: 13.5, color: '#5f5f65', lineHeight: 1.5 }}>다른 기기(PC·아이폰)에서 <strong style={{ color: '#1d1d1f' }}>같은 코드</strong>를 입력하면 같은 카드 데이터를 봐요. 코드를 아는 사람도 불러올 수 있으니 안전하게 보관하세요.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, borderRadius: 12, background: '#F7F7F9', padding: '0 8px 0 16px' }}>
          <span style={{ flex: 1, fontSize: 18, fontWeight: 800, color: '#1d1d1f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props.roomCode}</span>
          <button type="button" className="ui-button" onClick={copy} style={{ height: 40, padding: '0 16px', borderRadius: 9, background: copied ? 'rgba(52,199,89,0.15)' : ACCENT, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0, fontSize: 14.5, fontWeight: 700, color: copied ? '#1e9e46' : '#fff' }}>{copied ? '복사됨 ✓' : '복사'}</button>
        </div>
        <div style={{ height: 0.5, background: 'rgba(60,60,67,0.1)', margin: '2px 0' }} />
        <label htmlFor="change-sync-code" style={{ fontSize: 12.5, fontWeight: 700, color: '#6e6e73' }}>다른 코드로 바꾸기</label>
        <input id="change-sync-code" value={value} onChange={(e) => setValue(e.target.value)} style={{ height: 48, borderRadius: 11, border: '1px solid rgba(60,60,67,0.18)', background: '#fff', padding: '0 14px', fontSize: 16, fontWeight: 600, color: '#000' }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="ui-button" onClick={props.onClose} style={{ flex: 1, height: 48, borderRadius: 11, background: 'rgba(120,120,128,0.12)', display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 16, fontWeight: 700, color: '#48484a' }}>닫기</button>
          <button type="button" className="ui-button" onClick={() => { if (changed) props.onChangeRoom(normalizeRoomCode(value)); }} disabled={!changed} style={{ flex: 1, height: 48, borderRadius: 11, background: changed ? ACCENT : 'rgba(120,120,128,0.12)', display: 'grid', placeItems: 'center', cursor: changed ? 'pointer' : 'default', fontSize: 16, fontWeight: 700, color: changed ? '#fff' : 'rgba(60,60,67,0.55)' }}>바꾸기</button>
        </div>
      </div>
    </>
  );
}
