/**
 * Mobile keyboards do not resize every WebView's layout viewport consistently.
 * Keep one CSS variable tied to the area the user can actually see so every
 * input surface (composer, editor, settings, and entry) shares the same rule.
 */
export function installVisualViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;

  const update = () => {
    const height = Math.round(viewport?.height ?? window.innerHeight);
    root.style.setProperty('--app-viewport-height', `${height}px`);
  };

  update();
  window.addEventListener('resize', update);
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
}
