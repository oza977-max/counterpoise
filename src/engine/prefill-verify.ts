// R18-C1 (specs/intake-flow.md §27.4 steps 3-4, ADR-IF-R18-2) — the verifier.
// The model proposes, this pure function disposes, the person decides. A model reply is untrusted
// input: it is recognised fully against a CLOSED catalogue (Map lookups only, never an object-property
// lookup on a reply key), parsed once, and only what survives every rule becomes a Prefill. Engine
// island: engine types and stdlib only; no model, clock, random or I/O.

import { isShown, validOptionKeys, QUESTION_STRUCTURE } from './question-structure';
import { isValidMultiSelection } from './form-visibility';
import { codePointLength, normForQuote } from './mentioned';
import { findRatingInstructions } from './rating-instructions';
import type { PlainAnswers, QuestionId } from './plain-questions';
import type { DropReason, Prefill, PrefillAnswer, PrefillCatalogue, VerifyResult } from './prefill-types';
import type { PolicyFile } from './types';

/** A verified quote has at least this many words ... */
export const QUOTE_MIN_WORDS = 2;
/** ... and at most this many characters (Unicode code points) of its normalised form. */
export const QUOTE_MAX_CHARS = 300;

// Control, format, private-use, surrogate and unassigned code points (Cc Cf Co Cs Cn): this is what
// removes zero-width and bidirectional-override characters (DR8-E-6).
const HIDDEN_CHARS = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}]/u;

export const DROP_REASONS: readonly DropReason[] = [
  'malformed-reply',
  'unknown-question',
  'duplicate-question',
  'unknown-option',
  'invalid-option',
  'too-many-values',
  'duplicate-option',
  'bad-quote',
  'quote-not-in-description',
  'rating-instruction',
  'hidden',
];

function zeroCounts(): Record<DropReason, number> {
  return {
    'malformed-reply': 0,
    'unknown-question': 0,
    'duplicate-question': 0,
    'unknown-option': 0,
    'invalid-option': 0,
    'too-many-values': 0,
    'duplicate-option': 0,
    'bad-quote': 0,
    'quote-not-in-description': 0,
    'rating-instruction': 0,
    hidden: 0,
  };
}

/** An own property of a plain parsed-JSON object, or undefined: nothing is ever read from a prototype. */
function own(obj: unknown, key: string): unknown {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return undefined;
  return Object.prototype.hasOwnProperty.call(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;
}

function isRecord(v: unknown): v is object {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The stored form of a quote if it passes the shape rules (words, length, no hidden code points), else null. */
function shapedQuote(quote: unknown): string | null {
  if (typeof quote !== 'string') return null;
  const norm = normForQuote(quote);
  if (norm.split(' ').filter((w) => w.length > 0).length < QUOTE_MIN_WORDS) return null;
  if (codePointLength(norm) > QUOTE_MAX_CHARS) return null;
  if (HIDDEN_CHARS.test(norm)) return null;
  return norm;
}

interface Candidate {
  values: unknown[];
}

/**
 * Checks a model reply against the catalogue and the description. Returns the surviving Prefill and,
 * for the Settings test and the in-app counts, how many values were dropped and why. A failure drops
 * that value only. Never throws on any input.
 */
export function verifyPrefill(
  raw: unknown,
  catalogue: PrefillCatalogue,
  description: string,
  policy: PolicyFile,
): VerifyResult {
  const dropped = zeroCounts();
  const prefill: Prefill = new Map();
  const answers = own(raw, 'answers');
  if (!Array.isArray(answers)) {
    dropped['malformed-reply'] += 1;
    return { prefill, dropped };
  }

  // 1. Entries: the question must be a key of the catalogue Map; a repeated question keeps the first entry.
  const candidates = new Map<QuestionId, Candidate>();
  for (const entry of answers as unknown[]) {
    const question = own(entry, 'question');
    const values = own(entry, 'values');
    const weight = Array.isArray(values) ? Math.max(1, values.length) : 1;
    if (!isRecord(entry)) {
      dropped['malformed-reply'] += 1;
    } else if (typeof question !== 'string' || !catalogue.has(question as QuestionId)) {
      dropped['unknown-question'] += weight;
    } else if (candidates.has(question as QuestionId)) {
      dropped['duplicate-question'] += weight;
    } else if (!Array.isArray(values)) {
      candidates.set(question as QuestionId, { values: [] });
      dropped['malformed-reply'] += 1;
    } else {
      candidates.set(question as QuestionId, { values });
    }
  }

  const text = normForQuote(description);
  // The answers the form would hold so far: earlier surviving questions only (progressive visibility, step 4).
  const progressive: PlainAnswers = {};

  // 2-4. Per question in the form's order, so a question's validity and visibility see only earlier answers.
  for (const structure of QUESTION_STRUCTURE) {
    const id = structure.id;
    const candidate = candidates.get(id);
    const question = catalogue.get(id);
    if (!candidate || !question) continue;

    // A single-choice answer with more than one value keeps none.
    if (question.kind === 'single' && candidate.values.length > 1) {
      dropped['too-many-values'] += candidate.values.length;
      continue;
    }

    const shown = isShown(id, progressive, policy);
    const currentKeys = shown ? validOptionKeys(id, progressive, policy) : null;
    const kept: { option: string; quote: string }[] = [];
    for (const value of candidate.values) {
      const option = own(value, 'option');
      if (!isRecord(value)) {
        dropped['malformed-reply'] += 1;
        continue;
      }
      if (typeof option !== 'string' || !question.options.has(option)) {
        dropped['unknown-option'] += 1;
        continue;
      }
      if (currentKeys !== null && !currentKeys.includes(option)) {
        dropped['invalid-option'] += 1;
        continue;
      }
      if (kept.some((k) => k.option === option)) {
        dropped['duplicate-option'] += 1;
        continue;
      }
      if (question.kind === 'multi' && !isValidMultiSelection(id, [...kept.map((k) => k.option), option])) {
        dropped['invalid-option'] += 1;
        continue;
      }
      const quote = shapedQuote(own(value, 'quote'));
      if (quote === null) {
        dropped['bad-quote'] += 1;
        continue;
      }
      if (!text.includes(quote)) {
        dropped['quote-not-in-description'] += 1;
        continue;
      }
      if (findRatingInstructions(quote).length > 0) {
        dropped['rating-instruction'] += 1;
        continue;
      }
      kept.push({ option, quote });
    }
    if (kept.length === 0) continue;

    // 4. A pre-fill for a question the form would not show given the earlier answers is dropped.
    if (!shown) {
      dropped.hidden += kept.length;
      continue;
    }
    const answer: PrefillAnswer = { values: kept };
    prefill.set(id, answer);
    progressive[id] = question.kind === 'multi' ? kept.map((k) => k.option) : kept[0]!.option;
  }
  return { prefill, dropped };
}

/** The reply shape of §27.4 step 2 for a Prefill: the inverse reshaping, so
 *  verifyPrefill(toRawPrefill(verify(x).prefill)) yields the same prefill (TC-R18-GI-3-11). */
export function toRawPrefill(prefill: Prefill): { answers: { question: string; values: { option: string; quote: string }[] }[] } {
  return {
    answers: [...prefill.entries()].map(([question, answer]) => ({
      question,
      values: answer.values.map((v) => ({ option: v.option, quote: v.quote })),
    })),
  };
}
