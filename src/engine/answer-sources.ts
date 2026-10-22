// R18-C2 (specs/intake-flow.md §27.6) — pure helpers over the form's answer sources. Engine island: engine
// types and stdlib only; no React, no store, no clock. Completed in R18-D2 (the record rows).
//
// Everything here is DERIVED from the answers and the description on every call. Nothing is stored, so a
// restored or edited draft can never show a stale "from your description" mark (DR8-F2-7).

import { normForQuote } from './mentioned';
import { shownQuestionIds, toPlainAnswers } from './form-visibility';
import { structureFor } from './question-structure';
import type { QuestionId } from './plain-questions';
import { visibleText } from './visible-text';
import type { AnswerSource, FormAnswerState, ModelPlace, PrefillCatalogue } from './prefill-types';
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

// ── R18-D1 (specs/intake-flow.md §27.13): the READ side of the record ─────────────────────────────────────────
//
// `answer_sources` arrives from a saved case or from a hand-off file someone else made, so it is read as
// untrusted input (BC-002): every field is checked as it is used, every lookup of a word that came from the
// record goes through a Map or a Set (never an object property), and every string handed back has already been
// through visibleText(), so the component can render it as text and cannot forget to. Unknown words are
// tolerated, not crashed on: an unknown origin or place, an unknown question or option, a read index that is not
// inside `reads`. The reader decides nothing about wording; it returns facts, and plain-copy.ts words them.

const KNOWN_PLACES: ReadonlySet<string> = new Set<ModelPlace>(['this-computer', 'firm-server', 'ollama-cloud']);
const KNOWN_ORIGINS: ReadonlySet<string> = new Set([
  'typed',
  'prefilled_confirmed',
  'prefilled_changed',
  'from_earlier_record',
]);

export type OriginView = 'typed' | 'prefilled_confirmed' | 'prefilled_changed' | 'from_earlier_record' | 'unrecognised';

/** One read, as configured. `place` is null for a word this build does not know (shown neutrally, never as the word). */
export interface ReadView {
  model: string;
  place: ModelPlace | null;
  host: string;
}

export interface QuoteView {
  /** The option in words (or the raw key when the words do not have it). */
  option: string;
  quote: string;
}

export interface AnswerView {
  /** The question in words, or the raw id when it is not a question this build knows. */
  question: string;
  /** The answer in words (option texts, or the typed text). Empty when the row carries no value. */
  value: string;
  origin: OriginView;
  /** The quotes a prefilled origin stands on; for a changed answer, the ones it was changed from. */
  quotes: QuoteView[];
  /** The model that read it, from the row's `read` index; null when there is no usable index. */
  read: ReadView | null;
  /** True only when the record says so (quote_in_final_description === false). Absent never claims it. */
  quoteGone: boolean;
}

export interface AnswerSourcesView {
  reads: ReadView[];
  answers: AnswerView[];
  counts: AnswerSourceCounts;
}

export interface SourceWords {
  /** The question's plain words, or undefined for an id this build does not know. */
  questionLabel: (id: string) => string | undefined;
  /** The closed select catalogue (a Map of Maps). Free-text questions are not in it. */
  catalogue: PrefillCatalogue;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function readOf(v: unknown): ReadView | null {
  if (!isRecord(v)) return null;
  const place = str(v.place);
  return {
    model: visibleText(str(v.model)),
    place: KNOWN_PLACES.has(place) ? (place as ModelPlace) : null,
    host: visibleText(str(v.host)),
  };
}

function optionWords(words: SourceWords, questionId: string, key: string): string {
  // Map.get with a record-supplied string is safe: a Map has no prototype lookup (DR8-R2-E-N2).
  const text = words.catalogue.get(questionId as never)?.options.get(key)?.text;
  return visibleText(text ?? key);
}

function recordQuotes(v: unknown, questionId: string, words: SourceWords): QuoteView[] {
  if (!Array.isArray(v)) return [];
  const out: QuoteView[] = [];
  for (const q of v) {
    if (!isRecord(q) || typeof q.quote !== 'string') continue;
    out.push({ option: optionWords(words, questionId, str(q.option)), quote: visibleText(q.quote) });
  }
  return out;
}

/** Turns a record's `answer_sources` into what the register shows. Null when there is nothing to show (absent, not
 *  an object, or no usable rows), so a case without sources renders exactly as before this round. */
export function readAnswerSources(raw: unknown, words: SourceWords): AnswerSourcesView | null {
  if (!isRecord(raw) || !Array.isArray(raw.answers)) return null;

  // Per original index, so a row's `read` points at the right entry; then the distinct reads for the lines.
  const byIndex: (ReadView | null)[] = Array.isArray(raw.reads) ? raw.reads.map(readOf) : [];
  const reads: ReadView[] = [];
  const seen = new Set<string>();
  for (const r of byIndex) {
    if (!r) continue;
    const key = JSON.stringify([r.model, r.place, r.host]);
    if (seen.has(key)) continue;
    seen.add(key);
    reads.push(r);
  }

  const answers: AnswerView[] = [];
  let confirmedFilled = 0;
  let changed = 0;
  let answered = 0;
  const seenQuestions = new Set<string>();
  for (const row of raw.answers) {
    if (!isRecord(row) || typeof row.question_id !== 'string') continue;
    const id = row.question_id;
    // One answer per question: the first row wins, later duplicates are neither counted nor shown (§27.13).
    if (seenQuestions.has(id)) continue;
    seenQuestions.add(id);
    const originWord = str(row.origin);
    const origin: OriginView = KNOWN_ORIGINS.has(originWord) ? (originWord as OriginView) : 'unrecognised';
    const known = words.catalogue.has(id as never);

    const rawValue = row.value;
    const keys = Array.isArray(rawValue) ? rawValue.filter((x): x is string => typeof x === 'string') : typeof rawValue === 'string' ? [rawValue] : [];
    const nonEmpty = keys.filter((k) => k !== '');
    const value = nonEmpty.map((k) => (known ? optionWords(words, id, k) : visibleText(k))).join(', ');

    // A prefilled answer is always a select answer, so it counts even when its question id is not one this
    // build knows; a typed answer counts only when it is a select question (free text is not counted).
    const isPrefilled = origin === 'prefilled_confirmed' || origin === 'prefilled_changed';
    // N and K sit under the same guard as M, so N + K can never exceed M (an imported row for Question 2 or
    // with no value cannot make "1 of 0").
    if (id !== '2' && nonEmpty.length > 0 && (known || isPrefilled)) {
      answered += 1;
      if (origin === 'prefilled_confirmed') confirmedFilled += 1;
      if (origin === 'prefilled_changed') changed += 1;
    }

    const quoteSource = origin === 'prefilled_changed' && Array.isArray(row.changed_from) ? row.changed_from : row.quotes;
    const index = row.read;
    const read = typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < byIndex.length ? (byIndex[index] ?? null) : null;

    answers.push({
      question: visibleText(words.questionLabel(id) ?? id),
      value,
      origin,
      quotes: isPrefilled ? recordQuotes(quoteSource, id, words) : [],
      read,
      quoteGone: isPrefilled && row.quote_in_final_description === false,
    });
  }
  if (answers.length === 0 && reads.length === 0) return null;
  return { reads, answers, counts: { confirmedFilled, changed, answered } };
}
