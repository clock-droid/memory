const SERVICE_ORIGIN = 'https://exam-memorizer-clockgo.netlify.app';

const linkStyle = {
  color: '#6e6e73',
  fontSize: 12.5,
  fontWeight: 600,
  textDecoration: 'none',
} as const;

export function ServiceLinks() {
  return (
    <nav
      aria-label="서비스 정보"
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '6px 12px',
        padding: '10px 4px',
      }}
    >
      <a href={`${SERVICE_ORIGIN}/privacy/`} target="_blank" rel="noreferrer" style={linkStyle}>
        개인정보처리방침
      </a>
      <a href={`${SERVICE_ORIGIN}/terms/`} target="_blank" rel="noreferrer" style={linkStyle}>
        이용약관
      </a>
      <a href={`${SERVICE_ORIGIN}/support/`} target="_blank" rel="noreferrer" style={linkStyle}>
        도움말·문의
      </a>
    </nav>
  );
}
