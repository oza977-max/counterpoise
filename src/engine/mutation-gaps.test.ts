import { describe, it, expect } from 'vitest';
import { evaluate, resolveApprovedModel } from './evaluate';
import {
  applyJurisdictionOverrides,
  caveatForFiredRule,
  chainEntryFor,
  isUnsigned,
} from './jurisdiction';
import { solvControls } from './greedy-solver';
import { assignTier } from './tier';
import { assignTrack } from './track';
import type {
  ApprovedModel,
  Control,
  DataFlowGraph,
  EvaluationResult,
  Invariant,
  JurisdictionPack,
  PackRule,
  PackRuleEffect,
  PolicyFile,
  TierRule,
  TrackRule,
} from './types';

// Mutation-gap tests (gvm-test 007). Each test below was written against a
// SURVIVING Stryker mutant in src/engine and asserts the behaviour a reader of
// the spec would expect, not the shape of the implementation. Everything uses
// small synthetic policies so the expected values are visible in the test.

function graph(overrides: Partial<DataFlowGraph> = {}): DataFlowGraph {
  return {
    id: 'g1',
    version: 1,
    input_nodes: [{ id: 'i1', label: 'in', data_class: 'Internal', data_zone: 'Zone A' }],
    processing_nodes: [
      {
        id: 'p1',
        label: 'proc',
        model_type: 'ml',
        autonomy_level: 1,
        data_zone: 'Zone A',
        vendor: 'internal',
        replaces_prior_model: false,
      },
    ],
    output_nodes: [
      {
        id: 'o1',
        label: 'out',
        action_type: 'recommend',
        exposure: 'internal-only',
        decision_bindingness: 'advisory',
        output_reversibility: 'reversible',
        scale: 'limited',
      },
    ],
    edges: [],
    jurisdictions: [],
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const TRACK_I: TrackRule = {
  id: 'TRACK-I',
  name: 'Track one',
  description: '',
  conditions: [],
  short_circuit: true,
  regulatory_basis: 'Track basis',
};

function policy(overrides: Partial<PolicyFile> = {}): PolicyFile {
  return {
    version: 'test-1',
    policy_id: 'test',
    firm_name: 'Test Firm',
    translation_attestation: { attested_by: 't', role: 't', date: '2026-01-01', raf_version_checked: '1' },
    hard_lines: [],
    tracks: [TRACK_I],
    tiers: [],
    invariants: [],
    controls: [],
    kri_thresholds: {},
    jurisdictions: [],
    roles: {},
    tier_workflow: {} as PolicyFile['tier_workflow'],
    safety_margin: 0.5,
    ...overrides,
  };
}

function inv(id: string, controls: string[], extra: Partial<Invariant> = {}): Invariant {
  return {
    id,
    description: `${id} description`,
    condition: { label: 'proc' },
    required_controls: controls,
    severity: 'High',
    ...extra,
  };
}

function ctrl(id: string, resolves: string[], burden: Control['burden'] = 1): Control {
  return { id, name: id, description: id, resolves, burden, verification: 'fixture' };
}

function packRule(id: string, effect: PackRuleEffect, extra: Partial<PackRule> = {}): PackRule {
  return {
    id,
    title: id,
    source: { document: 'Doc X', section: 's.9', text: 'The regulation says so.' },
    effect,
    condition: { label: 'proc' },
    basis: 'verbatim',
    ...extra,
  };
}

function pack(packId: string, rules: PackRule[], extra: Partial<JurisdictionPack> = {}): JurisdictionPack {
  return {
    pack_id: packId,
    version: '1.0',
    jurisdiction: 'UK',
    regulator: 'Reg',
    document: 'Doc X',
    effective_date: '2026-01-01',
    reviewer_name: 'Pat Reviewer',
    reviewer_role: 'Legal',
    sign_off_date: '2026-02-02',
    rules,
    ...extra,
  };
}

function run(g: DataFlowGraph, p: PolicyFile, packs: JurisdictionPack[] = []): EvaluationResult {
  const r = evaluate(g, p, packs);
  if (!r.ok) throw new Error(`evaluate failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

// A library where INV-A has two alternative controls (depth 2) and INV-B has
// one (depth 1). Tripping both gives marginAchieved = 0.5.
const HALF_LIBRARY = [ctrl('C-A1', ['INV-A']), ctrl('C-A2', ['INV-A']), ctrl('C-B1', ['INV-B'])];
const HALF_INVARIANTS = [inv('INV-A', ['C-A1', 'C-A2']), inv('INV-B', ['C-B1'])];

describe('MUT-1: boundary_proximity compares achieved margin with the policy target', () => {
  const halfPolicy = (safety_margin: number) =>
    policy({ invariants: HALF_INVARIANTS, controls: HALF_LIBRARY, safety_margin });

  it('MUT-1a: false when nothing trips, even if the target is impossible to meet', () => {
    const r = run(graph(), policy({ safety_margin: 2 }));
    expect(r.boundary_proximity).toBe(false);
    expect(r.status).toBe('approved');
  });

  it('MUT-1b: true when the achieved margin is just below the target', () => {
    const r = run(graph(), halfPolicy(0.51));
    expect(r.margin_achieved).toBe(0.5);
    expect(r.boundary_proximity).toBe(true);
  });

  it('MUT-1c: false when the achieved margin equals the target exactly', () => {
    const r = run(graph(), halfPolicy(0.5));
    expect(r.margin_achieved).toBe(0.5);
    expect(r.boundary_proximity).toBe(false);
  });

  it('MUT-1d: false when the achieved margin is above the target', () => {
    const r = run(graph(), halfPolicy(0.49));
    expect(r.boundary_proximity).toBe(false);
  });
});

describe('MUT-2: status is approved_with_controls whenever anything is required', () => {
  const ukPack = pack('PK-1', [packRule('PK-1-CTRL', { type: 'required_control', control_id: 'C-PACK' })]);
  const ukGraph = () => graph({ jurisdictions: ['UK'] });

  it('MUT-2a: tripped invariants alone give approved_with_controls', () => {
    const r = run(graph(), policy({ invariants: [inv('INV-A', ['C-A1'])], controls: [ctrl('C-A1', ['INV-A'])] }));
    expect(r.status).toBe('approved_with_controls');
    expect(r.controls).toEqual(['C-A1']);
  });

  it('MUT-2b: jurisdiction-added controls alone give approved_with_controls', () => {
    const r = run(ukGraph(), policy(), [ukPack]);
    expect(r.explanation.tripped_invariants).toEqual([]);
    expect(r.status).toBe('approved_with_controls');
    expect(r.controls).toEqual(['C-PACK']);
  });

  it('MUT-2c: nothing tripped and nothing added gives approved with no controls', () => {
    const r = run(graph(), policy());
    expect(r.status).toBe('approved');
    expect(r.controls).toEqual([]);
  });

  it('MUT-2d: a jurisdiction pack that matches nothing leaves a clean verdict approved', () => {
    const quiet = pack('PK-2', [packRule('PK-2-CTRL', { type: 'required_control', control_id: 'C-PACK' }, { condition: { label: 'nope' } })]);
    const r = run(ukGraph(), policy(), [quiet]);
    expect(r.status).toBe('approved');
  });
});

describe('MUT-3: unsatisfiable-invariant rejection names the invariant that cannot be satisfied', () => {
  it('MUT-3: binding constraint, path and regulatory basis are the unsatisfiable invariant\'s', () => {
    const p = policy({
      invariants: [inv('INV-STUCK', ['C-NONE'], { regulatory_basis: 'Reg Z s.5' })],
      controls: [ctrl('C-OTHER', ['INV-OTHER'])],
    });
    const r = run(graph(), p);
    expect(r.status).toBe('rejected');
    expect(r.binding_constraint).toBe('INV-STUCK');
    expect(r.binding_path).toBe('in → proc → out');
    expect(r.explanation.binding_regulatory_basis).toBe('Reg Z s.5');
    expect(r.explanation.binding_reason).toBeNull();
    expect(r.explanation.tripped_invariants.map((t) => t.id)).toEqual(['INV-STUCK']);
  });

  it('MUT-3b: with several tripped invariants it is the unsatisfiable one that is named, with its own basis', () => {
    const p = policy({
      invariants: [
        inv('INV-A-OK', ['C-A1'], { regulatory_basis: 'Reg A' }),
        inv('INV-B-STUCK', ['C-NONE'], { regulatory_basis: 'Reg B' }),
      ],
      controls: [ctrl('C-A1', ['INV-A-OK'])],
    });
    const r = run(graph(), p);
    expect(r.status).toBe('rejected');
    expect(r.binding_constraint).toBe('INV-B-STUCK');
    expect(r.explanation.binding_regulatory_basis).toBe('Reg B');
    expect(r.explanation.regulatory_chain).toEqual([]);
  });
});

describe('MUT-4: pack hard-line rejection verdict', () => {
  const hardRule = packRule('PK-HL-1', { type: 'hard_line', reason: 'This is not allowed in the UK.' });
  const ukGraph = () => graph({ jurisdictions: ['UK'] });
  // Even though an invariant would trip, a hard line returns before invariants.
  const withInvariant = (): PolicyFile =>
    policy({
      invariants: [inv('INV-A', ['C-A1'])],
      controls: [ctrl('C-A1', ['INV-A'])],
      downstream_reviews: [{ id: 'REV-FIRM', review: 'Firm security review', condition: { label: 'proc' } }],
    });

  it('MUT-4a: unsigned pack rule — Critical / I, reason, citation, chain, caveat', () => {
    const unsigned = pack('PK-HL', [hardRule], { reviewer_name: '[name]', sign_off_date: '[date]' });
    const r = run(ukGraph(), withInvariant(), [unsigned]);
    expect(r.status).toBe('rejected');
    expect(r.tier).toBe('Critical');
    expect(r.track).toBe('I');
    expect(r.binding_constraint).toBe('PK-HL-1');
    expect(r.binding_path).toBe('in → proc → out');
    expect(r.explanation.binding_reason).toBe('This is not allowed in the UK.');
    expect(r.explanation.binding_regulatory_basis).toBe('Doc X s.9');
    expect(r.explanation.tripped_invariants).toEqual([]);
    expect(r.explanation.invariants_checked).toBe(0);
    expect(r.explanation.regulatory_chain).toEqual([
      {
        rule_id: 'PK-HL-1',
        document: 'Doc X',
        section: 's.9',
        source_text: 'The regulation says so.',
        basis: 'verbatim',
        derived: 'Hard-line rejection: This is not allowed in the UK.',
        sign_off: '[name] · pending firm adoption',
      },
    ]);
    expect(r.confidence_caveats).toEqual([
      {
        ruleId: 'PK-HL-1',
        field: 'jurisdiction_pack',
        confidence: 'low',
        reason: 'Doc X s.9 — proposed interpretation, pending firm adoption (pack not adopted)',
      },
    ]);
    expect(r.provisional_reasons).toContain('unsigned_pack_rules');
    expect(r.pack_versions).toEqual({ 'PK-HL': '1.0' });
    expect(r.controls).toEqual([]);
    // The firm's own review still rides along (mirror of the base hard-line path).
    expect(r.downstream_reviews).toEqual(['Firm security review']);
    expect(r.downstream_review_sources?.map((s) => s.rule_id)).toEqual(['REV-FIRM']);
  });

  it('MUT-4b: signed verbatim pack rule produces no caveat but still a chain entry', () => {
    const r = run(ukGraph(), withInvariant(), [pack('PK-HL', [hardRule])]);
    expect(r.status).toBe('rejected');
    expect(r.confidence_caveats).toEqual([]);
    expect(r.explanation.regulatory_chain).toHaveLength(1);
    expect(r.explanation.regulatory_chain![0]!.sign_off).toBe('Pat Reviewer · 2026-02-02 (adopted at pack level)');
  });
});

describe('MUT-5: inheritance resolution', () => {
  const entry = (id: string) => ({
    id,
    name: id,
    approved_envelope: {},
    satisfies_controls: [],
  });
  const withNodes = (platform: string | undefined, vendor: string) => {
    const g = graph();
    g.processing_nodes[0] = { ...g.processing_nodes[0]!, vendor, ...(platform ? { platform } : {}) };
    return g;
  };
  const registries = () => policy({ platforms: [entry('PLAT-OK')], vendors: [entry('VEND-OK')] });

  it('MUT-5a: resolved is true only when every declared component is on the registry', () => {
    const r = run(withNodes('PLAT-OK', 'VEND-OK'), registries());
    expect(r.inheritance?.resolved).toBe(true);
    expect(r.inheritance?.unresolved_components).toEqual([]);
  });

  it('MUT-5b: one unknown component makes resolved false and names it', () => {
    const r = run(withNodes('PLAT-OK', 'VEND-UNKNOWN'), registries());
    expect(r.inheritance?.resolved).toBe(false);
    expect(r.inheritance?.unresolved_components).toEqual(['VEND-UNKNOWN']);
  });

  it('MUT-5c: unresolved_components are sorted, whichever component was pushed first', () => {
    // The platform is checked before the vendor, so unsorted output would be
    // [Z-PLATFORM, A-VENDOR].
    const r = run(withNodes('Z-PLATFORM', 'A-VENDOR'), registries());
    expect(r.inheritance?.resolved).toBe(false);
    expect(r.inheritance?.unresolved_components).toEqual(['A-VENDOR', 'Z-PLATFORM']);
  });
});

describe('MUT-6: approved-model family matching', () => {
  const model = (m: Partial<ApprovedModel> & { model_id: string }): ApprovedModel => ({
    vendor: 'V',
    provenance_class: 'vendor_hosted',
    is_approved: true,
    ...m,
  });
  const MODELS: ApprovedModel[] = [
    model({ model_id: 'gpt-4o-*', is_family: true, version_pattern: 'gpt-4o-' }),
    model({ model_id: 'exact-1' }),
    // Not a family: a stray version_pattern must not turn it into one.
    model({ model_id: 'plain-x', version_pattern: 'plain-' }),
    // A family with no pattern matches nothing (not even the string "undefined").
    model({ model_id: 'broken-family', is_family: true }),
  ];

  it('MUT-6a: a family entry matches an id that starts with its pattern, not one that does not', () => {
    expect(resolveApprovedModel(MODELS, 'gpt-4o-2024-08')?.model_id).toBe('gpt-4o-*');
    expect(resolveApprovedModel(MODELS, 'gpt-4o-')?.model_id).toBe('gpt-4o-*');
    expect(resolveApprovedModel(MODELS, 'gpt-4-turbo')).toBeUndefined();
    expect(resolveApprovedModel(MODELS, 'xgpt-4o-2024')).toBeUndefined();
  });

  it('MUT-6b: non-family entries need an exact id', () => {
    expect(resolveApprovedModel(MODELS, 'exact-1')?.model_id).toBe('exact-1');
    expect(resolveApprovedModel(MODELS, 'exact-1-extra')).toBeUndefined();
    expect(resolveApprovedModel(MODELS, 'plain-y')).toBeUndefined();
  });

  it('MUT-6c: a family without a version_pattern matches nothing', () => {
    expect(resolveApprovedModel(MODELS, 'undefined-anything')).toBeUndefined();
    expect(resolveApprovedModel(MODELS, 'broken-family')).toBeUndefined();
  });

  it('MUT-6d: through evaluate, only unmatched declared models raise a model governance review', () => {
    const declare = (id: string) => {
      const g = graph();
      g.processing_nodes[0] = { ...g.processing_nodes[0]!, declared_model_id: id };
      return g;
    };
    const p = policy({ approved_models: MODELS });
    expect(run(declare('gpt-4o-2024-08'), p).downstream_review_sources ?? []).toEqual([]);
    expect(run(declare('exact-1'), p).downstream_review_sources ?? []).toEqual([]);
    expect(run(declare('gpt-4-turbo'), p).downstream_review_sources?.map((s) => s.rule_id)).toEqual([
      'MODEL-REGISTRY:gpt-4-turbo',
    ]);
    expect(run(declare('exact-1-extra'), p).downstream_review_sources?.map((s) => s.rule_id)).toEqual([
      'MODEL-REGISTRY:exact-1-extra',
    ]);
  });
});

describe('MUT-7: downstream reviews are de-duplicated (first wins) and stably ordered', () => {
  const firmRules = () => [
    { id: 'REV-B', review: 'Second review', condition: { label: 'proc' } },
    { id: 'REV-A', review: 'First review', condition: { label: 'proc' } },
    // Same id and text as a pack rule below; carries a basis the pack's does not.
    { id: 'DUP-1', review: 'Shared review', condition: { label: 'proc' }, regulatory_basis: 'Firm basis' },
  ];
  const packA = () =>
    pack('PK-A', [
      packRule('DUP-1', { type: 'required_review', review: 'Shared review' }),
      packRule('SHARED-ID', { type: 'required_review', review: 'Beta review' }),
    ]);
  const packB = () => pack('PK-B', [packRule('SHARED-ID', { type: 'required_review', review: 'Alpha review' })]);
  const g = () => graph({ jurisdictions: ['UK'] });

  it('MUT-7a: identical (id, text) collapses to one entry and the firm\'s copy (first producer) wins', () => {
    const r = run(g(), policy({ downstream_reviews: firmRules() }), [packA(), packB()]);
    const dups = (r.downstream_review_sources ?? []).filter((s) => s.rule_id === 'DUP-1');
    expect(dups).toHaveLength(1);
    expect(dups[0]!.regulatory_basis).toBe('Firm basis');
  });

  it('MUT-7b: same id with different text keeps both, ordered by id then text', () => {
    const r = run(g(), policy({ downstream_reviews: firmRules() }), [packA(), packB()]);
    expect(r.downstream_review_sources?.map((s) => `${s.rule_id}|${s.review}`)).toEqual([
      'DUP-1|Shared review',
      'REV-A|First review',
      'REV-B|Second review',
      'SHARED-ID|Alpha review',
      'SHARED-ID|Beta review',
    ]);
    expect(r.downstream_reviews).toEqual([
      'Alpha review',
      'Beta review',
      'First review',
      'Second review',
      'Shared review',
    ]);
  });

  it('MUT-7c: permuting policy rules and packs does not change the verdict by one byte', () => {
    const base = JSON.stringify(run(g(), policy({ downstream_reviews: firmRules() }), [packA(), packB()]));
    const permuted = JSON.stringify(
      run(g(), policy({ downstream_reviews: [...firmRules()].reverse() }), [
        { ...packB() },
        { ...packA(), rules: [...packA().rules].reverse() },
      ]),
    );
    expect(permuted).toBe(base);
  });
});

describe('MUT-8: a sign-off needs BOTH a name and a date (NF-7)', () => {
  const rule = (extra: Partial<PackRule> = {}) => packRule('R', { type: 'required_control', control_id: 'C' }, extra);
  const signedPack = { reviewer_name: 'Pat Reviewer', sign_off_date: '2026-02-02' };

  it('MUT-8a: a name with no date is unsigned', () => {
    expect(isUnsigned(rule({ reviewer_name: 'Ann' }))).toBe(true);
  });

  it('MUT-8b: a date with no name is unsigned', () => {
    expect(isUnsigned(rule({ sign_off_date: '2026-01-01' }))).toBe(true);
  });

  it('MUT-8c: a name and a date on the rule itself is signed', () => {
    expect(isUnsigned(rule({ reviewer_name: 'Ann', sign_off_date: '2026-01-01' }))).toBe(false);
  });

  it('MUT-8d: neither on the rule and no pack is unsigned', () => {
    expect(isUnsigned(rule())).toBe(true);
  });

  it('MUT-8e: the pack-level sign-off applies when the rule has none of its own', () => {
    expect(isUnsigned(rule(), signedPack)).toBe(false);
    expect(isUnsigned(rule(), { reviewer_name: 'Pat', sign_off_date: '' })).toBe(true);
    expect(isUnsigned(rule(), { reviewer_name: '', sign_off_date: '2026-02-02' })).toBe(true);
  });

  it('MUT-8f: a rule\'s own placeholder wins over a signed pack, and placeholders count as unsigned', () => {
    expect(isUnsigned(rule({ reviewer_name: '[name]' }), signedPack)).toBe(true);
    expect(isUnsigned(rule({ sign_off_date: '[date]' }), signedPack)).toBe(true);
    expect(isUnsigned(rule({ reviewer_name: 'Ann', sign_off_date: '2026-01-01' }), { reviewer_name: '[x]', sign_off_date: '[y]' })).toBe(false);
  });

  it('MUT-8g: the chain entry and caveat read the same sign-off the check does', () => {
    // No sign-off anywhere: the chain says so in words.
    expect(chainEntryFor(rule(), 'd', undefined, graph()).sign_off).toBe('not yet adopted · pending firm adoption');
    // Pack-level adoption.
    expect(chainEntryFor(rule(), 'd', { ...signedPack, reviewer_role: 'Legal' }, graph()).sign_off).toBe(
      'Pat Reviewer · 2026-02-02 (adopted at pack level)',
    );
    // Rule-level adoption names the rule, not the pack.
    expect(chainEntryFor(rule({ reviewer_name: 'Ann', sign_off_date: '2026-03-03' }), 'd', { ...signedPack, reviewer_role: 'Legal' }, graph()).sign_off).toBe(
      'Ann · 2026-03-03 (adopted at this rule level)',
    );
    // A name without a date is not adopted, and the caveat says so.
    const half = rule({ reviewer_name: 'Ann' });
    expect(chainEntryFor(half, 'd', undefined, graph()).sign_off).toBe('Ann · pending firm adoption');
    expect(caveatForFiredRule(half)?.confidence).toBe('low');
    expect(caveatForFiredRule(rule(), { ...signedPack, reviewer_role: 'Legal' })).toBeNull();
  });
});

describe('MUT-9: jurisdiction overrides — tier floors, hard lines and determinism', () => {
  const g = graph({ jurisdictions: ['UK'] });
  const floor = (id: string, minimum_tier: 'Low' | 'Medium' | 'High' | 'Critical') =>
    packRule(id, { type: 'tier_floor', minimum_tier });

  it('MUT-9a: a floor equal to the current tier leaves it unchanged and says it was already satisfied', () => {
    const r = applyJurisdictionOverrides(g, 'High', 'II', [pack('PK', [floor('R-1', 'High')])]);
    expect(r.finalTier).toBe('High');
    expect(r.appliedOverrides).toEqual([
      { packCode: 'PK', ruleId: 'R-1', effect: 'Tier floor High already satisfied by High.' },
    ]);
    expect(r.chain[0]!.derived).not.toMatch(/forced/);
  });

  it('MUT-9b: a floor below the tier is satisfied; a floor above forces the tier up', () => {
    const below = applyJurisdictionOverrides(g, 'High', 'II', [pack('PK', [floor('R-1', 'Medium')])]);
    expect(below.finalTier).toBe('High');
    expect(below.appliedOverrides[0]!.effect).toBe('Tier floor Medium already satisfied by High.');
    const above = applyJurisdictionOverrides(g, 'High', 'II', [pack('PK', [floor('R-1', 'Critical')])]);
    expect(above.finalTier).toBe('Critical');
    expect(above.appliedOverrides[0]!.effect).toBe('Tier forced to Critical (was High) — most demanding standard applies.');
    // The track is never changed by a pack.
    expect(above.finalTrack).toBe('II');
  });

  it('MUT-9c: a pack hard_line rule is skipped by the override loop (it is handled before tiering)', () => {
    const r = applyJurisdictionOverrides(g, 'Low', 'I', [
      pack('PK', [packRule('R-HL', { type: 'hard_line', reason: 'no' }), floor('R-2', 'High')]),
    ]);
    expect(r.appliedOverrides.map((o) => o.ruleId)).toEqual(['R-2']);
    expect(r.chain.map((c) => c.rule_id)).toEqual(['R-2']);
    expect(r.caveats).toEqual([]);
    expect(r.finalTier).toBe('High');
  });

  it('MUT-9d: rule order, added controls and added reviews are deterministic under permuted input', () => {
    const rulesOf = (): PackRule[] => [
      packRule('Z-REV', { type: 'required_review', review: 'Review Z' }),
      packRule('B-CTRL', { type: 'required_control', control_id: 'C-SECOND' }),
      packRule('D-CTRL', { type: 'required_control', control_id: 'C-FIRST' }),
      packRule('C-DUP', { type: 'required_control', control_id: 'C-SECOND' }),
      packRule('A-REV', { type: 'required_review', review: 'Review A' }),
    ];
    const p1 = () => pack('PK-1', rulesOf());
    const p2 = () =>
      pack('PK-2', [
        packRule('E-CTRL', { type: 'required_control', control_id: 'C-AAA' }),
        packRule('A-REV2', { type: 'required_review', review: 'Review A2' }),
      ]);

    const base = applyJurisdictionOverrides(g, 'Low', 'I', [p1(), p2()]);
    const permuted = applyJurisdictionOverrides(g, 'Low', 'I', [
      p2(),
      { ...p1(), rules: [...rulesOf()].reverse() },
    ]);
    expect(JSON.stringify(permuted)).toBe(JSON.stringify(base));

    // Applied order: packs by id, then rules by id within each pack.
    expect(base.appliedOverrides.map((o) => `${o.packCode}/${o.ruleId}`)).toEqual([
      'PK-1/A-REV',
      'PK-1/B-CTRL',
      'PK-1/C-DUP',
      'PK-1/D-CTRL',
      'PK-1/Z-REV',
      'PK-2/A-REV2',
      'PK-2/E-CTRL',
    ]);
    // Controls de-duplicated and sorted; reviews sorted by rule id.
    expect(base.addedControls).toEqual(['C-AAA', 'C-FIRST', 'C-SECOND']);
    expect(base.addedReviews).toEqual([
      { review: 'Review A', rule_id: 'A-REV' },
      { review: 'Review A2', rule_id: 'A-REV2' },
      { review: 'Review Z', rule_id: 'Z-REV' },
    ]);
  });
});

describe('MUT-10: greedy solver edge cases', () => {
  it('MUT-10a: a control that covers none of the remaining invariants is never selected', () => {
    // C-ZERO is cheapest and alphabetically first, so only its zero coverage keeps it out.
    const library = [ctrl('A-ZERO', ['INV-OTHER'], 1), ctrl('C-REAL', ['INV-1'], 5)];
    const r = solvControls(['INV-1'], library, []);
    expect(r).toMatchObject({ ok: true, controls: ['C-REAL'] });
  });

  it('MUT-10b: when only zero-coverage controls exist the invariant is reported unsatisfiable', () => {
    const r = solvControls(['INV-1'], [ctrl('A-ZERO', ['INV-OTHER'], 1)], []);
    expect(r).toEqual({ ok: false, unsatisfiableInvariant: 'INV-1' });
  });

  it('MUT-10c: an inherited control id absent from the library is ignored without crashing', () => {
    const library = [ctrl('C-1', ['INV-1'])];
    const r = solvControls(['INV-1'], library, ['C-GHOST']);
    expect(r).toMatchObject({ ok: true, controls: ['C-1'] });
  });

  it('MUT-10d: single_covered_invariants is sorted whatever order the invariants tripped in', () => {
    const library = [ctrl('C-A', ['INV-A']), ctrl('C-B', ['INV-B']), ctrl('C-C', ['INV-C'])];
    const r = solvControls(['INV-C', 'INV-A', 'INV-B'], library, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.singleCovered).toEqual(['INV-A', 'INV-B', 'INV-C']);
  });

  it('MUT-10e: with nothing tripped the margin is the number 1, not NaN, and nothing is single-covered', () => {
    const r = solvControls([], [ctrl('C-1', ['INV-1'])], []);
    expect(r).toEqual({ ok: true, controls: [], marginAchieved: 1, singleCovered: [] });
    if (r.ok) expect(Number.isNaN(r.marginAchieved)).toBe(false);
    // And on a full verdict.
    const v = run(graph(), policy());
    expect(v.margin_achieved).toBe(1);
    expect(v.single_covered_invariants).toEqual([]);
  });
});

describe('MUT-11: tier ties report the first rule in policy order', () => {
  const tierRule = (id: string, name: string, triggers: TierRule['triggers']): TierRule => ({ id, name, triggers });
  const hit = { field: 'label', value: 'proc' };
  const miss = { field: 'label', value: 'nope' };

  it('MUT-11a: two rules giving the same tier — the first one listed is the triggering rule', () => {
    const rules = [tierRule('TIER-FIRST', 'High', [hit]), tierRule('TIER-SECOND', 'High', [hit])];
    expect(assignTier(graph(), rules).triggeringRuleId).toBe('TIER-FIRST');
    expect(assignTier(graph(), [...rules].reverse()).triggeringRuleId).toBe('TIER-SECOND');
  });

  it('MUT-11b: two triggers of one rule giving the same tier — the first trigger is reported', () => {
    const r = assignTier(graph(), [
      tierRule('TIER-X', 'High', [
        { field: 'label', value: 'in' },
        { field: 'label', value: 'out', regulatory_basis: 'later' },
      ]),
    ]);
    expect(r.triggeringValue).toBe('in');
    expect(r.triggeringRegulatoryBasis).toBeUndefined();
  });

  it('MUT-11c: a higher tier still beats an earlier lower one, and a later lower one never displaces', () => {
    const r = assignTier(graph(), [
      tierRule('T-MED', 'Medium', [hit]),
      tierRule('T-CRIT', 'Critical', [hit]),
      tierRule('T-LOW', 'Low', [hit]),
      tierRule('T-NO', 'Critical', [miss]),
    ]);
    expect(r.tier).toBe('Critical');
    expect(r.triggeringRuleId).toBe('T-CRIT');
  });
});

describe('MUT-12: track id parsing is anchored at the start', () => {
  const rule = (id: string): TrackRule => ({ ...TRACK_I, id });
  const trackOf = (id: string) => {
    const r = assignTrack(graph(), [rule(id)]);
    if (!r.ok) throw new Error('no match');
    return r.value.track;
  };

  it('MUT-12a: the real policy ids parse to their track, longest numeral first', () => {
    expect(trackOf('TRACK-III-AGENTIC')).toBe('III');
    expect(trackOf('TRACK-III')).toBe('III');
    expect(trackOf('TRACK-II-REPLACE')).toBe('II');
    expect(trackOf('TRACK-II-AUTONOMY')).toBe('II');
    expect(trackOf('TRACK-II')).toBe('II');
    expect(trackOf('TRACK-I')).toBe('I');
  });

  it('MUT-12b: an id that merely contains TRACK-II is not read as track II', () => {
    expect(trackOf('X-TRACK-II-EXTRA')).toBe('I');
    expect(trackOf('LEGACY-TRACK-III')).toBe('I');
  });

  it('MUT-12c: the first matching rule decides, in the order given', () => {
    const r = assignTrack(graph(), [rule('TRACK-II-REPLACE'), rule('TRACK-I')]);
    expect(r.ok && r.value.ruleId).toBe('TRACK-II-REPLACE');
    expect(r.ok && r.value.track).toBe('II');
  });
});
