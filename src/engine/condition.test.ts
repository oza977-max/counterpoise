import { describe, it, expect } from 'vitest';
import { matchesCondition, describeGraphPath, matchedConditionValues } from './condition';
import type { DataFlowGraph } from './types';

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

describe('matchesCondition', () => {
  it('matches gte operator', () => {
    const g = graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'llm', autonomy_level: 4, data_zone: 'Zone A', vendor: 'internal', replaces_prior_model: false },
      ],
    });
    expect(matchesCondition({ autonomy_level: { gte: 4 } }, g)).toBe(true);
    expect(matchesCondition({ autonomy_level: { gte: 5 } }, g)).toBe(false);
  });

  it('matches lte operator', () => {
    const g = graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone A', vendor: 'internal', replaces_prior_model: false },
      ],
    });
    expect(matchesCondition({ autonomy_level: { lte: 1 } }, g)).toBe(true);
    expect(matchesCondition({ autonomy_level: { lte: 0 } }, g)).toBe(false);
  });

  it('matches in operator', () => {
    const g = graph({
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'execute', exposure: 'client-facing', decision_bindingness: 'binding', output_reversibility: 'irreversible', scale: 'at_scale' },
      ],
    });
    expect(matchesCondition({ exposure: { in: ['client-facing', 'market-facing'] } }, g)).toBe(true);
    expect(matchesCondition({ exposure: { in: ['internal-only'] } }, g)).toBe(false);
  });

  it('matches not_in operator', () => {
    const g = graph({
      input_nodes: [{ id: 'i1', label: 'z', data_class: 'MNPI', data_zone: 'Zone C' }],
    });
    expect(matchesCondition({ data_zone: { not_in: ['Zone A'] } }, g)).toBe(true);
    expect(matchesCondition({ data_zone: { not_in: ['Zone C'] } }, g)).toBe(false);
  });

  it('matches bare equality', () => {
    const g = graph({
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'execute', exposure: 'internal-only', decision_bindingness: 'advisory', output_reversibility: 'irreversible', scale: 'limited', hitl: false },
      ],
    });
    expect(matchesCondition({ hitl: false }, g)).toBe(true);
    expect(matchesCondition({ hitl: true }, g)).toBe(false);
  });

  it('ANDs all keys within one condition', () => {
    const g = graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'llm', autonomy_level: 4, data_zone: 'Zone A', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'y', action_type: 'execute', exposure: 'client-facing', decision_bindingness: 'binding', output_reversibility: 'irreversible', scale: 'at_scale' },
      ],
    });
    expect(
      matchesCondition(
        { autonomy_level: { gte: 4 }, output_reversibility: 'irreversible', exposure: { in: ['client-facing'] } },
        g,
      ),
    ).toBe(true);
    expect(
      matchesCondition(
        { autonomy_level: { gte: 4 }, output_reversibility: 'reversible' },
        g,
      ),
    ).toBe(false);
  });

  it('matches across any node on the graph (multi-node semantics)', () => {
    const g = graph({
      input_nodes: [{ id: 'i1', label: 'z', data_class: 'Client PII', data_zone: 'Zone B' }],
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone A', vendor: 'internal', replaces_prior_model: false },
      ],
    });
    expect(matchesCondition({ data_class: { in: ['Client PII'] }, autonomy_level: { gte: 1 } }, g)).toBe(true);
  });

  it('returns false when field is absent from every node', () => {
    const g = graph();
    expect(matchesCondition({ autonomy_level: { gte: 1 } }, g)).toBe(false);
  });

  // R16-A1 (PE-9 §1.1): an array-valued field (system_access_scope) must
  // contribute EACH element as its own candidate, so a condition naming any
  // one of several ticked values still matches.
  it('TC-R16-A1-11: an array-valued field contributes each element to the candidate set', () => {
    const g = graph({
      processing_nodes: [
        {
          id: 'p1',
          label: 'agent',
          model_type: 'agentic',
          autonomy_level: 3,
          data_zone: 'Zone C',
          vendor: 'internal',
          replaces_prior_model: false,
          system_access_scope: ['shared_infrastructure', 'credentialed_systems'],
        },
      ],
    });
    expect(matchesCondition({ system_access_scope: { in: ['credentialed_systems'] } }, g)).toBe(true);
    expect(matchesCondition({ system_access_scope: { in: ['shared_infrastructure'] } }, g)).toBe(true);
    expect(matchesCondition({ system_access_scope: { in: ['deployment_authority'] } }, g)).toBe(false);
  });

  it('TC-R16-A1-12: a single (non-array) value on a list-valued field still matches as before', () => {
    const g = graph({
      processing_nodes: [
        {
          id: 'p1',
          label: 'agent',
          model_type: 'agentic',
          autonomy_level: 3,
          data_zone: 'Zone C',
          vendor: 'internal',
          replaces_prior_model: false,
          system_access_scope: 'shared_infrastructure',
        },
      ],
    });
    expect(matchesCondition({ system_access_scope: { in: ['shared_infrastructure'] } }, g)).toBe(true);
  });
});

describe('describeGraphPath', () => {
  function g2(input_nodes: DataFlowGraph['input_nodes'], output_label = 'out'): DataFlowGraph {
    return graph({
      input_nodes,
      processing_nodes: [
        { id: 'p1', label: 'model', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: output_label, action_type: 'draft', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' },
      ],
    });
  }

  it('TC-R16-A1-13: names every input, not just the first, with two inputs', () => {
    const path = describeGraphPath(
      g2([
        { id: 'i1', label: 'A', data_class: 'Internal', data_zone: 'Zone B' },
        { id: 'i2', label: 'B', data_class: 'Internal', data_zone: 'Zone B' },
      ]),
    );
    expect(path).toBe('A + B → model → out');
  });

  it('TC-R16-A1-14: names every input, not just the first, with three inputs', () => {
    const path = describeGraphPath(
      g2([
        { id: 'i1', label: 'A', data_class: 'Internal', data_zone: 'Zone B' },
        { id: 'i2', label: 'B', data_class: 'Internal', data_zone: 'Zone B' },
        { id: 'i3', label: 'C', data_class: 'Internal', data_zone: 'Zone B' },
      ]),
    );
    expect(path).toBe('A + B + C → model → out');
  });

  it('TC-R16-A1-15: a single input keeps the existing input → model → output shape', () => {
    const path = describeGraphPath(g2([{ id: 'i1', label: 'A', data_class: 'Internal', data_zone: 'Zone B' }]));
    expect(path).toBe('A → model → out');
  });

  it('TC-R16-A1-16: falls back to the processing node when there are no input nodes at all', () => {
    const path = describeGraphPath(g2([]));
    expect(path).toBe('model → out');
  });
});

describe('matchedConditionValues (GT7 D-3, P11)', () => {
  const oneNode = () =>
    graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false },
        { id: 'p2', label: 'y', model_type: 'ml', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'z', action_type: 'recommend', exposure: 'client-facing', decision_bindingness: 'material', output_reversibility: 'reversible', scale: 'limited', decision_type: 'credit-decision' },
      ],
      jurisdictions: ['UK', 'EU'],
    });

  it('TC-RA-9-01d: returns, per condition field, only the graph values that satisfy it, fields sorted, values distinct', () => {
    const out = matchedConditionValues(
      {
        model_type: { in: ['llm', 'agentic'] },
        decision_type: { in: ['credit-decision', 'lending-decision'] },
        data_zone: { in: ['Zone B'] },
      },
      oneNode(),
    );
    expect(out).toEqual([
      { field: 'data_zone', value: 'Zone B' },
      { field: 'decision_type', value: 'credit-decision' },
      { field: 'model_type', value: 'llm' },
    ]);
  });

  it('TC-RA-9-01e: an unconditional rule gives an empty list; a value-equality condition reports the matching value; the jurisdictions array is one candidate, as in the engine', () => {
    expect(matchedConditionValues({}, oneNode())).toEqual([]);
    expect(matchedConditionValues({ exposure: 'client-facing' }, oneNode())).toEqual([{ field: 'exposure', value: 'client-facing' }]);
    // The jurisdictions ARRAY is one candidate to the engine (matchesCondition), so a
    // membership test on it never fires — and the helper must not report one either.
    expect(matchesCondition({ jurisdictions: { in: ['EU', 'JP'] } }, oneNode())).toBe(false);
    expect(matchedConditionValues({ jurisdictions: { in: ['EU', 'JP'] } }, oneNode())).toEqual([]);
    // Several satisfying candidates are all listed, sorted by value (fixed, non-locale order).
    expect(matchedConditionValues({ model_type: { in: ['ml', 'llm'] } }, oneNode())).toEqual([
      { field: 'model_type', value: 'llm' },
      { field: 'model_type', value: 'ml' },
    ]);
    // A condition that does not match contributes nothing.
    expect(matchedConditionValues({ exposure: 'internal-only' }, oneNode())).toEqual([]);
  });

  it('TC-RA-9-01m: gte, lte and not_in report the satisfying values too (and only those)', () => {
    const g = graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'llm', autonomy_level: 2, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false },
        { id: 'p2', label: 'y', model_type: 'ml', autonomy_level: 4, data_zone: 'Zone A', vendor: 'internal', replaces_prior_model: false },
      ],
    });
    expect(matchedConditionValues({ autonomy_level: { gte: 3 } }, g)).toEqual([{ field: 'autonomy_level', value: 4 }]);
    expect(matchedConditionValues({ autonomy_level: { lte: 3 } }, g)).toEqual([{ field: 'autonomy_level', value: 2 }]);
    expect(matchedConditionValues({ data_zone: { not_in: ['Zone A'] } }, g)).toEqual([{ field: 'data_zone', value: 'Zone B', excluded: ['Zone A'] }]);
    // not_in is ONE entry naming what it must not be, never a list of every other value
    const many = graph({ processing_nodes: [{ id: 'p1', label: 'x', model_type: 'llm', autonomy_level: 2, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false }, { id: 'p2', label: 'y', model_type: 'ml', autonomy_level: 4, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false }] });
    expect(matchedConditionValues({ data_zone: { not_in: ['Zone A'] } }, many)).toHaveLength(1);
    expect(matchedConditionValues({ autonomy_level: { gte: 9 } }, g)).toEqual([]);
  });
});

describe('matchedConditionValues needs the whole condition to match (GT7 D-3)', () => {
  it('TC-RA-9-01o: a partly satisfied condition (one field met, another not) reports nothing', () => {
    const g = graph({
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false },
      ],
    });
    expect(matchedConditionValues({ model_type: { in: ['llm'] }, data_zone: { in: ['Zone A'] } }, g)).toEqual([]);
    expect(matchedConditionValues({ model_type: { in: ['llm'] }, data_zone: { in: ['Zone B'] } }, g)).toHaveLength(2);
  });
});
