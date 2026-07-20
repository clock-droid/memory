import { describe, expect, it } from 'vitest';
import { deriveSyncHealth, isSyncReadOnly } from './syncHealth';
import type { SyncResourceState } from './syncHealth';

const loaded: SyncResourceState = { hasData: true, pending: false, failed: false };

describe('deriveSyncHealth', () => {
  it('stays loading until every required subscription has produced data', () => {
    expect(deriveSyncHealth(['decks'], {})).toEqual({
      status: 'loading',
      pending: true,
      failedCount: 0,
    });
    expect(deriveSyncHealth(['decks', 'cards:d1'], { decks: loaded })).toEqual({
      status: 'loading',
      pending: true,
      failedCount: 0,
    });
  });

  it('is ready only after decks, cards, and sections are all loaded', () => {
    expect(deriveSyncHealth(
      ['decks', 'cards:d1', 'sections:d1'],
      { decks: loaded, 'cards:d1': loaded, 'sections:d1': loaded },
    )).toEqual({ status: 'ready', pending: false, failedCount: 0 });
  });

  it('reports an initial child-subscription failure as an error, not an empty room', () => {
    expect(deriveSyncHealth(
      ['decks', 'cards:d1', 'sections:d1'],
      {
        decks: loaded,
        'cards:d1': { hasData: false, pending: false, failed: true },
        'sections:d1': loaded,
      },
    )).toEqual({ status: 'error', pending: false, failedCount: 1 });
  });

  it('keeps a complete previous snapshot visible as stale after reconnect failure', () => {
    expect(deriveSyncHealth(
      ['decks', 'cards:d1', 'sections:d1'],
      {
        decks: loaded,
        'cards:d1': { hasData: true, pending: false, failed: true },
        'sections:d1': loaded,
      },
    )).toEqual({ status: 'stale', pending: false, failedCount: 1 });
  });

  it('marks a complete snapshot stale while a manual retry is pending', () => {
    const health = deriveSyncHealth(
      ['decks', 'cards:d1', 'sections:d1'],
      {
        decks: { hasData: true, pending: true, failed: false },
        'cards:d1': { hasData: true, pending: true, failed: false },
        'sections:d1': { hasData: true, pending: true, failed: false },
      },
    );
    expect(health).toEqual({ status: 'stale', pending: true, failedCount: 0 });
    expect(isSyncReadOnly(health.status)).toBe(true);
  });

  it('allows writes only after every required subscription is ready', () => {
    expect(isSyncReadOnly('ready')).toBe(false);
    expect(isSyncReadOnly('loading')).toBe(true);
    expect(isSyncReadOnly('stale')).toBe(true);
    expect(isSyncReadOnly('error')).toBe(true);
  });
});
