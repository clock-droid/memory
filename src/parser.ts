import type { GroupItem, NewCard, ParsedLine } from './types';

const clozePattern = /\[([^\[\]]+)\]/g;
const validListPattern = /^(-\s+|\d+[.)]\s*)(.+)$/;
const badListSpacingPattern = /^\s*-(?=\S)/;
const nestedListPattern = /^\s+(-\s+|\d+[.)]\s*)/;

export function parseInput(input: string): ParsedLine[] {
  const sourceLines = input.split(/\r?\n/);
  const parsed: ParsedLine[] = [];
  let index = 0;

  while (index < sourceLines.length) {
    const line = sourceLines[index];
    const rawText = line.trim();
    const lineNumber = index + 1;

    if (!rawText) {
      index += 1;
      continue;
    }

    if (isGroupTitle(rawText)) {
      const group = parseGroup(sourceLines, index);
      parsed.push(...group.items);
      index = group.nextIndex;
      continue;
    }

    const standalone = parseLine(line, lineNumber);
    if (standalone) parsed.push(standalone);
    index += 1;
  }

  return parsed;
}

function isGroupTitle(rawText: string) {
  return rawText.endsWith(':');
}

function parseGroup(lines: string[], titleIndex: number): { items: ParsedLine[]; nextIndex: number } {
  const title = lines[titleIndex].trim();
  const titleLineNumber = titleIndex + 1;
  const groupTitle = title.slice(0, -1).trim();
  const items: ParsedLine[] = [];
  const groupItems: GroupItem[] = [];
  const rawLines = [title];
  let index = titleIndex + 1;
  let sawContent = false;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const lineNumber = index + 1;

    if (!trimmed) break;
    sawContent = true;

    const validList = line.match(validListPattern);
    if (validList) {
      groupItems.push({ marker: validList[1], text: validList[2].trim() });
      rawLines.push(line.trim());
      index += 1;
      continue;
    }

    if (nestedListPattern.test(line)) {
      items.push(invalidLine(lineNumber, trimmed, '들여쓰기된 중첩 목록은 아직 지원하지 않습니다. 한 단계 목록만 입력하세요.'));
    } else if (badListSpacingPattern.test(trimmed)) {
      items.push(invalidLine(lineNumber, trimmed, '목록 기호 뒤에는 공백이 필요합니다. 예: "- 아메리카노", "1. 아메리카노"'));
    } else {
      items.push(invalidLine(lineNumber, trimmed, '묶음 목록 중간에 일반 문장이 있습니다. 묶음을 끝내려면 빈 줄을 넣으세요.'));
    }
    rawLines.push(line.trim());
    index += 1;
  }

  if (!sawContent || groupItems.length === 0) {
    return {
      items: [
        invalidLine(
          titleLineNumber,
          title,
          `"${groupTitle || title}" 아래에 목록이 없습니다. "- 내용", "1 내용", "1. 내용", "1) 내용" 형식으로 입력하세요.`,
        ),
        ...items,
      ],
      nextIndex: index,
    };
  }

  const answers = groupItems.flatMap((item) => extractAnswers(item.text));
  return {
    items: [
      {
        lineNumber: titleLineNumber,
        rawText: rawLines.join('\n'),
        valid: true,
        card: {
          type: 'group',
          prompt: groupTitle || title,
          answers,
          rawText: rawLines.join('\n'),
          groupItems,
        },
      },
      ...items,
    ],
    nextIndex: index,
  };
}

function parseLine(line: string, lineNumber: number): ParsedLine | null {
  const rawText = line.trim();
  if (!rawText) return null;

  if (validListPattern.test(line) || badListSpacingPattern.test(rawText)) {
    return invalidLine(lineNumber, rawText, '목록은 "묶음 제목:" 아래에 입력하세요.');
  }

  // Explicit bracket blanks always win over pair parsing.
  // Example: "처방증상 : [A], [b], d" must stay a cloze card, not A:B.
  const answers = extractAnswers(rawText);
  if (answers.length > 0) {
    return {
      lineNumber,
      rawText,
      valid: true,
      card: {
        type: 'cloze',
        prompt: rawText,
        answers,
        rawText,
      },
    };
  }

  const arrowIndex = rawText.indexOf('->');
  const colonIndex = rawText.indexOf(':');
  const separatorIndex =
    arrowIndex >= 0 && (colonIndex < 0 || arrowIndex < colonIndex) ? arrowIndex : colonIndex;
  const separatorLength = separatorIndex === arrowIndex ? 2 : 1;

  if (separatorIndex >= 0) {
    const prompt = rawText.slice(0, separatorIndex).trim();
    const answer = rawText.slice(separatorIndex + separatorLength).trim();
    if (prompt && answer) {
      return {
        lineNumber,
        rawText,
        valid: true,
        card: {
          type: 'pair',
          prompt,
          answers: [answer],
          rawText,
        },
      };
    }
  }

  return invalidLine(lineNumber, rawText, 'A:B, A->B, [정답], 또는 "묶음 제목:" 아래 목록 형식으로 입력하세요.');
}

function extractAnswers(rawText: string) {
  return [...rawText.matchAll(clozePattern)].map((match) => match[1].trim()).filter(Boolean);
}

function invalidLine(lineNumber: number, rawText: string, reason: string): ParsedLine {
  return { lineNumber, rawText, valid: false, reason };
}

export function toCards(lines: ParsedLine[]): NewCard[] {
  return lines.flatMap((line) => (line.valid ? [line.card] : []));
}

export function splitCloze(rawText: string) {
  const pieces: Array<{ kind: 'text'; value: string } | { kind: 'blank'; value: string; index: number }> = [];
  let lastIndex = 0;
  let blankIndex = 0;

  for (const match of rawText.matchAll(clozePattern)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      pieces.push({ kind: 'text', value: rawText.slice(lastIndex, start) });
    }
    pieces.push({ kind: 'blank', value: match[1], index: blankIndex });
    blankIndex += 1;
    lastIndex = start + match[0].length;
  }

  if (lastIndex < rawText.length) {
    pieces.push({ kind: 'text', value: rawText.slice(lastIndex) });
  }

  return pieces;
}
