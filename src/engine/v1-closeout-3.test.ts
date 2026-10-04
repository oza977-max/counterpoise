import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dump, load } from 'js-yaml';
import { loadPolicy } from '../store/policy';
import { loadPacks } from '../store/packs';
import { getPackSources } from '../store/pack-source';
import { addNode, exportAll, updateLifecycleStage } from '../store/register';
import { append, getAll } from '../store/audit';
import { exportBundle } from '../store/handoff';
import { evaluate } from './evaluate';
import { assignTier } from './tier';
import { resolveActivePacks } from './jurisdiction';
import { solvControls } from './greedy-solver';
import { generateQuestions, getQuestionBudget } from './question-generator';
import type { Control, DataFlowGraph, Envelope, PolicyFile } from './types';

// gvm-test 007 close-out, chunk 3 — engine and store cases. Real engine, real
// shipped policy and packs, real store on the suite's fake IndexedDB. Each test
// title starts with the case id it proves; ids that used to sit on a test that
// did not prove the whole case were moved here (and removed from the old title).

const YAML_PATH = resolve(__dirname, '../../policy/appetite.yaml');
let policy: PolicyFile;

beforeAll(() => {
  const result = loadPolicy(readFileSync(YAML_PATH, 'utf-8'));
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

function control(id: string, resolves: string[], burden: Control['burden']): Control {
  return { id, name: id, description: '', verification: '', resolves, burden };
}

describe('TC-CS-1-01 / TC-CS-2-01 — the control solver on the case scenarios', () => {
  it('TC-CS-1-01: two tripped invariants get the two least burdensome controls, and nothing extra', () => {
    const library = [
      control('C-ENC-1', ['I-DATA-3'], 1),
      control('C-ENC-2', ['I-DATA-3'], 3),
      control('C-ZONE-2', ['I-ZONE-1'], 2),
    ];
    const result = solvControls(['I-DATA-3', 'I-ZONE-1'], library, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.controls].sort()).toEqual(['C-ENC-1', 'C-ZONE-2']);
    expect(result.controls).not.toContain('C-ENC-2');
    // Minimal: every chosen control is the only one covering something tripped.
    for (const dropped of result.controls) {
      const rest = result.controls.filter((c) => c !== dropped);
      const stillCovered = ['I-DATA-3', 'I-ZONE-1'].every((inv) =>
        rest.some((id) => library.find((c) => c.id === id)!.resolves.includes(inv)),
      );
      expect(stillCovered).toBe(false);
    }
  });

  it('TC-CS-2-01: a hard-line combination is rejected with the rule named and no control set offered', () => {
    const g = graph({
      processing_nodes: [
        { id: 'p1', label: 'agent', model_type: 'agentic', autonomy_level: 4, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'client message', action_type: 'execute', exposure: 'client-facing', decision_bindingness: 'binding', output_reversibility: 'irreversible', scale: 'limited' },
      ],
    });
    const r = evaluate(g, policy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hardLine = policy.hard_lines.find((h) => h.id === 'HL-001')!;
    expect(r.value.status).toBe('rejected');
    expect(r.value.binding_constraint).toBe('HL-001');
    // The specific rule is named, with the reason it cannot be fixed.
    expect(r.value.explanation.binding_reason).toBe(hardLine.reason);
    expect(r.value.explanation.binding_regulatory_basis).toBe(hardLine.regulatory_basis);
    // No partial control set, nothing evaluated after the hard line.
    expect(r.value.controls).toEqual([]);
    expect(r.value.explanation.tripped_invariants).toEqual([]);
  });

  it('a second route to the same rejection: an invariant no control resolves rejects the case with NO partial control set', () => {
    // Client PII in Zone B on an ml advisory model trips INV-DATA-01 (resolvable)
    // and INV-TRACK2-01. Remove every control that resolves INV-TRACK2-01 so one
    // tripped invariant has no route back into appetite.
    const g = graph({
      input_nodes: [{ id: 'i1', label: 'client notes', data_class: 'Client PII', data_zone: 'Zone B' }],
      processing_nodes: [
        { id: 'p1', label: 'model', model_type: 'ml', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'out', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
      ],
      edges: [{ from: 'i1', to: 'p1' }, { from: 'p1', to: 'o1' }],
    });
    const before = evaluate(g, policy);
    expect(before.ok && before.value.controls.length).toBeGreaterThan(1);
    expect(before.ok && before.value.explanation.tripped_invariants.map((t) => t.id)).toContain('INV-TRACK2-01');

    const crippled: PolicyFile = {
      ...policy,
      controls: policy.controls.filter((c) => !c.resolves.includes('INV-TRACK2-01')),
    };
    const r = evaluate(g, crippled);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('rejected');
    expect(r.value.binding_constraint).toBe('INV-TRACK2-01');
    // INV-DATA-01 IS resolvable, yet no control is proposed for it: a partial
    // set would read as "do these and you are fine".
    expect(r.value.controls).toEqual([]);
  });
});

describe('TC-LC-1-02 — a stage transition records previous stage, new stage, actor and timestamp', () => {
  it('TC-LC-1-02: Pre-checked to Approved by 2LoD is recorded with from, to, actor identity and an ISO timestamp', async () => {
    const nodeId = crypto.randomUUID();
    await addNode({
      node_id: nodeId,
      node_type: 'use_case',
      label: 'Transition record probe',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: {
        node_type: 'use_case',
        submitted_by: '1LoD',
        lifecycle_stage: 'pre_checked',
        current_verdict_id: null,
        tier: 'High',
        track: 'II',
      },
    });

    await updateLifecycleStage(nodeId, 'approved', '2LoD');

    const events = (await getAll(nodeId)).filter((e) => e.payload.type === 'lifecycle_stage_changed');
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.payload).toEqual({ type: 'lifecycle_stage_changed', from_stage: 'pre_checked', to_stage: 'approved' });
    expect(event.actor).toBe('2LoD');
    // A real timestamp: parses, and round-trips as the ISO 8601 form.
    expect(Number.isNaN(Date.parse(event.occurred_at))).toBe(false);
    expect(new Date(event.occurred_at).toISOString()).toBe(event.occurred_at);
  });
});

describe('TC-NF-11-01 — the API key cannot reach any export', () => {
  it('TC-NF-11-01: neither the register export nor the audit-trail hand-off bundle contains the key or an apiKey-style field', async () => {
    const key = 'sk-ant-TESTKEY-do-not-export-me-6f3a91';
    localStorage.setItem('aigate:api-key', key);
    localStorage.setItem('apiKey', key);
    localStorage.setItem('api_key', key);

    const nodeId = crypto.randomUUID();
    await addNode({
      node_id: nodeId,
      node_type: 'use_case',
      label: 'Export probe',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: {
        node_type: 'use_case',
        submitted_by: '1LoD',
        lifecycle_stage: 'pre_checked',
        current_verdict_id: null,
        tier: 'High',
        track: 'II',
      },
    });
    // The audit trail has content too: the bundle carries it.
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: nodeId,
      event_type: 'use_case_created',
      occurred_at: '2026-01-01T00:00:00.000Z',
      actor: '1LoD',
      payload: { type: 'use_case_created', description: 'Export probe', intake_method: 'structured_form' },
    });

    const registerJson = JSON.stringify(await exportAll());
    const bundleJson = JSON.stringify(await exportBundle('test'));
    // The bundle really does contain the trail (so the check below is not vacuous).
    expect(bundleJson).toContain('Export probe');
    expect(bundleJson).toContain(nodeId);

    for (const exported of [registerJson, bundleJson]) {
      expect(exported).not.toContain(key);
      expect(exported).not.toContain('sk-ant');
      expect(exported.toLowerCase()).not.toContain('apikey');
      expect(exported.toLowerCase()).not.toContain('api_key');
      expect(exported.toLowerCase()).not.toContain('api-key');
    }
  });
});

describe('TC-PE-3-02 — impact dominance, over the real tier rules', () => {
  it('TC-PE-3-02: a single high-impact trigger is Critical or High whatever the weaker signals around it say', () => {
    // Each case carries exactly ONE high-impact trigger, set beside signals that
    // on their own would give Medium or Low (internal-only exposure, a material
    // but not binding decision, autonomy 2, a small and reversible output).
    const singleTriggers = [
      { name: 'client-facing', exposure: 'client-facing' as const, decision_type: undefined },
      { name: 'credit decision', exposure: 'internal-only' as const, decision_type: 'credit-decision' as const },
      { name: 'pricing decision', exposure: 'internal-shared' as const, decision_type: 'pricing' as const },
    ];
    const modelTypes = ['statistical', 'ml', 'llm', 'generative-ai'] as const;
    const bindingness = ['non-binding', 'advisory', 'material'] as const;
    const reversibility = ['reversible', 'irreversible'] as const;
    const scales = ['limited', 'at_scale'] as const;
    let checked = 0;
    const weaker: string[] = [];
    for (const trig of singleTriggers) {
      for (const model_type of modelTypes) {
        for (const decision_bindingness of bindingness) {
          for (const output_reversibility of reversibility) {
            for (const scale of scales) {
              for (const autonomy_level of [0, 1, 2] as const) {
                const g = graph({
                  processing_nodes: [
                    { id: 'p1', label: 'm', model_type, autonomy_level, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
                  ],
                  output_nodes: [
                    {
                      id: 'o1', label: 'o', action_type: 'recommend', exposure: trig.exposure, decision_bindingness,
                      output_reversibility, scale, ...(trig.decision_type ? { decision_type: trig.decision_type } : {}),
                    },
                  ],
                });
                const tier = assignTier(g, policy.tiers).tier;
                checked += 1;
                if (tier !== 'Critical' && tier !== 'High') {
                  weaker.push(`${trig.name}/${model_type}/${decision_bindingness}/${output_reversibility}/${scale}/${autonomy_level} -> ${tier}`);
                }
              }
            }
          }
        }
      }
    }
    expect(checked).toBe(3 * 4 * 3 * 2 * 2 * 3);
    expect(weaker).toEqual([]);
  });

  it('guard for the sweep above: the same graph without the high-impact trigger does reach Low, so the sweep can go red', () => {
    const g = graph({
      processing_nodes: [
        { id: 'p1', label: 'm', model_type: 'statistical', autonomy_level: 0, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'o', action_type: 'read', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
    expect(assignTier(g, policy.tiers).tier).toBe('Low');
  });
});

describe('TC-PE-8-02 — the starter configuration and its jurisdiction packs', () => {
  it('TC-PE-8-02: the four authored packs load; CA, SG and JP are declared with no pack file, so none activates for them', () => {
    const { packs, errors } = loadPacks(getPackSources());
    expect(errors).toEqual([]);
    expect(packs.map((p) => p.pack_id)).toEqual(['DORA', 'EU-AIACT', 'SR-26-2', 'SS1-23']);

    const declared = policy.jurisdictions.map((j) => j.code).sort();
    expect(declared).toEqual(['CA', 'EU', 'JP', 'SG', 'UK', 'US']);
    for (const code of ['CA', 'SG', 'JP']) {
      expect(policy.jurisdictions.find((j) => j.code === code)?.pack_files).toEqual([]);
      expect(resolveActivePacks([code], policy.jurisdictions, packs)).toEqual([]);
    }
    // The three with packs do activate.
    expect(resolveActivePacks(['UK'], policy.jurisdictions, packs).length).toBeGreaterThan(0);
    expect(resolveActivePacks(['US'], policy.jurisdictions, packs).length).toBeGreaterThan(0);
    expect(resolveActivePacks(['EU'], policy.jurisdictions, packs).length).toBeGreaterThan(0);
  });
});

// A platform whose envelope the Client PII use case exceeds, and which claims
// to satisfy the very control the use case needs.
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
  satisfies_controls: ['CTRL-ENC-01', 'CTRL-FINGERPRINT-01'],
};

function policyWithPlatform(envelope: Envelope): PolicyFile {
  const raw = load(readFileSync(YAML_PATH, 'utf-8')) as Record<string, unknown>;
  raw.platforms = [{ ...PLATFORM, approved_envelope: envelope }];
  const r = loadPolicy(dump(raw));
  if (!r.valid) throw new Error(`registry policy invalid: ${JSON.stringify(r.errors)}`);
  return r.policy;
}

function platformGraph(dataClass: 'Internal' | 'Client PII'): DataFlowGraph {
  return graph({
    input_nodes: [{ id: 'i1', label: 'in', data_class: dataClass, data_zone: 'Zone C' }],
    processing_nodes: [
      { id: 'p1', label: 'model', model_type: 'ml', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false, platform: 'PLAT-INTERNAL-01' },
    ],
    output_nodes: [
      { id: 'o1', label: 'out', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
    ],
    edges: [{ from: 'i1', to: 'p1' }, { from: 'p1', to: 'o1' }],
  });
}

describe('PV-3 / PV-6 — withdrawal and the recorded chain', () => {
  it('TC-PV-3-02: exceeding the data-class dimension withdraws the platform clearance, so the encryption control is required directly', () => {
    const withinCeiling = policyWithPlatform({ ...PLATFORM.approved_envelope, max_data_class: 'Client PII' } as Envelope);
    const exceeded = policyWithPlatform(PLATFORM.approved_envelope as Envelope);
    const g = platformGraph('Client PII');

    // Control: when the platform IS cleared for Client PII it covers the control...
    const covered = evaluate(g, withinCeiling);
    if (!covered.ok) throw new Error('evaluation failed');
    expect(covered.value.inheritance?.inherited_controls).toContain('CTRL-ENC-01');
    expect(covered.value.controls).not.toContain('CTRL-ENC-01');

    // ...and when it is not, the same use case is assessed directly.
    const r = evaluate(g, exceeded);
    if (!r.ok) throw new Error('evaluation failed');
    const dataDim = r.value.inheritance?.dimensions.find((d) => d.dimension === 'data_class');
    expect(dataDim?.fits).toBe(false);
    expect(r.value.controls).toContain('CTRL-ENC-01');
    // No claim that the platform covered what it was not cleared for.
    expect(r.value.inheritance?.inherited_controls ?? []).not.toContain('CTRL-ENC-01');
    expect(r.value.inheritance?.inherited_controls ?? []).toEqual([]);
  });

  it('TC-PV-6-01: the chain names what was declared and inherited, and every dimension with its verdict and approved value', () => {
    const p = policyWithPlatform(PLATFORM.approved_envelope as Envelope);
    const r = evaluate(platformGraph('Internal'), p);
    if (!r.ok) throw new Error('evaluation failed');
    const inh = r.value.inheritance;
    expect(inh?.declared_platform).toBe('PLAT-INTERNAL-01');
    expect(inh?.inherited_controls).toEqual(['CTRL-ENC-01', 'CTRL-FINGERPRINT-01']);
    // Every dimension the envelope constrains, each with a fits flag and the approved value.
    const byDim = Object.fromEntries((inh?.dimensions ?? []).map((d) => [d.dimension, d]));
    expect(Object.keys(byDim).sort()).toEqual(['autonomy_level', 'data_class', 'data_zones', 'exposure', 'jurisdictions']);
    expect(byDim.data_class).toMatchObject({ fits: true, ceiling: 'Internal' });
    expect(byDim.exposure).toMatchObject({ fits: true, ceiling: 'internal-shared' });
    expect(byDim.autonomy_level).toMatchObject({ fits: true, ceiling: '2' });
    expect(byDim.data_zones).toMatchObject({ fits: true, ceiling: 'Zone B, Zone C' });
    expect(byDim.jurisdictions).toMatchObject({ fits: true, ceiling: 'EU, UK' });
    // An inherited control is never reported without an envelope stating its basis:
    // every inherited control implies every stated dimension fits.
    if ((inh?.inherited_controls.length ?? 0) > 0) {
      expect((inh?.dimensions ?? []).every((d) => d.fits && d.ceiling.length > 0)).toBe(true);
    }
  });
});

describe('TC-RA-1-01 — UK jurisdiction activates the SS1/23 pack', () => {
  it('TC-RA-1-01: a UK-only graph activates SS1/23 with its version on the verdict; a graph without UK does not', () => {
    const { packs } = loadPacks(getPackSources());
    const ss123 = packs.find((p) => p.pack_id === 'SS1-23')!;
    expect(ss123.version.length).toBeGreaterThan(0);

    const base = graph({
      processing_nodes: [
        { id: 'p1', label: 'm', model_type: 'statistical', autonomy_level: 0, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'o', action_type: 'recommend', exposure: 'internal-only', decision_bindingness: 'material', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });

    const uk = evaluate({ ...base, jurisdictions: ['UK'] }, policy, packs);
    if (!uk.ok) throw new Error('evaluation failed');
    expect(Object.keys(uk.value.pack_versions)).toEqual(['SS1-23']);
    expect(uk.value.pack_versions['SS1-23']).toBe(ss123.version);

    const none = evaluate({ ...base, jurisdictions: [] }, policy, packs);
    if (!none.ok) throw new Error('evaluation failed');
    expect(none.value.pack_versions).toEqual({});
  });
});

describe('TC-UC-4-03 — the question budget is a cap that really bites', () => {
  // A Low-tier graph whose one processing node is flagged uncertain on every
  // field a rule conditions on: more candidate questions than the Low budget.
  function lowTierManyUncertain(): DataFlowGraph {
    return graph({
      processing_nodes: [
        {
          id: 'p1',
          label: 'x',
          model_type: 'statistical',
          autonomy_level: 0,
          data_zone: 'Zone C',
          vendor: 'internal',
          replaces_prior_model: false,
          uncertain: true,
          system_access_scope: 'none',
          multi_instance_coordination: 'no',
          platform: 'PLAT-X',
          declared_model_id: 'm1',
        },
      ],
      output_nodes: [
        { id: 'o1', label: 'o', action_type: 'read', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
  }

  it('TC-UC-4-03: a Low-tier case is asked at most 5 questions even when more than 5 are candidates; a higher tier is allowed more', () => {
    const low = lowTierManyUncertain();
    expect(getQuestionBudget(low, policy)).toEqual({ budget: 5, provisionalTier: 'Low' });
    const asked = generateQuestions(low, policy, []);
    expect(asked.length).toBeLessThanOrEqual(5);

    // The cap must be doing the work: the very same candidates under a tier with
    // a larger budget yield more than 5 questions.
    const high: DataFlowGraph = {
      ...low,
      output_nodes: [{ ...low.output_nodes[0]!, exposure: 'client-facing' }],
    };
    expect(getQuestionBudget(high, policy).budget).toBe(15);
    const askedHigh = generateQuestions(high, policy, []);
    expect(askedHigh.length).toBeGreaterThan(5);
    // So the Low result is exactly the budget: no 6th "just in case" question,
    // and no fewer than the budget allows.
    expect(asked).toHaveLength(5);
  });
});
