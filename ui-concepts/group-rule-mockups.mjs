import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve('ui-concepts');

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function textLines(text, x, y, options = {}) {
  const {
    size = 28,
    weight = 700,
    color = '#182029',
    lineHeight = 1.45,
    anchor = 'start',
    family = 'Arial, Noto Sans KR, sans-serif',
  } = options;
  return String(text)
    .split('\n')
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * size * lineHeight}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(line)}</text>`,
    )
    .join('');
}

function frame(title, subtitle, body) {
  return `
  <svg width="1280" height="900" viewBox="0 0 1280 900" xmlns="http://www.w3.org/2000/svg">
    <rect width="1280" height="900" fill="#f7f6f1"/>
    <rect x="60" y="48" width="1160" height="76" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    ${textLines('공유코드', 88, 80, { size: 18, weight: 800, color: '#69717b' })}
    ${textLines('coffee-test', 88, 108, { size: 26, weight: 950 })}
    <rect x="910" y="68" width="150" height="38" rx="19" fill="#fffefa" stroke="#d8d3c6"/>
    ${textLines('클라우드 저장', 985, 94, { size: 17, weight: 800, color: '#314b58', anchor: 'middle' })}
    <rect x="1078" y="66" width="96" height="42" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    ${textLines('코드 변경', 1126, 94, { size: 17, weight: 850, anchor: 'middle' })}
    ${textLines(title, 70, 184, { size: 36, weight: 950 })}
    ${textLines(subtitle, 70, 220, { size: 20, weight: 750, color: '#69717b' })}
    ${body}
  </svg>`;
}

function pill(x, y, w, h, label, fill = '#314b58') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}"/>
  ${textLines(label, x + w / 2, y + h / 2 + 8, { size: 23, weight: 950, color: '#fffefa', anchor: 'middle' })}`;
}

function mask(x, y, w, h) {
  return `<clipPath id="m${x}${y}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/></clipPath>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#f0eee7" stroke="#d8d3c6"/>
  <g clip-path="url(#m${x}${y})">
    ${Array.from({ length: 16 }, (_, i) => `<rect x="${x + i * 22}" y="${y}" width="12" height="${h}" fill="#d0c9bb"/>`).join('')}
  </g>`;
}

function editMockup() {
  const input = `커피의 3가지 분류:
- 아메리카노: 아주 [오래된] 커피
- [카페라떼] : 아주 [맛있는] 커피
- 우유 : 아주 [하얀] 음료`;
  const body = `
    <rect x="70" y="258" width="690" height="574" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    ${textLines('원문 입력', 96, 306, { size: 25, weight: 950 })}
    <rect x="96" y="334" width="638" height="444" rx="8" fill="#fffefa" stroke="#cfc8ba"/>
    ${textLines(input, 124, 382, { size: 27, weight: 750, lineHeight: 1.65 })}
    <rect x="788" y="258" width="422" height="574" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    ${textLines('미리보기', 814, 306, { size: 25, weight: 950 })}
    <rect x="814" y="334" width="370" height="300" rx="8" fill="#f7f6f1" stroke="#d8d3c6"/>
    ${textLines('묶음 카드', 840, 374, { size: 18, weight: 900, color: '#d6674d' })}
    ${textLines('커피의 3가지 분류', 840, 420, { size: 27, weight: 950 })}
    ${textLines('- 아메리카노: 아주 ____ 커피\n- ____ : 아주 ____ 커피\n- 우유 : 아주 ____ 음료', 840, 470, { size: 24, weight: 760, lineHeight: 1.55 })}
    <rect x="814" y="658" width="370" height="76" rx="8" fill="#fff7df" stroke="#ead9a3"/>
    ${textLines('경고는 이 경우 표시되지 않음', 840, 704, { size: 21, weight: 850, color: '#7a5a13' })}
  `;
  return frame('편집 화면 예상', '후보 C 입력은 미리보기에서 카드 하나로 보입니다.', body);
}

function studyHiddenMockup() {
  const body = `
    <rect x="70" y="258" width="1140" height="438" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    <circle cx="112" cy="312" r="29" fill="#e7eef0"/>
    ${textLines('1', 112, 322, { size: 22, weight: 950, color: '#314b58', anchor: 'middle' })}
    ${textLines('커피의 3가지 분류', 162, 322, { size: 31, weight: 950 })}
    <rect x="1068" y="282" width="52" height="52" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    ${textLines('☆', 1094, 319, { size: 34, weight: 900, anchor: 'middle' })}
    <rect x="1134" y="282" width="52" height="52" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    ${textLines('⌫', 1160, 316, { size: 28, weight: 900, anchor: 'middle' })}
    ${textLines('- 아메리카노: 아주', 164, 394, { size: 27, weight: 780 })}
    ${mask(422, 364, 150, 52)}
    ${textLines('커피', 592, 394, { size: 27, weight: 780 })}
    ${textLines('- ', 164, 474, { size: 27, weight: 780 })}
    ${mask(194, 444, 164, 52)}
    ${textLines(': 아주', 374, 474, { size: 27, weight: 780 })}
    ${mask(462, 444, 150, 52)}
    ${textLines('커피', 632, 474, { size: 27, weight: 780 })}
    ${textLines('- 우유 : 아주', 164, 554, { size: 27, weight: 780 })}
    ${mask(354, 524, 128, 52)}
    ${textLines('음료', 502, 554, { size: 27, weight: 780 })}
    <rect x="70" y="724" width="1140" height="92" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    ${textLines('다음 카드', 162, 780, { size: 28, weight: 900, color: '#69717b' })}
    ${mask(930, 744, 170, 52)}
  `;
  return frame('암기모드 예상: 가림 상태', '묶음 전체가 카드 하나 안에 보이고, [ ] 부분만 가려집니다.', body);
}

function studyRevealedMockup() {
  const body = `
    <rect x="70" y="258" width="1140" height="438" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    <circle cx="112" cy="312" r="29" fill="#e7eef0"/>
    ${textLines('1', 112, 322, { size: 22, weight: 950, color: '#314b58', anchor: 'middle' })}
    ${textLines('커피의 3가지 분류', 162, 322, { size: 31, weight: 950 })}
    <rect x="1068" y="282" width="52" height="52" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    ${textLines('☆', 1094, 319, { size: 34, weight: 900, anchor: 'middle' })}
    <rect x="1134" y="282" width="52" height="52" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    ${textLines('⌫', 1160, 316, { size: 28, weight: 900, anchor: 'middle' })}
    ${textLines('- 아메리카노: 아주', 164, 394, { size: 27, weight: 780 })}
    ${pill(422, 360, 150, 60, '오래된')}
    ${textLines('커피', 592, 394, { size: 27, weight: 780 })}
    ${textLines('- ', 164, 474, { size: 27, weight: 780 })}
    ${pill(194, 440, 164, 60, '카페라떼')}
    ${textLines(': 아주', 374, 474, { size: 27, weight: 780 })}
    ${pill(462, 440, 150, 60, '맛있는')}
    ${textLines('커피', 632, 474, { size: 27, weight: 780 })}
    ${textLines('- 우유 : 아주', 164, 554, { size: 27, weight: 780 })}
    ${pill(354, 520, 128, 60, '하얀')}
    ${textLines('음료', 502, 554, { size: 27, weight: 780 })}
    <rect x="70" y="724" width="1140" height="92" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    ${textLines('다음 카드', 162, 780, { size: 28, weight: 900, color: '#69717b' })}
    ${mask(930, 744, 170, 52)}
  `;
  return frame('암기모드 예상: 답 공개 상태', '가림 상태에서 이미 답 높이를 예약하므로 공개해도 카드가 밀리지 않습니다.', body);
}

function warningMockup() {
  const body = `
    <rect x="70" y="258" width="690" height="574" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    ${textLines('원문 입력', 96, 306, { size: 25, weight: 950 })}
    <rect x="96" y="334" width="638" height="352" rx="8" fill="#fffefa" stroke="#cfc8ba"/>
    ${textLines('커피의 3가지 분류:\n-[아메리카노]: 아주 [오래된] 커피\n카페인: 각성 효과\n- [에스프레소]: 아주 [쓴] 커피', 124, 382, { size: 25, weight: 750, lineHeight: 1.65 })}
    <rect x="96" y="710" width="638" height="68" rx="8" fill="#fff1ed" stroke="#efb7a8"/>
    ${textLines('목록 기호 뒤에는 공백이 필요합니다. 묶음 중간 일반 문장도 확인하세요.', 122, 752, { size: 21, weight: 850, color: '#9f3b27' })}
    <rect x="788" y="258" width="422" height="574" rx="8" fill="#fffefa" stroke="#d8d3c6"/>
    ${textLines('미리보기 경고', 814, 306, { size: 25, weight: 950 })}
    <rect x="814" y="334" width="370" height="122" rx="8" fill="#fff1ed" stroke="#efb7a8"/>
    ${textLines('2번 줄: 목록 기호 뒤 공백 필요\n3번 줄: 묶음 중간 일반 문장', 840, 378, { size: 22, weight: 850, color: '#9f3b27', lineHeight: 1.45 })}
  `;
  return frame('입력 오류 예상', '규칙이 어긋난 줄은 저장 전 미리보기/입력창에서 경고합니다.', body);
}

const mockups = [
  ['group-edit-preview.png', editMockup()],
  ['group-study-hidden.png', studyHiddenMockup()],
  ['group-study-revealed.png', studyRevealedMockup()],
  ['group-warning.png', warningMockup()],
];

for (const [name, svg] of mockups) {
  const file = path.join(outDir, name);
  await sharp(Buffer.from(svg)).png().toFile(file);
  await writeFile(path.join(outDir, name.replace(/\.png$/, '.svg')), svg, 'utf8');
  console.log(file);
}
