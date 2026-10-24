import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import { loadPacks } from '../store/packs';
import { getPackSources } from '../store/pack-source';
import { evaluate } from './evaluate';
import { buildGraphFromForm } from './build-graph-from-form';
import { plainAnswersToFormValues } from './plain-intake';
import { typedAnswersFromPlain } from './form-visibility';
import { toPlainAnswers } from './form-answer-state';
import { WORKED_EXAMPLES } from './worked-examples';
import type { WorkedExpectation } from './worked-examples';
import type { EvaluationResult, JurisdictionPack, PolicyFile } from './types';

// R18-E, TC-R18-GI-10-02 (specs/intake-flow.md §27.10, "Corpus pins"). Retiring the card review and the model
// route must not move a pinned verdict. The pins themselves are not touched and not copied here:
//   - the ten worked examples: src/engine/try-these.test.ts reads their expectations from worked-examples.ts;
//   - the 9 corpus cases with blind answer sets (backtest/worked-case-answers.json): src/engine/backtest-parity.test.ts;
//   - the other 22 corpus cases keep their graph-level pins: src/engine/backtest-predictions.test.ts and
//     backtest-corpus.test.ts.
// What this file adds is the ROUTE: the form's own answer store (FormAnswerState, every answer typed) is turned
// into PlainAnswers by toPlainAnswers and run through the one mapping the form submits through
// (plainAnswersToFormValues -> buildGraphFromForm -> evaluate), for each of the ten examples, and checks the
// expectation the guide prints. And it fails if a pin test is deleted or a case is dropped from one.

let policy: PolicyFile;
let packs: JurisdictionPack[];
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
  const p = loadPacks(getPackSources());
  if (p.errors.length > 0) throw new Error('pack errors');
  packs = p.packs;
});

function viaTheForm(answers: Parameters<typeof typedAnswersFromPlain>[0], description: string): EvaluationResult {
  const answerState = typedAnswersFromPlain({ ...answers, '2': description }, policy);
  const { values } = plainAnswersToFormValues(toPlainAnswers(answerState, description), policy);
  const r = evaluate(buildGraphFromForm(values, '2026-01-01T00:00:00.000Z', () => crypto.randomUUID()), policy, packs);
  if (!r.ok) throw new Error(`engine error: ${JSON.stringify(r.error)}`);
  return r.value;
}

function assertExpected(v: EvaluationResult, e: WorkedExpectation) {
  if (e.status !== undefined) expect(v.status).toBe(e.status);
  if (e.tier !== undefined) expect(v.tier).toBe(e.tier);
  if (e.track !== undefined) expect(v.track).toBe(e.track);
  if (e.bindingConstraint !== undefined) expect(v.binding_constraint).toBe(e.bindingConstraint);
  if (e.controls !== undefined) expect(v.controls).toEqual(e.controls);
  if (e.controlCount !== undefined) expect(v.controls).toHaveLength(e.controlCount);
  if (e.downstreamReviews !== undefined) expect(v.downstream_reviews).toHaveLength(e.downstreamReviews);
  if (e.provisionalReasons !== undefined) expect(v.provisional_reasons).toEqual(e.provisionalReasons);
  for (const r of e.provisionalIncludes ?? []) expect(v.provisional_reasons).toContain(r);
}

describe('R18-E corpus pins through the form route', () => {
  it('TC-R18-GI-10-02: the ten worked examples keep the verdict the guide prints, run from the form\'s own answer store; example 1 is in appetite at Low, Track I, no controls, no provisional reason', () => {
    expect(WORKED_EXAMPLES).toHaveLength(10);
    for (const c of WORKED_EXAMPLES) {
      assertExpected(viaTheForm(c.answers, c.description), c.expected);
      for (const variant of c.variants ?? []) {
        assertExpected(viaTheForm({ ...c.answers, ...variant.change }, c.description), variant.expected);
      }
    }
    const one = viaTheForm(WORKED_EXAMPLES[0]!.answers, WORKED_EXAMPLES[0]!.description);
    expect([one.status, one.tier, one.track, one.controls.length, one.provisional_reasons.length]).toEqual(['approved', 'Low', 'I', 0, 0]);
  });

  it('the pin tests are all still there and none lost a case: 9 blind-answer cases in the parity test, 22 graph-level cases in the corpus', () => {
    const dir = __dirname;
    const blind = JSON.parse(readFileSync(resolve(dir, '../../backtest/worked-case-answers.json'), 'utf-8')) as { cases: Record<string, unknown> };
    const ids = Object.keys(blind.cases);
    expect(ids).toHaveLength(9);
    const parity = readFileSync(resolve(dir, 'backtest-parity.test.ts'), 'utf-8');
    for (const id of ids) expect(parity, `the parity test names ${id}`).toContain(`'${id}'`);
    const corpus = JSON.parse(readFileSync(resolve(dir, '../../backtest/cases.json'), 'utf-8')) as { cases: unknown[] };
    expect(corpus.cases).toHaveLength(31);
    expect(corpus.cases.length - ids.length).toBe(22);
    for (const f of ['try-these.test.ts', 'backtest-parity.test.ts', 'backtest-predictions.test.ts', 'backtest-corpus.test.ts']) {
      expect(readFileSync(resolve(dir, f), 'utf-8').length, f).toBeGreaterThan(1000);
    }
  });
});
