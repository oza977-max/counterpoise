// R18-A — pure helpers over the form's one answer-state object
// (specs/intake-flow.md §27.6). Engine island: no React, no store, no clock.

import { normForQuote } from './mentioned';
import type { PlainAnswers } from './plain-questions';
import type { FormAnswerState } from './prefill-types';

/**
 * The only way to make a PlainAnswers from the form's state. Question 2 is the
 * description (state.description), never a form answer, so it is added here and
 * a stray '2' entry in the state is ignored. A 'not-carried' answer is blank by
 * definition and is left out. Arrays are copied.
 */
export function toPlainAnswers(state: FormAnswerState, description: string): PlainAnswers {
  const out: PlainAnswers = {};
  for (const id of Object.keys(state) as (keyof FormAnswerState)[]) {
    if (id === '2') continue;
    const entry = state[id];
    if (!entry || entry.source.kind === 'not-carried') continue;
    out[id] = Array.isArray(entry.value) ? [...entry.value] : entry.value;
  }
  out['2'] = description;
  return out;
}

/**
 * Deterministic 53-bit hash (cyrb53) of normForQuote(text), as a hex string of
 * 1-14 digits. '' is the "never read" sentinel and is never returned.
 */
export function textFingerprint(text: string): string {
  const s = normForQuote(text);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
