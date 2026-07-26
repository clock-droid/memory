export function StorageTransferView({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: 'var(--app-viewport-height, 100dvh)',
        width: '100%',
        maxWidth: 480,
        margin: '0 auto',
        display: 'grid',
        placeItems: 'center',
        padding: 28,
        background: '#F2F2F7',
        color: '#1d1d1f',
        textAlign: 'center',
      }}
    >
      <div>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{message}</div>
        <div style={{ marginTop: 8, color: '#6e6e73', fontSize: 13.5, lineHeight: 1.55 }}>
          완료될 때까지 앱을 닫지 마세요.
        </div>
      </div>
    </div>
  );
}
