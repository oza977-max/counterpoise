import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPacks } from '../store/packs';
import { getPackSources } from '../store/pack-source';
import { matchesCondition, matchedConditionValues } from './condition';
import type { DataFlowGraph } from './types';

// TC-RA-9-01n: "what set this rule off" (triggered_by) must agree with the
// engine's own firing decision — a non-empty triggered_by means
// matchesCondition fired, and a rule that fired with a non-empty condition
// has something to show. Checked over every shipped pack rule and the
// back-test corpus graphs, each also run with several jurisdiction lists.
const specs = JSON.parse(readFileSync(resolve(__dirname, '../../backtest/cases.json'), 'utf-8')).cases as Array<{
  id: string;
  graph: { jurisdictions: string[]; input: Record<string, string>; processing: Record<string, unknown>; output: Record<string, unknown> };
}>;

function toGraph(id: string, g: (typeof specs)[number]['graph'], jurisdictions: string[]): DataFlowGraph {
  return {
    id,
    version: 1,
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00Z',
    jurisdictions,
    input_nodes: [{ id: 'i1', label: 'input', ...g.input } as never],
    processing_nodes: [{ id: 'p1', label: 'model', ...g.processing } as never],
    output_nodes: [{ id: 'o1', label: 'output', ...g.output } as never],
    edges: [{ from: 'i1', to: 'p1' }, { from: 'p1', to: 'o1' }],
  };
}

describe('triggered_by agrees with matchesCondition (GT7 D-3)', () => {
  it('TC-RA-9-01n: for every shipped pack rule and a set of graphs, non-empty triggered_by <=> the rule fired', () => {
    const { packs, errors } = loadPacks(getPackSources());
    expect(errors).toEqual([]);
    const rules = packs.flatMap((p) => p.rules);
    expect(rules.length).toBeGreaterThan(0);
    let fired = 0;
    let checked = 0;
    for (const spec of specs) {
      for (const j of [spec.graph.jurisdictions, [], ['UK'], ['EU'], ['UK', 'EU'], ['JP', 'SG']]) {
        const g = toGraph(spec.id, spec.graph, j);
        for (const rule of rules) {
          const hit = matchesCondition(rule.condition, g);
          const by = matchedConditionValues(rule.condition, g);
          checked++;
          if (hit) fired++;
          if (by.length > 0) expect(hit, `${rule.id} on ${spec.id} [${j}]: reported a trigger the engine would not fire on`).toBe(true);
          if (hit && Object.keys(rule.condition).length > 0) expect(by.length, `${rule.id} on ${spec.id} [${j}]: fired but nothing reported`).toBeGreaterThan(0);
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(fired).toBeGreaterThan(0);
  });
});
