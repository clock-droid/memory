import type { ChangeEvent } from 'react';
import { ACCENT, ACCENT_DEEP } from '../constants';
import { editSignature, tokenizeText, tokensToText } from '../tokens';
import type { ProtoCard, ProtoList } from '../cards';
import type { Patch, UIState } from '../uiState';
import { TokenChips } from './TokenChips';

export function EditSheet(props: {
  list: ProtoList; state: UIState; dispatch: (p: Patch) => void;
  saveEditFrom: (st: UIState, close: boolean) => boolean;
  onDelete: () => void; openEditFor: (card: ProtoCard) => void;
}) {
  const { list, state, dispatch } = props;
  const cardsAll = list.cards;
  const idx = state.editIdx ?? -1;
  const dirty = editSignature(state.editMode, state.editQ, state.editA, state.editTokens) !== state.editInitialSignature;

  const onEditText = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    const hiddenWords = new Set(state.editTokens.filter((t) => t.hidden).map((t) => t.word));
    let g = 5000;
    const tokens = tokenizeText(text).map((t) => (!t.nl && hiddenWords.has(t.word) ? { ...t, hidden: true, gid: g++ } : t));
    dispatch({ editText: text, editTokens: tokens });
  };
  const setQA = () => {
    if (state.editMode === 'qa') return;
    const ans = state.editTokens.filter((t) => t.hidden).map((t) => t.word);
    const vis = tokensToText(state.editTokens.filter((t) => !t.hidden || t.nl));
    dispatch({ editMode: 'qa', editQ: vis || state.editText.trim(), editA: ans.join(', ') });
  };
  const setCloze = () => {
    if (state.editMode === 'tokens') return;
    const text = (state.editQ.trim() + (state.editA.trim() ? ' ' + state.editA.trim() : '')).trim();
    let toks = tokenizeText(text);
    if (state.editA.trim()) {
      const aWords = new Set(state.editA.split(/[,\s]+/).map((w) => w.trim()).filter(Boolean));
      let g = 8100;
      toks = toks.map((t) => (!t.nl && aWords.has(t.word) ? { ...t, hidden: true, gid: g++ } : t));
    }
    dispatch({ editMode: 'tokens', editText: text, editTokens: toks });
  };
  const goPrev = () => { if (idx > 0) { props.saveEditFrom(state, false); props.openEditFor(cardsAll[idx - 1]); } };
  const goNext = () => { if (idx >= 0 && idx < cardsAll.length - 1) { props.saveEditFrom(state, false); props.openEditFor(cardsAll[idx + 1]); } };
  const save = () => { if (props.saveEditFrom(state, true)) dispatch({ editSheetOpen: false }); };

  const chip = (active: boolean) => ({ background: active ? ACCENT : 'rgba(120,120,128,0.12)', color: active ? '#fff' : '#48484a' });

  return (
    <>
      <div onClick={() => { if (!dirty) dispatch({ editSheetOpen: false }); }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)', zIndex: 15 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: '20px 20px 0 0', background: '#fff', padding: '18px 20px 42px', display: 'flex', flexDirection: 'column', gap: 13, boxShadow: '0 -12px 40px rgba(0,0,0,0.16)', animation: 'sheetUp 0.32s cubic-bezier(0.3,0.9,0.4,1)', maxHeight: '82%', zIndex: 16 }}>
        <div style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(120,120,128,0.25)', alignSelf: 'center', flexShrink: 0 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 80px', alignItems: 'center', flexShrink: 0 }}>
          <button type="button" className="ui-button" onClick={() => dispatch({ editSheetOpen: false })} style={{ minWidth: 44, minHeight: 40, justifySelf: 'start', background: 'transparent', color: '#6e6e73', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {dirty ? '변경 취소' : '닫기'}
          </button>
          <div style={{ display: 'flex', gap: 6, justifySelf: 'center' }}>
            <button type="button" className="ui-button" onClick={setQA} aria-pressed={state.editMode === 'qa'} style={{ padding: '8px 14px', borderRadius: 9, cursor: 'pointer', ...chip(state.editMode === 'qa') }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>문답형</span></button>
            <button type="button" className="ui-button" onClick={setCloze} aria-pressed={state.editMode === 'tokens'} style={{ padding: '8px 14px', borderRadius: 9, cursor: 'pointer', ...chip(state.editMode === 'tokens') }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>가림형</span></button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
            {!dirty && idx > 0 && (
              <button type="button" className="ui-button" onClick={goPrev} aria-label="이전 카드" style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(120,120,128,0.1)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1d1d1f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
              </button>
            )}
            {!dirty && idx >= 0 && idx < cardsAll.length - 1 && (
              <button type="button" className="ui-button" onClick={goNext} aria-label="다음 카드" style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(120,120,128,0.1)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1d1d1f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            )}
          </div>
        </div>

        {state.editMode === 'qa' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(60,60,67,0.45)', letterSpacing: '0.03em' }}>질문</span>
              <textarea rows={2} value={state.editQ} onChange={(e) => dispatch({ editQ: e.target.value })} placeholder="질문" style={{ fontSize: 17, fontWeight: 600, border: 'none', background: 'transparent', color: '#000', padding: '2px 0', resize: 'none', lineHeight: 1.5 }} />
            </div>
            <div style={{ height: 0.5, background: 'rgba(60,60,67,0.12)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: ACCENT, opacity: 0.75, letterSpacing: '0.03em' }}>답 (가려짐)</span>
              <input value={state.editA} onChange={(e) => dispatch({ editA: e.target.value })} placeholder="답" style={{ fontSize: 17, fontWeight: 600, border: 'none', background: 'transparent', color: ACCENT_DEEP, padding: '2px 0' }} />
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#6e6e73', letterSpacing: '0.03em' }}>내용</span>
              <textarea rows={3} value={state.editText} onChange={onEditText} placeholder="문장 전체를 쓰세요" style={{ fontSize: 16.5, fontWeight: 600, border: 'none', background: 'transparent', color: '#000', padding: '2px 0', resize: 'none', lineHeight: 1.5 }} />
            </div>
            <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(120,120,128,0.08)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 2px', lineHeight: 1.9, overflowY: 'auto', minHeight: 0 }}>
              <TokenChips tokens={state.editTokens} ri={-100} fontSize={15} sel={state.sel} dispatch={dispatch} />
              <span style={{ width: '100%', fontSize: 12.5, color: ACCENT_DEEP, fontWeight: 700, marginTop: 2 }}>가릴 답을 탭하세요</span>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4, flexShrink: 0 }}>
          <button type="button" className="ui-button" onClick={props.onDelete} style={{ height: 50, padding: '0 20px', borderRadius: 12, background: 'rgba(255,59,48,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#ff3b30' }}>삭제</span>
          </button>
          <button type="button" className="ui-button" onClick={save} disabled={!dirty} style={{ flex: 1, height: 50, borderRadius: 12, background: dirty ? ACCENT : 'rgba(120,120,128,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: dirty ? 'pointer' : 'default' }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: dirty ? '#fff' : 'rgba(60,60,67,0.35)' }}>저장</span>
          </button>
        </div>
      </div>
    </>
  );
}
