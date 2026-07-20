import { useRef, useState } from 'react';
import type { ChangeEvent, Dispatch } from 'react';
import { ACCENT, ACCENT_DEEP } from '../constants';
import { editSignature, toggleTokenAt, tokenizeText, tokensToText } from '../domain/tokens';
import { resolveEditedCardId } from '../domain/cards';
import type { ProtoCard, ProtoList } from '../domain/cards';
import type { Patch } from '../state/patchState';
import type { EditorState } from '../state/uiSlices';
import { ModalSheet } from './ModalSheet';
import { TokenChips } from './TokenChips';

export function EditSheet(props: {
  list: ProtoList; editor: EditorState; setEditor: Dispatch<Patch<EditorState>>;
  saveEdit: (editor: EditorState, close: boolean) => Promise<boolean>;
  onDelete: () => void; openEditFor: (card: ProtoCard) => void;
}) {
  const { list, editor, setEditor } = props;
  const cardsAll = list.cards;
  const resolvedCardId = resolveEditedCardId(cardsAll, editor.cardId, editor.sourceSignature);
  const idx = resolvedCardId ? cardsAll.findIndex((card) => card.id === resolvedCardId) : -1;
  const dirty = editSignature(editor.mode, editor.q, editor.a, editor.tokens) !== editor.initialSignature;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const close = () => { if (!savingRef.current) setEditor({ open: false }); };

  const onEditText = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (savingRef.current) return;
    const text = e.target.value;
    const hiddenWords = new Set(editor.tokens.filter((t) => t.hidden).map((t) => t.word));
    let g = 5000;
    const tokens = tokenizeText(text).map((t) => (!t.nl && hiddenWords.has(t.word) ? { ...t, hidden: true, gid: g++ } : t));
    setEditor({ text, tokens });
  };
  const setQA = () => {
    if (savingRef.current || editor.mode === 'qa') return;
    const ans = editor.tokens.filter((t) => t.hidden).map((t) => t.word);
    const vis = tokensToText(editor.tokens.filter((t) => !t.hidden || t.nl));
    setEditor({ mode: 'qa', singleAnswer: false, q: vis || editor.text.trim(), a: ans.join(', ') });
  };
  const setCloze = () => {
    if (savingRef.current || editor.mode === 'tokens') return;
    const text = (editor.q.trim() + (editor.a.trim() ? ' ' + editor.a.trim() : '')).trim();
    let toks = tokenizeText(text);
    if (editor.a.trim()) {
      const aWords = new Set(editor.a.split(/[,\s]+/).map((w) => w.trim()).filter(Boolean));
      let g = 8100;
      toks = toks.map((t) => (!t.nl && aWords.has(t.word) ? { ...t, hidden: true, gid: g++ } : t));
    }
    setEditor({ mode: 'tokens', singleAnswer: false, text, tokens: toks });
  };
  const goPrev = () => { if (!dirty && idx > 0) props.openEditFor(cardsAll[idx - 1]); };
  const goNext = () => { if (!dirty && idx >= 0 && idx < cardsAll.length - 1) props.openEditFor(cardsAll[idx + 1]); };
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    let saved = false;
    try {
      saved = await props.saveEdit(editor, true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (saved) setEditor({ open: false });
  };

  const chip = (active: boolean) => ({ background: active ? ACCENT : 'rgba(120,120,128,0.12)', color: active ? '#fff' : '#48484a' });

  return (
    <ModalSheet title="카드 수정" onRequestClose={close} closeOnBackdrop={!dirty} initialFocusRef={closeButtonRef} maxHeight="82%">
        <div className="edit-sheet-header">
          <button ref={closeButtonRef} type="button" className="ui-button edit-sheet-close" onClick={close} disabled={saving} style={{ minWidth: 44, minHeight: 44, justifySelf: 'start', background: 'transparent', color: '#6e6e73', fontSize: 14, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
            {dirty ? '변경 취소' : '닫기'}
          </button>
          <div className="edit-sheet-modes">
            <button type="button" className="ui-button edit-sheet-mode-button" onClick={setQA} disabled={saving} aria-pressed={editor.mode === 'qa'} style={{ padding: '8px 14px', borderRadius: 9, cursor: saving ? 'default' : 'pointer', ...chip(editor.mode === 'qa') }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>문답형</span></button>
            <button type="button" className="ui-button edit-sheet-mode-button" onClick={setCloze} disabled={saving} aria-pressed={editor.mode === 'tokens'} style={{ padding: '8px 14px', borderRadius: 9, cursor: saving ? 'default' : 'pointer', ...chip(editor.mode === 'tokens') }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>가림형</span></button>
          </div>
          <div className="edit-sheet-nav">
            {!dirty && idx > 0 && (
              <button type="button" className="ui-button" onClick={goPrev} aria-label="이전 카드" style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(120,120,128,0.1)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1d1d1f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
              </button>
            )}
            {!dirty && idx >= 0 && idx < cardsAll.length - 1 && (
              <button type="button" className="ui-button" onClick={goNext} aria-label="다음 카드" style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(120,120,128,0.1)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1d1d1f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            )}
          </div>
        </div>

        {editor.mode === 'qa' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <label htmlFor="edit-card-question" style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(60,60,67,0.45)', letterSpacing: '0.03em' }}>질문</label>
              <textarea id="edit-card-question" rows={2} value={editor.q} disabled={saving} onChange={(e) => { if (!savingRef.current) setEditor({ q: e.target.value }); }} placeholder="질문" style={{ fontSize: 17, fontWeight: 600, border: 'none', background: 'transparent', color: '#000', padding: '2px 0', resize: 'none', lineHeight: 1.5 }} />
            </div>
            <div style={{ height: 0.5, background: 'rgba(60,60,67,0.12)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <label htmlFor="edit-card-answer" style={{ fontSize: 11.5, fontWeight: 700, color: ACCENT, opacity: 0.75, letterSpacing: '0.03em' }}>답 (가려짐)</label>
              <textarea id="edit-card-answer" rows={editor.singleAnswer ? 4 : 2} value={editor.a} disabled={saving} onChange={(e) => { if (!savingRef.current) setEditor({ a: e.target.value }); }} placeholder="답" style={{ fontSize: 17, fontWeight: 600, border: 'none', background: 'transparent', color: ACCENT_DEEP, padding: '2px 0', resize: 'none', lineHeight: 1.5 }} />
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
              <label htmlFor="edit-card-content" style={{ fontSize: 11.5, fontWeight: 700, color: '#6e6e73', letterSpacing: '0.03em' }}>내용</label>
              <textarea id="edit-card-content" rows={3} value={editor.text} disabled={saving} onChange={onEditText} placeholder="문장 전체를 쓰세요" style={{ fontSize: 16.5, fontWeight: 600, border: 'none', background: 'transparent', color: '#000', padding: '2px 0', resize: 'none', lineHeight: 1.5 }} />
            </div>
            <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(120,120,128,0.08)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 2px', lineHeight: 1.9, overflowY: 'auto', minHeight: 0 }}>
              <TokenChips
                tokens={editor.tokens}
                selection={editor.selection}
                fontSize={15}
                disabled={saving}
                onSelectStart={(index, wasHidden) => setEditor({ selection: { start: index, end: index, wasHidden } })}
                onSelectExtend={(index) => setEditor((current) => (current.selection
                  ? { selection: { ...current.selection, end: index } }
                  : {}))}
                onToggle={(index) => setEditor((current) => ({
                  tokens: toggleTokenAt(current.tokens, index),
                  selection: null,
                }))}
              />
              <span style={{ width: '100%', fontSize: 12.5, color: ACCENT_DEEP, fontWeight: 700, marginTop: 2 }}>가릴 답을 탭하세요</span>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4, flexShrink: 0 }}>
          <button type="button" className="ui-button" onClick={() => { if (!savingRef.current) props.onDelete(); }} disabled={saving} aria-label="이 카드 삭제" style={{ height: 50, padding: '0 20px', borderRadius: 12, background: 'rgba(255,59,48,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: saving ? 'default' : 'pointer' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#ff3b30' }}>삭제</span>
          </button>
          <button type="button" className="ui-button" onClick={save} disabled={!dirty || saving} style={{ flex: 1, height: 50, borderRadius: 12, background: dirty && !saving ? ACCENT : 'rgba(120,120,128,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: dirty && !saving ? 'pointer' : 'default' }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: dirty && !saving ? '#fff' : 'rgba(60,60,67,0.35)' }}>{saving ? '저장 중…' : '저장'}</span>
          </button>
        </div>
    </ModalSheet>
  );
}
