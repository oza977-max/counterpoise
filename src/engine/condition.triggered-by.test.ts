import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPacks } from '../store/packs';
import { getPackSources } from '../store/pack-source';
import { matchesCondition, matchedConditionValues } from './condition';
import { evaluate } from './evaluate';
import { loadPolicy } from '../store/policy';
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
    const firedByEffect = new Map<string, number>();
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
          if (hit) {
            const fields = Object.keys(rule.condition);
            if (fields.length > 0) expect(by.length, `${rule.id} on ${spec.id} [${j}]: fired but nothing reported`).toBeGreaterThan(0);
            // every condition field is accounted for, not just one of them
            for (const f of fields) {
              expect(by.some((e) => e.field === f), `${rule.id} on ${spec.id} [${j}]: field ${f} missing from triggered_by`).toBe(true);
            }
            firedByEffect.set(rule.effect.type, (firedByEffect.get(rule.effect.type) ?? 0) + 1);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(fired).toBeGreaterThan(0);
    // Fired rules are counted per effect type; every type a shipped pack uses must fire at least once.
    // (No shipped pack carries a hard_line effect today — the synthetic hard-line test below covers it;
    // when one ships, this loop requires it to fire in the corpus too.)
    for (const t of new Set(rules.map((r) => r.effect.type))) {
      expect(firedByEffect.get(t) ?? 0, `no rule with effect ${t} ever fired in the corpus`).toBeGreaterThan(0);
    }
  });

  it('TC-RA-9-01q: evaluate()\'s regulatory_chain triggered_by equals matchedConditionValues of the rule, end to end', () => {
    const { packs } = loadPacks(getPackSources());
    const loaded = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
    if (!loaded.valid) throw new Error('policy invalid');
    const byId = new Map(packs.flatMap((p) => p.rules).map((r) => [r.id, r]));
    let entriesChecked = 0;
    for (const spec of specs) {
      for (const j of [['UK'], ['EU'], ['UK', 'EU'], ['CA', 'US']]) {
        const g = toGraph(spec.id, spec.graph, j);
        const res = evaluate(g, loaded.policy, packs);
        if (!res.ok) continue;
        for (const entry of res.value.explanation.regulatory_chain ?? []) {
          const rule = byId.get(entry.rule_id);
          if (!rule) continue;
          expect(entry.triggered_by, `${entry.rule_id} on ${spec.id} [${j}]`).toEqual(matchedConditionValues(rule.condition, g));
          entriesChecked++;
        }
      }
    }
    expect(entriesChecked).toBeGreaterThan(0);
  });

  it('TC-RA-9-01r: a pack HARD-LINE rule that fires carries its triggered_by into the rejection chain', () => {
    const { packs } = loadPacks(getPackSources());
    const loaded = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
    if (!loaded.valid) throw new Error('policy invalid');
    const base = packs[0]!;
    const rule = {
      ...base.rules[0]!,
      id: 'SYN-HL-01',
      effect: { type: 'hard_line' as const, reason: 'synthetic' },
      condition: { exposure: 'client-facing', decision_type: { in: ['credit-decision', 'hiring'] } },
    };
    const pack = { ...base, rules: [rule] };
    const spec = specs.find((c) => c.graph.output.exposure === 'client-facing');
    if (!spec) throw new Error('no client-facing corpus case');
    const g = toGraph(spec.id, spec.graph, [base.jurisdiction]);
    (g.output_nodes[0] as unknown as Record<string, unknown>).decision_type = 'credit-decision';
    expect(matchesCondition(rule.condition, g)).toBe(true);
    const res = evaluate(g, loaded.policy, [pack]);
    if (!res.ok) throw new Error('evaluate failed');
    const entry = (res.value.explanation.regulatory_chain ?? []).find((e) => e.rule_id === 'SYN-HL-01');
    expect(entry, 'synthetic pack hard line did not reach the chain').toBeDefined();
    expect(entry!.triggered_by).toEqual(matchedConditionValues(rule.condition, g));
    expect(entry!.triggered_by!.map((t) => t.field)).toEqual(['decision_type', 'exposure']);
  });
});
