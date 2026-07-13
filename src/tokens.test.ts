import { describe, expect, it } from 'vitest';
import type { Token } from './tokens';
import {
  cardToTokens,
  editSignature,
  parsePaste,
  toggleTokenAt,
  tokenizeText,
  tokensToCard,
  tokensToText,
} from './tokens';

describe('particle splitting (via tokenizeText)', () => {
  it('splits a 3+ char word ending in a Korean particle into word + tail', () => {
    const [t] = tokenizeText('학교를');
    expect(t).toMatchObject({ word: '학교', tail: '를', hidden: false });
  });

  it('does not split a 2-char word ending in a particle char', () => {
    const [t] = tokenizeText('물은');
    expect(t).toMatchObject({ word: '물은', tail: '' });
  });

  it('does not split a word ending in a non-particle char', () => {
    const [t] = tokenizeText('학교에서');
    expect(t).toMatchObject({ word: '학교에서', tail: '' });
  });
});

describe('tokenizeText', () => {
  it('turns a [bracket] into a hidden token and splits the visible word', () => {
    const tokens = tokenizeText('수도는 [서울]');
    expect(tokens.map((t) => ({ w: t.word, tail: t.tail, hidden: t.hidden }))).toEqual([
      { w: '수도', tail: '는', hidden: false },
      { w: '서울', tail: '', hidden: true },
    ]);
  });

  it('inserts an nl token between lines and bumps the gid base by 100 per line', () => {
    const tokens = tokenizeText('[a]\n[b]');
    expect(tokens.some((t) => t.nl)).toBe(true);
    expect(tokens.filter((t) => t.hidden).map((t) => t.gid)).toEqual([1, 101]);
  });
});

describe('tokensToCard / cardToTokens', () => {
  it('round-trips a single-blank cloze card', () => {
    const q = '대한민국의 수도는 ___';
    const a = ['서울'];
    expect(tokensToCard(cardToTokens(q, a))).toEqual({ q, a });
  });

  it('groups a same-gid run of hidden tokens into one answer', () => {
    const tokens: Token[] = [
      { word: '뉴턴', tail: '', hidden: true, gid: 5 },
      { word: '운동', tail: '의', hidden: true, gid: 5 },
      { word: '법칙', tail: '을', hidden: true, gid: 5 },
    ];
    expect(tokensToCard(tokens)).toEqual({ q: '___을', a: ['뉴턴 운동의 법칙'] });
  });

  it('round-trips a multi-line cloze with a blank on the second line', () => {
    const q = '첫째 줄\n둘째 ___';
    const a = ['답'];
    expect(tokensToCard(cardToTokens(q, a))).toEqual({ q, a });
  });
});

describe('tokensToText', () => {
  it('joins word+tail with spaces and collapses newlines', () => {
    expect(tokensToText(tokenizeText('가 나\n다'))).toBe('가 나\n다');
  });
});

describe('toggleTokenAt', () => {
  it('hides a visible token with a fresh nonzero gid, then clears it', () => {
    let tokens = tokenizeText('가 나 다');
    tokens = toggleTokenAt(tokens, 1);
    expect(tokens[1].hidden).toBe(true);
    expect(tokens[1].gid).toBeGreaterThan(0);
    tokens = toggleTokenAt(tokens, 1);
    expect(tokens[1]).toMatchObject({ hidden: false, gid: 0 });
  });

  it('clears every token sharing the toggled hidden gid', () => {
    const gid = 9;
    const tokens: Token[] = [
      { word: 'a', tail: '', hidden: true, gid },
      { word: 'b', tail: '', hidden: true, gid },
    ];
    const next = toggleTokenAt(tokens, 0);
    expect(next.every((t) => !t.hidden && t.gid === 0)).toBe(true);
  });

  it('returns the same array for an nl token or an out-of-range index', () => {
    const tokens = tokenizeText('가\n나');
    expect(toggleTokenAt(tokens, 1)).toBe(tokens);
    expect(toggleTokenAt(tokens, 99)).toBe(tokens);
  });
});

describe('editSignature', () => {
  it('splits qa answers on commas, trimming and dropping empties', () => {
    expect(editSignature('qa', ' Q ', 'a, b ,,c', [])).toBe(
      JSON.stringify(['qa', 'Q', ['a', 'b', 'c']]),
    );
  });

  it('derives the tokens signature from the reconstructed card', () => {
    const tokens = cardToTokens('___', ['x']);
    const card = tokensToCard(tokens);
    expect(editSignature('tokens', '', '', tokens)).toBe(JSON.stringify(['tokens', card.q, card.a]));
  });
});

describe('parsePaste', () => {
  it('mode "one" joins all non-empty lines into a single tokens row', () => {
    const rows = parsePaste('가\n나', 'one');
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('tokens');
  });

  it('mode "auto" parses a single "A: B" line as a qa row', () => {
    expect(parsePaste('A: B', 'auto')[0]).toMatchObject({ kind: 'qa', q: 'A', a: 'B' });
  });

  it('mode "auto" keeps a line with a [bracket] as a tokens row, not a pair', () => {
    expect(parsePaste('수도는 [서울]', 'auto')[0].kind).toBe('tokens');
  });

  it('mode "auto" splits blank-separated units into separate rows', () => {
    expect(parsePaste('A: 1\n\nB: 2', 'auto')).toHaveLength(2);
  });
});
