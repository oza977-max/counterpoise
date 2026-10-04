import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { append, getAllForExport, verifyChain, __resetChainStateForTests } from './audit';
import { addNode } from './register';
import { __resetDbsForTests } from './db';
import { loadPolicy } from './policy';
import { loadPacks } from './packs';
import { getPackSources } from './pack-source';
import { exportBundle, importBundle, __resetHandoffSyncStateForTests } from './handoff';
import { evaluate } from '../engine/evaluate';
import type { DataFlowGraph, RegulatoryChainEntry } from '../engine/types';
import type { RegisterNode } from './types';

// GT7 D-3 (BC-002/BC-003): the new optional `triggered_by` on a regulatory
// chain entry survives a real export -> import, and a bundle from before the
// field existed still imports. The verdict is REAL evaluate() output, not a
// hand-written literal.

async function freshMachine(): Promise<void> {
  await __resetDbsForTests();
  __resetChainStateForTests();
  __resetHandoffSyncStateForTests();
}

function realCreditVerdict() {
  const loaded = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
  if (!loaded.valid) throw new Error('fixture policy invalid');
  const { packs, errors } = loadPacks(getPackSources());
  if (errors.length > 0) throw new Error('fixture packs invalid');
  const g: DataFlowGraph = {
    id: 'g1',
    version: 1,
    input_nodes: [],
    processing_nodes: [
      { id: 'p1', label: 'scorer', model_type: 'ml', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false },
    ],
    output_nodes: [
      { id: 'o1', label: 'decision', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'material', output_reversibility: 'reversible', scale: 'at_scale', decision_type: 'credit-decision' },
    ],
    edges: [],
    jurisdictions: ['UK', 'EU'],
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00.000Z',
  };
  const r = evaluate(g, loaded.policy, packs);
  if (!r.ok) throw new Error('evaluate failed');
  return r.value;
}

async function seedCase(useCaseId: string, stripTriggeredBy: boolean): Promise<void> {
  const real = realCreditVerdict();
  const chain: RegulatoryChainEntry[] = (real.explanation.regulatory_chain ?? []).map((c) => {
    if (!stripTriggeredBy) return c;
    const old: Partial<RegulatoryChainEntry> = { ...c };
    delete old.triggered_by;
    return old as RegulatoryChainEntry;
  });
  const verdict = {
    ...real,
    explanation: { ...real.explanation, regulatory_chain: chain },
    id: `${useCaseId}-v1`,
    use_case_id: useCaseId,
    attested_at: '2026-01-02T00:00:01.000Z',
    living_status: 'approved',
  };
  await addNode({
    node_id: useCaseId,
    node_type: 'use_case',
    label: 'Chain fixture',
    created_at: '2026-01-01T00:00:00.000Z',
    metadata: {
      node_type: 'use_case',
      submitted_by: '1LoD',
      lifecycle_stage: 'pre_checked',
      current_verdict_id: null,
      tier: real.tier,
      track: real.track,
    },
  } as RegisterNode);
  await append({
    event_id: `${useCaseId}-created`,
    use_case_id: useCaseId,
    event_type: 'use_case_created',
    occurred_at: '2026-01-02T00:00:00.000Z',
    actor: '1LoD',
    payload: { type: 'use_case_created', description: 'chain fixture', intake_method: 'structured_form' },
  });
  await append({
    event_id: `${useCaseId}-verdict`,
    use_case_id: useCaseId,
    event_type: 'verdict_produced',
    occurred_at: '2026-01-02T00:00:01.000Z',
    actor: 'system',
    payload: { type: 'verdict_produced', verdict: verdict as never },
  });
}

async function importedChain(): Promise<Array<Record<string, unknown>>> {
  const events = await getAllForExport();
  const ev = events.find((e) => e.event_type === 'verdict_produced');
  const payload = ev?.payload as { verdict?: { explanation?: { regulatory_chain?: Array<Record<string, unknown>> } } };
  return payload.verdict?.explanation?.regulatory_chain ?? [];
}

describe('hand-off of regulatory_chain.triggered_by (GT7 D-3)', () => {
  beforeEach(async () => {
    await freshMachine();
  });

  it('TC-RA-9-01k: a bundle exported from real evaluate() output keeps triggered_by through import, chain intact', async () => {
    await seedCase('uc-chain-new', false);
    const bundle = await exportBundle('0.0.0-test');
    await freshMachine();
    const result = await importBundle(bundle);
    expect(result.outcome).toBe('imported_into_empty');
    const chain = await importedChain();
    const credit = chain.find((c) => c.rule_id === 'EU-AIACT-TIER-01');
    expect(credit?.triggered_by).toEqual([{ field: 'decision_type', value: 'credit-decision' }]);
    expect((await verifyChain()).ok).toBe(true);
  });

  it('TC-RA-9-01l: an OLD bundle whose chain entries lack triggered_by still imports', async () => {
    await seedCase('uc-chain-old', true);
    const bundle = await exportBundle('0.0.0-test');
    await freshMachine();
    const result = await importBundle(bundle);
    expect(result.outcome).toBe('imported_into_empty');
    const chain = await importedChain();
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.every((c) => !('triggered_by' in c))).toBe(true);
    expect((await verifyChain()).ok).toBe(true);
  });
});
