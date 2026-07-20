import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element);
    return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden';
  });
}

export function ModalSheet(props: {
  title: string;
  children: ReactNode;
  onRequestClose: () => void;
  initialFocusRef?: RefObject<HTMLElement>;
  closeOnBackdrop?: boolean;
  showTitle?: boolean;
  maxHeight?: string;
}) {
  const titleId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(props.onRequestClose);
  closeRef.current = props.onRequestClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialTarget = props.initialFocusRef?.current ?? dialogRef.current;
    initialTarget?.focus({ preventScroll: true });

    const layer = layerRef.current;
    const backgroundStates = layer?.parentElement
      ? Array.from(layer.parentElement.children)
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== layer)
        .map((element) => ({
          element,
          inert: element.inert,
          ariaHidden: element.getAttribute('aria-hidden'),
        }))
      : [];
    backgroundStates.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    });

    const keepFocusInside = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(event.target as Node)) return;
      (props.initialFocusRef?.current ?? dialog).focus({ preventScroll: true });
    };
    document.addEventListener('focusin', keepFocusInside);

    return () => {
      document.removeEventListener('focusin', keepFocusInside);
      backgroundStates.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [props.initialFocusRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = focusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div ref={layerRef} data-modal-layer="true" style={{ position: 'fixed', inset: 0, zIndex: 15 }}>
      <div
        aria-hidden="true"
        onClick={props.closeOnBackdrop === false ? undefined : () => closeRef.current()}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)' }}
      />
      <div
        ref={dialogRef}
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          width: '100%', maxWidth: 480, margin: '0 auto',
          borderRadius: '20px 20px 0 0', background: '#fff', padding: 'var(--modal-sheet-padding)',
          display: 'flex', flexDirection: 'column', gap: 'var(--modal-sheet-gap)',
          boxShadow: '0 -12px 40px rgba(0,0,0,0.16)',
          animation: 'sheetUp 0.32s cubic-bezier(0.3,0.9,0.4,1)',
          maxHeight: props.maxHeight ?? 'calc(100% - max(8px, env(safe-area-inset-top)))',
          overflow: 'hidden', zIndex: 1,
        }}
      >
        <div className="modal-sheet-handle" aria-hidden="true" style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(120,120,128,0.25)', alignSelf: 'center', flexShrink: 0 }} />
        <h2
          id={titleId}
          className={props.showTitle ? undefined : 'sr-only'}
          style={props.showTitle ? { margin: 0, fontSize: 20, fontWeight: 800 } : undefined}
        >
          {props.title}
        </h2>
        <div
          data-modal-scroll="true"
          style={{
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--modal-sheet-gap)',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
          }}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
