import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateReasoningTrace, buildTraceData } from './reasoning-trace';
import type { Verdict } from '../types/verdict';
import type { Control, DataFlowGraph, PolicyFile } from '../engine/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import { loadPacks } from '../store/packs';
import { getPackSources } from '../store/pack-source';
import { evaluate } from '../engine/evaluate';

function makeVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    status: 'approved_with_controls',
    tier: 'High',
    track: 'II',
    binding_constraint: 'INV-DATA-01',
    binding_path: 'client notes → drafting model → drafted email',
    controls: ['CTRL-ENC-01'],
    downstream_reviews: [],
    conditions: { hypotheses: [] },
    policy_version: '1.0',
    pack_versions: {},
    applied_overrides: [],
    confidence_caveats: [],
  provisional_reasons: [],
    boundary_proximity: false,
  margin_achieved: 0,
  margin_target: 0.1,
  single_covered_invariants: [],
    explanation: {
      tier_rationale: null,
      track_rationale: null,
      hard_lines_checked: 0,
      invariants_checked: 0,
      tripped_invariants: [],
      binding_reason: null,
      binding_regulatory_basis: null,
    },
    id: 'verdict-1',
    use_case_id: 'uc-1',
    living_status: 'approved',
    living_status_updated_at: '2026-01-01T00:00:00.000Z',
    attested_by: '1LoD',
    attested_at: '2026-01-01T00:00:00.000Z',
    graph_version: 1,
    corrections: [],
    ...overrides,
  };
}

const CONTROL_LIBRARY: Control[] = [
  {
    id: 'CTRL-ENC-01',
    name: 'Encryption in transit',
    description: 'All data in transit to external endpoints must use TLS 1.3 or higher',
    resolves: ['INV-DATA-01'],
    burden: 1,
    verification: 'x',
  },
];

const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: 'text', text: 'Track II per SS1/23 §3.4. Client PII flows to Zone B, requiring encryption.' }],
});

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

describe('buildTraceData', () => {
  it('maps control IDs to full Control records from the library', () => {
    const trace = buildTraceData(makeVerdict(), CONTROL_LIBRARY, 'Client PII must not flow externally without encryption.');
    expect(trace.controls_required).toEqual([
      { id: 'CTRL-ENC-01', name: 'Encryption in transit', description: 'All data in transit to external endpoints must use TLS 1.3 or higher' },
    ]);
  });

  it('builds a one-element tripped_invariants array from binding_constraint/binding_path', () => {
    const trace = buildTraceData(makeVerdict(), CONTROL_LIBRARY, 'desc');
    expect(trace.tripped_invariants).toEqual([
      { invariantId: 'INV-DATA-01', graphPath: 'client notes → drafting model → drafted email' },
    ]);
  });

  it('returns an empty tripped_invariants array when there is no binding constraint (clean approval)', () => {
    const trace = buildTraceData(makeVerdict({ binding_constraint: '', controls: [] }), CONTROL_LIBRARY, '');
    expect(trace.tripped_invariants).toEqual([]);
  });
});

function realPackForcedCriticalVerdict(): { verdict: Verdict; library: Control[] } {
  const loaded = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
  if (!loaded.valid) throw new Error('fixture policy invalid');
  const policy: PolicyFile = loaded.policy;
  const { packs, errors } = loadPacks(getPackSources());
  if (errors.length > 0) throw new Error('fixture packs invalid');
  const g: DataFlowGraph = {
    id: 'g1', version: 1, input_nodes: [],
    processing_nodes: [{ id: 'p1', label: 'cv screener', model_type: 'ml', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false }],
    output_nodes: [{ id: 'o1', label: 'shortlist', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'material', output_reversibility: 'reversible', scale: 'at_scale', decision_type: 'hiring' }],
    edges: [], jurisdictions: ['EU'], intake_method: 'structured_form', extracted_at: '2026-01-01T00:00:00.000Z',
  };
  const r = evaluate(g, policy, packs);
  if (!r.ok) throw new Error('evaluate failed');
  return {
    verdict: makeVerdict({ ...r.value }),
    library: policy.controls as Control[],
  };
}

describe('generateReasoningTrace', () => {
  beforeEach(() => {
    mockCreate.mockClear();
  });

  it('renders the mocked prose (rendering only: this reads back the mock\'s own text and proves nothing about what the model was told)', async () => {
    const trace = buildTraceData(makeVerdict(), CONTROL_LIBRARY, 'SS1/23 §3.4 requires independent validation.');
    const result = await generateReasoningTrace(trace, 'test-key');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatch(/SS1\/23 §3\.4/);
    }
    // Verify the exact §7 prompt structure was sent.
    const callArgs = mockCreate.mock.calls[0]![0];
    expect(callArgs.messages[0].content).toContain('You are a regulatory documentation assistant');
    expect(callArgs.messages[0].content).toContain('Write the reasoning trace.');
  });

  it('TC-VD-8-01: the input handed to the model carries the track reason, the tier reason and the pack citation that forced the tier (P10)', async () => {
    const { verdict, library } = realPackForcedCriticalVerdict();
    // Preconditions: the verdict really is pack-forced and really has rationales.
    expect(verdict.tier).toBe('Critical');
    expect(verdict.explanation.track_rationale).not.toBeNull();
    expect(verdict.explanation.tier_rationale).not.toBeNull();
    const chain = verdict.explanation.regulatory_chain ?? [];
    expect(chain.length).toBeGreaterThan(0);

    await generateReasoningTrace(buildTraceData(verdict, library, 'binding'), 'test-key');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const sent: string = mockCreate.mock.calls[0]![0].messages[0].content;

    const trackName = verdict.explanation.track_rationale!.rule_name!;
    expect(trackName.length).toBeGreaterThan(0);
    expect(sent).toContain(trackName);
    expect(sent).toContain(verdict.explanation.track_rationale!.rule_id);
    expect(sent).toContain(verdict.explanation.tier_rationale!.rule_id);
    // Parse the JSON the model was actually handed and check the tier rationale
    // is there, names its rule, and says it is the BASE tier (not the final one).
    const jsonText = sent.slice(sent.indexOf('{'), sent.lastIndexOf('}') + 1);
    const payload = JSON.parse(jsonText) as { tier_rationale: { rule_id: string; note?: string } };
    expect(payload.tier_rationale.rule_id).toBe(verdict.explanation.tier_rationale!.rule_id);
    expect(payload.tier_rationale.note).toMatch(/BASE tier/);
    // The pack-forced tier's citation lives in the chain. The prompt carries
    // JSON, so compare against each value as JSON would escape it.
    const inJson = (v: string) => JSON.stringify(v).slice(1, -1);
    for (const c of chain) {
      expect(sent).toContain(inJson(c.rule_id));
      expect(sent).toContain(inJson(c.document));
      expect(sent).toContain(inJson(c.section));
      expect(sent).toContain(inJson(c.derived));
    }
  });

  it('TC-VD-8-01b: a hard-line verdict (no tier/track rationale) still hands the model the binding reason and its regulatory basis, and the call allows 1024 tokens', async () => {
    const trace = buildTraceData(
      makeVerdict({
        explanation: {
          tier_rationale: null,
          track_rationale: null,
          hard_lines_checked: 1,
          invariants_checked: 0,
          tripped_invariants: [],
          binding_reason: 'MNPI must never reach Zone A',
          binding_regulatory_basis: 'Market Abuse Regulation Art. 14',
        },
      }),
      CONTROL_LIBRARY,
      'd',
    );
    expect(trace.track_rationale).toBeNull();
    expect(trace.tier_rationale).toBeNull();
    await generateReasoningTrace(trace, 'test-key');
    const body = mockCreate.mock.calls[0]![0];
    expect(body.messages[0].content).toContain('MNPI must never reach Zone A');
    expect(body.messages[0].content).toContain('Market Abuse Regulation Art. 14');
    expect(body.max_tokens).toBe(1024);
  });

  it('returns no-api-key error cleanly when no key is configured, without throwing', async () => {
    const trace = buildTraceData(makeVerdict(), CONTROL_LIBRARY, 'desc');
    const result = await generateReasoningTrace(trace, '');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('no-api-key');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('BC-P5C02-01: a network failure returns a clean Result, never throws, never blocks verdict storage', async () => {
    mockCreate.mockRejectedValueOnce(new Error('network down'));
    const trace = buildTraceData(makeVerdict(), CONTROL_LIBRARY, 'desc');

    const result = await generateReasoningTrace(trace, 'test-key');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('network-error');
  });

  it('TC-CR7-19: the SDK call carries a 15 s timeout and no retries, so a stalled call cannot hold the case lock', async () => {
    const trace = buildTraceData(makeVerdict(), CONTROL_LIBRARY, 'desc');
    await generateReasoningTrace(trace, 'test-key');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0]![1]).toEqual({ timeout: 15000, maxRetries: 0 });
  });
});
