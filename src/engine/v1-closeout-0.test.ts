import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dump, load } from 'js-yaml';
import { loadPolicy } from '../store/policy';
import { loadPacks } from '../store/packs';
import { getPackSources } from '../store/pack-source';
import { evaluate } from './evaluate';
import { fitsEnvelope } from './envelope';
import { resolveActivePacks, applyJurisdictionOverrides } from './jurisdiction';
import type { DataFlowGraph, JurisdictionPack, PackRule, PolicyFile } from './types';

// gvm-test 007 close-out, chunk 0 (engine / store half). Each test names the
// original acceptance case it proves, in its title, and asserts the case's
// Then-clauses against the REAL engine, the REAL shipped policy and the REAL
// shipped packs. The first-round audit found that the tests which carried
// these ids only proved part of each case (or something else entirely).

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

const PROC = {
  id: 'p1',
  label: 'model',
  model_type: 'traditional-ml' as const,
  autonomy_level: 1 as const,
  data_zone: 'Zone C' as const,
  vendor: 'internal',
  replaces_prior_model: false,
};
const OUT = {
  id: 'o1',
  label: 'output',
  action_type: 'recommend' as const,
  exposure: 'internal-only' as const,
  decision_bindingness: 'non-binding' as const,
  output_reversibility: 'reversible' as const,
  scale: 'limited' as const,
};

function run(g: DataFlowGraph, pol: PolicyFile = policy, p: JurisdictionPack[] = packs) {
  const r = evaluate(g, pol, p);
  if (!r.ok) throw new Error(`engine error: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe('TC-CS-3-01: an MNPI-handling use case carries a mandatory information security review, with the rule that triggered it', () => {
  // MNPI belongs in Zone C (HL-002 rejects it anywhere else), autonomy L2.
  const mnpi = () =>
    graph({
      input_nodes: [{ id: 'i1', label: 'deal notes', data_class: 'MNPI', data_zone: 'Zone C' }],
      processing_nodes: [{ ...PROC, autonomy_level: 2, data_zone: 'Zone C' }],
      output_nodes: [OUT],
      edges: [{ from: 'i1', to: 'p1' }, { from: 'p1', to: 'o1' }],
    });

  it('lists the review AND the policy rule that required it, on a verdict that is in appetite', () => {
    const v = run(mnpi());
    expect(v.status).not.toBe('rejected');
    expect(v.downstream_reviews).toContain('Information security review');
    const src = (v.downstream_review_sources ?? []).find((s) => s.review === 'Information security review');
    expect(src?.rule_id).toBe('DR-INFOSEC-01');
    // That id is a real rule in the firm's policy, not a made-up label.
    expect(policy.downstream_reviews?.some((r) => r.id === 'DR-INFOSEC-01')).toBe(true);
  });

  it('a use case without MNPI does not carry it (the review is conditional, not blanket)', () => {
    const v = run(graph({ input_nodes: [{ id: 'i1', label: 'public data', data_class: 'Public', data_zone: 'Zone C' }], processing_nodes: [PROC], output_nodes: [OUT] }));
    expect(v.downstream_reviews).not.toContain('Information security review');
  });
});

describe('TC-PE-2-02: a generative-AI Q&A tool with no decision output is Track III, citing the SR 26-2 exclusion', () => {
  const qa = () =>
    graph({
      input_nodes: [{ id: 'i1', label: 'internal documents', data_class: 'Internal', data_zone: 'Zone C' }],
      processing_nodes: [{ ...PROC, label: 'GPT-4 class document assistant', model_type: 'generative-ai', autonomy_level: 0 }],
      output_nodes: [{ ...OUT, action_type: 'inform', exposure: 'internal-only', decision_bindingness: 'non-binding' }],
    });

  it('assigns Track III and names the SR 26-2 exclusion as the basis', () => {
    const v = run(qa());
    expect(v.track).toBe('III');
    expect(v.track).not.toBe('I');
    expect(v.track).not.toBe('II');
    expect(v.explanation.track_rationale?.rule_id).toBe('TRACK-III');
    expect(v.explanation.track_rationale?.regulatory_basis).toMatch(/SR 26-2/);
  });
});

describe('TC-PE-3-03: a low-impact internal summariser is Low or Medium, and the verdict says why', () => {
  const summariser = () =>
    graph({
      input_nodes: [{ id: 'i1', label: 'internal documents', data_class: 'Internal', data_zone: 'Zone A' }],
      processing_nodes: [{ ...PROC, label: 'summariser', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone A' }],
      output_nodes: [{ ...OUT, action_type: 'inform', exposure: 'internal-only', decision_bindingness: 'non-binding' }],
    });

  it('lands on Low or Medium and carries a populated tier rationale', () => {
    const v = run(summariser());
    expect(['Low', 'Medium']).toContain(v.tier);
    const t = v.explanation.tier_rationale;
    expect(t).not.toBeNull();
    // The rule that set the tier is named in the verdict output. For a tier
    // reached by default (no trigger fired) the rationale must say so rather
    // than be absent.
    expect(typeof t?.rule_id).toBe('string');
    expect((t?.rule_id ?? '').length).toBeGreaterThan(0);
  });
});

describe('TC-PE-5-01 / TC-RA-1-02: jurisdiction activates its own pack, and only that one', () => {
  const ukQuant = () =>
    graph({
      input_nodes: [{ id: 'i1', label: 'exposures', data_class: 'Confidential', data_zone: 'Zone C' }],
      processing_nodes: [{ ...PROC, model_type: 'statistical', autonomy_level: 0 }],
      output_nodes: [{ ...OUT, decision_bindingness: 'material' }],
      jurisdictions: ['UK'],
    });

  it('a UK-entity quantitative model activates SS1/23 with its version, and not SR 26-2 alone [TC-PE-5-01]', () => {
    const v = run(ukQuant());
    const ss1 = packs.find((p) => p.pack_id === 'SS1-23')!;
    expect(v.pack_versions['SS1-23']).toBe(ss1.version);
    expect(Object.keys(v.pack_versions)).not.toEqual(['SR-26-2']);
  });

  it('a US-only use case activates SR 26-2 and none of SS1/23, the EU AI Act or DORA [TC-RA-1-02]', () => {
    const active = resolveActivePacks(['US'], policy.jurisdictions, packs).map((p) => p.pack_id);
    expect(active).toEqual(['SR-26-2']);
    const v = run({ ...ukQuant(), jurisdictions: ['US'] });
    expect(Object.keys(v.pack_versions)).toEqual(['SR-26-2']);
    for (const other of ['SS1-23', 'EU-AIACT', 'DORA']) expect(v.pack_versions[other]).toBeUndefined();
  });
});

describe('TC-PE-7-01: the policy version is recorded in every verdict, whatever the outcome', () => {
  const versioned = (): PolicyFile => ({ ...policy, version: '1.3' });
  const approved = () => graph({ processing_nodes: [PROC], output_nodes: [OUT] });
  const withControls = () =>
    graph({
      input_nodes: [{ id: 'i1', label: 'client notes', data_class: 'Client PII', data_zone: 'Zone C' }],
      processing_nodes: [{ ...PROC, data_zone: 'Zone B' }],
      output_nodes: [OUT],
    });
  const outOfAppetite = () =>
    graph({
      input_nodes: [{ id: 'i1', label: 'deal notes', data_class: 'MNPI', data_zone: 'Zone A' }],
      processing_nodes: [PROC],
      output_nodes: [OUT],
    });

  it('stamps "1.3" on an approved, an approved-with-controls and a rejected verdict alike', () => {
    const seen = new Set<string>();
    for (const g of [approved(), withControls(), outOfAppetite()]) {
      const v = run(g, versioned());
      seen.add(v.status);
      expect(v.policy_version).toBe('1.3');
    }
    // The three paths really are three different outcomes.
    expect(seen).toEqual(new Set(['approved', 'approved_with_controls', 'rejected']));
  });
});

describe('TC-PV-1-01: a policy declares an approved-platform registry, available to evaluation', () => {
  it('the loaded policy carries the platform id, its envelope dimensions and its satisfied control ids', () => {
    const plat = policy.platforms?.find((p) => p.id === 'PLAT-INTERNAL-ML');
    expect(plat).toBeDefined();
    expect(plat?.approved_envelope).toMatchObject({
      max_data_class: 'Confidential',
      max_exposure: 'internal-shared',
      max_autonomy_level: 2,
      data_zones: ['Zone B', 'Zone C'],
      jurisdictions: ['UK', 'EU'],
    });
    expect(plat?.satisfies_controls).toEqual(['CTRL-ENC-01', 'CTRL-FINGERPRINT-01', 'CTRL-DRIFT-01']);
  });

  it('evaluation reads the registry: a use case on that platform inherits its three controls', () => {
    const v = run(
      graph({
        input_nodes: [{ id: 'i1', label: 'notes', data_class: 'Confidential', data_zone: 'Zone C' }],
        processing_nodes: [{ ...PROC, model_type: 'ml', autonomy_level: 2, platform: 'PLAT-INTERNAL-ML' } as never],
        output_nodes: [{ ...OUT, exposure: 'internal-shared', decision_bindingness: 'advisory' }],
        jurisdictions: ['UK'],
      }),
    );
    expect(v.inheritance?.declared_platform).toBe('PLAT-INTERNAL-ML');
    expect(v.inheritance?.inherited_controls).toEqual(['CTRL-DRIFT-01', 'CTRL-ENC-01', 'CTRL-FINGERPRINT-01']);
  });

  it('a policy that declares no registry at all is valid — no validation error', () => {
    const raw = load(YAML) as Record<string, unknown>;
    delete raw.platforms;
    delete raw.vendors;
    const r = loadPolicy(dump(raw));
    expect(r.valid).toBe(true);
  });
});

describe('TC-PV-3-03: an ordinal envelope ceiling is inclusive at the boundary', () => {
  const envelope = { max_autonomy_level: 2 } as never;
  const at = (autonomy: 0 | 1 | 2 | 3 | 4) =>
    fitsEnvelope(graph({ processing_nodes: [{ ...PROC, autonomy_level: autonomy }] }), envelope).find(
      (d) => d.dimension === 'autonomy_level',
    )?.fits;

  it('autonomy 1 fits, autonomy 2 fits (the ceiling itself), autonomy 3 does not', () => {
    expect(at(1)).toBe(true);
    expect(at(2)).toBe(true);
    expect(at(3)).toBe(false);
    expect(at(4)).toBe(false);
  });
});

describe('TC-RA-2-01: with US and UK packs both active, the obligations of both are on the verdict', () => {
  const rule = (over: Partial<PackRule>): PackRule => ({
    id: 'X',
    title: 't',
    source: { document: 'Doc', section: 'S', text: 'quoted text' },
    effect: { type: 'required_review', review: 'R' },
    condition: {},
    basis: 'verbatim',
    reviewer_name: 'A',
    reviewer_role: 'B',
    sign_off_date: '2026-01-01',
    ...over,
  });
  const pack = (id: string, jurisdiction: string, rules: PackRule[]): JurisdictionPack => ({
    pack_id: id,
    version: '1',
    jurisdiction,
    regulator: 'R',
    document: id,
    effective_date: '2026-01-01',
    reviewer_name: 'A',
    reviewer_role: 'B',
    sign_off_date: '2026-01-01',
    rules,
  });

  it('every firing rule is in the reasoning chain with its own source text, and the track is not altered', () => {
    const uk = pack('SS1-23', 'UK', [rule({ id: 'UK-R', source: { document: 'SS1/23', section: 'P1', text: 'UK passage' }, effect: { type: 'required_review', review: 'UK review' } })]);
    const us = pack('SR-26-2', 'US', [rule({ id: 'US-R', source: { document: 'SR 26-2', section: 'II', text: 'US passage' }, effect: { type: 'required_control', control_id: 'CTRL-LOG-01' } })]);
    const r = applyJurisdictionOverrides(graph({ jurisdictions: ['UK', 'US'] }), 'Medium', 'II', [uk, us]);
    expect(r.chain.map((c) => c.rule_id).sort()).toEqual(['UK-R', 'US-R']);
    expect(r.chain.find((c) => c.rule_id === 'UK-R')?.source_text).toBe('UK passage');
    expect(r.chain.find((c) => c.rule_id === 'US-R')?.source_text).toBe('US passage');
    expect(r.addedReviews).toContainEqual({ review: 'UK review', rule_id: 'UK-R' });
    expect(r.addedControls).toContain('CTRL-LOG-01');
    expect(r.finalTrack).toBe('II');
  });
});

describe('TC-VD-7-01: the conditions block is populated at verdict time', () => {
  it('a High-tier verdict with controls carries drift, override-rate, zone and model-version conditions', () => {
    const v = run(
      graph({
        input_nodes: [{ id: 'i1', label: 'client notes', data_class: 'Client PII', data_zone: 'Zone C' }],
        processing_nodes: [{ ...PROC, data_zone: 'Zone B' }],
        output_nodes: [{ ...OUT, exposure: 'client-facing', decision_bindingness: 'material' }],
      }),
    );
    expect(v.status).toBe('approved_with_controls');
    expect(v.tier).toBe('High');
    const h = v.conditions.hypotheses;
    expect(h.length).toBeGreaterThan(0);
    expect(h.some((l) => /model drift since validation: green .*amber .*red /i.test(l))).toBe(true);
    // High tier is held to the tighter override-rate band.
    expect(h.some((l) => /human override rate.*high risk band.*5–20/i.test(l))).toBe(true);
    expect(h.some((l) => l === 'Data zone pinned: Zone B')).toBe(true);
    expect(h.some((l) => /model version staleness: green .*amber .*red .*days/i.test(l))).toBe(true);
  });
});
