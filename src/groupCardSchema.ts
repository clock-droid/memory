import type { GroupItem } from './types';

const bracketAnswerPattern = /\[([^\[\]]+)\]/g;

export function groupBodyAnswer(prompt: string, items: readonly GroupItem[]): string {
  const body = items.map((item) => `${item.marker || '· '}${item.text}`).join('\n');
  return body || prompt;
}

export function groupBracketAnswers(items: readonly GroupItem[]): string[] {
  return items.flatMap((item) =>
    [...item.text.matchAll(bracketAnswerPattern)]
      .map((match) => match[1].trim())
      .filter(Boolean),
  );
}

/**
 * The semantic answers used by study and the answers persisted on a group card
 * must be identical. A normal list is one recall unit; bracket blanks remain
 * independent recall units.
 */
export function groupSemanticAnswers(prompt: string, items: readonly GroupItem[]): string[] {
  const bracketAnswers = groupBracketAnswers(items);
  return bracketAnswers.length > 0 ? bracketAnswers : [groupBodyAnswer(prompt, items)];
}
