import { describe, expect, it } from 'vitest';
import { parseInput, splitCloze, toCards } from './parser';

describe('parseInput / parseLine', () => {
  it('parses a pair with a colon separator', () => {
    const [line] = parseInput('사과: apple');
    expect(line).toMatchObject({ valid: true, card: { type: 'pair', prompt: '사과', answers: ['apple'] } });
  });

  it('parses a pair with an arrow separator', () => {
    const [line] = parseInput('사과 -> apple');
    expect(line).toMatchObject({ valid: true, card: { type: 'pair', prompt: '사과', answers: ['apple'] } });
  });

  it('lets a colon before an arrow win the split', () => {
    const [line] = parseInput('A: B -> C');
    expect(line).toMatchObject({ valid: true, card: { type: 'pair', prompt: 'A', answers: ['B -> C'] } });
  });

  it('treats [bracket] blanks as cloze, overriding a pair colon', () => {
    const [line] = parseInput('처방증상 : [A], [b], d');
    expect(line).toMatchObject({ valid: true, card: { type: 'cloze', answers: ['A', 'b'] } });
  });

  it('flags a line with an empty separator side as invalid', () => {
    const [line] = parseInput('A:');
    expect(line.valid).toBe(false);
  });

  it('flags a plain sentence with no separator/bracket as invalid', () => {
    const [line] = parseInput('그냥 문장입니다');
    expect(line.valid).toBe(false);
  });

  it('flags a bare list line outside a group as invalid', () => {
    const [line] = parseInput('- 항목');
    expect(line).toMatchObject({ valid: false });
    if (!line.valid) expect(line.reason).toContain('묶음 제목');
  });
});

describe('parseGroup', () => {
  it('builds a group card from a title and a list', () => {
    const parsed = parseInput('과일:\n- 사과\n- 배');
    const group = parsed.find((p) => p.valid && p.card.type === 'group');
    expect(group).toMatchObject({
      valid: true,
      card: { type: 'group', prompt: '과일', answers: ['- 사과\n- 배'] },
    });
    if (group?.valid) expect(group.card.groupItems).toHaveLength(2);
  });

  it('collects [bracket] answers from group items in order', () => {
    const parsed = parseInput('반응식:\n1. 물은 [H2O]\n2. 소금은 [NaCl]');
    const group = parsed.find((p) => p.valid && p.card.type === 'group');
    if (group?.valid) expect(group.card.answers).toEqual(['H2O', 'NaCl']);
  });

  it('flags a group title with no following list as invalid', () => {
    const parsed = parseInput('과일:\n\n다음 문장');
    expect(parsed.some((p) => !p.valid && p.reason.includes('목록이 없습니다'))).toBe(true);
  });

  it('flags a nested (indented) list item as unsupported', () => {
    const parsed = parseInput('과일:\n  - 사과');
    expect(parsed.some((p) => !p.valid && p.reason.includes('중첩'))).toBe(true);
  });
});

describe('splitCloze', () => {
  it('splits surrounding text and blanks with blank indexes', () => {
    expect(splitCloze('물은 [H2O] 이다')).toEqual([
      { kind: 'text', value: '물은 ' },
      { kind: 'blank', value: 'H2O', index: 0 },
      { kind: 'text', value: ' 이다' },
    ]);
  });

  it('returns a single text piece when there are no brackets', () => {
    expect(splitCloze('hello')).toEqual([{ kind: 'text', value: 'hello' }]);
  });

  it('does not emit an empty text piece at a leading blank', () => {
    expect(splitCloze('[a] b')).toEqual([
      { kind: 'blank', value: 'a', index: 0 },
      { kind: 'text', value: ' b' },
    ]);
  });
});

describe('toCards', () => {
  it('keeps only the valid parsed lines, in order', () => {
    const cards = toCards(parseInput('사과: apple\n그냥문장\n배 -> pear'));
    expect(cards.map((c) => c.prompt)).toEqual(['사과', '배']);
  });
});
