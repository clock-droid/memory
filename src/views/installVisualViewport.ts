/**
 * Mobile keyboards do not resize every WebView's layout viewport consistently.
 * Keep one CSS variable tied to the area the user can actually see so every
 * input surface (composer, editor, settings, and entry) shares the same rule.
 */
export function installVisualViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let expandedHeight = Math.round(viewport?.height ?? window.innerHeight);

  const hasEditableFocus = () =>
    document.activeElement?.matches?.('input, textarea, [contenteditable="true"]') ?? false;

  const update = () => {
    const height = Math.round(viewport?.height ?? window.innerHeight);
    const editableFocused = hasEditableFocus();
    if (!editableFocused) expandedHeight = Math.max(expandedHeight, height);
    root.style.setProperty('--app-viewport-height', `${height}px`);
    root.toggleAttribute('data-keyboard-open', editableFocused && expandedHeight - height >= 120);
  };

  update();
  window.addEventListener('resize', update);
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => window.requestAnimationFrame(update));
}
