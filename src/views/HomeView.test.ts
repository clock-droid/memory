import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HomeView } from './HomeView';
import { toProtoCard } from '../domain/cards';

function renderHome(overrides: Partial<Parameters<typeof HomeView>[0]> = {}) {
  return renderToStaticMarkup(createElement(HomeView, {
    lists: [],
    decksState: 'ready',
    syncPending: false,
    onOpenList: vi.fn(),
    onContinue: vi.fn(),
    onNewList: vi.fn(),
    onOpenSettings: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  }));
}

describe('HomeView sync states', () => {
  it('shows a Korean blocking error instead of an empty-room prompt on initial failure', () => {
    const markup = renderHome({ decksState: 'error' });

    expect(markup).toContain('암기장을 불러오지 못했어요');
    expect(markup).toContain('다시 시도');
    expect(markup).toContain('서버에 저장된 암기장이 지워진 것은 아니에요');
    expect(markup).not.toContain('첫 암기장 만들기');
    expect(markup).not.toContain('Server sync request failed');
  });

  it('labels a complete previous snapshot as stale while reconnecting', () => {
    const markup = renderHome({
      decksState: 'stale',
      syncPending: true,
      lists: [{
        id: 's1',
        deckId: 'd1',
        name: '기존 암기장',
        synthetic: false,
        cards: [toProtoCard({
          id: 'c1',
          type: 'cloze',
          prompt: '___',
          answers: ['서울'],
          rawText: '[서울]',
          answerMastery: [false],
          createdAt: 0,
          updatedAt: 0,
        })],
      }],
    });

    expect(markup).toContain('최신 상태를 확인하고 있어요');
    expect(markup).toContain('마지막으로 불러온 내용을 표시합니다');
    expect(markup).toContain('연결 전에는 학습하거나 수정할 수 없어요');
    expect(markup).toContain('연결 중…');
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('이어서 암기');
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
  });
});
