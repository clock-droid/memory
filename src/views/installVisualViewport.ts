/**
 * Mobile keyboards do not resize every WebView's layout viewport consistently.
 * Keep one CSS variable tied to the area the user can actually see so every
 * input surface (composer, editor, settings, and entry) shares the same rule.
 */
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"]';
const KEYBOARD_HEIGHT_THRESHOLD = 120;

export function installVisualViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let unobscuredHeight = Math.round(viewport?.height ?? window.innerHeight);

  const hasEditableFocus = () =>
    document.activeElement?.matches?.(EDITABLE_SELECTOR) ?? false;

  const syncViewportState = () => {
    const visibleHeight = Math.round(viewport?.height ?? window.innerHeight);
    const inputFocused = hasEditableFocus();
    if (!inputFocused) unobscuredHeight = Math.max(unobscuredHeight, visibleHeight);

    const keyboardOpen =
      inputFocused && unobscuredHeight - visibleHeight >= KEYBOARD_HEIGHT_THRESHOLD;
    root.style.setProperty('--app-viewport-height', `${visibleHeight}px`);
    root.toggleAttribute('data-keyboard-open', keyboardOpen);
  };

  syncViewportState();
  window.addEventListener('resize', syncViewportState);
  viewport?.addEventListener('resize', syncViewportState);
  viewport?.addEventListener('scroll', syncViewportState);
  document.addEventListener('focusin', syncViewportState);
  document.addEventListener('focusout', () => window.requestAnimationFrame(syncViewportState));
}
