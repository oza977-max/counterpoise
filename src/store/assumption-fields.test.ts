import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ASSUMPTION_GRAPH_FIELDS } from './handoff';
import { QUOTE_FIELDS, AGENT_REACH_FIELDS } from '../engine/canonical-vocabulary';
import { loadPolicy } from './policy';
import { loadPacks } from './packs';
import { getPackSources } from './pack-source';
import type { JurisdictionPack, PolicyFile } from '../engine/types';

// CR6-27 — invariant test (BC-003: derive the guard's list from the real
// source at test time, never hand-type it). The hand-off's
// ASSUMPTION_GRAPH_FIELDS (handoff.ts:224-230) is the closed `fields` enum
// an imported assumption reference is allowed to name (the
// assumptionSchema gate, handoff.ts:232-240) — every field the question
// generator can actually emit must be a member of it, or a real guessed-
// field/rule-triggered question's assumption would fail to import on a
// receiving machine, exactly the class of boundary break BC-002 exists to
// catch (a value produced on one side of a boundary that the other side's
// schema does not recognise).
//
// "Every field the generator can emit" (question-generator.ts:126-167) has
// exactly two sources:
//   1. (removed in R18-G) the guessed-fields question builder — fields came from `guessed[nodeId]`,
//      whose only possible members were QUOTE_FIELDS[kind] (verifyQuotes'
//      own iteration set) plus AGENT_REACH_FIELDS (the agentic-node forced-
//      guess case) — both in src/engine/canonical-vocabulary.ts. The sets
//      stay in this guard as a superset: an older record can still name such a field.
//   2. candidatesFromRules — fields come from `Object.keys(rule.condition)`
//      for whichever rules generateQuestions calls it with: the real
//      shipped policy's invariants and hard lines. Packs are not currently
//      threaded through generateQuestions (the `_activePacks` parameter is
//      unused), but their condition keys are included below too, for the
//      same reason TC-R16-E-11 (plain-copy.test.ts) includes them — the
//      guard should not have to be revisited the day that wiring changes.
let policy: PolicyFile;
let packs: JurisdictionPack[];

beforeAll(() => {
  const yaml = readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8');
  const result = loadPolicy(yaml);
  if (!result.valid) throw new Error('shipped policy invalid: ' + JSON.stringify(result.errors));
  policy = result.policy;
  const packResult = loadPacks(getPackSources());
  if (packResult.errors.length > 0) throw new Error('shipped packs invalid: ' + JSON.stringify(packResult.errors));
  packs = packResult.packs;
});

function everyFieldTheGeneratorCanEmit(): string[] {
  const fromQuoteFields = [
    ...QUOTE_FIELDS.input,
    ...QUOTE_FIELDS.processing,
    ...QUOTE_FIELDS.output,
    ...AGENT_REACH_FIELDS,
  ];
  const fromPolicyConditions = [...policy.invariants, ...policy.hard_lines].flatMap((r) => Object.keys(r.condition));
  const fromPackConditions = packs.flatMap((p) => p.rules).flatMap((r) => Object.keys(r.condition));
  return [...new Set([...fromQuoteFields, ...fromPolicyConditions, ...fromPackConditions])];
}

describe('ASSUMPTION_GRAPH_FIELDS — CR6-27 invariant', () => {
  it('TC-CR6-27: every field the question generator can emit is in the hand-off\'s ASSUMPTION_GRAPH_FIELDS', () => {
    const emittable = everyFieldTheGeneratorCanEmit();
    expect(emittable.length).toBeGreaterThan(0); // the guard must not be vacuous
    const allowed = new Set<string>(ASSUMPTION_GRAPH_FIELDS);
    const missing = emittable.filter((f) => !allowed.has(f));
    expect(missing, 'fields the generator can emit but ASSUMPTION_GRAPH_FIELDS does not allow').toEqual([]);
  });
});
