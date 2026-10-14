// R18-C2 (specs/intake-flow.md §27.6) — pure helpers over the form's answer sources. Engine island: engine
// types and stdlib only; no React, no store, no clock. Completed in R18-D2 (the record rows).
//
// Everything here is DERIVED from the answers and the description on every call. Nothing is stored, so a
// restored or edited draft can never show a stale "from your description" mark (DR8-F2-7).

import { normForQuote } from './mentioned';
import { shownQuestionIds, toPlainAnswers } from './form-visibility';
import { structureFor } from './question-structure';
import type { QuestionId } from './plain-questions';
import type { AnswerSource, FormAnswerState } from './prefill-types';
import type { PolicyFile } from './types';

/** True while this one quote still occurs (exactly, case-sensitive) in the whitespace-normalised description. */
export function quoteInText(quote: string, description: string): boolean {
  return quote !== '' && normForQuote(description).includes(quote);
}

/** The quotes a source stands on: a pre-filled answer's own, or the ones a changed answer was changed from. */
function quotesOf(source: AnswerSource): { option: string; quote: string }[] {
  if (source.kind === 'prefilled') return source.quotes;
  if (source.kind === 'changed') return source.from;
  return [];
}

/** Whether every quote the answer stands on is still in the description. False for a source with no quote
 *  (typed, record, not-carried). Derived on every render; never stored. */
export function quoteStillInText(source: AnswerSource, description: string): boolean {
  const quotes = quotesOf(source);
  return quotes.length > 0 && quotes.every((q) => quoteInText(q.quote, description));
}

/** The option keys an answer was pre-filled with, in order: its own quotes while pre-filled, the ones it was
 *  changed from once changed. Null for a source that was never pre-filled. */
export function originalPrefilled(source: AnswerSource): string[] | null {
  const quotes = quotesOf(source);
  return quotes.length > 0 ? quotes.map((q) => q.option) : null;
}

export interface QuoteContext {
  before: string;
  match: string;
  after: string;
}

const MAX_SIDE = 300;
const TERMINATOR = /[.!?]["'’”)\]]*(?=\s|$)/g;

/** The sentence around a quote, split at the quote, taken from the normalised description. A quote that spans a
 *  sentence boundary gets the joined span. Null when the quote is not in the text. Each side is capped (with an
 *  ellipsis) so a very long sentence cannot flood the screen. The caller escapes every part with visibleText. */
export function quoteContext(description: string, quote: string): QuoteContext | null {
  const text = normForQuote(description);
  const at = quote === '' ? -1 : text.indexOf(quote);
  if (at < 0) return null;
  const quoteEnd = at + quote.length;
  let start = 0;
  let end = text.length;
  let endFound = false;
  for (const m of text.matchAll(TERMINATOR)) {
    const stop = m.index + m[0].length; // just after the terminator
    if (stop <= at) {
      start = stop;
      while (text[start] === ' ') start += 1;
    } else if (stop >= quoteEnd && !endFound) {
      end = stop;
      endFound = true;
    }
  }
  let before = text.slice(start, at);
  let after = text.slice(quoteEnd, end);
  if (before.length > MAX_SIDE) before = '…' + before.slice(before.length - MAX_SIDE);
  if (after.length > MAX_SIDE) after = after.slice(0, MAX_SIDE) + '…';
  return { before, match: quote, after };
}

export interface AnswerSourceCounts {
  /** N: shown select questions whose answer was pre-filled by a model and confirmed. */
  confirmedFilled: number;
  /** K: shown select questions whose pre-filled answer the person changed. */
  changed: number;
  /** M: shown select questions that have a value (free-text questions and the description are not counted). */
  answered: number;
}

function hasValue(value: string | string[]): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== '';
}

/** The counts behind "N of M answers were filled in by a model and confirmed by you, and K were changed by you".
 *  One per QUESTION (a tick-all question with two quotes counts once); a hidden question is not counted;
 *  whether a quote is still in the description does not matter. */
export function answerSourceCounts(
  answerState: FormAnswerState,
  description: string,
  policy: PolicyFile,
): AnswerSourceCounts {
  const shown = shownQuestionIds(toPlainAnswers(answerState, description), policy);
  let confirmedFilled = 0;
  let changed = 0;
  let answered = 0;
  for (const id of shown) {
    if (id === '2' || structureFor(id)?.kind === 'free') continue;
    const entry = answerState[id];
    if (!entry || entry.source.kind === 'not-carried' || !hasValue(entry.value)) continue;
    answered += 1;
    if (entry.source.kind === 'prefilled' && entry.source.confirmed) confirmedFilled += 1;
    else if (entry.source.kind === 'changed') changed += 1;
  }
  return { confirmedFilled, changed, answered };
}

/** The shown questions whose pre-filled or earlier-record answer still waits for a tick, in the form's order. */
export function unconfirmedIds(answerState: FormAnswerState, description: string, policy: PolicyFile): QuestionId[] {
  const shown = shownQuestionIds(toPlainAnswers(answerState, description), policy);
  return shown.filter((id) => {
    if (id === '2') return false;
    const source = answerState[id]?.source;
    return source !== undefined && (source.kind === 'prefilled' || source.kind === 'record') && !source.confirmed;
  });
}
