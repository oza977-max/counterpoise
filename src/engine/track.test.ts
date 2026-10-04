import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assignTrack } from './track';
import { evaluate } from './evaluate';
import { loadPolicy } from '../store/policy';
import type { DataFlowGraph, PolicyFile, TrackRule } from './types';

function graph(overrides: Partial<DataFlowGraph> = {}): DataFlowGraph {
  return {
    id: 'g1',
    version: 1,
    input_nodes: [],
    processing_nodes: [],
    output_nodes: [],
    edges: [],
    jurisdictions: [],
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const TRACKS: TrackRule[] = [
  {
    id: 'TRACK-I',
    name: 'Track I',
    description: 'Traditional MRM',
    conditions: [{ field: 'model_type', value: { in: ['statistical', 'traditional-ml'] } }],
    short_circuit: true,
    regulatory_basis: 'SS1/23 §3.4',
  },
  {
    id: 'TRACK-II',
    name: 'Track II',
    description: 'AI on MRM',
    conditions: [{ field: 'model_type', value: { in: ['ml', 'llm'] } }],
    short_circuit: true,
    regulatory_basis: 'SS1/23 §3.4',
  },
  {
    id: 'TRACK-III',
    name: 'Track III',
    description: 'AI Governance',
    conditions: [{ field: 'model_type', value: { in: ['generative-ai', 'agentic'] } }],
    short_circuit: true,
    regulatory_basis: 'SR 26-2 §III.C',
  },
];

function withModelType(modelType: string) {
  return graph({
    processing_nodes: [
      { id: 'p1', label: 'x', model_type: modelType as never, autonomy_level: 1, data_zone: 'Zone A', vendor: 'internal', replaces_prior_model: false },
    ],
  });
}

describe('assignTrack', () => {
  it('matches the first rule in order (short-circuit)', () => {
    const result = assignTrack(withModelType('statistical'), TRACKS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.track).toBe('I');
  });

  it('parses Track III from the rule id correctly (not confused by substring "II")', () => {
    const result = assignTrack(withModelType('generative-ai'), TRACKS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.track).toBe('III');
  });

  it('returns a no-track-match error when nothing matches', () => {
    const result = assignTrack(withModelType('deep-learning'), TRACKS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('no-track-match');
  });
});

// Oracle round 001. The shipped track list must be TOTAL over the field space:
// every model_type x decision_bindingness pair must route somewhere. Before
// this round 9 of 28 pairs matched no track and the engine returned no verdict
// at all — including `agentic` on advisory, material AND binding decisions, the
// highest-risk shape in the taxonomy falling straight through the routing.
//
// This enumerates the cross-product rather than sampling it, because sampling
// is exactly what missed the hole for two months.
describe('track totality (oracle round 001)', () => {
  const MODEL_TYPES = [
    'statistical', 'traditional-ml', 'ml', 'deep-learning', 'llm', 'generative-ai', 'agentic',
  ] as const;
  const BINDINGNESS = ['non-binding', 'advisory', 'material', 'binding'] as const;

  it('routes every model_type x decision_bindingness pair at autonomy 0-2, replacement or not [TC-PE-2-01] [TC-PE-2-02]', () => {
    const policyFile = loadPolicy(
      readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'),
    );
    if (!policyFile.valid) throw new Error('shipped policy invalid');
    const tracks = policyFile.policy.tracks;

    const unrouted: string[] = [];
    for (const model_type of MODEL_TYPES) {
      for (const decision_bindingness of BINDINGNESS) {
        for (const autonomy_level of [0, 1, 2] as const) {
          for (const replaces_prior_model of [false, true]) {
            const g = graph({
              processing_nodes: [{
                id: 'p1', label: 'x', model_type, autonomy_level,
                data_zone: 'Zone C', vendor: 'internal', replaces_prior_model,
              }],
              output_nodes: [{
                id: 'o1', label: 'y', action_type: 'recommend', exposure: 'internal-shared',
                decision_bindingness, output_reversibility: 'reversible', scale: 'limited',
              }],
            });
            if (!assignTrack(g, tracks).ok) {
              unrouted.push(`${model_type} + ${decision_bindingness} (autonomy ${autonomy_level}, replaces=${replaces_prior_model})`);
            }
          }
        }
      }
    }
    expect(unrouted).toEqual([]);
  });

  // The assertion above was VACUOUS until code review 002 caught it: it read
  // `if (!assignTrack(g, tracks))`, and assignTrack returns a Result OBJECT,
  // which is always truthy. `unrouted` could never be populated, so the test
  // passed against ANY policy — including one with TRACK-I deleted entirely.
  // A test guarding the exact defect class that had already shipped twice was
  // guarding nothing, and its green tick was cited in the policy comments, the
  // commit message and the round-002 report as evidence of totality.
  //
  // This is the mutation check that makes that impossible to repeat: break the
  // routing on purpose and require the checker to notice. A totality test that
  // cannot go red is worse than no test, because it is quoted as proof.
  it('the totality check itself goes red when routing is broken (mutation guard)', () => {
    const policyFile = loadPolicy(
      readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'),
    );
    if (!policyFile.valid) throw new Error('shipped policy invalid');

    // Drop TRACK-I: statistical and traditional-ml are then routed only by the
    // special tracks, so anything at autonomy < 3 that is not a replacement
    // falls through.
    const holed = policyFile.policy.tracks.filter((t) => t.id !== 'TRACK-I');

    const unrouted = MODEL_TYPES.flatMap((model_type) =>
      BINDINGNESS.filter(
        (decision_bindingness) =>
          !assignTrack(
            graph({
              processing_nodes: [{
                id: 'p1', label: 'x', model_type, autonomy_level: 1,
                data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false,
              }],
              output_nodes: [{
                id: 'o1', label: 'y', action_type: 'recommend', exposure: 'internal-shared',
                decision_bindingness, output_reversibility: 'reversible', scale: 'limited',
              }],
            }),
            holed,
          ).ok,
      ).map((b) => `${model_type} + ${b}`),
    );

    expect(unrouted.length).toBeGreaterThan(0);
    expect(unrouted).toContain('statistical + advisory');
  });
});

// Track-order fix, 2026-09-28. evaluate.ts called `sortedById(policy.tracks)`
// before assignTrack() — a copy-paste of the id-sort every OTHER policy
// collection legitimately gets, applied to the one collection where order is
// not incidental but the whole mechanism (§3.4: first-match/short-circuit).
// Sorting alphabetically silently re-ordered TRACK-III-AGENTIC /
// TRACK-II-REPLACE / TRACK-II-AUTONOMY — placed FIRST in policy/appetite.yaml
// specifically so those special cases win — behind TRACK-I and TRACK-II,
// undoing a fix oracle rounds 001/002 already made once, one layer up. 90 of
// the 7 (model_type) x 5 (autonomy 0-4) x 4 (bindingness) x 2
// (replaces_prior_model) = 280 combinations routed differently as a result.
describe('track order fix (2026-09-28)', () => {
  let policyFile: PolicyFile;

  beforeAll(() => {
    const r = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
    if (!r.valid) throw new Error('shipped policy invalid');
    policyFile = r.policy;
  });

  const MODEL_TYPES = [
    'statistical', 'traditional-ml', 'ml', 'deep-learning', 'llm', 'generative-ai', 'agentic',
  ] as const;
  const AUTONOMY = [0, 1, 2, 3, 4] as const;
  const BINDINGNESS = ['non-binding', 'advisory', 'material', 'binding'] as const;
  const REPLACES = [false, true];

  // Fields chosen so NO hard line can fire for any combination except the one
  // noted at TC-R17-TO-04 below: no input node (so data_class is absent —
  // matchesCondition treats an absent field as no-match, so HL-002 can never
  // trip), exposure internal-shared (not client/market-facing, so HL-001
  // can't trip), output_reversibility reversible (also HL-001), and no
  // decision_type (so HL-003/HL-004 can't trip). Only HL-006 (agentic +
  // autonomy >= 4 + binding) depends solely on fields this space varies.
  function trackOrderGraph(model_type: string, autonomy: number, bindingness: string, replaces: boolean): DataFlowGraph {
    return graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: model_type as never, autonomy_level: autonomy as never, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: replaces },
      ],
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: bindingness as never, output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
  }

  it('TC-R17-TO-01: a statistical/traditional-ml model is Track II, not Track I, when it replaces a prior model or acts at autonomy >= 3', () => {
    // Wrong pattern: TRACK-I ("TRACK-I" sorts alphabetically first) matched
    // before TRACK-II-REPLACE / TRACK-II-AUTONOMY ever got a chance, for
    // every statistical/traditional-ml model regardless of these two fields.
    const replacing = evaluate(trackOrderGraph('traditional-ml', 1, 'advisory', true), policyFile);
    const highAutonomy = evaluate(trackOrderGraph('statistical', 3, 'advisory', false), policyFile);
    expect(replacing.ok && replacing.value.track).toBe('II');
    expect(highAutonomy.ok && highAutonomy.value.track).toBe('II');
  });

  it('TC-R17-TO-02: an llm/generative-ai model with non-binding output is Track III, not Track II', () => {
    // Wrong pattern: TRACK-II (model_type in ml/deep-learning/llm/
    // generative-ai, no bindingness condition) sorts before TRACK-III and
    // matched first, so a non-binding generative use case never reached the
    // AI-governance track SR 26-2 footnote 3 carves out for it.
    const llmResult = evaluate(trackOrderGraph('llm', 1, 'non-binding', false), policyFile);
    const genAiResult = evaluate(trackOrderGraph('generative-ai', 1, 'non-binding', false), policyFile);
    expect(llmResult.ok && llmResult.value.track).toBe('III');
    expect(genAiResult.ok && genAiResult.value.track).toBe('III');
    // Contrast: the same model at any OTHER bindingness is correctly Track
    // II either way — the fix narrows this to non-binding, it doesn't move
    // every llm/generative-ai case to III.
    const advisory = evaluate(trackOrderGraph('llm', 1, 'advisory', false), policyFile);
    expect(advisory.ok && advisory.value.track).toBe('II');
  });

  it('TC-R17-TO-03: an agentic model is Track III, not Track II, even when it replaces a prior model or acts at autonomy >= 3', () => {
    // Wrong pattern: TRACK-II-AUTONOMY / TRACK-II-REPLACE sorted before
    // TRACK-III-AGENTIC, so the highest-risk shape in the taxonomy (an
    // autonomous or model-replacing agent) was routed OUT of the agentic
    // governance track that exists specifically to catch it — the same
    // regression oracle round 002 already found and fixed once in the
    // policy file's own declared order (see the comment above `tracks:` in
    // policy/appetite.yaml).
    const replacing = evaluate(trackOrderGraph('agentic', 1, 'advisory', true), policyFile);
    const highAutonomy = evaluate(trackOrderGraph('agentic', 3, 'advisory', false), policyFile);
    expect(replacing.ok && replacing.value.track).toBe('III');
    expect(highAutonomy.ok && highAutonomy.value.track).toBe('III');
  });

  it('TC-R17-TO-04: evaluate() assigns the same track as assignTrack(graph, policy.tracks) in the policy file\'s own order, over the full model_type x autonomy x bindingness x replaces_prior_model space', () => {
    let compared = 0;
    for (const model_type of MODEL_TYPES) {
      for (const autonomy of AUTONOMY) {
        for (const bindingness of BINDINGNESS) {
          for (const replaces of REPLACES) {
            const g = trackOrderGraph(model_type, autonomy, bindingness, replaces);
            const evaluated = evaluate(g, policyFile);
            const direct = assignTrack(g, policyFile.tracks);
            // The shipped policy is TOTAL (see the totality test above) —
            // every combination in this space routes somewhere.
            expect(direct.ok).toBe(true);
            if (!evaluated.ok) throw new Error(`unexpected engine error for ${model_type}/${autonomy}/${bindingness}/${replaces}`);
            // A hard line can short-circuit BEFORE track assignment ever
            // runs (HL-006: agentic + autonomy >= 4 + binding, the one
            // combination in this space that trips one — see the comment
            // above trackOrderGraph). evaluate() then reports the honest
            // ceiling value with track_rationale null (evaluate.ts) — that
            // is correct, documented behaviour, not what this property is
            // about, so it is excluded rather than mis-asserted.
            if (evaluated.value.explanation.track_rationale === null) continue;
            compared++;
            expect(evaluated.value.track).toBe(direct.ok ? direct.value.track : undefined);
          }
        }
      }
    }
    // Anti-vacuity (track.test.ts precedent above): almost the whole 280-case
    // space must have actually been compared, not skipped as hard-line
    // short-circuits, or this property proves nothing.
    expect(compared).toBeGreaterThan(270);
  });

  it('TC-R17-TO-05: the property above is not vacuous — the OLD id-sorted track order disagrees with the policy file order on exactly 90 of the 280 combinations', () => {
    // Regression guard, same anti-vacuity discipline as the totality mutation
    // guard above: reproduces the exact bug (sorting tracks by id before
    // matching) and counts how often it disagreed with the file order. The
    // count is pinned to the number verified when the bug was found, so this
    // guard itself would go red — not silently pass — if the policy's track
    // list ever changes shape enough to change that count.
    const sortedByIdTracks = [...policyFile.tracks].sort((a, b) => a.id.localeCompare(b.id));
    let mismatches = 0;
    for (const model_type of MODEL_TYPES) {
      for (const autonomy of AUTONOMY) {
        for (const bindingness of BINDINGNESS) {
          for (const replaces of REPLACES) {
            const g = trackOrderGraph(model_type, autonomy, bindingness, replaces);
            const fixed = assignTrack(g, policyFile.tracks);
            const buggy = assignTrack(g, sortedByIdTracks);
            if (fixed.ok && buggy.ok && fixed.value.track !== buggy.value.track) mismatches++;
          }
        }
      }
    }
    expect(mismatches).toBe(90);
  });
});
