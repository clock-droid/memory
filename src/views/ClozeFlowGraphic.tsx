export function ClozeFlowGraphic() {
  return (
    <svg
      className="cloze-flow-graphic"
      viewBox="0 0 342 142"
      role="img"
      aria-labelledby="cloze-flow-title cloze-flow-description"
    >
      <title id="cloze-flow-title">가림 단위 학습 흐름</title>
      <desc id="cloze-flow-description">
        한 카드에서 여러 부분을 가리고 하나씩 확인한 뒤, 몰랐던 부분만 다시 학습합니다.
      </desc>

      <rect x="1" y="1" width="340" height="140" rx="16" fill="#fff" stroke="rgba(60,60,67,0.08)" />

      <g aria-hidden="true">
        <g transform="translate(18 32)">
          <rect width="24" height="30" rx="7" fill="#007aff" />
          <rect x="30" width="24" height="30" rx="7" fill="#007aff" />
          <rect x="60" width="24" height="30" rx="7" fill="#007aff" />
        </g>
        <text x="60" y="91" textAnchor="middle" className="cloze-flow-label">여러 곳 가리고</text>

        <path d="M111 46h11m-4-4 4 4-4 4" fill="none" stroke="rgba(60,60,67,0.34)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

        <g transform="translate(129 32)">
          <rect width="24" height="30" rx="7" fill="#007aff" />
          <path d="m7 15 4 4 7-9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="30" width="24" height="30" rx="7" fill="rgba(120,120,128,0.22)" />
          <rect x="60" width="24" height="30" rx="7" fill="rgba(120,120,128,0.22)" />
        </g>
        <text x="171" y="91" textAnchor="middle" className="cloze-flow-label">하나씩 확인하고</text>

        <path d="M222 46h11m-4-4 4 4-4 4" fill="none" stroke="rgba(60,60,67,0.34)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

        <g transform="translate(240 32)">
          <rect width="24" height="30" rx="15" fill="#34c759" />
          <path d="m7 15 4 4 7-9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="30" width="24" height="30" rx="7" fill="#ff9500" />
          <path d="M48 10a7 7 0 1 0 1 8M48 10V6m0 4h-4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="60" width="24" height="30" rx="15" fill="#34c759" />
          <path d="m67 15 4 4 7-9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <text x="282" y="91" textAnchor="middle" className="cloze-flow-label">틀린 곳만 다시</text>

        <text x="171" y="121" textAnchor="middle" className="cloze-flow-caption">카드 하나 안에서 모르는 부분만 남겨요</text>
      </g>
    </svg>
  );
}
