import { answerDueAt, normalizeAnswerSchedule, rateAnswer } from './answerSchedule';
import type { AnswerSchedule, Card } from './types';

/**
 * One hide — the unit the user actually recalls and judges.
 *
 * A card is a container for hides, so everything this app reports about
 * learning (progress, sessions, checkups) is a summary of these and never a
 * single verdict on the card as a whole. Storage still keeps the per-hide state
 * as arrays parallel to `answers`; this is the shape the rest of the app works
 * in, so nothing outside this module has to keep those arrays aligned.
 */
export type Hide = {
  /** Position inside its card. Hides are identified by position, not by id. */
  index: number;
  /** The text kept covered until the user recalls it. */
  text: string;
  /** The user's last judgment on this hide. */
  known: boolean;
  /** Serialized FSRS state, or null when this hide was never rated. */
  schedule: AnswerSchedule | null;
  /** When a known hide is worth checking again. */
  dueAt: number;
};

type MasterySource = Pick<Card, 'answerMastery' | 'mastered'> & Partial<Pick<Card, 'type' | 'answers'>>;

/**
 * Reads the stored per-hide mastery, standing in for cards written before it
 * existed: those only recorded one card-level `mastered` flag.
 */
export function normalizeAnswerMastery(card: MasterySource, hideCount: number): boolean[] {
  const legacyEmptyGroupMastery = card.type === 'group'
    && Array.isArray(card.answers)
    && card.answers.length === 0
    && Array.isArray(card.answerMastery)
    && card.answerMastery.length === 0;
  if (Array.isArray(card.answerMastery) && !legacyEmptyGroupMastery) {
    return Array.from({ length: hideCount }, (_, index) => Boolean(card.answerMastery?.[index]));
  }
  return Array.from({ length: hideCount }, () => Boolean(card.mastered));
}

/** The hides of a stored card, given the answer texts derived from it. */
export function buildHides(card: Card, texts: string[]): Hide[] {
  const mastery = normalizeAnswerMastery(card, texts.length);
  const schedules = normalizeAnswerSchedule(card, texts.length);
  return texts.map((text, index) => ({
    index,
    text,
    known: Boolean(mastery[index]),
    schedule: schedules[index],
    dueAt: answerDueAt(schedules[index], card.updatedAt),
  }));
}

/**
 * Hides of a card that cannot be studied yet: the text is shown so the user can
 * repair it, but no judgment history is claimed for it.
 */
export function unratedHides(card: Pick<Card, 'updatedAt'>, texts: string[]): Hide[] {
  return texts.map((text, index) => ({
    index,
    text,
    known: false,
    schedule: null,
    dueAt: answerDueAt(null, card.updatedAt),
  }));
}

export const hideTexts = (hides: Hide[]) => hides.map((hide) => hide.text);
export const knownCountOf = (hides: Hide[]) => hides.filter((hide) => hide.known).length;
export const unknownHides = (hides: Hide[]) => hides.filter((hide) => !hide.known);
export const hideIndexes = (hides: Hide[]) => hides.map((hide) => hide.index);

/** Known hides whose check date has passed: the judgment has to be re-earned. */
export const dueHides = (hides: Hide[], now: number) =>
  hides.filter((hide) => hide.known && hide.dueAt <= now);

/** The wire shape: arrays parallel to the card's `answers`. */
export const hideMastery = (hides: Hide[]) => hides.map((hide) => hide.known);
export const hideSchedules = (hides: Hide[]): Array<AnswerSchedule | null> =>
  hides.map((hide) => hide.schedule);

/**
 * Applies one judgment to the hides that were just asked: each counts as known
 * unless the user marked it for retry, and its schedule advances from there.
 */
export function rateHides(
  hides: Hide[],
  judgedIndexes: number[],
  retried: ReadonlySet<number>,
  judgedAt: number,
): Hide[] {
  const judged = new Set(judgedIndexes);
  return hides.map((hide) => {
    if (!judged.has(hide.index)) return hide;
    const knew = !retried.has(hide.index);
    const schedule = rateAnswer(hide.schedule, knew, judgedAt);
    return { ...hide, known: knew, schedule, dueAt: schedule.due };
  });
}
