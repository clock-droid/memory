import { afterEach, describe, expect, it, vi } from 'vitest';
import { installVisualViewport } from './installVisualViewport';

describe('installVisualViewport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tracks the visible WebView height used above a mobile keyboard', () => {
    const setProperty = vi.fn();
    const addWindowListener = vi.fn();
    const addViewportListener = vi.fn();
    const viewport = { height: 428, addEventListener: addViewportListener };

    vi.stubGlobal('document', { documentElement: { style: { setProperty } } });
    vi.stubGlobal('window', {
      innerHeight: 844,
      visualViewport: viewport,
      addEventListener: addWindowListener,
    });

    installVisualViewport();

    expect(setProperty).toHaveBeenCalledWith('--app-viewport-height', '428px');
    expect(addWindowListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(addViewportListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(addViewportListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
