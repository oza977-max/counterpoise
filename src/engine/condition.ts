import type { Condition, ConditionValue, DataFlowGraph } from './types';

// Multi-node field lookup (evaluation-engine.md §3.7): a condition on a
// field matches if ANY node in the graph carries that field and it
// satisfies the operator. Flatten every node's own fields into one lookup.
//
// R16-A1 (PE-9 §1.1): a field may now hold an ARRAY of values on one node
// (system_access_scope, when several kinds were ticked at once) — an array
// value contributes EACH element as its own candidate, the same way several
// NODES carrying the field already contribute one candidate each. This is
// what lets `{ in: [...] }` match on any one of several ticked values
// without the operator itself needing to know about lists.
function collectFieldValues(graph: DataFlowGraph, field: string): unknown[] {
  const values: unknown[] = [];
  const nodes = [...graph.input_nodes, ...graph.processing_nodes, ...graph.output_nodes] as unknown as Array<
    Record<string, unknown>
  >;
  for (const node of nodes) {
    if (field in node) {
      const value = node[field];
      if (Array.isArray(value)) {
        values.push(...value);
      } else {
        values.push(value);
      }
    }
  }
  if (field === 'jurisdictions') {
    values.push(graph.jurisdictions);
  }
  return values;
}

function matchesOperator(actual: unknown, expected: ConditionValue): boolean {
  if (typeof expected === 'object' && expected !== null) {
    if ('gte' in expected) return typeof actual === 'number' && actual >= expected.gte;
    if ('lte' in expected) return typeof actual === 'number' && actual <= expected.lte;
    if ('in' in expected) return expected.in.includes(actual);
    if ('not_in' in expected) return !expected.not_in.includes(actual);
  }
  return actual === expected;
}

// ADR-002: minimal operator set, all keys within one Condition are ANDed.
export function matchesCondition(condition: Condition, graph: DataFlowGraph): boolean {
  for (const [field, expected] of Object.entries(condition)) {
    const candidates = collectFieldValues(graph, field);
    const matched = candidates.some((actual) => matchesOperator(actual, expected));
    if (!matched) return false;
  }
  return true;
}

// GT7 D-3 (P11): for each field of a rule's condition, the distinct graph
// values that actually satisfied it — "what set this rule off". Pure and
// deterministic (NF-1): fields and values are sorted with a fixed,
// non-locale comparison. An unconditional rule gives []. Only scalar values
// (string | number | boolean) are reported; arrays such as `jurisdictions`
// are flattened to their elements.
export type MatchedConditionValue = { field: string; value: string | number | boolean };

function compareScalar(a: string | number | boolean, b: string | number | boolean): number {
  const ka = `${typeof a}:${String(a)}`;
  const kb = `${typeof b}:${String(b)}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

export function matchedConditionValues(condition: Condition, graph: DataFlowGraph): MatchedConditionValue[] {
  const out: MatchedConditionValue[] = [];
  for (const field of Object.keys(condition).sort()) {
    const expected = condition[field] as ConditionValue;
    const seen = new Set<string>();
    const values: Array<string | number | boolean> = [];
    for (const candidate of collectFieldValues(graph, field).flat()) {
      if (typeof candidate !== 'string' && typeof candidate !== 'number' && typeof candidate !== 'boolean') continue;
      if (!matchesOperator(candidate, expected)) continue;
      const key = `${typeof candidate}:${String(candidate)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(candidate);
    }
    values.sort(compareScalar);
    for (const value of values) out.push({ field, value });
  }
  return out;
}

// Shared graph-path description (VD-2 binding_path) used by hard-line and
// invariant evaluation. Best-effort — names every node on the graph, since
// the condition language doesn't track which specific node satisfied a
// multi-node match.
//
// R16-A1 (§1.1, D-03): names EVERY input, not just the first ("A + B →
// model → output"), so the reviewer section's "graph path it matched" never
// drops a ticked kind of information when more than one input node is
// present. The no-input-nodes fallback (a processing node standing in as
// "the input") is unchanged — in that one case there is nothing to join and
// no separate processing label to add, since the processing node already
// occupies the first slot.
export function describeGraphPath(graph: DataFlowGraph): string {
  const hasInputs = graph.input_nodes.length > 0;
  const inputPart = hasInputs
    ? graph.input_nodes.map((n) => n.label).join(' + ')
    : graph.processing_nodes[0]?.label ?? 'unknown-input';
  const processingPart = hasInputs ? graph.processing_nodes.map((n) => n.label) : [];
  const output = graph.output_nodes[0]?.label ?? 'unknown-output';
  return [inputPart, ...processingPart, output].join(' → ');
}
