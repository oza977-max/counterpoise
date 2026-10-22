// R18-C2 (specs/intake-flow.md §27.6) — pure helpers over the form's answer sources. Engine island: engine
// types and stdlib only; no React, no store, no clock. Completed in R18-D2 (the record rows).
//
// Everything here is DERIVED from the answers and the description on every call. Nothing is stored, so a
// restored or edited draft can never show a stale "from your description" mark (DR8-F2-7).

import { normForQuote } from './mentioned';
import { isValidMultiSelection, shownQuestionIds, toPlainAnswers } from './form-visibility';
import { FREE_ANSWER_MAX_CHARS, isShown, QUESTION_STRUCTURE, structureFor, validOptionKeys } from './question-structure';
import type { PlainAnswers, QuestionId } from './plain-questions';
import { visibleText } from './visible-text';
import type {
  AnswerSource,
  AnswerSourceRecord,
  AnswerSources,
  FormAnswerState,
  ModelPlace,
  PrefillCatalogue,
  QuoteRef,
  ReadRecord,
} from './prefill-types';
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

// ── R18-D2 (specs/intake-flow.md §27.13 Writer, §27.10): the WRITE side of the record, and its inverse ───────
//
// `toAnswerSources` is the one writer: it is called once per confirm attempt, from runConfirmAndEvaluate, and
// nowhere else. `answersFromRecord` is the one inverse: it rebuilds the form's answers from a saved record for
// "Correct this check". The record it reads is UNTRUSTED (a saved case, or a hand-off file someone else made and
// sealed), so every field is checked as it is used, every string is bounded, and nothing is believed beyond what
// it can be checked against: an answer comes back confirmed only when its origin word, its quotes and its read
// are all well-formed; anything unknown becomes blank, and a pre-fill that cannot prove who read it comes back as
// an earlier-record answer that still needs its tick.

function copyValue(value: string | string[]): string | string[] {
  return Array.isArray(value) ? [...value] : value;
}

function hasAnswer(value: string | string[]): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== '';
}

function copyQuotes(quotes: readonly QuoteRef[]): QuoteRef[] {
  return quotes.map((q) => ({ option: q.option, quote: q.quote }));
}

/** The record of where each confirmed answer came from (§27.13), in the form's question order. Pure and
 *  deterministic: the same state and description give the same bytes. Question 2 (the description) is never a
 *  row. A `typed` or confirmed answer is a row; an answer that is not confirmed, a blank one and a not-carried
 *  one are not (the form cannot reach Confirm with an unconfirmed answer, and a row would claim one). `reads`
 *  holds each distinct model/place/host once, in first-seen order, and `read` is the index into it. */
export function toAnswerSources(answerState: FormAnswerState, description: string, policy?: PolicyFile): AnswerSources {
  // A question that is not shown for these answers is never a row (a stale entry for a hidden question would
  // otherwise be recorded as an answer the person never gave). Without a policy nothing can be judged hidden.
  const shown = policy ? new Set<string>(shownQuestionIds(toPlainAnswers(answerState, description), policy)) : null;
  const reads: ReadRecord[] = [];
  const answers: AnswerSourceRecord[] = [];
  const indexOfRead = (r: ReadRecord): number => {
    const at = reads.findIndex((x) => x.model === r.model && x.place === r.place && x.host === r.host);
    if (at >= 0) return at;
    reads.push({ model: r.model, place: r.place, host: r.host });
    return reads.length - 1;
  };
  for (const q of QUESTION_STRUCTURE) {
    if (q.id === '2') continue;
    if (shown && !shown.has(q.id)) continue;
    const entry = answerState[q.id as Exclude<QuestionId, '2'>];
    if (!entry || !hasAnswer(entry.value)) continue;
    const source = entry.source;
    const value = copyValue(entry.value);
    switch (source.kind) {
      case 'typed':
        answers.push({ question_id: q.id, value, origin: 'typed' });
        break;
      case 'prefilled':
        if (!source.confirmed) break;
        answers.push({
          question_id: q.id,
          value,
          origin: 'prefilled_confirmed',
          quotes: copyQuotes(source.quotes),
          quote_in_final_description: quoteStillInText(source, description),
          read: indexOfRead(source.read),
        });
        break;
      case 'changed':
        answers.push({
          question_id: q.id,
          value,
          origin: 'prefilled_changed',
          quotes: copyQuotes(source.from),
          changed_from: copyQuotes(source.from),
          quote_in_final_description: quoteStillInText(source, description),
          read: indexOfRead(source.read),
        });
        break;
      case 'record':
        if (!source.confirmed) break;
        answers.push({ question_id: q.id, value, origin: 'from_earlier_record' });
        break;
      case 'not-carried':
        break;
    }
  }
  return { reads, answers };
}

const MAX_RESTORE_ROWS = 40;
const MAX_RESTORE_READS = 10;
const MAX_RESTORE_QUOTES = 20;
const MAX_ID = 40;
const MAX_QUOTE = 300;
const MAX_MODEL = 100;
const MAX_HOST = 253;

function restoreRead(v: unknown): ReadRecord | null {
  if (!isRecord(v)) return null;
  const { model, place, host } = v;
  if (typeof model !== 'string' || model.length > MAX_MODEL) return null;
  if (typeof place !== 'string' || !KNOWN_PLACES.has(place)) return null;
  if (typeof host !== 'string' || host.length > MAX_HOST) return null;
  return { model, place: place as ModelPlace, host };
}

/** Quotes that are all well-formed and bounded, or null. One bad quote makes the lot unusable: a pre-fill is
 *  confirmed only on quotes that can be believed whole. */
function restoreQuotes(v: unknown): QuoteRef[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_RESTORE_QUOTES) return null;
  const out: QuoteRef[] = [];
  for (const q of v) {
    if (!isRecord(q)) return null;
    const { option, quote } = q;
    if (typeof option !== 'string' || option === '' || option.length > MAX_ID) return null;
    if (typeof quote !== 'string' || quote === '' || quote.length > MAX_QUOTE) return null;
    out.push({ option, quote });
  }
  return out;
}

/** The value, if the form would offer it now (given the answers kept so far); null otherwise. */
function restoreValue(id: Exclude<QuestionId, '2'>, v: unknown, kept: PlainAnswers, policy: PolicyFile): string | string[] | null {
  const q = structureFor(id);
  if (!q) return null;
  if (q.kind === 'free') {
    return typeof v === 'string' && v.trim() !== '' && v.length <= FREE_ANSWER_MAX_CHARS ? v : null;
  }
  const offered = validOptionKeys(id, kept, policy);
  if (q.kind === 'single') return typeof v === 'string' && offered.includes(v) ? v : null;
  if (!Array.isArray(v) || !v.every((k): k is string => typeof k === 'string')) return null;
  if (!isValidMultiSelection(id, v) || !v.every((k) => offered.includes(k))) return null;
  return [...v];
}

/** The form's answers rebuilt from a saved `answer_sources` (§27.10), for "Correct this check". Walks the
 *  questions in the form's order; a row is kept only if its question is shown for the answers kept so far, its
 *  value is one the form offers now, and its origin is one of the four this build writes. OWNER DECISION
 *  2026-10-22: nothing comes back confirmed that this person has not ticked. A record can be self-asserted (a
 *  hand-off file someone else made), so a restored model answer must be ticked afresh, and the new record then
 *  says "confirmed" only of THIS person:
 *   - `typed` stays typed;
 *   - `prefilled_confirmed` comes back as a pre-fill with its quotes and read, UNCONFIRMED;
 *   - `prefilled_changed` comes back as an UNCONFIRMED earlier-record answer (value kept), so unless it is
 *     changed it is written as `from_earlier_record` and never claims this person made the earlier change;
 *   - `from_earlier_record`, and a pre-fill that cannot be checked, come back as an unconfirmed earlier-record
 *     answer;
 *   - an unknown origin word is dropped (blank), never believed.
 *  One row per question (the first wins); Question 2 and unknown ids are ignored. A copy; the record is untouched.
 *  `dropped` names, in the form's order, the questions that had a recorded row which could not be restored
 *  (the value is not one the form offers now, or the question is no longer shown), so the person can be told. */
export function restoreFromRecord(raw: unknown, policy: PolicyFile): { answerState: FormAnswerState; dropped: string[] } {
  const out: FormAnswerState = {};
  const dropped: string[] = [];
  if (!isRecord(raw) || !Array.isArray(raw.answers)) return { answerState: out, dropped };
  const reads: (ReadRecord | null)[] = Array.isArray(raw.reads) ? raw.reads.slice(0, MAX_RESTORE_READS).map(restoreRead) : [];
  const rows = new Map<string, Record<string, unknown>>();
  for (const row of raw.answers.slice(0, MAX_RESTORE_ROWS)) {
    if (!isRecord(row) || typeof row.question_id !== 'string' || row.question_id.length > MAX_ID) continue;
    if (!rows.has(row.question_id)) rows.set(row.question_id, row);
  }
  const kept: PlainAnswers = {};
  for (const q of QUESTION_STRUCTURE) {
    if (q.id === '2') continue;
    const id = q.id as Exclude<QuestionId, '2'>;
    const row = rows.get(id);
    if (!row) continue;
    if (!isShown(id, kept, policy)) {
      dropped.push(id);
      continue;
    }
    const value = restoreValue(id, row.value, kept, policy);
    if (value === null) {
      dropped.push(id);
      continue;
    }
    const index = row.read;
    const read = typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < reads.length ? (reads[index] ?? null) : null;
    let source: AnswerSource | null = null;
    switch (str(row.origin)) {
      case 'typed':
        source = { kind: 'typed' };
        break;
      case 'prefilled_confirmed':
      case 'prefilled_changed': {
        if (q.kind === 'free') break;
        const changed = row.origin === 'prefilled_changed';
        const quotes = restoreQuotes(changed ? (row.changed_from ?? row.quotes) : row.quotes);
        if (changed) {
          // A well-formed row keeps its read; the earlier change is not this person's to claim, so it is not
          // confirmed. A row whose quotes cannot be believed keeps nothing.
          source = quotes && read ? { kind: 'record', confirmed: false, read } : { kind: 'record', confirmed: false };
        } else if (quotes && read) {
          source = { kind: 'prefilled', quotes, read, confirmed: false };
        } else {
          source = { kind: 'record', confirmed: false };
        }
        break;
      }
      case 'from_earlier_record':
        source = { kind: 'record', confirmed: false };
        break;
    }
    if (source === null) continue;
    out[id] = { value: copyValue(value), source };
    kept[id] = copyValue(value);
  }
  return { answerState: out, dropped };
}

/** The restored answers alone (see restoreFromRecord). */
export function answersFromRecord(raw: unknown, policy: PolicyFile): FormAnswerState {
  return restoreFromRecord(raw, policy).answerState;
}
