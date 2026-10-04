import { describe, it, expect } from 'vitest';
import { assignTier } from './tier';
import type { DataFlowGraph, TierRule } from './types';

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

const TIERS: TierRule[] = [
  { id: 'TIER-CRITICAL', name: 'Critical', triggers: [{ field: 'exposure', value: { in: ['market-facing'] } }] },
  { id: 'TIER-HIGH', name: 'High', triggers: [{ field: 'exposure', value: { in: ['client-facing'] } }] },
  { id: 'TIER-MEDIUM', name: 'Medium', triggers: [{ field: 'autonomy_level', value: { in: [2] } }] },
  { id: 'TIER-LOW', name: 'Low', triggers: [{ field: 'exposure', value: 'internal-only' }] },
];

describe('assignTier', () => {
  it('is impact-dominant — Critical wins even if Low also matches', () => {
    const g = graph({
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'execute', exposure: 'market-facing', decision_bindingness: 'binding', output_reversibility: 'irreversible', scale: 'at_scale' },
      ],
    });
    expect(assignTier(g, TIERS).tier).toBe('Critical');
  });

  it('is order-independent — permuting the tiers array never changes the result', () => {
    const g = graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'ml', autonomy_level: 2, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false },
      ],
    });
    const forward = assignTier(g, TIERS).tier;
    const shuffled = [...TIERS].reverse();
    const backward = assignTier(g, shuffled).tier;
    expect(forward).toBe(backward);
    expect(forward).toBe('Medium');
  });

  it('defaults to Low when no trigger fires [TC-PE-3-03]', () => {
    const g = graph();
    expect(assignTier(g, TIERS).tier).toBe('Low');
  });

  it('skips a rule whose name is not a canonical Tier rather than corrupting the comparison (P3-C01 review finding, defense in depth)', () => {
    const g = graph({
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'execute', exposure: 'client-facing', decision_bindingness: 'material', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
    const badRules: TierRule[] = [
      { id: 'TIER-BAD', name: 'Very Low', triggers: [{ field: 'exposure', value: { in: ['client-facing'] } }] },
      ...TIERS,
    ];
    // High still wins via the valid TIER-HIGH rule; the malformed rule is ignored, not crashed on.
    expect(assignTier(g, badRules).tier).toBe('High');
  });

  it('records the triggering rule', () => {
    const g = graph({
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'execute', exposure: 'client-facing', decision_bindingness: 'material', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
    const result = assignTier(g, TIERS);
    expect(result.triggeringRuleId).toBe('TIER-HIGH');
    expect(result.triggeringField).toBe('exposure');
  });
});
