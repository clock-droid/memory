import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { initialComposer } from '../state/uiSlices';
import type { ComposerState } from '../state/uiSlices';
import { ContinuousAddView } from './ContinuousAddView';

function renderComposer(composer: ComposerState) {
  return renderToStaticMarkup(createElement(ContinuousAddView, {
    composer,
    setComposer: vi.fn(),
    onAddCards: vi.fn(async () => true),
    onUndoLast: vi.fn(async () => 1),
    onClose: vi.fn(),
  }));
}

describe('ContinuousAddView dock', () => {
  it('is a non-modal dock that explains the first required action', () => {
    const markup = renderComposer({ ...initialComposer, open: true, operationId: 'op-1' });

    expect(markup).toContain('data-card-composer-layer="true"');
    expect(markup).toContain('aria-label="카드 추가"');
    expect(markup).toContain('내용을 입력하세요');
    expect(markup).toContain('아래로 밀어 카드 추가 닫기');
    expect(markup).not.toContain('aria-modal="true"');
  });

  it('enables adding after a hide is selected', () => {
    const markup = renderComposer({
      ...initialComposer,
      open: true,
      operationId: 'op-2',
      text: '대한민국 수도는 서울이다',
      rows: [{
        kind: 'tokens',
        tokens: [
          { word: '대한민국', tail: '', hidden: false, gid: 0 },
          { word: '수도', tail: '는', hidden: false, gid: 0 },
          { word: '서울이다', tail: '', hidden: true, gid: 1 },
        ],
      }],
    });

    expect(markup).toContain('가림 1곳 선택됨');
    expect(markup).toContain('서울이다 가림 해제');
    expect(markup).toMatch(/<button[^>]*>카드 추가<\/button>/);
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>카드 추가<\/button>/);
  });
});
