import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { coerceAnswerValue, generateQuestions, questionsForGuessedFields } from './question-generator';
import { loadPolicy } from '../store/policy';
import type { DataFlowGraph, PolicyFile } from './types';

let policy: PolicyFile;

const policyResult = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
if (!policyResult.valid) throw new Error('fixture policy invalid');
policy = policyResult.policy;

function graph(overrides: Partial<DataFlowGraph> = {}): DataFlowGraph {
  return {
    id: 'g1',
    version: 1,
    input_nodes: [],
    processing_nodes: [],
    output_nodes: [],
    edges: [],
    jurisdictions: [],
    intake_method: 'llm',
    extracted_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('generateQuestions', () => {
  it('an uncertain node whose field is referenced by an invariant generates a targeted question', () => {
    const g = graph({
      input_nodes: [{ id: 'i1', label: 'notes', data_class: 'Client PII', data_zone: 'Zone A' }],
      processing_nodes: [
        {
          id: 'p1',
          label: 'x',
          model_type: 'traditional-ml',
          autonomy_level: 0,
          data_zone: 'Zone A',
          vendor: 'internal',
          replaces_prior_model: false,
          uncertain: true,
        },
      ],
    });
    const questions = generateQuestions(g, policy, []);
    // INV-DATA-01's condition references data_zone; the uncertain
    // processing node carries a data_zone field.
    expect(questions.some((q) => q.field === 'data_zone')).toBe(true);
  });

  it('Low-tier question count never exceeds its budget of 5', () => {
    // Force a Low provisional tier (no processing/output nodes triggering
    // higher tiers) with several uncertain-node candidate fields.
    const g = graph({
      processing_nodes: [
        {
          id: 'p1',
          label: 'x',
          model_type: 'traditional-ml',
          autonomy_level: 0,
          data_zone: 'Zone C',
          vendor: 'internal',
          replaces_prior_model: false,
          uncertain: true,
        },
      ],
    });
    const questions = generateQuestions(g, policy, []);
    expect(questions.length).toBeLessThanOrEqual(5); // Low tier budget
  });

  it('returns no questions when no node is flagged uncertain', () => {
    const g = graph({
      processing_nodes: [
        {
          id: 'p1',
          label: 'x',
          model_type: 'traditional-ml',
          autonomy_level: 0,
          data_zone: 'Zone C',
          vendor: 'internal',
          replaces_prior_model: false,
        },
      ],
    });
    expect(generateQuestions(g, policy, [])).toEqual([]);
  });

  it('merges triggered_by when multiple rules reference the same uncertain field', () => {
    const g = graph({
      input_nodes: [{ id: 'i1', label: 'notes', data_class: 'MNPI', data_zone: 'Zone A' }],
      processing_nodes: [
        {
          id: 'p1',
          label: 'x',
          model_type: 'traditional-ml',
          autonomy_level: 0,
          data_zone: 'Zone A',
          vendor: 'internal',
          replaces_prior_model: false,
          uncertain: true,
        },
      ],
    });
    const questions = generateQuestions(g, policy, []);
    const dataZoneQuestion = questions.find((q) => q.field === 'data_zone');
    expect(dataZoneQuestion?.triggered_by.length).toBeGreaterThan(0);
  });

  it('is deterministic — repeated calls with the same input produce identical output', () => {
    const g = graph({
      processing_nodes: [
        {
          id: 'p1',
          label: 'x',
          model_type: 'traditional-ml',
          autonomy_level: 0,
          data_zone: 'Zone A',
          vendor: 'internal',
          replaces_prior_model: false,
          uncertain: true,
        },
      ],
    });
    const first = JSON.stringify(generateQuestions(g, policy, []));
    for (let i = 0; i < 5; i++) {
      expect(JSON.stringify(generateQuestions(g, policy, []))).toBe(first);
    }
  });
});

// code-review-004 F3: the v1.4 agentic-infrastructure fields are closed
// sets and rule-condition candidates, but were absent from both the
// question-options map and the write-back gate — a question for either
// would have rendered free text and coerceAnswerValue would have accepted
// any string (the documented v0.7.1 bug class, re-armed). These pin the
// closed-set contract for both fields.
describe('closed-set write-back gate covers the v1.4 agentic fields (code-review-004 F3)', () => {
  it('system_access_scope accepts only its four legal values', () => {
    expect(coerceAnswerValue('system_access_scope', 'deployment_authority')).toEqual({
      ok: true,
      value: 'deployment_authority',
    });
    expect(coerceAnswerValue('system_access_scope', 'root access to everything').ok).toBe(false);
  });

  it('multi_instance_coordination accepts only yes/no/unknown', () => {
    expect(coerceAnswerValue('multi_instance_coordination', 'unknown')).toEqual({
      ok: true,
      value: 'unknown',
    });
    expect(coerceAnswerValue('multi_instance_coordination', 'probably').ok).toBe(false);
  });
});

// Re-pointed in R18-E from two tests of the retired description-reading step. Those drove that step to get a graph
// and its list of unquoted ("guessed") fields, then asked the
// question generator what to ask. The generator is kept (specs/intake-flow.md §27.10), so what it owes is asserted
// here directly: the guessed list is given as data, the questions that come out are the same ones.
describe('questionsForGuessedFields - questions follow what each description leaves unstated', () => {
  const node = <T,>(n: Record<string, unknown>) => n as unknown as T;
  // (A) an internal summariser whose description states everything: nothing is guessed.
  const GRAPH_A = graph({
    input_nodes: [node({ id: 'i1', label: 'policy documents', data_class: 'Internal', data_zone: 'Zone C' })],
    processing_nodes: [node({ id: 'p1', label: 'summariser', model_type: 'llm', autonomy_level: 0, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false })],
    output_nodes: [node({ id: 'o1', label: 'summary', action_type: 'inform', exposure: 'internal-only', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' })],
  });
  // (B) a client-facing trading assistant described in one breath: it never says what data it uses, where it runs,
  // or what kind of decision it feeds. Its action ("suggests trades") and exposure ("client-facing") ARE quoted.
  const GRAPH_B = graph({
    input_nodes: [node({ id: 'i1', label: 'client positions', data_class: 'Client PII', data_zone: 'Zone B' })],
    processing_nodes: [node({ id: 'p1', label: 'trading assistant', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false })],
    output_nodes: [node({ id: 'o1', label: 'trade suggestion', action_type: 'trade', exposure: 'client-facing', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited', decision_type: 'trading' })],
  });
  const GUESSED_B = {
    i1: ['data_class', 'data_zone'],
    p1: ['model_type', 'autonomy_level', 'data_zone', 'vendor', 'replaces_prior_model'],
    o1: ['decision_bindingness', 'output_reversibility', 'scale', 'decision_type'],
  };

  it('TC-UC-4-04: the summariser and the trading assistant get different questions; only the trading assistant is asked about client data and market-sensitive output', () => {
    const a = questionsForGuessedFields({}, GRAPH_A);
    const b = questionsForGuessedFields(GUESSED_B, GRAPH_B);
    expect(a).toEqual([]);
    expect(b.length).toBeGreaterThan(0);
    expect(b.map((q) => q.field)).not.toEqual(a.map((q) => q.field));
    const bFields = b.map((q) => q.field);
    expect(bFields).toContain('data_class');
    expect(bFields).toContain('data_zone');
    expect(bFields).toContain('decision_type');
    for (const f of ['data_class', 'data_zone', 'decision_type']) expect(a.map((q) => q.field)).not.toContain(f);
  });

  it('a field the description DOES state is not asked about, even for the trading assistant', () => {
    const fields = questionsForGuessedFields(GUESSED_B, GRAPH_B).map((q) => q.field);
    expect(fields).not.toContain('exposure');
    expect(fields).not.toContain('action_type');
  });

  it('TC-CR6-05a: a guessed replaces_prior_model becomes a question about that node, and a field that is not guessed does not', () => {
    const g = graph({
      processing_nodes: [node({ id: 'p1', label: 'GPT-4 based email drafting model', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone B', vendor: 'azure-openai-internal', replaces_prior_model: true })],
    });
    const asked = questionsForGuessedFields({ p1: ['replaces_prior_model'] }, g);
    expect(asked.some((q) => q.field === 'replaces_prior_model' && q.node_id === 'p1')).toBe(true);
    expect(questionsForGuessedFields({}, g)).toEqual([]);
  });
});
