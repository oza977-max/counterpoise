import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { coerceAnswerValue, generateQuestions } from './question-generator';
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
