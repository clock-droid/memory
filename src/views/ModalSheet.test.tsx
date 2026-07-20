import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ModalSheet } from './ModalSheet';

describe('ModalSheet', () => {
  it('keeps actions reachable through an internal scroll area on short screens', () => {
    const markup = renderToStaticMarkup(createElement(
      ModalSheet,
      {
        title: '수정',
        maxHeight: '82%',
        onRequestClose: vi.fn(),
        children: createElement('button', { type: 'button' }, '저장'),
      },
    ));

    expect(markup).toContain('max-height:82%');
    expect(markup).toContain('overflow:hidden');
    expect(markup).toContain('data-modal-scroll="true"');
    expect(markup).toContain('overflow-y:auto');
    expect(markup).toContain('저장');
  });
});
