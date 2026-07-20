export function Toast({ message, onUndo }: { message: string; onUndo?: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute', left: '50%', bottom: 130, transform: 'translateX(-50%)',
        maxWidth: 'calc(100% - 32px)', minHeight: 44, padding: onUndo ? '0 8px 0 16px' : '0 18px',
        borderRadius: 11, background: 'rgba(29,29,31,0.92)', color: '#fff',
        display: 'flex', alignItems: 'center', gap: 14,
        fontSize: 14, fontWeight: 600, lineHeight: 1.4, whiteSpace: 'normal',
        animation: 'popIn 0.25s cubic-bezier(0.3,1.2,0.4,1)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 20,
      }}
    >
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{message}</span>
      {onUndo && (
        <button
          type="button"
          className="ui-button"
          onClick={onUndo}
          style={{
            minWidth: 64, minHeight: 36, padding: '0 10px', borderRadius: 8,
            background: 'rgba(255,255,255,0.14)', color: '#fff',
            display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 13.5, fontWeight: 800,
          }}
        >
          되돌리기
        </button>
      )}
    </div>
  );
}
