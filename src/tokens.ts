export type Token = { word: string; tail: string; hidden: boolean; gid: number; nl?: boolean };
export type Row = { kind: 'qa'; q: string; a: string } | { kind: 'tokens'; tokens: Token[] };

function splitParticle(word: string): { word: string; tail: string } {
  const match = word.match(/^(.{2,})([은는이가을를의와과도만])$/);
  if (match) return { word: match[1], tail: match[2] };
  return { word, tail: '' };
}

function tokenizeLine(line: string, gidStart = 1): Token[] {
  const tokens: Token[] = [];
  let gid = gidStart;
  const re = /\[([^\]]+)\]|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m[1] !== undefined) {
      tokens.push({ word: m[1].trim(), tail: '', hidden: true, gid: gid++ });
    } else {
      const sp = splitParticle(m[0]);
      tokens.push({ word: sp.word, tail: sp.tail, hidden: false, gid: 0 });
    }
  }
  return tokens;
}

export function tokenizeText(text: string, gidStart = 1): Token[] {
  let g = gidStart;
  let tokens: Token[] = [];
  text.split('\n').forEach((line, i) => {
    if (i > 0) tokens.push({ nl: true, word: '', tail: '', hidden: false, gid: 0 });
    tokens = tokens.concat(tokenizeLine(line, g));
    g += 100;
  });
  return tokens;
}

export function tokensToCard(tokens: Token[]): { q: string; a: string[] } {
  const qParts: string[] = [];
  const answers: string[] = [];
  let j = 0;
  while (j < tokens.length) {
    const t = tokens[j];
    if (t.nl) { qParts.push('\n'); j += 1; continue; }
    if (!t.hidden) { qParts.push(t.word + t.tail); j += 1; continue; }
    const g = t.gid;
    const run: Token[] = [];
    while (j < tokens.length && tokens[j].hidden && tokens[j].gid === g) { run.push(tokens[j]); j += 1; }
    const ansParts = run.map((tt, k) => (k < run.length - 1 ? tt.word + tt.tail : tt.word));
    answers.push(ansParts.join(' '));
    qParts.push('___' + run[run.length - 1].tail);
  }
  let q = '';
  for (const p of qParts) {
    if (p === '\n') { q = q.replace(/ $/, '') + '\n'; continue; }
    if (q && !q.endsWith('\n')) q += ' ';
    q += p;
  }
  return { q: q.trim(), a: answers };
}

export function cardToTokens(q: string, answers: string[]): Token[] {
  const tokens: Token[] = [];
  let g = 1;
  let ai = 0;
  q.split('\n').forEach((lineQ, li) => {
    if (li > 0) tokens.push({ nl: true, word: '', tail: '', hidden: false, gid: 0 });
    const parts = lineQ.split('___');
    parts.forEach((part, i) => {
      let rest = part;
      if (i > 0) {
        const tm = rest.match(/^(\S*)([\s\S]*)$/);
        tokens.push({ word: answers[ai++] || '', tail: tm ? tm[1] : '', hidden: true, gid: g++ });
        rest = tm ? tm[2] : rest;
      }
      for (const w of rest.trim().split(/\s+/).filter(Boolean)) {
        const sp = splitParticle(w);
        tokens.push({ word: sp.word, tail: sp.tail, hidden: false, gid: 0 });
      }
    });
  });
  return tokens;
}

export function tokensToText(tokens: Token[]) {
  return tokens.map((t) => (t.nl ? '\n' : t.word + t.tail)).join(' ').replace(/ ?\n ?/g, '\n').trim();
}

export function toggleTokenAt(tokens: Token[], index: number): Token[] {
  const target = tokens[index];
  if (!target || target.nl) return tokens;
  if (target.hidden) {
    return tokens.map((token) => (token.gid === target.gid ? { ...token, hidden: false, gid: 0 } : token));
  }
  const gid = (Date.now() % 1000000) + index;
  return tokens.map((token, tokenIndex) => (tokenIndex === index ? { ...token, hidden: true, gid } : token));
}

export function editSignature(mode: 'qa' | 'tokens', q: string, a: string, tokens: Token[]) {
  if (mode === 'qa') {
    return JSON.stringify(['qa', q.trim(), a.split(',').map((answer) => answer.trim()).filter(Boolean)]);
  }
  const card = tokensToCard(tokens);
  return JSON.stringify(['tokens', card.q, card.a]);
}

export function parsePaste(text: string, mode: 'auto' | 'one'): Row[] {
  if (mode === 'one') {
    const lines = text.replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    return [{ kind: 'tokens', tokens: tokenizeText(lines.join('\n'), 1) }];
  }
  const rows: Row[] = [];
  const cleaned = text.replace(/\r/g, '');
  const hasBlank = /\n\s*\n/.test(cleaned.trim());
  const units = hasBlank ? cleaned.split(/\n\s*\n+/) : cleaned.split('\n');
  let g = 1;
  for (const rawU of units) {
    const lines = rawU.split('\n').map((x) => x.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.length === 1) {
      const line = lines[0];
      const hasBracket = /\[[^\]]+\]/.test(line);
      if (!hasBracket) {
        const a = line.indexOf('->');
        const c = line.indexOf(':');
        const sep = a >= 0 && (c < 0 || a < c) ? { i: a, len: 2 } : c >= 0 ? { i: c, len: 1 } : null;
        if (sep && line.slice(0, sep.i).trim() && line.slice(sep.i + sep.len).trim()) {
          rows.push({ kind: 'qa', q: line.slice(0, sep.i).trim(), a: line.slice(sep.i + sep.len).trim() });
          continue;
        }
      }
      const tokens = tokenizeLine(line, g);
      g += 100;
      if (tokens.length > 0) rows.push({ kind: 'tokens', tokens });
    } else {
      const tokens = tokenizeText(lines.join('\n'), g);
      g += 100 * lines.length;
      if (tokens.length > 0) rows.push({ kind: 'tokens', tokens });
    }
  }
  return rows;
}
