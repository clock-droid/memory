import { afterEach, describe, expect, it, vi } from 'vitest';
import { installVisualViewport } from './installVisualViewport';

describe('installVisualViewport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tracks the visible WebView height used above a mobile keyboard', () => {
    const setProperty = vi.fn();
    const toggleAttribute = vi.fn();
    const addWindowListener = vi.fn();
    const viewportListeners = new Map<string, () => void>();
    const addViewportListener = vi.fn((name: string, listener: () => void) => viewportListeners.set(name, listener));
    const documentStub = {
      activeElement: null as { matches: (selector: string) => boolean } | null,
      documentElement: { style: { setProperty }, toggleAttribute },
      addEventListener: vi.fn(),
    };
    const viewport = { height: 844, addEventListener: addViewportListener };

    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', {
      innerHeight: 844,
      visualViewport: viewport,
      addEventListener: (name: string, listener: () => void) => {
        addWindowListener(name, listener);
      },
      requestAnimationFrame: vi.fn(),
    });

    installVisualViewport();

    expect(setProperty).toHaveBeenCalledWith('--app-viewport-height', '844px');
    expect(addWindowListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(addViewportListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(addViewportListener).toHaveBeenCalledWith('scroll', expect.any(Function));

    documentStub.activeElement = { matches: () => true };
    viewport.height = 428;
    viewportListeners.get('resize')?.();

    expect(setProperty).toHaveBeenLastCalledWith('--app-viewport-height', '428px');
    expect(toggleAttribute).toHaveBeenLastCalledWith('data-keyboard-open', true);
  });
});
