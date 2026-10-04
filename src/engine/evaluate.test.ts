import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import { evaluate } from './evaluate';
import type { DataFlowGraph, PolicyFile } from './types';

let policy: PolicyFile;

beforeAll(() => {
  const yaml = readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8');
  const result = loadPolicy(yaml);
  if (!result.valid) throw new Error(`fixture policy invalid: ${JSON.stringify(result.errors)}`);
  policy = result.policy;
});

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

describe('evaluate — TC-PE-1-01 determinism', () => {
  it('produces an identical result across 10 runs for the same inputs [TC-PE-1-01]', () => {
    const g = graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'ml', autonomy_level: 2, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
    const results = Array.from({ length: 10 }, () => evaluate(g, policy));
    const first = JSON.stringify(results[0]);
    for (const r of results) expect(JSON.stringify(r)).toBe(first);
  });
});

describe('evaluate — TC-R11-MG-1 determinism with declared_model_id present', () => {
  it('produces an identical result across 10 runs with declared_model_id present [TC-R11-MG-1]', () => {
    const g = graph({
      processing_nodes: [
        {
          id: 'p1',
          label: 'x',
          model_type: 'ml',
          autonomy_level: 2,
          data_zone: 'Zone B',
          vendor: 'internal',
          replaces_prior_model: false,
          declared_model_id: 'qwen3:4b',
        },
      ],
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
    const results = Array.from({ length: 10 }, () => evaluate(g, policy));
    const first = JSON.stringify(results[0]);
    for (const r of results) expect(JSON.stringify(r)).toBe(first);
  });
});

describe('evaluate — TC-R11-MG-2 model governance review', () => {
  it('an unlisted declared_model_id trips a model governance review [TC-R11-MG-2]', () => {
    const g = graph({
      processing_nodes: [
        {
          id: 'p1',
          label: 'x',
          model_type: 'ml',
          autonomy_level: 2,
          data_zone: 'Zone B',
          vendor: 'internal',
          replaces_prior_model: false,
          declared_model_id: 'totally-unlisted-model-xyz',
        },
      ],
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.downstream_reviews.some((r) => r.includes('totally-unlisted-model-xyz'))).toBe(true);
    }
  });

  it('a declared_model_id present but is_approved: false trips a model governance review [TC-R11-MG-3]', () => {
    const g = graph({
      processing_nodes: [
        {
          id: 'p1',
          label: 'x',
          model_type: 'ml',
          autonomy_level: 2,
          data_zone: 'Zone B',
          vendor: 'internal',
          replaces_prior_model: false,
          declared_model_id: 'qwen3:4b',
        },
      ],
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    // policy/appetite.yaml ships qwen3:4b with is_approved: false (honest demo posture).
    if (result.ok) {
      expect(result.value.downstream_reviews.some((r) => r.includes('qwen3:4b'))).toBe(true);
    }
  });

  it('a declared_model_id present and is_approved: true does NOT trip a model governance review [TC-R11-MG-4]', () => {
    const g = graph({
      processing_nodes: [
        {
          id: 'p1',
          label: 'x',
          model_type: 'ml',
          autonomy_level: 2,
          data_zone: 'Zone B',
          vendor: 'internal',
          replaces_prior_model: false,
          declared_model_id: 'VENDOR-LLM-v1',
        },
      ],
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.downstream_reviews.some((r) => r.includes('VENDOR-LLM-v1'))).toBe(false);
    }
  });

  it('no rendered downstream_review string matches the reserved-word regex [TC-R11-MG-5]', () => {
    const g = graph({
      processing_nodes: [
        {
          id: 'p1',
          label: 'x',
          model_type: 'ml',
          autonomy_level: 2,
          data_zone: 'Zone B',
          vendor: 'internal',
          replaces_prior_model: false,
          declared_model_id: 'totally-unlisted-model-xyz',
        },
      ],
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The unlisted model must actually produce its review (otherwise the
      // loop below would pass vacuously over an empty list).
      const modelReviews = result.value.downstream_reviews.filter((r) => r.includes('totally-unlisted-model-xyz'));
      expect(modelReviews.length).toBeGreaterThan(0);
      for (const r of result.value.downstream_reviews) {
        expect(r).not.toMatch(/approved|rejected/i);
      }
    }
  });
});

describe('evaluate — TC-R11-MG-1a model-family fallback', () => {
  const FAMILY_ONLY_MODELS = [
    { model_id: 'gpt-4o-family', vendor: 'OpenAI', provenance_class: 'vendor_hosted' as const, is_approved: true, is_family: true, version_pattern: 'gpt-4o-' },
  ];

  function familyGraph(declared_model_id: string, extra: Partial<DataFlowGraph['processing_nodes'][number]> = {}) {
    return graph({
      processing_nodes: [
        {
          id: 'p1',
          label: 'x',
          model_type: 'ml',
          autonomy_level: 2,
          data_zone: 'Zone B',
          vendor: 'internal',
          replaces_prior_model: false,
          declared_model_id,
          ...extra,
        },
      ],
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
  }

  it('a family-only registry approves a differently-versioned declared_model_id with no exact entry [TC-R11-MG-1a-1]', () => {
    const p: PolicyFile = { ...policy, approved_models: FAMILY_ONLY_MODELS };
    const g = familyGraph('gpt-4o-2026-08-01');
    const result = evaluate(g, p);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.downstream_reviews.some((r) => r.includes('gpt-4o-2026-08-01'))).toBe(false);
    }
  });

  it('an exact-id entry still wins over an overlapping family entry when both match [TC-R11-MG-1a-2]', () => {
    const p: PolicyFile = {
      ...policy,
      approved_models: [
        ...FAMILY_ONLY_MODELS,
        { model_id: 'gpt-4o-2026-08-01', vendor: 'OpenAI', provenance_class: 'vendor_hosted', is_approved: false },
      ],
    };
    const g = familyGraph('gpt-4o-2026-08-01');
    const result = evaluate(g, p);
    expect(result.ok).toBe(true);
    // The exact entry is unapproved (is_approved: false), so even though the
    // family entry above approves the same prefix, the exact entry must win.
    if (result.ok) {
      expect(result.value.downstream_reviews.some((r) => r.includes('gpt-4o-2026-08-01'))).toBe(true);
    }
  });

  it('no family match and no exact match still reports unlisted with existing wording [TC-R11-MG-1a-3]', () => {
    const p: PolicyFile = { ...policy, approved_models: FAMILY_ONLY_MODELS };
    const g = familyGraph('claude-opus-9000');
    const result = evaluate(g, p);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.value.downstream_reviews.some((r) => r.includes('claude-opus-9000') && r.includes('is not on the firm\'s model registry within appetite')),
      ).toBe(true);
    }
  });

  it("family approval alone does not suppress Track II's version-pinning control (INV-TRACK2-01 / CTRL-FINGERPRINT-01) [TC-R11-MG-1a-4]", () => {
    const p: PolicyFile = { ...policy, approved_models: FAMILY_ONLY_MODELS };
    const g = familyGraph('gpt-4o-2026-08-01');
    const result = evaluate(g, p);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Track II's pinning requirement fires off graph attributes (model_type,
      // decision_bindingness) alone — family approval of the model itself must
      // not change that. Confirms it is present here regardless of the model
      // being family-approved.
      expect(result.value.controls).toContain('CTRL-FINGERPRINT-01');
    }
  });

  it('produces an identical result across 10 runs with family entries present [TC-R11-MG-1a-5]', () => {
    const p: PolicyFile = {
      ...policy,
      approved_models: [
        ...FAMILY_ONLY_MODELS,
        { model_id: 'qwen3:4b', vendor: 'local (Ollama)', provenance_class: 'open_weights_self_hosted', is_approved: false },
      ],
    };
    const g = familyGraph('gpt-4o-2026-08-01');
    const results = Array.from({ length: 10 }, () => evaluate(g, p));
    const first = JSON.stringify(results[0]);
    for (const r of results) expect(JSON.stringify(r)).toBe(first);
  });
});

describe('evaluate — TC-PE-4-01 hard line trip', () => {
  it('returns immediate rejected with no controls solved when a hard line trips [TC-PE-4-01] [TC-PE-4-03]', () => {
    const g = graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'agentic', autonomy_level: 4, data_zone: 'Zone A', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'execute', exposure: 'client-facing', decision_bindingness: 'binding', output_reversibility: 'irreversible', scale: 'at_scale' },
      ],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('rejected');
      expect(result.value.binding_constraint).toBe('HL-001');
      expect(result.value.controls).toEqual([]);
    }
  });
});

const TRACK_I_PROCESSING = {
  id: 'p1',
  label: 'x',
  model_type: 'traditional-ml' as const,
  autonomy_level: 0 as const,
  data_zone: 'Zone C' as const,
  vendor: 'internal',
  replaces_prior_model: false,
};
const TRACK_I_OUTPUT = {
  id: 'o1',
  label: 'y',
  action_type: 'recommend' as const,
  exposure: 'internal-only' as const,
  decision_bindingness: 'material' as const,
  output_reversibility: 'reversible' as const,
  scale: 'limited' as const,
};

// Oracle round 001 widened INV-CITE-01 from action_type [draft] to
// [read, draft, recommend], because a retrieval-and-summarisation assistant is
// the canonical hallucination surface and previously owed no citations at all.
// A consequence, and an intended one: NO generative model can reach a clean
// `approved` any more — presenting generated text to a human always owes a
// citation. The clean case is therefore now a non-generative model.
const CLEAN_PROCESSING = {
  id: 'p1',
  label: 'internal scorecard',
  model_type: 'statistical' as const,
  autonomy_level: 0 as const,
  data_zone: 'Zone C' as const,
  vendor: 'internal',
  replaces_prior_model: false,
};
const CLEAN_OUTPUT = {
  id: 'o1',
  label: 'suggestion',
  action_type: 'read' as const,
  exposure: 'internal-only' as const,
  decision_bindingness: 'non-binding' as const,
  output_reversibility: 'reversible' as const,
  scale: 'limited' as const,
};

describe('evaluate — jurisdiction pass-through', () => {
  it('does not crash with jurisdictions present and applies no overrides', () => {
    const g = graph({
      processing_nodes: [TRACK_I_PROCESSING],
      output_nodes: [TRACK_I_OUTPUT],
      jurisdictions: ['UK', 'US'],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.applied_overrides).toEqual([]);
  });
});

describe('evaluate — approved path', () => {
  it('returns approved when no invariants trip [TC-PE-1-02]', () => {
    const g = graph({
      processing_nodes: [CLEAN_PROCESSING],
      output_nodes: [CLEAN_OUTPUT],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('approved');
      expect(result.value.tier).toBe('Low');
    }
  });

  it('leaves binding_constraint empty when nothing tripped (P3-C01 review finding: must not leak the track rule id)', () => {
    const g = graph({
      processing_nodes: [CLEAN_PROCESSING],
      output_nodes: [CLEAN_OUTPUT],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.binding_constraint).toBe('');
  });
});

describe('evaluate — approved_with_controls path', () => {
  it('returns approved_with_controls with a real solved control set (P3-C02: no longer the stub)', () => {
    const g = graph({
      input_nodes: [{ id: 'i1', label: 'client notes', data_class: 'Client PII', data_zone: 'Zone A' }],
      processing_nodes: [TRACK_I_PROCESSING],
      output_nodes: [TRACK_I_OUTPUT],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('approved_with_controls');
      // Client PII into Zone A trips INV-DATA-01; the traditional-ml model
      // feeding a material decision also trips INV-DRIFT-01. The real
      // greedy solver must cover both from the control library.
      //
      // Exactly two controls, and no more. CTRL-INDEP-VAL-01 also resolves
      // INV-DRIFT-01, but it is an ALTERNATIVE to CTRL-DRIFT-01, not a
      // supplement — the CS-1 margin reports that the alternative exists
      // without requiring the firm to do both (oracle round 001).
      expect(result.value.controls).toEqual(['CTRL-DRIFT-01', 'CTRL-ENC-01']);
    }
  });

  it('sets boundary_proximity when every tripped invariant has exactly one resolving control (P3-C02 CS-4)', () => {
    // A generative model reading internally trips INV-CITE-01 and nothing
    // else. CTRL-CITE-01 is its only resolver, so coverage depth is 1, the
    // achieved margin is 0, and the verdict sits on the boundary.
    //
    // This fixture moved in oracle round 001: the previous one (Client PII +
    // traditional-ml) now ALSO trips INV-DRIFT-01, which CTRL-INDEP-VAL-01
    // takes to depth 2 — so it achieves margin and is no longer at the
    // boundary. That is the control library getting better, not the test
    // getting weaker.
    const g = graph({
      processing_nodes: [{ ...CLEAN_PROCESSING, model_type: 'llm' as const }],
      output_nodes: [CLEAN_OUTPUT],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.binding_constraint).toBe('INV-CITE-01');
      expect(result.value.margin_achieved).toBe(0);
      expect(result.value.boundary_proximity).toBe(true);
    }
  });

  it('leaves boundary_proximity false on the plain approved path (nothing tripped)', () => {
    const g = graph({
      processing_nodes: [CLEAN_PROCESSING],
      output_nodes: [CLEAN_OUTPUT],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.boundary_proximity).toBe(false);
  });
});

// Code review 002, Panel B. `binding_constraint_order` was declared in the
// policy schema, added to PolicyFile, and read by mostSevere() — and NOTHING
// pinned it. Its consumption was provable by reading the code and by nothing
// else, so a later refactor could quietly make it decorative with the suite
// still green.
//
// That is exactly how the `_margin` parameter of solvControls() survived for
// two months: declared, validated, threaded, discarded, and green throughout.
// RF-1 has eight confirmed instances in this codebase. This test is the guard.
describe('evaluate — binding_constraint_order is honoured (RF-1 guard)', () => {
  // A graph tripping exactly two invariants that rank OPPOSITE ways under the
  // two criteria, so the declared order alone decides the answer:
  //   INV-TRACK2-01  severity High,   cheapest control burden 2
  //   INV-SEC-01     severity Medium, cheapest control burden 3
  const twoWayGraph = () =>
    graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'execute', exposure: 'internal-shared', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });

  it('severity-first (the shipped default) names the higher-severity invariant', () => {
    const r = evaluate(twoWayGraph(), policy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.explanation.tripped_invariants.map((t) => t.id).sort()).toEqual([
      'INV-SEC-01',
      'INV-TRACK2-01',
    ]);
    expect(r.value.binding_constraint).toBe('INV-TRACK2-01');
  });

  it('burden-first FLIPS the answer — proving the policy field drives the engine', () => {
    const burdenFirst: PolicyFile = {
      ...policy,
      binding_constraint_order: ['control_burden', 'severity', 'id'],
    };
    const r = evaluate(twoWayGraph(), burdenFirst);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Same graph, same invariants tripped, DIFFERENT binding constraint. If
    // this ever equals INV-TRACK2-01 again, the field has stopped being read.
    expect(r.value.binding_constraint).toBe('INV-SEC-01');
  });

  it('omitting the field falls back to the documented default rather than throwing', () => {
    const noOrder: PolicyFile = { ...policy };
    delete (noOrder as { binding_constraint_order?: unknown }).binding_constraint_order;
    const r = evaluate(twoWayGraph(), noOrder);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.binding_constraint).toBe('INV-TRACK2-01');
  });

  it('stays deterministic (NF-1) even when the declared order omits the id tie-break', () => {
    const noIdTieBreak: PolicyFile = { ...policy, binding_constraint_order: ['severity'] };
    const runs = Array.from({ length: 10 }, () => {
      const r = evaluate(twoWayGraph(), noIdTieBreak);
      return r.ok ? r.value.binding_constraint : 'ERR';
    });
    expect(new Set(runs).size).toBe(1);
  });
});

describe('evaluate — no-track-match', () => {
  // The SHIPPED policy can no longer produce this error: oracle round 001 found
  // 9 of 28 model_type x bindingness combinations unrouted and made the track
  // list total (see track.test.ts, which enumerates the cross-product).
  //
  // The error path stays, and stays tested, because a FIRM's edited policy can
  // reintroduce the hole at any time — and returning a wrong verdict would be
  // far worse than returning none. So the fixture now truncates the tracks
  // deliberately rather than relying on the shipped policy being incomplete.
  it('surfaces a no-track-match EngineError when no track rule matches', () => {
    const holed: PolicyFile = {
      ...policy,
      tracks: policy.tracks.filter((t) => t.id === 'TRACK-III'),
    };
    const g = graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'deep-learning', autonomy_level: 1, data_zone: 'Zone A', vendor: 'internal', replaces_prior_model: false },
      ],
    });
    const result = evaluate(g, holed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('no-track-match');
  });

  it('the shipped policy routes every model_type / bindingness pair — the hole is closed', () => {
    const result = evaluate(
      graph({
        processing_nodes: [
          { id: 'p1', label: 'x', model_type: 'statistical', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
        ],
        output_nodes: [
          { id: 'o1', label: 'y', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'at_scale' },
        ],
      }),
      policy,
    );
    // Corpus case D-01 — an advisory market-impact model. Returned
    // no-track-match before oracle round 001.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.track).toBe('I');
  });
});

describe('evaluate — verdict explanation (V1.1-C01)', () => {
  it('hard-line rejection carries the rule reason + regulatory citation, with rationales honestly null', () => {
    const g = graph({
      input_nodes: [{ id: 'i1', label: 'trade intel', data_class: 'MNPI', data_zone: 'Zone A' }],
      processing_nodes: [TRACK_I_PROCESSING],
      output_nodes: [TRACK_I_OUTPUT],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('rejected');
    const ex = result.value.explanation;
    expect(ex.binding_reason).toMatch(/market abuse/i);
    expect(ex.binding_regulatory_basis).toBe('MAR Article 8; MiFID II');
    // Tier/track assignment is skipped on hard-line rejection — the
    // rationale must not fabricate one for the ceiling values.
    expect(ex.tier_rationale).toBeNull();
    expect(ex.track_rationale).toBeNull();
    expect(ex.hard_lines_checked).toBe(policy.hard_lines.length);
  });

  it('a clean approved verdict explains which rules assigned the tier and track, with citations, and reports what was checked', () => {
    const g = graph({
      processing_nodes: [CLEAN_PROCESSING],
      output_nodes: [CLEAN_OUTPUT],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('approved');
    const ex = result.value.explanation;
    expect(ex.tier_rationale?.rule_id).toMatch(/^TIER-/);
    expect(ex.tier_rationale?.matched_field).toBe('exposure');
    // TRACK-I since oracle round 001: the clean fixture is a statistical
    // model, because widening INV-CITE-01 means no generative model is clean.
    expect(ex.track_rationale?.rule_id).toBe('TRACK-I');
    expect(ex.track_rationale?.regulatory_basis).toContain('SR 26-2');
    expect(ex.hard_lines_checked).toBe(policy.hard_lines.length);
    expect(ex.invariants_checked).toBe(policy.invariants.length);
    expect(ex.tripped_invariants).toEqual([]);
    expect(ex.binding_reason).toBeNull();
    expect(ex.binding_regulatory_basis).toBeNull();
  });

  it('approved_with_controls carries the FULL tripped-invariant detail (severity, required controls, citation) — no longer the one-element approximation', () => {
    const g = graph({
      input_nodes: [{ id: 'i1', label: 'client notes', data_class: 'Client PII', data_zone: 'Zone B' }],
      processing_nodes: [TRACK_I_PROCESSING],
      output_nodes: [TRACK_I_OUTPUT],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('approved_with_controls');
    const ex = result.value.explanation;
    // V2-C: Client PII in Zone B trips INV-DATA-01, and the quantitative
    // model on a material decision trips INV-DRIFT-01 — the point of this
    // test is the FULL set, so assert both are present and inspect one.
    expect(ex.tripped_invariants.map((t) => t.id).sort()).toEqual(['INV-DATA-01', 'INV-DRIFT-01']);
    const detail = ex.tripped_invariants.find((t) => t.id === 'INV-DATA-01')!;
    expect(detail.id).toBe('INV-DATA-01');
    expect(detail.severity).toBe('High');
    expect(detail.required_controls).toEqual(['CTRL-ENC-01']);
    expect(detail.regulatory_basis).toBe('GDPR Art. 32(1)(a)');
    // The BINDING invariant is INV-DRIFT-01, not INV-DATA-01. Both are
    // severity High, and oracle round 001 replaced the alphabetical tie-break
    // with one on the cheapest resolving control — the invariant's unavoidable
    // cost. Drift monitoring (burden 3) outweighs encryption in transit
    // (burden 2), so drift is what actually determines this verdict.
    expect(result.value.binding_constraint).toBe('INV-DRIFT-01');
    expect(ex.binding_regulatory_basis).toBe('RAF §8 — drift signals; SS1/23 §3.4');
  });
});

describe('evaluate — VD-7 standing conditions (V1.2-B)', () => {
  it('an approved verdict carries statically-populated hypotheses from kri_thresholds plus graph pins', () => {
    const g = graph({
      processing_nodes: [TRACK_I_PROCESSING],
      output_nodes: [TRACK_I_OUTPUT],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const h = result.value.conditions.hypotheses;
    expect(h.some((l) => /model drift since validation/i.test(l))).toBe(true);
    expect(h.some((l) => l === 'Data zone pinned: Zone C')).toBe(true);
    expect(h.some((l) => /max autonomy level: ≤ L0/i.test(l))).toBe(true);
    // BC-V12B-03: no hypothesis may contain the words approved/rejected.
    expect(h.every((l) => !/approved|rejected/i.test(l))).toBe(true);
  });

  it('High/Critical tiers are held to the tighter high_risk override band; Low uses low_risk', () => {
    const lowG = graph({ processing_nodes: [TRACK_I_PROCESSING], output_nodes: [TRACK_I_OUTPUT] });
    const lowResult = evaluate(lowG, policy);
    if (!lowResult.ok) throw new Error('low fixture failed');
    expect(lowResult.value.conditions.hypotheses.some((l) => /low risk band.*5–40/i.test(l))).toBe(true);

    const highG = graph({
      processing_nodes: [TRACK_I_PROCESSING],
      output_nodes: [{ ...TRACK_I_OUTPUT, exposure: 'client-facing' as const }],
    });
    const highResult = evaluate(highG, policy);
    if (!highResult.ok) throw new Error('high fixture failed');
    expect(highResult.value.tier).toBe('High');
    expect(highResult.value.conditions.hypotheses.some((l) => /high risk band.*5–20/i.test(l))).toBe(true);
  });

  it('a rejection carries no hypotheses — nothing was accepted to condition', () => {
    const g = graph({
      input_nodes: [{ id: 'i1', label: 'trade intel', data_class: 'MNPI', data_zone: 'Zone A' }],
      processing_nodes: [TRACK_I_PROCESSING],
      output_nodes: [TRACK_I_OUTPUT],
    });
    const result = evaluate(g, policy);
    if (!result.ok) return;
    expect(result.value.status).toBe('rejected');
    expect(result.value.conditions.hypotheses).toEqual([]);
  });
});

describe('evaluate — jurisdiction packs (V2-A)', () => {
  const euPack = {
    pack_id: 'EU-AIACT', version: '0.1', jurisdiction: 'EU', regulator: 'EC',
    document: 'EU AI Act', effective_date: '2024-08-01',
    reviewer_name: '[FIRM] — Legal', reviewer_role: 'Head', sign_off_date: '[DATE]',
    rules: [{
      id: 'EU-AIACT-TIER-02', title: 'Annex III employment',
      source: { document: 'EU AI Act', section: 'Annex III §4(a)', text: 'recruitment or selection of natural persons…' },
      effect: { type: 'tier_floor' as const, minimum_tier: 'Critical' as const },
      condition: { decision_type: { in: ['hiring'] } },
      basis: 'derived' as const,
      reviewer_name: '[FIRM] — Legal', reviewer_role: 'Head', sign_off_date: '[DATE]',
    }],
  };

  const hiringGraph = () => graph({
    processing_nodes: [{ id: 'p1', label: 'cv screener', model_type: 'ml', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false }],
    output_nodes: [{ id: 'o1', label: 'shortlist', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'material', output_reversibility: 'reversible', scale: 'at_scale', decision_type: 'hiring' as const }],
    jurisdictions: ['EU'],
  });

  it('an EU hiring case is FORCED from Medium to Critical by the Annex III floor, with the chain + provisional caveat (NF-7 unsigned) [TC-RA-9-01] [TC-VD-5-01]', () => {
    const result = evaluate(hiringGraph(), policy, [euPack]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tier).toBe('Critical');
    expect(result.value.applied_overrides).toHaveLength(1);
    expect(result.value.pack_versions).toEqual({ 'EU-AIACT': '0.1' });
    const chain = result.value.explanation.regulatory_chain ?? [];
    expect(chain).toHaveLength(1);
    expect(chain[0]?.source_text).toMatch(/recruitment or selection/);
    expect(chain[0]?.sign_off).toMatch(/pending firm adoption/);
    // BC-V2A-03: unsigned fired rule → low caveat → provisional verdict.
    expect(result.value.confidence_caveats.some((c) => c.confidence === 'low')).toBe(true);
  });

  it('without the pack (or without the jurisdiction) the same case sits at the FIRM tier, and only the pack lifts it', () => {
    // Oracle round 001: decision_type 'hiring' triggered no base tier at all,
    // so a CV screener was Critical only when the EU pack happened to be
    // loaded — the firm had no position of its own on employment decisions.
    // Hiring now sits at High in the firm's own tiers, and the EU pack floors
    // it to Critical under Annex III §4(a). The pack still demonstrably FORCES
    // a change; it is no longer the only thing standing between a CV screener
    // and a Low-tier verdict.
    const noPack = evaluate(hiringGraph(), policy);
    if (!noPack.ok) return;
    expect(noPack.value.tier).toBe('High');
    expect(noPack.value.confidence_caveats).toEqual([]);
    expect(noPack.value.applied_overrides).toEqual([]);

    const wrongJurisdiction = evaluate(graph({ ...hiringGraph(), jurisdictions: ['US'] }), policy, [euPack]);
    if (!wrongJurisdiction.ok) return;
    expect(wrongJurisdiction.value.tier).toBe('High');
  });

  it('is deterministic with packs — byte-identical across 10 runs', () => {
    const results = Array.from({ length: 10 }, () => evaluate(hiringGraph(), policy, [euPack]));
    const first = JSON.stringify(results[0]);
    for (const r of results) expect(JSON.stringify(r)).toBe(first);
  });
});

// Policy v1.6, 2026-09-28. Three owner-approved rule changes:
//   (a) INV-DISCLOSE-01 / INV-ESCALATE-01 narrowed to direct dealing —
//       action_type: {in: [inform, execute, trade, approve]} added, so an
//       AI upstream of a human-sent message (e.g. a draft an RM edits and
//       sends under their own name) no longer trips either.
//   (b) INV-CITE-01's model_type narrowed to [llm, agentic] — generative-ai
//       (image/audio/video/code generators) no longer trips it.
//   (c) INV-SEC-01's description reworded only; its condition is UNCHANGED.
describe('evaluate — policy v1.6 (2026-09-28)', () => {
  function directDealingGraph(model_type: string, action_type: string): DataFlowGraph {
    return graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: model_type as never, autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'y', action_type: action_type as never, exposure: 'client-facing', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
  }

  it("TC-R17-PV-01: INV-DISCLOSE-01 and INV-ESCALATE-01 no longer trip when the AI only drafts or recommends for a human to send — only when it deals with the client directly (inform/execute/trade/approve)", () => {
    const drafted = evaluate(directDealingGraph('llm', 'draft'), policy);
    const recommended = evaluate(directDealingGraph('llm', 'recommend'), policy);
    const informed = evaluate(directDealingGraph('llm', 'inform'), policy);
    expect(drafted.ok && drafted.value.controls).not.toContain('CTRL-DISCLOSE-01');
    expect(drafted.ok && drafted.value.controls).not.toContain('CTRL-ESCALATE-01');
    expect(recommended.ok && recommended.value.controls).not.toContain('CTRL-DISCLOSE-01');
    expect(recommended.ok && recommended.value.controls).not.toContain('CTRL-ESCALATE-01');
    expect(informed.ok && informed.value.controls).toContain('CTRL-DISCLOSE-01');
    expect(informed.ok && informed.value.controls).toContain('CTRL-ESCALATE-01');
    const informedIds = informed.ok ? informed.value.explanation.tripped_invariants.map((t) => t.id) : [];
    expect(informedIds).toContain('INV-DISCLOSE-01');
    expect(informedIds).toContain('INV-ESCALATE-01');
  });

  it('TC-R17-PV-02: INV-CITE-01 covers llm and agentic (AI that writes text) but no longer generative-ai (image/audio/video/code generators)', () => {
    const llmRead = evaluate(directDealingGraph('llm', 'read'), policy);
    const agenticRead = evaluate(directDealingGraph('agentic', 'read'), policy);
    const genAiRead = evaluate(directDealingGraph('generative-ai', 'read'), policy);
    expect(llmRead.ok && llmRead.value.controls).toContain('CTRL-CITE-01');
    expect(agenticRead.ok && agenticRead.value.controls).toContain('CTRL-CITE-01');
    expect(genAiRead.ok && genAiRead.value.controls).not.toContain('CTRL-CITE-01');
  });

  it('TC-R17-PV-03: INV-SEC-01 still trips exactly as before — v1.6 reworded its description only, the condition (model type + exposure beyond the team\'s own) is unchanged', () => {
    const internalOnly = graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'deep-learning', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'recommend', exposure: 'internal-only', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
    const beyondTeam = graph({ ...internalOnly, output_nodes: [{ ...internalOnly.output_nodes[0]!, exposure: 'internal-shared' }] });
    const stillInternal = evaluate(internalOnly, policy);
    const reachesBeyond = evaluate(beyondTeam, policy);
    expect(stillInternal.ok && stillInternal.value.controls).not.toContain('CTRL-REDTEAM-01');
    expect(reachesBeyond.ok && reachesBeyond.value.controls).toContain('CTRL-REDTEAM-01');
  });

  it('TC-R17-PV-04: the shipped policy version is current — 1.9 since MODEL-NAMES gave the two approved models plain names (1.8 was R16-W, which scoped CTRL-ENC-01\'s evidence and reworded two plain-language fields; 1.7 added the plain-language text; 1.6 carried the rule changes)', () => {
    expect(policy.version).toBe('1.9'); // 1.9 = MODEL-NAMES presentation text only, no verdict changes
  });
});

// R16-A1 (§1.3, D-04, D-57, D-58). Every evaluate() return site now carries
// downstream_review_sources built from all FOUR producers that apply at
// that point in the pipeline (firm rules, pack required_review effects,
// unregistered components, unregistered models) — pack obligations are
// only available on the two FORWARD paths (unsatisfiable-invariant
// rejection and the final assembly), since tier/track — and therefore
// jurisdiction overrides — are honestly skipped on a hard-line rejection
// (§3.1 step order, unchanged by this round). downstream_reviews is
// DERIVED from the sources (their review strings, de-duplicated).
describe('evaluate — R16-A1 review sources (§1.3)', () => {
  const mnpiGraph = () =>
    graph({
      input_nodes: [{ id: 'i1', label: 'deal notes', data_class: 'MNPI', data_zone: 'Zone C' }],
      processing_nodes: [
        { id: 'p1', label: 'summariser', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'summary', action_type: 'recommend', exposure: 'internal-only', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });

  const hardLinePack = (effect: { type: 'hard_line'; reason: string }) => [{
    pack_id: 'TEST-PACK',
    version: '0.1',
    jurisdiction: 'UK',
    regulator: 'Test Regulator',
    document: 'Test Doc',
    effective_date: '2026-01-01',
    reviewer_name: '[FIRM]',
    reviewer_role: '[FIRM]',
    sign_off_date: '[DATE]',
    rules: [{
      id: 'TEST-HL-01',
      title: 'Test hard line',
      source: { document: 'Test Doc', section: 'S1', text: 'test' },
      effect,
      condition: { data_class: { in: ['MNPI'] } },
      basis: 'verbatim' as const,
    }],
  }];

  it('TC-R16-A1-42: the pack hard-line rejection carries downstream_reviews and downstream_review_sources, mirroring the base hard-line branch (the documented bug fix)', () => {
    const g = { ...mnpiGraph(), jurisdictions: ['UK'] };
    const result = evaluate(g, policy, hardLinePack({ type: 'hard_line', reason: 'test reason' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('rejected');
    expect(result.value.binding_constraint).toBe('TEST-HL-01');
    // Before this fix, a pack hard-line rejection set neither field at all.
    expect(result.value.downstream_reviews.length).toBeGreaterThan(0);
    expect(result.value.downstream_review_sources?.length).toBeGreaterThan(0);
    expect(result.value.downstream_review_sources?.every((s) => s.rule_id.startsWith('DR-'))).toBe(true);
    expect(result.value.downstream_reviews).toEqual(
      [...new Set(result.value.downstream_review_sources?.map((s) => s.review))].sort(),
    );
  });

  it('TC-R16-A1-43: a BASE hard-line rejection carries sources from the firm, unregistered-component and model-governance producers (never pack obligations, since tier/track are skipped on a hard-line trip)', () => {
    const g = graph({
      input_nodes: [{ id: 'i1', label: 'deal notes', data_class: 'MNPI', data_zone: 'Zone B' }], // HL-002: MNPI outside Zone C
      processing_nodes: [
        {
          id: 'p1', label: 'summariser', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone B',
          vendor: 'NeverHeardOfCo', replaces_prior_model: false, declared_model_id: 'totally-unlisted-model-xyz',
        },
      ],
      output_nodes: [
        { id: 'o1', label: 'summary', action_type: 'recommend', exposure: 'internal-only', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('rejected');
    expect(result.value.binding_constraint).toBe('HL-002');
    const sources = result.value.downstream_review_sources ?? [];
    expect(sources.some((s) => s.rule_id.startsWith('DR-'))).toBe(true);
    expect(sources.some((s) => s.rule_id === 'PV-UNREGISTERED:NeverHeardOfCo')).toBe(true);
    expect(sources.some((s) => s.rule_id === 'MODEL-REGISTRY:totally-unlisted-model-xyz')).toBe(true);
    // Deterministic order: sorted by rule_id across all producers together.
    const ids = sources.map((s) => s.rule_id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('TC-R16-A1-44: downstream_reviews is DERIVED from downstream_review_sources, de-duplicated by review text — two firm rules sharing the same review text produce two sources but one review string', () => {
    // DR-INFOSEC-01 (MNPI) and DR-INFOSEC-02 (Client PII) both read
    // "Information security review" in the shipped policy — a use case
    // carrying BOTH kinds of information fires both rules.
    const g = graph({
      input_nodes: [
        { id: 'i1', label: 'deal notes', data_class: 'MNPI', data_zone: 'Zone C' },
        { id: 'i2', label: 'client notes', data_class: 'Client PII', data_zone: 'Zone C' },
      ],
      processing_nodes: [
        { id: 'p1', label: 'summariser', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'summary', action_type: 'recommend', exposure: 'internal-only', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
    const result = evaluate(g, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sources = result.value.downstream_review_sources ?? [];
    const infosecSources = sources.filter((s) => s.review === 'Information security review');
    expect(infosecSources.map((s) => s.rule_id).sort()).toEqual(['DR-INFOSEC-01', 'DR-INFOSEC-02']);
    expect(result.value.downstream_reviews.filter((r) => r === 'Information security review')).toHaveLength(1);
  });

  // A pack with a required_review effect, reused by the next two tests —
  // one hitting the unsatisfiable-invariant rejection branch, one hitting
  // the final (approved_with_controls) assembly branch. Same fixture, same
  // condition, different graphs, so the only variable is which evaluate()
  // return site is exercised.
  const reviewPack = [{
    pack_id: 'TEST-REVIEW-PACK',
    version: '0.1',
    jurisdiction: 'UK',
    regulator: 'Test Regulator',
    document: 'Test Doc',
    effective_date: '2026-01-01',
    reviewer_name: '[FIRM]',
    reviewer_role: '[FIRM]',
    sign_off_date: '[DATE]',
    rules: [{
      id: 'TEST-REV-01',
      title: 'Test required review',
      source: { document: 'Test Doc', section: 'S1', text: 'test' },
      effect: { type: 'required_review' as const, review: 'Test pack review' },
      condition: { data_zone: { in: ['Zone C'] } },
      basis: 'verbatim' as const,
    }],
  }];

  it('TC-R16-A1-45: the FINAL assembly branch includes a pack-sourced review, keyed by the pack rule\'s own id', () => {
    const result = evaluate({ ...mnpiGraph(), jurisdictions: ['UK'] }, policy, reviewPack);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).not.toBe('rejected');
    const sources = result.value.downstream_review_sources ?? [];
    expect(sources).toContainEqual({ review: 'Test pack review', rule_id: 'TEST-REV-01' });
    expect(result.value.downstream_reviews).toContain('Test pack review');
  });

  it('TC-R16-A1-46: the UNSATISFIABLE-INVARIANT rejection branch also includes the pack-sourced review, from all four producers', () => {
    const unsatisfiablePolicy: PolicyFile = {
      ...policy,
      invariants: [
        ...policy.invariants,
        {
          id: 'INV-TEST-UNSAT-01',
          description: 'test invariant with no resolving control in the library',
          condition: { data_zone: { in: ['Zone C'] } },
          required_controls: [],
          severity: 'High',
        },
      ],
    };
    const result = evaluate({ ...mnpiGraph(), jurisdictions: ['UK'] }, unsatisfiablePolicy, reviewPack);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('rejected');
    expect(result.value.binding_constraint).toBe('INV-TEST-UNSAT-01');
    const sources = result.value.downstream_review_sources ?? [];
    expect(sources).toContainEqual({ review: 'Test pack review', rule_id: 'TEST-REV-01' });
    expect(sources.some((s) => s.rule_id.startsWith('DR-'))).toBe(true);
    expect(result.value.downstream_reviews).toContain('Test pack review');
  });

  // C-5 (review sources can carry duplicate rule ids). Two different firm-
  // loaded packs can reuse the same rule id by coincidence (different
  // authors, no cross-pack coordination) — rule_id is unique WITHIN one
  // pack's own rules, never guaranteed unique ACROSS every pack a firm
  // loads together. Before this fix, both entries reached the verdict even
  // though `rule_id` promises one review requirement 1:1 with one rule.
  it('TC-CR6-C5a: two different packs sharing a rule id but with DIFFERENT review text keep BOTH obligations, ordered by rule id then review text', () => {
    const sharedRule = (review: string) => ({
      id: 'SHARED-REV-01',
      title: 'Shared id review',
      source: { document: 'Test Doc', section: 'S1', text: 'test' },
      effect: { type: 'required_review' as const, review },
      condition: { data_zone: { in: ['Zone C'] } },
      basis: 'verbatim' as const,
    });
    const packA = {
      pack_id: 'AAA-PACK', version: '0.1', jurisdiction: 'UK', regulator: 'r', document: 'd',
      effective_date: '2026-01-01', reviewer_name: '[FIRM]', reviewer_role: '[FIRM]', sign_off_date: '[DATE]',
      rules: [sharedRule('Review from pack AAA')],
    };
    const packZ = {
      pack_id: 'ZZZ-PACK', version: '0.1', jurisdiction: 'UK', regulator: 'r', document: 'd',
      effective_date: '2026-01-01', reviewer_name: '[FIRM]', reviewer_role: '[FIRM]', sign_off_date: '[DATE]',
      rules: [sharedRule('Review from pack ZZZ')],
    };
    const result = evaluate({ ...mnpiGraph(), jurisdictions: ['UK'] }, policy, [packA, packZ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sources = result.value.downstream_review_sources ?? [];
    const shared = sources.filter((s) => s.rule_id === 'SHARED-REV-01');
    // CR6 FX-3: a shared id with different review text is two real
    // obligations, not a duplicate — dropping one silently lost a review a
    // reader owes. Only identical id AND text collapse (TC-CR6-C5c).
    expect(shared).toEqual([
      { review: 'Review from pack AAA', rule_id: 'SHARED-REV-01' },
      { review: 'Review from pack ZZZ', rule_id: 'SHARED-REV-01' },
    ]);
    expect(result.value.downstream_reviews).toEqual(
      expect.arrayContaining(['Review from pack AAA', 'Review from pack ZZZ']),
    );
  });

  it('TC-CR6-C5c: two packs sharing a rule id AND identical review text still collapse to one source', () => {
    const rule = {
      id: 'SHARED-REV-01',
      title: 'Shared id review',
      source: { document: 'Test Doc', section: 'S1', text: 'test' },
      effect: { type: 'required_review' as const, review: 'Same review text' },
      condition: { data_zone: { in: ['Zone C'] } },
      basis: 'verbatim' as const,
    };
    const mk = (pack_id: string) => ({
      pack_id, version: '0.1', jurisdiction: 'UK', regulator: 'r', document: 'd',
      effective_date: '2026-01-01', reviewer_name: '[FIRM]', reviewer_role: '[FIRM]', sign_off_date: '[DATE]',
      rules: [rule],
    });
    const result = evaluate({ ...mnpiGraph(), jurisdictions: ['UK'] }, policy, [mk('AAA-PACK'), mk('ZZZ-PACK')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shared = (result.value.downstream_review_sources ?? []).filter((s) => s.rule_id === 'SHARED-REV-01');
    expect(shared).toEqual([{ review: 'Same review text', rule_id: 'SHARED-REV-01' }]);
  });
});
