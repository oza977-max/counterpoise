import { describe, it, expect } from 'vitest';
import { R18_COPY, PLAIN_QUESTIONS } from './plain-copy';
import { mentionedItems, CHECKLIST_ITEM_IDS } from '../engine/mentioned';
import type { PrefillFailure } from '../engine/prefill-types';

// R18-A deliverable 6: the Round 18 strings (specs/intake-flow.md §27.2-27.5).
const JURISDICTIONS = [
  { code: 'UK', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'EU', name: 'European Union' },
];

/** Every string value inside R18_COPY, at any depth. */
function allStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (v && typeof v === 'object') return Object.values(v).flatMap(allStrings);
  return [];
}

const FAILURES: PrefillFailure[] = [
  'not-configured', 'too-long', 'timed-out', 'skipped', 'not-read', 'setting-changed',
  'invalid-setting', 'nothing-found', 'retired', 'model-missing', 'not-included',
  'allowance-used', 'signed-out', 'not-answering', 'blocked-or-unreachable', 'unusable', 'other',
];

describe('TC-R18-GI-13-02: nothing new reads "approved" or "rejected"', () => {
  it('scans every string in R18_COPY, case-insensitively', () => {
    const strings = allStrings(R18_COPY);
    expect(strings.length).toBeGreaterThan(60);
    expect(strings.filter((s) => /approved|rejected/i.test(s))).toEqual([]);
  });
  it('the scan can fail: it flags a string that does contain a reserved word', () => {
    expect(['Approved platforms'].filter((s) => /approved|rejected/i.test(s))).toHaveLength(1);
  });
});

describe('TC-R18-GI-1-06: no checklist label uses engine vocabulary', () => {
  it('has a label for exactly the 13 items, none blank', () => {
    expect(Object.keys(R18_COPY.CHECKLIST_LABELS).sort()).toEqual([...CHECKLIST_ITEM_IDS].sort());
    for (const id of CHECKLIST_ITEM_IDS) expect(R18_COPY.CHECKLIST_LABELS[id].trim().length).toBeGreaterThan(5);
  });
  it('labels contain none of the engine words', () => {
    const banned = /data_zone|autonomy|bindingness|model_type|\btrack\b|\btier\b|\bnodes?\b|\bgraph\b|jurisdiction/i;
    for (const id of CHECKLIST_ITEM_IDS) expect(R18_COPY.CHECKLIST_LABELS[id]).not.toMatch(banned);
  });
  it('every word of every label is a word the form itself uses (questions, help or option wording)', () => {
    const words = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").match(/[a-z']+/g) ?? [];
    const formWords = new Set<string>();
    for (const q of PLAIN_QUESTIONS) {
      for (const w of words(q.text)) formWords.add(w);
      for (const w of words(q.help ?? '')) formWords.add(w);
      for (const o of q.options) for (const w of words(o.text)) formWords.add(w);
    }
    const missing: string[] = [];
    for (const id of CHECKLIST_ITEM_IDS) {
      for (const w of words(R18_COPY.CHECKLIST_LABELS[id])) if (!formWords.has(w)) missing.push(`${id}: ${w}`);
    }
    expect(missing).toEqual([]);
  });
});

describe('the state words and the nudge (R18-GI-1, R18-GI-2)', () => {
  it('the state words are exactly "mentioned" and "not mentioned", with different symbols', () => {
    expect(R18_COPY.STATE_MENTIONED).toBe('mentioned');
    expect(R18_COPY.STATE_NOT_MENTIONED).toBe('not mentioned');
    expect(R18_COPY.SYMBOL_MENTIONED).not.toBe(R18_COPY.SYMBOL_NOT_MENTIONED);
  });
  it('the note leads with the sentence the test cases quote', () => {
    expect(R18_COPY.UNMENTIONED_NOTE_LEAD).toBe("Your description doesn't mention:");
  });
  for (const id of CHECKLIST_ITEM_IDS) {
    it(`TC-R18-GI-2-03 support: the example for [${id}] ticks that item when added alone`, () => {
      const sentence = R18_COPY.NUDGE_EXAMPLES[id];
      expect(sentence.length).toBeGreaterThan(10);
      expect(mentionedItems(sentence, JURISDICTIONS).has(id)).toBe(true);
    });
  }
  it('every example sentence is distinct and one sentence long', () => {
    const all = CHECKLIST_ITEM_IDS.map((id) => R18_COPY.NUDGE_EXAMPLES[id]);
    expect(new Set(all).size).toBe(13);
    for (const s of all) expect(s.match(/[.!?]/g)).toHaveLength(1);
  });
});

describe('the failure sentences (intake-flow §27.5)', () => {
  it('exist for every PrefillFailure, plain and non-empty, each for both wordings', () => {
    expect(Object.keys(R18_COPY.FAILURE_SENTENCES).sort()).toEqual([...FAILURES].sort());
    for (const f of FAILURES) {
      expect(R18_COPY.FAILURE_SENTENCES[f].ollama.length).toBeGreaterThan(20);
      expect(R18_COPY.FAILURE_SENTENCES[f].firm.length).toBeGreaterThan(20);
    }
  });
  it('the not-configured sentence says no model is connected and where to connect one', () => {
    expect(R18_COPY.FAILURE_SENTENCES['not-configured'].ollama).toBe(
      'No model is connected, so nothing was filled in for you. Answer the questions below — or connect one under Make it smarter.',
    );
  });
  it('too-long matches TOO_LONG_SENTENCE', () => {
    expect(R18_COPY.FAILURE_SENTENCES['too-long'].ollama).toBe(R18_COPY.TOO_LONG_SENTENCE);
  });
  it('only the firm-server blocked sentence carries the {host} placeholder, and no sentence names a model or a server’s own words', () => {
    for (const f of FAILURES) {
      expect(R18_COPY.FAILURE_SENTENCES[f].ollama).not.toContain('{host}');
      if (f !== 'blocked-or-unreachable') expect(R18_COPY.FAILURE_SENTENCES[f].firm).not.toContain('{host}');
    }
    expect(R18_COPY.FAILURE_SENTENCES['blocked-or-unreachable'].firm).toContain('{host}');
  });
});

describe('the earlier-version notice (R18-NF-5)', () => {
  it('is the sentence the spec quotes', () => {
    expect(R18_COPY.EARLIER_VERSION_NOTICE).toBe(
      'This was saved by an earlier version of Counterpoise, so please check your answers.',
    );
  });
});
