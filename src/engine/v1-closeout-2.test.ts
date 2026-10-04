import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load, dump } from 'js-yaml';
import { loadPolicy } from '../store/policy';
import { loadPacks } from '../store/packs';
import {
  addNode,
  addUseCaseModelLink,
  exportAll,
  getBlastRadius,
  getUseCase,
  updateLifecycleStage,
} from '../store/register';
import { append, getAll } from '../store/audit';
import { evaluate } from './evaluate';
import { detectContradictions } from './contradiction';
import { generateQuestions, getQuestionBudget } from './question-generator';
import { buildGraphFromForm } from './build-graph-from-form';
import type { StructuredFormValues } from './build-graph-from-form';
import type { RegisterNode } from '../store/types';
import type { Verdict } from '../types/verdict';
import type { DataFlowGraph, EvaluationResult, JurisdictionPack, PolicyFile, ProcessingNode } from './types';

// gvm-test 007, first-round acceptance close-out, chunk 2. One file for the cases
// whose naming test did not prove the whole Then-clause (the audit of
// test-cases/test-cases.md). Real engine, real store on the suite's fake IndexedDB;
// nothing is mocked. Each test title begins with the id it proves.

const dir = resolve(__dirname, '../../policy');
const POLICY_YAML = readFileSync(resolve(dir, 'appetite.yaml'), 'utf-8');
const PACK_FILES: Record<string, string> = {
  'ss1-23': readFileSync(resolve(dir, 'packs/ss1-23.yaml'), 'utf-8'),
  'sr-26-2': readFileSync(resolve(dir, 'packs/sr-26-2.yaml'), 'utf-8'),
  'eu-ai-act': readFileSync(resolve(dir, 'packs/eu-ai-act.yaml'), 'utf-8'),
  dora: readFileSync(resolve(dir, 'packs/dora.yaml'), 'utf-8'),
};

let policy: PolicyFile;
let packs: JurisdictionPack[];

beforeAll(() => {
  const res = loadPolicy(POLICY_YAML);
  if (!res.valid) throw new Error(`fixture policy invalid: ${JSON.stringify(res.errors)}`);
  policy = res.policy;
  const p = loadPacks(PACK_FILES);
  if (p.errors.length > 0) throw new Error(`fixture packs invalid: ${JSON.stringify(p.errors)}`);
  packs = p.packs;
});

const TS = '2026-01-01T00:00:00.000Z';
const base = { useCaseName: 'x', description: 'x', replacesPriorModel: false } as const;

function form(over: Partial<StructuredFormValues>): DataFlowGraph {
  return buildGraphFromForm(
    {
      ...base,
      inputDataClass: 'Client PII',
      inputDataZone: 'Zone C',
      modelType: 'traditional-ml',
      autonomyLevel: 1,
      processingDataZone: 'Zone C',
      outputActionType: 'recommend',
      outputExposure: 'client-facing',
      decisionBindingness: 'material',
      outputReversibility: 'reversible',
      outputScale: 'at_scale',
      decisionType: 'credit-decision',
      jurisdictions: ['UK'],
      ...over,
    } as StructuredFormValues,
    TS,
    () => crypto.randomUUID(),
  );
}

function run(g: DataFlowGraph, pol: PolicyFile = policy, p: JurisdictionPack[] = packs): EvaluationResult {
  const r = evaluate(g, pol, p);
  if (!r.ok) throw new Error(`engine error: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** Every value in the object graph that is `undefined` or the string "undefined". */
function emptyOrUndefinedPaths(value: unknown, path = '$'): string[] {
  if (value === undefined) return [path];
  if (value === 'undefined') return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => emptyOrUndefinedPaths(v, `${path}[${i}]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => emptyOrUndefinedPaths(v, `${path}.${k}`));
  }
  return [];
}

describe('a pack update is independent of the main policy file', () => {
  const euYaml = (version: string) =>
    PACK_FILES['eu-ai-act']!.replace(/^version: .*$/m, `version: "${version}"`);

  it('TC-CF-4-01: moving the EU pack from 1.1 to 1.2 changes the verdict pack version and leaves the policy file and its version alone', () => {
    const g = form({ jurisdictions: ['EU'] });

    const before = loadPacks({ ...PACK_FILES, 'eu-ai-act': euYaml('1.1') });
    const after = loadPacks({ ...PACK_FILES, 'eu-ai-act': euYaml('1.2') });
    expect(before.errors).toEqual([]);
    expect(after.errors).toEqual([]);

    const verdictBefore = run(g, policy, before.packs);
    const verdictAfter = run(g, policy, after.packs);

    // The new verdict names the new pack version...
    expect(verdictBefore.pack_versions['EU-AIACT']).toBe('1.1');
    expect(verdictAfter.pack_versions['EU-AIACT']).toBe('1.2');
    // ...and the main policy file's version is the same in both: a pack update
    // has no path to it. The policy is parsed from its own file, untouched.
    expect(verdictBefore.policy_version).toBe(policy.version);
    expect(verdictAfter.policy_version).toBe(policy.version);
    const policyAgain = loadPolicy(POLICY_YAML);
    expect(policyAgain.valid && policyAgain.policy.version).toBe(policy.version);
    expect(policyAgain.valid && policyAgain.policy).toEqual(policy);
  });
});

describe('a hostile pack file is rejected on load, never executed', () => {
  it('TC-CF-5-04: a pack carrying a code-execution tag is refused as a parse error naming the pack file and the tag, and nothing from it loads', () => {
    const hostile = [
      'pack_id: "EVIL-PACK"',
      'version: "1.0"',
      "danger: !!python/object/apply:os.system ['echo executed']",
      'rules: []',
    ].join('\n');

    const { packs: loaded, errors } = loadPacks({ 'evil-pack': hostile });

    expect(loaded).toEqual([]);
    expect(errors).toHaveLength(1);
    // The source key is the loader's only identity for a document that does
    // not parse (pack_id cannot be read from YAML that fails to parse).
    expect(errors[0]?.file).toBe('evil-pack');
    expect(errors[0]?.reason).toMatch(/YAML parse error/);
    expect(errors[0]?.reason).toMatch(/python\/object\/apply:os\.system/);
  });

  it('a pack that parses but carries the wrong content type is refused naming its pack id', () => {
    const wrongType = ['pack_id: "WRONG-TYPE"', 'version: "1.0"', 'rules: "not a list of rules"'].join('\n');

    const { packs: loaded, errors } = loadPacks({ 'wrong-type': wrongType });

    expect(loaded).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.packId).toBe('WRONG-TYPE');
    expect(errors[0]?.reason).toMatch(/WRONG-TYPE rejected/);
  });
});

describe('lifecycle stage changes are ordered and recorded with who and when', () => {
  function useCaseNode(nodeId: string): RegisterNode {
    return {
      node_id: nodeId,
      node_type: 'use_case',
      label: 'Lifecycle order probe',
      created_at: new Date().toISOString(),
      metadata: {
        node_type: 'use_case',
        submitted_by: 'James',
        lifecycle_stage: 'idea',
        current_verdict_id: null,
        tier: null,
        track: null,
      },
    };
  }

  it('TC-LC-1-01: Idea -> Exploring -> Pre-checked is recorded in that order, each with actor and a timestamp, and never skips to Approved', async () => {
    const nodeId = crypto.randomUUID();
    await addNode(useCaseNode(nodeId));
    expect((await getUseCase(nodeId))?.lifecycle_stage).toBe('idea');

    await updateLifecycleStage(nodeId, 'exploring', 'James');
    await updateLifecycleStage(nodeId, 'pre_checked', 'James');

    expect((await getUseCase(nodeId))?.lifecycle_stage).toBe('pre_checked');

    const moves = (await getAll(nodeId)).filter((e) => e.event_type === 'lifecycle_stage_changed');
    expect(moves.map((e) => e.payload)).toEqual([
      { type: 'lifecycle_stage_changed', from_stage: 'idea', to_stage: 'exploring' },
      { type: 'lifecycle_stage_changed', from_stage: 'exploring', to_stage: 'pre_checked' },
    ]);
    for (const e of moves) {
      expect(e.actor).toBe('James');
      expect(Number.isNaN(Date.parse(e.occurred_at))).toBe(false);
    }
    // Strictly increasing timestamps: the order of the trail is the order of the moves.
    expect(Date.parse(moves[1]!.occurred_at)).toBeGreaterThan(Date.parse(moves[0]!.occurred_at));
    // No move on the trail jumped straight from Idea to Approved.
    expect(moves.some((e) => e.payload.type === 'lifecycle_stage_changed' && e.payload.to_stage === 'approved')).toBe(false);
  });
});

describe('a valid confirmed graph yields a complete verdict', () => {
  it('TC-PE-1-02: the internal HR FAQ chatbot verdict has status, tier and track populated and nothing undefined', () => {
    const v = run(
      form({
        inputDataClass: 'Internal',
        modelType: 'llm',
        autonomyLevel: 1,
        outputActionType: 'inform',
        outputExposure: 'internal-only',
        decisionBindingness: 'non-binding',
        outputScale: 'limited',
        decisionType: undefined,
        jurisdictions: ['UK'],
      }),
    );

    expect(['approved', 'approved_with_controls', 'rejected']).toContain(v.status);
    expect(['Critical', 'High', 'Medium', 'Low']).toContain(v.tier);
    expect(['I', 'II', 'III']).toContain(v.track);
    // Fixed, not just non-empty: this is what the shipped policy says about it.
    expect(v.status).toBe('approved');
    expect(v.tier).toBe('Low');
    // Nothing tripped, so there is no binding constraint to name: the field is
    // an empty string BY DESIGN (it must not leak the track rule id) — see the
    // case's amendment. Every other field is populated, and none is undefined.
    expect(v.binding_constraint).toBe('');
    expect(emptyOrUndefinedPaths(v)).toEqual([]);

    // With something tripped the binding constraint is populated: the same
    // chatbot drafting rather than answering trips the citation invariant.
    const tripped = run(
      form({
        inputDataClass: 'Internal',
        modelType: 'llm',
        outputActionType: 'read',
        outputExposure: 'internal-only',
        decisionBindingness: 'non-binding',
        outputScale: 'limited',
        decisionType: undefined,
        jurisdictions: ['UK'],
      }),
    );
    expect(tripped.binding_constraint).toBe('INV-CITE-01');
    expect(emptyOrUndefinedPaths(tripped)).toEqual([]);
  });
});

describe('a credit-scoring use case with EU borrowers is Critical whatever its complexity', () => {
  it('TC-PE-3-01: a low-complexity EU credit decision is Critical, and Annex III 5(b) is named as the reason', () => {
    // As little complexity as the form allows: statistical model, no autonomy,
    // internal-only, advisory, reversible, limited scale.
    const g = form({
      modelType: 'statistical',
      autonomyLevel: 0,
      outputActionType: 'read',
      outputExposure: 'internal-only',
      decisionBindingness: 'advisory',
      outputScale: 'limited',
      jurisdictions: ['EU'],
    });
    const v = run(g);

    expect(v.tier).toBe('Critical');
    expect(['High', 'Medium', 'Low']).not.toContain(v.tier);
    // The firm's own tier rule names the provision it rests on...
    expect(v.explanation.tier_rationale?.rule_id).toBe('TIER-CRITICAL');
    expect(v.explanation.tier_rationale?.matched_field).toBe('decision_type');
    expect(v.explanation.tier_rationale?.regulatory_basis).toContain('Annex III §5(b)');
    // ...and the EU pack's own rule for the same provision fires and is cited.
    const chain = v.explanation.regulatory_chain ?? [];
    expect(chain.some((c) => c.rule_id === 'EU-AIACT-TIER-01' && c.section === 'Annex III §5(b)')).toBe(true);

    // Without the credit decision the same low-complexity case is not Critical,
    // so the decision type is what forced it.
    const notCredit = run(
      form({
        modelType: 'statistical',
        autonomyLevel: 0,
        outputActionType: 'read',
        outputExposure: 'internal-only',
        decisionBindingness: 'advisory',
        outputScale: 'limited',
        decisionType: undefined,
        jurisdictions: ['EU'],
      }),
    );
    expect(notCredit.tier).not.toBe('Critical');
  });
});

describe('MNPI reaching a model outside the controlled zone is rejected on the hard line', () => {
  it('TC-PE-4-02: the verdict is rejected, names the data-zone hard line, its reason and the MNPI path, and offers no controls', () => {
    const g: DataFlowGraph = {
      id: 'g-mnpi',
      version: 1,
      input_nodes: [{ id: 'i1', label: 'client_email_data', data_class: 'MNPI', data_zone: 'Zone A' }],
      processing_nodes: [
        {
          id: 'p1',
          label: 'external_model_zone_a',
          model_type: 'llm',
          autonomy_level: 1,
          data_zone: 'Zone A',
          vendor: 'third-party',
          replaces_prior_model: false,
        },
      ],
      output_nodes: [
        {
          id: 'o1',
          label: 'summary',
          action_type: 'draft',
          exposure: 'internal-only',
          decision_bindingness: 'advisory',
          output_reversibility: 'reversible',
          scale: 'limited',
        },
      ],
      edges: [
        { from: 'i1', to: 'p1' },
        { from: 'p1', to: 'o1' },
      ],
      jurisdictions: ['UK'],
      intake_method: 'structured_form',
      extracted_at: TS,
    };
    const v = run(g);

    expect(v.status).toBe('rejected');
    expect(v.binding_constraint).toBe('HL-002');
    // The rule that prohibits it, in words, and the path that tripped it.
    expect(v.explanation.binding_reason).toBe('MNPI outside Zone C violates market abuse prevention requirements.');
    expect(v.explanation.binding_regulatory_basis).toBe('MAR Article 8; MiFID II');
    expect(v.binding_path).toContain('client_email_data');
    expect(v.binding_path).toContain('external_model_zone_a');
    // No control set is offered: a hard line is not something controls resolve.
    expect(v.controls).toEqual([]);
  });
});

describe('the most demanding standard governs by supplementing obligations', () => {
  it('TC-PE-6-01: a UK + US use case lists both packs as active, keeps the track, and drops no pack obligation', () => {
    // LLM with a material decision trips one required review in each pack:
    // SS1-UK-REV-01 (decision bindingness) and SR262-US-REV-01 (model type).
    const g = form({ modelType: 'llm', jurisdictions: ['UK', 'US'] });
    const withPacks = run(g, policy, packs);
    const noPacks = run(g, policy, []);

    // Both packs are active, by id and version.
    expect(Object.keys(withPacks.pack_versions)).toEqual(expect.arrayContaining(['SR-26-2', 'SS1-23']));
    // Both packs' rules fired.
    const fired = withPacks.applied_overrides.map((o) => o.ruleId);
    expect(fired).toEqual(expect.arrayContaining(['SS1-UK-REV-01', 'SR262-US-REV-01']));

    // The track is the firm's own, unchanged by either pack.
    expect(withPacks.track).toBe(noPacks.track);
    // The tier is never lowered by a pack.
    const rank = { Low: 0, Medium: 1, High: 2, Critical: 3 } as const;
    expect(rank[withPacks.tier]).toBeGreaterThanOrEqual(rank[noPacks.tier]);

    // Union, never intersection: everything the firm already required survives,
    // and every review/control a pack added is on the verdict.
    for (const c of noPacks.controls) expect(withPacks.controls).toContain(c);
    for (const r of noPacks.downstream_reviews) expect(withPacks.downstream_reviews).toContain(r);
    for (const o of withPacks.applied_overrides) {
      const review = /Added downstream review "(.+)"\./.exec(o.effect)?.[1];
      if (review) expect(withPacks.downstream_reviews).toContain(review);
      const control = /Added required control (\S+?)\./.exec(o.effect)?.[1];
      if (control) expect(withPacks.controls).toContain(control);
    }
    // And the verdict carries a review that came from each pack.
    expect(withPacks.downstream_review_sources?.map((s) => s.rule_id)).toEqual(
      expect.arrayContaining(['SS1-UK-REV-01', 'SR262-US-REV-01']),
    );
  });
});

describe('the unmodified starter policy produces a complete verdict', () => {
  it('TC-PE-8-01: the shipped policy still carries its [FIRM] placeholders and an HR FAQ chatbot evaluates cleanly against it', () => {
    // "Unmodified starter": the file's own placeholders are still there.
    expect(policy.firm_name).toBe('[FIRM]');
    expect(policy.translation_attestation.attested_by).toContain('[FIRM]');

    const r = evaluate(
      form({
        inputDataClass: 'Internal',
        modelType: 'llm',
        outputActionType: 'inform',
        outputExposure: 'internal-only',
        decisionBindingness: 'non-binding',
        outputScale: 'limited',
        decisionType: undefined,
      }),
      policy,
      packs,
    );

    // No engine error about missing fields or placeholders...
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // ...and a complete verdict: status, tier, track present and valid.
    expect(['approved', 'approved_with_controls', 'rejected']).toContain(r.value.status);
    expect(r.value.tier).toBe('Low');
    expect(r.value.track).toBe('III');
    expect(emptyOrUndefinedPaths(r.value)).toEqual([]);
  });
});

describe('declaring no platform changes nothing', () => {
  const PLATFORM = {
    id: 'PLAT-INTERNAL-01',
    name: 'Internal model platform',
    approved_envelope: {
      max_data_class: 'Internal',
      max_exposure: 'internal-shared',
      max_autonomy_level: 2,
      data_zones: ['Zone B', 'Zone C'],
      jurisdictions: ['UK', 'EU'],
    },
    satisfies_controls: ['CTRL-FINGERPRINT-01'],
  };

  it('TC-PV-A-01: the same graph gives a byte-identical verdict with and without a platform registry, and no inheritance block either way', () => {
    const raw = load(POLICY_YAML) as Record<string, unknown>;
    raw.platforms = [PLATFORM];
    const withReg = loadPolicy(dump(raw));
    if (!withReg.valid) throw new Error(`registry policy invalid: ${JSON.stringify(withReg.errors)}`);
    expect(withReg.policy.platforms?.length).toBeGreaterThan(0);
    expect(policy.platforms?.some((p) => p.id === 'PLAT-INTERNAL-01')).toBeFalsy();

    // Trips INV-TRACK2-01 (ml + advisory) — the control the platform WOULD
    // satisfy — but declares no platform, so nothing may be inherited.
    const g = form({
      inputDataClass: 'Internal',
      modelType: 'ml',
      outputActionType: 'recommend',
      outputExposure: 'internal-shared',
      decisionBindingness: 'advisory',
      outputScale: 'limited',
      decisionType: undefined,
      jurisdictions: [],
    });
    const plain = run(g, policy, []);
    const registry = run(g, withReg.policy, []);

    expect(plain.controls).toContain('CTRL-FINGERPRINT-01');
    expect(JSON.stringify(registry)).toBe(JSON.stringify(plain));
    // No inheritance block at all: absent, not a record saying nothing was inherited.
    expect('inheritance' in plain).toBe(false);
    expect('inheritance' in registry).toBe(false);
    expect(JSON.stringify(registry)).not.toContain('inherit');
  });
});

describe('a shared component is one node referenced by every use case that declares it', () => {
  function useCaseNode(nodeId: string, label: string): RegisterNode {
    return {
      node_id: nodeId,
      node_type: 'use_case',
      label,
      created_at: new Date().toISOString(),
      metadata: {
        node_type: 'use_case',
        submitted_by: 'tester',
        lifecycle_stage: 'idea',
        current_verdict_id: null,
        tier: null,
        track: null,
      },
    };
  }

  it('TC-RG-1-01: three use cases declaring the same model leave ONE ai_model node and three edges into it', async () => {
    const modelId = `azure-openai-internal-${crypto.randomUUID()}`;
    const pol: PolicyFile = {
      ...policy,
      approved_models: [{ model_id: modelId, vendor: 'Azure OpenAI', provenance_class: 'vendor_hosted', is_approved: true }],
    };
    const processing = (): ProcessingNode => ({
      id: crypto.randomUUID(),
      label: 'x',
      model_type: 'llm',
      autonomy_level: 1,
      data_zone: 'Zone C',
      vendor: 'Azure OpenAI',
      replaces_prior_model: false,
      declared_model_id: modelId,
    });

    const useCaseIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [i, id] of useCaseIds.entries()) {
      await addNode(useCaseNode(id, `Sharer ${i}`));
      await addUseCaseModelLink(id, processing(), pol);
    }

    const { nodes, edges } = await exportAll();
    const shared = nodes.filter((n) => n.node_type === 'ai_model' && n.label === modelId);
    expect(shared).toHaveLength(1);
    const sharedId = shared[0]!.node_id;

    // Three edges, one per use case, all pointing at the SAME node.
    const into = edges.filter((e) => e.to_node_id === sharedId);
    expect(into).toHaveLength(3);
    expect(into.map((e) => e.from_node_id).sort()).toEqual([...useCaseIds].sort());
    // And no second copy of the component exists under any other id.
    expect(nodes.filter((n) => n.node_type === 'ai_model' && n.node_id !== sharedId && n.label === modelId)).toEqual([]);
    // The blast radius of the one node is exactly the three use cases.
    const radius = await getBlastRadius(sharedId);
    expect(radius.map((n) => n.node_id).sort()).toEqual([...useCaseIds].sort());
  });
});

describe('a Critical-tier use case is asked no more than 15 questions', () => {
  function creditScoringGraph(): DataFlowGraph {
    return {
      id: 'g-credit',
      version: 1,
      input_nodes: [{ id: 'i1', label: 'applicant data', data_class: 'Client PII', data_zone: 'Zone A' }],
      processing_nodes: [
        {
          id: 'p1',
          label: 'credit scoring model',
          model_type: 'traditional-ml',
          autonomy_level: 3,
          data_zone: 'Zone A',
          vendor: 'third-party',
          replaces_prior_model: false,
          uncertain: true,
        },
      ],
      output_nodes: [
        {
          id: 'o1',
          label: 'credit score',
          action_type: 'approve',
          exposure: 'client-facing',
          decision_bindingness: 'binding',
          output_reversibility: 'reversible',
          scale: 'at_scale',
          decision_type: 'credit-decision',
        },
      ],
      edges: [
        { from: 'i1', to: 'p1' },
        { from: 'p1', to: 'o1' },
      ],
      jurisdictions: ['UK', 'EU'],
      intake_method: 'llm',
      extracted_at: TS,
    };
  }

  it('TC-UC-4-02: the credit-scoring graph is Critical with a budget of 15, and gets between 3 and 15 distinct questions', () => {
    const g = creditScoringGraph();
    const { budget, provisionalTier } = getQuestionBudget(g, policy);
    expect(provisionalTier).toBe('Critical');
    expect(budget).toBe(15);

    const questions = generateQuestions(g, policy, packs);
    expect(questions.length).toBeGreaterThanOrEqual(3);
    expect(questions.length).toBeLessThanOrEqual(15);
    // Distinct questions, not one question repeated.
    expect(new Set(questions.map((q) => q.field)).size).toBe(questions.length);
  });

  it('the budget is enforced by trimming, not just by there happening to be few candidates', () => {
    // A Low-tier graph (budget 5) with an uncertain node on every question
    // field: more candidates than the budget, so the cap is what limits it.
    const g = creditScoringGraph();
    g.output_nodes = [
      {
        id: 'o1',
        label: 'read-out',
        action_type: 'read',
        exposure: 'internal-only',
        decision_bindingness: 'non-binding',
        output_reversibility: 'reversible',
        scale: 'limited',
      },
    ];
    g.input_nodes = [{ id: 'i1', label: 'notes', data_class: 'Internal', data_zone: 'Zone C' }];
    g.processing_nodes = [
      { ...g.processing_nodes[0]!, model_type: 'statistical', autonomy_level: 0, data_zone: 'Zone C', vendor: 'internal' },
    ];
    g.jurisdictions = [];
    const { budget } = getQuestionBudget(g, policy);
    expect(budget).toBeLessThan(15);

    const widePolicy: PolicyFile = {
      ...policy,
      invariants: [
        ...policy.invariants,
        ...['model_type', 'autonomy_level', 'data_zone', 'vendor', 'replaces_prior_model', 'label', 'id'].map(
          (field, i) => ({
            ...policy.invariants[0]!,
            id: `INV-WIDE-${i}`,
            condition: { [field]: { in: ['x'] } },
          }),
        ),
      ],
    };
    const questions = generateQuestions(g, widePolicy, packs);
    expect(questions.length).toBe(budget);
  });
});

describe('consistent answers are not flagged as a contradiction', () => {
  it('TC-UC-5-02: a description that does reach the denial patterns, with a graph that agrees, flags nothing', () => {
    // The old case passed a description that matched no pattern at all, so it
    // could not fail. These DO match the two patterns, against a graph that is
    // consistent with them — the only way a false flag could appear.
    const noClientData: DataFlowGraph = {
      id: 'g1',
      version: 1,
      input_nodes: [{ id: 'i1', label: 'internal transaction records', data_class: 'Internal', data_zone: 'Zone C' }],
      processing_nodes: [
        { id: 'p1', label: 'm', model_type: 'ml', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [],
      edges: [],
      jurisdictions: [],
      intake_method: 'llm',
      extracted_at: TS,
    };
    const answers = [{ questionId: 'q1', value: 'yes' }] as never;

    expect(detectContradictions('This tool processes no client data, only internal transaction data.', answers, noClientData)).toEqual([]);
    expect(detectContradictions('A human approves every action it takes.', answers, noClientData)).toEqual([]);

    // Control: the same description DOES flag when the graph disagrees, so the
    // empty results above are real and not a detector that never fires.
    const clientData: DataFlowGraph = {
      ...noClientData,
      input_nodes: [{ id: 'i1', label: 'notes', data_class: 'Client PII', data_zone: 'Zone C' }],
    };
    expect(detectContradictions('This tool processes no client data, only internal transaction data.', answers, clientData)).toHaveLength(1);
  });
});

describe('policy and every active pack version are recorded in the verdict and on the trail', () => {
  it('TC-VD-5-01: a verdict under policy X with SS1-23 2.0 and EU-AIACT 1.1 carries them, and they survive onto the audit trail', async () => {
    const withVersion = (yaml: string, version: string) => yaml.replace(/^version: .*$/m, `version: "${version}"`);
    const set = loadPacks({
      ...PACK_FILES,
      'ss1-23': withVersion(PACK_FILES['ss1-23']!, '2.0'),
      'eu-ai-act': withVersion(PACK_FILES['eu-ai-act']!, '1.1'),
    });
    expect(set.errors).toEqual([]);

    // UK and EU together: both packs are in force.
    const result = run(form({ jurisdictions: ['UK', 'EU'] }), policy, set.packs);
    expect(result.policy_version).toBe(policy.version);
    expect(result.policy_version).not.toBe('');
    expect(result.pack_versions['SS1-23']).toBe('2.0');
    expect(result.pack_versions['EU-AIACT']).toBe('1.1');

    // Saved to the audit trail: the persisted record holds the same fields.
    const useCaseId = crypto.randomUUID();
    const verdict: Verdict = {
      ...result,
      id: crypto.randomUUID(),
      use_case_id: useCaseId,
      living_status: 'approved',
      living_status_updated_at: TS,
      attested_by: '1LoD',
      attested_at: TS,
      graph_version: 1,
      corrections: [],
    };
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: useCaseId,
      event_type: 'verdict_produced',
      occurred_at: new Date().toISOString(),
      actor: '1LoD',
      payload: { type: 'verdict_produced', verdict },
    });
    const saved = (await getAll(useCaseId)).find((e) => e.payload.type === 'verdict_produced');
    expect(saved?.payload.type === 'verdict_produced' && saved.payload.verdict.policy_version).toBe(policy.version);
    expect(saved?.payload.type === 'verdict_produced' && saved.payload.verdict.pack_versions).toEqual(result.pack_versions);
    // Packs omitted would be the failure: confirm the map is not just the policy.
    expect(Object.keys(result.pack_versions).length).toBeGreaterThanOrEqual(2);
  });
});
