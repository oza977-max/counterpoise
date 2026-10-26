import { describe, it, expect, beforeEach } from 'vitest';
import { getAllForExport, verifyChain, __resetChainStateForTests } from './audit';
import { __resetDbsForTests } from './db';
import { exportBundle, importBundle, __resetHandoffSyncStateForTests, HANDOFF_FORMAT_VERSION } from './handoff';
import { seedCase, realisticSources, cloudSources, typedOnlySources, READ_CLOUD, READ_FIRM, READ_LOCAL } from '../test-support/answer-sources-fixtures';
import type { AuditEvent } from './types';

// R18-D1 (specs/intake-flow.md §27.13 "Import validation"). `answer_sources` rides on graph_confirmed and
// verdict_corrected in the hand-off file. A hand-off file is untrusted input: every bound is a refusal with the
// existing plain sentence, the unknown words a newer build may add are tolerated, and a bundle written before this
// round imports exactly as before. The file format version stays 1.
//
// Each case seeds a real machine with the payload (the store does not validate on write), exports a real sealed
// bundle, wipes the machine, and imports - so a refusal can only come from the schema, never from the seal.

const APP_VERSION = '0.17.0-test';
const REFUSED = 'This file is not a Counterpoise hand-off bundle.';

async function freshMachine() {
  await __resetDbsForTests();
  __resetChainStateForTests();
  __resetHandoffSyncStateForTests();
}

type Where = 'graph_confirmed' | 'verdict_corrected';

/** Seed `sources` on the chosen event, export, wipe, and import. JSON round trip, as a real file would make. */
async function importWith(sources: unknown, where: Where = 'graph_confirmed', description?: string) {
  await freshMachine();
  await seedCase('uc-r18d1', where === 'graph_confirmed' ? { sources } : { corrections: [{ answer_sources: sources, ...(description !== undefined ? { description } : {}) }] });
  const bundle = JSON.parse(JSON.stringify(await exportBundle(APP_VERSION)));
  await freshMachine();
  const result = await importBundle(bundle);
  return { result, bundle, events: await getAllForExport() };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ question_id: '9', value: `v${i}`, origin: 'typed' }));
const withRow = (patch: Record<string, unknown>) => ({ reads: [READ_LOCAL], answers: [{ question_id: '9', value: 'yes', origin: 'typed', ...patch }] });
const withRead = (patch: Record<string, unknown>) => ({ reads: [{ ...READ_LOCAL, ...patch }], answers: [] });
const q = (patch: Record<string, unknown> = {}) => ({ option: 'yes', quote: 'client names', ...patch });
const quoted = (quotes: unknown) => withRow({ origin: 'prefilled_confirmed', quotes, read: 0 });
const s = (n: number) => 'x'.repeat(n);

describe('hand-off: answer_sources bounds (TC-R18-GI-5-05)', () => {
  // [label, record, accepted]. "at" is exactly the limit and must import; "over" is one past it and must be refused.
  const table: [string, unknown, boolean][] = [
    ['question_id at 40', withRow({ question_id: s(40) }), true],
    ['question_id over 40', withRow({ question_id: s(41) }), false],
    ['option at 40', quoted([q({ option: s(40) })]), true],
    ['option over 40', quoted([q({ option: s(41) })]), false],
    ['quote at 300', quoted([q({ quote: s(300) })]), true],
    ['quote over 300', quoted([q({ quote: s(301) })]), false],
    ['a 1 MB quote', quoted([q({ quote: s(1_000_000) })]), false],
    ['model at 100', withRead({ model: s(100) }), true],
    ['model over 100', withRead({ model: s(101) }), false],
    ['host at 253', withRead({ host: s(253) }), true],
    ['host over 253', withRead({ host: s(254) }), false],
    ['value string at 500', withRow({ value: s(500) }), true],
    ['value string over 500', withRow({ value: s(501) }), false],
    ['value array at 100', withRow({ value: Array.from({ length: 100 }, () => 'a') }), true],
    ['value array over 100', withRow({ value: Array.from({ length: 101 }, () => 'a') }), false],
    ['an array value with a string over 500', withRow({ value: [s(501)] }), false],
    ['answers at 40', { reads: [], answers: rows(40) }, true],
    ['answers over 40 (41)', { reads: [], answers: rows(41) }, false],
    ['200 answers', { reads: [], answers: rows(200) }, false],
    ['quotes per answer at 20', quoted(Array.from({ length: 20 }, () => q())), true],
    ['quotes per answer over 20', quoted(Array.from({ length: 21 }, () => q())), false],
    ['changed_from at 20', withRow({ origin: 'prefilled_changed', changed_from: Array.from({ length: 20 }, () => q()) }), true],
    ['changed_from over 20', withRow({ origin: 'prefilled_changed', changed_from: Array.from({ length: 21 }, () => q()) }), false],
    ['reads at 10', { reads: Array.from({ length: 10 }, () => READ_LOCAL), answers: [] }, true],
    ['reads over 10', { reads: Array.from({ length: 11 }, () => READ_LOCAL), answers: [] }, false],
    ['place at 100 (unknown word, tolerated)', withRead({ place: s(100) }), true],
    ['place over 100', withRead({ place: s(101) }), false],
    ['origin at 100 (unknown word, tolerated)', withRow({ origin: s(100) }), true],
    ['origin over 100', withRow({ origin: s(101) }), false],
    // structure
    ['no reads array', { answers: [] }, false],
    ['no answers array', { reads: [] }, false],
    ['answer_sources a string', 'sources', false],
    ['answer_sources null', null, false],
    ['answers a string', { reads: [], answers: 'no' }, false],
    ['a row without question_id', withRow({ question_id: undefined }), false],
    ['a value that is a number', withRow({ value: 5 }), false],
    ['quote_in_final_description a string', withRow({ quote_in_final_description: 'false' }), false],
    ['a read index that is a string', withRow({ read: '0' }), false],
    ['a quote that is a number', quoted([q({ quote: 5 })]), false],
  ];

  it('TC-R18-GI-5-05: every bound is a refusal at one past its limit and an import at the limit', async () => {
    for (const [label, record, accepted] of table) {
      const { result, events } = await importWith(record);
      if (accepted) {
        expect(result.outcome, label).toBe('imported_into_empty');
        expect(events.length, label).toBeGreaterThan(0);
      } else {
        expect(result.outcome, label).toBe('invalid_format');
        expect(result.message, label).toBe(REFUSED);
        expect(result.eventsAdded, label).toBe(0);
        expect(events, label).toHaveLength(0); // nothing changed in the register
      }
    }
  }, 60_000);

  it('the same bounds hold on verdict_corrected, and a corrected description is bounded at 1,000,000', async () => {
    expect((await importWith(realisticSources(), 'verdict_corrected')).result.outcome).toBe('imported_into_empty');
    expect((await importWith({ reads: [], answers: rows(41) }, 'verdict_corrected')).result.outcome).toBe('invalid_format');
    expect((await importWith(withRow({ question_id: s(41) }), 'verdict_corrected')).result.outcome).toBe('invalid_format');
    expect((await importWith(realisticSources(), 'verdict_corrected', s(1_000_000))).result.outcome).toBe('imported_into_empty');
    expect((await importWith(realisticSources(), 'verdict_corrected', s(1_000_001))).result.outcome).toBe('invalid_format');
  }, 60_000);

  it('refuses __proto__, constructor and prototype as KEYS at every depth, and keeps a value of "constructor" inert', async () => {
    const parse = (text: string) => JSON.parse(text) as unknown;
    const keyed: [string, unknown][] = [
      ['__proto__ on answer_sources', parse('{"reads":[],"answers":[],"__proto__":{"polluted":true}}')],
      ['__proto__ on a row', parse('{"reads":[],"answers":[{"question_id":"9","value":"y","origin":"typed","__proto__":{"x":1}}]}')],
      ['__proto__ on a read', parse('{"reads":[{"model":"m","place":"this-computer","host":"h","__proto__":{"x":1}}],"answers":[]}')],
      ['__proto__ on a quote', parse('{"reads":[],"answers":[{"question_id":"9","value":"y","origin":"prefilled_confirmed","quotes":[{"option":"o","quote":"q","__proto__":{"x":1}}]}]}')],
      ['constructor as a key', parse('{"reads":[],"answers":[{"question_id":"9","value":"y","origin":"typed","constructor":{"prototype":{"x":1}}}]}')],
      ['prototype as a key', parse('{"reads":[],"answers":[],"prototype":1}')],
      ['a key under an unknown extra field', parse('{"reads":[],"answers":[],"extra":{"deeper":{"__proto__":1}}}')],
    ];
    for (const [label, record] of keyed) {
      const { result, events } = await importWith(record);
      expect(result.outcome, label).toBe('invalid_format');
      expect(result.message, label).toBe(REFUSED);
      expect(events, label).toHaveLength(0);
    }
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    // As VALUES the same words are ordinary text: the file imports, and nothing reads a prototype.
    const asValues = { reads: [{ model: 'constructor', place: '__proto__', host: 'prototype' }], answers: [{ question_id: 'constructor', value: ['__proto__', 'constructor'], origin: '__proto__', quotes: [{ option: 'constructor', quote: 'prototype' }], read: 0 }] };
    const { result, events } = await importWith(asValues);
    expect(result.outcome).toBe('imported_into_empty');
    expect(events.length).toBeGreaterThan(0);
  }, 60_000);

  it('tolerates what a newer build may add: unknown origin, place, question id, option key, read index and extra fields', async () => {
    const newer = {
      reads: [{ model: 'm', place: 'a-place-from-the-future', host: 'http://h', digest: 'sha256:abc' }],
      answers: [
        { question_id: 'a-question-from-the-future', value: 'whatever', origin: 'approved-by-model', future_field: { nested: [1, 2] } },
        { question_id: '5', value: ['an-option-from-the-future'], origin: 'prefilled_confirmed', quotes: [{ option: 'an-option-from-the-future', quote: 'q' }], read: 99 },
        { question_id: '5', value: ['people'], origin: 'prefilled_confirmed', quotes: [{ option: 'people', quote: 'q' }], read: 1.5 },
        { question_id: '5', value: ['people'], origin: 'prefilled_confirmed', quotes: [{ option: 'people', quote: 'q' }], read: -3 },
      ],
      a_new_top_level_field: true,
    };
    const { result } = await importWith(newer);
    expect(result.outcome).toBe('imported_into_empty');
  });
});

describe('hand-off: old bundles and round trips (TC-R18-GI-5-02, -03, MS-2-04)', () => {
  beforeEach(freshMachine);

  it('TC-R18-GI-5-03: a bundle exported before this round carries no source, imports without error, and the format version is still 1', async () => {
    await seedCase('uc-old', {}); // the baseline shape: no answer_sources anywhere
    const bundle = JSON.parse(JSON.stringify(await exportBundle(APP_VERSION)));
    expect(JSON.stringify(bundle)).not.toContain('answer_sources');
    expect(bundle.format_version).toBe(1);
    expect(HANDOFF_FORMAT_VERSION).toBe(1);
    await freshMachine();
    const result = await importBundle(bundle);
    expect(result.outcome).toBe('imported_into_empty');
    expect(JSON.stringify(await getAllForExport())).not.toContain('answer_sources'); // no source invented for it
    expect((await verifyChain()).ok).toBe(true);
  });

  it('TC-R18-GI-5-02: a round trip keeps every source, quote and model name exactly, and the chain still verifies', async () => {
    for (const sources of [realisticSources(), cloudSources(), cloudSources(READ_FIRM)]) {
      await freshMachine();
      await seedCase('uc-trip', { sources });
      const before = (await getAllForExport()).find((e) => e.payload.type === 'graph_confirmed')!;
      const bundle = JSON.parse(JSON.stringify(await exportBundle(APP_VERSION)));
      await freshMachine();
      expect((await importBundle(bundle)).outcome).toBe('imported_into_empty');
      const after = (await getAllForExport()).find((e) => e.payload.type === 'graph_confirmed') as AuditEvent;
      expect(after.payload).toEqual(before.payload); // not one row changed, none added
      expect(JSON.stringify(after.payload)).toBe(JSON.stringify(before.payload)); // the same bytes the chain hashed
      expect((await verifyChain()).ok).toBe(true);
    }
  });

  it('TC-R18-MS-2-04d1f: the file names the model and where it ran, and a typed-only case names neither', async () => {
    await seedCase('uc-cloud', { sources: cloudSources() });
    const file = JSON.stringify(await exportBundle(APP_VERSION));
    expect(file).toContain(READ_CLOUD.model);
    expect(file).toContain('"ollama-cloud"');
    await freshMachine();
    await seedCase('uc-typed', { sources: typedOnlySources() });
    const typed = JSON.stringify(await exportBundle(APP_VERSION));
    expect(typed).toContain('"typed"');
    expect(typed).not.toMatch(/"model":|"place":|"host":|ollama-cloud|this-computer|firm-server/);
  });
});
