import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy, onPolicyUpdated } from '../store/policy';
import { loadPacks } from '../store/packs';
import { getPackSources } from '../store/pack-source';
import { addNode, getUseCase } from '../store/register';
import { append, getAll } from '../store/audit';
import type { RegisterNode } from '../store/types';
import type { Verdict } from '../types/verdict';
import { evaluate } from './evaluate';
import { resolveActivePacks } from './jurisdiction';
import { assignTrack } from './track';
import { generateQuestions, getQuestionBudget } from './question-generator';
import { detectContradictions } from './contradiction';
import { load, dump } from 'js-yaml';
import type { DataFlowGraph, EvaluationResult, JurisdictionPack, PolicyFile, TrackRule } from './types';

// gvm-test 007, close-out builder 1. Each test below is named by the V1
// acceptance-case id it proves (test-cases/test-cases.md). They use the real
// engine, the real shipped policy and packs, and the suite's fake IndexedDB;
// nothing is mocked except where a test says so.

const YAML = readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8');
let policy: PolicyFile;
let packs: JurisdictionPack[];

beforeAll(() => {
  const r = loadPolicy(YAML);
  if (!r.valid) throw new Error(`fixture policy invalid: ${JSON.stringify(r.errors)}`);
  policy = r.policy;
  const p = loadPacks(getPackSources());
  if (p.errors.length > 0) throw new Error(`pack errors: ${JSON.stringify(p.errors)}`);
  packs = p.packs;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function graph(over: Partial<DataFlowGraph> = {}, decisionType?: string): DataFlowGraph {
  return {
    id: 'g-co1',
    version: 1,
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00.000Z',
    jurisdictions: [],
    input_nodes: [{ id: 'i1', label: 'transaction history', data_class: 'Client PII', data_zone: 'Zone B' }],
    processing_nodes: [
      { id: 'p1', label: 'credit model', model_type: 'ml', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false },
    ],
    output_nodes: [
      {
        id: 'o1',
        label: 'lending decision',
        action_type: 'recommend',
        exposure: 'internal-shared',
        decision_bindingness: 'material',
        output_reversibility: 'reversible',
        scale: 'at_scale',
        ...(decisionType ? { decision_type: decisionType as never } : {}),
      },
    ],
    edges: [
      { from: 'i1', to: 'p1' },
      { from: 'p1', to: 'o1' },
    ],
    ...over,
  };
}

function run(g: DataFlowGraph, p: PolicyFile = policy, withPacks: JurisdictionPack[] = []): EvaluationResult {
  const r = evaluate(g, p, withPacks);
  if (!r.ok) throw new Error(`engine error: ${JSON.stringify(r.error)}`);
  return r.value;
}

// An internal-only, non-binding summariser: the clean case.
const CLEAN = graph({
  input_nodes: [{ id: 'i1', label: 'notes', data_class: 'Internal', data_zone: 'Zone C' }],
  processing_nodes: [
    { id: 'p1', label: 'scorecard', model_type: 'statistical', autonomy_level: 0, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
  ],
  output_nodes: [
    { id: 'o1', label: 'figure', action_type: 'read', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' },
  ],
});

// Autonomous trading agent: trips HL-001 (L4 + irreversible + client-facing).
const HARD_LINE = graph({
  processing_nodes: [
    { id: 'p1', label: 'x', model_type: 'agentic', autonomy_level: 4, data_zone: 'Zone A', vendor: 'internal', replaces_prior_model: false },
  ],
  output_nodes: [
    { id: 'o1', label: 'y', action_type: 'execute', exposure: 'client-facing', decision_bindingness: 'binding', output_reversibility: 'irreversible', scale: 'at_scale' },
  ],
});

describe('CF-3 — the policy version in force is recorded on every verdict', () => {
  it('TC-CF-3-01: a clean approval, a control-bearing verdict and a hard-line rejection all record the policy version in force', () => {
    const bumped: PolicyFile = { ...policy, version: '7.3-closeout' };
    const paths = [
      ['clean approval', run(CLEAN, bumped), 'approved'],
      ['approved with controls', run(graph(), bumped), 'approved_with_controls'],
      ['hard-line rejection', run(HARD_LINE, bumped), 'rejected'],
    ] as const;
    for (const [label, verdict, status] of paths) {
      expect(verdict.status, label).toBe(status);
      // The version the policy had when the verdict was produced — never the
      // empty default the result is assembled from.
      expect(verdict.policy_version, label).toBe('7.3-closeout');
    }
    // The shipped policy's own version is what an unmodified run records.
    expect(run(graph()).policy_version).toBe(policy.version);
    expect(policy.version.length).toBeGreaterThan(0);
  });
});

describe('CF-5 — a fully valid policy and pack set loads cleanly and evaluation is available', () => {
  it('the shipped policy and every shipped pack load with no error, and evaluation runs immediately [TC-CF-5-03]', () => {
    const loadedPolicy = loadPolicy(YAML);
    expect(loadedPolicy.valid).toBe(true);
    const loadedPacks = loadPacks(getPackSources());
    expect(loadedPacks.errors).toEqual([]);
    // Four authored packs (see store/packs.test.ts) — none silently dropped.
    expect(loadedPacks.packs.length).toBe(4);
    if (!loadedPolicy.valid) return;
    // "Evaluation is available immediately": a verdict comes back first time,
    // with the packs loaded alongside the policy.
    const r = evaluate(graph({ jurisdictions: ['UK', 'EU'] }), loadedPolicy.policy, loadedPacks.packs);
    expect(r.ok).toBe(true);
  });
});

describe('CS-1 — the margin is reported honestly when the library gives no alternatives', () => {
  it('TC-CS-1-02b: with one resolving control per invariant the verdict reports margin 0, every tripped invariant single-covered, and below target', () => {
    // The library the case describes: exactly one control per invariant.
    const oneEach: PolicyFile = {
      ...policy,
      safety_margin: 0.1,
      controls: policy.invariants.map((inv) => ({
        id: `CTRL-ONLY-${inv.id}`,
        name: `Only control for ${inv.id}`,
        description: 'test fixture',
        resolves: [inv.id],
        burden: 1,
        verification: 'test fixture',
      })),
    };
    const v = run(graph(), oneEach);
    const trippedIds = v.explanation.tripped_invariants.map((t) => t.id).sort();
    expect(trippedIds.length).toBeGreaterThan(1);
    // Solver terminated (we got here) and reports it honestly.
    expect(v.margin_achieved).toBe(0);
    expect(v.margin_target).toBe(0.1);
    expect([...v.single_covered_invariants].sort()).toEqual(trippedIds);
    // Not presented as met: the boundary-proximity flag is raised.
    expect(v.boundary_proximity).toBe(true);
    // One control per tripped invariant — nothing padded to chase the margin.
    expect(v.controls.length).toBe(trippedIds.length);
  });
});

describe('PE-1 / NF-1 — determinism across runs and clocks', () => {
  // A grid straddling the tier boundaries: every combination of the fields
  // the firm's tier rules key on. Cheap (192 graphs) and it lands on all four
  // tiers, so "borderline" is exercised rather than assumed.
  const BORDERLINE: DataFlowGraph[] = [];
  for (const exposure of ['internal-only', 'internal-shared', 'client-facing', 'market-facing'] as const) {
    for (const bind of ['non-binding', 'advisory', 'material', 'binding'] as const) {
      for (const autonomy of [0, 1, 2] as const) {
        for (const scale of ['limited', 'at_scale'] as const) {
         for (const decisionType of [undefined, 'credit-decision'] as const) {
          BORDERLINE.push(
            graph({
              input_nodes: [{ id: 'i1', label: 'in', data_class: decisionType ? 'Client PII' : 'Internal', data_zone: 'Zone C' }],
              processing_nodes: [
                { id: 'p1', label: 'm', model_type: 'ml', autonomy_level: autonomy, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
              ],
              output_nodes: [
                { id: 'o1', label: 'o', action_type: 'recommend', exposure, decision_bindingness: bind, output_reversibility: 'reversible', scale, ...(decisionType ? { decision_type: decisionType } : {}) },
              ],
            }),
          );
         }
        }
      }
    }
  }

  it('TC-PE-1-01: borderline graphs return a byte-identical verdict on 10 runs — same status, tier, track and binding constraint', () => {
    const tiersSeen = new Set<string>();
    for (const g of BORDERLINE) {
      const runs = Array.from({ length: 10 }, () => evaluate(g, policy, packs));
      const first = JSON.stringify(runs[0]);
      for (const r of runs) expect(JSON.stringify(r)).toBe(first);
      const head = runs[0]!;
      if (head.ok) {
        tiersSeen.add(head.value.tier);
        for (const r of runs) {
          if (!r.ok) throw new Error('unexpected engine error');
          expect([r.value.status, r.value.tier, r.value.track, r.value.binding_constraint]).toEqual([
            head.value.status,
            head.value.tier,
            head.value.track,
            head.value.binding_constraint,
          ]);
        }
      }
    }
    // The grid really does straddle tier boundaries.
    expect(tiersSeen.size).toBeGreaterThanOrEqual(3);
  });

  it('TC-NF-1-01: 20 evaluations of the same pair at 20 different clock times (and with randomness forbidden) are identical, borderline cases included', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('the engine called Math.random');
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    const borderline = [BORDERLINE[0]!, BORDERLINE[37]!, BORDERLINE[164]!, BORDERLINE[191]!, HARD_LINE, CLEAN, graph({ jurisdictions: ['UK', 'EU', 'US'] }, 'credit-decision')];
    for (const g of borderline) {
      const outputs = new Set<string>();
      for (let i = 0; i < 20; i++) {
        // 20 distinct instants across two decades, including a leap day.
        vi.setSystemTime(new Date(Date.UTC(2020 + i, i % 12, 1 + (i % 28), i % 24, i % 60, i % 60, i)));
        outputs.add(JSON.stringify(evaluate(g, policy, packs)));
      }
      expect(outputs.size).toBe(1);
    }
    expect(randomSpy).not.toHaveBeenCalled();
  });
});

describe('PE-2 — track assignment short-circuits at the first matching rule', () => {
  const rule = (id: string, name: string, modelType: string): TrackRule =>
    ({
      id,
      name,
      description: name,
      conditions: [{ field: 'model_type', value: { in: [modelType] } }],
      short_circuit: true,
      regulatory_basis: 'test',
    }) as unknown as TrackRule;

  it('TC-PE-2-03: with ordered rules A→I, B→II, C→III and a graph matching A and C, Track I is assigned and Rule C is never evaluated', () => {
    const g = graph(); // model_type 'ml'
    const ruleA = rule('TRACK-I-A', 'Rule A', 'ml');
    const ruleB = rule('TRACK-II-B', 'Rule B', 'statistical');
    // Rule C also matches the graph — but evaluating it would throw, so a pass
    // proves it was never looked at, not merely out-ranked.
    const ruleC = {
      ...rule('TRACK-III-C', 'Rule C', 'ml'),
      get conditions(): never {
        throw new Error('Rule C was evaluated after Rule A had already matched');
      },
    } as unknown as TrackRule;

    const result = assignTrack(g, [ruleA, ruleB, ruleC]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.track).toBe('I');
    expect(result.value.ruleId).toBe('TRACK-I-A');

    // Order is the only thing that decides it: with C first, C wins.
    const cFirst = assignTrack(g, [rule('TRACK-III-C', 'Rule C', 'ml'), ruleA, ruleB]);
    expect(cFirst.ok && cFirst.value.track).toBe('III');
  });
});

describe('PE-5 — jurisdiction packs apply the Annex III credit-scoring override', () => {
  it('TC-PE-5-02: an EU credit-scoring case fires the EU AI Act Annex III §5(b) rule and is forced to Critical even when the firm\'s own tiering says lower', () => {
    // The shipped firm tiers already put credit decisions at Critical, which
    // would hide the override. Remove the Critical tier rules so the firm's
    // own tiering gives something lower, then show the pack still forces it.
    const lowerFirmTiers: PolicyFile = { ...policy, tiers: policy.tiers.filter((t) => t.name !== 'Critical') };
    const credit = graph({ jurisdictions: ['EU'] }, 'credit-decision');

    const without = run(credit, lowerFirmTiers, []);
    expect(without.tier).not.toBe('Critical');

    const withEu = run(credit, lowerFirmTiers, packs);
    expect(withEu.tier).toBe('Critical');
    const entry = (withEu.explanation.regulatory_chain ?? []).find((c) => c.rule_id === 'EU-AIACT-TIER-01');
    expect(entry, 'the Annex III §5(b) rule did not fire').toBeDefined();
    expect(entry?.document).toBe('EU AI Act');
    expect(entry?.section).toBe('Annex III §5(b)');
    expect(entry?.derived).toMatch(new RegExp(`Tier forced to Critical \\(was ${without.tier}\\)`));
    expect(withEu.applied_overrides.some((o) => o.ruleId === 'EU-AIACT-TIER-01' && /forced to Critical/.test(o.effect))).toBe(true);

    // Without the EU jurisdiction the same case is not forced.
    expect(run(graph({ jurisdictions: ['UK'] }, 'credit-decision'), lowerFirmTiers, packs).tier).not.toBe('Critical');
  });
});

describe('CS-3 — an unapproved third-party vendor triggers a vendor risk assessment', () => {
  it('TC-CS-3-02: one and the same downstream review requires the vendor risk assessment AND names the unapproved vendor', () => {
    const v = run(graph({ processing_nodes: [{ ...graph().processing_nodes[0]!, vendor: 'NeverHeardOfCo' }] }));
    // Not "a review somewhere mentions the name" — the single triggered review
    // carries both the obligation and the vendor it is about.
    const triggered = v.downstream_reviews.filter((r) => /vendor\/platform risk assessment required/i.test(r));
    expect(triggered).toHaveLength(1);
    expect(triggered[0]).toContain('NeverHeardOfCo');
    expect(triggered[0]).toMatch(/not on the approved list/);
    // It is a mandatory step: carried as a structured review source, not prose only.
    expect((v.downstream_review_sources ?? []).some((s) => s.rule_id === 'PV-UNREGISTERED:NeverHeardOfCo')).toBe(true);
  });
});

describe('PV — vendor registry', () => {
  function policyWithVendor(satisfies: string[]): PolicyFile {
    const raw = load(YAML) as Record<string, unknown>;
    raw.platforms = [];
    raw.vendors = [{ id: 'VENDOR-APPROVED-LLM', name: 'Approved LLM vendor', approved_envelope: { max_data_class: 'Client PII' }, satisfies_controls: satisfies }];
    const r = loadPolicy(dump(raw));
    if (!r.valid) throw new Error(JSON.stringify(r.errors));
    return r.policy;
  }

  it('TC-PV-2-01: a vendor absent from the registry inherits no controls and is named in a downstream review, while the registered vendor does inherit', () => {
    const p = policyWithVendor(['CTRL-ENC-01']);
    const withVendor = (vendor: string) => graph({ processing_nodes: [{ ...graph().processing_nodes[0]!, vendor }] });

    const unknown = run(withVendor('VENDOR-UNKNOWN'), p);
    expect(unknown.inheritance?.declared_vendor).toBe('VENDOR-UNKNOWN');
    expect(unknown.inheritance?.inherited_controls ?? []).toEqual([]);
    // The control the registered vendor would have supplied is still owed.
    expect(unknown.controls).toContain('CTRL-ENC-01');
    // Named explicitly, in a downstream review.
    expect(unknown.downstream_reviews.some((r) => r.includes('VENDOR-UNKNOWN'))).toBe(true);
    // Nothing is attributed to the unregistered vendor anywhere in the verdict.
    expect(JSON.stringify(unknown.inheritance)).not.toMatch(/Approved LLM vendor|VENDOR-APPROVED-LLM/);

    // Control: the same use case on the registered vendor does inherit it.
    const known = run(withVendor('VENDOR-APPROVED-LLM'), p);
    expect(known.inheritance?.inherited_controls).toContain('CTRL-ENC-01');
    expect(known.controls).not.toContain('CTRL-ENC-01');
  });

  it('TC-PV-8-01: the shipped starter registry is clearly a template — every entry is marked [FIRM], the file says they are not real approvals, and the worked examples still run', () => {
    const header = YAML.slice(YAML.indexOf('APPROVED PLATFORM REGISTRY'), YAML.indexOf('\nplatforms:'));
    expect(header).toMatch(/\[FIRM\] MUST REPLACE/);
    expect(header).toMatch(/Illustrative entries/);
    expect(header).toMatch(/NOT your firm's approvals/);
    const entries = [...(policy.platforms ?? []), ...(policy.vendors ?? [])];
    expect(entries.length).toBeGreaterThanOrEqual(2);
    // No entry presents itself as a real firm approval: each name carries the
    // placeholder, so it renders as "[FIRM] ..." on a verdict.
    for (const e of entries) expect(e.name, e.id).toMatch(/^\[FIRM\]/);

    // And the starter policy still gives one platform that covers a sample
    // use case (inheritance reduces controls) and one that is exceeded.
    const inside = run(
      graph({
        input_nodes: [{ id: 'i1', label: 'in', data_class: 'Confidential', data_zone: 'Zone C' }],
        processing_nodes: [{ ...graph().processing_nodes[0]!, data_zone: 'Zone C', platform: 'PLAT-INTERNAL-ML' }],
        jurisdictions: ['UK'],
      }),
    );
    expect((inside.inheritance?.inherited_controls ?? []).length).toBeGreaterThan(0);
    const outside = run(
      graph({
        processing_nodes: [{ ...graph().processing_nodes[0]!, platform: 'PLAT-CLOUD-LLM' }],
        jurisdictions: ['UK'],
      }),
    );
    expect(outside.inheritance?.dimensions.some((d) => !d.fits)).toBe(true);
    expect(outside.inheritance?.inherited_controls ?? []).toEqual([]);
  });
});

describe('RA — jurisdiction packs and the audit record', () => {
  it('TC-RA-1-03: a UK + EU + US + Canada use case activates SS1/23, SR 26-2, EU AI Act and DORA, and nothing for Canada', () => {
    const jur = ['UK', 'EU', 'US', 'CA'];
    const active = resolveActivePacks(jur, policy.jurisdictions, packs);
    expect(active.map((p) => p.pack_id)).toEqual(['DORA', 'EU-AIACT', 'SR-26-2', 'SS1-23']);
    // Canada is declared, with no pack file — it contributes no pack.
    expect(policy.jurisdictions.find((j) => j.code === 'CA')?.pack_files).toEqual([]);
    expect(active.some((p) => p.jurisdiction === 'CA')).toBe(false);
    // And through the whole engine: every one of the four is in force on the verdict.
    const v = run(graph({ jurisdictions: jur }), policy, packs);
    expect(Object.keys(v.pack_versions).sort()).toEqual(['DORA', 'EU-AIACT', 'SR-26-2', 'SS1-23']);
    // Not just the first matching jurisdiction's pack.
    expect(Object.keys(v.pack_versions).length).toBe(4);
  });

  it('TC-RA-3-01: every active pack version is recorded on the verdict, and the audit trail keeps them with the evaluation timestamp', async () => {
    const v = run(graph({ jurisdictions: ['UK', 'EU'] }), policy, packs);
    // Versions, not just names: each value is the loaded pack's own version.
    const byId = Object.fromEntries(packs.map((p) => [p.pack_id, p.version]));
    expect(Object.keys(v.pack_versions).sort()).toEqual(['DORA', 'EU-AIACT', 'SS1-23']);
    for (const [id, version] of Object.entries(v.pack_versions)) {
      expect(version.length, id).toBeGreaterThan(0);
      expect(version).toBe(byId[id]);
    }

    const useCaseId = crypto.randomUUID();
    const occurredAt = '2026-10-04T09:30:00.000Z';
    const verdict = { ...v, id: crypto.randomUUID(), use_case_id: useCaseId, living_status: 'approved', living_status_updated_at: occurredAt, attested_by: '1LoD', attested_at: occurredAt, graph_version: 1, corrections: [] } as Verdict;
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: useCaseId,
      event_type: 'verdict_produced',
      occurred_at: occurredAt,
      actor: '1LoD',
      payload: { type: 'verdict_produced', verdict, knowledge_lens_matched_entry_ids: [] },
    });
    const stored = (await getAll(useCaseId)).find((e) => e.event_type === 'verdict_produced');
    expect(stored).toBeDefined();
    if (stored?.payload.type !== 'verdict_produced') throw new Error('unreachable');
    expect(stored.payload.verdict.pack_versions).toEqual(v.pack_versions);
    // The evaluation date: the event carries when it was produced.
    expect(stored.occurred_at).toBe(occurredAt);
  });
});

describe('PE-7 — a policy update does not change verdicts already issued', () => {
  it('TC-PE-7-02: after the policy moves from 1.3 to 1.4 the issued verdict still shows 1.3, is not re-evaluated, and the case is only queued', async () => {
    const policy13: PolicyFile = { ...policy, version: '1.3' };
    const v = run(graph(), policy13);
    expect(v.policy_version).toBe('1.3');

    const nodeId = crypto.randomUUID();
    const node: RegisterNode = {
      node_id: nodeId,
      node_type: 'use_case',
      label: 'Policy 1.3 verdict holder',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: { node_type: 'use_case', submitted_by: '1LoD', lifecycle_stage: 'approved', current_verdict_id: null, tier: v.tier, track: v.track },
    };
    await addNode(node);
    const verdict = { ...v, id: crypto.randomUUID(), use_case_id: nodeId, living_status: 'approved', living_status_updated_at: '2026-01-02T00:00:00.000Z', attested_by: '1LoD', attested_at: '2026-01-02T00:00:00.000Z', graph_version: 1, corrections: [] } as Verdict;
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: nodeId,
      event_type: 'verdict_produced',
      occurred_at: '2026-01-02T00:00:00.000Z',
      actor: '1LoD',
      payload: { type: 'verdict_produced', verdict, knowledge_lens_matched_entry_ids: [] },
    });
    const before = (await getAll(nodeId)).filter((e) => e.event_type === 'verdict_produced');
    expect(before).toHaveLength(1);

    // The policy file is updated to 1.4.
    await onPolicyUpdated('1.4');

    const after = await getAll(nodeId);
    const issued = after.filter((e) => e.event_type === 'verdict_produced');
    // Same single verdict event, byte for byte — not modified, not replaced,
    // no second verdict appended by an automatic re-evaluation.
    expect(issued).toHaveLength(1);
    expect(JSON.stringify(issued[0])).toBe(JSON.stringify(before[0]));
    if (issued[0]?.payload.type !== 'verdict_produced') throw new Error('unreachable');
    expect(issued[0].payload.verdict.policy_version).toBe('1.3');
    // What the update DID do: queue the case, naming the new version.
    const queued = after.filter((e) => e.event_type === 're_evaluation_queued');
    expect(queued).toHaveLength(1);
    expect(queued[0]?.payload).toMatchObject({ type: 're_evaluation_queued', policy_version: '1.4' });
    // The register still reads the verdict from the trail, under 1.3.
    const summary = await getUseCase(nodeId);
    expect(summary?.policy_version_at_evaluation).toBe('1.3');
    expect(summary?.lifecycle_stage).toBe('approved');
  });
});

describe('UC-4 — intake question budget', () => {
  const uncertain = (id: string) =>
    ({ id, label: id, model_type: 'ml', autonomy_level: 1, data_zone: 'Zone A', vendor: 'internal', replaces_prior_model: false, system_access_scope: 'none', multi_instance_coordination: 'no', uncertain: true }) as const;

  // Internal-only document summariser, no client data, L1, Zone A, UK only —
  // with several nodes the extractor was unsure about, so there are far more
  // candidate questions than the budget allows.
  const lowTier = graph({
    jurisdictions: ['UK'],
    input_nodes: [{ id: 'i1', label: 'documents', data_class: 'Internal', data_zone: 'Zone A' }],
    processing_nodes: [uncertain('p1')],
    output_nodes: [
      { id: 'o1', label: 'summary', action_type: 'read', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' },
    ],
    edges: [],
  });

  it('TC-UC-4-01: a Low-tier graph with many open fields is asked no more than 5 questions — and the same fields on a higher tier are asked more, so the cap is what limits it', () => {
    const { budget, provisionalTier } = getQuestionBudget(lowTier, policy);
    expect(provisionalTier).toBe('Low');
    expect(budget).toBe(5);
    const questions = generateQuestions(lowTier, policy, []);
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.length).toBeLessThanOrEqual(5);

    // Control: same open fields, but a client-facing output lifts the tier and
    // the budget — proving more candidates exist than the Low cap lets through.
    const high = graph({
      ...lowTier,
      output_nodes: [{ ...lowTier.output_nodes[0]!, exposure: 'client-facing' }],
    });
    expect(getQuestionBudget(high, policy).provisionalTier).not.toBe('Low');
    expect(generateQuestions(high, policy, []).length).toBeGreaterThan(5);
  });
});

describe('UC-5 — contradictions between description and answers', () => {
  it('a description saying no client data, with an answer that client notes are processed, is flagged with both conflicting statements [TC-UC-5-01]', () => {
    const g = graph({
      input_nodes: [{ id: 'i1', label: 'client relationship notes', data_class: 'Client PII', data_zone: 'Zone B' }],
    });
    const found = detectContradictions('Summarises documents. No client data used.', [], g);
    expect(found).toHaveLength(1);
    // The two specific conflicting statements, in plain words (R16-E §6).
    expect(found[0]).toEqual({
      statement1: 'Your description says no personal information is involved.',
      statement2: 'but your answers say it uses information about people.',
      field: 'data_class',
    });
    // No contradiction when the answer agrees with the description.
    const agree = graph({ input_nodes: [{ id: 'i1', label: 'documents', data_class: 'Internal', data_zone: 'Zone C' }] });
    expect(detectContradictions('Summarises documents. No client data used.', [], agree)).toEqual([]);
  });
});
