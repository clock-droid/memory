import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { ACCENT, ACCENT_DEEP } from '../constants';
import { masterySummary } from '../cards';
import type { ProtoList } from '../cards';
import type { Patch, UIState } from '../uiState';
import { usePcHints } from '../usePcHints';
import { readJudgeHintEnabled, writeJudgeHintEnabled } from '../judgeHint';
import { HideStateMap } from './HideStateMap';
import type { HideState } from './HideStateMap';

export function StudyView(props: {
  list: ProtoList | undefined; state: UIState; dispatch: (p: Patch) => void;
  onComplete: () => Promise<void>;
  onDeck: () => void; onRetryRemaining: () => void; onReviewAll: () => void;
}) {
  const { list, state, dispatch } = props;
  const isPc = usePcHints();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const savingRef = useRef(false);
  const [judgeHintEnabled, setJudgeHintEnabled] = useState(readJudgeHintEnabled);
  const [saving, setSaving] = useState(false);
  const dismissJudgeHint = () => {
    setJudgeHintEnabled(false);
    writeJudgeHintEnabled(false);
  };
  const target = state.queue[0];
  const card = list && target ? list.cards.find((c) => c.id === target.cardId) : undefined;
  const qParts = card ? card.q.split('___') : [];
  const nBlanks = card ? (qParts.length > 1 ? qParts.length - 1 : 1) : 0;
  const isCloze = !!card && qParts.length > 1;
  const targetIndexes = target?.answerIndexes ?? [];
  const targetSet = new Set(targetIndexes);
  const retrySet = new Set(state.retryAnswerIdx);
  let nextIdx = -1;
  for (const answerIndex of targetIndexes) {
    if (!state.revealedIdx.includes(answerIndex)) { nextIdx = answerIndex; break; }
  }
  const allRevealed = !!card && targetIndexes.length > 0 && nextIdx === -1;
  const complete = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await props.onComplete();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const revealNext = () => { if (nextIdx >= 0) dispatch((st) => ({ revealedIdx: [...st.revealedIdx, nextIdx] })); };
  const toggleRetry = (answerIndex: number) => {
    if (savingRef.current) return;
    dispatch((st) => ({
      retryAnswerIdx: st.retryAnswerIdx.includes(answerIndex)
        ? st.retryAnswerIdx.filter((i) => i !== answerIndex)
        : [...st.retryAnswerIdx, answerIndex],
    }));
  };

  // PC keyboard: Space/Enter reveals the next target, then advances.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (e.key === 'Escape') { if (!saving) props.onDeck(); return; }
      if (tag === 'input' || tag === 'textarea' || tag === 'button' || tag === 'select') return;
      if (!card) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (nextIdx >= 0) revealNext();
        else void complete();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!card || targetIndexes.length <= 1) return;
    const focusIndex = nextIdx >= 0 ? nextIdx : state.revealedIdx[state.revealedIdx.length - 1];
    if (focusIndex === undefined) return;
    const frame = window.requestAnimationFrame(() => {
      const container = contentRef.current;
      if (!container || container.scrollHeight <= container.clientHeight + 8) return;
      const element = container.querySelector<HTMLElement>(`[data-study-answer-index="${focusIndex}"]`);
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      element?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [card, targetIndexes.length, nextIdx, state.revealedIdx]);

  if (!card) {
    const progress = list ? masterySummary(list.cards) : { total: 0, known: 0 };
    const remaining = progress.total - progress.known;
    const allMemorized = progress.total > 0 && remaining === 0;
    const resultStates: HideState[] = list
      ? list.cards.flatMap((item) => item.answerMastery.map((known) => known ? 'known' : 'retry'))
      : [];
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, paddingTop: 'env(safe-area-inset-top)', background: '#fff' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '0 32px 100px' }}>
          <div style={{ width: 88, height: 88, borderRadius: 999, background: 'rgba(52,199,89,0.14)', display: 'grid', placeItems: 'center', animation: 'popIn 0.4s cubic-bezier(0.3,1.4,0.4,1)' }}>
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#1e9e46" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em' }}>{state.review ? '복습 끝!' : '오늘 학습 끝!'}</div>
            <div style={{ fontSize: 15, color: 'rgba(60,60,67,0.6)', textAlign: 'center', lineHeight: 1.5 }}>
              {list ? (remaining === 0 ? `가림 ${progress.total}개 완료` : `가림 ${state.sessionTotal}개 확인 · 다시 ${remaining}개`) : ''}
            </div>
          </div>
          <HideStateMap states={resultStates} size="regular" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 10 }}>
            {remaining > 0 && (
              <button type="button" className="ui-button" onClick={props.onRetryRemaining} style={{ height: 50, borderRadius: 12, background: ACCENT, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 15.5, fontWeight: 700, color: '#fff' }}>가림 {remaining}개 다시</button>
            )}
            {allMemorized && (
              <button type="button" className="ui-button" onClick={props.onReviewAll} style={{ height: 50, borderRadius: 12, background: 'rgba(120,120,128,0.16)', display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 15.5, fontWeight: 700, color: '#48484a' }}>처음부터 복습</button>
            )}
            <button type="button" className="ui-button" onClick={props.onDeck} style={{ height: 50, borderRadius: 12, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 15.5, fontWeight: 600, color: '#6e6e73' }}>암기장으로</button>
          </div>
        </div>
      </div>
    );
  }

  const cardSegs: Array<{ text: string; kind: 'text' | 'next' | 'waiting' | 'revealed'; answer: string; answerIndex: number; target: boolean }> = [];
  if (isCloze) {
    qParts.forEach((t, i) => {
      cardSegs.push({ text: t, kind: 'text', answer: '', answerIndex: -1, target: false });
      if (i < qParts.length - 1) {
        const isTarget = targetSet.has(i);
        const kind = !isTarget || state.revealedIdx.includes(i) ? 'revealed' : i === nextIdx ? 'next' : 'waiting';
        cardSegs.push({ text: '', kind, answer: card.a[i] || '', answerIndex: i, target: isTarget });
      }
    });
  }

  const checkedInCard = targetIndexes.filter((i) => state.revealedIdx.includes(i)).length;
  const checkedTotal = state.sessionDone + checkedInCard;
  const progressPct = state.sessionTotal ? Math.round((checkedTotal / state.sessionTotal) * 100) : 0;
  const cardBadge = isCloze ? (nBlanks > 1 ? `가림 ${nBlanks}곳` : '가림 1곳') : (card.a.length > 1 ? `문답 · 답 ${card.a.length}개` : '문답');
  const tapHint = targetIndexes.length > 1
    ? `탭하면 다음 답 (${checkedInCard + 1}/${targetIndexes.length})`
    : '화면을 탭하면 답이 보여요';
  const keyboardHint = targetIndexes.length > 1
    ? `스페이스를 누르면 다음 답 (${checkedInCard + 1}/${targetIndexes.length})`
    : '스페이스를 누르면 답이 보여요';
  const liveHideStates: HideState[] = card.answerMastery.map((known, answerIndex) => {
    if (retrySet.has(answerIndex)) return 'retry';
    if (targetSet.has(answerIndex)) return state.revealedIdx.includes(answerIndex) ? 'checked' : 'pending';
    return known ? 'known' : 'retry';
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, paddingTop: 'env(safe-area-inset-top)', background: '#fff' }}>
      <div style={{ padding: '14px 20px 0', display: 'flex', alignItems: 'center', gap: 14 }}>
        <button type="button" className="ui-button" onClick={props.onDeck} disabled={saving} aria-label="닫기" title="닫기" style={{ width: 44, height: 44, marginLeft: -14, borderRadius: 999, background: 'transparent', display: 'grid', placeItems: 'center', cursor: saving ? 'default' : 'pointer' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.6)" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
        <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(120,120,128,0.16)', overflow: 'hidden' }}>
          <div style={{ width: `${progressPct}%`, height: '100%', borderRadius: 2, background: ACCENT, transition: 'width 0.35s cubic-bezier(0.3,0.9,0.4,1)' }} />
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(60,60,67,0.6)', fontVariantNumeric: 'tabular-nums' }}>{checkedTotal}/{state.sessionTotal}</span>
      </div>

      <div
        key={`${card.id}-${state.sessionDone}-${state.queue.length}`}
        role={allRevealed ? undefined : 'button'}
        tabIndex={allRevealed ? undefined : 0}
        aria-label={allRevealed ? undefined : isCloze ? `가림막 공개 ${checkedInCard + 1}/${targetIndexes.length}` : '답 공개'}
        onClick={() => { if (!allRevealed) revealNext(); }}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, animation: 'cardIn 0.3s cubic-bezier(0.3,0.9,0.4,1)', touchAction: 'pan-y', cursor: allRevealed ? 'default' : 'pointer' }}
      >
        <div style={{ padding: '26px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(60,60,67,0.5)', letterSpacing: '0.03em' }}>{cardBadge}{list ? ` · ${list.name}` : ''}</div>
          <HideStateMap states={liveHideStates} />
        </div>
        <div ref={contentRef} aria-live="polite" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 26, padding: '14px 24px 150px', minHeight: 0, overflowY: 'auto', scrollBehavior: 'smooth' }}>
          {!isCloze ? (
            <>
              <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.015em', lineHeight: 1.4, wordBreak: 'keep-all', whiteSpace: 'pre-line' }}>{card.q}</div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
                {card.a.map((answer, answerIndex) => {
                  const isTarget = targetSet.has(answerIndex);
                  const revealed = !isTarget || state.revealedIdx.includes(answerIndex);
                  if (!revealed) {
                    return <div key={answerIndex} data-study-answer-index={answerIndex} style={{ height: 42, borderRadius: 10, background: answerIndex === nextIdx ? 'rgba(0,122,255,0.16)' : 'rgba(120,120,128,0.12)', width: `${Math.max(7, Math.min(answer.length + 1, 18))}em`, maxWidth: '100%', fontSize: 16 }} />;
                  }
                  if (!allRevealed || !isTarget) {
                    return <div key={answerIndex} data-study-answer-index={answerIndex} style={{ borderLeft: `3px solid ${isTarget ? ACCENT : 'rgba(120,120,128,0.24)'}`, padding: '2px 0 2px 14px', color: isTarget ? '#1d1d1f' : 'rgba(60,60,67,0.62)', fontSize: 21, fontWeight: 700, wordBreak: 'keep-all', lineHeight: 1.45, whiteSpace: 'pre-line', animation: isTarget ? 'popIn 0.22s cubic-bezier(0.3,1.2,0.4,1)' : undefined }}>{answer}</div>;
                  }
                  const retry = retrySet.has(answerIndex);
                  return (
                    <button
                      key={answerIndex}
                      type="button"
                      className="token-button"
                      data-study-answer-index={answerIndex}
                      aria-pressed={retry}
                      disabled={saving}
                      onClick={(e) => { e.stopPropagation(); toggleRetry(answerIndex); }}
                      style={{ minHeight: 44, border: 0, borderLeft: `3px solid ${retry ? '#ff9500' : 'rgba(120,120,128,0.32)'}`, borderRadius: 6, padding: '4px 10px 4px 14px', background: retry ? 'rgba(255,149,0,0.12)' : 'rgba(120,120,128,0.07)', color: retry ? '#8a4d00' : '#1d1d1f', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', animation: 'popIn 0.22s cubic-bezier(0.3,1.2,0.4,1)' }}
                    >
                      <span style={{ fontSize: 21, fontWeight: 700, wordBreak: 'keep-all', lineHeight: 1.45, whiteSpace: 'pre-line' }}>{answer}</span>
                      {retry && <RotateCcw size={15} strokeWidth={2.4} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 2, wordBreak: 'keep-all', whiteSpace: 'pre-line' }}>
              {cardSegs.map((seg, i) => (
                <span key={i}>
                  <span>{seg.text}</span>
                  {seg.kind === 'next' && (
                    <span data-study-answer-index={seg.answerIndex} style={{ display: 'inline-block', minWidth: 68, height: 36, padding: '0 14px', borderRadius: 8, background: 'rgba(0,122,255,0.16)', verticalAlign: 'middle', margin: '0 3px' }} />
                  )}
                  {seg.kind === 'waiting' && (
                    <span data-study-answer-index={seg.answerIndex} style={{ display: 'inline-block', minWidth: 68, height: 36, padding: '0 14px', borderRadius: 8, background: 'rgba(120,120,128,0.12)', verticalAlign: 'middle', margin: '0 3px' }} />
                  )}
                  {seg.kind === 'revealed' && (
                    allRevealed && seg.target ? (
                      <button
                        type="button"
                        className="token-button"
                        data-study-answer-index={seg.answerIndex}
                        aria-pressed={retrySet.has(seg.answerIndex)}
                        disabled={saving}
                        onClick={(e) => { e.stopPropagation(); toggleRetry(seg.answerIndex); }}
                        style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', gap: 5, padding: '4px 9px', border: 0, borderBottom: `2px solid ${retrySet.has(seg.answerIndex) ? '#ff9500' : 'rgba(120,120,128,0.32)'}`, borderRadius: 6, background: retrySet.has(seg.answerIndex) ? 'rgba(255,149,0,0.12)' : 'rgba(120,120,128,0.07)', color: retrySet.has(seg.answerIndex) ? '#8a4d00' : '#1d1d1f', font: 'inherit', fontWeight: 800, lineHeight: 'inherit', margin: '0 3px', cursor: 'pointer', animation: 'popIn 0.22s cubic-bezier(0.3,1.2,0.4,1)' }}
                      >
                        {seg.answer}
                        {retrySet.has(seg.answerIndex) && <RotateCcw size={14} strokeWidth={2.4} aria-hidden="true" />}
                      </button>
                    ) : (
                      <span data-study-answer-index={seg.answerIndex} style={{ display: 'inline-block', padding: '0 2px', borderBottom: `2px solid ${seg.target ? ACCENT : 'rgba(120,120,128,0.24)'}`, color: seg.target ? ACCENT_DEEP : 'rgba(60,60,67,0.62)', fontWeight: 800, margin: '0 3px', animation: seg.target ? 'popIn 0.22s cubic-bezier(0.3,1.2,0.4,1)' : undefined }}>{seg.answer}</span>
                    )
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '16px 20px 44px', background: 'linear-gradient(180deg,rgba(255,255,255,0) 0%,#fff 30%)', pointerEvents: 'none' }}>
        {!allRevealed ? (
          <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(60,60,67,0.5)', fontWeight: 500, lineHeight: 1.6 }}>
            {isPc ? keyboardHint : tapHint}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
            <div style={{ minHeight: 15, display: 'flex', alignItems: 'center', gap: 6, visibility: retrySet.size > 0 ? 'hidden' : 'visible' }}>
              <span
                className={judgeHintEnabled ? 'judge-hint-emphasis' : undefined}
                style={{ textAlign: 'center', fontSize: judgeHintEnabled ? 14 : 12, color: judgeHintEnabled ? '#1d1d1f' : 'rgba(60,60,67,0.5)', fontWeight: judgeHintEnabled ? 700 : 600 }}
              >
                몰랐던 답을 탭하세요
              </span>
              {judgeHintEnabled && (
                <button
                  type="button"
                  className="ui-button"
                  onClick={dismissJudgeHint}
                  aria-label="이 안내 그만 강조하기"
                  title="이 안내 그만 강조하기"
                  style={{ width: 44, height: 44, margin: '-11px', borderRadius: 999, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', pointerEvents: 'auto', flexShrink: 0 }}
                >
                  <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 999, background: 'rgba(120,120,128,0.14)', display: 'grid', placeItems: 'center' }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.6)" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                  </span>
                </button>
              )}
            </div>
            <button type="button" className="study-judge-button" onClick={() => { void complete(); }} disabled={saving} style={{ width: '100%', height: 50, padding: '0 16px', borderRadius: 12, border: 'none', background: saving ? 'rgba(0,122,255,0.55)' : ACCENT, color: '#fff', display: 'grid', placeItems: 'center', cursor: saving ? 'default' : 'pointer', pointerEvents: 'auto', fontFamily: 'inherit', fontSize: 15.5, fontWeight: 800 }}>
              {saving ? '판정 저장 중…' : retrySet.size > 0 ? `다음 · 다시 ${retrySet.size}개` : '다음'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
